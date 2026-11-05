@echo off
setlocal
chcp 65001 >nul
set "PATH=%~dp0tools\node-v24.22.1-win-x64;%PATH%"
cd /d "%~dp0project"
echo 像素格斗游戏开发环境
echo 输入 npm run check:tools 可检查已下载的开发工具。
echo 当前文件夹用于后续制作游戏。
cmd /k
endlocal
