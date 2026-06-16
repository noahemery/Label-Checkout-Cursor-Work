@echo off
rem Starts the Label Verification app and opens it in the default browser.
rem Double-click this after a restart (the server does not survive reboots).

cd /d "%~dp0"

rem Already running? Just open the browser.
powershell -NoProfile -Command "exit !(Test-NetConnection -ComputerName localhost -Port 5173 -InformationLevel Quiet -WarningAction SilentlyContinue)" >nul 2>&1
if %errorlevel%==0 (
  start "" http://localhost:5173/
  exit /b
)

start "Label Verification Server" /min cmd /c "npm run dev"

rem Give Vite a moment to boot, then open the app.
timeout /t 3 /nobreak >nul
start "" http://localhost:5173/

echo.
echo Label Verification is running at http://localhost:5173/
echo A minimized window named "Label Verification Server" keeps it alive.
echo Close that window to stop the app.
timeout /t 5 >nul
