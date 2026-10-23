package com.itdct.deepshell.service;

import java.util.ArrayList;
import java.util.List;

/**
 * 从终端按键流中尽力还原用户提交的命令，供审计使用。
 * 只处理打字输入；方向键 / Tab 补全等会改变 shell 行内容的行为会标记为未知，
 * 桌面端同时会用 xterm 当前行覆盖这里的结果。密码提示由前端显式跳过。
 */
public class TerminalCommandTracker {

    private static final int MAX_COMMAND = 4000;

    private final StringBuilder line = new StringBuilder();
    private boolean truncated;

    public synchronized List<String> feed(String input) {
        List<String> commands = new ArrayList<>();
        if (input == null || input.isEmpty()) {
            return commands;
        }
        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            if (c == '\u001b') {
                i = skipEscape(input, i);
                continue;
            }
            if (c == '\r' || c == '\n') {
                if (c == '\r' && i + 1 < input.length() && input.charAt(i + 1) == '\n') {
                    i++;
                }
                emit(commands);
                continue;
            }
            if (c == 0x7f || c == 0x08) {
                if (line.length() > 0) {
                    line.setLength(line.length() - 1);
                }
                continue;
            }
            if (c == 0x03 || c == 0x15) {
                // Ctrl+C / Ctrl+U：当前行被清空，不记录
                line.setLength(0);
                truncated = false;
                continue;
            }
            if (c == 0x17) {
                // Ctrl+W：删除最后一个词
                while (line.length() > 0 && Character.isWhitespace(line.charAt(line.length() - 1))) {
                    line.setLength(line.length() - 1);
                }
                while (line.length() > 0 && !Character.isWhitespace(line.charAt(line.length() - 1))) {
                    line.setLength(line.length() - 1);
                }
                continue;
            }
            if (c < 0x20) {
                // Tab / 其他控制键：行内容可能已被 shell 改写
                continue;
            }
            if (line.length() < MAX_COMMAND) {
                line.append(c);
            } else {
                truncated = true;
            }
        }
        return commands;
    }

    public synchronized void reset() {
        line.setLength(0);
        truncated = false;
    }

    private void emit(List<String> commands) {
        String command = line.toString().trim();
        line.setLength(0);
        if (command.isEmpty()) {
            truncated = false;
            return;
        }
        if (truncated) {
            command = command + "…";
            truncated = false;
        }
        commands.add(command);
    }

    /** 跳过 ESC 序列，返回序列最后一个字符下标；单字节 ESC 返回当前下标。 */
    private static int skipEscape(String input, int start) {
        int i = start + 1;
        if (i >= input.length()) {
            return start;
        }
        char next = input.charAt(i);
        if (next == '[') {
            i++;
            while (i < input.length()) {
                char c = input.charAt(i);
                if (c >= 0x40 && c <= 0x7e) {
                    return i;
                }
                i++;
            }
            return input.length() - 1;
        }
        if (next == ']') {
            i++;
            while (i < input.length()) {
                char c = input.charAt(i);
                if (c == '\u0007') {
                    return i;
                }
                if (c == '\u001b' && i + 1 < input.length() && input.charAt(i + 1) == '\\') {
                    return i + 1;
                }
                i++;
            }
            return input.length() - 1;
        }
        return i;
    }
}
