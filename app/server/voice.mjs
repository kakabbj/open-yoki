// The host's fallback voice: fal MiniMax Speech 2.8 Turbo ($0.06 per 1000 characters, about 5 s per 60-character line).
// Lines are saved under data/audio and served from /audio/. A daily character cap keeps the bill bounded;
// past it, or when fal fails, she keeps talking in text only (each route fails on its own).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import WebSocket from 'ws';
import { EDGE_WSS_URL, EDGE_WS_ORIGIN, EDGE_USER_AGENT, SEC_MS_GEC_VERSION, generateSecMsGec } from './edge-drm.mjs';
import { proxyEnv, connectProxyAgent } from './proxy-agent.mjs';

export const VOICE = { model: 'fal-ai/minimax/speech-2.8-turbo', usdPerChar: 0.00006 };
// fal's default 128 kbps / 32 kHz and no emotion setting: a 64 kbps copy and per-face emotions made the voice sound
// like a different person from line to line.
const AUDIO = { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 };

export function falVoice({ key, dir, dailyChars = 60000, voiceId, speed = 1.05, fetchImpl = fetch, now = () => Date.now(), keepFiles = 300, tries = 2, timeoutMs = 20000, status }) {
  fs.mkdirSync(dir, { recursive: true });
  let day = '', used = 0;
  const today = () => new Date(now() + 8 * 3600e3).toISOString().slice(0, 10);

  async function say(text, face, id) {
    if (today() !== day) { day = today(); used = 0; }
    if (used + text.length > dailyChars) { status?.('voice', false, 'daily cap reached'); return null; }
    const voice_setting = { voice_id: voiceId, speed };
    // fal now and then sits on one request past the timeout (a line goes silent); one retry covers it.
    for (let attempt = 1; ; attempt++) {
      const r = await once(text, voice_setting, id).catch(err => ({ err }));
      if (!r.err) { used += text.length; prune(); status?.('voice', true); return r; }
      if (attempt >= tries) { const why = String(r.err.message || r.err).slice(0, 120); status?.('voice', false, why); console.warn('voice failed: ' + why); return null; }
    }
  }

  async function synth(text, voice_setting, audio_setting) {
    const r = await fetchImpl(`https://fal.run/${VOICE.model}`, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, voice_setting, language_boost: /[一-鿿]/.test(text) ? 'Chinese' : 'English', audio_setting, output_format: 'url' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.audio?.url) throw new Error(`fal ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
    const a = await fetchImpl(j.audio.url, { signal: AbortSignal.timeout(20000) });
    if (!a.ok) throw new Error('audio download ' + a.status);
    return { buf: Buffer.from(await a.arrayBuffer()), durationMs: j.duration_ms || text.length * 220 };
  }
  async function once(text, voice_setting, id) {
    const { buf, durationMs } = await synth(text, voice_setting, AUDIO);
    const file = `${id}.mp3`;
    fs.writeFileSync(path.join(dir, file), buf);
    return { url: `/audio/${file}`, durationMs };
  }

  // Raw 24 kHz mono s16le PCM for the Vidu component avatar (its WebSocket takes exactly this). MiniMax's pcm output
  // at 24 kHz is from its API docs; not yet run through fal.
  async function pcm(text) {
    if (today() !== day) { day = today(); used = 0; }
    if (used + text.length > dailyChars) { status?.('voice', false, 'daily cap reached'); return null; }
    try {
      const { buf } = await synth(text, { voice_id: voiceId, speed }, { format: 'pcm', sample_rate: 24000, channel: 1 });
      used += text.length; status?.('voice', true);
      return buf;
    } catch (err) { status?.('voice', false, String(err.message || err).slice(0, 120)); return null; }
  }

  function prune() {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp3')).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keepFiles)) fs.rmSync(path.join(dir, f), { force: true });
  }

  return { say, pcm, voiceId, get used() { return used; }, dailyChars, get usd() { return used * VOICE.usdPerChar; } };
}

// Doubao (Volcano Engine) speech synthesis 2.0, the main voice: a stock voice or the host's own cloned voice (slot
// DOUBAO_VOICE_ID), with a context sentence for the delivery. 3 RMB per 10k characters; first audio about 0.4 s,
// a 30-character line about 1.4 s. It returns 24 kHz PCM directly, which is what the Vidu component takes.
export const DOUBAO = { resource: 'seed-tts-2.0', rmbPerChar: 0.0003 };
// A cloned voice (a slot id S_…, voice cloning 2.0) is billed and served under its own resource.
export const doubaoResource = voiceId => /^S_/.test(voiceId || '') ? 'seed-icl-2.0' : DOUBAO.resource;

// Her cloned voice reads a line in another language as Chinese-accented gibberish unless the request names the
// language (Korean/Japanese/Spanish/Vietnamese come out garbled; with explicit_language all of ja, ko, es, pt, fr,
// de, ru, th, vi, id read right in her own voice, checked with Whisper). Chinese lines (and English, which reads fine
// either way) keep the plain request.
const SCRIPTS = [['ja', /[\u3040-\u30ff]/], ['ko', /[\uac00-\ud7af\u1100-\u11ff]/], ['ru', /[\u0400-\u04ff]/], ['th', /[\u0e00-\u0e7f]/]];
const LATIN = [
  ['vi', /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉĩọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i, null],
  ['es-mx', /[¿¡ñ]/i, /\b(que|los|las|yo|tú|pero|muy|sigue|toda|noche|está|estoy|también|hola|gracias|porque)\b/gi],
  ['pt-br', /[ãõôê]/i, /\b(eu|você|não|muito|obrigad[oa]|olá|está|também|porque|uma|isso|então)\b/gi],
  ['fr', /[œàèùâîûëç]/i, /\b(je|j'ai|suis|tu|vous|moi|toi|aussi|est|c'est|pas|très|merci|bonjour|oui|avec|pour|mais)\b/gi],
  ['de', /[ßäöü]/i, /\b(ich|du|nicht|und|ist|das|sehr|danke|hallo|auch|aber|mit|ein|eine)\b/gi],
  ['id', null, /\b(aku|kamu|yang|tidak|nggak|gak|sudah|udah|banget|masih|ini|itu|juga|sama|dong|deh|kok|lagi|turun|naik|ya)\b/gi],
];
export function spokenLang(text) {
  const t = String(text || '');
  for (const [code, re] of SCRIPTS) if (re.test(t)) return code;
  if (/[\u3400-\u9fff]/.test(t) || !/[a-z]{2}/i.test(t)) return '';
  let best = '', score = 0;
  for (const [code, mark, words] of LATIN) {
    const hit = mark && mark.test(t), w = words ? (t.match(words) || []).length : 0, n = (hit ? 2 : 0) + w;
    if ((hit || w >= 2) && n > score) { best = code; score = n; }
  }
  return best;
}

// tones: per-line delivery the brain may pick ({ 吐槽: { context, speed } }, from the idol config); an unknown or missing tone reads
// with the voice's own context and speed.
export function doubaoVoice({ key, dir, dailyChars = 60000, voiceId, context = '', dialect = '', speed = 0, tones = {}, fetchImpl = fetch, now = () => Date.now(), keepFiles = 300, tries = 2, timeoutMs = 20000, status }) {
  fs.mkdirSync(dir, { recursive: true });
  const baseContext = context;
  let day = '', used = 0, lastUse = 0;
  const today = () => new Date(now() + 8 * 3600e3).toISOString().slice(0, 10);
  const room = text => { if (today() !== day) { day = today(); used = 0; } return used + text.length <= dailyChars; };

  // One streamed request: newline-separated JSON chunks, each with base64 audio in `data`. Yields each chunk's audio
  // as it arrives (the first comes in ~0.4 s, the whole of a long line only after ~2.4 s); stopping early
  // aborts the request.
  async function* request(text, format, tone) {
    const t = tones[tone] || {};
    const context = t.context ?? baseContext, speech_rate = t.speed ?? speed;
    const req_params = { text, speaker: voiceId, audio_params: { format, sample_rate: 24000, speech_rate } };
    // dialect: Doubao's own dialect mode (explicit_dialect, e.g. 'dongbei'; only some voices take it, see Doubao's docs).
    const lang = spokenLang(text);
    const additions = { ...(context ? { context_texts: [context] } : {}), ...(dialect ? { explicit_dialect: dialect } : {}), ...(lang ? { explicit_language: lang } : {}) };
    if (context) req_params.context_texts = [context];
    if (context || dialect || lang) req_params.additions = JSON.stringify(additions);
    lastUse = now();
    const stop = new AbortController();
    try {
      const r = await fetchImpl('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
        method: 'POST', signal: AbortSignal.any([stop.signal, AbortSignal.timeout(timeoutMs)]),
        headers: { 'X-Api-Key': key, 'X-Api-Resource-Id': doubaoResource(voiceId), 'X-Api-Request-Id': randomUUID(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ req_params }),
      });
      let got = 0;
      for await (const line of lines(r)) {
        if (!line.trim()) continue;
        const j = JSON.parse(line);
        if (j.code && j.code !== 20000000) throw new Error(`doubao ${j.code} ${String(j.message).slice(0, 100)}`);
        if (j.data) { got++; yield Buffer.from(j.data, 'base64'); }
      }
      if (!r.ok || !got) throw new Error(`doubao ${r.status} no audio`);
    } finally { stop.abort(); }
  }
  async function synth(text, format, tone) {
    const parts = [];
    for await (const b of request(text, format, tone)) parts.push(b);
    return Buffer.concat(parts);
  }
  async function retry(text, format, tone) {
    for (let attempt = 1; ; attempt++) {
      try { const buf = await synth(text, format, tone); used += text.length; status?.('voice', true); return buf; }
      catch (err) { if (attempt >= tries) { const why = String(err.message || err).slice(0, 120); status?.('voice', false, why); console.warn('voice failed: ' + why); return null; } }
    }
  }

  async function say(text, face, id, tone) {
    if (!room(text)) { status?.('voice', false, 'daily cap reached'); return null; }
    const buf = await retry(text, 'mp3', tone);
    if (!buf) return null;
    const file = `${id}.mp3`;
    fs.writeFileSync(path.join(dir, file), buf);
    prune();
    return { url: `/audio/${file}`, durationMs: Math.round(buf.length / 8) };   // Doubao mp3 is 64 kbps: 8 bytes per ms
  }
  async function pcm(text, id, tone) {
    if (!room(text)) { status?.('voice', false, 'daily cap reached'); return null; }
    return retry(text, 'pcm', tone);
  }
  // pcm() as it is made, chunk by chunk, so Vidu can start on the first one. Same cap, billing and status; a
  // request that fails before any audio is retried, one that fails midway stops there (no restarting a line she has
  // begun). The line is counted at its first chunk: Doubao has started billing it by then. Yields nothing on failure.
  async function* pcmStream(text, id, tone) {
    if (!room(text)) { status?.('voice', false, 'daily cap reached'); return; }
    for (let attempt = 1; ; attempt++) {
      let started = false;
      try {
        for await (const b of request(text, 'pcm', tone)) {
          if (!started) { started = true; used += text.length; }
          yield b;
        }
        status?.('voice', true);
        return;
      } catch (err) {
        if (!started && attempt < tries) continue;
        const why = String(err.message || err).slice(0, 120);
        status?.('voice', false, why); console.warn('voice failed' + (started ? ' midway: ' : ': ') + why);
        return;
      }
    }
  }
  function prune() {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp3')).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keepFiles)) fs.rmSync(path.join(dir, f), { force: true });
  }

  // A free request to the same host so the open connection never idles out (nothing is synthesized or billed).
  async function warm(idleMs = 40e3) {
    if (now() - lastUse < idleMs) return false;
    lastUse = now();
    try { const r = await fetchImpl('https://openspeech.bytedance.com/', { signal: AbortSignal.timeout(5000) }); await r.arrayBuffer?.(); } catch {}
    return true;
  }
  return { say, pcm, pcmStream, warm, voiceId, tones: Object.keys(tones), provider: 'doubao', get used() { return used; }, dailyChars, get rmb() { return used * DOUBAO.rmbPerChar; } };
}

// Microsoft Edge TTS (the read-aloud service): the same free voice T Review dubs with
// (vi-VN-HoaiMyNeural by default). No key, no account, no billing — the request goes to
// Microsoft over WebSocket and the mp3 comes back 24 kHz / 48 kbps mono. Nothing is kept
// warm between lines: one connection per line, closed at turn.end.
// The service now requires a Sec-MS-GEC token in the URL (edge-tts 7.3.1): without it
// the connection is refused and there is no audio at all. The token is time-based
// (5-minute buckets, see edge-drm.mjs), so the URL is built fresh for every line.
export const EDGE_TTS_URL = EDGE_WSS_URL;
export const EDGE_VOICES = [
  { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My (nữ)' },
  { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh (nam)' },
];
export const edgeVoiceId = id => EDGE_VOICES.some(v => v.id === id) ? id : EDGE_VOICES[0].id;

export function edgeVoice({ dir, voiceId = EDGE_VOICES[0].id, rate = '+0%', pitch = '+0Hz', dailyChars = 1000000, wsImpl = WebSocket, wsUrl = EDGE_TTS_URL, tokenImpl = generateSecMsGec, execImpl = null, timeoutMs = 20000, tries = 2, now = () => Date.now(), keepFiles = 300, status }) {
  fs.mkdirSync(dir, { recursive: true });
  let day = '', used = 0;
  const today = () => new Date(now() + 8 * 3600e3).toISOString().slice(0, 10);
  const room = text => { if (today() !== day) { day = today(); used = 0; } return used + text.length <= dailyChars; };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Same SSML shape as edge-tts (single quotes, xml:lang en-US, the voice name picks the language).
  const ssml = text => `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voiceId}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${esc(text)}</prosody></voice></speak>`;
  // edge-tts date_to_string(): "Sat Nov 21 2026 05:27:49 GMT+0000 (Coordinated Universal Time)", UTC.
  const dateStr = () => {
    const d = new Date();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const p = n => String(n).padStart(2, '0');
    return `${days[d.getUTCDay()]} ${mons[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
  };
  // The real service gets a fresh token + connection id per line; a test fake URL is used as-is.
  const urlFor = () => wsUrl.startsWith(EDGE_WSS_URL)
    ? `${EDGE_WSS_URL}&ConnectionId=${randomUUID().replace(/-/g, '')}&Sec-MS-GEC=${tokenImpl()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`
    : wsUrl;

  // One request: speech.config, then the SSML. Audio arrives as binary frames whose
  // header says Path:audio; Path:turn.end closes the turn. Resolves with the mp3 bytes.
  function synth(text) {
    return new Promise((resolve, reject) => {
      const id = randomUUID().replace(/-/g, '');
      const chunks = [];
      let done = false;
      // No compression: the ws client's permessage-deflate offer is the one
      // handshake parameter that differs from edge-tts (aiohttp compress=15),
      // and the service drops some connections after the handshake (1006).
      // A proxy env var, when set, is honored the way edge-tts does
      // (aiohttp trust_env): without it a machine that must go through a
      // proxy to reach Microsoft gets its direct connection dropped.
      const wsOpts = { perMessageDeflate: false, headers: {
        'User-Agent': EDGE_USER_AGENT,
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Origin': EDGE_WS_ORIGIN,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': `muid=${randomBytes(16).toString('hex').toUpperCase()};`,
      } };
      const proxy = proxyEnv();
      if (proxy && wsUrl.startsWith('wss://')) { try { wsOpts.agent = connectProxyAgent(proxy); } catch {} }
      const ws = new wsImpl(urlFor(), wsOpts);
      const timer = setTimeout(() => fail(new Error('edge tts timeout')), timeoutMs);
      const fail = err => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch {} reject(err); };
      const finish = () => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch {} resolve(Buffer.concat(chunks)); };
      ws.on('open', () => {
        ws.send(`X-Timestamp:${dateStr()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
        ws.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${dateStr()}Z\r\nPath:ssml\r\n\r\n${ssml(text)}`);
      });
      ws.on('message', data => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const sep = buf.indexOf('\r\n\r\n');
        if (sep < 0) return;
        const head = buf.subarray(0, sep).toString('utf8');
        if (/Path:\s*audio/.test(head)) chunks.push(buf.subarray(sep + 4));
        else if (/Path:\s*turn\.end/.test(head)) finish();
      });
      ws.on('error', fail);
      // The close code/reason is the diagnosis: a policy close (1008) means the
      // service refused the request, a handshake refusal arrives as
      // 'unexpected-response' with the HTTP status. Without them every failure
      // looked the same ("closed early") and could not be fixed from outside.
      ws.on('unexpected-response', (req, res) => { if (!done) fail(new Error(`edge tts ${res.statusCode}: ${(res.statusMessage || '').slice(0, 80)}`)); });
      ws.on('close', (code, reason) => { if (!done) fail(new Error(`edge tts closed early (code ${code}${reason ? ': ' + String(reason).slice(0, 80) : ''})`)); });
    });
  }
  // mp3 (48 kbps) to raw 24 kHz mono PCM for the Vidu component avatar, through ffmpeg.
  const decode = execImpl || (buf => new Promise((resolve, reject) => {
    const child = execFile('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => err ? reject(err) : resolve(stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(buf);
  }));
  function prune() {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp3')).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keepFiles)) fs.rmSync(path.join(dir, f), { force: true });
  }
  async function say(text, face, id) {
    if (!room(text)) { status?.('voice', false, 'daily cap reached'); return null; }
    for (let attempt = 1; ; attempt++) {
      try {
        const buf = await synth(text);
        if (!buf.length) throw new Error('edge tts no audio');
        used += text.length; status?.('voice', true);
        const file = `${id}.mp3`;
        fs.writeFileSync(path.join(dir, file), buf);
        prune();
        return { url: `/audio/${file}`, durationMs: Math.round(buf.length / 6) };   // 48 kbps: 6 bytes per ms
      } catch (err) {
        if (attempt >= tries) { const why = String(err.message || err).slice(0, 120); status?.('voice', false, why); console.warn('voice failed: ' + why); return null; }
      }
    }
  }
  async function pcm(text) {
    if (!room(text)) { status?.('voice', false, 'daily cap reached'); return null; }
    for (let attempt = 1; ; attempt++) {
      try {
        const buf = await synth(text);
        if (!buf.length) throw new Error('edge tts no audio');
        const out = await decode(buf);
        used += text.length; status?.('voice', true);
        return out;
      } catch (err) {
        if (attempt >= tries) { const why = String(err.message || err).slice(0, 120); status?.('voice', false, why); console.warn('voice failed: ' + why); return null; }
      }
    }
  }
  async function warm() { return false; }   // nothing to keep alive between lines
  return { say, pcm, warm, voiceId, provider: 'edge', get used() { return used; }, dailyChars };
}

// Google Translate TTS: free, no key, speaks Vietnamese. It is ONLY a fallback
// for when Edge's cloud drops the connection (close 1006 on this network) —
// the room must never go silent just because one provider is unreachable.
// One GET per chunk (the endpoint caps a request near 200 chars); the mp3
// frames are concatenated, which browsers play as one file. Verified live
// 2026-11-21: 200 + valid 64 kbps mp3 for a Vietnamese line.
export const GOOGLE_TTS_URL = 'https://translate.google.com/translate_tts';
export function googleVoice({ dir, googleUrl = GOOGLE_TTS_URL, fetchImpl = fetch, execImpl = null, dailyChars = 1000000, timeoutMs = 15000, now = () => Date.now(), keepFiles = 300, status }) {
  fs.mkdirSync(dir, { recursive: true });
  let day = '', used = 0;
  const today = () => new Date(now() + 8 * 3600e3).toISOString().slice(0, 10);
  const room = text => { if (today() !== day) { day = today(); used = 0; } return used + text.length <= dailyChars; };
  function chunks(text) {
    const parts = [];
    for (const sentence of String(text).split(/(?<=[.!?…:])\s+/)) {
      if (!sentence) continue;
      if (sentence.length <= 180) { parts.push(sentence); continue; }
      let cur = '';
      for (const w of sentence.split(/\s+/)) {
        if ((cur + ' ' + w).trim().length > 180 && cur) { parts.push(cur.trim()); cur = w; }
        else cur = (cur + ' ' + w).trim();
      }
      if (cur) parts.push(cur);
    }
    return parts.length ? parts : [String(text)];
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function fetchChunk(part) {
    // Google throttles this unofficial endpoint in bursts (a 403 for a while,
    // then it works again) — that is why the room sometimes reads and
    // sometimes goes silent. Retry a failed chunk up to five times with growing
    // backoff instead of dropping the whole line on the first refusal: a
    // dropped first chunk is heard as the line starting mid-sentence (v7.9.6).
    for (let attempt = 1; attempt <= 5; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetchImpl(`${googleUrl}?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(part)}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36' }, signal: ctrl.signal });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 100) return buf;
        }
      } catch {} finally { clearTimeout(timer); }
      if (attempt < 5) await sleep(600 * 2 ** (attempt - 1));
    }
    return null;
  }
  async function fetchMp3(text) {
    if (!room(text)) { status?.('voice', false, 'daily cap reached'); return null; }
    const bufs = [];
    let skipped = 0;
    for (const part of chunks(text)) {
      const b = await fetchChunk(part);
      if (!b) { skipped++; continue; }
      bufs.push(b);
    }
    if (!bufs.length) return null;
    // A chunk that still fails after retries is skipped, not fatal: hearing
    // most of the line beats silence, and the subtitle shows the full text.
    if (skipped) console.warn(`voice fallback: google tts skipped ${skipped} chunk(s)`);
    used += text.length;
    return Buffer.concat(bufs);
  }
  function prune() {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp3')).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keepFiles)) fs.rmSync(path.join(dir, f), { force: true });
  }
  async function say(text, face, id) {
    const mp3 = await fetchMp3(text);
    if (!mp3) return null;
    const file = `${id}.mp3`;
    fs.writeFileSync(path.join(dir, file), mp3);
    prune();
    status?.('voice', true);
    console.log('voice fallback: google tts');
    return { url: `/audio/${file}`, durationMs: Math.round(mp3.length / 8) };   // 64 kbps: 8 bytes per ms
  }
  // mp3 to raw 24 kHz mono PCM for the Vidu component avatar, through ffmpeg.
  const decode = execImpl || (buf => new Promise((resolve, reject) => {
    const child = execFile('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => err ? reject(err) : resolve(stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(buf);
  }));
  async function pcm(text) {
    const mp3 = await fetchMp3(text);
    if (!mp3) return null;
    return decode(mp3).catch(() => null);
  }
  return { say, pcm, provider: 'google', get used() { return used; }, dailyChars };
}

// VieNeu: the Vietnamese offline voice T Review uses ("Ngọc Huyền" and the
// other voices in its list). The model runs in T Review's sidecar at
// 127.0.0.1:8771 — this engine only CALLS it, it never installs the model:
// POST /synthesize {text, voice, out_path} writes a wav to out_path on the
// machine. If the sidecar is not running, say() returns null and the caller
// falls back to Google TTS, so the room is never silent because of it.
// Offline means no rate limit and no cloud to drop the connection — the
// durable fix for the "sometimes reads, sometimes not" voice.
export const VIENEU_URL = 'http://127.0.0.1:8771';
export function vieneuVoice({ dir, base = VIENEU_URL, voiceName = 'Ngọc Huyền', fetchImpl = fetch, execImpl = null, timeoutMs = 60000, keepFiles = 300, status }) {
  fs.mkdirSync(dir, { recursive: true });
  let warming = false;
  // Load the model in the background (first load can take minutes); lines use
  // the Google fallback until it is ready. Fire-and-forget, never blocks a line.
  async function warmup() {
    if (warming) return;
    warming = true;
    try {
      const h = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
      if (!h.loaded) await fetchImpl(`${base}/warmup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(120000) }).catch(() => null);
    } catch {} finally { warming = false; }
  }
  function prune(ext) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith(ext)).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keepFiles)) fs.rmSync(path.join(dir, f), { force: true });
  }
  // Duration from the wav header (byteRate at 28, data size at 40); falls
  // back to assuming 24 kHz mono 16-bit when the header is unreadable.
  function wavDurationMs(file, size) {
    try {
      const fd = fs.openSync(file, 'r');
      const head = Buffer.alloc(44);
      fs.readSync(fd, head, 0, 44, 0);
      fs.closeSync(fd);
      const byteRate = head.readUInt32LE(28);
      const dataSize = head.readUInt32LE(40);
      if (byteRate > 0 && dataSize > 0) return Math.round(dataSize / byteRate * 1000);
    } catch {}
    return Math.round((size - 44) / 48);
  }
  async function synth(text, id) {
    const wav = path.resolve(dir, `${id}.wav`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(`${base}/synthesize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: voiceName, out_path: wav }), signal: ctrl.signal });
      if (!r.ok) return null;
      const st = fs.existsSync(wav) ? fs.statSync(wav) : null;
      if (!st || st.size <= 44) return null;
      return { wav, durationMs: wavDurationMs(wav, st.size) };
    } catch { return null; } finally { clearTimeout(timer); }
  }
  async function say(text, face, id) {
    const out = await synth(text, id);
    if (!out) { status?.('voice', false, 'sidecar VieNeu chưa chạy — mở T Review để bật sidecar, hoặc đổi giọng trong Cài đặt'); console.warn('voice failed: vieneu sidecar unreachable'); return null; }
    prune('.wav');
    status?.('voice', true);
    return { url: `/audio/${id}.wav`, durationMs: out.durationMs };
  }
  // wav to raw 24 kHz mono PCM for the Vidu component avatar, through ffmpeg.
  const decode = execImpl || (buf => new Promise((resolve, reject) => {
    const child = execFile('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => err ? reject(err) : resolve(stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(buf);
  }));
  async function pcm(text, id) {
    const out = await synth(text, id || 'vieneu-pcm');
    if (!out) return null;
    return decode(fs.readFileSync(out.wav)).catch(() => null);
  }
  return { say, pcm, warmup, provider: 'vieneu', voiceName, get used() { return 0; }, dailyChars: 1000000 };
}

// A fetch response's body line by line as it arrives; a response without a readable body is read whole.
async function* lines(r) {
  if (!r.body) { yield* (await r.text()).split('\n'); return; }
  const dec = new TextDecoder();
  let rest = '';
  for await (const b of r.body) {
    rest += dec.decode(b, { stream: true });
    const ls = rest.split('\n');
    rest = ls.pop();
    yield* ls;
  }
  yield rest + dec.decode();
}

// Two voices (optional, idol.avatar.doubaoOff): a host with an on-stage persona may now and then slip into her
// "real self" in a second voice. A slip is marked in the line as {东北}…{/东北} (the marker name is historical; any
// second voice works); this voice reads each part with its own voice and joins them (mp3 for the page, 24 kHz PCM
// for Vidu).
export const SLIP_RE = /\{东北\}([\s\S]*?)\{\/东北\}/g;
export function splitSlip(text) {
  const parts = [];
  let at = 0;
  for (const m of String(text).matchAll(SLIP_RE)) {
    if (m.index > at) parts.push({ off: false, text: text.slice(at, m.index) });
    parts.push({ off: true, text: m[1] });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ off: false, text: text.slice(at) });
  return parts.map(p => ({ ...p, text: p.text.trim() })).filter(p => p.text);
}
export const plainText = text => String(text).replace(SLIP_RE, '$1').replace(/[\[【][^\]】]{1,24}[\]】]/g, '').replace(/ {2,}/g, ' ');
// Roughly what of a line went out before she stopped at a pause (按句可停): ~230 ms a character, ended at the last
// sentence or comma break that fits, so her own record of what she said reads like where she really stopped.
export function saidPart(text, spokenMs, msPerChar = 230) {
  const t = plainText(text), n = Math.max(1, Math.round(spokenMs / msPerChar));
  if (n >= t.length) return t;
  const head = t.slice(0, n + 2), at = Math.max(...[...'。！？!?，,；;…～~'].map(c => head.lastIndexOf(c)));
  return (at >= 2 ? t.slice(0, at) : t.slice(0, n)).replace(/[，,；;、\s]+$/, '');
}

export function duoVoice({ stage, off, dir, keepFiles = 300 }) {
  const GAP_PCM = Buffer.alloc(24000 * 2 * 0.35);   // 0.35 s of silence between the two voices
  async function join(text, read, gap) {
    const parts = splitSlip(text), bufs = [];
    for (const p of parts) {
      const b = await read(p.off ? off : stage, p.text);
      if (!b) return null;
      if (bufs.length && gap) bufs.push(gap);
      bufs.push(b);
    }
    return bufs.length ? Buffer.concat(bufs) : null;
  }
  // Two Doubao mp3s glued together carry two ID3/Xing headers and players stop at the first part's length, so a slip
  // goes to the page as one WAV built from the same PCM Vidu gets (only the mock avatar plays it; Vidu speaks itself).
  async function say(text, face, id, tone) {
    if (!String(text).includes('{东北}')) return stage.say(text, face, id, tone);
    const pcm = await join(text, (v, t) => v.pcm(t), GAP_PCM);
    if (!pcm) return null;
    const head = Buffer.alloc(44);
    head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVEfmt ', 8);
    head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(24000, 24);
    head.writeUInt32LE(48000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
    const file = `${id}.wav`;
    fs.writeFileSync(path.join(dir, file), Buffer.concat([head, pcm]));
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.wav')).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keepFiles)) fs.rmSync(path.join(dir, f), { force: true });
    return { url: `/audio/${file}`, durationMs: Math.round(pcm.length / 48) };
  }
  const pcm = text => join(text, (v, t) => v.pcm(t), GAP_PCM);
  // Streamed: each part streams in its own voice, in order, with the gap just before the next part's first
  // chunk. A part that fails ends the line there (its voice has reported it); a slip line no longer goes all-or-nothing.
  async function* pcmStream(text, id, tone) {
    let any = false;
    for (const p of splitSlip(text)) {
      let none = true;
      for await (const b of (p.off ? off : stage).pcmStream(p.text, id, p.off ? undefined : tone)) {
        if (none && any) yield GAP_PCM;
        none = false; any = true;
        yield b;
      }
      if (none) return;
    }
  }
  const streams = !!(stage.pcmStream && off.pcmStream);
  return { say, pcm, ...(streams ? { pcmStream } : {}), warm: () => stage.warm?.(), voiceId: stage.voiceId, offVoiceId: off.voiceId, provider: stage.provider, dailyChars: stage.dailyChars,
    get used() { return stage.used + off.used; }, get rmb() { return stage.rmb + off.rmb; } };
}
