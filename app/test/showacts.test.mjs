// Show acts (v5): quiz, stories, shop, folk songs and the chat commands that start them.
// The brain speaks the events; these tests cover the state machines and the matching, which must
// work with the model off (mock mode) as well as on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { norm, createQuiz, createStoryteller, createShop, findLyrics, parseCommand, priceText, modeAllows, QUIZ_START, STORY_ASK, SING_ASK, SELL_ASK } from '../server/showacts.mjs';
import { SONG_ASK_VI } from '../server/radio.mjs';
import { fallbackLine, promptFor } from '../server/brain.mjs';

const url = f => new URL(f, import.meta.url);
const load = f => JSON.parse(fs.readFileSync(url(f), 'utf8'));

test('norm strips diacritics so "ngua" counts for "ngựa"', () => {
  assert.equal(norm('Ngựa'), 'ngua');
  assert.equal(norm('Sơn Tùng M-TP'), 'son tung m tp');
  assert.equal(norm('Trống cơm!'), 'trong com');
  assert.equal(norm('  Hà   Nội  '), 'ha noi');
});

test('quiz: start, a diacritic-free answer wins, scores pile up, timeout ends the round', () => {
  let t = 1000;
  const quiz = createQuiz({ questions: [{ q: 'Tết 2026 là năm con gì?', a: 'con ngựa', accept: ['ngựa'] }], now: () => t, rand: () => 0, timeoutMs: 60000, cooldownMs: 0 });
  const s = quiz.start('Lan');
  assert.equal(s.question, 'Tết 2026 là năm con gì?');
  assert.equal(quiz.start('Minh').already, true);
  assert.equal(quiz.answer('Huy', 'con vịt'), null);
  const win = quiz.answer('Huy', 'NGUA');
  assert.deepEqual({ winner: win.winner, answer: win.answer, score: win.score }, { winner: 'Huy', answer: 'con ngựa', score: 1 });
  assert.equal(quiz.state().active, false);
  assert.deepEqual(quiz.state().scores, [{ name: 'Huy', points: 1 }]);
  // a fresh round times out on its own
  quiz.start('Lan');
  t += 61000;
  const end = quiz.tick();
  assert.equal(end.answer, 'con ngựa');
  assert.equal(quiz.state().active, false);
});

test('quiz: a round does not start again inside the cooldown', () => {
  let t = 0;
  const quiz = createQuiz({ questions: [{ q: 'q', a: 'a' }], now: () => t, rand: () => 0, timeoutMs: 1000, cooldownMs: 30000 });
  quiz.start();
  t += 2000;
  quiz.tick();
  assert.equal(quiz.start().cooldown, true);
  t += 30000;
  assert.equal(quiz.start().question, 'q');
});

test('storyteller: tells chunk by chunk, then ends; a topic picks the matching story', () => {
  let t = 0;
  const stories = [
    { title: 'Con mèo và cơn mưa', topics: ['mèo', 'mưa'], chunks: ['một', 'hai', 'ba'] },
    { title: 'Chiếc đèn lồng', topics: ['đèn lồng'], chunks: ['x'] },
  ];
  const st = createStoryteller({ stories, now: () => t, rand: () => 0, chunkMs: 25000 });
  const first = st.tell('mèo');
  assert.equal(first.title, 'Con mèo và cơn mưa');
  assert.equal(first.chunk, 'một');
  assert.equal(st.tick(), null);
  t += 26000;
  assert.deepEqual(st.tick(), { title: 'Con mèo và cơn mưa', chunk: 'hai', n: 2, total: 3, done: false });
  t += 26000;
  assert.deepEqual(st.tick(), { title: 'Con mèo và cơn mưa', chunk: 'ba', n: 3, total: 3, done: false });
  t += 26000;
  assert.deepEqual(st.tick(), { title: 'Con mèo và cơn mưa', done: true });
  assert.equal(st.state().active, false);
});

test('shop: finds a product without diacritics and rotates the showcase', () => {
  const shop = createShop({ products: [
    { id: 'ao', name: 'Áo thun Vy Pick', price: 199000, unit: 'đ', link: '', desc: 'áo' },
    { id: 'ly', name: 'Ly sứ Vy', price: 99000, unit: 'đ', link: '', desc: 'ly' },
  ] });
  assert.equal(shop.find('ao thun vy pick').id, 'ao');
  assert.equal(shop.find('ly su').id, 'ly');
  assert.equal(shop.find('xe máy'), null);
  assert.equal(priceText({ price: 199000, unit: 'đ' }), '199.000đ');
  assert.equal(priceText({ price: 0 }), 'chưa niêm giá');
  assert.equal(shop.next().id, 'ao');
  assert.equal(shop.next().id, 'ly');
  assert.equal(shop.next().id, 'ao');
});

test('findLyrics matches a folk song without diacritics', () => {
  const lyrics = [{ title: 'Trống cơm', verse: 'Tình bằng có cái trống cơm' }];
  assert.equal(findLyrics('trong com', lyrics).title, 'Trống cơm');
  assert.equal(findLyrics('ly cay bong', lyrics), null);
});

test('parseCommand routes quiz, story, sing and sell, and leaves plain chat alone', () => {
  let t = 0;
  const quiz = createQuiz({ questions: [{ q: 'q?', a: 'a' }], now: () => t, rand: () => 0 });
  const story = createStoryteller({ stories: [{ title: 'T', topics: [], chunks: ['c1'] }] });
  const shop = createShop({ products: [{ id: 'ao', name: 'Áo thun', price: 1000, unit: 'đ', link: '', desc: '' }] });
  const ctx = { quiz, story, shop, lyrics: [{ title: 'Trống cơm', verse: 'v' }] };
  assert.equal(parseCommand(ctx, 'Lan', 'đố vui').kind, 'quiz');
  assert.equal(parseCommand(ctx, 'Lan', 'kể chuyện').kind, 'story');
  assert.equal(parseCommand(ctx, 'Lan', 'hát bài Trống cơm').kind, 'sing');
  assert.equal(parseCommand(ctx, 'Lan', 'bán hàng').kind, 'sell');
  assert.equal(parseCommand(ctx, 'Lan', 'mua áo thun').product.id, 'ao');
  assert.equal(parseCommand(ctx, 'Lan', 'phim này hay quá'), null);
  assert.equal(parseCommand(ctx, 'Lan', 'hát bài Không Có'), null);
});

test('SONG_ASK_VI matches Vietnamese requests and ignores ordinary chat', () => {
  assert.equal('hát bài Trống cơm'.match(SONG_ASK_VI)[1], 'Trống cơm');
  assert.equal('hát Trống cơm'.match(SONG_ASK_VI)[1], 'Trống cơm');
  assert.equal('mở bài Nơi này có anh'.match(SONG_ASK_VI)[1], 'Nơi này có anh');
  assert.equal('điểm bài Lý cây bông đi'.match(SONG_ASK_VI)[1], 'Lý cây bông');
  assert.equal('nghe hay quá'.match(SONG_ASK_VI), null);
  assert.equal('mở cửa ra'.match(SONG_ASK_VI), null);
  assert.equal('hát bài'.match(SONG_ASK_VI), null);
  assert.equal('phim này hay quá'.match(SONG_ASK_VI), null);
});

test('fallbackLine builds a show-act line from the event, and still picks plain lists', () => {
  const idol = {
    fallback: {
      chat: ['[平静][无][吐槽]Bình luận nhanh quá.'],
      idle: ['[平静][无][吐槽]Không ai nói gì à.'],
      quiz: e => `[开心][拍手][热情]Đố vui nè: ${e.question}`,
      sell: e => `[开心][无][热情]${e.product.name}, giá ${e.priceText}.`,
    },
  };
  assert.equal(fallbackLine(idol, { kind: 'quiz', question: 'q?' }), '[开心][拍手][热情]Đố vui nè: q?');
  assert.equal(fallbackLine(idol, { kind: 'sell', product: { name: 'Áo' }, priceText: '199.000đ' }), '[开心][无][热情]Áo, giá 199.000đ.');
  assert.equal(fallbackLine(idol, { kind: 'chat' }), '[平静][无][吐槽]Bình luận nhanh quá.');
  assert.equal(fallbackLine(idol, { kind: 'idle' }), '[平静][无][吐槽]Không ai nói gì à.');
});

test('promptFor says the quiz, story, song and sell facts', () => {
  const idol = {};
  assert.match(promptFor(idol, { kind: 'quiz', question: 'q?' }).text, /q\?/);
  assert.match(promptFor(idol, { kind: 'quizWin', winner: 'Huy', question: 'q?', answer: 'a', score: 2 }).text, /Huy/);
  assert.match(promptFor(idol, { kind: 'quizEnd', question: 'q?', answer: 'a' }).text, /a/);
  assert.match(promptFor(idol, { kind: 'story', title: 'T', chunk: 'c1', n: 1, total: 3 }).text, /c1/);
  assert.match(promptFor(idol, { kind: 'sing', title: 'Trống cơm', verse: 'v' }).text, /Trống cơm/);
  assert.match(promptFor(idol, { kind: 'song', by: 'Lan', song: { id: 'x', title: 'Bài hay' } }).text, /Bài hay/);
  assert.match(promptFor(idol, { kind: 'sell', product: { name: 'Áo', desc: 'd' }, priceText: '199.000đ' }).text, /199\.000đ/);
});

test('the viet idol data files are shaped right', () => {
  const quiz = load('../idols/viet/quiz.json');
  assert.ok(quiz.length >= 10);
  for (const q of quiz) { assert.ok(q.q && q.a, JSON.stringify(q)); assert.ok((q.accept || []).length >= 1); }
  const stories = load('../idols/viet/stories.json');
  assert.ok(stories.length >= 2);
  for (const s of stories) { assert.ok(s.title && s.chunks.length >= 2); assert.ok(s.chunks.every(c => c.length <= 200)); }
  const products = load('../idols/viet/products.json');
  assert.ok(products.length >= 1);
  for (const p of products) assert.ok(p.id && p.name && Number.isFinite(Number(p.price)));
  const lyrics = load('../idols/viet/lyrics.json');
  assert.ok(lyrics.length >= 2);
  for (const l of lyrics) assert.ok(l.title && l.verse);
});

test('live mode: modeAllows gates each act, chat and joins always pass', () => {
  assert.equal(modeAllows('quiz', 'all'), true);
  assert.equal(modeAllows('quizWin', 'quiz'), true);
  assert.equal(modeAllows('quizEnd', 'quiz'), true);
  assert.equal(modeAllows('quizBusy', 'quiz'), true);
  assert.equal(modeAllows('quiz', 'story'), false);
  assert.equal(modeAllows('story', 'story'), true);
  assert.equal(modeAllows('storyEnd', 'story'), true);
  assert.equal(modeAllows('story', 'quiz'), false);
  assert.equal(modeAllows('sing', 'sing'), true);
  assert.equal(modeAllows('song', 'sing'), true);
  assert.equal(modeAllows('sing', 'sell'), false);
  assert.equal(modeAllows('sell', 'sell'), true);
  assert.equal(modeAllows('sell', 'sing'), false);
  for (const kind of ['quiz', 'story', 'sing', 'song', 'sell']) assert.equal(modeAllows(kind, 'chat'), false);
  assert.equal(modeAllows('chat', 'chat'), true);
  assert.equal(modeAllows('join', 'quiz'), true);
  assert.equal(modeAllows('thanks', 'sell'), true);
  assert.equal(modeAllows(null, 'chat'), true);
});

test('live mode: a switched-off act never starts — the state machine is not even touched', () => {
  const quiz = createQuiz({ questions: [{ q: 'q', a: 'a' }], now: () => 0, rand: () => 0, timeoutMs: 60000, cooldownMs: 0 });
  const story = createStoryteller({ stories: [{ title: 'Chuyện mèo', topics: ['mèo'], chunks: ['c1', 'c2'] }], now: () => 0, rand: () => 0 });
  const shop = createShop({ products: [{ id: 'ao', name: 'Áo thun', price: 199000 }] });
  const lyrics = [{ title: 'Trống cơm', verse: 'v' }];
  const ctx = { quiz, story, shop, lyrics };
  // chat-only: every act command stays plain chat, nothing starts
  assert.equal(parseCommand({ ...ctx, mode: 'chat' }, 'Lan', 'đố vui'), null);
  assert.equal(quiz.state().active, false);
  assert.equal(parseCommand({ ...ctx, mode: 'chat' }, 'Lan', 'kể chuyện mèo'), null);
  assert.equal(story.state().active, false);
  assert.equal(parseCommand({ ...ctx, mode: 'chat' }, 'Lan', 'mua Áo thun'), null);
  assert.equal(parseCommand({ ...ctx, mode: 'chat' }, 'Lan', 'hát bài Trống cơm'), null);
  // quiz-only: only the quiz starts; a story ask starts nothing
  assert.equal(parseCommand({ ...ctx, mode: 'quiz' }, 'Lan', 'kể chuyện mèo'), null);
  assert.equal(story.state().active, false);
  const q = parseCommand({ ...ctx, mode: 'quiz' }, 'Lan', 'đố vui');
  assert.equal(q.kind, 'quiz');
  assert.equal(quiz.state().active, true);
  // story-only: the quiz command is ignored while a quiz round is already running
  assert.equal(parseCommand({ ...ctx, mode: 'story' }, 'Minh', 'đố vui'), null);
  assert.equal(parseCommand({ ...ctx, mode: 'story' }, 'Minh', 'kể chuyện mèo').kind, 'story');
  assert.equal(story.state().active, true);
  // sell-only: the shop rotates only for sell mode
  assert.equal(parseCommand({ ...ctx, mode: 'sing' }, 'Lan', 'mua Áo thun'), null);
  assert.equal(parseCommand({ ...ctx, mode: 'sell' }, 'Lan', 'mua Áo thun').kind, 'sell');
});
