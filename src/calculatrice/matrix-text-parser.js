/*
 * Parser and formatter for pasted Cidmap programmes.
 *
 * Input is the vertical format produced by the publications. Output is a
 * compact, database-friendly text format with one line per data group.
 */

(() => {
  const SECTION_LABELS = {
    matrice: 'matrix',
    clavier: 'keyboard',
    cerveau: 'brain'
  };

  const normalizeLabel = (value) => String(value || '')
    .trim()
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const isDate = (line) => /^\d{2}-\d{2}-\d{4}$/.test(line);
  const isTriplet = (line) => /^\d{3}$/.test(line);
  const isEndMarker = (line) => normalizeLabel(line) === 'cidmap' || normalizeLabel(line) === 'cidgroup';

  const splitBlocks = (text) => {
    const lines = String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim());

    const blocks = [];
    let current = [];
    lines.forEach((line) => {
      if (isEndMarker(line)) {
        if (current.some(Boolean)) blocks.push(current);
        current = [];
        return;
      }
      if (line) current.push(line);
    });
    if (current.some(Boolean)) blocks.push(current);
    return blocks;
  };

  const parseBlock = (lines, index) => {
    const dateIndex = lines.findIndex(isDate);
    const errors = [];
    const hasDate = dateIndex >= 0;
    const name = hasDate
      ? lines.slice(0, dateIndex).filter(Boolean).pop() || `Tirage ${index + 1}`
      : 'Matrice manuelle';
    const record = {
      name,
      date: hasDate ? lines[dateIndex] : '',
      matrix: [],
      keyboard: [],
      brain: [],
      code: '',
      event: ''
    };
    let section = hasDate ? null : 'matrix';

    lines.slice(hasDate ? dateIndex + 1 : 0).forEach((line) => {
      const normalized = normalizeLabel(line).replace(/\s+/g, ' ');
      if (SECTION_LABELS[normalized]) {
        section = SECTION_LABELS[normalized];
        return;
      }

      const codeMatch = line.match(/^code\s*:?\s*(\S+)/i);
      if (codeMatch) {
        record.code = codeMatch[1];
        section = null;
        return;
      }

      const eventMatch = line.match(/^(?:event|évent|evenement|événement)\s*:?\s*(\S+)/i);
      if (eventMatch) {
        record.event = eventMatch[1];
        section = null;
        return;
      }

      if (isEndMarker(line)) {
        section = null;
        return;
      }

      if (section && isTriplet(line) && record[section].length < 4) {
        record[section].push(line);
      }
    });

    if (record.matrix.length === 0) errors.push(`Bloc ${index + 1} : matrice absente.`);
    if (record.matrix.length > 0 && record.matrix.length !== 4) {
      errors.push(`Bloc ${index + 1} : matrice incomplète (${record.matrix.length}/4).`);
    }
    return { record, errors };
  };

  const formatRecord = (record) => {
    const lines = [
      record.name,
      record.date,
      `Matrice: ${record.matrix.join(', ')}`
    ];
    if (record.keyboard.length) lines.push(`Clavier: ${record.keyboard.join(', ')}`);
    if (record.brain.length) lines.push(`Cerveau: ${record.brain.join(', ')}`);
    lines.push(`Code: ${record.code}`, `Event: ${record.event}`);
    return lines.join('\n');
  };

  const parseMatrixProgramme = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return { records: [], output: '', errors: [] };

    const parsed = splitBlocks(raw).map(parseBlock);
    const records = parsed.map((item) => item.record).filter(Boolean);
    const errors = parsed.flatMap((item) => item.errors);
    return {
      records,
      errors,
      output: records.map(formatRecord).join('\n\n')
    };
  };

  window.parseMatrixProgramme = parseMatrixProgramme;
  window.formatMatrixProgramme = (text) => parseMatrixProgramme(text).output;
})();
