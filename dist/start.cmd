@echo off
setlocal
cd /d "%~dp0"
title DeepShell

set "JAVA=java"
if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" set "JAVA=%JAVA_HOME%\bin\java.exe"
"%JAVA%" -version >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Java 运行环境，请先安装 JDK/JRE 8 或以上（并配置 JAVA_HOME 或 PATH）。
    echo.
    pause
    exit /b 1
)

if not exist "deepshell.jar" (
    echo [错误] 未找到 deepshell.jar，请确认本脚本与 jar 位于同一目录。
    echo.
    pause
    exit /b 1
)

echo 正在启动 DeepShell ...（关闭本窗口即停止服务）
echo.
"%JAVA%" -jar "deepshell.jar"
set "CODE=%errorlevel%"
echo.
echo DeepShell 已退出（代码 %CODE%）。
pause
