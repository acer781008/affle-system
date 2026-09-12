@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo 第一次啟動，正在安裝套件...
  call npm install
  if errorlevel 1 (
    echo npm install 失敗，請確認已安裝 Node.js。
    pause
    exit /b 1
  )
)
echo.
echo 歡樂抽獎系統 V1.2.0 啟動
echo 主控：http://localhost:3000/admin-login.html
echo.
call npm start
pause
