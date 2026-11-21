// The OpenCode bridge (v7): OpenAI-compatible /v1/chat/completions in, one persistent
// OpenCode session out. Tested against a fake OpenCode server — no real OpenCode, no key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { toPrompt, splitModel, extractText, extractTextV2, openaiReply, createOpencode, createSessionAsker, createBridge, resolveOpencodeBin } from '../../tools/opencode-bridge/bridge.mjs';
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

test('bridge: a 405 names the failing serve call and keeps the plain-text body', async t => {
  // the user's serve answered POST /session with a bare 405 ("Method Not
  // Allowed" as plain text, not JSON) — the old client showed only
  // "opencode 405:" with nothing after it, so nobody could tell which call
  // failed. The label + raw body now say exactly that.
  const plain405 = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/session') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]'); return; }
    res.writeHead(405, { 'content-type': 'text/plain' });
    res.end('Method Not Allowed');
  });
  const port405 = await listen(plain405);
  const opencode = createOpencode({ url: `http://127.0.0.1:${port405}` });
  const asker = createSessionAsker({ opencode });
  await assert.rejects(() => asker.ask([{ role: 'user', content: 'Chào bạn' }]), /opencode 405 \(tao phien POST \/session\): Method Not Allowed/);
  plain405.close();
  // same for the message call: session creates fine, the prompt 405s
  const msg405 = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/session') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]'); return; }
    if (req.method === 'POST' && req.url === '/session') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'ses-1' })); return; }
    res.writeHead(405, { 'content-type': 'text/plain' });
    res.end('Method Not Allowed');
  });
  const portMsg = await listen(msg405);
  const opencode2 = createOpencode({ url: `http://127.0.0.1:${portMsg}` });
  const asker2 = createSessionAsker({ opencode: opencode2 });
  await assert.rejects(() => asker2.ask([{ role: 'user', content: 'Chào bạn' }]), /opencode 405 \(gui tin POST \/session\/\{id\}\/message\): Method Not Allowed/);
  msg405.close();
});

test('bridge: a serve failure says which API it speaks and whether the password works', async t => {
  // the user's v2 serve 405s POST /session with an EMPTY body — the old probe
  // (GET /session) cannot tell a v2 serve from a dead one, because v2 serves
  // its web UI on GET /session. detect() asks /api/session first instead.
  const noApi = http.createServer((req, res) => {
    res.writeHead(405, { 'content-type': 'text/plain' });
    res.end('');
  });
  const portNoApi = await listen(noApi);
  try {
    const opencode = createOpencode({ url: `http://127.0.0.1:${portNoApi}` });
    assert.deepEqual(await opencode.detect(), { version: null, authed: false });
    const asker = createSessionAsker({ opencode });
    await assert.rejects(() => asker.ask([{ role: 'user', content: 'Chào bạn' }]), /opencode serve khong tra loi/);
  } finally { noApi.close(); }
  // and when the serve DOES speak v1 (GET /session returns the list), a 405 on
  // the create is labelled with the version instead
  const hasApi = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/session') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]'); return; }
    res.writeHead(405, { 'content-type': 'text/plain' });
    res.end('');
  });
  const portHasApi = await listen(hasApi);
  try {
    const opencode2 = createOpencode({ url: `http://127.0.0.1:${portHasApi}` });
    assert.deepEqual(await opencode2.detect(), { version: 'v1', authed: true });
    const asker2 = createSessionAsker({ opencode: opencode2 });
    await assert.rejects(() => asker2.ask([{ role: 'user', content: 'Chào bạn' }]),
      /opencode 405 \(tao phien POST \/session\):  — serve v1/);
  } finally { hasApi.close(); }
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
  assert.match(e1.message, /npm install -g @opencode\/cli/);
  // binary exists but will not start: say the manual command
  const errChild = { on(ev, fn) { if (ev === 'error') fn(new Error('spawn opencode EINVAL')); } };
  const badSpawn = createBridge({ opencode, url: `http://127.0.0.1:${deadPort}`, spawnFn: () => errChild, waitMs: 50 });
  const e2 = await post502(badSpawn);
  assert.equal(e2.type, 'opencode_down');
  assert.match(e2.message, /Khong chay duoc opencode serve/);
  assert.match(e2.message, /opencode serve --port 4096/);
});

// --- OpenCode v2 (2.3.2) ---
// A fake v2 serve, shaped after the real 2.3.2's answers: /api/session needs the
// Basic password (401 without it), POST /session 405s with an empty body, the
// prompt only admits the line, and the reply shows up in the message list.
function fakeOpencodeV2({ password = 'test-password', failReply = false } = {}) {
  const seen = { creates: [], prompts: [], switches: [], messages: 0 };
  const sessions = new Map();
  let n = 0;
  const server = http.createServer((req, res) => {
    let s = '';
    req.on('data', c => { s += c; });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const authed = req.headers.authorization === 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
      if (req.method === 'GET' && req.url === '/session') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><html></html>'); return; }
      if (req.method === 'POST' && req.url === '/session') { res.writeHead(405, { 'content-type': 'text/plain' }); res.end(''); return; }
      if (req.url.startsWith('/api/')) {
        if (!authed) return send(401, { _tag: 'UnauthorizedError', message: 'Authentication required' });
        if (req.method === 'GET' && req.url === '/api/session') return send(200, { data: [...sessions.keys()].map(id => ({ id })), cursor: {} });
        if (req.method === 'POST' && req.url === '/api/session') {
          const body = JSON.parse(s || '{}');
          seen.creates.push(body);
          const id = 'ses-v2-' + (++n);
          sessions.set(id, { messages: [] });
          return send(200, { data: { id, title: body.title } });
        }
        const pm = req.url.match(/^\/api\/session\/([^/]+)\/prompt$/);
        if (req.method === 'POST' && pm) {
          const body = JSON.parse(s || '{}');
          seen.prompts.push(body);
          const sess = sessions.get(pm[1]);
          if (!sess) return send(404, { _tag: 'SessionNotFoundError', message: 'session not found' });
          const userMsg = { id: 'msg-u-' + n, time: { created: Date.now() }, type: 'user', text: body.text };
          sess.messages.unshift(userMsg);
          setTimeout(() => {
            if (failReply) {
              sess.messages.unshift({ id: 'msg-i-' + n, time: { created: Date.now() }, type: 'idle', outcome: 'failed', error: { type: 'provider.no-route', message: 'Unsupported package for stub/test-model: ' } });
            } else {
              sess.messages.unshift({ id: 'msg-a-' + n, time: { created: Date.now(), completed: Date.now() }, type: 'assistant', content: [{ type: 'text', text: 'Xin chào, tôi là Vy.' }], finish: 'stop' });
            }
          }, 30);
          return send(200, { data: { id: userMsg.id, sessionID: pm[1], time: { created: Date.now() }, type: 'user', payload: { text: body.text }, delivery: 'steer' } });
        }
        const mm = req.url.match(/^\/api\/session\/([^/]+)\/message$/);
        if (req.method === 'GET' && mm) {
          seen.messages++;
          const sess = sessions.get(mm[1]);
          if (!sess) return send(404, { _tag: 'SessionNotFoundError', message: 'session not found' });
          return send(200, { data: sess.messages, cursor: {} });
        }
        const sm = req.url.match(/^\/api\/session\/([^/]+)\/model$/);
        if (req.method === 'POST' && sm) {
          seen.switches.push(JSON.parse(s || '{}'));
          if (!sessions.has(sm[1])) return send(404, { _tag: 'SessionNotFoundError', message: 'session not found' });
          res.writeHead(204); res.end(); return;
        }
      }
      return send(404, { error: 'not found' });
    });
  });
  return { server, seen };
}

test('detect: v2 authed, v2 with a wrong password, v1, and nothing at all', async t => {
  const v2 = fakeOpencodeV2();
  const v2Port = await listen(v2.server);
  try {
    assert.deepEqual(await createOpencode({ url: `http://127.0.0.1:${v2Port}`, password: 'test-password' }).detect(), { version: 'v2', authed: true });
    assert.deepEqual(await createOpencode({ url: `http://127.0.0.1:${v2Port}`, password: 'wrong' }).detect(), { version: 'v2', authed: false });
    assert.deepEqual(await createOpencode({ url: `http://127.0.0.1:${v2Port}` }).detect(), { version: 'v2', authed: false });
  } finally { v2.server.close(); }
  const v1 = fakeOpencode();
  const v1Port = await listen(v1.server);
  try {
    assert.deepEqual(await createOpencode({ url: `http://127.0.0.1:${v1Port}` }).detect(), { version: 'v1', authed: true });
  } finally { v1.server.close(); }
  const probe = http.createServer(() => {});
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const deadPort = probe.address().port;
  probe.close();
  assert.deepEqual(await createOpencode({ url: `http://127.0.0.1:${deadPort}` }).detect(), { version: null, authed: false });
});

test('extractTextV2: finished reply, still-running, failed turn, empty', () => {
  const done = { type: 'assistant', time: { created: 1, completed: 2 }, content: [{ type: 'text', text: 'Xin chào' }, { type: 'reasoning', text: 'suy nghi' }, { type: 'tool', name: 'x' }, { type: 'text', text: ', tôi là Vy.' }], finish: 'stop' };
  assert.equal(extractTextV2([done]), 'Xin chào, tôi là Vy.');
  assert.equal(extractTextV2([{ type: 'assistant', time: { created: 1 }, content: [{ type: 'text', text: 'dang go...' }] }]), null);
  assert.equal(extractTextV2([]), null);
  assert.equal(extractTextV2([{ type: 'user', text: 'Chào bạn' }]), null);
  assert.throws(() => extractTextV2([{ type: 'idle', outcome: 'failed', error: { type: 'provider.no-route', message: 'Unsupported package for stub/test-model: ' } }]), /Unsupported package/);
  // a completed idle marker after the reply does not hide it
  assert.equal(extractTextV2([{ type: 'idle', outcome: 'completed' }, done]), 'Xin chào, tôi là Vy.');
});

test('v2 ask: model goes in at creation as {providerID, id}, system is prepended, poll returns the reply', async t => {
  const fake = fakeOpencodeV2();
  const fakePort = await listen(fake.server);
  try {
    const opencode = createOpencode({ url: `http://127.0.0.1:${fakePort}`, password: 'test-password' });
    const asker = createSessionAsker({ opencode, pollMs: 10, pollTimeoutMs: 5000 });
    const r = await asker.ask([{ role: 'system', content: 'Bạn là Vy.' }, { role: 'user', content: 'Chào bạn' }]);
    assert.equal(r.text, 'Xin chào, tôi là Vy.');
    assert.equal(fake.seen.creates.length, 1);
    assert.deepEqual(fake.seen.creates[0].model, { providerID: 'xingchi', id: 'gpt-6.1-sol' });
    assert.equal(fake.seen.prompts.length, 1);
    assert.equal(fake.seen.prompts[0].text, 'Bạn là Vy.\n\nChào bạn');
    assert.ok(fake.seen.messages >= 1, 'the reply is polled from the message list');
  } finally { fake.server.close(); }
});

test('v2 ask: a model change switches the session model, it does not create a new one', async t => {
  const fake = fakeOpencodeV2();
  const fakePort = await listen(fake.server);
  try {
    const opencode = createOpencode({ url: `http://127.0.0.1:${fakePort}`, password: 'test-password' });
    const asker = createSessionAsker({ opencode, pollMs: 10, pollTimeoutMs: 5000 });
    await asker.ask([{ role: 'user', content: 'Chào bạn' }], 'xingchi/gpt-6.1-sol');
    await asker.ask([{ role: 'user', content: 'Kể tiếp đi' }], 'gemini/gemini-3-flash');
    assert.equal(fake.seen.creates.length, 1);
    assert.equal(fake.seen.switches.length, 1);
    assert.deepEqual(fake.seen.switches[0], { model: { providerID: 'gemini', id: 'gemini-3-flash' } });
  } finally { fake.server.close(); }
});

test('v2 ask: a failed turn surfaces the provider error instead of polling forever', async t => {
  const fake = fakeOpencodeV2({ failReply: true });
  const fakePort = await listen(fake.server);
  try {
    const opencode = createOpencode({ url: `http://127.0.0.1:${fakePort}`, password: 'test-password' });
    const asker = createSessionAsker({ opencode, pollMs: 10, pollTimeoutMs: 5000 });
    const start = Date.now();
    await assert.rejects(() => asker.ask([{ role: 'user', content: 'Chào bạn' }]), /Unsupported package for stub\/test-model/);
    assert.ok(Date.now() - start < 4000, 'the failed idle marker ends the wait at once');
  } finally { fake.server.close(); }
});

test('v2 ask: a wrong password reports 401 with the auth hint', async t => {
  const fake = fakeOpencodeV2();
  const fakePort = await listen(fake.server);
  try {
    const opencode = createOpencode({ url: `http://127.0.0.1:${fakePort}`, password: 'wrong' });
    const asker = createSessionAsker({ opencode });
    await assert.rejects(() => asker.ask([{ role: 'user', content: 'Chào bạn' }]), /opencode 401 \(tao phien POST \/api\/session\):.*serve v2, sai mat khau/);
  } finally { fake.server.close(); }
});

test('bridge e2e v2: chat/completions in, the fake v2 serve answers, OpenAI shape out', async t => {
  const fake = fakeOpencodeV2();
  const fakePort = await listen(fake.server);
  try {
    const opencode = createOpencode({ url: `http://127.0.0.1:${fakePort}`, password: 'test-password' });
    const bridge = createBridge({ opencode, url: `http://127.0.0.1:${fakePort}`, password: 'test-password' });
    const server = http.createServer((req, res) => bridge.handle(req, res));
    const port = await listen(server);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'xingchi/gpt-6.1-sol', messages: [{ role: 'system', content: 'Bạn là Vy.' }, { role: 'user', content: 'Chào bạn' }] }) });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).choices[0].message.content, 'Xin chào, tôi là Vy.');
      assert.equal(fake.seen.creates.length, 1);
    } finally { server.close(); }
  } finally { fake.server.close(); }
});

test('bridge: a foreign v2 serve on the port makes it start its own on the next port', async t => {
  // the configured port holds a v2 serve whose password the bridge does not
  // have (the user started it by hand). The bridge must not fight it for the
  // port: it starts its own serve on the next port, with its own password.
  const foreignPort = 49190;
  const ownPort = foreignPort + 1;
  const foreign = fakeOpencodeV2({ password: 'somebody-elses-password' });
  const own = fakeOpencodeV2({ password: 'bridge-pw' });
  await new Promise(r => foreign.server.listen(foreignPort, '127.0.0.1', r));
  await new Promise(r => own.server.listen(ownPort, '127.0.0.1', r));
  try {
    const opencode = createOpencode({ url: `http://127.0.0.1:${foreignPort}` });
    const spawned = {};
    const spawnFn = (bin, args, opts) => {
      spawned.bin = bin; spawned.args = args; spawned.opts = opts;
      return { on() {} };
    };
    const bridge = createBridge({ opencode, url: `http://127.0.0.1:${foreignPort}`, password: 'bridge-pw', spawnFn, waitMs: 5000, sleep: ms => new Promise(r => setTimeout(r, 10)) });
    assert.equal(await bridge.ensureServe(), true);
    assert.deepEqual(spawned.args, ['serve', '--port', String(ownPort), '--hostname', '127.0.0.1']);
    assert.equal(spawned.opts.env.OPENCODE_PASSWORD, 'bridge-pw');
    assert.equal(bridge.opencodeUrl, `http://127.0.0.1:${ownPort}`);
  } finally {
    foreign.server.close();
    own.server.close();
  }
});
