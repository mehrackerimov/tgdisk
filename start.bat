@echo off
setlocal
cd /d "%~dp0"
cls

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
