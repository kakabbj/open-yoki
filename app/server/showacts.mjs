// Show acts for a host that does more than talk films: quiz games with the room, short stories,
// selling from her own product list, and singing folk songs by heart. Pure command parsing plus
// small state machines; the brain speaks the events (brain.mjs promptFor + the idol's fallback
// lines speak them in mock mode), the web room reads the state off /api/state. Nothing here
// touches money: selling is a showcase + a buy link, no checkout.
// The quiz answers are matched without diacritics, so "ngua" counts for "ngựa".
export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

// "đố vui" / "chơi game" / "đố đi" — start a quiz round.
export const QUIZ_START = /^\s*(?:đố\s*vui|chơi\s*game|game\s*đố|đố\s*đi|đố\s*nhé|đố\s*tiếp)\s*[!.?~]*\s*$/i;
// "kể chuyện" / "kể chuyện ma" — tell a story, optionally about a topic.
export const STORY_ASK = /^\s*kể\s*chuyện(?:\s+cho\s+nghe)?(?:\s+(.+?))?\s*[!.?~]*\s*$/i;
// "hát bài Trống cơm" — sing a folk song from the lyrics bank (the audio library is songs.mjs).
export const SING_ASK = /^\s*(?:hát|hát\s*bài)\s+(.+?)\s*[!.?~]*\s*$/i;
// "bán hàng" / "sản phẩm" / "mua áo" / "giá bao nhiêu" / "báo giá" — show or ask about a product.
export const SELL_ASK = /^\s*(?:bán\s*hàng|sản\s*phẩm|xem\s*đồ|shop|mua\s*hàng|báo\s*giá|giá\s*bao\s*nhiêu|giá\s+bán)\b/i;
export const SELL_NAME = /^\s*(?:mua|giá|báo\s*giá)\s+(.+?)\s*(?:đi|nhé|nào)?[!.?~]*\s*$/i;

// Live function (v7): 'all' runs every act, 'chat' runs none of them, the rest run
// one act only. Chat commands for a switched-off act stay plain chat.
export const LIVE_MODES = ['all', 'chat', 'quiz', 'story', 'sing', 'sell'];
const MODE_OF_KIND = {
  quiz: 'quiz', quizWin: 'quiz', quizEnd: 'quiz', quizBusy: 'quiz',
  story: 'story', storyEnd: 'story',
  sing: 'sing', song: 'sing',
  sell: 'sell',
};
export function modeAllows(kind, mode) {
  if (!kind) return true;
  if (mode === 'all') return true;
  const need = MODE_OF_KIND[kind];
  if (!need) return true;   // chat, join, thanks... are not acts
  return mode === need;
}

export const priceText = p => Number(p?.price) > 0 ? Number(p.price).toLocaleString('vi-VN') + (p.unit || 'đ') : 'chưa niêm giá';

export function createQuiz({ questions = [], now = () => Date.now(), rand = Math.random, timeoutMs = 60000, cooldownMs = 30000 } = {}) {
  const pool = () => (questions || []).filter(q => q?.q && q?.a);
  let current = null, lastEnd = -Infinity;   // no round has ever ended: the first start is never "too soon"
  const scores = new Map();
  function start(by) {
    if (current) return { already: true, question: current.q };
    if (now() - lastEnd < cooldownMs) return { cooldown: true };
    const qs = pool();
    if (!qs.length) return null;
    const q = qs[Math.floor(rand() * qs.length)];
    current = { q: q.q, a: q.a, accept: q.accept || [], askedAt: now(), by: by || null };
    return { question: current.q };
  }
  function answer(name, text) {
    if (!current) return null;
    const w = norm(text);
    if (!w) return null;
    const right = [current.a, ...current.accept].some(a => { const k = norm(a); return k && (k === w || (k.length >= 2 && w.includes(k) && w.length <= k.length + 12)); });
    if (!right) return null;
    const winner = String(name || '').trim() || 'bạn nào đó';
    scores.set(winner, (scores.get(winner) || 0) + 1);
    const q = current;
    current = null; lastEnd = now();
    return { winner, answer: q.a, score: scores.get(winner), question: q.q };
  }
  function tick() {
    if (current && now() - current.askedAt > timeoutMs) { const q = current; current = null; lastEnd = now(); return { answer: q.a, question: q.q }; }
    return null;
  }
  function state() {
    return {
      active: !!current, question: current?.q || null, askedAt: current?.askedAt || null,
      scores: [...scores.entries()].map(([name, points]) => ({ name, points })).sort((a, b) => b.points - a.points).slice(0, 5),
    };
  }
  return { start, answer, tick, state, get current() { return current; } };
}

export function createStoryteller({ stories = [], now = () => Date.now(), rand = Math.random, chunkMs = 12000 } = {}) {
  const pool = () => (stories || []).filter(s => s?.title && Array.isArray(s.chunks) && s.chunks.length);
  let active = null, lastAt = 0;
  function tell(topic) {
    const ps = pool();
    if (!ps.length) return null;
    const t = norm(topic || '');
    const hit = t && (ps.find(s => (s.topics || []).some(x => { const k = norm(x); return k && (t.includes(k) || k.includes(t)); })) || ps.find(s => norm(s.title).includes(t)));
    const s = hit || ps[Math.floor(rand() * ps.length)];
    active = { title: s.title, chunks: s.chunks, i: 0 };
    lastAt = now();
    return { title: s.title, chunk: s.chunks[0], n: 1, total: s.chunks.length, done: s.chunks.length === 1 };
  }
  function next() {
    if (!active) return null;
    active.i++;
    if (active.i >= active.chunks.length) { const t = active.title; active = null; return { title: t, done: true }; }
    return { title: active.title, chunk: active.chunks[active.i], n: active.i + 1, total: active.chunks.length, done: false };
  }
  // one chunk per chunkMs while a story is running; the brain speaks each chunk as its own line
  function tick() {
    if (!active || now() - lastAt < chunkMs) return null;
    lastAt = now();
    return next();
  }
  function state() { return { active: !!active, title: active?.title || null, n: active ? active.i + 1 : 0, total: active?.chunks.length || 0 }; }
  return { tell, next, tick, state, stop() { active = null; } };
}

export function createShop({ products = [] } = {}) {
  const list = () => (products || []).filter(p => p?.id && p?.name).map(p => ({ id: p.id, name: String(p.name).slice(0, 60), price: Number(p.price) || 0, unit: p.unit || 'đ', link: String(p.link || ''), desc: String(p.desc || '').slice(0, 120) }));
  let i = 0;
  function next() { const l = list(); if (!l.length) return null; const p = l[i % l.length]; i++; return p; }
  function find(q) {
    const w = norm(q);
    if (!w) return null;
    const l = list();
    return l.find(p => norm(p.name) === w) || l.find(p => norm(p.name).includes(w) || (w.length >= 2 && w.includes(norm(p.name)) && norm(p.name).length >= 2)) || null;
  }
  return { list, next, find };
}

export function findLyrics(q, lyrics = []) {
  const w = norm(q);
  if (!w) return null;
  return (lyrics || []).find(l => norm(l.title) === w) || (lyrics || []).find(l => norm(l.title).includes(w) || (w.length >= 2 && w.includes(norm(l.title)) && norm(l.title).length >= 2)) || null;
}

// One chat line -> the brain event it asks for, or null (plain chat). Song requests for the audio
// library are handled by songs.mjs and come first; this is quiz / story / sing / sell.
// Live function (v7): an act that is switched off (mode) is never started here — the
// state machines below (quiz.start, story.tell, shop.next) only run for the picked act,
// so a "đố vui" in chat-only mode starts nothing and stays plain chat.
export function parseCommand({ quiz, story, shop, lyrics = [], mode = 'all' }, name, text) {
  const t = String(text || '').trim();
  if (QUIZ_START.test(t)) {
    if (!modeAllows('quiz', mode)) return null;
    const r = quiz?.start(name);
    if (r?.question) return { kind: 'quiz', question: r.question, by: name };
    if (r?.already) return { kind: 'quizBusy', question: r.question };
    return null;
  }
  const sm = t.match(STORY_ASK);
  if (sm) {
    if (!modeAllows('story', mode)) return null;
    const r = story?.tell(sm[1] || '');
    if (r) return { kind: 'story', title: r.title, chunk: r.chunk, n: r.n, total: r.total };
    return null;
  }
  const gm = t.match(SING_ASK);
  if (gm) {
    if (!modeAllows('sing', mode)) return null;
    const l = findLyrics(gm[1], lyrics);
    if (l) return { kind: 'sing', title: l.title, verse: l.verse };
    return null;
  }
  // A named buy ("mua Áo thun", "giá Ly sứ bao nhiêu") is a sell command only when the name
  // matches a real product — a stray "giá này cao quá" stays plain chat. A generic sell ask
  // ("bán hàng", "giá bao nhiêu") showcases the next product in rotation.
  if (!modeAllows('sell', mode)) return null;
  const nm = t.match(SELL_NAME);
  if (nm) {
    const p = shop?.find(nm[1]);
    if (p) return { kind: 'sell', product: p };
  }
  if (SELL_ASK.test(t)) {
    const p = shop?.next();
    if (p) return { kind: 'sell', product: p };
    return null;
  }
  return null;
}
