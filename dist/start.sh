#!/bin/sh
# DeepShell Linux 启动脚本（后台运行，日志与控制台输出见 data/logs/）
cd "$(dirname "$0")" || exit 1

if [ -x "$JAVA_HOME/bin/java" ]; then
    JAVA="$JAVA_HOME/bin/java"
elif command -v java >/dev/null 2>&1; then
    JAVA=java
else
    echo "[错误] 未找到 Java 运行环境，请先安装 JDK/JRE 8 或以上（并配置 JAVA_HOME 或 PATH）。"
    exit 1
fi

if [ ! -f deepshell.jar ]; then
    echo "[错误] 未找到 deepshell.jar，请确认本脚本与 jar 位于同一目录。"
    exit 1
fi

PID_FILE=data/deepshell.pid
LOG_FILE=data/logs/console.log
mkdir -p data/logs

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "DeepShell 已在运行（pid $(cat "$PID_FILE")），无需重复启动。"
    exit 0
fi

nohup "$JAVA" -Dfile.encoding=UTF-8 -jar deepshell.jar >>"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "DeepShell 已启动（pid $!）。"
echo "运行日志：$LOG_FILE   停止服务：./stop.sh"
