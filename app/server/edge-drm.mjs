// Sec-MS-GEC token for Microsoft Edge TTS (speech.platform.bing.com).
// Port of edge-tts 7.3.1 (edge_tts/drm.py, MIT): the service now requires
// a Sec-MS-GEC token in the WebSocket URL, or the connection is refused
// with no audio. The token is a custom SHA-256 variant + a CS64 digest
// over "<windows ticks, 5-min rounded><trusted client token>".
// All arithmetic is BigInt so the 64-bit steps match Python exactly;
// tokens are verified against the Python library in edge-drm.test.mjs.
export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
export const SEC_MS_GEC_VERSION = '2-143.0.3650.75';
export const EDGE_WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
export const EDGE_WS_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
export const EDGE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

const SHA256_INITIAL = [0x6a09e667n, 0xbb67ae85n, 0x3c6ef372n, 0xa54ff53an, 0x510e527fn, 0x9b05688cn, 0x1f83d9abn, 0x5be0cd19n];
const SHA256_STATE = [0xfd9fbea2n, 0x91243ce7n, 0xbe499094n, 0xcd2e1e0an, 0x6c006f49n, 0x4bd35abn, 0xfeb0a7e4n, 0x3effbd2n];
const SHA256_SCHEDULE = [0xeb24bf9en, 0x1558691fn, 0xa0c09ee2n, 0xcfa32ban, 0xa622ee8cn, 0xd1dd9491n, 0xc0dd25a0n, 0xf9e70ab6n, 0xf0c31573n, 0x7058ce4en, 0x7188e606n, 0xe5ab33n, 0xd258b060n, 0x72766564n];
const SHA256_ROUND_CONSTANTS = [0x428a2f98n, 0x71374491n, 0xb5c0fbcfn, 0xe9b5dba5n, 0x3956c25bn, 0x59f111f1n, 0x923f82a4n, 0xab1c5ed5n, 0xd807aa98n, 0x12835b01n, 0x243185ben, 0x550c7dc3n, 0x72be5d74n, 0x80deb1fen, 0x9bdc06a7n, 0xc19bf174n, 0xe49b69c1n, 0xefbe4786n, 0xfc19dc6n, 0x240ca1ccn, 0x2de92c6fn, 0x4a7484aan, 0x5cb0a9dcn, 0x76f988dan, 0x983e5152n, 0xa831c66dn, 0xb00327c8n, 0xbf597fc7n, 0xc6e00bf3n, 0xd5a79147n, 0x6ca6351n, 0x14292967n, 0x27b70a85n, 0x2e1b2138n, 0x4d2c6dfcn, 0x53380d13n, 0x650a7354n, 0x766a0abbn, 0x81c2c92en, 0x92722c85n, 0xa2bfe8a1n, 0xa81a664bn, 0xc24b8b70n, 0xc76c51a3n, 0xd192e819n, 0xd6990624n, 0xf40e3585n, 0x106aa070n, 0x19a4c116n, 0x1e376c08n, 0x2748774cn, 0x34b0bcb5n, 0x391c0cb3n, 0x4ed8aa4an, 0x5b9cca4fn, 0x682e6ff3n, 0x748f82een, 0x78a5636fn, 0x84c87814n, 0x8cc70208n, 0x90befffan, 0xa4506cebn, 0xbef9a3f7n, 0xc67178f2n];
const SHA256_ADJUSTMENT = 0xc9dc06a7n;
const SHA256_SIGMA0_ADJUSTMENT = 0x59c0b80n;
const SHA256_SIGMA1_ADJUSTMENT = 0xb92c0n;
const SHA256_BLOCK_CONSTANTS = [...SHA256_ROUND_CONSTANTS.slice(0, 14), SHA256_ADJUSTMENT, ...SHA256_ROUND_CONSTANTS.slice(15)];
const CS64_COEFFICIENTS = [[0xe82e91b1n, 0xb32700d0n], [0x44de24c6n, 0x88dff51dn], [0x3beb65bcn, 0x29514038n], [0xc89c5933n, 0xb328cbdfn], [0x8d1ec211n, 0xd405b4d5n], [0x314ef5d5n, 0x26e55f3cn], [0xe92491b1n, 0x607801c6n], [0xf0a5b9d5n, 0x82b2c1fbn], [0x6064cf3n, 0xfa51a3dan], [0xda79fa60n, 0x207cc464n], [0xbed20560n, 0x3c3c74f3n], [0x89f9c9f8n, 0xd2d14b61n], [0x35fa38c6n, 0xbb04a2c1n], [0xcb49e3c6n, 0xc5626167n]];
const CS64_FACTOR = 0x82893933n;
const CS64_ADJUSTMENT0 = 0xf2f90b1an;
const CS64_ADJUSTMENT1 = 0xb1a0000n;
const WIN_EPOCH = 0x2b6109100;

const M = 0xFFFFFFFFn;

const rol16 = v => (((v & M) << 16n) | ((v & M) >> 16n)) & M;
const sigma0 = v => (((v >> 7n) ^ (v << 25n) ^ (v >> 18n) ^ (v << 14n) ^ (v >> 3n)) & M);
const sigma1 = v => (((v >> 17n) ^ (v << 15n) ^ (v >> 19n) ^ (v << 13n) ^ (v >> 10n)) & M);

// One SHA-256 round (the library unrolls 8 at a time with rotated roles;
// eight sequential rounds are the same maths).
function sha256Round(a, b, c, d, e, f, g, h, k, w) {
  const rotE = e * 0x100000001n;
  const rotA = a * 0x100000001n;
  const t1 = h + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (g ^ (e & (f ^ g))) + k + w;
  const t2 = ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((a & b) | (c & (a | b)));
  return [(t1 + t2) & M, a, b, c, (d + t1) & M, e, f, g];
}

function sha256Rounds(state, words, firstRound = 0) {
  let [a, b, c, d, e, f, g, h] = state;
  const K = firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  for (let i = firstRound; i < 64; i++) [a, b, c, d, e, f, g, h] = sha256Round(a, b, c, d, e, f, g, h, K[i], words[i]);
  return [a, b, c, d, e, f, g, h];
}

function expandSchedule(words, firstWord = 16) {
  for (let i = firstWord; i < 64; i++) {
    const x = words[i - 2], y = words[i - 15];
    const s1 = (x >> 17n) ^ (x << 15n) ^ (x >> 19n) ^ (x << 13n) ^ (x >> 10n);
    const s0 = (y >> 7n) ^ (y << 25n) ^ (y >> 18n) ^ (y << 14n) ^ (y >> 3n);
    words.push((s1 + words[i - 7] + s0 + words[i - 16]) & M);
  }
}

function sha256Init(data) { // data: Uint8Array, exactly the first 7 bytes
  const words = new Array(14).fill(0n);
  words.push((BigInt(data[0]) << 16n) | (BigInt(data[1]) << 8n) | BigInt(data[2]));
  words.push((BigInt(data[3]) << 24n) | (BigInt(data[4]) << 16n) | (BigInt(data[5]) << 8n) | BigInt(data[6]));
  for (let index = 16; index < 30; index++) {
    let value = SHA256_SCHEDULE[index - 16];
    if (index - 2 >= 14) value += index === 16 ? (sigma1(words[index - 2]) ^ SHA256_SIGMA1_ADJUSTMENT) : sigma1(words[index - 2]);
    if (index - 7 >= 14) value += words[index - 7];
    if (index - 15 >= 14) value += index === 29 ? (sigma0(words[index - 15]) ^ SHA256_SIGMA0_ADJUSTMENT) : sigma0(words[index - 15]);
    words.push(value & M);
  }
  words.push((sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + SHA256_ADJUSTMENT - SHA256_ROUND_CONSTANTS[14]) & M);
  expandSchedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((x, i) => (x + working[i]) & M);
}

function sha256Digest(data) { // data: Uint8Array, returns 32-byte digest
  if (data.length < 7) throw new Error('Token salt must contain at least seven bytes');
  const length = 57 + data.length;
  const padZeros = ((55 - length) % 64 + 64) % 64;
  const paddedLen = (data.length - 7) + 1 + padZeros + 8;
  const padded = new Uint8Array(paddedLen);
  padded.set(data.subarray(7), 0);
  padded[data.length - 7] = 0x80;
  new DataView(padded.buffer).setBigUint64(paddedLen - 8, BigInt(length) * 8n, false);
  let state = sha256Init(data.subarray(0, 7));
  for (let off = 0; off < paddedLen; off += 64) {
    const words = [];
    for (let i = 0; i < 16; i++) words.push(BigInt(new DataView(padded.buffer).getUint32(off + i * 4, false)));
    expandSchedule(words);
    const working = sha256Rounds(state, words);
    state = state.map((x, i) => (x + working[i]) & M);
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  state.forEach((x, i) => outView.setUint32(i * 4, Number(x), false));
  return out;
}

function wordsLe4Even(data) {
  const padded = new Uint8Array(Math.ceil(data.length / 4) * 4);
  padded.set(data);
  if (!padded.length) return [];
  const words = [];
  const view = new DataView(padded.buffer);
  for (let i = 0; i < padded.length; i += 4) words.push(BigInt(view.getUint32(i, true)));
  if (words.length % 2) words.push(0n);
  return words;
}

function cs64Digest(data, digest) { // digest: 32-byte Uint8Array
  const dv = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const keyA = BigInt(dv.getUint32(0, true)) | 1n;
  const keyB = BigInt(dv.getUint32(4, true)) | 1n;
  const factors = [(keyA * CS64_FACTOR) & M, (keyB * CS64_FACTOR) & M];
  const terms = CS64_COEFFICIENTS.map(([coef], i) => (coef * factors[i % 2]) & M);
  const offsets = CS64_COEFFICIENTS.map(([, off]) => off);
  for (const [index, word] of wordsLe4Even(new Uint8Array([0, ...data])).entries()) {
    let term = word * (index % 2 === 0 ? keyA : keyB);
    let offset = rol16(word) * (index % 2 === 0 ? 0xEF0569FBn : 0xC31713DBn);
    if (index === 0) { term += CS64_ADJUSTMENT0 * factors[0]; offset += CS64_ADJUSTMENT1; }
    terms.push(term & M);
    offsets.push(offset & M);
  }
  let swapAcc = 0n, swapLast = 0n, state = 0n, acc = 0n;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index], y = terms[index + 1];
    let t = rol16((offsets[index] + x) & M);
    let q = (t * 0x76F50F34n) & M;
    swapAcc += (rol16(q) * 0xC3EFEA97n + q) & M;
    t = rol16((offsets[index + 1] + y) & M);
    q = (t * 0x1881CE3Cn) & M;
    swapLast = (rol16(q) * 0x35BD1EC9n + q) & M;
    swapAcc = (swapAcc + swapLast) & M;
    state = (state * keyA + x) & M;
    state = (rol16(state) * 0xCF98B111n) & M;
    state = (rol16(state) * 0x87085B9Fn) & M;
    state = (rol16(state) * 0x12CEB96Dn) & M;
    state = (rol16(state) * 0x257E1D83n) & M;
    acc += state;
    t = (state * keyB + y) & M;
    t = (rol16(t) * 0xA27416F5n) & M;
    t = (rol16(t) * 0xD38396FFn) & M;
    state = (rol16((rol16(t) * 0x7C932B89n) & M) * 0xBFA49F69n) & M;
    acc = (acc + state) & M;
  }
  return [swapLast ^ state, swapAcc ^ acc];
}

const hexOf = bytes => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();

// The v2 token: "<16 hex>-<64 hex>", same as edge_tts.drm.generate_sec_ms_gec_v2.
export function generateSecMsGec(unixSeconds = Date.now() / 1000) {
  let ticks = BigInt(Math.floor(unixSeconds)) + BigInt(WIN_EPOCH);
  ticks -= ticks % 300n; // round down to the nearest 5 minutes
  ticks *= 10000000n; // Windows file time: 100-ns units
  const data = new TextEncoder().encode(ticks.toString() + TRUSTED_CLIENT_TOKEN);
  const digest = sha256Digest(data);
  const [a, b] = cs64Digest(data, digest);
  const cs = new Uint8Array(8);
  const cv = new DataView(cs.buffer);
  cv.setUint32(0, Number(a), true);
  cv.setUint32(4, Number(b), true);
  return `${hexOf(cs)}-${hexOf(digest)}`;
}
