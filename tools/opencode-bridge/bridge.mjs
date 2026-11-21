// Bridge: lets open-yoki talk to an AI through OpenCode, whose key lives in OpenCode.
// Xingchi blocks direct calls (403, "only programming clients"), but OpenCode is on its
// allowed list — so the brain asks this bridge (OpenAI-compatible /v1/chat/completions on
// 127.0.0.1:20129) and the bridge forwards each line to a persistent OpenCode session
// (opencode serve on 127.0.0.1:4096). The bridge holds no key at all: OpenCode owns the
// Xingchi key the user already set up there. Run it with: node bridge.mjs
// (it starts `opencode serve` itself when none is listening). No restart of open-yoki
// is needed after starting the bridge — the OpenCode provider just starts answering.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 20129;
export const DEFAULT_OPENCODE_URL = 'http://127.0.0.1:4096';
export const DEFAULT_MODEL = 'xingchi/gpt-6.1-sol';

// OpenAI messages -> one OpenCode prompt: system lines become the prompt's system,
// everything else joins into a single user text (the brain sends one system + one user).
export function toPrompt(messages) {
  const sys = [], user = [];
  for (const m of messages || []) {
    const c = String(m?.content ?? '');
    if (!c) continue;
    if (m.role === 'system') sys.push(c);
    else if (m.role === 'assistant') user.push(`Trợ lý: ${c}`);
    else user.push(c);
  }
  return { system: sys.join('\n\n') || undefined, text: user.join('\n') };
}

// 'xingchi/gpt-6.1-sol' -> { providerID: 'xingchi', modelID: 'gpt-6.1-sol' }.
// A bare model id keeps the default provider (the user picks the model in the panel).
export function splitModel(model) {
  const s = String(model || '').trim();
  const i = s.indexOf('/');
  if (i > 0) return { providerID: s.slice(0, i), modelID: s.slice(i + 1) || 'gpt-6.1-sol' };
  return { providerID: DEFAULT_MODEL.split('/')[0], modelID: s || DEFAULT_MODEL.split('/')[1] };
}

// An OpenCode prompt answer is { info, parts }: keep the text parts, in order.
// A reply with no text (only tool calls) yields '' — the brain treats that as a miss
// and falls back, instead of speaking a tool call out loud.
export function extractText(parts) {
  return (parts || []).filter(p => p?.type === 'text').map(p => p.text || '').join('');
}

export function openaiReply(text, model) {
  return {
    id: 'chatcmpl-opencode-' + Date.now().toString(36),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || DEFAULT_MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

// Minimal client for the OpenCode server API (opencode serve). Only the three calls
// the bridge needs: list sessions (to check it is up), create a session, prompt it.
export function createOpencode({ url = DEFAULT_OPENCODE_URL, fetchImpl = fetch } = {}) {
  const base = String(url).replace(/\/$/, '');
  async function call(path, opts = {}) {
    const r = await fetchImpl(base + path, { headers: { 'content-type': 'application/json' }, ...opts });
    let j = {};
    try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error(`opencode ${r.status}: ${String(j.message || j.error?.message || j.error || '')}`.slice(0, 200));
    return j;
  }
  return {
    async up() {
      try { await fetchImpl(base + '/session'); return true; } catch { return false; }
    },
    createSession: () => call('/session', { method: 'POST', body: JSON.stringify({ title: 'open-livestream' }) }),
    prompt: (id, body) => call(`/session/${encodeURIComponent(id)}/message`, { method: 'POST', body: JSON.stringify(body) }),
  };
}

// One long-lived OpenCode session for the whole live: the host keeps the thread, so a
// follow-up line ("kể tiếp đi") still knows what came before. A 404 means the server
// restarted under us — recreate the session once and retry that line.
export function createSessionAsker({ opencode, model = DEFAULT_MODEL } = {}) {
  let sessionId = null;
  async function ensureSession() {
    if (sessionId) return sessionId;
    const s = await opencode.createSession();
    sessionId = s.id;
    return sessionId;
  }
  async function ask(messages, modelOverride) {
    const useModel = modelOverride || model;
    const { system, text } = toPrompt(messages);
    const { providerID, modelID } = splitModel(useModel);
    const body = { model: { providerID, modelID }, parts: [{ type: 'text', text }], tools: {} };
    if (system) body.system = system;
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = await ensureSession();
      try {
        const r = await opencode.prompt(id, body);
        return { text: extractText(r.parts), model: useModel };
      } catch (err) {
        if (/opencode 404/.test(String(err?.message || '')) && attempt === 0) { sessionId = null; continue; }
        throw err;
      }
    }
    throw new Error('opencode session lost');
  }
  return { ask, get sessionId() { return sessionId; } };
}

// The bridge itself: POST /v1/chat/completions (OpenAI shape in, OpenAI shape out)
// and GET /health. Started with no args it serves on 127.0.0.1:20129 and starts
// `opencode serve` when nothing answers on the OpenCode URL.
export function createBridge({ opencode, model = DEFAULT_MODEL, url = DEFAULT_OPENCODE_URL, bin = 'opencode', spawnFn = spawn, waitMs = 20000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const asker = createSessionAsker({ opencode, model });
  let serveChild = null;
  async function ensureServe({ bin: binOverride, url: urlOverride } = {}) {
    const useBin = binOverride || bin;
    const useUrl = urlOverride || url;
    if (await opencode.up()) return true;
    if (serveChild) return false;
    const u = new URL(useUrl);
    const port = u.port || '4096';
    const workdir = path.join(os.tmpdir(), 'open-livestream-opencode');
    fs.mkdirSync(workdir, { recursive: true });
    // The agent runs in an empty throwaway directory on purpose: even if the model ever
    // reaches for a tool, there is no project here to read or change.
    serveChild = spawnFn(useBin, ['serve', '--port', port, '--hostname', '127.0.0.1'], { cwd: workdir, stdio: 'ignore' });
    serveChild.on('error', () => { serveChild = null; });
    serveChild.on('exit', () => { serveChild = null; });
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (await opencode.up()) return true;
      await sleep(500);
    }
    return false;
  }
  async function handle(req, res) {
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    try {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && u.pathname === '/health') {
        return send(200, { ok: true, opencode: await opencode.up(), session: asker.sessionId, model });
      }
      if (req.method === 'POST' && u.pathname === '/v1/chat/completions') {
        const body = await readJson(req, 65536);
        const messages = Array.isArray(body?.messages) ? body.messages : [];
        if (!messages.length) return send(400, { error: { message: 'messages is required', type: 'invalid_request' } });
        if (!(await ensureServe())) return send(502, { error: { message: 'OpenCode chua chay — chay lenh: opencode serve (xem huong dan)', type: 'opencode_down' } });
        const r = await asker.ask(messages, body.model);
        return send(200, openaiReply(r.text, r.model));
      }
      return send(404, { error: { message: 'not found', type: 'not_found' } });
    } catch (err) {
      return send(502, { error: { message: String(err?.message || err).slice(0, 200), type: 'opencode_error' } });
    }
  }
  return { handle, ensureServe, asker, get serveChild() { return serveChild; } };
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => {
      buf += c;
      if (buf.length > limit) { req.destroy(); reject(new Error('body too big')); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(buf || '{}')); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function argVal(argv, name, envName, fallback) {
  const i = argv.indexOf('--' + name);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return process.env[envName] || fallback;
}

import { pathToFileURL } from 'node:url';

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(argVal(process.argv.slice(2), 'port', 'BRIDGE_PORT', DEFAULT_PORT));
  const url = argVal(process.argv.slice(2), 'opencode-url', 'OPENCODE_URL', DEFAULT_OPENCODE_URL);
  const model = argVal(process.argv.slice(2), 'model', 'OPENCODE_MODEL', DEFAULT_MODEL);
  const bin = argVal(process.argv.slice(2), 'bin', 'OPENCODE_BIN', 'opencode');
  const opencode = createOpencode({ url });
  const bridge = createBridge({ opencode, model, url, bin });
  const server = http.createServer((req, res) => bridge.handle(req, res));
  server.listen(port, '127.0.0.1', async () => {
    console.log(`cau noi OpenCode chay o http://127.0.0.1:${port} (model mac dinh ${model})`);
    const up = await bridge.ensureServe();
    console.log(up ? `da noi duoc OpenCode o ${url}` : `chua thay OpenCode o ${url} — chay tay: ${bin} serve --port ${new URL(url).port || 4096}`);
  });
}
