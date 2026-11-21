// Operator AI keys, set from the web room's settings panel instead of the command line.
// Stored in <data>/keys.json (0600). The browser never sees a key value, only whether one
// is saved; env vars still work as a fallback when nothing is saved for a provider.
// The brain key applies live (the ask client is resolved per call in index.mjs); the
// voice and face keys apply when the server next starts.
import fs from 'node:fs';
import path from 'node:path';
import { LIVE_MODES } from './showacts.mjs';

// kind: 'chat' = OpenAI-compatible /chat/completions, 'anthropic' = Messages API,
// 'responses' = /v1/responses (Xingchi). base/model are the defaults; the panel can
// override the model per provider and the base URL for 9Router / custom.
export const PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter', env: 'OPENROUTER_API_KEY', kind: 'chat', base: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat' },
  { id: 'gemini', name: 'Google Gemini', env: 'GEMINI_API_KEY', kind: 'chat', base: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.5-flash' },
  { id: 'openai', name: 'OpenAI', env: 'OPENAI_API_KEY', kind: 'chat', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'anthropic', name: 'Anthropic', env: 'ANTHROPIC_API_KEY', kind: 'anthropic', base: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  { id: 'deepseek', name: 'DeepSeek', env: 'DEEPSEEK_API_KEY', kind: 'chat', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'xingchi', name: 'Xingchi', env: 'XINGCHI_API_KEY', kind: 'responses', base: 'https://api.xingchiapi.com/v1', model: 'gpt-6.1-sol' },
  { id: 'router9', name: '9Router', env: 'ROUTER9_API_KEY', kind: 'chat', base: 'http://127.0.0.1:20128/v1', model: 'gemini/gemini-3-flash' },
  // OpenCode (v7): no key of its own — the key lives in OpenCode, the brain talks to it
  // through the local bridge (tools/opencode-bridge, 127.0.0.1:20129). The dummy key
  // below is only so brain() resolves; it is sent to the bridge on localhost, which
  // ignores Authorization entirely.
  { id: 'opencode', name: 'OpenCode (qua cầu nối)', env: null, kind: 'chat', base: 'http://127.0.0.1:20129/v1', model: 'xingchi/gpt-6.1-sol' },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', env: null, kind: 'chat', base: '', model: '' },
];
export const providerById = id => PROVIDERS.find(p => p.id === id) || null;

const isStr = v => typeof v === 'string';
const isHttp = v => v === '' || /^https?:\/\/[^/\s]+/.test(v);

export function createKeyStore({ file, env = process.env, idolModel = null }) {
  let cur = read();
  function read() {
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : {}; }
    catch { return {}; }
  }
  const str = (o, k) => isStr(o?.[k]) ? o[k] : '';
  const keyFor = id => {
    const p = providerById(id);
    if (!p) return null;
    if (id === 'opencode') return 'opencode-local';
    if (str(cur.keys, id)) return cur.keys[id];
    if (p.env && env[p.env]) return env[p.env];
    if (id === 'deepseek' && env.HEART_KEY_DS) return env.HEART_KEY_DS;
    return null;
  };
  const modelFor = id => {
    const p = providerById(id);
    if (!p) return '';
    if (str(cur.models, id)) return cur.models[id];
    if (id === 'openrouter' && idolModel) return idolModel;
    return p.model;
  };
  const baseFor = id => {
    const p = providerById(id);
    if (!p) return '';
    return str(cur.bases, id) || p.base;
  };
  // What the brain runs on for one provider, or null when no key is set for it.
  const brainFor = id => {
    const p = providerById(id);
    if (!p) return null;
    const key = keyFor(id);
    if (!key) return null;
    return { provider: id, kind: p.kind, key, model: modelFor(id), base: baseFor(id) };
  };
  // What the brain runs on right now, or null when no key is set for the chosen provider.
  const brain = () => brainFor(str(cur, 'provider') || 'openrouter');
  // Voice and face keys, settings first, env as fallback (applied on restart).
  const voiceKeys = () => ({
    volcKey: str(cur.voice, 'volcKey') || env.VOLC_API_KEY || null,
    voiceId: str(cur.voice, 'voiceId') || env.DOUBAO_VOICE_ID || null,
    viduKey: str(cur.voice, 'viduKey') || env.VIDU_KEY || null,
  });
  const status = () => ({
    provider: str(cur, 'provider') || 'openrouter',
    providers: PROVIDERS.map(p => ({ id: p.id, name: p.name, kind: p.kind, configured: !!keyFor(p.id), model: modelFor(p.id), defaultModel: p.model, base: baseFor(p.id), defaultBase: p.base })),
    voice: { volcConfigured: !!(str(cur.voice, 'volcKey') || env.VOLC_API_KEY), voiceId: str(cur.voice, 'voiceId') || env.DOUBAO_VOICE_ID || '', viduConfigured: !!(str(cur.voice, 'viduKey') || env.VIDU_KEY) },
    liveMode: liveMode(),
  });
  // Which show act runs on air right now ('all' when nothing was ever picked).
  const liveMode = () => LIVE_MODES.includes(cur.liveMode) ? cur.liveMode : 'all';
  // Merge a patch from the settings panel. A key value of '' clears the saved key
  // (an absent key leaves it alone). Throws on anything malformed.
  const save = patch => {
    if (!patch || typeof patch !== 'object') throw new Error('bad settings');
    const next = { provider: cur.provider || 'openrouter', models: { ...(cur.models || {}) }, keys: { ...(cur.keys || {}) }, bases: { ...(cur.bases || {}) }, voice: { ...(cur.voice || {}) } };
    if (patch.provider !== undefined) {
      if (!providerById(patch.provider)) throw new Error('unknown provider');
      next.provider = patch.provider;
    }
    if (patch.liveMode !== undefined) {
      if (!LIVE_MODES.includes(patch.liveMode)) throw new Error('unknown live mode');
      next.liveMode = patch.liveMode;
    }
    for (const [field, limit] of [['models', 200], ['keys', 500], ['bases', 300]]) {
      const o = patch[field];
      if (o === undefined) continue;
      if (!o || typeof o !== 'object') throw new Error('bad settings');
      for (const [id, v] of Object.entries(o)) {
        if (!providerById(id)) throw new Error('unknown provider');
        if (!isStr(v) || v.length > limit) throw new Error('bad settings');
        if (field === 'bases' && !isHttp(v)) throw new Error('bad base url');
        if (v === '') delete next[field][id]; else next[field][id] = v;
      }
    }
    if (patch.voice !== undefined) {
      const o = patch.voice;
      if (!o || typeof o !== 'object') throw new Error('bad settings');
      for (const [k, limit] of [['volcKey', 500], ['voiceId', 100], ['viduKey', 500]]) {
        if (o[k] === undefined) continue;
        if (!isStr(o[k]) || o[k].length > limit) throw new Error('bad settings');
        if (o[k] === '') delete next.voice[k]; else next.voice[k] = o[k];
      }
    }
    // path.dirname, not a /-only regex: on Windows the path has \ separators and the
    // regex would match nothing (the xlearn EISDIR bug all over again).
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    cur = next;
    return status();
  };
  return { keyFor, modelFor, baseFor, brain, brainFor, voiceKeys, status, save, liveMode };
}
