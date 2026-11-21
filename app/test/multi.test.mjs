// Multi-platform live (v2, fork kakabbj): one feed to YouTube + Facebook + TikTok,
// one Vietnamese host, one bridge feeding comments from all three.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { readSquare, squareArgs } from '../server/square.mjs';
import { sendComment, MOCK_COMMENTS, PLATFORMS } from '../../tools/live-bridge/bridge.mjs';
import viet from '../idols/viet/config.mjs';
import { placesLine } from '../idols/viet/mouth.mjs';

test('multi-RTMP: square.json with 3 targets, names kept, bad one dropped', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-multi-'));
  const f = path.join(dir, 'square.json');
  writeFileSync(f, JSON.stringify({
    targets: [
      { name: 'youtube', url: 'rtmp://a.rtmp.youtube.com/live2', key: 'yt-key-123' },
      { name: 'facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp', key: 'fb-key-123' },
      { name: 'tiktok', url: 'rtmp://push.tiktok.com/live', key: 'tt-key-123' },
      { name: 'broken', url: 'http://nope', key: 'x' },
    ], size: '1280x720',
  }));
  const c = readSquare(f);
  assert.deepEqual(c.targets.map(t => t.name), ['youtube', 'facebook', 'tiktok']);
  assert.equal(c.target, 'rtmp://a.rtmp.youtube.com/live2/yt-key-123');   // first target, old callers keep working
  assert.deepEqual([c.width, c.height], [1280, 720]);
  // the old single-target shape still works
  writeFileSync(f, JSON.stringify({ url: 'rtmp://push.example.com/live/', key: 'sk-123' }));
  assert.deepEqual(readSquare(f).targets.map(t => t.target), ['rtmp://push.example.com/live/sk-123']);
  writeFileSync(f, JSON.stringify({ targets: [{ name: 'broken', url: 'http://nope', key: 'x' }] }));
  assert.equal(readSquare(f), null);
});

test('multi-RTMP: ffmpeg tee pushes one feed to all targets, tap still works', () => {
  const targets = [
    { name: 'youtube', target: 'rtmp://yt/live/yt-key' },
    { name: 'facebook', target: 'rtmps://fb/rtmp/fb-key' },
    { name: 'tiktok', target: 'rtmp://tt/live/tt-key' },
  ];
  const a = squareArgs({ targets, fps: 24, kbps: 3000 });
  assert.equal(a[a.indexOf('-f') + 1], 'tee');
  const tee = a[a.indexOf('tee') + 1];
  for (const t of targets) assert.ok(tee.includes(`[f=flv]${t.target}`), 'tee must push to ' + t.name);
  const a2 = squareArgs({ targets, tap: '/tmp/t.ts' });
  assert.ok(a2[a2.indexOf('tee') + 1].includes('[f=mpegts]/tmp/t.ts'));
  // one target: unchanged, plain flv, no tee
  assert.deepEqual(squareArgs({ target: 'rtmp://h/live/k' }).slice(-3), ['-f', 'flv', 'rtmp://h/live/k']);
});

test('viet idol: tiếng Việt, múi giờ VN, 3 nền tảng, không còn crypto', () => {
  assert.equal(viet.id, 'viet');
  assert.equal(viet.name, 'Vy');
  assert.equal(viet.lang, 'vi');
  assert.equal(viet.tz, 7);
  assert.ok(viet.youtube && viet.facebook && viet.tiktok, '3 places must exist');
  assert.match(viet.persona, /Vy/);
  assert.doesNotMatch(viet.persona, /币安广场直播/);
  // places line lists the three platforms once handles are filled in
  const line = placesLine({ youtube: { handle: '@vy' }, facebook: { handle: 'Vy' }, tiktok: { handle: '@vy' }, showTime: 'mỗi tối 8 giờ' });
  assert.match(line, /YouTube @vy/);
  assert.match(line, /Facebook Vy/);
  assert.match(line, /TikTok @vy/);
  assert.match(viet.fallback.chat.join(' '), /Bình luận nhanh quá|ghi vào sổ/);
  assert.match(viet.fallback.open.join(' '), /Chào buổi tối/);
  assert.match(viet.now, /YouTube, Facebook và TikTok/);
  assert.deepEqual(viet.xlearn.accounts, []);
});

test('live-bridge: mỗi bình luận gắn đúng nguồn nền tảng, key đi kèm header', async () => {
  assert.deepEqual(Object.keys(PLATFORMS), ['youtube', 'facebook', 'tiktok']);
  assert.ok(MOCK_COMMENTS.length >= 9);
  assert.ok(MOCK_COMMENTS.some(c => c[0] === 'youtube') && MOCK_COMMENTS.some(c => c[0] === 'facebook') && MOCK_COMMENTS.some(c => c[0] === 'tiktok'));
  const seen = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', d => b += d);
    req.on('end', () => { seen.push({ path: req.url, key: req.headers['x-square-key'], body: JSON.parse(b) }); res.end(JSON.stringify({ ok: true })); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  await sendComment(base, 'k-1', 'youtube', 'Minh', 'phim hay quá');
  await sendComment(base, 'k-1', 'facebook', 'Lan', 'chào Vy');
  await sendComment(base, 'k-1', 'tiktok', 'Huy', 'ai xem rồi');
  assert.equal(seen.length, 3);
  assert.equal(seen[0].body.items[0].text, '[YouTube] phim hay quá');
  assert.equal(seen[1].body.items[0].text, '[Facebook] chào Vy');
  assert.equal(seen[2].body.items[0].text, '[TikTok] ai xem rồi');
  assert.ok(seen.every(s => s.path === '/api/ingest/comments' && s.key === 'k-1'));
  srv.close();
});
