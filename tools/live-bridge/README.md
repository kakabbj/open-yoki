# live-bridge — bình luận YouTube / Facebook / TikTok vào open-yoki

open-yoki không tự đăng nhập nền tảng nào. Cầu nối này đọc phòng live của bạn
rồi đẩy bình luận vào `/api/ingest/comments` (v1 đã sửa cho chạy được).

## Chạy mock (không cần tài khoản, không tốn tiền)

```bash
# 1. Chạy server host Việt, bản mock (cửa sổ 1)
cd app
IDOL=viet AVATAR=mock MODE=test node server/index.mjs

# 2. Chạy cầu nối mock (cửa sổ 2, từ thư mục gốc của repo)
node tools/live-bridge/bridge.mjs --mode mock \
  --server http://127.0.0.1:4370 \
  --key-file app/data/test/square-ingest.key \
  --platforms youtube,facebook,tiktok --interval 8
```

Cứ 8 giây một bình luận giả lập tiếng Việt từ 1 trong 3 nền tảng, gắn nguồn
`[YouTube]`, `[Facebook]`, `[TikTok]` ở đầu câu. Mở http://127.0.0.1:4370
sẽ thấy host trả lời lần lượt. `--once` chỉ gửi 1 bình luận rồi dừng,
`--dry-run` chỉ in ra không gửi.

## Chạy live thật

```bash
# YouTube: lấy liveChatId của buổi live (YouTube Studio) + key Data API v3
YT_API_KEY=... YT_LIVE_CHAT_ID=... node tools/live-bridge/bridge.mjs \
  --mode live --platforms youtube --server http://127.0.0.1:4370 --key <key>

# Facebook: Page token + ID của video live (Graph API)
FB_PAGE_TOKEN=... FB_LIVE_VIDEO_ID=... node tools/live-bridge/bridge.mjs \
  --mode live --platforms facebook --server http://127.0.0.1:4370 --key <key>
```

TikTok không có API live comment chính thức nên chế độ live từ chối chạy
cho TikTok — cố tình, để khỏi bị khóa tài khoản vì thư viện không chính thức.

## Đẩy hình lên 3 nền tảng cùng lúc

Ghi `square.json` (trong thư mục data của server) dạng:

```json
{"targets": [
  {"name": "youtube", "url": "rtmp://a.rtmp.youtube.com/live2", "key": "xxxx-xxxx"},
  {"name": "facebook", "url": "rtmps://live-api-s.facebook.com:443/rtmp", "key": "xxxx"},
  {"name": "tiktok", "url": "rtmp://...", "key": "xxxx"}
], "size": "1280x720"}
```

Hoặc gửi qua API (cần key ingest):

```bash
curl -X POST http://127.0.0.1:4370/api/ingest/push -H 'x-square-key: <key>' \
  -H 'content-type: application/json' \
  -d '{"targets":[{"name":"youtube","url":"rtmp://...","key":"..."}]}'
```

ffmpeg sẽ dùng `tee` để đẩy cùng một luồng tới cả 3 đích. RTMP lấy ở:
YouTube Studio → Live → Stream key; Facebook Page → Live → Stream key;
TikTok → cần tài khoản được cấp quyền live RTMP (hoặc dùng TikTok LIVE Studio).
