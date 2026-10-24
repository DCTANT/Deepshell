package com.itdct.deepshell.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class AiAgentDsmlTest {

    @Test
    void extractsCommandAndNoteFromHarnessDsml() {
        String dsml = "<|| DSLM || calls>\n"
                + "<|| DSLM || invoke name=\"exec_command\">\n"
                + "<|| DSLM || parameter name=\"cmd\" string=\"true\">"
                + "cd /data/data/com.termux/files/home/jenkins &amp;&amp; unzip -p jenkins.war WEB-INF/web.xml | head -30"
                + "</|| DSLM || parameter>\n"
                + "<|| DSLM || parameter name=\"note\" string=\"true\">查看 jenkins web.xml 的 Servlet 版本"
                + "</|| DSLM || parameter>\n"
                + "</|| DSLM || invoke>\n"
                + "</|| DSLM || calls>";

        assertTrue(AiAgentService.containsDsml(dsml));
        assertEquals("cd /data/data/com.termux/files/home/jenkins && unzip -p jenkins.war WEB-INF/web.xml | head -30",
                AiAgentService.dsmlParameter(dsml, "cmd"));
        assertEquals("查看 jenkins web.xml 的 Servlet 版本",
                AiAgentService.dsmlParameter(dsml, "note"));
        assertEquals("", AiAgentService.visibleReplyText(dsml));
    }

    @Test
    void supportsSinglePipeMarkerAndAttributeOrder() {
        String dsml = "<|DSLM|parameter string=\"true\" name='cmd'>uname -a</|DSLM|parameter>";
        assertTrue(AiAgentService.containsDsml(dsml));
        assertEquals("uname -a", AiAgentService.dsmlParameter(dsml, "cmd"));
    }

    @Test
    void supportsDsmlSpellingAndPlainParameterTag() {
        String command = "curl -s -o /dev/null -w '%{http_code}' http://192.168.0.151:3080/; "
                + "curl -s -m 10 -o /dev/null -w 'public14005:%{http_code}' http://43.137.3.86:14005/ 2>&1";
        String dsml = "< | | DSML | | calls>\n"
                + "< | | DSML | | invoke name=\"code_execution\">\n"
                + "< parameter name=\"cmd\">" + command + "</ parameter>\n"
                + "</ | | DSML | | invoke>\n"
                + "</ | | DSML | | calls>";

        assertTrue(AiAgentService.containsDsml(dsml));
        assertEquals(command, AiAgentService.dsmlParameter(dsml, "cmd"));
        assertEquals("", AiAgentService.visibleReplyText(dsml));
    }

    @Test
    void supportsFullWidthPipesFromChineseModel() {
        String command = "cd ~/Project/deepseek-harness && ls -la";
        String dsml = "<｜｜DSML｜｜ calls>\n"
                + "<｜｜DSML｜｜ invoke name=\"code_execution\">\n"
                + "<｜｜DSML｜｜ parameter name=\"cmd\" string=\"true\">" + command
                + "</｜｜DSML｜｜ parameter>\n"
                + "<｜｜DSML｜｜ parameter name=\"note\" string=\"true\">查看目录"
                + "</｜｜DSML｜｜ parameter>\n"
                + "</｜｜DSML｜｜ invoke>\n"
                + "</｜｜DSML｜｜ calls>";

        assertTrue(AiAgentService.containsDsml(dsml));
        assertEquals(command, AiAgentService.dsmlParameter(dsml, "cmd"));
        assertEquals("查看目录", AiAgentService.dsmlParameter(dsml, "note"));
        assertEquals("", AiAgentService.visibleReplyText(dsml));
    }

    @Test
    void supportsSpacedClosingTagFromScreenshot() {
        String command = "cd ~/Project/deepseek-harness && cat ~/rebuild.log | head -20; "
                + "echo '--- bins ---'; node -e \"console.log(require('/node_modules/tsdown/package.json').bin)\" "
                + ";ls node_modules/typescript/bin.tsc";
        String dsml = "< | | DSML | | calls>\n"
                + "< | | DSML | | invoke name=\"code_execution\">\n"
                + "< | | DSML | | parameter name=\"cmd\" string=\"true\">" + command
                + "</ | | DSML | | parameter>\n"
                + "< | | DSML | | parameter name=\"note\" string=\"true\">查看失败日志与工具二进制路径"
                + "</ | | DSML | | parameter>\n"
                + "</ | | DSML | | invoke>\n"
                + "</ | | DSML | | calls>";

        assertTrue(AiAgentService.containsDsml(dsml));
        assertEquals(command, AiAgentService.dsmlParameter(dsml, "cmd"));
        assertEquals("查看失败日志与工具二进制路径", AiAgentService.dsmlParameter(dsml, "note"));
    }

    @Test
    void acceptsCommandParameterAlias() {
        String dsml = "<|DSML|parameter name=\"command\">ls -la</|DSML|parameter>";
        assertTrue(AiAgentService.containsDsml(dsml));
        assertEquals("ls -la", AiAgentService.dsmlParameter(dsml, "cmd"));
    }

    @Test
    void supportsBareParameterTagsWithoutMarker() {
        String command = "cat /tmp/dsh_cookies.txt; echo '---HEADERS---'; "
                + "curl -s -D - -o /dev/null -m 10 'http://43.137.3.86:14005/?token=abc' | head -20";
        String dsml = "<parameter name=\"cmd\">" + command + "</parameter>\n"
                + "<parameter name=\"note\">查看登录响应头与设置的具体 cookie</parameter>";

        assertTrue(AiAgentService.containsDsml(dsml));
        assertEquals(command, AiAgentService.dsmlParameter(dsml, "cmd"));
        assertEquals("查看登录响应头与设置的具体 cookie",
                AiAgentService.dsmlParameter(dsml, "note"));
        assertEquals("", AiAgentService.visibleReplyText(dsml));
    }

    @Test
    void truncatedDsmlIsDetectedButDoesNotExecute() {
        String dsml = "<|| DSLM || calls>\n<|| DSLM || parameter name=\"cmd\" string=\"true\">rm -rf /tmp/x";
        assertTrue(AiAgentService.containsDsml(dsml));
        assertNull(AiAgentService.dsmlParameter(dsml, "cmd"));
    }

    @Test
    void plainReplyIsNotDsml() {
        assertFalse(AiAgentService.containsDsml("{\"reply\":\"完成\"}"));
        assertNull(AiAgentService.dsmlParameter("普通回复", "cmd"));
    }
}
