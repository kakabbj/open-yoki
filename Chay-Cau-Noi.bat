@echo off
REM Cau noi OpenCode - de open-yoki noi chuyen voi Xingchi qua OpenCode.
cd /d "%~dp0tools\opencode-bridge"
where node >nul 2>nul
if errorlevel 1 goto NO_NODE
where opencode >nul 2>nul
if errorlevel 1 goto NO_OPENCODE
goto START_BRIDGE
:NO_OPENCODE
echo Khong thay lenh opencode tren may nay.
echo Cau noi van chay thu - neu OpenCode serve dang chay san thi van noi duoc.
echo Neu cau noi bao loi, mo OpenCode truoc roi chay lai file nay.
goto START_BRIDGE
:START_BRIDGE
title Cau noi OpenCode
echo Cau noi chay o http://127.0.0.1:20129
echo Dong cua so nay de tat cau noi.
node bridge.mjs
goto END
:NO_NODE
echo Khong thay Node.js. Cai Node 22+ tai https://nodejs.org roi chay lai file nay.
goto END
:END
pause
