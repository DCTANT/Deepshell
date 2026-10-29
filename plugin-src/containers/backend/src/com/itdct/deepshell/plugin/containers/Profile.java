package com.itdct.deepshell.plugin.containers;

/** 一条保存的 Docker / Kubernetes 连接配置。密文字段不会返回给前端。 */
final class Profile {

    String id;
    String type = "docker";
    String name = "";
    String mode = "local";
    String dockerCmd = "docker";
    String dockerContext = "";
    String sshHost = "";
    int sshPort = 22;
    String sshUser = "";
    String sshAuth = "password";
    String passwordCipher = "";
    String keyCipher = "";
    String passphraseCipher = "";
    String kubectlCmd = "kubectl";
    String kubeconfigCipher = "";
    String kubeContext = "";
    int timeoutMs = 20000;
    long lastUsedAt;
}
