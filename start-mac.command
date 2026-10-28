#!/bin/bash
# 在本机启动网站：双击运行，然后在浏览器里打开 http://localhost:8000 。关闭这个窗口即停止。
cd "$(dirname "$0")" || exit 1
PORT=8000
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done
echo "精听练习器：http://localhost:$PORT  （关闭此窗口即停止）"
(sleep 1; open "http://localhost:$PORT") &
exec python3 -m http.server $PORT --bind 127.0.0.1
