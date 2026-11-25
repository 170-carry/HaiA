// A small QR code writer for short texts such as a group invite link (up to 106 bytes, error correction level L).
// Returns the code as rows of booleans, true for a dark square.
(root => {
  // Data and error-correction codewords for versions 1 to 5 at level L; each fits in a single block.
  const sizes = [[19,7],[34,10],[55,15],[80,20],[108,26]];
  const exp = new Uint8Array(512), log = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { exp[i] = x; log[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  const times = (a, b) => a && b ? exp[log[a] + log[b]] : 0;
  function correction(data, count) {
    let generator = [1];
    for (let i = 0; i < count; i++) {
      const next = new Array(generator.length + 1).fill(0);
      for (let j = 0; j < generator.length; j++) { next[j] ^= generator[j]; next[j + 1] ^= times(generator[j], exp[i]); }
      generator = next;
    }
    const rest = new Array(count).fill(0);
    for (const byte of data) {
      const factor = byte ^ rest.shift();
      rest.push(0);
      for (let j = 0; j < count; j++) rest[j] ^= times(generator[j + 1], factor);
    }
    return rest;
  }
  function qrMatrix(text) {
    const bytes = [...new TextEncoder().encode(String(text))];
    const version = sizes.findIndex(([data]) => bytes.length + 2 <= data) + 1;
    if (!version) throw new Error('内容太长，无法生成二维码');
    const [capacity, extra] = sizes[version - 1];
    const bits = [];
    const put = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push(value >> i & 1); };
    put(4, 4); put(bytes.length, 8);
    for (const byte of bytes) put(byte, 8);
    put(0, Math.min(4, capacity * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);
    const words = data.concat(correction(data, extra));
    const size = version * 4 + 17;
    const dark = Array.from({length:size}, () => new Array(size).fill(false));
    const fixed = Array.from({length:size}, () => new Array(size).fill(false));
    const set = (x, y, on) => { if (x >= 0 && y >= 0 && x < size && y < size) { dark[y][x] = on; fixed[y][x] = true; } };
    // The three corner squares with their light border.
    for (const [cx, cy] of [[3,3],[size - 4,3],[3,size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, ring !== 2 && ring !== 4);
      }
    }
    for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
    if (version > 1) {
      const centre = size - 7;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(centre + dx, centre + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    // Format information: level L with mask 0, protected by its own error correction.
    const format = (() => {
      const value = 1 << 3;
      let rest = value;
      for (let i = 0; i < 10; i++) rest = rest << 1 ^ (rest >> 9) * 0x537;
      return (value << 10 | rest) ^ 0x5412;
    })();
    const bit = i => (format >> i & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
    // The message runs in two-column strips from the bottom right, alternating up and down.
    let at = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let step = 0; step < size; step++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j, y = (right + 1 & 2) === 0 ? size - 1 - step : step;
          if (fixed[y][x]) continue;
          const on = at < words.length * 8 && (words[at >> 3] >> 7 - (at & 7) & 1) === 1;
          at++;
          dark[y][x] = on !== ((x + y) % 2 === 0);
        }
      }
    }
    return dark;
  }
  root.qrMatrix = qrMatrix;
  if (typeof module === 'object' && module.exports) module.exports = {qrMatrix};
})(typeof globalThis === 'object' ? globalThis : this);
