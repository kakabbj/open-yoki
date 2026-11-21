// The voice service: one stalled fal request is retried, and every request uses the configured voice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { falVoice, doubaoVoice, edgeVoice, edgeVoiceId, spokenLang, EDGE_TTS_URL } from '../server/voice.mjs';
import { WebSocketServer } from 'ws';

test('a failed voice request is retried once with the picked voice and full quality', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-voice-'));
  const bodies = [];
  let calls = 0;
  const fetchImpl = async (url, opts) => {
    if (url.startsWith('https://fal.run/')) {
      bodies.push(JSON.parse(opts.body));
      if (++calls === 1) throw new Error('The operation was aborted due to timeout');
      return { ok: true, status: 200, json: async () => ({ audio: { url: 'https://x/a.mp3' }, duration_ms: 3000 }) };
    }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  const status = [];
  const voice = falVoice({ key: 'k', dir, voiceId: 'female-tianmei', fetchImpl, status: (r, ok) => status.push(ok) });
  const out = await voice.say('客官里边请', 'happy', 'x1');
  assert.equal(out.url, '/audio/x1.mp3');
  assert.equal(calls, 2);
  assert.deepEqual(status, [true]);
  for (const b of bodies) {
    assert.equal(b.voice_setting.voice_id, 'female-tianmei');
    assert.equal(b.voice_setting.emotion, undefined);
    assert.equal(b.audio_setting.bitrate, 128000);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the Vidu avatar gets raw 24 kHz mono PCM', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-voice-'));
  let body = null;
  const fetchImpl = async (url, opts) => url.startsWith('https://fal.run/')
    ? (body = JSON.parse(opts.body), { ok: true, status: 200, json: async () => ({ audio: { url: 'https://x/a.pcm' }, duration_ms: 1000 }) })
    : { ok: true, arrayBuffer: async () => new ArrayBuffer(48000) };
  const voice = falVoice({ key: 'k', dir, voiceId: 'v', fetchImpl });
  const pcm = await voice.pcm('欸你好喔');
  assert.equal(pcm.length, 48000);
  assert.deepEqual(body.audio_setting, { format: 'pcm', sample_rate: 24000, channel: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Doubao voice: picked speaker and Taiwanese instruction, PCM for Vidu, mp3 for the page, error codes fail cleanly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-doubao-'));
  const sent = [];
  let fail = false;
  const chunk = b => JSON.stringify({ code: 0, data: Buffer.from(b).toString('base64') });
  const fetchImpl = async (url, opts) => {
    sent.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    if (fail) return { ok: true, status: 200, text: async () => JSON.stringify({ code: 45000000, message: 'quota' }) };
    return { ok: true, status: 200, text: async () => [chunk('ab'), chunk('cd'), JSON.stringify({ code: 20000000 })].join('\n') };
  };
  const notes = [];
  const v = doubaoVoice({ key: 'k', dir, voiceId: 'zh_female_xiaohe_uranus_bigtts', context: '用台湾腔说话', fetchImpl, status: (r, ok, err) => notes.push([ok, err]) });
  const pcm = await v.pcm('哈喽');
  assert.equal(pcm.toString(), 'abcd');
  const p = sent[0].body.req_params;
  assert.equal(p.speaker, 'zh_female_xiaohe_uranus_bigtts');
  assert.deepEqual(p.context_texts, ['用台湾腔说话']);
  assert.deepEqual([p.audio_params.format, p.audio_params.sample_rate], ['pcm', 24000]);
  assert.equal(sent[0].headers['X-Api-Resource-Id'], 'seed-tts-2.0');
  const a = await v.say('你好', 'smile', 'line1');
  assert.equal(a.url, '/audio/line1.mp3');
  assert.equal(sent[1].body.req_params.audio_params.format, 'mp3');
  assert.equal(v.used, 4);
  assert.equal(JSON.parse(sent[1].body.req_params.additions).explicit_language, undefined);
  await v.pcm('로봇이라고? 나 밤새 차트 봤거든.');
  assert.equal(JSON.parse(sent[2].body.req_params.additions).explicit_language, 'ko');
  fail = true;
  assert.equal(await v.pcm('再见'), null);
  assert.equal(notes.at(-1)[0], false);
  assert.match(notes.at(-1)[1], /45000000/);
});

// A cloned voice garbles anything but Chinese/English unless the request names the language.
test('spokenLang names the language of a non-Chinese line', () => {
  const cases = [['今晚 BTC 能破 82k 吗', ''], ['ロボット？私、一晩中チャート見てた', 'ja'], ['로봇이라고?', 'ko'], ['Я робот', 'ru'], ['หุ่นยนต์เหรอ', 'th'],
    ['Robot à? Mình xem biểu đồ', 'vi'], ['¿Robot yo? Llevo toda la noche', 'es-mx'], ['Robô, eu? Passei a noite toda', 'pt-br'],
    ["Un robot, moi ? J'ai regardé", 'fr'], ['Coucou Julie, français oui ! Et merci, toi aussi', 'fr'], ['Ein Roboter, ich? Ich habe', 'de'], ['Bitcoin turun lagi ya', 'id'],
    ['Robot? Me? I have been staring at this chart all night', ''], ['The market is red tonight, la la la', ''], ['BTC 81k', ''], ['hahaha', '']];
  for (const [t, want] of cases) assert.equal(spokenLang(t), want, t);
});

// Edge TTS (v7.6): the free voice, no key. A fake read-aloud server answers the SSML
// with one audio frame and turn.end; the line lands as an mp3 under /audio/.
function fakeEdge({ onSsml }) {
  const wss = new WebSocketServer({ port: 0 });
  const received = [];
  wss.on('connection', ws => ws.on('message', data => {
    const s = data.toString();
    received.push(s);
    if (s.includes('Path:ssml')) onSsml(ws, s);
  }));
  return { wss, received, url: () => `ws://127.0.0.1:${wss.address().port}`, close: () => new Promise(r => wss.close(r)) };
}
const edgeAudio = (id, bytes) => Buffer.concat([Buffer.from(`X-RequestId:${id}\r\nContent-Type: audio/mpeg\r\nPath:audio\r\n\r\n`), Buffer.alloc(bytes, 7)]);
const edgeEnd = id => `X-RequestId:${id}\r\nPath:turn.end\r\n\r\n`;
const edgeId = s => /X-RequestId:(\S+)/.exec(s)?.[1] || 'x';

test('Edge TTS: SSML with the picked voice comes back as an mp3 under /audio/', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-edge-'));
  const fake = fakeEdge({ onSsml: (ws, s) => { const id = edgeId(s); ws.send(`X-RequestId:${id}\r\nPath:turn.start\r\n\r\n`); ws.send(edgeAudio(id, 6000)); ws.send(edgeEnd(id)); } });
  try {
    const v = edgeVoice({ dir, voiceId: 'vi-VN-NamMinhNeural', wsUrl: fake.url() });
    const out = await v.say('Xin chào & <bạn>', 'smile', 'e1');
    assert.equal(out.url, '/audio/e1.mp3');
    assert.equal(out.durationMs, 1000);   // 6000 bytes at 48 kbps
    assert.equal(fs.readFileSync(path.join(dir, 'e1.mp3')).length, 6000);
    assert.equal(v.provider, 'edge');
    const ssml = fake.received.find(s => s.includes('Path:ssml'));
    assert.match(ssml, /vi-VN-NamMinhNeural/);
    assert.match(ssml, /Xin chào &amp; &lt;bạn&gt;/);
    assert.match(fake.received.find(s => s.includes('speech.config')), /audio-24khz-48kbitrate-mono-mp3/);
  } finally { await fake.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Edge TTS: a connection that dies mid-turn is retried once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-edge-'));
  let n = 0;
  const fake = fakeEdge({ onSsml: (ws, s) => { if (++n === 1) { ws.close(); return; } const id = edgeId(s); ws.send(edgeAudio(id, 3000)); ws.send(edgeEnd(id)); } });
  try {
    const v = edgeVoice({ dir, wsUrl: fake.url() });
    const out = await v.say('alo', 'smile', 'e2');
    assert.equal(out.url, '/audio/e2.mp3');
    assert.equal(out.durationMs, 500);
    assert.equal(n, 2);
  } finally { await fake.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Edge TTS: two dead connections fail cleanly with no file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-edge-'));
  const fake = fakeEdge({ onSsml: ws => ws.close() });
  try {
    const notes = [];
    const v = edgeVoice({ dir, wsUrl: fake.url(), status: (r, ok) => notes.push(ok) });
    assert.equal(await v.say('alo', 'smile', 'e3'), null);
    assert.deepEqual(notes, [false]);
    assert.equal(fs.existsSync(path.join(dir, 'e3.mp3')), false);
  } finally { await fake.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Edge TTS: pcm decodes the mp3 through the injected decoder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-edge-'));
  const fake = fakeEdge({ onSsml: (ws, s) => { const id = edgeId(s); ws.send(edgeAudio(id, 6000)); ws.send(edgeEnd(id)); } });
  try {
    const v = edgeVoice({ dir, wsUrl: fake.url(), execImpl: async buf => { assert.equal(buf.length, 6000); return Buffer.from([1, 2, 3]); } });
    assert.deepEqual([...(await v.pcm('alo'))], [1, 2, 3]);
  } finally { await fake.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('edgeVoiceId falls back to Hoài My for an unknown voice', () => {
  assert.equal(edgeVoiceId('vi-VN-NamMinhNeural'), 'vi-VN-NamMinhNeural');
  assert.equal(edgeVoiceId('nope'), 'vi-VN-HoaiMyNeural');
  assert.equal(edgeVoiceId(''), 'vi-VN-HoaiMyNeural');
});

// v7.7: the real read-aloud service refuses connections without a Sec-MS-GEC
// token (edge-tts 7.3.1). A stub socket records the URL and headers instead of
// connecting, and answers the SSML with audio + turn.end.
test('Edge TTS: the real service URL carries a fresh Sec-MS-GEC token and the edge-tts headers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-edge-'));
  let seen = null;
  class StubWS {
    constructor(url, opts) {
      seen = { url, headers: opts.headers, sent: [] };
      this.h = {};
      setImmediate(() => this.h.open?.forEach(f => f()));
    }
    on(ev, fn) { (this.h[ev] ??= []).push(fn); return this; }
    send(s) {
      seen.sent.push(s);
      if (s.includes('Path:ssml')) {
        const id = edgeId(s);
        setImmediate(() => {
          this.h.message?.forEach(f => f(edgeAudio(id, 6000)));
          this.h.message?.forEach(f => f(Buffer.from(edgeEnd(id))));
        });
      }
    }
    close() {}
  }
  const v = edgeVoice({ dir, wsUrl: EDGE_TTS_URL, wsImpl: StubWS, tokenImpl: () => 'TESTTOKEN-0123456789ABCDEF' });
  const out = await v.say('Xin chào', 'smile', 'e9');
  assert.equal(out.url, '/audio/e9.mp3');
  assert.match(seen.url, /^wss:\/\/speech\.platform\.bing\.com\/consumer\/speech\/synthesize\/readaloud\/edge\/v1\?TrustedClientToken=/);
  assert.match(seen.url, /&ConnectionId=[0-9a-f]{32}/);
  assert.match(seen.url, /&Sec-MS-GEC=TESTTOKEN-0123456789ABCDEF/);
  assert.match(seen.url, /&Sec-MS-GEC-Version=2-143\.0\.3650\.75/);
  assert.equal(seen.headers.Origin, 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold');
  assert.match(seen.headers.Cookie, /^muid=[0-9A-F]{32};$/);
  assert.match(seen.headers['User-Agent'], /Chrome\/143/);
  const config = seen.sent.find(s => s.includes('speech.config'));
  assert.match(config, /X-Timestamp:[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT\+0000 \(Coordinated Universal Time\)\r\nContent-Type:application\/json/);
  const ssml = seen.sent.find(s => s.includes('Path:ssml'));
  assert.match(ssml, /X-Timestamp:.*Z\r\nPath:ssml/);
  assert.match(ssml, /<speak version='1\.0'[^>]*xml:lang='en-US'><voice name='vi-VN-HoaiMyNeural'><prosody pitch='\+0Hz' rate='\+0%' volume='\+0%'>Xin chào<\/prosody>/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// End to end (v7.6): a real server in test mode, Edge as the voice, a stub brain —
// a chat line comes back spoken: the room line carries an /audio/ URL that serves.
test('Edge voice end to end: a chat reply comes back with audio the page can play', async () => {
  const { start } = await import('../server/index.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-edge-e2e-'));
  const fake = fakeEdge({ onSsml: (ws, s) => { const id = edgeId(s); ws.send(edgeAudio(id, 6000)); ws.send(edgeEnd(id)); } });
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'A, hi đấy mà!' } }] })); });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  const stubPort = stub.address().port;
  const app = await start({ IDOL: 'viet', MODE: 'test', DATA_DIR: dir, AVATAR: 'mock', VOICE_PROVIDER: 'edge', EDGE_TTS_URL: fake.url() });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    let r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'custom', keys: { custom: 'test-key' }, bases: { custom: `http://127.0.0.1:${stubPort}` }, models: { custom: 'test-model' } }) });
    assert.equal(r.status, 200);
    // one viewer on the stream, or the line stays silent
    const stream = await fetch(`${base}/api/stream`);
    assert.equal(stream.status, 200);
    r = await fetch(`${base}/api/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'kakap' }) });
    const { token } = await r.json();
    r = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, text: 'hi' }) });
    assert.equal(r.status, 200);
    let audio = null, seen = '';
    for (let i = 0; i < 60 && !audio; i++) {
      await new Promise(r => setTimeout(r, 250));
      const st = await (await fetch(`${base}/api/state`)).json();
      seen = st.line?.text || seen;
      if (st.line?.audio && (st.line.text || '').includes('hi đấy')) audio = st.line.audio;
    }
    assert.ok(audio, `no spoken chat reply (last line: ${seen})`);
    assert.match(audio, /^\/audio\/[0-9a-f]+\.mp3$/);
    r = await fetch(`${base}${audio}`);
    assert.equal(r.status, 200);
    assert.equal((await r.arrayBuffer()).byteLength, 6000);
    await stream.body.cancel();
  } finally {
    await app.shutdown();
    stub.close();
    await fake.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
