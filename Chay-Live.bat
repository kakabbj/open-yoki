@echo off
REM Mo phong live open livestream (host Vy) - nhay dup de chay, khong can go lenh.
cd /d "%~dp0app"
where node >nul 2>nul
if errorlevel 1 (
  echo Khong thay Node.js. Cai Node 22+ tai https://nodejs.org roi chay lai file nay.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Lan dau chay: dang cai thu vien (npm install)...
  call npm install
  if errorlevel 1 (
    echo Cai thu vien that bai. Kiem tra mang roi chay lai.
    pause
    exit /b 1
  )
)
set IDOL=viet
set AVATAR=mock
set MODE=test
title Open Livestream - Vy (mock)
start "" /min cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:4370"
echo Dang mo phong live... Mo trinh duyet: http://127.0.0.1:4370
echo Dong cua so nay de tat phong live.
node server\index.mjs
pause
