@echo off
setlocal
cd /d "%~dp0"
cls

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found. Install Node.js 18 or newer, then try again.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Installing project dependencies...
    call npm.cmd install
    if errorlevel 1 (
        echo.
        echo Dependencies could not be installed.
        pause
        exit /b 1
    )
)

node main.js
endlocal
