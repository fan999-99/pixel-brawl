@echo off
set "CLUB_MAP_TILED=%USERPROFILE%\.codex\tools\tiled-1.12.2\PFiles\Tiled\tiled.exe"
if not exist "%CLUB_MAP_TILED%" set "CLUB_MAP_TILED=C:\Program Files\Tiled\tiled.exe"
start "" "%CLUB_MAP_TILED%" "%~dp0project\public\assets\tiled-club-v1\club-maps.tiled-project" "%~dp0project\public\assets\tiled-club-v1\maps\underground.tmj"
