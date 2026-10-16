package com.itdct.deepshell.service;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 通过 OpenAI 兼容的 Chat Completions 接口，把自然语言需求翻译为 shell 命令 */
@Service
public class AiCommandService {

    private static final String SYSTEM_PROMPT =
            "你是资深 Linux 运维专家，负责把用户的自然语言需求翻译成可直接在 bash 中执行的 shell 命令。"
                    + "要求：只输出一条命令本身；不要任何解释、说明、markdown 代码块或反引号；不要输出多行；"
                    + "如果需求模糊，给出最常用且安全的实现；涉及删除、覆盖等危险操作时优先使用保守写法。";

    private final AiChatClient client;

    public AiCommandService(AiChatClient client) {
        this.client = client;
    }

    public String translate(String text, String cwd) {
        if (text == null || text.trim().isEmpty()) {
            throw new IllegalArgumentException("请输入要生成命令的需求描述");
        }
        String prompt = text.trim();
        if (cwd != null && !cwd.trim().isEmpty()) {
            prompt = prompt + "\n（当前会话工作目录：" + cwd.trim() + "）";
        }
        List<Map<String, String>> messages = new ArrayList<>();
        Map<String, String> user = new LinkedHashMap<>();
        user.put("role", "user");
        user.put("content", prompt);
        messages.add(user);

        String command = clean(client.complete(SYSTEM_PROMPT, messages));
        if (command.isEmpty()) {
            throw new IllegalStateException("AI 返回内容为空");
        }
        return command;
    }

    /** 去掉模型可能附带的反引号代码块 / 行内反引号 / 首行 $ 提示符，只保留单行命令 */
    private static String clean(String raw) {
        String t = raw == null ? "" : raw.trim();
        if (t.startsWith("```")) {
            int idx = t.indexOf('\n');
            if (idx >= 0) {
                t = t.substring(idx + 1);
            }
            if (t.endsWith("```")) {
                t = t.substring(0, t.length() - 3);
            }
            t = t.trim();
        }
        if (t.length() >= 2 && t.startsWith("`") && t.endsWith("`")) {
            t = t.substring(1, t.length() - 1).trim();
        }
        int nl = t.indexOf('\n');
        if (nl >= 0) {
            t = t.substring(0, nl).trim();
        }
        if (t.startsWith("$ ")) {
            t = t.substring(2).trim();
        }
        return t;
    }
}
