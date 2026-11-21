// Bridge: lets open-yoki talk to an AI through OpenCode, whose key lives in OpenCode.
// Xingchi blocks direct calls (403, "only programming clients"), but OpenCode is on its
// allowed list — so the brain asks this bridge (OpenAI-compatible /v1/chat/completions on
// 127.0.0.1:20129) and the bridge forwards each line to a persistent OpenCode session
// (opencode serve on 127.0.0.1:4096). The bridge holds no key at all: OpenCode owns the
// Xingchi key the user already set up there. Run it with: node bridge.mjs
// (it starts `opencode serve` itself when none is listening). No restart of open-yoki
// is needed after starting the bridge — the OpenCode provider just starts answering.
//
// OpenCode v2 (the user's 2.3.2) moved the API under /api and put a password on it:
// POST /api/session creates a session, POST /api/session/:id/prompt admits a line
// (it only returns the admitted user message — the reply comes later), and
// GET /api/session/:id/message lists the messages; the serve prints a random
// "server password" on startup, or takes OPENCODE_PASSWORD. The bridge therefore
// speaks BOTH APIs: it detects v1 (GET /session returns a JSON array) vs v2
// (GET /api/session answers 200 with auth, 401 without), sets the model at
// session creation on v2 (Model.Ref is {providerID, id}, not {providerID, modelID}),
// and polls the message list until the assistant message is complete.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

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

// Minimal client for the OpenCode server API (opencode serve). v1 and v2 differ in
// paths, shapes and auth, so every call goes through detect() first (cached by the
// asker): v1 answers GET /session with a JSON array and needs no auth; v2 answers
// GET /api/session with {data:[...]} when the Basic password (user "opencode") is
// right and 401 without it, while its GET /session only serves the web UI (HTML)
// and its POST /session 405s with an empty body — the exact 405 the user hit.
export function createOpencode({ url = DEFAULT_OPENCODE_URL, fetchImpl = fetch, password = null } = {}) {
  let base = String(url).replace(/\/$/, '');
  let pw = password;
  function authHeaders() {
    return pw ? { authorization: 'Basic ' + Buffer.from('opencode:' + pw).toString('base64') } : {};
  }
  async function call(where, path, opts = {}) {
    const r = await fetchImpl(base + path, { headers: { 'content-type': 'application/json', ...authHeaders() }, ...opts });
    const text = await r.text().catch(() => '');
    let j = {};
    try { j = JSON.parse(text); } catch {}
    if (!r.ok) {
      const detail = String(j.message || j.error?.message || j.error || text || '').trim();
      throw new Error(`opencode ${r.status} (${where}): ${detail}`.slice(0, 200));
    }
    return j;
  }
  async function detect() {
    // v2 first: /api/session answers 200 (password right) or 401 (wrong/missing)
    try {
      const r = await fetchImpl(base + '/api/session', { headers: authHeaders() });
      if (r.status === 200) {
        const text = await r.text().catch(() => '');
        let ok = false;
        try { ok = Array.isArray(JSON.parse(text).data); } catch {}
        if (ok) return { version: 'v2', authed: true };
      } else if (r.status === 401) {
        return { version: 'v2', authed: false };
      }
    } catch {}
    // v1: GET /session returns the session list as a bare JSON array
    try {
      const r = await fetchImpl(base + '/session');
      const text = await r.text().catch(() => '');
      let isArray = false;
      try { isArray = Array.isArray(JSON.parse(text)); } catch {}
      if (r.status === 200 && isArray) return { version: 'v1', authed: true };
    } catch {}
    return { version: null, authed: false };
  }
  return {
    get url() { return base; },
    setUrl(u) { base = String(u).replace(/\/$/, ''); },
    setPassword(p) { pw = p || null; },
    get password() { return pw; },
    async up() { return (await detect()).version !== null; },
    detect,
    // v1 (1.x): POST /session {title} -> {id}; POST /session/:id/message is
    // synchronous and returns the finished reply ({info, parts}).
    createSession: () => call('tao phien POST /session', '/session', { method: 'POST', body: JSON.stringify({ title: 'open-livestream' }) }),
    prompt: (id, body) => call('gui tin POST /session/{id}/message', `/session/${encodeURIComponent(id)}/message`, { method: 'POST', body: JSON.stringify(body) }),
    // v2 (2.x): POST /api/session {title, model:{providerID, id}} -> {data:{id}};
    // POST /api/session/:id/prompt {text} only admits the line -> {data:{...user}};
    // the reply is read back from GET /api/session/:id/message.
    createSessionV2: (model) => call('tao phien POST /api/session', '/api/session', { method: 'POST', body: JSON.stringify({ title: 'open-livestream', model: { providerID: model.providerID, id: model.modelID } }) }).then(j => j.data),
    promptV2: (id, text) => call('gui tin POST /api/session/{id}/prompt', `/api/session/${encodeURIComponent(id)}/prompt`, { method: 'POST', body: JSON.stringify({ text }) }).then(j => j.data),
    messagesV2: (id) => call('doc tin GET /api/session/{id}/message', `/api/session/${encodeURIComponent(id)}/message`).then(j => j.data || []),
    switchModelV2: (id, model) => call('doi model POST /api/session/{id}/model', `/api/session/${encodeURIComponent(id)}/model`, { method: 'POST', body: JSON.stringify({ model: { providerID: model.providerID, id: model.modelID } }) }).then(() => {}),
  };
}

// v2 messages come back newest-first. The latest assistant message, once its
// time.completed is set, is the finished reply (text parts only — reasoning and
// tool calls are dropped, as in v1). A failed idle marker after the prompt means
// the turn died in the serve (e.g. the provider refused the model): surface that
// instead of polling forever. Returns the text, or null while it is still running.
export function extractTextV2(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (const m of list) {
    if (m?.type === 'idle' && m?.outcome === 'failed') {
      const e = m.error || {};
      throw new Error(`opencode failed: ${[e.type, e.message].filter(Boolean).join(' ')}`.trim().slice(0, 200));
    }
    if (m?.type === 'idle') continue;
    if (m?.type === 'assistant') {
      if (m?.time?.completed || m?.finish) {
        return (m.content || []).filter(p => p?.type === 'text').map(p => p.text || '').join('');
      }
      return null;
    }
  }
  return null;
}

// One long-lived OpenCode session for the whole live: the host keeps the thread, so a
// follow-up line ("kể tiếp đi") still knows what came before. A 404 means the server
// restarted under us — recreate the session once and retry that line.
export function createSessionAsker({ opencode, model = DEFAULT_MODEL, pollMs = 1000, pollTimeoutMs = 180000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let sessionId = null;
  let sessionModel = null; // the model the session currently runs on (v2 only)
  let version = null; // 'v1' | 'v2', detected on first use
  async function detectVersion() {
    if (version) return version;
    const d = typeof opencode.detect === 'function' ? await opencode.detect() : { version: 'v1', authed: true };
    version = d.version;
    return version;
  }
  async function ensureSession(useModel) {
    if (sessionId) {
      if (version === 'v2' && sessionModel && (useModel.providerID !== sessionModel.providerID || useModel.modelID !== sessionModel.modelID)) {
        await opencode.switchModelV2(sessionId, useModel);
        sessionModel = useModel;
      }
      return sessionId;
    }
    const v = await detectVersion();
    if (v === 'v2') {
      const s = await opencode.createSessionV2(useModel);
      sessionId = s.id;
      sessionModel = useModel;
    } else if (v === 'v1') {
      const s = await opencode.createSession();
      sessionId = s.id;
    } else {
      throw new Error('opencode serve khong tra loi — chay lenh: opencode serve (xem huong dan)');
    }
    return sessionId;
  }
  async function ask(messages, modelOverride) {
    const useModel = splitModel(modelOverride || model);
    const { system, text } = toPrompt(messages);
    try {
      const v = await detectVersion();
      if (v === 'v2') {
        // v2 admits the prompt and runs the agent in the background: poll the
        // message list until the assistant message is complete. v2 has no
        // per-prompt system field, so the persona goes in front of the text.
        const fullText = system ? system + '\n\n' + text : text;
        for (let attempt = 0; attempt < 2; attempt++) {
          const id = await ensureSession(useModel);
          try {
            await opencode.promptV2(id, fullText);
          } catch (err) {
            if (/opencode 404/.test(String(err?.message || '')) && attempt === 0) { sessionId = null; sessionModel = null; continue; }
            throw err;
          }
          const deadline = Date.now() + pollTimeoutMs;
          while (true) {
            let out;
            try {
              out = extractTextV2(await opencode.messagesV2(id));
            } catch (err) {
              if (/opencode 404/.test(String(err?.message || '')) && attempt === 0) { sessionId = null; sessionModel = null; break; }
              throw err;
            }
            if (out !== null) return { text: out, model: modelOverride || model };
            if (Date.now() > deadline) throw new Error('opencode timed out waiting for the reply');
            await sleep(pollMs);
          }
        }
        throw new Error('opencode session lost');
      }
      // v1: one synchronous prompt call, model set per prompt.
      const body = { model: { providerID: useModel.providerID, modelID: useModel.modelID }, parts: [{ type: 'text', text }], tools: {} };
      if (system) body.system = system;
      for (let attempt = 0; attempt < 2; attempt++) {
        const id = await ensureSession(useModel);
        try {
          const r = await opencode.prompt(id, body);
          return { text: extractText(r.parts), model: modelOverride || model };
        } catch (err) {
          if (/opencode 404/.test(String(err?.message || '')) && attempt === 0) { sessionId = null; continue; }
          throw err;
        }
      }
      throw new Error('opencode session lost');
    } catch (err) {
      // A serve failure says little by itself — add which API the serve speaks
      // and whether our password works, so a 401 is not mistaken for a dead serve.
      if (/^opencode \d+/.test(String(err?.message || '')) && typeof opencode.detect === 'function') {
        const d = await opencode.detect().catch(() => ({ version: null, authed: false }));
        const info = d.version === 'v2' ? (d.authed ? 'serve v2, da xac thuc' : 'serve v2, sai mat khau')
          : d.version === 'v1' ? 'serve v1' : 'serve khong tra loi';
        throw new Error(`${err.message} — ${info}`.slice(0, 240));
      }
      throw err;
    }
  }
  return { ask, get sessionId() { return sessionId; } };
}

// Where the `opencode` command lives. On Windows an npm-global install only puts
// `%APPDATA%\npm\opencode.cmd` on PATH — and since Node 18.20.2 (CVE-2024-27980)
// spawning a .cmd/.bat without shell:true fails with EINVAL, so a plain
// spawn('opencode') dies at once and the bridge reports 502 forever, even though
// `where opencode` in cmd finds it fine. Resolve it here, mirroring how cmd
// searches PATH (each directory: .exe first, then .cmd/.bat): a real .exe wins
// and spawns plainly, a .cmd/.bat must go through cmd.exe (shell:true).
export function resolveOpencodeBin({ bin, env = process.env, platform = process.platform, exists = fs.existsSync } = {}) {
  if (bin) return { bin, shell: /\.(cmd|bat)$/i.test(bin) };
  if (platform !== 'win32') return { bin: 'opencode', shell: false };
  const pathDirs = String(env.PATH || '').split(path.delimiter).map(d => d.replace(/^"|"$/g, '')).filter(Boolean);
  for (const d of pathDirs) {
    if (exists(path.join(d, 'opencode.exe'))) return { bin: 'opencode', shell: false };
    for (const ext of ['opencode.cmd', 'opencode.bat']) {
      const p = path.join(d, ext);
      if (exists(p)) return { bin: p, shell: true };
    }
  }
  const appdata = env.APPDATA || '';
  const cmdPath = appdata ? path.join(appdata, 'npm', 'opencode.cmd') : '';
  if (cmdPath && exists(cmdPath)) return { bin: cmdPath, shell: true };
  return null;
}

// The bridge itself: POST /v1/chat/completions (OpenAI shape in, OpenAI shape out)
// and GET /health. Started with no args it serves on 127.0.0.1:20129 and starts
// `opencode serve` when nothing answers on the OpenCode URL.
export function createBridge({ opencode, model = DEFAULT_MODEL, url = DEFAULT_OPENCODE_URL, bin = null, password = null, resolveBin = resolveOpencodeBin, spawnFn = spawn, waitMs = 20000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const asker = createSessionAsker({ opencode, model });
  let serveChild = null;
  let serveError = null; // null | 'not_found' | 'spawn_failed' | 'timeout' | 'auth_failed'
  let serveDied = false;
  // The password the serve must accept. A v2 serve prints a random one on
  // startup, or takes OPENCODE_PASSWORD — the bridge sets a fixed one when it
  // spawns the serve, so it can always authenticate to its own serve. A user
  // who starts the serve by hand can set the same OPENCODE_PASSWORD for the
  // bridge (env or --opencode-password) instead of copying the printed one.
  let servePassword = password || process.env.OPENCODE_PASSWORD || null;
  async function waitForServe(deadline) {
    while (Date.now() < deadline) {
      const d = await opencode.detect();
      if (d.version === 'v1' || (d.version === 'v2' && d.authed)) { serveError = null; return true; }
      if (d.version === 'v2' && !d.authed) { serveError = 'auth_failed'; return false; }
      if (serveDied) return false;
      await sleep(500);
    }
    serveError = 'timeout';
    return false;
  }
  async function startServe(port, { bin: binOverride } = {}) {
    const resolved = resolveBin({ bin: binOverride || bin });
    if (!resolved) { serveError = 'not_found'; return false; }
    if (!servePassword) servePassword = crypto.randomBytes(24).toString('base64url');
    opencode.setPassword(servePassword);
    opencode.setUrl(`http://127.0.0.1:${port}`);
    const workdir = path.join(os.tmpdir(), 'open-livestream-opencode');
    fs.mkdirSync(workdir, { recursive: true });
    // The agent runs in an empty throwaway directory on purpose: even if the model ever
    // reaches for a tool, there is no project here to read or change.
    serveDied = false;
    serveError = null;
    let child;
    try {
      child = spawnFn(resolved.bin, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], { cwd: workdir, stdio: 'ignore', env: { ...process.env, OPENCODE_PASSWORD: servePassword }, ...(resolved.shell ? { shell: true } : {}) });
    } catch {
      serveError = 'spawn_failed';
      return false;
    }
    // keep the child in a local: the error handler below may run at once
    // (a failing spawn reports immediately) and clear serveChild before the
    // next line attaches the exit handler.
    serveChild = child;
    child.on('error', () => { serveDied = true; serveError = 'spawn_failed'; serveChild = null; });
    child.on('exit', () => { serveDied = true; if (!serveError) serveError = 'spawn_failed'; serveChild = null; });
    return waitForServe(Date.now() + waitMs);
  }
  async function ensureServe({ bin: binOverride, url: urlOverride } = {}) {
    const baseUrl = urlOverride || url;
    // 1. Is there already a usable serve on the configured URL?
    const d = await opencode.detect();
    if (d.version === 'v1' || (d.version === 'v2' && d.authed)) { serveError = null; return true; }
    if (serveChild) return waitForServe(Date.now() + waitMs); // a start is already in progress
    // 2. Nothing usable. A v2 serve that will not take our password was started
    //    by hand with a random password — do not fight it for its port, start
    //    our own serve on the next port instead (it reads the same global
    //    OpenCode config, so the user's providers still apply).
    const startPort = Number(new URL(baseUrl).port || 4096);
    const tryPorts = d.version === 'v2' && !d.authed ? [startPort + 1, startPort + 2, startPort + 3] : [startPort];
    for (const port of tryPorts) {
      if (await startServe(port, { bin: binOverride || bin })) return true;
      if (serveError === 'not_found' || serveError === 'auth_failed') return false;
      if (serveChild) return false; // a serve is starting on this port — do not spawn another
      // the child died at once (port busy, bad binary): try the next port
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
        if (!(await ensureServe())) {
          const msg = serveError === 'not_found'
            ? 'Khong tim thay lenh opencode — cai ban 2: npm install -g @opencode/cli (xem huong dan)'
            : serveError === 'spawn_failed'
              ? 'Khong chay duoc opencode serve — mo cmd go: opencode serve --port 4096 (xem huong dan)'
              : serveError === 'auth_failed'
                ? 'OpenCode dang chay nhung sai mat khau — tat serve dang chay tay roi chay lai cau noi (xem huong dan)'
                : 'OpenCode chua chay — chay lenh: opencode serve (xem huong dan)';
          return send(502, { error: { message: msg, type: 'opencode_down' } });
        }
        const r = await asker.ask(messages, body.model);
        return send(200, openaiReply(r.text, r.model));
      }
      return send(404, { error: { message: 'not found', type: 'not_found' } });
    } catch (err) {
      return send(502, { error: { message: String(err?.message || err).slice(0, 280), type: 'opencode_error' } });
    }
  }
  return { handle, ensureServe, asker, get serveChild() { return serveChild; }, get serveError() { return serveError; }, get opencodeUrl() { return opencode.url; } };
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
  const bin = argVal(process.argv.slice(2), 'bin', 'OPENCODE_BIN', null);
  const password = argVal(process.argv.slice(2), 'opencode-password', 'OPENCODE_PASSWORD', null);
  const opencode = createOpencode({ url, password });
  const bridge = createBridge({ opencode, model, url, bin, password });
  const server = http.createServer((req, res) => bridge.handle(req, res));
  server.listen(port, '127.0.0.1', async () => {
    console.log(`cau noi OpenCode chay o http://127.0.0.1:${port} (model mac dinh ${model})`);
    const up = await bridge.ensureServe();
    if (up) console.log(`da noi duoc OpenCode o ${bridge.opencodeUrl}`);
    else console.log(`chua noi duoc OpenCode o ${url} (${bridge.serveError || 'timeout'}) — chay tay: opencode serve --port ${new URL(url).port || 4096}`);
  });
}
