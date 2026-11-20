/*
 * Lightweight international dial-code selector.
 * The input remains a normal telephone field; the enhancement only adds
 * instant country recognition and never blocks an unknown valid prefix.
 */
(function installInternationalPhone() {
  'use strict';

  const COUNTRIES = Object.freeze([
    ['+1', 'États-Unis / Canada'], ['+20', 'Égypte'], ['+27', 'Afrique du Sud'],
    ['+30', 'Grèce'], ['+33', 'France'], ['+34', 'Espagne'], ['+39', 'Italie'],
    ['+44', 'Royaume-Uni'], ['+49', 'Allemagne'], ['+55', 'Brésil'],
    ['+81', 'Japon'], ['+86', 'Chine'], ['+91', 'Inde'], ['+212', 'Maroc'],
    ['+213', 'Algérie'], ['+216', 'Tunisie'], ['+221', 'Sénégal'],
    ['+225', "Côte d'Ivoire"], ['+228', 'Togo'], ['+229', 'Bénin'],
    ['+230', 'Maurice'], ['+231', 'Liberia'], ['+232', 'Sierra Leone'],
    ['+233', 'Ghana'], ['+234', 'Nigeria'], ['+237', 'Cameroun'],
    ['+238', 'Cap-Vert'], ['+239', 'Sao Tomé-et-Principe'], ['+240', 'Guinée équatoriale'],
    ['+241', 'Gabon'], ['+242', 'Congo'], ['+243', 'RDC'], ['+244', 'Angola'],
    ['+245', 'Guinée-Bissau'], ['+248', 'Seychelles'], ['+249', 'Soudan'],
    ['+250', 'Rwanda'], ['+251', 'Éthiopie'], ['+252', 'Somalie'],
    ['+253', 'Djibouti'], ['+254', 'Kenya'], ['+255', 'Tanzanie'],
    ['+256', 'Ouganda'], ['+257', 'Burundi'], ['+258', 'Mozambique'],
    ['+260', 'Zambie'], ['+261', 'Madagascar'], ['+262', 'La Réunion / Mayotte'],
    ['+263', 'Zimbabwe'], ['+264', 'Namibie'], ['+265', 'Malawi'],
    ['+266', 'Lesotho'], ['+267', 'Botswana'], ['+268', 'Eswatini'],
    ['+269', 'Comores'], ['+290', 'Sainte-Hélène'], ['+291', 'Érythrée'],
    ['+297', 'Aruba'], ['+298', 'Îles Féroé'], ['+299', 'Groenland'],
    ['+350', 'Gibraltar'], ['+351', 'Portugal'], ['+352', 'Luxembourg'],
    ['+353', 'Irlande'], ['+354', 'Islande'], ['+355', 'Albanie'],
    ['+356', 'Malte'], ['+357', 'Chypre'], ['+358', 'Finlande'],
    ['+359', 'Bulgarie'], ['+380', 'Ukraine'], ['+386', 'Slovénie'],
    ['+420', 'Tchéquie'], ['+421', 'Slovaquie'], ['+423', 'Liechtenstein'],
    ['+852', 'Hong Kong'], ['+971', 'Émirats arabes unis'], ['+972', 'Israël'],
    ['+974', 'Qatar'], ['+976', 'Mongolie'], ['+977', 'Népal'],
    ['+992', 'Tadjikistan'], ['+993', 'Turkménistan'], ['+994', 'Azerbaïdjan'],
    ['+995', 'Géorgie'], ['+998', 'Ouzbékistan']
  ]);

  // Keep the profile country machine-readable. The visible phone label still
  // shows the friendly country name, while the profile stores the ISO code
  // used by result metadata and country-specific schedules.
  const ISO_BY_DIAL = Object.freeze({
    '+1': 'US', '+20': 'EG', '+27': 'ZA', '+30': 'GR', '+33': 'FR',
    '+34': 'ES', '+39': 'IT', '+44': 'GB', '+49': 'DE', '+55': 'BR',
    '+81': 'JP', '+86': 'CN', '+91': 'IN', '+212': 'MA', '+213': 'DZ',
    '+216': 'TN', '+221': 'SN', '+225': 'CI', '+228': 'TG', '+229': 'BJ',
    '+230': 'MU', '+231': 'LR', '+232': 'SL', '+233': 'GH', '+234': 'NG',
    '+237': 'CM', '+238': 'CV', '+239': 'ST', '+240': 'GQ', '+241': 'GA',
    '+242': 'CG', '+243': 'CD', '+244': 'AO', '+245': 'GW', '+248': 'SC',
    '+249': 'SD', '+250': 'RW', '+251': 'ET', '+252': 'SO', '+253': 'DJ',
    '+254': 'KE', '+255': 'TZ', '+256': 'UG', '+257': 'BI', '+258': 'MZ',
    '+260': 'ZM', '+261': 'MG', '+262': 'RE', '+263': 'ZW', '+264': 'NA',
    '+265': 'MW', '+266': 'LS', '+267': 'BW', '+268': 'SZ', '+269': 'KM',
    '+290': 'SH', '+291': 'ER', '+297': 'AW', '+298': 'FO', '+299': 'GL',
    '+350': 'GI', '+351': 'PT', '+352': 'LU', '+353': 'IE', '+354': 'IS',
    '+355': 'AL', '+356': 'MT', '+357': 'CY', '+358': 'FI', '+359': 'BG',
    '+380': 'UA', '+386': 'SI', '+420': 'CZ', '+421': 'SK', '+423': 'LI',
    '+852': 'HK', '+971': 'AE', '+972': 'IL', '+974': 'QA', '+976': 'MN',
    '+977': 'NP', '+992': 'TJ', '+993': 'TM', '+994': 'AZ', '+995': 'GE',
    '+998': 'UZ'
  });

  function normalize(value) {
    const raw = String(value || '').trim().replace(/[^\d+]/g, '');
    return raw.startsWith('+') ? raw : raw ? `+${raw}` : '';
  }

  function match(value) {
    const phone = normalize(value);
    return COUNTRIES
      .filter(([prefix]) => phone.startsWith(prefix))
      .sort((left, right) => right[0].length - left[0].length)[0] || null;
  }

  function ensureDatalist() {
    let list = document.getElementById('cidInternationalDialCodes');
    if (!list) {
      list = document.createElement('datalist');
      list.id = 'cidInternationalDialCodes';
      document.body.appendChild(list);
    }
    if (!list.childElementCount) {
      list.innerHTML = COUNTRIES
        .map(([prefix, country]) => `<option value="${prefix}" label="${country}">${prefix} · ${country}</option>`)
        .join('');
    }
    return list;
  }

  function enhance(root, options = {}) {
    const input = root?.querySelector('input[type="tel"]');
    if (!input) return;
    ensureDatalist();
    if (options.value && !input.value) input.value = options.value;
    const countryInput = options.countryInput || root.querySelector('[data-cid-phone-country-input]');
    const label = root.querySelector('[data-cid-phone-country]');
    const update = () => {
      const found = match(input.value);
      if (found) {
        if (countryInput) countryInput.value = ISO_BY_DIAL[found[0]] || found[1];
        if (label) label.textContent = `${found[1]} · ${found[0]}`;
        root.dataset.countryCode = ISO_BY_DIAL[found[0]] || found[0];
      } else {
        if (label) label.textContent = input.value.trim()
          ? 'Indicatif non reconnu'
          : 'Saisissez un indicatif comme +229, +33 ou +1';
        delete root.dataset.countryCode;
      }
    };
    input.addEventListener('input', update);
    update();
  }

  window.cidInternationalPhone = Object.freeze({
    countries: COUNTRIES,
    isoByDial: ISO_BY_DIAL,
    normalize,
    match,
    enhance
  });
})();
