@echo off
set "CLUB_MAP_TILED=%USERPROFILE%\.codex\tools\tiled-1.12.2\PFiles\Tiled\tiled.exe"
if not exist "%CLUB_MAP_TILED%" set "CLUB_MAP_TILED=C:\Program Files\Tiled\tiled.exe"
if exist "%CLUB_MAP_TILED%" (
  start "" "%CLUB_MAP_TILED%" "%~dp0club-maps.tiled-project" "%~dp0maps\underground.tmj"
) else (
  echo Tiled was not found. Install Tiled from https://www.mapeditor.org/
  pause
)
