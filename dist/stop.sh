#!/bin/sh
# DeepShell Linux 停止脚本
cd "$(dirname "$0")" || exit 1

PID_FILE=data/deepshell.pid
if [ ! -f "$PID_FILE" ]; then
    echo "未找到 $PID_FILE，DeepShell 可能未在运行。"
    exit 0
fi

PID=$(cat "$PID_FILE")
if ! kill -0 "$PID" 2>/dev/null; then
    echo "进程 $PID 不存在（可能已停止），清理 pid 文件。"
    rm -f "$PID_FILE"
    exit 0
fi

kill "$PID"
i=0
while kill -0 "$PID" 2>/dev/null && [ "$i" -lt 15 ]; do
    sleep 1
    i=$((i + 1))
done
if kill -0 "$PID" 2>/dev/null; then
    echo "进程未在 15 秒内退出，执行强制结束。"
    kill -9 "$PID"
fi
rm -f "$PID_FILE"
echo "DeepShell 已停止。"
