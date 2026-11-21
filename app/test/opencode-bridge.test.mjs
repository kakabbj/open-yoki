// The OpenCode bridge (v7): OpenAI-compatible /v1/chat/completions in, one persistent
// OpenCode session out. Tested against a fake OpenCode server — no real OpenCode, no key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { toPrompt, splitModel, extractText, openaiReply, createOpencode, createSessionAsker, createBridge } from '../../tools/opencode-bridge/bridge.mjs';

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
