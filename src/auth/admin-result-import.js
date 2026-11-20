/*
 * Intelligent result import for the principal administrator.
 *
 * The browser prepares a reviewable draft with the vision/text model. The
 * server remains the only place allowed to publish rows into Supabase.
 */

const COUNTRIES = [
  ['BJ', 'Bénin'],
  ['CI', "Côte d’Ivoire"],
  ['GH', 'Ghana'],
  ['AO', 'Angola'],
  ['GN', 'Guinée'],
  ['NE', 'Niger'],
  ['SN', 'Sénégal'],
  ['TG', 'Togo'],
  ['__custom', 'Autre pays…']
];

const DEFAULT_SCHEDULE = [
  'Digital 21h=21:00',
  'Digital 22h=22:00',
  'Digital 23h=23:00',
  'Awale=16:00',
  'dimanche | Benediction=10:00',
  'dimanche | Prestige=13:00',
  'dimanche | Espoir=18:00'
].join('\n');

const DAY_NAMES = [
  ['dimanche', 0],
  ['lundi', 1],
  ['mardi', 2],
  ['mercredi', 3],
  ['jeudi', 4],
  ['vendredi', 5],
  ['samedi', 6]
];

const imagePart = (url) => ({
  type: 'image_url',
  image_url: { url }
});

const textPart = (text) => ({ type: 'text', text });

const escapeText = (value) => String(value ?? '');

function parseTime(value) {
  const raw = escapeText(value).trim().toLowerCase();
  const match = raw.match(/(?:^|\D)([01]?\d|2[0-3])(?:[:h.]([0-5]\d))?\s*(?:h|heure|hrs?)?(?:\D|$)/i);
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${String(match[2] || '00').padStart(2, '0')}`;
}

function normalizeName(value) {
  return escapeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCountryCode(value) {
  const dialMatch = window.cidInternationalPhone?.match?.(value);
  const dialCode = dialMatch
    ? window.cidInternationalPhone?.isoByDial?.[dialMatch[0]]
    : '';
  if (dialCode) return dialCode;
  const raw = escapeText(value).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ').replace(/\s+/g, ' ');
  if (raw === 'angola' || raw === 'ao') return 'AO';
  return /^[a-z]{2,8}$/.test(raw) ? raw.toUpperCase() : '';
}

function dayNumber(value) {
  const key = normalizeName(value);
  if (!key || key === 'tous' || key === 'tous les jours' || key === 'quotidien') return null;
  return DAY_NAMES.find(([name]) => name === key)?.[1] ?? null;
}

function parseScheduleRows(text) {
  const rows = [];
  escapeText(text).split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*(?:(.+?)\s*\|\s*)?(.+?)\s*=\s*(.+?)\s*$/);
    if (!match) return;
    const time = parseTime(match[3]);
    const programName = normalizeName(match[2]);
    if (time && programName) {
      rows.push({
        programName,
        dayOfWeek: match[1] ? dayNumber(match[1]) : null,
        drawTime: time
      });
    }
  });
  return rows;
}

function defaultTimeFor(programName, schedule, drawDate) {
  const key = normalizeName(programName);
  if (!key) return '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(drawDate || '')
    ? new Date(`${drawDate}T12:00:00Z`).getUTCDay()
    : null;
  const matches = schedule.filter((row) => (
    (row.programName === key || key.includes(row.programName) || row.programName.includes(key))
    && (row.dayOfWeek === null || row.dayOfWeek === day)
  ));
  const exactDay = matches.find((row) => row.dayOfWeek === day);
  if (exactDay) return exactDay.drawTime;
  const allDays = matches.find((row) => row.dayOfWeek === null);
  if (allDays) return allDays.drawTime;
  for (const row of schedule) {
    // Do not assign the first Digital slot to every generic "Digital" row.
    // A numbered routine entry is only safe when the document also names that
    // numbered slot explicitly.
    if (/\d/.test(row.programName)) continue;
    if (row.dayOfWeek !== null && row.dayOfWeek !== day) continue;
    if (key.includes(row.programName) || row.programName.includes(key)) return row.drawTime;
  }
  return '';
}

function scheduleTextFromRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const dayOfWeek = row.dayOfWeek ?? row.day_of_week;
    const drawTime = row.drawTime ?? row.draw_time;
    const programName = row.programName ?? row.program_name;
    const day = dayOfWeek === null || dayOfWeek === undefined
      ? ''
      : `${DAY_NAMES.find(([, number]) => number === Number(dayOfWeek))?.[0] || ''} | `;
    return `${day}${programName}=${String(drawTime || '').slice(0, 5)}`;
  }).filter((line) => !line.endsWith('=')).join('\n');
}

function parsePlainResultBlock(text) {
  const lines = escapeText(text).split(/\r?\n/).map((line) => line.trim());
  const draws = [];
  let detectedDate = null;
  let current = null;
  let group = '';
  const flush = () => {
    if (!current) return;
    draws.push({
      ...current,
      sourceOrder: draws.length,
      note: current.firstNumbers.length || current.machineNumbers.length || current.bonusNumbers.length
        ? ''
        : 'Aucun numéro reconnu pour ce programme.'
    });
    current = null;
    group = '';
  };
  const makeDraw = (heading) => {
    const cleanHeading = heading.replace(/\s+/g, ' ').trim();
    const time = parseTime(cleanHeading);
    // “Bénin 8H”, “Digital 23h” and “Togo 13h” are all valid headings.
    // The selected country is supplied separately by the admin form.
    const programName = cleanHeading
      .replace(/(?:^|\s)(?:[01]?\d|2[0-3])(?:[:h.]([0-5]\d))?\s*(?:h|heure|hrs?)?(?=\s|$)/i, '')
      .replace(/\s*[—–-]\s*$/, '')
      .trim() || cleanHeading;
    return {
      programName,
      drawTime: time,
      drawNumber: null,
      firstNumbers: [],
      machineNumbers: [],
      bonusNumbers: []
    };
  };
  const appendNumbers = (name, value) => {
    if (!current || !name) return;
    const numbers = normalizeNumbers(value);
    if (!numbers.length) return;
    current[`${name}Numbers`].push(...numbers);
    current[`${name}Numbers`] = [...new Set(current[`${name}Numbers`])].slice(0, 10);
  };
  lines.forEach((line) => {
    if (!line) return;
    const inlineLabels = [
      ...line.matchAll(/(?:^|[—–|])\s*(gagnants?|machines?|machine|bonus)\s*:?\s*/gi)
    ];
    if (inlineLabels.length) {
      const firstLabel = inlineLabels[0];
      const heading = line.slice(0, firstLabel.index)
        .replace(/[—–|]\s*$/, '')
        .trim();
      if (heading) {
        if (current) flush();
        current = makeDraw(heading);
        group = '';
      }
      if (!current) return;
      inlineLabels.forEach((match, index) => {
        const label = normalizeName(match[1]);
        group = label.startsWith('gagnant')
          ? 'first'
          : label.startsWith('machine')
            ? 'machine'
            : 'bonus';
        const start = match.index + match[0].length;
        const end = index + 1 < inlineLabels.length
          ? inlineLabels[index + 1].index
          : line.length;
        appendNumbers(group, line.slice(start, end));
      });
      return;
    }
    const dateMatch = line.match(/(?:^|\s)(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}[/-]\d{1,2}[/-]\d{1,2})(?:\s|$)/);
    if (dateMatch) {
      if (!detectedDate) detectedDate = dateMatch[1];
      return;
    }
    if (/^(?:dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\b/i.test(line)
      && /\d{1,2}[/-]\d{1,2}/.test(line)) return;

    const drawNumberMatch = line.match(/^tirage\s*:?\s*(\d{1,6})\s*$/i);
    if (drawNumberMatch) {
      if (current) current.drawNumber = Number(drawNumberMatch[1]);
      return;
    }

    const labelMatch = line.match(/^(gagnants?|machines?|machine|bonus)\s*:?\s*(.*)$/i);
    if (labelMatch) {
      if (!current) return;
      const label = normalizeName(labelMatch[1]);
      group = label.startsWith('gagnant')
        ? 'first'
        : label.startsWith('machine')
          ? 'machine'
          : 'bonus';
      appendNumbers(group, labelMatch[2]);
      return;
    }

    if (/^\d{1,2}(?:\s*[-–—]\s*\d{1,2})+$/.test(line) && group && current) {
      appendNumbers(group, line);
      return;
    }
    if (/^\d{1,2}$/.test(line) && group && current) {
      appendNumbers(group, line);
      return;
    }

    // A new non-labelled line is a new draw heading. This also handles
    // headings written as “Digital 23h” without a blank line between draws.
    if (current) flush();
    current = makeDraw(line);
    group = '';
  });
  flush();
  return draws.length ? { detectedDate, draws, warnings: [] } : null;
}

function normalizeNumbers(value) {
  const source = Array.isArray(value)
    ? value
    : escapeText(value).split(/[,\s;|+–—-]+/);
  return [...new Set(source
    .map((item) => Number.parseInt(String(item).replace(/[^\d]/g, ''), 10))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 90))]
    .slice(0, 10);
}

function toIsoDate(value, fallback) {
  const raw = escapeText(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (!match) return fallback;
  const year = Number(match[3] || String(fallback || '').slice(0, 4) || new Date().getFullYear());
  const fullYear = year < 100 ? 2000 + year : year;
  const month = Number(match[2]);
  const day = Number(match[1]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12) return fallback;
  const result = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${result}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : result;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Le fichier image ne peut pas être lu.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

async function pdfToImages(file) {
  let pdfjs;
  try {
    pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  } catch (_) {
    throw new Error('Le lecteur PDF est indisponible. Vous pouvez copier-coller le texte du PDF.');
  }
  pdfjs.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const documentProxy = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const images = [];
  const pageCount = Math.min(Number(documentProxy.numPages) || 0, 8);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.86));
  }
  return images;
}

async function readInputFile(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (type.startsWith('image/')) {
    return { images: [await readFileAsDataUrl(file)], text: '' };
  }
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    return { images: await pdfToImages(file), text: '' };
  }
  if (type.startsWith('text/') || /\.(txt|csv|tsv|json)$/i.test(name)) {
    return { images: [], text: await file.text() };
  }
  throw new Error('Format non reconnu. Utilisez une image, un PDF ou un fichier texte.');
}

function modelSchema() {
  const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      detectedDate: nullable('string'),
      draws: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            programName: { type: 'string' },
            drawTime: nullable('string'),
            drawNumber: nullable('integer'),
            firstNumbers: { type: 'array', items: { type: 'integer' } },
            machineNumbers: { type: 'array', items: { type: 'integer' } },
            bonusNumbers: { type: 'array', items: { type: 'integer' } },
            sourceOrder: { type: 'integer' },
            note: { type: 'string' }
          },
          required: [
            'programName',
            'drawTime',
            'drawNumber',
            'firstNumbers',
            'machineNumbers',
            'bonusNumbers',
            'sourceOrder',
            'note'
          ]
        }
      },
      warnings: { type: 'array', items: { type: 'string' } }
    },
    required: ['detectedDate', 'draws', 'warnings']
  };
}

async function analyzeWithModel({ countryCode, countryName, fallbackDate, text, images }) {
  if (!window.websim?.chat?.completions?.create) {
    const local = images.length ? null : parsePlainResultBlock(text);
    if (local) return local;
    throw new Error('Le service d’analyse intelligente est indisponible.');
  }
  const instructions = `Tu analyses une capture ou un document de résultats de tirages.
Pays choisi par l’administrateur : ${countryName} (${countryCode}).
Date de secours si la date n’est pas complète : ${fallbackDate}.
Extrais uniquement ce qui est réellement visible. N’invente jamais un numéro,
une heure ou un numéro de tirage. « Gagnants » correspond à firstNumbers,
« Machine(s) » à machineNumbers et « Bonus » à bonusNumbers. Les heures écrites « 23h », « 22 h »
ou « 21:00 » doivent être converties en HH:MM. Si une information manque,
retourne null et ajoute une note. Le texte peut contenir un nombre par ligne :
regroupe les cinq numéros qui suivent « Gagnants : » dans firstNumbers et les
cinq numéros qui suivent « Machine(s) : » dans machineNumbers. Un bonus peut
contenir un seul numéro ou plusieurs numéros selon le pays, et ne doit jamais
être inventé. Les nombres peuvent être écrits sur la même ligne ou un par ligne.
Conserve l’ordre des programmes dans sourceOrder, même si
les heures sont absentes. Les intitulés « Special Weekend », « Digital
Reveil », « Digital », « Benediction », « Prestige », « Awale » et
« Afterwork » sont des noms de programmes, pas des numéros.
Retourne uniquement le JSON conforme au schéma demandé.`;
  const content = [textPart(instructions)];
  if (text.trim()) content.push(textPart(`Texte à analyser :\n${text.slice(0, 120000)}`));
  images.slice(0, 8).forEach((image) => content.push(imagePart(image)));
  try {
    const completion = await window.websim.chat.completions.create({
      messages: [{ role: 'user', content }],
      schema: modelSchema()
    });
    return JSON.parse(completion.content);
  } catch (error) {
    const local = images.length ? null : parsePlainResultBlock(text);
    if (local) return local;
    throw new Error(error?.message || 'La réponse de l’analyse n’est pas exploitable. Réessayez avec une image plus nette.');
  }
}

function normalizeDraft(payload, options) {
  const schedule = parseScheduleRows(options.scheduleText);
  const fallbackDate = options.fallbackDate;
  const detectedDate = toIsoDate(payload?.detectedDate, fallbackDate);
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings.map(String) : [];
  const rows = (Array.isArray(payload?.draws) ? payload.draws : [])
    .map((raw, index) => {
      const programName = escapeText(raw?.programName).trim() || `Programme ${index + 1}`;
      const detectedTime = parseTime(raw?.drawTime);
      const configuredTime = detectedTime || defaultTimeFor(programName, schedule, detectedDate);
      const first = normalizeNumbers(raw?.firstNumbers);
      const machine = normalizeNumbers(raw?.machineNumbers);
      const bonus = normalizeNumbers(raw?.bonusNumbers);
      const drawNumber = Number.isInteger(raw?.drawNumber) && raw.drawNumber >= 0
        ? raw.drawNumber
        : null;
      const notes = [];
      if (detectedTime) notes.push('heure détectée');
      else if (configuredTime) notes.push('heure ajoutée depuis la routine');
      else notes.push('heure à confirmer');
      if (!first.length) notes.push('groupe Gagnants introuvable');
      if (!machine.length) notes.push('groupe Machine introuvable');
      if (drawNumber === null) notes.push('numéro de tirage facultatif non fourni');
      if (raw?.note) notes.push(escapeText(raw.note));
      return {
        sourceOrder: Number.isInteger(raw?.sourceOrder) ? raw.sourceOrder : index,
        drawDate: detectedDate,
        programName,
        drawTime: configuredTime,
        drawNumber,
        first,
        machine,
        bonus,
        timeOrigin: detectedTime ? 'detected' : configuredTime ? 'configured' : 'missing',
        notes: [...new Set(notes)].join(' · ')
      };
    })
    .sort((left, right) => {
      if (left.drawDate !== right.drawDate) return left.drawDate.localeCompare(right.drawDate);
      if (!left.drawTime && !right.drawTime) return left.sourceOrder - right.sourceOrder;
      if (!left.drawTime) return 1;
      if (!right.drawTime) return -1;
      return left.drawTime.localeCompare(right.drawTime) || left.sourceOrder - right.sourceOrder;
    });
  return { rows, warnings, detectedDate };
}

function input(className, value, type = 'text') {
  const element = document.createElement('input');
  element.className = className;
  element.type = type;
  element.value = value ?? '';
  return element;
}

function textarea(className, value) {
  const element = document.createElement('textarea');
  element.className = className;
  element.value = value ?? '';
  return element;
}

function button(label, className) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  return element;
}

function renderPreview(root, state) {
  const preview = root.querySelector('[data-result-import-preview]');
  const summary = root.querySelector('[data-result-import-summary]');
  const saveButton = root.querySelector('[data-result-import-save]');
  preview.replaceChildren();
  if (!state.rows.length) {
    summary.textContent = 'Aucun tirage reconnu.';
    saveButton.disabled = true;
    return;
  }
  const missing = state.rows.filter((row) => !row.drawTime || !row.first.length).length;
  summary.textContent = `${state.rows.length} tirage(s) reconnu(s) · ${missing} ligne(s) à compléter · ${state.warnings.length} avertissement(s)`;
  state.rows.forEach((row, index) => {
    const card = document.createElement('article');
    card.className = 'admin-result-import-row';
    card.dataset.importIndex = String(index);
    const heading = document.createElement('div');
    heading.className = 'admin-result-import-row-heading';
    const headingName = document.createElement('strong');
    headingName.textContent = row.programName;
    const headingSource = document.createElement('span');
    headingSource.textContent = row.timeOrigin === 'detected'
      ? 'Heure détectée'
      : row.timeOrigin === 'configured'
        ? 'Heure de routine'
        : 'Heure manquante';
    heading.append(headingName, headingSource);
    const grid = document.createElement('div');
    grid.className = 'admin-result-import-row-grid';
    const field = (label, control) => {
      const wrap = document.createElement('label');
      wrap.innerHTML = `<span>${label}</span>`;
      wrap.appendChild(control);
      return wrap;
    };
    grid.append(
      field('Date', input('admin-result-import-date', row.drawDate, 'date')),
      field('Programme', input('admin-result-import-program', row.programName)),
      field('Heure', input('admin-result-import-time', row.drawTime, 'time')),
      field('N° tirage (facultatif)', input('admin-result-import-number', row.drawNumber ?? '', 'number'))
    );
    const numbers = document.createElement('div');
    numbers.className = 'admin-result-import-number-grid';
    numbers.append(
      field('Gagnants (5 premiers)', textarea('admin-result-import-first', row.first.join(' - '))),
      field('Machines (5 derniers)', textarea('admin-result-import-machine', row.machine.join(' - '))),
      field('Bonus (facultatif, variable)', textarea('admin-result-import-bonus', row.bonus.join(' - ')))
    );
    const note = document.createElement('small');
    note.className = `admin-result-import-note${row.timeOrigin === 'missing' || !row.first.length ? ' is-warning' : ''}`;
    note.textContent = row.notes || 'Vérifiez cette ligne avant l’enregistrement.';
    card.append(heading, grid, numbers, note);
    preview.appendChild(card);
  });
  saveButton.disabled = missing > 0;
}

function readRows(root) {
  return [...root.querySelectorAll('.admin-result-import-row')].map((card) => ({
    drawDate: card.querySelector('.admin-result-import-date')?.value || '',
    programName: card.querySelector('.admin-result-import-program')?.value.trim() || '',
    drawTime: card.querySelector('.admin-result-import-time')?.value || '',
    drawNumber: card.querySelector('.admin-result-import-number')?.value === ''
      ? null
      : Number.parseInt(card.querySelector('.admin-result-import-number')?.value || '', 10),
    first: normalizeNumbers(card.querySelector('.admin-result-import-first')?.value || ''),
    machine: normalizeNumbers(card.querySelector('.admin-result-import-machine')?.value || ''),
    bonus: normalizeNumbers(card.querySelector('.admin-result-import-bonus')?.value || '')
  }));
}

export function createAdminResultImport({
  onSave,
  loadSchedules = null,
  saveSchedules = null
} = {}) {
  const root = document.createElement('section');
  root.className = 'admin-result-import';
  root.innerHTML = `
    <div class="admin-result-import-header">
      <div>
        <p class="admin-v3-eyebrow">Import intelligent</p>
        <h3>Ajouter plusieurs résultats</h3>
        <p>Choisissez le pays, importez une capture/PDF ou collez un long texte. Les données restent en aperçu jusqu’à votre validation.</p>
      </div>
      <span class="admin-result-import-badge">Administrateur</span>
    </div>
    <div class="admin-result-import-controls">
      <label><span>Pays</span><select data-result-import-country>${COUNTRIES.map(([code, name]) => `<option value="${code}"${code === 'CI' ? ' selected' : ''}>${name}${code === '__custom' ? '' : ` (${code})`}</option>`).join('')}</select><input data-result-import-country-custom type="text" placeholder="Nom ou code du pays (ex. Angola ou AO)" hidden></label>
      <label><span>Date de secours</span><input data-result-import-date type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="admin-result-import-file"><span>Image / PDF / fichier</span><input data-result-import-file type="file" accept="image/*,.pdf,.txt,.csv,.tsv,.json"></label>
    </div>
    <label class="admin-result-import-schedule"><span>Horaires de routine si l’image ne les indique pas</span><textarea data-result-import-schedule>${DEFAULT_SCHEDULE}</textarea><small>Format : <code>Awale=16:00</code> ou <code>lundi | Awale=16:00</code>. Une règle enregistrée sera réutilisée pour les prochains imports.</small></label>
    <div class="admin-result-import-routine-actions"><button type="button" class="admin-v3-button admin-v3-button--secondary" data-result-import-save-schedule>Enregistrer ces routines</button><span class="admin-v3-status" data-result-import-routine-status role="status"></span></div>
    <label class="admin-result-import-paste"><span>Ou coller le texte des résultats</span><textarea data-result-import-text placeholder="Exemple : Bénin 8h&#10;15-09-2026&#10;Gagnants : 01-20-44-80-76&#10;&#10;Côte d’Ivoire 7h&#10;Tirage:145&#10;Gagnants: 30-56-05-80-77&#10;Machines: 11-85-40-35-52&#10;Bonus : 67"></textarea></label>
    <div class="admin-result-import-actions">
      <button type="button" class="admin-v3-button admin-v3-button--primary" data-result-import-analyze>Analyser le document</button>
      <span class="admin-v3-status" data-result-import-status role="status"></span>
    </div>
    <div class="admin-result-import-summary" data-result-import-summary>Aucun document analysé.</div>
    <div class="admin-result-import-preview" data-result-import-preview></div>
    <div class="admin-result-import-actions admin-result-import-save-actions">
      <button type="button" class="admin-v3-button admin-v3-button--primary" data-result-import-save disabled>Valider et enregistrer les résultats</button>
    </div>`;

  const state = { rows: [], warnings: [] };
  const status = root.querySelector('[data-result-import-status]');
  const analyzeButton = root.querySelector('[data-result-import-analyze]');
  const saveButton = root.querySelector('[data-result-import-save]');
  const saveScheduleButton = root.querySelector('[data-result-import-save-schedule]');
  const routineStatus = root.querySelector('[data-result-import-routine-status]');
  const selectedCountryCode = () => {
    const selected = root.querySelector('[data-result-import-country]').value;
    return selected === '__custom'
      ? normalizeCountryCode(root.querySelector('[data-result-import-country-custom]')?.value || '')
      : selected;
  };
  const syncCustomCountry = () => {
    const custom = root.querySelector('[data-result-import-country-custom]');
    const isCustom = root.querySelector('[data-result-import-country]').value === '__custom';
    if (custom) {
      custom.hidden = !isCustom;
      custom.required = isCustom;
    }
  };
  const setStatus = (message, kind = '') => {
    status.textContent = message;
    status.className = `admin-v3-status${kind ? ` is-${kind}` : ''}`;
  };
  const updateSaveAvailability = () => {
    const rows = readRows(root);
    saveButton.disabled = !rows.length
      || rows.some((row) => !row.drawDate || !row.drawTime || !row.first.length);
  };
  root.querySelector('[data-result-import-preview]').addEventListener('input', updateSaveAvailability);

  const loadRoutineText = async () => {
    if (typeof loadSchedules !== 'function') return;
    const countryCode = selectedCountryCode();
    try {
      const result = await loadSchedules(countryCode);
      const text = scheduleTextFromRows(result?.schedules || []);
      if (text) root.querySelector('[data-result-import-schedule]').value = text;
    } catch (error) {
      routineStatus.textContent = error?.message || 'Les routines existantes ne peuvent pas être chargées.';
      routineStatus.className = 'admin-v3-status is-error';
    }
  };
  root.querySelector('[data-result-import-country]').addEventListener('change', () => {
    syncCustomCountry();
    void loadRoutineText();
  });
  saveScheduleButton.addEventListener('click', async () => {
    if (typeof saveSchedules !== 'function') {
      routineStatus.textContent = 'La sauvegarde des routines est indisponible.';
      routineStatus.className = 'admin-v3-status is-error';
      return;
    }
    const countryCode = selectedCountryCode();
    const schedules = parseScheduleRows(root.querySelector('[data-result-import-schedule]').value)
      .map((row) => ({
        programName: row.programName,
        dayOfWeek: row.dayOfWeek,
        drawTime: row.drawTime
      }));
    if (!schedules.length) {
      routineStatus.textContent = 'Ajoutez au moins une routine valide.';
      routineStatus.className = 'admin-v3-status is-error';
      return;
    }
    saveScheduleButton.disabled = true;
    routineStatus.textContent = 'Enregistrement des routines…';
    routineStatus.className = 'admin-v3-status';
    try {
      const result = await saveSchedules(countryCode, schedules);
      routineStatus.textContent = result?.message || 'Routines enregistrées.';
      routineStatus.className = 'admin-v3-status is-success';
    } catch (error) {
      routineStatus.textContent = error?.message || 'Les routines n’ont pas été enregistrées.';
      routineStatus.className = 'admin-v3-status is-error';
    } finally {
      saveScheduleButton.disabled = false;
    }
  });

  analyzeButton.addEventListener('click', async () => {
    const file = root.querySelector('[data-result-import-file]').files?.[0] || null;
    const pasted = root.querySelector('[data-result-import-text]').value || '';
    if (!file && !pasted.trim()) {
      setStatus('Ajoutez une image/PDF ou collez le texte des résultats.', 'error');
      return;
    }
    analyzeButton.disabled = true;
    saveButton.disabled = true;
    setStatus('Lecture et analyse en cours…');
    try {
      const country = selectedCountryCode();
      const countryName = COUNTRIES.find(([code]) => code === country)?.[1] || country;
      const fallbackDate = root.querySelector('[data-result-import-date]').value;
      const source = file ? await readInputFile(file) : { images: [], text: pasted };
      const payload = await analyzeWithModel({
        countryCode: country,
        countryName,
        fallbackDate,
        text: `${source.text}\n${pasted}`.trim(),
        images: source.images
      });
      const normalized = normalizeDraft(payload, {
        fallbackDate,
        scheduleText: root.querySelector('[data-result-import-schedule]').value
      });
      state.rows = normalized.rows;
      state.warnings = normalized.warnings;
      renderPreview(root, state);
      setStatus(
        `${state.rows.length} tirage(s) analysé(s). Relisez chaque ligne avant validation.`,
        state.rows.length ? 'success' : 'error'
      );
    } catch (error) {
      state.rows = [];
      state.warnings = [];
      renderPreview(root, state);
      setStatus(error?.message || 'Analyse impossible.', 'error');
    } finally {
      analyzeButton.disabled = false;
    }
  });

  saveButton.addEventListener('click', async () => {
    const countryCode = selectedCountryCode();
    const draws = readRows(root);
    if (!draws.length || draws.some((row) => !row.drawDate || !row.drawTime || !row.first.length)) {
      setStatus('Chaque ligne doit contenir une date, une heure et les numéros gagnants.', 'error');
      return;
    }
    saveButton.disabled = true;
    setStatus('Enregistrement sécurisé en cours…');
    try {
      const result = await onSave({
        countryCode,
        draws,
        source: 'admin-import-document'
      });
      setStatus(result?.message || `${draws.length} résultat(s) enregistré(s).`, 'success');
      root.querySelector('[data-result-import-preview]').replaceChildren();
      root.querySelector('[data-result-import-summary]').textContent = 'Import validé.';
      state.rows = [];
    } catch (error) {
      setStatus(error?.message || 'Les résultats n’ont pas été enregistrés.', 'error');
      saveButton.disabled = false;
    }
  });

  syncCustomCountry();
  void loadRoutineText();
  return root;
}
