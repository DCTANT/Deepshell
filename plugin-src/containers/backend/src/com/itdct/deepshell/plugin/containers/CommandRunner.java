package com.itdct.deepshell.plugin.containers;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 命令执行器：本机 ProcessBuilder 与 SSH 共用同一套结果结构。
 *
 * <p>容器插件不直接依赖 Docker / Kubernetes SDK，而是调用本机或远端已安装的
 * docker / kubectl 命令行，输出统一按 UTF-8 返回给前端解析。</p>
 */
final class CommandRunner {

    static final int MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

    private CommandRunner() {
    }

    static final class Result {
        final int exitCode;
        final String output;
        final String stderr;
        final long durationMs;

        Result(int exitCode, String output, String stderr, long durationMs) {
            this.exitCode = exitCode;
            this.output = output == null ? "" : output;
            this.stderr = stderr == null ? "" : stderr;
            this.durationMs = durationMs;
        }

        boolean ok() {
            return exitCode == 0;
        }
    }

    interface Executor {
        Result run(List<String> args) throws Exception;

        Result run(List<String> args, int timeoutMs) throws Exception;

        void close();
    }

    /** 在本机运行命令。prefix 允许包含 "cmd.exe /c C:\\path\\docker.cmd" 这类包装命令。 */
    static final class LocalExecutor implements Executor {
        private final List<String> prefix;
        private final int timeoutMs;

        LocalExecutor(List<String> prefix, int timeoutMs) {
            this.prefix = prefix;
            this.timeoutMs = timeoutMs;
        }

        @Override
        public Result run(List<String> args) throws Exception {
            return run(args, timeoutMs);
        }

        @Override
        public Result run(List<String> args, int commandTimeoutMs) throws Exception {
            List<String> command = new ArrayList<String>(prefix);
            command.addAll(args);
            long start = System.currentTimeMillis();
            ProcessBuilder pb = new ProcessBuilder(command);
            pb.redirectErrorStream(false);
            pb.environment().put("DOCKER_CLI_HINTS", "false");
            pb.environment().put("LC_ALL", "C");
            Process process;
            try {
                process = pb.start();
            } catch (Exception e) {
                throw new IllegalArgumentException("无法执行 " + command.get(0)
                        + "，请确认命令已安装或在连接中填写完整路径（" + e.getMessage() + "）");
            }
            final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            final ByteArrayOutputStream errors = new ByteArrayOutputStream();
            Thread stdout = drain(process.getInputStream(), buffer, "containers-cli-out");
            Thread stderr = drain(process.getErrorStream(), errors, "containers-cli-err");
            boolean done = process.waitFor(commandTimeoutMs, TimeUnit.MILLISECONDS);
            if (!done) {
                process.destroyForcibly();
                process.waitFor(2, TimeUnit.SECONDS);
            }
            stdout.join(1500);
            stderr.join(1500);
            String output;
            boolean truncated;
            synchronized (buffer) {
                byte[] data = buffer.toByteArray();
                output = new String(data, StandardCharsets.UTF_8);
                truncated = data.length >= MAX_OUTPUT_BYTES;
            }
            String error;
            synchronized (errors) {
                error = new String(errors.toByteArray(), StandardCharsets.UTF_8);
            }
            if (truncated) {
                output += "\n[输出超过 " + (MAX_OUTPUT_BYTES / 1024 / 1024) + "MB，已截断]";
            }
            if (!done) {
                output += "\n[命令执行超过 " + timeoutMs + "ms，已终止]";
                return new Result(124, output, error, System.currentTimeMillis() - start);
            }
            int exit;
            try {
                exit = process.exitValue();
            } catch (IllegalThreadStateException e) {
                exit = -1;
            }
            return new Result(exit, output, error, System.currentTimeMillis() - start);
        }

        private static Thread drain(final InputStream in, final ByteArrayOutputStream buffer, String name) {
            Thread thread = new Thread(new Runnable() {
                @Override
                public void run() {
                    byte[] buf = new byte[8192];
                    try {
                        int n;
                        while ((n = in.read(buf)) >= 0) {
                            if (n == 0) {
                                continue;
                            }
                            synchronized (buffer) {
                                if (buffer.size() < MAX_OUTPUT_BYTES) {
                                    buffer.write(buf, 0, Math.min(n, MAX_OUTPUT_BYTES - buffer.size()));
                                }
                            }
                        }
                    } catch (Exception ignore) {
                        // 进程被终止时读取会中断
                    }
                }
            }, name);
            thread.setDaemon(true);
            thread.start();
            return thread;
        }

        @Override
        public void close() {
            // 本机执行器无持久状态
        }
    }

    /** 按常见 shell 规则拆分命令前缀，支持带空格的安装路径（用引号包住）。 */
    static List<String> splitCommand(String raw, String fallback) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) {
            value = fallback;
        }
        List<String> out = new ArrayList<String>();
        StringBuilder current = new StringBuilder();
        boolean single = false;
        boolean dbl = false;
        boolean has = false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (single) {
                if (c == '\'') {
                    single = false;
                } else {
                    current.append(c);
                }
            } else if (dbl) {
                if (c == '"') {
                    dbl = false;
                } else if (c == '\\' && i + 1 < value.length()
                        && (value.charAt(i + 1) == '"' || value.charAt(i + 1) == '\\')) {
                    current.append(value.charAt(++i));
                } else {
                    current.append(c);
                }
            } else if (c == '\'') {
                single = true;
                has = true;
            } else if (c == '"') {
                dbl = true;
                has = true;
            } else if (Character.isWhitespace(c)) {
                if (current.length() > 0 || has) {
                    out.add(current.toString());
                    current.setLength(0);
                    has = false;
                }
            } else {
                current.append(c);
                has = true;
            }
        }
        if (current.length() > 0 || has) {
            out.add(current.toString());
        }
        if (out.isEmpty()) {
            out.add(fallback);
        }
        return out;
    }

    static String shellQuote(String value) {
        if (value == null) {
            return "''";
        }
        return "'" + value.replace("'", "'\\''") + "'";
    }

    static String trimForMessage(String output, int max) {
        String text = output == null ? "" : output.trim();
        if (text.length() > max) {
            text = text.substring(text.length() - max);
        }
        return text;
    }
}
