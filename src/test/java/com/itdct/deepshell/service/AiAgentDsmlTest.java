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
