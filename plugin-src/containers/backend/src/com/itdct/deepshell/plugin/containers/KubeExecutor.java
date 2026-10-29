package com.itdct.deepshell.plugin.containers;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;

/** Kubernetes 执行器：把 kubeconfig 写入插件数据目录的临时文件，调用本机 kubectl。 */
final class KubeExecutor implements CommandRunner.Executor {

    private final CommandRunner.LocalExecutor delegate;
    private final Path kubeFile;

    private KubeExecutor(CommandRunner.LocalExecutor delegate, Path kubeFile) {
        this.delegate = delegate;
        this.kubeFile = kubeFile;
    }

    static KubeExecutor create(Path dataDir, String kubectlCmd, String kubeconfig,
                               String context, String connectionId, int timeoutMs)
            throws Exception {
        List<String> prefix = CommandRunner.splitCommand(kubectlCmd, "kubectl");
        Path kubeFile = null;
        if (kubeconfig != null && !kubeconfig.trim().isEmpty()) {
            Path dir = dataDir.resolve(".kube");
            Files.createDirectories(dir);
            kubeFile = dir.resolve(connectionId + ".yaml");
            Files.write(kubeFile, kubeconfig.getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING,
                    StandardOpenOption.WRITE);
            restrict(kubeFile);
            prefix.add("--kubeconfig");
            prefix.add(kubeFile.toAbsolutePath().toString());
        }
        if (context != null && !context.trim().isEmpty()) {
            prefix.add("--context");
            prefix.add(context.trim());
        }
        return new KubeExecutor(new CommandRunner.LocalExecutor(prefix, timeoutMs), kubeFile);
    }

    @Override
    public CommandRunner.Result run(List<String> args) throws Exception {
        return delegate.run(args);
    }

    @Override
    public CommandRunner.Result run(List<String> args, int timeoutMs) throws Exception {
        return delegate.run(args, timeoutMs);
    }

    @Override
    public void close() {
        delegate.close();
        if (kubeFile != null) {
            try {
                Files.deleteIfExists(kubeFile);
            } catch (Exception ignore) {
                // ignore
            }
        }
    }

    private static void restrict(Path file) {
        try {
            Files.setPosixFilePermissions(file,
                    java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
        } catch (Exception ignore) {
            // Windows 等文件系统忽略
        }
    }
}
