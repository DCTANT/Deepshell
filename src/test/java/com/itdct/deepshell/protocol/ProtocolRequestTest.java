package com.itdct.deepshell.protocol;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ProtocolRequestTest {

    @Test
    void parsesSavedConnectionLink() {
        ProtocolRequest request = ProtocolRequest.parse("deepshell://connect?id=12&view=workbench&source=portal");
        assertEquals(Long.valueOf(12L), request.getConnectionId());
        assertEquals("workbench", request.getView());
        assertEquals("portal", request.getSource());
        assertNull(request.getHost());
        assertEquals("连接 #12", request.describeTarget());
    }

    @Test
    void parsesDirectLinkWithEncodedValues() {
        ProtocolRequest request = ProtocolRequest.parse("deepshell://connect?host=192.168.0.34&port=2222"
                + "&username=root&name=%E7%94%9F%E4%BA%A7%20%E6%9C%8D%E5%8A%A1%E5%99%A8"
                + "&password=p%40ss%26word&source=%E8%BF%90%E7%BB%B4%E9%97%A8%E6%88%B7");
        assertEquals("192.168.0.34", request.getHost());
        assertEquals(2222, request.getPort());
        assertEquals("root", request.getUsername());
        assertEquals("生产 服务器", request.getName());
        assertEquals("p@ss&word", request.getPassword());
        assertEquals("运维门户", request.getSource());
        assertEquals("root@192.168.0.34:2222", request.describeTarget());
    }

    @Test
    void supportsSlashVariantAndFromAlias() {
        ProtocolRequest request = ProtocolRequest.parse("DEEPSHELL://connect/?host=server-1&username=ops"
                + "&from=cmdb");
        assertEquals("server-1", request.getHost());
        assertEquals(22, request.getPort());
        assertEquals("cmdb", request.getSource());
    }

    @Test
    void parsesKeyAuthentication() {
        ProtocolRequest request = ProtocolRequest.parse("deepshell://connect?host=h&username=u"
                + "&authType=key&keyPath=%2Fhome%2Fu%2F.id_rsa&passphrase=secret");
        assertEquals("KEY", request.getAuthType());
        assertEquals("/home/u/.id_rsa", request.getKeyPath());
        assertEquals("secret", request.getPassphrase());
    }

    @Test
    void rejectsInvalidLinks() {
        assertThrows(IllegalArgumentException.class, () -> ProtocolRequest.parse(""));
        assertThrows(IllegalArgumentException.class, () -> ProtocolRequest.parse("https://connect?id=1"));
        assertThrows(IllegalArgumentException.class, () -> ProtocolRequest.parse("deepshell://other?id=1"));
        assertThrows(IllegalArgumentException.class, () -> ProtocolRequest.parse("deepshell://connect?id=abc"));
        assertThrows(IllegalArgumentException.class, () -> ProtocolRequest.parse("deepshell://connect?host=h"));
        assertThrows(IllegalArgumentException.class,
                () -> ProtocolRequest.parse("deepshell://connect?host=h&username=u&port=70000"));
        assertThrows(IllegalArgumentException.class,
                () -> ProtocolRequest.parse("deepshell://connect?host=h%0Aevil&username=u"));
        assertThrows(IllegalArgumentException.class,
                () -> ProtocolRequest.parse("deepshell://connect?host=h&username=u&view=full"));
    }

    @Test
    void acceptsConnIdAlias() {
        ProtocolRequest request = ProtocolRequest.parse("deepshell://connect?connId=9");
        assertEquals(Long.valueOf(9L), request.getConnectionId());
    }

    @Test
    void buildsSavedConnectionLink() {
        assertEquals("deepshell://connect?id=7", ProtocolRequest.linkFor(7L));
    }
}
