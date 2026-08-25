@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-siaga.ps1"
if errorlevel 1 (
    echo.
    echo SIAGA could not be started. See the message above.
    pause
)

