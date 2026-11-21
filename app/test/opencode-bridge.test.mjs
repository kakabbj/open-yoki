// The OpenCode bridge (v7): OpenAI-compatible /v1/chat/completions in, one persistent
// OpenCode session out. Tested against a fake OpenCode server — no real OpenCode, no key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { toPrompt, splitModel, extractText, openaiReply, createOpencode, createSessionAsker, createBridge, resolveOpencodeBin } from '../../tools/opencode-bridge/bridge.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('toPrompt: system lines become the system, user lines join into one text', () => {
  const p = toPrompt([
    { role: 'system', content: 'Bạn là Vy.' },
    { role: 'system', content: 'Nói ngắn gọn.' },
    { role: 'user', content: 'Chào bạn' },
    { role: 'assistant', content: 'Chào!' },
    { role: 'user', content: 'Kể tiếp đi' },
  ]);
  assert.equal(p.system, 'Bạn là Vy.\n\nNói ngắn gọn.');
  assert.equal(p.text, 'Chào bạn\nTrợ lý: Chào!\nKể tiếp đi');
  assert.deepEqual(toPrompt([]), { system: undefined, text: '' });
});

test('splitModel: provider/model split, a bare model keeps the default provider', () => {
  assert.deepEqual(splitModel('xingchi/gpt-6.1-sol'), { providerID: 'xingchi', modelID: 'gpt-6.1-sol' });
  assert.deepEqual(splitModel('gemini/gemini-3-flash'), { providerID: 'gemini', modelID: 'gemini-3-flash' });
  assert.deepEqual(splitModel('gpt-6.1-sol'), { providerID: 'xingchi', modelID: 'gpt-6.1-sol' });
  assert.deepEqual(splitModel(''), { providerID: 'xingchi', modelID: 'gpt-6.1-sol' });
});

test('extractText: text parts in order, tool calls and step markers dropped', () => {
  assert.equal(extractText([{ type: 'step-start' }, { type: 'text', text: 'Xin chào' }, { type: 'text', text: ', tôi là Vy.' }, { type: 'tool', text: 'rm -rf' }]), 'Xin chào, tôi là Vy.');
  assert.equal(extractText([{ type: 'tool', text: 'x' }]), '');
  assert.equal(extractText(null), '');
  const r = openaiReply('ok', 'xingchi/gpt-6.1-sol');
  assert.equal(r.choices[0].message.content, 'ok');
  assert.equal(r.choices[0].message.role, 'assistant');
});

// A fake OpenCode server: the three calls the bridge makes, nothing else.
function fakeOpencode({ failFirstPrompt = false } = {}) {
  const seen = { sessions: 0, prompts: [] };
  let failLeft = failFirstPrompt ? 1 : 0;
  const server = http.createServer((req, res) => {
    let s = '';
    req.on('data', c => { s += c; });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'GET' && req.url === '/session') return send(200, []);
      if (req.method === 'POST' && req.url === '/session') { seen.sessions++; return send(200, { id: 'ses-test-1' }); }
      const m = req.url.match(/^\/session\/([^/]+)\/message$/);
      if (req.method === 'POST' && m) {
        if (failLeft > 0) { failLeft--; return send(404, { error: 'not found' }); }
        seen.prompts.push(JSON.parse(s || '{}'));
        return send(200, { info: { finish: 'stop' }, parts: [{ type: 'step-start' }, { type: 'text', text: 'Xin chào, tôi là Vy.' }] });
      }
      return send(404, { error: 'not found' });
    });
  });
  return { server, seen };
}

async function listen(server) {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return server.address().port;
}

test('bridge e2e: chat/completions in, the fake OpenCode session answers, OpenAI shape out', async t => {
  const fake = fakeOpencode();
  const fakePort = await listen(fake.server);
  const opencode = createOpencode({ url: `http://127.0.0.1:${fakePort}` });
  const bridge = createBridge({ opencode, url: `http://127.0.0.1:${fakePort}` });
  const server = http.createServer((req, res) => bridge.handle(req, res));
  const port = await listen(server);
  try {
    let r = await fetch(`http://127.0.0.1:${port}/health`);
    assert.deepEqual(await r.json(), { ok: true, opencode: true, session: null, model: 'xingchi/gpt-6.1-sol' });
    r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'xingchi/gpt-6.1-sol', messages: [{ role: 'system', content: 'Bạn là Vy.' }, { role: 'user', content: 'Chào bạn' }] }) });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.choices[0].message.content, 'Xin chào, tôi là Vy.');
    assert.equal(j.choices[0].message.role, 'assistant');
    // one session for the whole live, reused across lines
    assert.equal(fake.seen.sessions, 1);
    assert.equal(fake.seen.prompts.length, 1);
    assert.deepEqual(fake.seen.prompts[0].model, { providerID: 'xingchi', modelID: 'gpt-6.1-sol' });
    assert.equal(fake.seen.prompts[0].system, 'Bạn là Vy.');
    assert.deepEqual(fake.seen.prompts[0].parts, [{ type: 'text', text: 'Chào bạn' }]);
    r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemini/gemini-3-flash', messages: [{ role: 'user', content: 'Kể tiếp đi' }] }) });
    assert.equal((await r.json()).choices[0].message.content, 'Xin chào, tôi là Vy.');
    assert.equal(fake.seen.sessions, 1);
    assert.deepEqual(fake.seen.prompts[1].model, { providerID: 'gemini', modelID: 'gemini-3-flash' });
    assert.equal(fake.seen.prompts[1].system, undefined);
    r = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal((await r.json()).session, 'ses-test-1');
  } finally {
    server.close();
    fake.server.close();
  }
});

test('bridge: a 404 on the session recreates it once and the line still answers', async t => {
  const fake = fakeOpencode({ failFirstPrompt: true });
  const fakePort = await listen(fake.server);
  const opencode = createOpencode({ url: `http://127.0.0.1:${fakePort}` });
  const asker = createSessionAsker({ opencode });
  const r = await asker.ask([{ role: 'user', content: 'Chào bạn' }]);
  assert.equal(r.text, 'Xin chào, tôi là Vy.');
  assert.equal(fake.seen.sessions, 2);   // first session 404'd, a second one was made
  assert.equal(fake.seen.prompts.length, 1);
  fake.server.close();
});

test('bridge: OpenCode down reports a Vietnamese opencode_down instead of hanging', async t => {
  // a port nothing listens on: the bridge must say so, fast
  const probe = http.createServer(() => {});
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const deadPort = probe.address().port;
  probe.close();
  const opencode = createOpencode({ url: `http://127.0.0.1:${deadPort}` });
  const bridge = createBridge({ opencode, url: `http://127.0.0.1:${deadPort}`, spawnFn: () => ({ on() {} }), waitMs: 50, sleep: () => Promise.resolve() });
  const server = http.createServer((req, res) => bridge.handle(req, res));
  const port = await listen(server);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'xingchi/gpt-6.1-sol', messages: [{ role: 'user', content: 'Chào bạn' }] }) });
    assert.equal(r.status, 502);
    const j = await r.json();
    assert.equal(j.error.type, 'opencode_down');
    assert.match(j.error.message, /OpenCode chua chay/);
  } finally {
    server.close();
  }
});

// v7.2: on Windows an npm-global install only leaves %APPDATA%\npm\opencode.cmd
// on PATH, and spawning a .cmd without shell:true dies with EINVAL — the v7
// bridge spawned plain 'opencode', so it 502'd even though `where opencode`
// finds it. resolveOpencodeBin mirrors cmd's PATH search (.exe first, then
// .cmd/.bat per directory) and marks .cmd/.bat for shell:true.
test('resolveOpencodeBin: explicit bin, .cmd/.bat need a shell, plain exe does not', () => {
  assert.deepEqual(resolveOpencodeBin({ bin: 'opencode' }), { bin: 'opencode', shell: false });
  assert.deepEqual(resolveOpencodeBin({ bin: 'C:\\tools\\opencode.cmd' }), { bin: 'C:\\tools\\opencode.cmd', shell: true });
  assert.deepEqual(resolveOpencodeBin({ bin: 'C:\\tools\\opencode.bat' }), { bin: 'C:\\tools\\opencode.bat', shell: true });
  assert.deepEqual(resolveOpencodeBin({ bin: 'opencode', platform: 'win32' }), { bin: 'opencode', shell: false });
  assert.deepEqual(resolveOpencodeBin({ platform: 'linux', env: {} }), { bin: 'opencode', shell: false });
});

test('resolveOpencodeBin: win32 finds opencode.exe on PATH, else the npm .cmd, else null', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-resolve-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const bindir = path.join(base, 'bin');
  const appdata = path.join(base, 'appdata');
  fs.mkdirSync(path.join(appdata, 'npm'), { recursive: true });
  fs.writeFileSync(path.join(appdata, 'npm', 'opencode.cmd'), '@echo off');
  // no .exe anywhere, .cmd only under APPDATA
  assert.deepEqual(
    resolveOpencodeBin({ platform: 'win32', env: { PATH: bindir, APPDATA: appdata } }),
    { bin: path.join(appdata, 'npm', 'opencode.cmd'), shell: true });
  // a .cmd in an earlier PATH dir wins over the APPDATA one
  fs.mkdirSync(bindir, { recursive: true });
  fs.writeFileSync(path.join(bindir, 'opencode.cmd'), '@echo off');
  assert.deepEqual(
    resolveOpencodeBin({ platform: 'win32', env: { PATH: bindir, APPDATA: appdata } }),
    { bin: path.join(bindir, 'opencode.cmd'), shell: true });
  // a real .exe in PATH wins over any .cmd
  fs.writeFileSync(path.join(bindir, 'opencode.exe'), '');
  assert.deepEqual(
    resolveOpencodeBin({ platform: 'win32', env: { PATH: bindir, APPDATA: appdata } }),
    { bin: 'opencode', shell: false });
  // nothing anywhere
  assert.equal(resolveOpencodeBin({ platform: 'win32', env: { PATH: path.join(base, 'empty'), APPDATA: path.join(base, 'nope') } }), null);
});

test('bridge: a spawn error fails fast with serveError spawn_failed, not after 20s', async t => {
  const probe = http.createServer(() => {});
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const deadPort = probe.address().port;
  probe.close();
  const opencode = createOpencode({ url: `http://127.0.0.1:${deadPort}` });
  const seen = {};
  const spawnFn = (bin, args, opts) => {
    seen.bin = bin; seen.opts = opts;
    return { on(ev, fn) { if (ev === 'error') setImmediate(() => fn(Object.assign(new Error('spawn opencode ENOENT'), { code: 'ENOENT' }))); } };
  };
  const bridge = createBridge({ opencode, url: `http://127.0.0.1:${deadPort}`, spawnFn, waitMs: 10000 });
  const start = Date.now();
  assert.equal(await bridge.ensureServe(), false);
  assert.ok(Date.now() - start < 5000, `ensureServe took ${Date.now() - start}ms, should fail fast on spawn error`);
  assert.equal(bridge.serveError, 'spawn_failed');
  assert.equal(seen.bin, 'opencode');
  assert.equal(seen.opts.shell, undefined);
});

test('bridge: 502 says why — binary missing vs serve will not start', async t => {
  const probe = http.createServer(() => {});
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const deadPort = probe.address().port;
  probe.close();
  const opencode = createOpencode({ url: `http://127.0.0.1:${deadPort}` });
  async function post502(bridge) {
    const server = http.createServer((req, res) => bridge.handle(req, res));
    const port = await listen(server);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'xingchi/gpt-6.1-sol', messages: [{ role: 'user', content: 'Chào bạn' }] }) });
      assert.equal(r.status, 502);
      return (await r.json()).error;
    } finally { server.close(); }
  }
  // no binary at all: say how to install it
  const noBin = createBridge({ opencode, url: `http://127.0.0.1:${deadPort}`, resolveBin: () => null });
  const e1 = await post502(noBin);
  assert.equal(e1.type, 'opencode_down');
  assert.match(e1.message, /Khong tim thay lenh opencode/);
  assert.match(e1.message, /npm install -g opencode-ai/);
  // binary exists but will not start: say the manual command
  const errChild = { on(ev, fn) { if (ev === 'error') fn(new Error('spawn opencode EINVAL')); } };
  const badSpawn = createBridge({ opencode, url: `http://127.0.0.1:${deadPort}`, spawnFn: () => errChild, waitMs: 50 });
  const e2 = await post502(badSpawn);
  assert.equal(e2.type, 'opencode_down');
  assert.match(e2.message, /Khong chay duoc opencode serve/);
  assert.match(e2.message, /opencode serve --port 4096/);
});
