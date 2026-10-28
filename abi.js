// Minimal ABI decoding for the types this page needs. No dependency; runs in the browser and in Node 20.
/** @param {string} hex */
export function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) throw new Error('not valid hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
/** @param {Uint8Array} b */
export function bytesToHex(b) {
  let s = '0x';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}
/** Reads a 32 byte word as a BigInt. @param {Uint8Array} b @param {number} off */
export function word(b, off) {
  if (off + 32 > b.length) throw new Error('ABI data is too short');
  let v = 0n;
  for (let i = 0; i < 32; i++) v = (v << 8n) | BigInt(b[off + i]);
  return v;
}
/** @param {Uint8Array} b @param {number} off */
export function num(b, off) {
  const v = word(b, off);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ABI offset or length is too large');
  return Number(v);
}
/** @param {Uint8Array} b @param {number} off */
export function bytesAt(b, off) {
  const len = num(b, off);
  if (off + 32 + len > b.length) throw new Error('ABI data is too short');
  return b.slice(off + 32, off + 32 + len);
}
const dec = new TextDecoder('utf-8', { fatal: true });
/** @param {Uint8Array} b @param {number} off */
export function stringAt(b, off) {
  return dec.decode(bytesAt(b, off));
}
/** dynamic array of strings at off (relative offsets from off+32). @param {Uint8Array} b @param {number} off */
export function stringArrayAt(b, off) {
  const n = num(b, off);
  const base = off + 32;
  const out = [];
  for (let i = 0; i < n; i++) out.push(stringAt(b, base + num(b, base + i * 32)));
  return out;
}
/** @param {Uint8Array} b @param {number} off */
export function bytes32ArrayAt(b, off) {
  const n = num(b, off);
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = off + 32 + i * 32;
    if (s + 32 > b.length) throw new Error('ABI data is too short');
    out.push(bytesToHex(b.slice(s, s + 32)));
  }
  return out;
}
/** @param {Uint8Array} b @param {number} off */
export function addressAt(b, off) {
  return '0x' + word(b, off).toString(16).padStart(64, '0').slice(24);
}
