@echo off
REM Cau noi OpenCode - de open-yoki noi chuyen voi Xingchi qua OpenCode.
cd /d "%~dp0tools\opencode-bridge"
where node >nul 2>nul
if errorlevel 1 (
  echo Khong thay Node.js. Cai Node 22+ tai https://nodejs.org roi chay lai file nay.
  pause
  exit /b 1
)
where opencode >nul 2>nul
if errorlevel 1 (
  echo Khong thay lenh opencode. Mo cmd va chay: npm install -g opencode-ai
  echo (neu ban cai OpenCode bang cach khac thi them thu muc cua no vao PATH)
  pause
  exit /b 1
)
title Cau noi OpenCode
echo Cau noi chay o http://127.0.0.1:20129
echo Dong cua so nay de tat cau noi.
node bridge.mjs
pause
