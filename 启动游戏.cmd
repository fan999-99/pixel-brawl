@echo off
setlocal
chcp 65001 >nul
set "PATH=%~dp0tools\node-v24.22.1-win-x64;%PATH%"
cd /d "%~dp0project"
powershell -NoProfile -Command "try { $response = Invoke-RestMethod -Uri 'http://127.0.0.1:2567/health' -TimeoutSec 5; if ($response.service -eq 'pixel-brawl') { exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 (
  echo 绷住俱乐部已经运行，可以直接打开：
  echo http://localhost:2567
  echo 当前窗口无需重复启动，原来的游戏服务将继续运行。
  pause
  exit /b 0
)
if not exist "dist\index.html" (
  echo 正在准备游戏页面，请稍候...
  call npm run build
  if errorlevel 1 (
    echo 游戏页面准备失败。请保留窗口内容以便排查。
    pause
    exit /b 1
  )
)
echo.
echo 绷住俱乐部正在启动。
echo 启动后在浏览器打开 http://localhost:2567
echo 同一 Wi-Fi 的朋友可使用下面显示的局域网地址和房间码加入。
echo 关闭此窗口可结束游戏服务。
echo.
call npm start
if errorlevel 1 pause
endlocal
