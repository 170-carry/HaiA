// Phone numbers copied from messaging apps can contain invisible spacing and direction marks.
function phoneSearchDigits(value) {
  if (typeof value !== 'string') return '';
  const compact = value
    .replace(/[０-９＋（）－]/gu, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u200b-\u200f\u2060\u2066-\u2069()-]/gu, '');
  return /^\+?\d+$/.test(compact) ? compact.replace(/^\+/, '') : '';
}

function normalizePairingPhone(value) {
  const digits = phoneSearchDigits(value);
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : '';
}

function contactPhoneDigits(chatId, phoneNumber, displayNumber) {
  const directPhone = value => /^(\d+)(?::\d+)?@(c\.us|s\.whatsapp\.net)$/.exec(value)?.[1] || '';
  if (!/@(?:lid|c\.us|s\.whatsapp\.net)$/.test(chatId)) return '';
  const raw = phoneNumber?._serialized || phoneNumber?.toString();
  return directPhone(raw) || phoneSearchDigits(raw) || directPhone(chatId) || phoneSearchDigits(displayNumber);
}

function matchesContactQuery(query, digits, phone, names) {
  return names.some(name => typeof name === 'string' && name.toLocaleLowerCase().includes(query)) ||
    Boolean(digits && (phone.includes(digits) || names.some(name => phoneSearchDigits(name).includes(digits))));
}

if (typeof window === 'undefined' && typeof module !== 'undefined') {
  module.exports = { normalizePairingPhone, phoneSearchDigits, contactPhoneDigits, matchesContactQuery };
}
