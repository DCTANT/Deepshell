'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 暴露最小化的窗口能力给页面：Electron 壳内的全屏走主进程原生窗口全屏，
// 浏览器版页面则回退到 Fullscreen API（见 workspace.js 的 toggleFullscreen）
contextBridge.exposeInMainWorld('deepShellHost', {
    toggleFullscreen: () => ipcRenderer.invoke('deepshell:toggle-fullscreen'),
    isFullscreen: () => ipcRenderer.invoke('deepshell:is-fullscreen'),
    onFullscreenChange: callback => {
        if (typeof callback !== 'function') {
            return function () {};
        }
        const listener = (_event, value) => callback(!!value);
        ipcRenderer.on('deepshell:fullscreen', listener);
        return () => ipcRenderer.removeListener('deepshell:fullscreen', listener);
    }
});
