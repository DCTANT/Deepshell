package com.itdct.deepshell.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 状态变更请求的跨站校验 */
class OriginGuardInterceptorTest {

    private final OriginGuardInterceptor interceptor = new OriginGuardInterceptor();

    @Test
    void allowsGetWithoutOrigin() throws Exception {
        MockHttpServletRequest request = request("GET");
        request.addHeader("Host", "127.0.0.1:17777");

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
    }

    @Test
    void allowsNativePostWithoutOrigin() throws Exception {
        MockHttpServletRequest request = request("POST");
        request.addHeader("Host", "127.0.0.1:17777");

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
    }

    @Test
    void allowsSameOriginPost() throws Exception {
        MockHttpServletRequest request = request("POST");
        request.addHeader("Host", "127.0.0.1:17777");
        request.addHeader("Origin", "http://127.0.0.1:17777");

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
    }

    @Test
    void rejectsCrossSitePost() throws Exception {
        MockHttpServletRequest request = request("POST");
        request.addHeader("Host", "127.0.0.1:17777");
        request.addHeader("Origin", "http://evil.example");

        MockHttpServletResponse response = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(request, response, new Object()));
        assertEquals(403, response.getStatus());
    }

    @Test
    void rejectsSameHostDifferentPort() throws Exception {
        MockHttpServletRequest request = request("POST");
        request.addHeader("Host", "127.0.0.1:17777");
        request.addHeader("Origin", "http://127.0.0.1:8080");

        assertFalse(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
    }

    @Test
    void rejectsSecFetchSiteCrossSite() throws Exception {
        MockHttpServletRequest request = request("POST");
        request.addHeader("Host", "127.0.0.1:17777");
        request.addHeader("Sec-Fetch-Site", "cross-site");

        assertFalse(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
    }

    @Test
    void allowsReverseProxyForwardedHost() throws Exception {
        MockHttpServletRequest request = request("POST");
        request.addHeader("Host", "127.0.0.1:17777");
        request.addHeader("Origin", "https://deepshell.example.com");
        request.addHeader("X-Forwarded-Host", "deepshell.example.com");

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
    }

    private static MockHttpServletRequest request(String method) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setMethod(method);
        return request;
    }
}
