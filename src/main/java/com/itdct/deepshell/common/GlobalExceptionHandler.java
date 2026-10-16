package com.itdct.deepshell.common;

import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(Exception.class)
    public R<Void> handle(Exception e) {
        log.warn("request failed: {}", e.toString());
        String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        Throwable cause = e.getCause();
        if (cause != null && cause.getMessage() != null) {
            msg = cause.getMessage();
        }
        return R.err(msg);
    }
}
