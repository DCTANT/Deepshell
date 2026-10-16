package com.itdct.deepshell.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConnFileCryptoTest {

    @Test
    void roundTripAsciiAndChinese() throws Exception {
        for (String plain : new String[]{"Test@12345xyz", "qw123456", "zx~7chars", "密码中文Pass123", "a"}) {
            String enc = ConnFileCrypto.encode(plain);
            assertEquals(plain, ConnFileCrypto.decode(enc), "往返失败: " + plain);
            assertTrue(enc.length() >= 24, "密文应包含 8 字节头");
        }
    }

    @Test
    void rejectsMalformedCipher() {
        assertThrows(Exception.class, () -> ConnFileCrypto.decode("not-base64!!!"));
        assertThrows(Exception.class, () -> ConnFileCrypto.decode("QUJD")); // 只有 3 字节，长度不足
    }
}
