// Sprint 57. Country dialling codes for the phone-number pickers.
//
// Why this file exists rather than a package: the whole need is "name, code,
// flag" for a dropdown. intl-tel-input ships ~100KB plus flag sprites and CSS
// onto the PUBLIC sign-up page, which has to load fast on a phone at a counter.
// This is a few KB and no images — the flag is derived from the ISO code, not
// stored, so there is no third column to drift out of sync.
//
// The list is deliberately dial-code-per-country, not exhaustive-per-territory:
// this picks a prefix for a phone number, it is not a geography reference.

export type Country = { iso: string; name: string; dial: string };

// [ISO 3166-1 alpha-2, display name, dialling code without "+"]
const RAW: [string, string, string][] = [
  ["AF", "Afghanistan", "93"],
  ["AL", "Albania", "355"],
  ["DZ", "Algeria", "213"],
  ["AD", "Andorra", "376"],
  ["AO", "Angola", "244"],
  ["AG", "Antigua and Barbuda", "1268"],
  ["AR", "Argentina", "54"],
  ["AM", "Armenia", "374"],
  ["AU", "Australia", "61"],
  ["AT", "Austria", "43"],
  ["AZ", "Azerbaijan", "994"],
  ["BS", "Bahamas", "1242"],
  ["BH", "Bahrain", "973"],
  ["BD", "Bangladesh", "880"],
  ["BB", "Barbados", "1246"],
  ["BY", "Belarus", "375"],
  ["BE", "Belgium", "32"],
  ["BZ", "Belize", "501"],
  ["BJ", "Benin", "229"],
  ["BT", "Bhutan", "975"],
  ["BO", "Bolivia", "591"],
  ["BA", "Bosnia and Herzegovina", "387"],
  ["BW", "Botswana", "267"],
  ["BR", "Brazil", "55"],
  ["BN", "Brunei", "673"],
  ["BG", "Bulgaria", "359"],
  ["BF", "Burkina Faso", "226"],
  ["BI", "Burundi", "257"],
  ["KH", "Cambodia", "855"],
  ["CM", "Cameroon", "237"],
  ["CA", "Canada", "1"],
  ["CV", "Cape Verde", "238"],
  ["CF", "Central African Republic", "236"],
  ["TD", "Chad", "235"],
  ["CL", "Chile", "56"],
  ["CN", "China", "86"],
  ["CO", "Colombia", "57"],
  ["KM", "Comoros", "269"],
  ["CG", "Congo", "242"],
  ["CD", "Congo (DRC)", "243"],
  ["CR", "Costa Rica", "506"],
  ["CI", "Côte d'Ivoire", "225"],
  ["HR", "Croatia", "385"],
  ["CU", "Cuba", "53"],
  ["CY", "Cyprus", "357"],
  ["CZ", "Czechia", "420"],
  ["DK", "Denmark", "45"],
  ["DJ", "Djibouti", "253"],
  ["DM", "Dominica", "1767"],
  ["DO", "Dominican Republic", "1809"],
  ["EC", "Ecuador", "593"],
  ["EG", "Egypt", "20"],
  ["SV", "El Salvador", "503"],
  ["GQ", "Equatorial Guinea", "240"],
  ["ER", "Eritrea", "291"],
  ["EE", "Estonia", "372"],
  ["SZ", "Eswatini", "268"],
  ["ET", "Ethiopia", "251"],
  ["FJ", "Fiji", "679"],
  ["FI", "Finland", "358"],
  ["FR", "France", "33"],
  ["GA", "Gabon", "241"],
  ["GM", "Gambia", "220"],
  ["GE", "Georgia", "995"],
  ["DE", "Germany", "49"],
  ["GH", "Ghana", "233"],
  ["GR", "Greece", "30"],
  ["GD", "Grenada", "1473"],
  ["GT", "Guatemala", "502"],
  ["GN", "Guinea", "224"],
  ["GW", "Guinea-Bissau", "245"],
  ["GY", "Guyana", "592"],
  ["HT", "Haiti", "509"],
  ["HN", "Honduras", "504"],
  ["HK", "Hong Kong", "852"],
  ["HU", "Hungary", "36"],
  ["IS", "Iceland", "354"],
  ["IN", "India", "91"],
  ["ID", "Indonesia", "62"],
  ["IR", "Iran", "98"],
  ["IQ", "Iraq", "964"],
  ["IE", "Ireland", "353"],
  ["IL", "Israel", "972"],
  ["IT", "Italy", "39"],
  ["JM", "Jamaica", "1876"],
  ["JP", "Japan", "81"],
  ["JO", "Jordan", "962"],
  ["KZ", "Kazakhstan", "7"],
  ["KE", "Kenya", "254"],
  ["KI", "Kiribati", "686"],
  ["KW", "Kuwait", "965"],
  ["KG", "Kyrgyzstan", "996"],
  ["LA", "Laos", "856"],
  ["LV", "Latvia", "371"],
  ["LB", "Lebanon", "961"],
  ["LS", "Lesotho", "266"],
  ["LR", "Liberia", "231"],
  ["LY", "Libya", "218"],
  ["LI", "Liechtenstein", "423"],
  ["LT", "Lithuania", "370"],
  ["LU", "Luxembourg", "352"],
  ["MO", "Macau", "853"],
  ["MG", "Madagascar", "261"],
  ["MW", "Malawi", "265"],
  ["MY", "Malaysia", "60"],
  ["MV", "Maldives", "960"],
  ["ML", "Mali", "223"],
  ["MT", "Malta", "356"],
  ["MH", "Marshall Islands", "692"],
  ["MR", "Mauritania", "222"],
  ["MU", "Mauritius", "230"],
  ["MX", "Mexico", "52"],
  ["FM", "Micronesia", "691"],
  ["MD", "Moldova", "373"],
  ["MC", "Monaco", "377"],
  ["MN", "Mongolia", "976"],
  ["ME", "Montenegro", "382"],
  ["MA", "Morocco", "212"],
  ["MZ", "Mozambique", "258"],
  ["MM", "Myanmar", "95"],
  ["NA", "Namibia", "264"],
  ["NR", "Nauru", "674"],
  ["NP", "Nepal", "977"],
  ["NL", "Netherlands", "31"],
  ["NZ", "New Zealand", "64"],
  ["NI", "Nicaragua", "505"],
  ["NE", "Niger", "227"],
  ["NG", "Nigeria", "234"],
  ["KP", "North Korea", "850"],
  ["MK", "North Macedonia", "389"],
  ["NO", "Norway", "47"],
  ["OM", "Oman", "968"],
  ["PK", "Pakistan", "92"],
  ["PW", "Palau", "680"],
  ["PS", "Palestine", "970"],
  ["PA", "Panama", "507"],
  ["PG", "Papua New Guinea", "675"],
  ["PY", "Paraguay", "595"],
  ["PE", "Peru", "51"],
  ["PH", "Philippines", "63"],
  ["PL", "Poland", "48"],
  ["PT", "Portugal", "351"],
  ["PR", "Puerto Rico", "1787"],
  ["QA", "Qatar", "974"],
  ["RO", "Romania", "40"],
  ["RU", "Russia", "7"],
  ["RW", "Rwanda", "250"],
  ["KN", "Saint Kitts and Nevis", "1869"],
  ["LC", "Saint Lucia", "1758"],
  ["VC", "Saint Vincent and the Grenadines", "1784"],
  ["WS", "Samoa", "685"],
  ["SM", "San Marino", "378"],
  ["ST", "São Tomé and Príncipe", "239"],
  ["SA", "Saudi Arabia", "966"],
  ["SN", "Senegal", "221"],
  ["RS", "Serbia", "381"],
  ["SC", "Seychelles", "248"],
  ["SL", "Sierra Leone", "232"],
  ["SG", "Singapore", "65"],
  ["SK", "Slovakia", "421"],
  ["SI", "Slovenia", "386"],
  ["SB", "Solomon Islands", "677"],
  ["SO", "Somalia", "252"],
  ["ZA", "South Africa", "27"],
  ["KR", "South Korea", "82"],
  ["SS", "South Sudan", "211"],
  ["ES", "Spain", "34"],
  ["LK", "Sri Lanka", "94"],
  ["SD", "Sudan", "249"],
  ["SR", "Suriname", "597"],
  ["SE", "Sweden", "46"],
  ["CH", "Switzerland", "41"],
  ["SY", "Syria", "963"],
  ["TW", "Taiwan", "886"],
  ["TJ", "Tajikistan", "992"],
  ["TZ", "Tanzania", "255"],
  ["TH", "Thailand", "66"],
  ["TL", "Timor-Leste", "670"],
  ["TG", "Togo", "228"],
  ["TO", "Tonga", "676"],
  ["TT", "Trinidad and Tobago", "1868"],
  ["TN", "Tunisia", "216"],
  ["TR", "Türkiye", "90"],
  ["TM", "Turkmenistan", "993"],
  ["TV", "Tuvalu", "688"],
  ["UG", "Uganda", "256"],
  ["UA", "Ukraine", "380"],
  ["AE", "United Arab Emirates", "971"],
  ["GB", "United Kingdom", "44"],
  ["US", "United States", "1"],
  ["UY", "Uruguay", "598"],
  ["UZ", "Uzbekistan", "998"],
  ["VU", "Vanuatu", "678"],
  ["VA", "Vatican City", "379"],
  ["VE", "Venezuela", "58"],
  ["VN", "Vietnam", "84"],
  ["YE", "Yemen", "967"],
  ["ZM", "Zambia", "260"],
  ["ZW", "Zimbabwe", "263"],
];

export const COUNTRIES: Country[] = RAW.map(([iso, name, dial]) => ({ iso, name, dial }));

/**
 * The flag emoji for an ISO 3166-1 alpha-2 code, built from regional indicator
 * symbols (U+1F1E6 is "A").
 *
 * Renders as a real flag on iOS, Android and macOS — which is where customers
 * actually fill the sign-up form. Windows ships no flag glyphs, so Chrome there
 * falls back to the two letters ("SG"). That degradation is the point of using
 * emoji: the fallback is still the country's code, not a broken image box.
 */
export function flagOf(iso: string): string {
  return [...iso.toUpperCase()]
    .map((ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65))
    .join("");
}

// Some dialling codes are shared. Left to list order the winner is whichever
// country happens to sort first, which is how "+1" resolved to Canada rather
// than the United States — an accident, not a decision. Named here instead.
const SHARED: Record<string, string> = {
  "1": "US", // shared with CA and the +1 Caribbean; the Caribbean use 4-digit codes
  "7": "RU", // shared with KZ
};

const BY_DIAL = new Map<string, Country>();
// Longest-first so "+1876" (Jamaica) is not shadowed by "+1".
for (const c of [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)) {
  const claimed = SHARED[c.dial];
  if (claimed && c.iso !== claimed) continue;
  if (!BY_DIAL.has(c.dial)) BY_DIAL.set(c.dial, c);
}

/** The country a stored "+65" belongs to, or null. Accepts with or without "+". */
export function countryForDial(dial: string | null | undefined): Country | null {
  const digits = (dial ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  // Longest prefix first, so a 4-digit code is never shadowed by its 1-digit parent.
  for (let len = Math.min(4, digits.length); len >= 1; len--) {
    const hit = BY_DIAL.get(digits.slice(0, len));
    if (hit && digits.slice(0, len) === digits) return hit;
  }
  return null;
}

/**
 * The longest dialling code that opens `digits`, or null.
 *
 * Needed because a number alone cannot say where its code ends: "+6591234567"
 * splits as 65|91234567, but a greedy 1-4 digit match reads 6591|234567. Only
 * the real code list settles it.
 */
export function dialPrefixOf(digits: string): string | null {
  const d = digits.replace(/[^0-9]/g, "");
  for (let len = Math.min(4, d.length); len >= 1; len--)
    if (BY_DIAL.has(d.slice(0, len))) return d.slice(0, len);
  return null;
}

/** Case- and accent-loose search over name, ISO and dialling code. */
export function searchCountries(query: string): Country[] {
  const q = query.trim().toLowerCase();
  if (!q) return COUNTRIES;
  const bare = q.replace(/^\+/, "");
  return COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.iso.toLowerCase() === q ||
      c.dial.startsWith(bare),
  );
}
