@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo  CopyCreator - Connect Threads Session
echo ============================================
echo.
echo This opens a real Chromium browser window on THIS computer.
echo Log into Threads with your own account, exactly as you normally would.
echo Once you're on your home feed, come back to this window and press Enter
echo when it asks you to.
echo.
echo Do NOT close this window until it says "Saved session to ...".
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found. Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies (first run only)...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Check the messages above.
    pause
    exit /b 1
  )
)

echo Making sure the local Chromium browser is installed (first run only)...
call npx playwright install chromium

echo.
echo Opening the login window now...
echo.
node scripts\capture-threads-session.mjs

echo.
echo ============================================
echo  Next step
echo ============================================
echo Open the file threads-session-state.json in this folder, copy ALL of its
echo contents, and paste them into the app: Dashboard - Settings - Threads
echo session - then click Save session.
echo.
echo Once it's saved in the app, you can delete threads-session-state.json
echo from this folder - it is as sensitive as a password.
echo.
pause
