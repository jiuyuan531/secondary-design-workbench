@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==== 二次设计工作台：一键打包 ====
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。打包需要在本机安装 Node.js 22 或更新版本：https://nodejs.org/
  echo 注意：只有打包需要 Node.js，打包出来的 exe 在没装 Node.js 的电脑上也能运行。
  pause
  exit /b 1
)

echo [1/4] 安装依赖……
call npm ci
if errorlevel 1 goto :err

echo [2/4] 运行测试……
call npm test
if errorlevel 1 goto :err

echo [3/4] 编译界面和主进程……
call npm run build
if errorlevel 1 goto :err

echo [4/4] 生成 Windows 程序……
call npx electron-builder --win portable nsis --x64 --publish never
if errorlevel 1 goto :err

echo.
echo 打包完成，文件在 release 文件夹：
echo   erci-workbench-版本号-portable.exe  免安装版，双击即可运行
echo   erci-workbench-版本号-setup.exe     安装版
pause
exit /b 0

:err
echo.
echo 打包失败，请把上面的报错信息发给开发者。
pause
exit /b 1
