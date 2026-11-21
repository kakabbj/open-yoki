# Cau noi OpenCode (cho open livestream v7)

Xingchi chan goi truc tiep (403, chi cho phep Codex / Claude Code / OpenCode /
Cursor... goi). OpenCode nam trong danh sach duoc phep, nen cau noi nay de
open-yoki noi chuyen voi Xingchi THONG QUA OpenCode — key Xingchi nam trong
OpenCode, khong nam trong panel Cua so cai dat, khong can dan key lan nua.

## Chay

```
node bridge.mjs
```

- Cau noi mo cong `http://127.0.0.1:20129` (doi bang `--port` hoac `BRIDGE_PORT`).
- No tu dong chay `opencode serve` o cong 4096 neu chua co OpenCode nao chay.
  Neu muon tu chay OpenCode truoc: `opencode serve --port 4096`.
- Tim lenh opencode: tren Windows, ban cai bang npm chi co file
  `opencode.cmd` trong `%APPDATA%\npm` — Node khong chay truc tiep file
  .cmd duoc (loi EINVAL) nen cau noi tu tim duong dan do va chay qua
  cmd.exe. Neu cau noi bao "Khong tim thay lenh opencode" thi cai ban 2
  bang `npm install -g @opencode/cli` (ban 1 tren npm la `opencode-ai`,
  khong dung duoc nua), hoac chi duong dan bang
  `--bin "duong-dan-toi-opencode.cmd"` / bien moi truong `OPENCODE_BIN`.
- OpenCode 2 dat mat khau cho API (serve tu sinh mot mat khau ngau nhien
  va in ra man hinh, hoac nhan `OPENCODE_PASSWORD`). Cau noi tu dat mat
  khau cua minh khi no tu chay serve, nen khong can ban lam gi them.
  Neu ban tu chay serve truoc roi cau noi khong vao duoc (sai mat khau),
  cau noi se tu chay mot serve rieng o cong ke tiep (4097, 4098...) thay
  vi tranh cong 4096. Muon dung chung mot serve thi dat cung
  `OPENCODE_PASSWORD` cho ca serve lan cau noi.
- Model mac dinh `xingchi/gpt-6.1-sol` (doi bang `--model` hoac `OPENCODE_MODEL`,
  dang `nha/model` — vi du `gemini/gemini-3-flash` neu ban da cai Gemini trong
  OpenCode). Trong panel Cua so cai dat, o Model cung doi duoc.
- `GET /health` tra ve trang thai: co noi duoc OpenCode khong, session nao.

## No chay the nao

1. Panel chon nha "OpenCode (qua cau noi)" — khong can key.
2. open-yoki goi `POST /v1/chat/completions` sang cau noi (giong goi OpenAI).
3. Cau noi doi tin nhan thanh 1 prompt, gui sang OpenCode qua API cua no,
   giu NGUYEN 1 session cho ca buoi live de host nho mach chuyen.
   - OpenCode 1: `POST /session` tao phien, `POST /session/{id}/message`
     tra loi ngay trong mot lan goi.
   - OpenCode 2: `POST /api/session` tao phien (model gui kem theo dang
     `{providerID, id}`), `POST /api/session/{id}/prompt` chi nhan tin
     vao, cau noi doc lai cau tra loi tu `GET /api/session/{id}/message`
     cho toi khi tin nhan cua tro ly hoan tat. Cau noi tu nhan biet ban
     1 hay 2 khi gap serve.
4. Cau tra loi duoc tra ve dung dang OpenAI de open-yoki doc duoc.

## An toan

- Cau noi khong giu key, khong doc file cua ban. OpenCode duoc chay trong
  mot thu muc tam trong (khong phai thu muc project) de neu model co goi
  cong cu thi cung khong co gi de doc/sua.
- Chi lang nghe tren 127.0.0.1 — may khac khong vao duoc.
