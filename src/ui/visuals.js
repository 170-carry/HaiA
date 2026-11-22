const paths = {
  groups:'M3 4h7v6H3z M14 4h7v6h-7z M3 14h7v6H3z M14 14h7v6h-7z',
  close:'M6 6l12 12 M18 6L6 18',
  gear:'M9 3h6l.6 2.6 2 .9 2.2-.6 2 3.6-1.7 1.8v2.3l1.7 1.8-2 3.6-2.4-.6-1.8.8L15 22H9l-.6-2.8-2-.8-2.3.6-2-3.6L4 13.6v-2.3L2.2 9.5l2-3.6 2.3.6 2-.9z M15.5 12.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
  refresh:'M20 4v6h-6 M20 10a8 8 0 1 0-.5 6',trash:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  lock:'M6 10h12v10H6z M8 10V7a4 4 0 0 1 8 0v3 M12 14v2',
  translate:'M2 5h12 M8 2v3 M11 6c-1 5-4 8-9 10 M4 8c1 3 4 6 7 7 M13 21l4-11 5 11 M15 17h5',
  smile:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M7 14q5 6 10 0 M8 8.5v1 M16 8.5v1',
  clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 6v6l4 2',failed:'M12 6v7 M12 17v1 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  singleCheck:'M4 12l5 5L21 5',doubleCheck:'M1 12l5 5L17 6 M10 14l3 3L23 7',
  brand:'M3 8l9-5 9 5-9 5z M3 13l9 5 9-5 M3 17l9 5 9-5',
  inbox:'M4 6h16l2 11v2H2v-2z M3 14h5l2 3h4l2-3h5',
  panel:'M3 4h18v16H3z M9 4v16', workspace:'M3 4h7v7H3z M14 4h7v7h-7z M3 15h7v6H3z M14 15h7v6h-7z',
  search:'M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', plus:'M12 5v14M5 12h14',
  chevron:'M9 6l6 6-6 6', more:'M4 12h1 M11 12h1 M18 12h1', back:'M15 5l-7 7 7 7',
  chat:'M4 4h16v13H9l-5 4z M8 9h8 M8 12h5', person:'M15.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0 M4 20v-2a8 6 0 0 1 16 0v2',
  scan:'M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M3 12h18',
  clip:'M21 11l-9 9a5.5 5.5 0 0 1-8-8l9-9a3.7 3.7 0 0 1 5.3 5.3l-9 9a1.9 1.9 0 0 1-2.7-2.7l8-8',file:'M6 3h8l5 5v13H6z M14 3v5h5',play:'M7 4l13 8-13 8z',
  download:'M12 4v11 M7 11l5 5 5-5 M5 20h14',copy:'M9 9h11v11H9z M5 15V4h11',edit:'M4 20h4L20 8l-4-4L4 16z M14 6l4 4',
  bell:'M6 16V11a6 6 0 0 1 12 0v5l2 2H4z M10 21h4',pin:'M9 3h6l-1 6 4 4H6l4-4z M12 13v8',block:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M5.6 5.6l12.8 12.8',archive:'M3 5h18v4H3z M5 9v11h14V9 M10 13h4',
  mute:'M6 16V11a6 6 0 0 1 9-5 M18 11v5l2 2H8 M10 21h4 M4 4l16 16',
  star:'M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z',poll:'M5 20V10 M12 20V4 M19 20v-7',phone:'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',video:'M3 6h12v12H3z M15 10l6-3v10l-6-3',status:'M12 3a9 9 0 1 1-8.5 6 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  wave:'M4 10v4 M8 6v12 M12 3v18 M16 7v10 M20 10v4',pulse:'M3 12h4l2-6 4 12 2-6h6',mic:'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M6 11a6 6 0 0 0 12 0 M12 17v4',forward:'M14 5l6 5-6 5 M20 10h-9c-4 0-7 2-7 7',
  send:'M3 10l18-7-6 18-4-7z M11 14l10-11',reply:'M10 5l-6 5 6 5 M4 10h9c4 0 7 2 7 7'
};
function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg'), p = document.createElementNS(ns,'path');
  svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true'); p.setAttribute('d', paths[name]);
  svg.append(p); return svg;
}
for (const node of document.querySelectorAll('[data-icon]')) node.append(icon(node.dataset.icon));
const colors = ['iris','teal','clay','plum','ocean','olive'];
function tone(key) {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return colors[hash % colors.length];
}
// Assign repeated hues only after every available hue has been used.
function accountTones(accounts) {
  const selected = new Map(), used = new Set();
  for (const {id} of accounts) {
    if (used.size === colors.length) used.clear();
    const preferred = tone(id);
    const color = used.has(preferred) ? colors.find(c=>!used.has(c)) : preferred;
    selected.set(id, color);
    used.add(color);
  }
  return selected;
}
function el(tag, cls, text) {
  const n = document.createElement(tag); if (cls) n.className = cls;
  if (text) n.textContent = text; return n;
}
function avatar(title,key,accountId,who = key) {
  const node = el('span','avatar '+tone(key));
  node.title = title;
  node.append(avatarPhotos.face(accountId,who));
  return node;
}
