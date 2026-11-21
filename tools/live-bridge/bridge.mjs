#!/usr/bin/env node
// live-bridge: đưa bình luận từ YouTube + Facebook + TikTok vào open-yoki.
//
// open-yoki không tự đăng nhập nền tảng nào: cầu nối này đọc phòng live của bạn
// (mỗi nền tảng một cách) rồi đẩy vào /api/ingest/comments + /api/ingest/room
// mà v1 đã sửa cho chạy được. Host trả lời như bình luận trong phòng web của mình.
//
//   node bridge.mjs --mode mock --server http://127.0.0.1:4370 \
//     --key-file app/data/test/square-ingest.key
//     --platforms youtube,facebook,tiktok --interval 8
//
// --mode mock (mặc định): không cần tài khoản hay key nền tảng nào, cứ vài giây
//   lại gửi một bình luận giả lập tiếng Việt từ 1 trong 3 nền tảng, để thử
//   đường đẩy hình + trả lời. Dừng bằng Ctrl+C.
// --mode live: đọc thật.
//   YouTube: cần YT_API_KEY + YT_LIVE_CHAT_ID (Data API v3, liveChatMessages).
//   Facebook: cần FB_PAGE_TOKEN + FB_LIVE_VIDEO_ID (Graph API, /{id}/comments).
//   TikTok: KHÔNG có API live comment chính thức — chế độ live từ chối chạy
//   và báo rõ, đừng dùng thư viện không chính thức nếu không chấp nhận rủi ro
//   bị khóa tài khoản. Muốn live TikTok thật thì mở TikTok LIVE Studio /
//   lấy RTMP của TikTok rồi đẩy hình qua đó, còn bình luận thì đọc tay hoặc
//   dùng cầu nối riêng của bạn đẩy vào cùng API ingest này.
//
// Bình luận được gắn nguồn ở đầu câu: "[YouTube] …", "[Facebook] …",
// "[TikTok] …" — tên người gửi giữ nguyên (server giới hạn tên 12 ký tự).
import fs from 'node:fs';

export const PLATFORMS = {
  youtube: { label: 'YouTube' },
  facebook: { label: 'Facebook' },
  tiktok: { label: 'TikTok' },
};

export const MOCK_COMMENTS = [
  ['youtube', 'Minh', 'Phim này hay quá, Vy ơi đoạn cuối xúc động thật'],
  ['facebook', 'Lan', 'Mình vừa xem tập mới, nhân vật chính diễn tốt ghê'],
  ['tiktok', 'Huy', 'Ai xem phim này rồi cho xin cảm nhận với'],
  ['youtube', 'An', 'Vy kể tiếp đi, đang hay mà'],
  ['facebook', 'Thu', 'Phim ngắn mà làm được vậy là giỏi lắm'],
  ['tiktok', 'Nam', 'Đoạn này nhạc nền hay quá trời'],
  ['youtube', 'Linh', 'Tối nay có phim mới không Vy?'],
  ['facebook', 'Quân', 'Mình thích nhân vật nữ chính nhất'],
  ['tiktok', 'Trang', 'Xem xong khóc luôn, ai giống mình không'],
];

async function post(server, key, path, body, dryRun) {
  if (dryRun) { console.log('[dry-run] POST ' + path, JSON.stringify(body)); return { ok: true }; }
  const r = await fetch(server + path, {
    method: 'POST',
    headers: { 'x-square-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(path + ' -> ' + (j.error || r.status));
  return j;
}

export async function sendComment(server, key, platform, name, text, dryRun = false) {
  const label = PLATFORMS[platform].label;
  return post(server, key, '/api/ingest/comments', { items: [{ name, text: `[${label}] ${text}` }] }, dryRun);
}
export async function sendRoom(server, key, platform, online, events = [], dryRun = false) {
  return post(server, key, '/api/ingest/room', { online, events }, dryRun);
}

// --- live readers (chỉ YouTube + Facebook có API chính thức) ---
async function pollYouTube(state, send) {
  const url = new URL('https://www.googleapis.com/youtube/v3/liveChat/messages');
  url.searchParams.set('liveChatId', process.env.YT_LIVE_CHAT_ID);
  url.searchParams.set('part', 'snippet,authorDetails');
  url.searchParams.set('key', process.env.YT_API_KEY);
  if (state.pageToken) url.searchParams.set('pageToken', state.pageToken);
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error('YouTube API: ' + (j.error?.message || r.status));
  state.pageToken = j.nextPageToken;
  state.pollMs = j.pollingIntervalMillis || 5000;
  for (const it of j.items || []) {
    await send('youtube', it.authorDetails?.displayName || 'khách', it.snippet?.displayMessage || '');
  }
  return state.pollMs;
}
async function pollFacebook(state, send) {
  const url = new URL(`https://graph.facebook.com/v20.0/${process.env.FB_LIVE_VIDEO_ID}/comments`);
  url.searchParams.set('access_token', process.env.FB_PAGE_TOKEN);
  url.searchParams.set('fields', 'from,message');
  url.searchParams.set('order', 'reverse_chronological');
  if (state.after) url.searchParams.set('after', state.after);
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error('Facebook API: ' + (j.error?.message || r.status));
  state.after = j.paging?.cursors?.after;
  for (const c of (j.data || []).reverse()) {
    if (state.seen.has(c.id)) continue;
    state.seen.add(c.id);
    await send('facebook', c.from?.name || 'khách', c.message || '');
  }
}

function arg(name, def = '') {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function has(name) { return process.argv.includes('--' + name); }

async function main() {
  const server = arg('server', 'http://127.0.0.1:4370').replace(/\/+$/, '');
  const key = arg('key') || (arg('key-file') ? fs.readFileSync(arg('key-file'), 'utf8').trim() : '');
  const platforms = arg('platforms', 'youtube,facebook,tiktok').split(',').map(s => s.trim()).filter(Boolean);
  const mode = arg('mode', 'mock');
  const intervalMs = Number(arg('interval', '8')) * 1000;
  const dryRun = has('dry-run');
  const once = has('once');

  if (!key && !dryRun) {
    console.error('Thiếu key ingest: dùng --key <key> hoặc --key-file <đường dẫn tới square-ingest.key>');
    process.exit(2);
  }
  for (const p of platforms) {
    if (!PLATFORMS[p]) { console.error('Nền tảng không biết: ' + p + ' (chỉ youtube, facebook, tiktok)'); process.exit(2); }
  }
  if (mode === 'live' && platforms.includes('tiktok')) {
    console.error('TikTok KHÔNG có API live comment chính thức: chế độ live từ chối chạy cho TikTok. ' +
      'Chạy lại với --platforms youtube,facebook, hoặc dùng --mode mock để thử đường truyền.');
    process.exit(2);
  }
  const send = (platform, name, text) => sendComment(server, key, platform, name, text, dryRun);

  if (mode === 'mock') {
    let i = 0;
    const tick = async () => {
      const [platform, name, text] = MOCK_COMMENTS[i % MOCK_COMMENTS.length];
      i++;
      if (!platforms.includes(platform)) return;
      try {
        const r = await send(platform, name, text);
        console.log(new Date().toISOString(), `[${PLATFORMS[platform].label}] ${name}: ${text}`, '->', JSON.stringify(r));
        if (i % 5 === 0) await sendRoom(server, key, platform, 10 + (i % 40), [{ type: 'enter', name }], dryRun);
      } catch (e) { console.error('bridge lỗi:', e.message); }
    };
    await tick();
    if (once) return;
    setInterval(tick, intervalMs);
    console.log(`live-bridge mock đang chạy: ${platforms.join(', ')} -> ${server} (mỗi ${intervalMs / 1000}s một bình luận, Ctrl+C để dừng)`);
    return;
  }
  if (mode !== 'live') { console.error('mode không biết: ' + mode + ' (chỉ mock hoặc live)'); process.exit(2); }
  const state = { yt: {}, fb: { seen: new Set() } };
  const loop = async () => {
    try {
      if (platforms.includes('youtube')) await pollYouTube(state.yt, send);
      if (platforms.includes('facebook')) await pollFacebook(state.fb, send);
    } catch (e) { console.error('bridge lỗi:', e.message); }
    setTimeout(loop, Math.max(5000, state.yt.pollMs || 5000));
  };
  console.log(`live-bridge live đang chạy: ${platforms.join(', ')} -> ${server}`);
  loop();
}

if (import.meta.url === `file://${process.argv[1]}`) main();
