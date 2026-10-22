package com.itdct.deepshell.web;

import com.itdct.deepshell.common.MobileDetect;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

import javax.servlet.http.HttpServletRequest;

@Controller
public class PageController {

    /** 工作台即首页（连接管理已合并进工作台的「打开连接」弹窗）；手机 UA 自动进入手机版 */
    @GetMapping({"/", "/workspace"})
    public String workspace(HttpServletRequest request,
                            @RequestParam(value = "desktop", required = false) String desktop) {
        if (!"1".equals(desktop) && MobileDetect.isMobile(request.getHeader("User-Agent"))) {
            return "redirect:/m";
        }
        return "workspace";
    }

    /** 手机版：手机桌面（图标网格）+ 终端工作台双模式 */
    @GetMapping({"/m", "/mobile"})
    public String mobile() {
        return "mobile";
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

    /** 独立视频预览页：AI 可视化桌面双击视频时在新标签页打开 */
    @GetMapping("/video-viewer")
    public String videoViewer() {
        return "video-viewer";
    }

    /** 独立音频播放页：AI 可视化桌面双击音频时在新标签页打开 */
    @GetMapping("/audio-viewer")
    public String audioViewer() {
        return "audio-viewer";
    }
}
