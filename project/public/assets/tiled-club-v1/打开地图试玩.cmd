@echo off
set "CLUB_MAP_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%CLUB_MAP_PYTHON%" (
  "%CLUB_MAP_PYTHON%" "%~dp0source\serve_preview.py"
) else (
  py -3 "%~dp0source\serve_preview.py"
)
pause
