@echo off
REM Chay ca cau noi OpenCode + phong live (2 cua so) - nhay dup 1 lan.
start "Cau noi OpenCode" "%~dp0Chay-Cau-Noi.bat"
timeout /t 3 /nobreak >nul
start "Open Livestream" "%~dp0Chay-Live.bat"
echo Da mo 2 cua so: cau noi + phong live.
echo Cho vai giay roi mo trinh duyet: http://127.0.0.1:4370
pause
