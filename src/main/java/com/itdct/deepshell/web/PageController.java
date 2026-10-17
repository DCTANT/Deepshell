package com.itdct.deepshell.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class PageController {

    /** 工作台即首页（连接管理已合并进工作台的「打开连接」弹窗） */
    @GetMapping({"/", "/workspace"})
    public String workspace() {
        return "workspace";
    }

    /** 登录页（开启登录且未登录时由 AuthInterceptor 跳转到这里） */
    @GetMapping("/login")
    public String login() {
        return "login";
    }

    /** 独立图片预览页：AI 可视化桌面双击图片时在新标签页打开 */
    @GetMapping("/image-viewer")
    public String imageViewer() {
        return "image-viewer";
    }
}
