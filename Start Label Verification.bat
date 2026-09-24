@echo off
setlocal

rem Starts the Label Verification desktop app (Tauri + SQLite).
rem
rem This is the DEVELOPMENT launcher: it compiles and runs the app from source,
rem so the first start after a code change is slow. For the floor station,
rem build an installer instead with:  npm run desktop:build
rem and install the .exe it writes to src-tauri\target\release\bundle.

cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed on this machine, so the app cannot start.
  echo Install Node.js LTS from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo First run on this machine — installing dependencies. This takes a few minutes.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency install failed. Leave this window open and tell whoever set
    echo the station up what it says above.
    echo.
    pause
    exit /b 1
  )
)

rem Vite is pinned to 5173 (strictPort), so a leftover dev server from a previous
rem run blocks startup instead of quietly moving to another port.
netstat -ano -p TCP | findstr /r /c:"127.0.0.1:5173 .*LISTENING" >nul
if not errorlevel 1 (
  echo Port 5173 is still held by a previous session. Closing it first...
  for /f "tokens=5" %%p in ('netstat -ano -p TCP ^| findstr /r /c:"127.0.0.1:5173 .*LISTENING"') do (
    taskkill /f /pid %%p >nul 2>&1
  )
  rem Give Windows a moment to release the socket.
  timeout /t 2 /nobreak >nul
)

echo Starting Label Verification...
echo The app opens in its own window. Closing that window stops it.
echo.

call npm run desktop
set "EXITCODE=%ERRORLEVEL%"

rem 0 = clean exit. 1073807364 and 3221225786 are the codes Windows reports when
rem the app is closed or stopped by hand — neither is a startup failure.
if "%EXITCODE%"=="0" goto :done
if "%EXITCODE%"=="1073807364" goto :done
if "%EXITCODE%"=="3221225786" goto :done

echo.
echo Label Verification failed to start (code %EXITCODE%). Leave this window open
echo and tell whoever set the station up what it says above.
echo.
pause
exit /b %EXITCODE%

:done
endlocal
exit /b 0
