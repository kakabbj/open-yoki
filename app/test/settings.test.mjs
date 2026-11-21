// The settings panel's key store, the new brain clients (chat / Anthropic / Responses),
// and the settings endpoints end to end on a real server with a stub provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createKeyStore, PROVIDERS } from '../server/settings.mjs';
import { chatCompletions, anthropic, responsesApi } from '../server/brain.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'livehost-settings-'));
const stubFetch = (handler) => async (url, opts) => {
  const got = handler(url, opts);
  return { ok: got.ok ?? true, status: got.status ?? 200, json: async () => got.json ?? {} };
};

test('key store: save/load round-trip, keys never leak into the public status', () => {
  const dir = tmp(), file = path.join(dir, 'keys.json');
  const store = createKeyStore({ file, env: {}, idolModel: 'deepseek/deepseek-v4.1-flash' });
  assert.equal(store.status().provider, 'openrouter');
  assert.equal(store.brain(), null);
  const st = store.save({ keys: { openrouter: 'sk-or-123' } });
  assert.equal(st.providers.find(p => p.id === 'openrouter').configured, true);
  assert.equal(JSON.stringify(st).includes('sk-or-123'), false);
  assert.equal(store.brain().model, 'deepseek/deepseek-v4.1-flash');
  assert.equal(store.brain().key, 'sk-or-123');
  // the file itself is locked down, and a second store reads the same keys back
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(createKeyStore({ file, env: {} }).brain().key, 'sk-or-123');
  // saving one provider keeps the others; '' clears a saved key
  store.save({ provider: 'gemini', keys: { gemini: 'sk-gem-1' } });
  assert.equal(store.brain().provider, 'gemini');
  assert.equal(store.keyFor('openrouter'), 'sk-or-123');
  store.save({ keys: { gemini: '' } });
  assert.equal(store.keyFor('gemini'), null);
  assert.equal(store.brain(), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('key store: env is the fallback, a saved key wins; bad input is refused', () => {
  const dir = tmp(), file = path.join(dir, 'keys.json');
  const store = createKeyStore({ file, env: { OPENROUTER_API_KEY: 'sk-env' } });
  assert.equal(store.brain().key, 'sk-env');
  store.save({ keys: { openrouter: 'sk-saved' } });
  assert.equal(store.brain().key, 'sk-saved');
  assert.throws(() => store.save({ provider: 'nope' }), /unknown provider/);
  assert.throws(() => store.save({ keys: { openrouter: 'x'.repeat(501) } }), /bad settings/);
  assert.throws(() => store.save({ bases: { custom: 'ftp://x' } }), /bad base url/);
  assert.throws(() => store.save({ voice: { voiceId: 'x'.repeat(101) } }), /bad settings/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('key store: voice keys come from settings first, env second', () => {
  const dir = tmp(), file = path.join(dir, 'keys.json');
  const store = createKeyStore({ file, env: { VOLC_API_KEY: 'volc-env', DOUBAO_VOICE_ID: 'S_1' } });
  assert.equal(store.voiceKeys().volcKey, 'volc-env');
  assert.equal(store.voiceKeys().voiceId, 'S_1');
  assert.equal(store.voiceKeys().viduKey, null);
  store.save({ voice: { volcKey: 'volc-saved', viduKey: 'vidu-saved' } });
  assert.equal(store.voiceKeys().volcKey, 'volc-saved');
  assert.equal(store.voiceKeys().viduKey, 'vidu-saved');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('key store: OpenCode provider needs no key — the key lives in OpenCode', () => {
  const dir = tmp(), file = path.join(dir, 'keys.json');
  const store = createKeyStore({ file, env: {} });
  const b = store.brainFor('opencode');
  assert.equal(b.provider, 'opencode');
  assert.equal(b.kind, 'chat');
  assert.equal(b.model, 'xingchi/gpt-6.1-sol');
  assert.equal(b.base, 'http://127.0.0.1:20129/v1');
  assert.equal(b.key, 'opencode-local');
  assert.equal(store.status().providers.find(p => p.id === 'opencode').configured, true);
  store.save({ provider: 'opencode' });
  assert.equal(store.brain().provider, 'opencode');
  // and the dummy key never reaches the public status
  assert.equal(JSON.stringify(store.status()).includes('opencode-local'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('key store: live mode defaults to all, saves, and refuses an unknown mode', () => {
  const dir = tmp(), file = path.join(dir, 'keys.json');
  const store = createKeyStore({ file, env: {} });
  assert.equal(store.liveMode(), 'all');
  assert.equal(store.status().liveMode, 'all');
  store.save({ liveMode: 'quiz' });
  assert.equal(store.liveMode(), 'quiz');
  assert.equal(store.status().liveMode, 'quiz');
  assert.equal(createKeyStore({ file, env: {} }).liveMode(), 'quiz');
  assert.throws(() => store.save({ liveMode: 'nope' }), /unknown live mode/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('settings endpoints: OpenCode test reports a down bridge in Vietnamese', async t => {
  const { start } = await import('../server/index.mjs');
  const dir = tmp();
  const app = await start({ IDOL: 'viet', MODE: 'test', DATA_DIR: dir, AVATAR: 'mock' });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    let r = await fetch(`${base}/api/settings`);
    let j = await r.json();
    assert.equal(j.providers.find(p => p.id === 'opencode').configured, true);
    r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'opencode' }) });
    j = await r.json();
    assert.equal(j.modelOn, true);
    // nothing listens on the bridge port in this test, so the check fails fast
    r = await fetch(`${base}/api/settings/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'opencode' }) });
    j = await r.json();
    assert.equal(j.ok, false);
    assert.match(j.error, /cầu nối OpenCode/);
  } finally {
    await app.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('chat completions client: request shape, answer and cost', async () => {
  let seen;
  const ask = chatCompletions({ key: 'k1', model: 'gpt-4o-mini', base: 'https://api.example.com/v1', fetchImpl: stubFetch((url, opts) => {
    seen = { url, opts, body: JSON.parse(opts.body) };
    return { json: { choices: [{ message: { content: 'xin chào' } }], usage: { cost: 0.02 } } };
  }) });
  const r = await ask([{ role: 'user', content: 'hi' }]);
  assert.equal(seen.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(seen.opts.headers.Authorization, 'Bearer k1');
  assert.equal(seen.body.model, 'gpt-4o-mini');
  assert.deepEqual(seen.body.messages, [{ role: 'user', content: 'hi' }]);
  assert.deepEqual(r, { text: 'xin chào', cost: 0.02 });
});

test('chat completions client: a 429 keeps the provider detail, a bare 429 stays identifiable', async () => {
  // JSON body with the quota detail (Gemini's usual shape)
  const json429 = chatCompletions({ key: 'k1', model: 'm', base: 'https://api.example.com/v1', fetchImpl: async () => ({
    ok: false, status: 429, text: async () => JSON.stringify({ error: { message: 'Quota exceeded for quota metric' } }),
  }) });
  await assert.rejects(() => json429([{ role: 'user', content: 'hi' }]), /model 429: Quota exceeded for quota metric/);
  // a bare 429 with a plain-text body (no JSON at all)
  const text429 = chatCompletions({ key: 'k1', model: 'm', base: 'https://api.example.com/v1', fetchImpl: async () => ({
    ok: false, status: 429, text: async () => 'Too Many Requests',
  }) });
  await assert.rejects(() => text429([{ role: 'user', content: 'hi' }]), /model 429: Too Many Requests/);
});

test('settings endpoints: a provider 429 becomes a Vietnamese quota message, not a bare "model 429:"', async t => {
  const { start } = await import('../server/index.mjs');
  const dir = tmp();
  const stub = http.createServer((req, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Quota exceeded for quota metric' } }));
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  const stubPort = stub.address().port;
  const app = await start({ IDOL: 'viet', MODE: 'test', DATA_DIR: dir, AVATAR: 'mock' });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    let r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'custom', keys: { custom: 'test-key' }, bases: { custom: `http://127.0.0.1:${stubPort}` }, models: { custom: 'test-model' } }) });
    assert.equal(r.status, 200);
    r = await fetch(`${base}/api/settings/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'custom' }) });
    const j = await r.json();
    assert.equal(j.ok, false);
    assert.match(j.error, /Hết quota hoặc gửi quá nhanh \(429\)/);
    assert.match(j.error, /Quota exceeded/);
  } finally {
    await app.shutdown();
    stub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('brain clients never put the key in an error message', async () => {
  const bad = stubFetch(() => ({ ok: false, status: 401, json: { error: { message: 'bad key sk-secret-123' } } }));
  for (const ask of [
    chatCompletions({ key: 'sk-secret-123', model: 'm', base: 'https://x', fetchImpl: bad }),
    anthropic({ key: 'sk-secret-123', model: 'm', fetchImpl: bad }),
    responsesApi({ key: 'sk-secret-123', model: 'm', fetchImpl: bad }),
  ]) {
    await assert.rejects(() => ask([{ role: 'user', content: 'hi' }]), err => !String(err.message).includes('sk-secret-123'));
  }
});

test('anthropic client: system goes in its own field, same-role lines merge', async () => {
  let seen;
  const ask = anthropic({ key: 'k2', model: 'claude-sonnet-4-5', fetchImpl: stubFetch((url, opts) => {
    seen = { url, opts, body: JSON.parse(opts.body) };
    return { json: { content: [{ type: 'text', text: 'chào bạn' }] } };
  }) });
  const r = await ask([{ role: 'system', content: 'You are Vy.' }, { role: 'user', content: 'hi' }, { role: 'user', content: 'there' }]);
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.opts.headers['x-api-key'], 'k2');
  assert.equal(seen.body.system, 'You are Vy.');
  assert.deepEqual(seen.body.messages, [{ role: 'user', content: 'hi\nthere' }]);
  assert.equal(r.text, 'chào bạn');
});

test('responses client: input mapping and both answer shapes', async () => {
  const one = responsesApi({ key: 'k3', model: 'gpt-6.1-sol', base: 'https://api.xingchiapi.com/v1', fetchImpl: stubFetch((url, opts) => {
    assert.equal(url, 'https://api.xingchiapi.com/v1/responses');
    const body = JSON.parse(opts.body);
    assert.deepEqual(body.input, [{ role: 'user', content: 'hi' }]);
    return { json: { output_text: 'chào' } };
  }) });
  assert.equal((await one([{ role: 'user', content: 'hi' }])).text, 'chào');
  const two = responsesApi({ key: 'k3', model: 'm', fetchImpl: stubFetch(() => ({ json: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'chào ' }, { type: 'output_text', text: 'bạn' }] }] } })) });
  assert.equal((await two([{ role: 'user', content: 'hi' }])).text, 'chào bạn');
});

test('responses client: a Xingchi 403 about programming clients becomes a Vietnamese explanation, not the Chinese error', async () => {
  const ask = responsesApi({ key: 'sk-xingchi-secret', model: 'gpt-6.1-sol', fetchImpl: stubFetch(() => ({
    ok: false, status: 403,
    json: { error: { message: '本站仅支持编程客户端调用使用：Codex、Claude Code、OpenCode、ZCode、Cursor' } },
  })) });
  await assert.rejects(ask([{ role: 'user', content: 'hi' }]), err => {
    assert.match(err.message, /Xingchi chặn gọi trực tiếp/);
    assert.match(err.message, /Key không sai/);
    assert.match(err.message, /OpenRouter\/Gemini\/DeepSeek/);
    assert.match(err.message, /OpenCode/);
    assert.doesNotMatch(err.message, /仅支持编程客户端/);
    assert.doesNotMatch(err.message, /sk-xingchi-secret/);
    return true;
  });
  // other 403s stay raw (and key-scrubbed)
  const other = responsesApi({ key: 'sk-xingchi-secret', model: 'm', fetchImpl: stubFetch(() => ({
    ok: false, status: 403, json: { error: { message: 'quota exceeded for sk-xingchi-secret' } },
  })) });
  await assert.rejects(other([{ role: 'user', content: 'hi' }]), /responses 403: quota exceeded for \*\*\*/);
});

test('settings endpoints: save a key in the panel, the brain turns on, test hits the provider', async t => {
  const { start } = await import('../server/index.mjs');
  const dir = tmp();
  // a stub provider that speaks OpenAI chat completions
  const stub = http.createServer((req, res) => {
    let s = '';
    req.on('data', c => { s += c; });
    req.on('end', () => {
      const body = JSON.parse(s || '{}');
      assert.equal(req.url, '/chat/completions');
      assert.equal(req.headers.authorization, 'Bearer test-key');
      assert.equal(body.model, 'test-model');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  const stubPort = stub.address().port;
  const app = await start({ IDOL: 'viet', MODE: 'test', DATA_DIR: dir, AVATAR: 'mock' });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    let r = await fetch(`${base}/api/settings`);
    assert.equal(r.status, 200);
    let j = await r.json();
    assert.equal(j.modelOn, false);
    assert.equal(j.providers.find(p => p.id === 'custom').configured, false);
    r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'custom', keys: { custom: 'test-key' }, bases: { custom: `http://127.0.0.1:${stubPort}` }, models: { custom: 'test-model' } }) });
    assert.equal(r.status, 200);
    j = await r.json();
    assert.equal(j.modelOn, true);
    assert.equal(JSON.stringify(j).includes('test-key'), false);
    assert.equal(j.providers.find(p => p.id === 'custom').configured, true);
    r = await fetch(`${base}/api/state`);
    j = await r.json();
    assert.equal(j.routes.model, 'ok');
    r = await fetch(`${base}/api/settings/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'custom' }) });
    j = await r.json();
    assert.deepEqual(j, { ok: true, text: 'ok' });
    // the saved key survived on disk, in keys.json
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'keys.json'), 'utf8')).keys.custom, 'test-key');
  } finally {
    await app.shutdown();
    stub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('push endpoints: save RTMP targets in the panel, keys never leak, mock cannot push', async t => {
  const { start } = await import('../server/index.mjs');
  const dir = tmp();
  const app = await start({ IDOL: 'viet', MODE: 'test', DATA_DIR: dir, AVATAR: 'mock' });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    let r = await fetch(`${base}/api/settings/push`);
    assert.equal(r.status, 200);
    let j = await r.json();
    assert.deepEqual(j, { targets: [], configured: false, on: false, live: false, canPush: false });
    // a short key is refused
    r = await fetch(`${base}/api/settings/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: [{ name: 'youtube', url: 'rtmp://a.rtmp.youtube.com/live2', key: 'short' }] }) });
    assert.equal(r.status, 400);
    r = await fetch(`${base}/api/settings/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: [
        { name: 'youtube', url: 'rtmp://a.rtmp.youtube.com/live2', key: 'fake-key-12345678' },
        { name: 'facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', key: 'fake-fb-key-12345678' },
      ] }) });
    assert.equal(r.status, 200);
    j = await r.json();
    assert.equal(j.configured, true);
    assert.equal(j.targets.length, 2);
    assert.equal(j.targets[0].hasKey, true);
    assert.equal(JSON.stringify(j).includes('fake-key'), false);
    // an empty key keeps the saved one; the file on disk has both targets
    r = await fetch(`${base}/api/settings/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: [{ name: 'youtube', url: 'rtmp://a.rtmp.youtube.com/live2', key: '' }] }) });
    j = await r.json();
    assert.equal(j.targets.length, 1);
    assert.equal(j.targets[0].hasKey, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'square.json'), 'utf8')).targets[0].key, 'fake-key-12345678');
    // mock mode has no Vidu room, so start is a no-op, not an error
    r = await fetch(`${base}/api/settings/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).live, false);
    // the room snapshot carries the shop, the quiz and the song list
    r = await fetch(`${base}/api/state`);
    j = await r.json();
    assert.equal(j.products.length, 2);
    assert.equal(j.products[0].name.includes('ví dụ'), true);
    assert.equal(j.quiz.active, false);
    assert.deepEqual(j.quiz.scores, []);
    assert.equal(j.story.active, false);
    assert.deepEqual(j.songs, { list: [], current: null });
  } finally {
    await app.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
