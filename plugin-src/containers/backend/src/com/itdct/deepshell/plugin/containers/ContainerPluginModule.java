package com.itdct.deepshell.plugin.containers;

import com.itdct.deepshell.plugin.DesktopPluginModule;
import com.itdct.deepshell.plugin.PluginContext;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;

/**
 * DeepShell「容器与集群管理器」插件后端。
 *
 * <p>Docker 通过本机或 SSH 上的 docker CLI 操作，Kubernetes 通过本机 kubectl
 * 和 kubeconfig 操作；插件不内置 Docker / K8s SDK，也不把明文凭据返回浏览器。</p>
 */
public class ContainerPluginModule implements DesktopPluginModule {

    private static final String PROFILE_FILE = "connections.properties";
    private static final int MAX_PROFILES = 100;
    private static final int MAX_CONNECTIONS = 8;
    private static final long IDLE_TIMEOUT_MS = 30L * 60 * 1000;

    private final Object lock = new Object();
    private final Map<String, Profile> profiles = new LinkedHashMap<String, Profile>();
    private final Map<String, Conn> connections = new LinkedHashMap<String, Conn>();

    private PluginContext context;
    private SshExecutor.HostKeyStore hostKeys;

    @Override
    public String id() {
        return "com.deepshell.containers";
    }

    @Override
    public void initialize(PluginContext context) {
        this.context = context;
        this.hostKeys = new SshExecutor.HostKeyStore(context.getDataDir().resolve("known_hosts.properties"));
        try {
            loadProfiles();
        } catch (Exception ignore) {
            // 配置损坏时保留空列表，用户可以重新保存
        }
        cleanupKubeDir();
    }

    @Override
    public Object invoke(String action, Map<String, Object> payload) throws Exception {
        Map<String, Object> p = payload == null
                ? Collections.<String, Object>emptyMap() : payload;
        synchronized (lock) {
            trimConnections();
            return dispatch(action, p);
        }
    }

    private Object dispatch(String action, Map<String, Object> p) throws Exception {
        if ("profiles/list".equals(action)) {
            return listProfiles();
        }
        if ("profiles/save".equals(action)) {
            return saveProfile(p);
        }
        if ("profiles/delete".equals(action)) {
            return deleteProfile(p);
        }
        if ("disconnect".equals(action)) {
            disconnect(str(p, "connectionId"));
            return null;
        }
        if ("docker/connect".equals(action)) {
            return dockerConnect(p);
        }
        if ("docker/overview".equals(action)) {
            return dockerOverview(p);
        }
        if ("docker/containers".equals(action)) {
            return dockerContainers(p);
        }
        if ("docker/stats".equals(action)) {
            return dockerStats(p);
        }
        if ("docker/container/inspect".equals(action)) {
            return dockerContainerInspect(p);
        }
        if ("docker/container/logs".equals(action)) {
            return dockerContainerLogs(p);
        }
        if ("docker/container/exec".equals(action)) {
            return dockerContainerExec(p);
        }
        if ("docker/container/action".equals(action)) {
            return dockerContainerAction(p);
        }
        if ("docker/images".equals(action)) {
            return dockerImages(p);
        }
        if ("docker/image/pull".equals(action)) {
            return dockerImagePull(p);
        }
        if ("docker/image/remove".equals(action)) {
            return dockerImageRemove(p);
        }
        if ("docker/volumes".equals(action)) {
            return dockerVolumes(p);
        }
        if ("docker/volume/remove".equals(action)) {
            return dockerVolumeRemove(p);
        }
        if ("docker/networks".equals(action)) {
            return dockerNetworks(p);
        }
        if ("docker/network/remove".equals(action)) {
            return dockerNetworkRemove(p);
        }
        if ("kube/connect".equals(action)) {
            return kubeConnect(p);
        }
        if ("kube/overview".equals(action)) {
            return kubeOverview(p);
        }
        if ("kube/nodes".equals(action)) {
            return kubeRaw(p, Arrays.asList("get", "nodes", "-o", "json"), "读取节点");
        }
        if ("kube/namespaces".equals(action)) {
            return kubeRaw(p, Arrays.asList("get", "namespaces", "-o", "json"), "读取命名空间");
        }
        if ("kube/pods".equals(action)) {
            return kubePods(p);
        }
        if ("kube/pod/logs".equals(action)) {
            return kubePodLogs(p);
        }
        if ("kube/pod/exec".equals(action)) {
            return kubePodExec(p);
        }
        if ("kube/pod/delete".equals(action)) {
            return kubePodDelete(p);
        }
        if ("kube/deployments".equals(action)) {
            return kubeDeployments(p);
        }
        if ("kube/deployment/scale".equals(action)) {
            return kubeDeploymentScale(p);
        }
        if ("kube/deployment/restart".equals(action)) {
            return kubeDeploymentRestart(p);
        }
        if ("kube/deployment/delete".equals(action)) {
            return kubeDeploymentDelete(p);
        }
        if ("kube/services".equals(action)) {
            return kubeServices(p);
        }
        if ("kube/events".equals(action)) {
            return kubeEvents(p);
        }
        if ("kube/describe".equals(action)) {
            return kubeDescribe(p);
        }
        throw new IllegalArgumentException("未知的容器插件操作: " + action);
    }

    /* ---------------- Docker ---------------- */

    private Map<String, Object> dockerConnect(Map<String, Object> p) throws Exception {
        Profile profile = findProfile(str(p, "profileId"));
        String mode = first(str(p, "mode"), profile == null ? "local" : profile.mode, "local");
        String dockerCmd = first(str(p, "dockerCmd"), profile == null ? "docker" : profile.dockerCmd, "docker");
        String dockerContext = first(str(p, "dockerContext"),
                profile == null ? "" : profile.dockerContext, "");
        int timeout = timeout(p, profile);
        CommandRunner.Executor executor;
        String target;
        String modeValue = "ssh".equalsIgnoreCase(mode) ? "ssh" : "local";
        if ("ssh".equals(modeValue)) {
            String host = first(str(p, "sshHost"), profile == null ? "" : profile.sshHost, "").trim();
            if (host.isEmpty()) {
                throw new IllegalArgumentException("请填写 SSH 主机地址");
            }
            int port = intVal(p, "sshPort", profile == null ? 22 : profile.sshPort);
            if (port < 1 || port > 65535) {
                throw new IllegalArgumentException("SSH 端口需在 1-65535 之间");
            }
            String user = first(str(p, "sshUser"), profile == null ? "" : profile.sshUser, "").trim();
            if (user.isEmpty()) {
                throw new IllegalArgumentException("请填写 SSH 用户名");
            }
            String password = str(p, "password");
            if (password.isEmpty() && profile != null) {
                password = decrypt(profile.passwordCipher);
            }
            String privateKey = str(p, "privateKey");
            if (privateKey.trim().isEmpty() && profile != null) {
                privateKey = decrypt(profile.keyCipher);
            }
            String passphrase = str(p, "passphrase");
            if (passphrase.isEmpty() && profile != null) {
                passphrase = decrypt(profile.passphraseCipher);
            }
            if (password.isEmpty() && (privateKey == null || privateKey.trim().isEmpty())) {
                throw new IllegalArgumentException("请填写 SSH 密码或私钥");
            }
            List<String> prefix = CommandRunner.splitCommand(dockerCmd, "docker");
            SshExecutor ssh = new SshExecutor(host, port, user, password,
                    privateKey == null || privateKey.trim().isEmpty()
                            ? null : privateKey.getBytes(StandardCharsets.UTF_8),
                    passphrase, prefix, timeout, hostKeys, bool(p, "trustHostKey"));
            try {
                ssh.connect();
            } catch (SshExecutor.TrustRequiredException trust) {
                ssh.close();
                Map<String, Object> out = new LinkedHashMap<String, Object>();
                out.put("trustRequired", true);
                out.put("host", trust.host);
                out.put("fingerprint", trust.fingerprint);
                out.put("keyType", trust.keyType);
                out.put("message", "首次连接该主机，请确认指纹后继续");
                return out;
            }
            executor = ssh;
            target = user + "@" + host + " · SSH";
        } else {
            List<String> prefix = CommandRunner.splitCommand(dockerCmd, "docker");
            if (!dockerContext.isEmpty()) {
                prefix.add("--context");
                prefix.add(dockerContext);
            }
            executor = new CommandRunner.LocalExecutor(prefix, timeout);
            target = dockerContext.isEmpty() ? "本机 Docker" : "Docker · " + dockerContext;
        }
        try {
            CommandRunner.Result version = checked(executor.run(Arrays.asList(
                    "version", "--format", "{{json .}}")), "读取 Docker 版本");
            CommandRunner.Result info = checked(executor.run(Arrays.asList(
                    "info", "--format", "{{json .}}")), "读取 Docker 信息");
            String connectionId = newId();
            Conn conn = new Conn();
            conn.id = connectionId;
            conn.type = "docker";
            conn.profileId = profile == null ? "" : profile.id;
            conn.target = target;
            conn.executor = executor;
            conn.lastUsed = System.currentTimeMillis();
            connections.put(connectionId, conn);
            touchProfile(profile);
            Map<String, Object> out = new LinkedHashMap<String, Object>();
            out.put("connectionId", connectionId);
            out.put("type", "docker");
            out.put("profileId", conn.profileId);
            out.put("name", first(str(p, "name"), profile == null ? "" : profile.name, target));
            out.put("target", target);
            out.put("mode", modeValue);
            out.put("version", version.output);
            out.put("info", info.output);
            return out;
        } catch (Exception e) {
            executor.close();
            throw e;
        }
    }

    private Map<String, Object> dockerOverview(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("info", raw(executor, Arrays.asList("info", "--format", "{{json .}}"), "读取 Docker 信息"));
        CommandRunner.Result df = executor.run(Arrays.asList("system", "df", "--format", "{{json .}}"));
        out.put("df", df.ok() ? df.output : "");
        return out;
    }

    private Map<String, Object> dockerContainers(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        String output = raw(executor, Arrays.asList(
                "ps", "-a", "--no-trunc", "--format", "{{json .}}"), "读取容器列表");
        return output(output);
    }

    private Map<String, Object> dockerStats(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        CommandRunner.Result result = executor.run(Arrays.asList(
                "stats", "--no-stream", "--format", "{{json .}}"));
        return output(result.ok() ? result.output : "");
    }

    private Map<String, Object> dockerContainerInspect(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        String id = dockerId(p);
        return output(raw(executor, Arrays.asList("inspect", id), "读取容器详情"));
    }

    private Map<String, Object> dockerContainerLogs(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        String id = dockerId(p);
        int tail = tail(p);
        return output(checked(executor.run(Arrays.asList(
                "logs", "--tail", String.valueOf(tail), "--timestamps", id), 60000),
                "读取容器日志").output);
    }

    private Map<String, Object> dockerContainerExec(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        String id = dockerId(p);
        String command = requiredText(p, "command", "请输入要执行的命令");
        String shell = first(str(p, "shell"), "/bin/sh", "/bin/sh");
        if (!shell.matches("[A-Za-z0-9_./-]{1,64}")) {
            throw new IllegalArgumentException("Shell 路径不合法");
        }
        CommandRunner.Result result = executor.run(Arrays.asList(
                "exec", id, shell, "-c", command), 180000);
        return result(result);
    }

    private Map<String, Object> dockerContainerAction(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        String id = dockerId(p);
        String action = str(p, "action").trim().toLowerCase();
        if (!Arrays.asList("start", "stop", "restart", "pause", "unpause", "remove").contains(action)) {
            throw new IllegalArgumentException("不支持的容器操作: " + action);
        }
        List<String> args = new ArrayList<String>();
        if ("remove".equals(action)) {
            args.add("rm");
            args.add("-f");
        } else {
            args.add(action);
        }
        args.add(id);
        return output(raw(executor, args, "容器操作失败"));
    }

    private Map<String, Object> dockerImages(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        return output(raw(executor, Arrays.asList("images", "--format", "{{json .}}"), "读取镜像"));
    }

    private Map<String, Object> dockerImagePull(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        String ref = safeImage(str(p, "ref"));
        if (ref.isEmpty()) {
            throw new IllegalArgumentException("请填写镜像名称");
        }
        return output(checked(executor.run(Arrays.asList("pull", ref), 600000), "拉取镜像").output);
    }

    private Map<String, Object> dockerImageRemove(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        String id = safeImage(str(p, "id"));
        if (id.isEmpty()) {
            throw new IllegalArgumentException("缺少镜像 ID");
        }
        return output(raw(executor, Arrays.asList("rmi", id), "删除镜像"));
    }

    private Map<String, Object> dockerVolumes(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        return output(raw(executor, Arrays.asList("volume", "ls", "--format", "{{json .}}"), "读取卷"));
    }

    private Map<String, Object> dockerVolumeRemove(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        String name = safeImage(str(p, "name"));
        if (name.isEmpty()) {
            throw new IllegalArgumentException("缺少卷名称");
        }
        return output(raw(executor, Arrays.asList("volume", "rm", name), "删除卷"));
    }

    private Map<String, Object> dockerNetworks(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        return output(raw(executor, Arrays.asList("network", "ls", "--format", "{{json .}}"), "读取网络"));
    }

    private Map<String, Object> dockerNetworkRemove(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "docker");
        String name = safeImage(str(p, "name"));
        if (name.isEmpty()) {
            throw new IllegalArgumentException("缺少网络名称");
        }
        return output(raw(executor, Arrays.asList("network", "rm", name), "删除网络"));
    }

    /* ---------------- Kubernetes ---------------- */

    private Map<String, Object> kubeConnect(Map<String, Object> p) throws Exception {
        Profile profile = findProfile(str(p, "profileId"));
        String kubectlCmd = first(str(p, "kubectlCmd"),
                profile == null ? "kubectl" : profile.kubectlCmd, "kubectl");
        String kubeconfig = str(p, "kubeconfig");
        if (kubeconfig.trim().isEmpty() && profile != null) {
            kubeconfig = decrypt(profile.kubeconfigCipher);
        }
        String kubeContext = first(str(p, "kubeContext"),
                profile == null ? "" : profile.kubeContext, "").trim();
        int timeout = timeout(p, profile);
        String connectionId = newId();
        KubeExecutor executor = KubeExecutor.create(context.getDataDir(), kubectlCmd,
                kubeconfig, kubeContext, connectionId, timeout);
        try {
            CommandRunner.Result version = checked(executor.run(Arrays.asList(
                    "get", "--raw", "/version")), "连接 Kubernetes 集群");
            CommandRunner.Result contexts = executor.run(Arrays.asList(
                    "config", "get-contexts", "-o", "name"));
            CommandRunner.Result current = executor.run(Arrays.asList(
                    "config", "current-context"));
            Conn conn = new Conn();
            conn.id = connectionId;
            conn.type = "kubernetes";
            conn.profileId = profile == null ? "" : profile.id;
            conn.target = kubeContext.isEmpty()
                    ? (current.ok() ? current.output.trim() : "Kubernetes")
                    : kubeContext;
            conn.executor = executor;
            conn.lastUsed = System.currentTimeMillis();
            connections.put(connectionId, conn);
            touchProfile(profile);
            Map<String, Object> out = new LinkedHashMap<String, Object>();
            out.put("connectionId", connectionId);
            out.put("type", "kubernetes");
            out.put("profileId", conn.profileId);
            out.put("name", first(str(p, "name"), profile == null ? "" : profile.name, conn.target));
            out.put("target", conn.target);
            out.put("context", conn.target);
            out.put("currentContext", current.ok() ? current.output.trim() : "");
            out.put("contexts", lines(contexts.ok() ? contexts.output : ""));
            out.put("version", version.output);
            return out;
        } catch (Exception e) {
            executor.close();
            throw e;
        }
    }

    private Map<String, Object> kubeOverview(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "kubernetes");
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("nodes", raw(executor, Arrays.asList("get", "nodes", "-o", "json"), "读取节点"));
        out.put("namespaces", raw(executor,
                Arrays.asList("get", "namespaces", "-o", "json"), "读取命名空间"));
        out.put("pods", raw(executor, Arrays.asList("get", "pods", "-A", "-o", "json"), "读取 Pod"));
        out.put("deployments", raw(executor,
                Arrays.asList("get", "deployments", "-A", "-o", "json"), "读取 Deployment"));
        return out;
    }

    private Map<String, Object> kubePods(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "kubernetes");
        String ns = namespace(p);
        List<String> args = new ArrayList<String>(Arrays.asList("get", "pods"));
        if (ns.isEmpty()) {
            args.add("-A");
        } else {
            args.add("-n");
            args.add(ns);
        }
        args.add("-o");
        args.add("json");
        return output(raw(executor, args, "读取 Pod"));
    }

    private Map<String, Object> kubePodLogs(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "kubernetes");
        String ns = requiredNamespace(p);
        String pod = safeK8sName(str(p, "pod"), "Pod 名称");
        String container = safeK8sName(str(p, "container"), "容器名称");
        List<String> args = new ArrayList<String>(Arrays.asList(
                "logs", "-n", ns, pod, "--tail", String.valueOf(tail(p)), "--timestamps=true"));
        if (!container.isEmpty()) {
            args.add("-c");
            args.add(container);
        }
        return output(checked(executor.run(args, 60000), "读取 Pod 日志").output);
    }

    private Map<String, Object> kubePodExec(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "kubernetes");
        String ns = requiredNamespace(p);
        String pod = safeK8sName(str(p, "pod"), "Pod 名称");
        String container = safeK8sName(str(p, "container"), "容器名称");
        String command = requiredText(p, "command", "请输入要执行的命令");
        String shell = first(str(p, "shell"), "/bin/sh", "/bin/sh");
        if (!shell.matches("[A-Za-z0-9_./-]{1,64}")) {
            throw new IllegalArgumentException("Shell 路径不合法");
        }
        List<String> args = new ArrayList<String>(Arrays.asList("exec", "-n", ns, pod));
        if (!container.isEmpty()) {
            args.add("-c");
            args.add(container);
        }
        args.add("--");
        args.add(shell);
        args.add("-c");
        args.add(command);
        return result(executor.run(args, 180000));
    }

    private Map<String, Object> kubePodDelete(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "kubernetes");
        String ns = requiredNamespace(p);
        String pod = safeK8sName(str(p, "pod"), "Pod 名称");
        return output(raw(executor, Arrays.asList(
                "delete", "pod", pod, "-n", ns, "--wait=false"), "删除 Pod"));
    }

    private Map<String, Object> kubeDeployments(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "kubernetes");
        String ns = namespace(p);
        List<String> args = new ArrayList<String>(Arrays.asList("get", "deployments"));
        if (ns.isEmpty()) {
            args.add("-A");
        } else {
            args.add("-n");
            args.add(ns);
        }
        args.add("-o");
        args.add("json");
        return output(raw(executor, args, "读取 Deployment"));
    }

    private Map<String, Object> kubeDeploymentScale(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "kubernetes");
        String ns = requiredNamespace(p);
        String name = safeK8sName(str(p, "name"), "Deployment 名称");
        int replicas = intVal(p, "replicas", -1);
        if (replicas < 0 || replicas > 1000) {
            throw new IllegalArgumentException("副本数需在 0-1000 之间");
        }
        return output(raw(executor, Arrays.asList("scale", "deployment/" + name,
                "-n", ns, "--replicas=" + replicas), "调整副本数"));
    }

    private Map<String, Object> kubeDeploymentRestart(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "kubernetes");
        String ns = requiredNamespace(p);
        String name = safeK8sName(str(p, "name"), "Deployment 名称");
        return output(raw(executor, Arrays.asList("rollout", "restart",
                "deployment/" + name, "-n", ns), "重启 Deployment"));
    }

    private Map<String, Object> kubeDeploymentDelete(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "kubernetes");
        String ns = requiredNamespace(p);
        String name = safeK8sName(str(p, "name"), "Deployment 名称");
        return output(raw(executor, Arrays.asList("delete", "deployment", name,
                "-n", ns, "--wait=false"), "删除 Deployment"));
    }

    private Map<String, Object> kubeServices(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "kubernetes");
        String ns = namespace(p);
        List<String> args = new ArrayList<String>(Arrays.asList("get", "services"));
        if (ns.isEmpty()) {
            args.add("-A");
        } else {
            args.add("-n");
            args.add(ns);
        }
        args.add("-o");
        args.add("json");
        return output(raw(executor, args, "读取 Service"));
    }

    private Map<String, Object> kubeEvents(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "kubernetes");
        String ns = namespace(p);
        List<String> args = new ArrayList<String>(Arrays.asList("get", "events"));
        if (ns.isEmpty()) {
            args.add("-A");
        } else {
            args.add("-n");
            args.add(ns);
        }
        args.add("-o");
        args.add("json");
        return output(raw(executor, args, "读取事件"));
    }

    private Map<String, Object> kubeDescribe(Map<String, Object> p) throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "kubernetes");
        String kind = str(p, "kind").trim().toLowerCase();
        if (!Arrays.asList("pod", "deployment", "service", "node").contains(kind)) {
            throw new IllegalArgumentException("不支持的 describe 类型");
        }
        String name = safeK8sName(str(p, "name"), "资源名称");
        List<String> args = new ArrayList<String>(Arrays.asList("describe", kind, name));
        String ns = namespace(p);
        if (!ns.isEmpty() && !"node".equals(kind)) {
            args.add("-n");
            args.add(ns);
        }
        return output(raw(executor, args, "读取详情"));
    }

    private Map<String, Object> kubeRaw(Map<String, Object> p, List<String> args, String label)
            throws Exception {
        CommandRunner.Executor executor = executor(str(p, "connectionId"), "kubernetes");
        return output(raw(executor, args, label));
    }

    /* ---------------- profiles ---------------- */

    private List<Map<String, Object>> listProfiles() {
        List<Profile> list = new ArrayList<Profile>(profiles.values());
        Collections.sort(list, new Comparator<Profile>() {
            @Override
            public int compare(Profile a, Profile b) {
                int byTime = Long.compare(b.lastUsedAt, a.lastUsedAt);
                return byTime != 0 ? byTime : a.name.compareToIgnoreCase(b.name);
            }
        });
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        for (Profile profile : list) {
            out.add(safe(profile));
        }
        return out;
    }

    private Map<String, Object> saveProfile(Map<String, Object> p) {
        String id = str(p, "id").trim();
        Profile profile = id.isEmpty() ? null : profiles.get(id);
        if (profile == null) {
            if (profiles.size() >= MAX_PROFILES) {
                throw new IllegalArgumentException("最多保存 " + MAX_PROFILES + " 个连接，请先删除不用的连接");
            }
            profile = new Profile();
            profile.id = newId();
        }
        String type = first(str(p, "type"), profile.type, "docker");
        if (!"docker".equals(type) && !"kubernetes".equals(type)) {
            throw new IllegalArgumentException("连接类型不合法");
        }
        profile.type = type;
        String name = str(p, "name").trim();
        profile.timeoutMs = timeout(p, profile);
        if ("docker".equals(type)) {
            String mode = first(str(p, "mode"), profile.mode, "local");
            profile.mode = "ssh".equalsIgnoreCase(mode) ? "ssh" : "local";
            profile.dockerCmd = first(str(p, "dockerCmd"), profile.dockerCmd, "docker");
            profile.dockerContext = first(str(p, "dockerContext"), profile.dockerContext, "");
            if (!profile.dockerContext.isEmpty()
                    && !profile.dockerContext.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")) {
                throw new IllegalArgumentException("Docker Context 名称不合法");
            }
            if ("ssh".equals(profile.mode)) {
                profile.sshHost = first(str(p, "sshHost"), profile.sshHost, "").trim();
                if (profile.sshHost.isEmpty()) {
                    throw new IllegalArgumentException("请填写 SSH 主机地址");
                }
                profile.sshPort = intVal(p, "sshPort", profile.sshPort <= 0 ? 22 : profile.sshPort);
                if (profile.sshPort < 1 || profile.sshPort > 65535) {
                    throw new IllegalArgumentException("SSH 端口需在 1-65535 之间");
                }
                profile.sshUser = first(str(p, "sshUser"), profile.sshUser, "").trim();
                if (profile.sshUser.isEmpty()) {
                    throw new IllegalArgumentException("请填写 SSH 用户名");
                }
                profile.sshAuth = "key".equalsIgnoreCase(str(p, "sshAuth")) ? "key" : "password";
                updateSecret(p, profile, "password", "clearPassword");
                updateSecret(p, profile, "privateKey", "clearKey");
                updateSecret(p, profile, "passphrase", "clearPassphrase");
                if (profile.passwordCipher.isEmpty() && profile.keyCipher.isEmpty()) {
                    throw new IllegalArgumentException("请填写 SSH 密码或私钥");
                }
                if (name.isEmpty()) {
                    name = profile.sshUser + "@" + profile.sshHost;
                }
            } else {
                if (name.isEmpty()) {
                    name = profile.dockerContext.isEmpty() ? "本机 Docker" : "Docker · " + profile.dockerContext;
                }
            }
        } else {
            profile.kubectlCmd = first(str(p, "kubectlCmd"), profile.kubectlCmd, "kubectl");
            profile.kubeContext = first(str(p, "kubeContext"), profile.kubeContext, "").trim();
            if (profile.kubeContext.length() > 300) {
                throw new IllegalArgumentException("Kubernetes Context 名称过长");
            }
            updateSecret(p, profile, "kubeconfig", "clearKubeconfig");
            if (name.isEmpty()) {
                name = profile.kubeContext.isEmpty() ? "Kubernetes" : profile.kubeContext;
            }
        }
        profile.name = name;
        profile.lastUsedAt = System.currentTimeMillis();
        profiles.put(profile.id, profile);
        try {
            saveProfiles();
        } catch (IOException e) {
            profiles.remove(profile.id);
            throw new IllegalArgumentException("保存连接失败: " + e.getMessage());
        }
        return safe(profile);
    }

    private void updateSecret(Map<String, Object> p, Profile profile, String field, String clearField) {
        boolean clear = bool(p, clearField);
        String value = str(p, field);
        String cipherField = field + "Cipher";
        if ("privateKey".equals(field)) {
            cipherField = "keyCipher";
        }
        if (clear) {
            setCipher(profile, cipherField, "");
        } else if (!value.isEmpty()) {
            setCipher(profile, cipherField, encrypt(value));
        }
    }

    private static void setCipher(Profile profile, String field, String value) {
        if ("passwordCipher".equals(field)) {
            profile.passwordCipher = value;
        } else if ("keyCipher".equals(field)) {
            profile.keyCipher = value;
        } else if ("passphraseCipher".equals(field)) {
            profile.passphraseCipher = value;
        } else if ("kubeconfigCipher".equals(field)) {
            profile.kubeconfigCipher = value;
        }
    }

    private Object deleteProfile(Map<String, Object> p) {
        String id = str(p, "id").trim();
        if (id.isEmpty()) {
            throw new IllegalArgumentException("缺少连接 ID");
        }
        Profile removed = profiles.remove(id);
        if (removed != null) {
            try {
                saveProfiles();
            } catch (IOException e) {
                profiles.put(id, removed);
                throw new IllegalArgumentException("删除连接失败: " + e.getMessage());
            }
            List<String> ids = new ArrayList<String>();
            for (Conn conn : connections.values()) {
                if (id.equals(conn.profileId)) {
                    ids.add(conn.id);
                }
            }
            for (String connId : ids) {
                disconnect(connId);
            }
        }
        return null;
    }

    private Map<String, Object> safe(Profile profile) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("id", profile.id);
        out.put("type", profile.type);
        out.put("name", profile.name);
        out.put("mode", profile.mode);
        out.put("dockerCmd", profile.dockerCmd);
        out.put("dockerContext", profile.dockerContext);
        out.put("sshHost", profile.sshHost);
        out.put("sshPort", profile.sshPort);
        out.put("sshUser", profile.sshUser);
        out.put("sshAuth", profile.sshAuth);
        out.put("kubectlCmd", profile.kubectlCmd);
        out.put("kubeContext", profile.kubeContext);
        out.put("timeoutMs", profile.timeoutMs);
        out.put("lastUsedAt", profile.lastUsedAt);
        out.put("hasPassword", !profile.passwordCipher.isEmpty());
        out.put("hasKey", !profile.keyCipher.isEmpty());
        out.put("hasPassphrase", !profile.passphraseCipher.isEmpty());
        out.put("hasKubeconfig", !profile.kubeconfigCipher.isEmpty());
        return out;
    }

    private void loadProfiles() throws IOException {
        Path file = profileFile();
        if (!Files.isRegularFile(file)) {
            return;
        }
        Properties props = new Properties();
        Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8);
        try {
            props.load(reader);
        } finally {
            reader.close();
        }
        String order = props.getProperty("order", "");
        profiles.clear();
        for (String id : order.split(",")) {
            String key = id.trim();
            if (key.isEmpty() || profiles.containsKey(key)) {
                continue;
            }
            Profile p = new Profile();
            p.id = key;
            p.type = props.getProperty(prefix(key) + "type", "docker").trim();
            if (!"docker".equals(p.type) && !"kubernetes".equals(p.type)) {
                continue;
            }
            p.name = props.getProperty(prefix(key) + "name", "").trim();
            p.mode = props.getProperty(prefix(key) + "mode", "local").trim();
            p.dockerCmd = props.getProperty(prefix(key) + "dockerCmd", "docker").trim();
            p.dockerContext = props.getProperty(prefix(key) + "dockerContext", "").trim();
            p.sshHost = props.getProperty(prefix(key) + "sshHost", "").trim();
            p.sshPort = parseInt(props.getProperty(prefix(key) + "sshPort"), 22);
            p.sshUser = props.getProperty(prefix(key) + "sshUser", "").trim();
            p.sshAuth = props.getProperty(prefix(key) + "sshAuth", "password").trim();
            p.passwordCipher = props.getProperty(prefix(key) + "password", "");
            p.keyCipher = props.getProperty(prefix(key) + "key", "");
            p.passphraseCipher = props.getProperty(prefix(key) + "passphrase", "");
            p.kubectlCmd = props.getProperty(prefix(key) + "kubectlCmd", "kubectl").trim();
            p.kubeconfigCipher = props.getProperty(prefix(key) + "kubeconfig", "");
            p.kubeContext = props.getProperty(prefix(key) + "kubeContext", "").trim();
            p.timeoutMs = parseInt(props.getProperty(prefix(key) + "timeout"), 20000);
            p.lastUsedAt = parseLong(props.getProperty(prefix(key) + "lastUsed"), 0L);
            profiles.put(key, p);
        }
    }

    private void saveProfiles() throws IOException {
        Path file = profileFile();
        Properties props = new Properties();
        StringBuilder order = new StringBuilder();
        for (Profile p : profiles.values()) {
            if (order.length() > 0) {
                order.append(',');
            }
            order.append(p.id);
            String prefix = prefix(p.id);
            props.setProperty(prefix + "type", p.type == null ? "docker" : p.type);
            props.setProperty(prefix + "name", nullToEmpty(p.name));
            props.setProperty(prefix + "mode", nullToEmpty(p.mode));
            props.setProperty(prefix + "dockerCmd", nullToEmpty(p.dockerCmd));
            props.setProperty(prefix + "dockerContext", nullToEmpty(p.dockerContext));
            props.setProperty(prefix + "sshHost", nullToEmpty(p.sshHost));
            props.setProperty(prefix + "sshPort", String.valueOf(p.sshPort));
            props.setProperty(prefix + "sshUser", nullToEmpty(p.sshUser));
            props.setProperty(prefix + "sshAuth", nullToEmpty(p.sshAuth));
            props.setProperty(prefix + "password", nullToEmpty(p.passwordCipher));
            props.setProperty(prefix + "key", nullToEmpty(p.keyCipher));
            props.setProperty(prefix + "passphrase", nullToEmpty(p.passphraseCipher));
            props.setProperty(prefix + "kubectlCmd", nullToEmpty(p.kubectlCmd));
            props.setProperty(prefix + "kubeconfig", nullToEmpty(p.kubeconfigCipher));
            props.setProperty(prefix + "kubeContext", nullToEmpty(p.kubeContext));
            props.setProperty(prefix + "timeout", String.valueOf(p.timeoutMs));
            props.setProperty(prefix + "lastUsed", String.valueOf(p.lastUsedAt));
        }
        props.setProperty("order", order.toString());
        Path temp = file.resolveSibling(file.getFileName().toString() + ".tmp");
        Writer writer = Files.newBufferedWriter(temp, StandardCharsets.UTF_8);
        try {
            props.store(writer, "DeepShell containers plugin connections");
        } finally {
            writer.close();
        }
        try {
            Files.move(temp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                    java.nio.file.StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception atomicFailed) {
            Files.move(temp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
        try {
            Files.setPosixFilePermissions(file,
                    java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
        } catch (Exception ignore) {
            // Windows 忽略
        }
    }

    private Path profileFile() throws IOException {
        if (context == null || context.getDataDir() == null) {
            throw new IOException("插件数据目录不可用");
        }
        Files.createDirectories(context.getDataDir());
        return context.getDataDir().resolve(PROFILE_FILE);
    }

    /* ---------------- helpers ---------------- */

    private CommandRunner.Executor executor(String connectionId, String type) {
        Conn conn = connections.get(connectionId);
        if (conn == null) {
            throw new IllegalArgumentException("连接已断开，请重新连接");
        }
        if (!type.equals(conn.type)) {
            throw new IllegalArgumentException("当前连接类型与操作不匹配");
        }
        conn.lastUsed = System.currentTimeMillis();
        return conn.executor;
    }

    private void disconnect(String connectionId) {
        if (connectionId == null) {
            return;
        }
        Conn conn = connections.remove(connectionId);
        if (conn != null) {
            try {
                conn.executor.close();
            } catch (Exception ignore) {
                // ignore
            }
        }
    }

    private void trimConnections() {
        long now = System.currentTimeMillis();
        List<String> stale = new ArrayList<String>();
        for (Conn conn : connections.values()) {
            if (now - conn.lastUsed > IDLE_TIMEOUT_MS) {
                stale.add(conn.id);
            }
        }
        for (String id : stale) {
            disconnect(id);
        }
        while (connections.size() > MAX_CONNECTIONS) {
            String oldest = null;
            long oldestTime = Long.MAX_VALUE;
            for (Conn conn : connections.values()) {
                if (conn.lastUsed < oldestTime) {
                    oldestTime = conn.lastUsed;
                    oldest = conn.id;
                }
            }
            if (oldest == null) {
                break;
            }
            disconnect(oldest);
        }
    }

    private void cleanupKubeDir() {
        try {
            Path dir = context.getDataDir().resolve(".kube");
            if (!Files.isDirectory(dir)) {
                return;
            }
            java.util.stream.Stream<Path> stream = Files.list(dir);
            try {
                stream.forEach(path -> {
                    try {
                        Files.deleteIfExists(path);
                    } catch (Exception ignore) {
                        // ignore
                    }
                });
            } finally {
                stream.close();
            }
        } catch (Exception ignore) {
            // ignore
        }
    }

    private Profile findProfile(String id) {
        String value = id == null ? "" : id.trim();
        return value.isEmpty() ? null : profiles.get(value);
    }

    private void touchProfile(Profile profile) {
        if (profile == null) {
            return;
        }
        profile.lastUsedAt = System.currentTimeMillis();
        try {
            saveProfiles();
        } catch (IOException ignore) {
            // 最近使用时间保存失败不影响连接
        }
    }

    private CommandRunner.Result checked(CommandRunner.Result result, String label) {
        if (result == null || !result.ok()) {
            String detail = result == null ? ""
                    : (result.stderr.trim().isEmpty() ? result.output : result.stderr);
            detail = CommandRunner.trimForMessage(detail, 1200);
            throw new IllegalArgumentException(label + "失败"
                    + (detail.isEmpty() ? "" : "：" + detail));
        }
        return result;
    }

    private String raw(CommandRunner.Executor executor, List<String> args, String label)
            throws Exception {
        return checked(executor.run(args), label).output;
    }

    private Map<String, Object> output(String output) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("output", output == null ? "" : output);
        return out;
    }

    private Map<String, Object> result(CommandRunner.Result result) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        String output = result.output;
        if (!result.stderr.trim().isEmpty()) {
            output += (output.isEmpty() ? "" : "\n") + "[stderr]\n" + result.stderr;
        }
        out.put("exitCode", result.exitCode);
        out.put("output", output);
        out.put("durationMs", result.durationMs);
        return out;
    }

    private int timeout(Map<String, Object> p, Profile profile) {
        int fallback = profile == null || profile.timeoutMs <= 0 ? 20000 : profile.timeoutMs;
        int value = intVal(p, "timeoutMs", fallback);
        if (value < 2000 || value > 120000) {
            throw new IllegalArgumentException("超时时间需在 2000-120000 毫秒之间");
        }
        return value;
    }

    private int tail(Map<String, Object> p) {
        int value = intVal(p, "tail", 200);
        if (value < 1 || value > 5000) {
            throw new IllegalArgumentException("日志行数需在 1-5000 之间");
        }
        return value;
    }

    private String dockerId(Map<String, Object> p) {
        String id = str(p, "id").trim();
        if (!id.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")) {
            throw new IllegalArgumentException("容器 ID 不合法");
        }
        return id;
    }

    private String safeImage(String value) {
        String text = value == null ? "" : value.trim();
        if (!text.isEmpty() && !text.matches("[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,200}")) {
            throw new IllegalArgumentException("名称不合法");
        }
        return text;
    }

    private String namespace(Map<String, Object> p) {
        String ns = str(p, "namespace").trim();
        if (ns.isEmpty() || "*".equals(ns) || "all".equalsIgnoreCase(ns)) {
            return "";
        }
        if (!ns.matches("[a-z0-9]([-a-z0-9]*[a-z0-9])?") || ns.length() > 63) {
            throw new IllegalArgumentException("命名空间不合法");
        }
        return ns;
    }

    private String requiredNamespace(Map<String, Object> p) {
        String ns = namespace(p);
        if (ns.isEmpty()) {
            throw new IllegalArgumentException("请选择命名空间");
        }
        return ns;
    }

    private String safeK8sName(String value, String label) {
        String name = value == null ? "" : value.trim();
        if (name.isEmpty()) {
            throw new IllegalArgumentException("缺少" + label);
        }
        if (name.length() > 253 || !name.matches("[a-z0-9]([-a-z0-9.]*[a-z0-9])?")) {
            throw new IllegalArgumentException(label + "不合法");
        }
        return name;
    }

    private String requiredText(Map<String, Object> p, String field, String message) {
        String value = str(p, field).trim();
        if (value.isEmpty()) {
            throw new IllegalArgumentException(message);
        }
        if (value.length() > 8000) {
            throw new IllegalArgumentException("命令过长（最多 8000 字符）");
        }
        return value;
    }

    private String encrypt(String plain) {
        if (context == null) {
            throw new IllegalStateException("插件环境尚未初始化");
        }
        String cipher = context.encryptSecret(plain);
        if (cipher == null || cipher.isEmpty()) {
            throw new IllegalArgumentException("敏感信息加密失败");
        }
        return cipher;
    }

    private String decrypt(String cipher) {
        if (cipher == null || cipher.isEmpty() || context == null) {
            return "";
        }
        String plain = context.decryptSecret(cipher);
        if (plain == null) {
            throw new IllegalArgumentException("保存的敏感信息无法解密，请重新填写");
        }
        return plain;
    }

    private static List<String> lines(String text) {
        List<String> out = new ArrayList<String>();
        if (text == null) {
            return out;
        }
        for (String line : text.split("\\r?\\n")) {
            String value = line.trim();
            if (!value.isEmpty()) {
                out.add(value);
            }
        }
        return out;
    }

    private static String prefix(String id) {
        return "conn." + id + ".";
    }

    private static String newId() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    private static String first(String first, String second, String fallback) {
        if (first != null && !first.trim().isEmpty()) {
            return first.trim();
        }
        if (second != null && !second.trim().isEmpty()) {
            return second.trim();
        }
        return fallback;
    }

    private static String str(Map<String, Object> map, String key) {
        Object value = map == null ? null : map.get(key);
        return value == null ? "" : String.valueOf(value);
    }

    private static int intVal(Map<String, Object> map, String key, int fallback) {
        Object value = map == null ? null : map.get(key);
        if (value == null) {
            return fallback;
        }
        try {
            return Integer.parseInt(String.valueOf(value).trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static boolean bool(Map<String, Object> map, String key) {
        Object value = map == null ? null : map.get(key);
        if (value instanceof Boolean) {
            return (Boolean) value;
        }
        return value != null && "true".equalsIgnoreCase(String.valueOf(value).trim());
    }

    private static int parseInt(String value, int fallback) {
        try {
            return Integer.parseInt(value == null ? "" : value.trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static long parseLong(String value, long fallback) {
        try {
            return Long.parseLong(value == null ? "" : value.trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    @Override
    public void close() {
        synchronized (lock) {
            for (Conn conn : new ArrayList<Conn>(connections.values())) {
                try {
                    conn.executor.close();
                } catch (Exception ignore) {
                    // ignore
                }
            }
            connections.clear();
            cleanupKubeDir();
        }
    }

    private static final class Conn {
        String id;
        String type;
        String profileId;
        String target;
        CommandRunner.Executor executor;
        long lastUsed;
    }
}
