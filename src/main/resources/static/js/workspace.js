/* 终端工作台：多标签 xterm + WebSocket + SFTP 面板 + 快捷命令 */

/* 登录过期统一跳转登录页，并带上当前地址以便登录后返回 */
function redirectToLogin() {
    if (location.pathname === '/login') {
        return;
    }
    var back = location.pathname + location.search;
    location.href = '/login?redirect=' + encodeURIComponent(back);
}

var http = axios.create({});
http.interceptors.response.use(function (resp) {
    var d = resp.data;
    if (d && typeof d === 'object' && 'code' in d) {
        if (d.code !== 0) {
            if (!(resp.config && resp.config.silent)) {
                ELEMENT.Message.error(d.msg || '请求失败');
            }
            return Promise.reject(new Error(d.msg || 'error'));
        }
        return d.data;
    }
    return d;
}, function (err) {
    if (err && err.response && err.response.status === 401) {
        redirectToLogin();
        return Promise.reject(err);
    }
    if (!(err && err.config && err.config.silent)) {
        ELEMENT.Message.error('网络错误: ' + (err.message || err));
    }
    return Promise.reject(err);
});

var TERM_THEME = {
    background: '#101318',
    foreground: '#d7dde8',
    cursor: '#4c8dff',
    cursorAccent: '#101318',
    selection: 'rgba(76, 141, 255, 0.35)',
    black: '#1b1f27', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#dcdfe4'
};

var SEARCH_DECOR = {
    matchBackground: 'rgba(76, 141, 255, .35)',
    matchOverviewRuler: '#4c8dff',
    activeMatchBackground: 'rgba(255, 176, 46, .55)',
    activeMatchColorOverviewRuler: '#ffb02e'
};

function loadCmdOpts() {
    try {
        var s = localStorage.getItem('deepshell.cmdOpts');
        if (s) {
            var o = JSON.parse(s);
            return {
                clearAfterSend: o.clearAfterSend !== false,
                appendCr: o.appendCr !== false,
                ignoreBlank: o.ignoreBlank !== false
            };
        }
    } catch (e) { /* ignore */ }
    return { clearAfterSend: true, appendCr: true, ignoreBlank: true };
}

function loadHistory(connId) {
    try {
        var s = localStorage.getItem('deepshell.cmdHistory.' + connId);
        if (s) {
            var a = JSON.parse(s);
            if (Array.isArray(a)) {
                return a;
            }
        }
    } catch (e) { /* ignore */ }
    return [];
}

/* 快捷命令发送目标模式（仅持久化模式；勾选的会话 key 随页面重载失效，不持久化） */
function loadSnippetTarget() {
    try {
        var v = localStorage.getItem('deepshell.snippetTarget');
        if (v === 'all' || v === 'custom' || v === 'current') {
            return v;
        }
    } catch (e) { /* ignore */ }
    return 'current';
}

/* SFTP 是否跟随终端 cd 目录（默认开启） */
function loadSftpFollow() {
    try {
        return localStorage.getItem('deepshell.sftpFollow') !== '0';
    } catch (e) { /* ignore */ }
    return true;
}

/* AI 可视化桌面：记住上次使用的图标视图 */
function loadDesktopView() {
    try {
        var v = localStorage.getItem('deepshell.desktopView');
        if (v === 'large' || v === 'medium' || v === 'small' || v === 'list') {
            return v;
        }
    } catch (e) { /* ignore */ }
    return 'large';
}

/* 桌面设置：图片缩略图 / 显示隐藏文件 */
function loadDesktopThumbs() {
    try {
        return localStorage.getItem('deepshell.desktopThumbs') !== '0';
    } catch (e) { /* ignore */ }
    return true;
}

function loadDesktopShowHidden() {
    try {
        return localStorage.getItem('deepshell.desktopShowHidden') !== '0';
    } catch (e) { /* ignore */ }
    return true;
}

function loadDesktopClock24h() {
    try {
        return localStorage.getItem('deepshell.clock24h') !== '0';
    } catch (e) { /* ignore */ }
    return true;
}

function loadDesktopClockSeconds() {
    try {
        var v = localStorage.getItem('deepshell.clockSeconds');
        return v == null ? true : v === '1';
    } catch (e) { /* ignore */ }
    return true;
}

function loadDesktopClockShowDate() {
    try {
        return localStorage.getItem('deepshell.clockShowDate') !== '0';
    } catch (e) { /* ignore */ }
    return true;
}

function loadDesktopIdleMinutes() {
    try {
        var v = parseInt(localStorage.getItem('deepshell.idleMinutes'), 10);
        return isNaN(v) || v < 0 ? 0 : v;
    } catch (e) { /* ignore */ }
    return 0;
}

/* ---------- AI 可视化桌面：外观主题 ---------- */
var DESKTOP_APPEARANCE_KEY = 'deepshell.desktopAppearance';
var DESKTOP_THEME_DEFAULT = 'dark';

var DESKTOP_THEMES = [
    {
        id: 'dark', label: '深色', desc: '深海夜色 · 冷蓝光晕',
        accent: '#4c8dff',
        wallpaper: 'radial-gradient(1100px 700px at 78% 6%, rgba(64, 122, 255, .30), transparent 60%),'
            + ' radial-gradient(900px 600px at 6% 96%, rgba(34, 211, 199, .12), transparent 60%),'
            + ' linear-gradient(140deg, #070c16 0%, #0f1a2c 46%, #0a111d 100%)',
        windowColor: '#1b2433', windowTransparency: 6,
        taskbarColor: '#0c1119', taskbarTransparency: 8,
        iconFg: '#e6eefb', iconShadow: '0 1px 3px rgba(0, 0, 0, .7)',
        gridLine: 'rgba(130, 175, 255, .05)'
    },
    {
        id: 'light', label: '浅色', desc: '清爽白昼 · 柔和蓝光',
        accent: '#2f6fd6',
        wallpaper: 'radial-gradient(1100px 700px at 80% 4%, rgba(96, 165, 250, .30), transparent 60%),'
            + ' radial-gradient(820px 560px at 4% 94%, rgba(251, 191, 36, .13), transparent 62%),'
            + ' linear-gradient(135deg, #f8fbff 0%, #e9f1fb 52%, #dfeaf8 100%)',
        windowColor: '#ffffff', windowTransparency: 6,
        taskbarColor: '#eef2f7', taskbarTransparency: 8,
        iconFg: '#233047', iconShadow: '0 1px 2px rgba(255, 255, 255, .85)',
        gridLine: 'rgba(64, 110, 180, .07)'
    },
    {
        id: 'spring', label: '春日', desc: '嫩芽绿 · 暖阳米色',
        accent: '#2f9e6b',
        wallpaper: 'radial-gradient(1000px 660px at 82% 8%, rgba(134, 239, 172, .38), transparent 62%),'
            + ' radial-gradient(900px 600px at 4% 92%, rgba(253, 186, 116, .20), transparent 60%),'
            + ' linear-gradient(135deg, #fbfff5 0%, #e8f6e3 50%, #f7f3e4 100%)',
        windowColor: '#fbfdf7', windowTransparency: 8,
        taskbarColor: '#e6f2e3', taskbarTransparency: 10,
        iconFg: '#26402e', iconShadow: '0 1px 2px rgba(255, 255, 255, .8)',
        gridLine: 'rgba(63, 157, 106, .08)'
    },
    {
        id: 'pink', label: '粉紫', desc: '粉紫渐变 · 柔光梦幻',
        accent: '#c14fd6',
        wallpaper: 'radial-gradient(1100px 700px at 78% 4%, rgba(244, 114, 182, .34), transparent 62%),'
            + ' radial-gradient(900px 620px at 8% 94%, rgba(168, 85, 247, .26), transparent 62%),'
            + ' linear-gradient(135deg, #fff7fd 0%, #f3e8ff 48%, #fde9f4 100%)',
        windowColor: '#fdf7ff', windowTransparency: 8,
        taskbarColor: '#f1e5fa', taskbarTransparency: 10,
        iconFg: '#43294f', iconShadow: '0 1px 2px rgba(255, 255, 255, .8)',
        gridLine: 'rgba(192, 90, 214, .08)'
    },
    {
        id: 'cyber', label: '赛博朋克', desc: '霓虹青紫 · 暗夜脉冲',
        accent: '#00e5ff',
        wallpaper: 'radial-gradient(900px 640px at 86% 10%, rgba(0, 229, 255, .26), transparent 60%),'
            + ' radial-gradient(860px 600px at 6% 90%, rgba(255, 0, 200, .24), transparent 62%),'
            + ' linear-gradient(140deg, #05030a 0%, #12081f 48%, #06020c 100%)',
        windowColor: '#130f1e', windowTransparency: 10,
        taskbarColor: '#08050e', taskbarTransparency: 8,
        iconFg: '#f3e9ff', iconShadow: '0 0 10px rgba(0, 229, 255, .45), 0 1px 3px rgba(0, 0, 0, .85)',
        gridLine: 'rgba(0, 229, 255, .07)'
    },
    {
        id: 'classic', label: '经典', desc: '原有深蓝桌面 · 明亮窗口',
        accent: '#3d7eff',
        wallpaper: 'radial-gradient(1000px 620px at 76% 12%, rgba(61, 126, 255, .28), transparent 62%),'
            + ' radial-gradient(760px 520px at 10% 92%, rgba(45, 212, 191, .10), transparent 60%),'
            + ' linear-gradient(135deg, #14171f 0%, #16325c 52%, #1d2331 100%)',
        windowColor: '#ffffff', windowTransparency: 2,
        taskbarColor: '#141922', taskbarTransparency: 6,
        iconFg: '#e1ebfa', iconShadow: '0 1px 2px rgba(0, 0, 0, .55)',
        gridLine: 'rgba(130, 175, 255, .045)'
    }
];

var DESKTOP_ICON_SIZES = [
    { id: 'small', label: '小', dot: 12 },
    { id: 'medium', label: '中', dot: 16 },
    { id: 'large', label: '大', dot: 20 }
];

/* ---------- AI 可视化桌面：系统应用图标样式 ---------- */
var DESKTOP_APP_ICON_STYLE_PREFIX = 'deepshell.desktopAppIconStyles.';
var DESKTOP_APP_ICON_IMAGE_MAX = 600000;
var DESKTOP_APP_RELEASE_FALLBACK = '2026-10-21';

var DESKTOP_APP_SHAPES = [
    { id: 'rounded', label: '圆角' },
    { id: 'circle', label: '圆形' },
    { id: 'square', label: '方形' }
];

var DESKTOP_APP_ICON_COLORS = [
    '#3d7eff', '#22a06b', '#e6a23c', '#f56c6c', '#8b5cf6',
    '#0ea5a4', '#f59e0b', '#ec4899', '#64748b', '#111827'
];

var DESKTOP_APP_START_IDS = {
    ai: 'ai',
    editor: 'editor',
    terminal: 'terminal',
    transfers: 'transfers',
    explorer: 'file',
    settings: 'control',
    appcenter: 'appcenter'
};

var DESKTOP_APP_DEFAULTS = {
    explorer: { icon: 'el-icon-folder-opened', color: '#e6a23c' },
    trash: { icon: 'el-icon-delete', color: '#7b8798' },
    editor: { icon: 'el-icon-edit-outline', color: '#3d7eff' },
    terminal: { icon: 'el-icon-monitor', color: '#22a06b' },
    transfers: { icon: 'el-icon-s-promotion', color: '#0ea5a4' },
    settings: { icon: 'el-icon-setting', color: '#54657e' },
    appcenter: { icon: 'el-icon-shopping-bag-1', color: '#8b5cf6' },
    ai: { icon: 'el-icon-chat-dot-round', color: '#3d7eff' }
};

var DESKTOP_START_ICON_DEFAULTS = {
    ai: { icon: 'el-icon-chat-dot-round', color: '#3d7eff' },
    editor: { icon: 'el-icon-edit-outline', color: '#3d7eff' },
    terminal: { icon: 'el-icon-monitor', color: '#22a06b' },
    transfers: { icon: 'el-icon-s-promotion', color: '#0ea5a4' },
    file: { icon: 'el-icon-folder-opened', color: '#e6a23c' },
    control: { icon: 'el-icon-setting', color: '#54657e' },
    appcenter: { icon: 'el-icon-shopping-bag-1', color: '#8b5cf6' }
};

var DESKTOP_DEFAULT_ICON_CHOICES = [
    'el-icon-monitor', 'el-icon-folder-opened', 'el-icon-folder', 'el-icon-folder-add',
    'el-icon-folder-checked', 'el-icon-folder-delete', 'el-icon-folder-remove',
    'el-icon-document', 'el-icon-document-add', 'el-icon-document-copy',
    'el-icon-document-checked', 'el-icon-document-remove', 'el-icon-files', 'el-icon-tickets',
    'el-icon-notebook-2', 'el-icon-edit', 'el-icon-edit-outline', 'el-icon-setting',
    'el-icon-s-tools', 'el-icon-s-operation', 'el-icon-s-promotion', 'el-icon-s-grid',
    'el-icon-s-fold', 'el-icon-s-platform', 'el-icon-cpu', 'el-icon-coin',
    'el-icon-pie-chart', 'el-icon-data-line', 'el-icon-data-analysis', 'el-icon-data-board',
    'el-icon-odometer', 'el-icon-connection', 'el-icon-link', 'el-icon-share',
    'el-icon-upload2', 'el-icon-download', 'el-icon-refresh', 'el-icon-refresh-left',
    'el-icon-search', 'el-icon-view', 'el-icon-picture', 'el-icon-picture-outline',
    'el-icon-video-play', 'el-icon-video-camera', 'el-icon-headset', 'el-icon-microphone',
    'el-icon-magic-stick', 'el-icon-chat-dot-round', 'el-icon-chat-line-round',
    'el-icon-bell', 'el-icon-message', 'el-icon-star-on', 'el-icon-star-off',
    'el-icon-delete', 'el-icon-delete-solid', 'el-icon-key', 'el-icon-lock',
    'el-icon-unlock', 'el-icon-user', 'el-icon-user-solid', 'el-icon-house',
    'el-icon-office-building', 'el-icon-location', 'el-icon-location-outline',
    'el-icon-map-location', 'el-icon-time', 'el-icon-alarm-clock', 'el-icon-date',
    'el-icon-rank', 'el-icon-sort', 'el-icon-price-tag', 'el-icon-goods',
    'el-icon-printer', 'el-icon-camera'
];

function desktopAppDefaultStyle(action) {
    return DESKTOP_APP_DEFAULTS[action] || null;
}

function desktopAppStylesKey(connId) {
    return connId == null || connId === ''
        ? '' : DESKTOP_APP_ICON_STYLE_PREFIX + String(connId);
}

function desktopValidAppImage(image) {
    return typeof image === 'string'
        && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(image)
        && image.length <= DESKTOP_APP_ICON_IMAGE_MAX;
}

/* 图标样式与上传图片均按连接隔离 */
function loadDesktopAppIconStyles(connId) {
    var out = {};
    var key = desktopAppStylesKey(connId);
    if (!key) {
        return out;
    }
    try {
        var raw = localStorage.getItem(key);
        var data = raw ? JSON.parse(raw) : null;
        if (!data || typeof data !== 'object') {
            return out;
        }
        Object.keys(data).forEach(function (action) {
            var def = DESKTOP_APP_DEFAULTS[action];
            if (!def) {
                return;
            }
            var s = data[action] || {};
            var icon = (typeof s.icon === 'string' && /^el-icon-[a-z0-9-]+$/.test(s.icon))
                ? s.icon : def.icon;
            var shape = (s.shape === 'circle' || s.shape === 'square') ? s.shape : 'rounded';
            out[action] = {
                icon: icon,
                color: desktopNormalizeHex(s.color, def.color),
                shape: shape,
                image: desktopValidAppImage(s.image) ? s.image : ''
            };
        });
    } catch (e) { /* ignore */ }
    return out;
}

function saveDesktopAppIconStyles(connId, styles) {
    var key = desktopAppStylesKey(connId);
    if (!key) {
        return;
    }
    try {
        if (!styles || !Object.keys(styles).length) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, JSON.stringify(styles));
        }
    } catch (e) { /* ignore */ }
}

/* 从 Element 图标样式中读取可用图标；读取失败时使用常用图标兜底 */
function loadDesktopAppIconChoices() {
    var set = {};
    try {
        for (var i = 0; i < document.styleSheets.length; i++) {
            var rules;
            try {
                rules = document.styleSheets[i].cssRules;
            } catch (e) {
                continue;
            }
            if (!rules) {
                continue;
            }
            for (var j = 0; j < rules.length; j++) {
                var selector = rules[j].selectorText;
                if (!selector) {
                    continue;
                }
                var parts = selector.split(',');
                for (var k = 0; k < parts.length; k++) {
                    var m = parts[k].trim().match(/^\.(el-icon-[a-z0-9-]+)::?before$/);
                    if (m && m[1] !== 'el-icon-loading') {
                        set[m[1]] = true;
                    }
                }
            }
        }
    } catch (e) { /* ignore */ }
    var out = Object.keys(set);
    out.sort();
    return out.length ? out : DESKTOP_DEFAULT_ICON_CHOICES.slice();
}

function desktopThemeById(id) {
    for (var i = 0; i < DESKTOP_THEMES.length; i++) {
        if (DESKTOP_THEMES[i].id === id) {
            return DESKTOP_THEMES[i];
        }
    }
    return DESKTOP_THEMES[0];
}

function desktopDefaultAppearance() {
    var t = desktopThemeById(DESKTOP_THEME_DEFAULT);
    return {
        theme: t.id,
        accentColor: '',
        windowColor: t.windowColor,
        windowTransparency: t.windowTransparency,
        windowTextColor: '',
        windowBorderColor: '',
        taskbarColor: t.taskbarColor,
        taskbarTransparency: t.taskbarTransparency,
        taskbarIconColor: '',
        desktopIconTextColor: '',
        iconSize: 'medium'
    };
}

function desktopOptionalHex(v) {
    return v == null || v === '' ? '' : desktopNormalizeHex(v, '');
}

/* 单次外观快照：内置主题、颜色微调与自定义方案都使用同一结构 */
function desktopSanitizeAppearance(data) {
    var def = desktopDefaultAppearance();
    if (!data || typeof data !== 'object') {
        return def;
    }
    var theme = desktopThemeById(data.theme);
    var size = data.iconSize;
    if (size !== 'small' && size !== 'medium' && size !== 'large') {
        size = def.iconSize;
    }
    return {
        theme: theme.id,
        accentColor: desktopOptionalHex(data.accentColor),
        windowColor: desktopNormalizeHex(data.windowColor, theme.windowColor),
        windowTransparency: desktopClampNumber(data.windowTransparency, 0, 70, theme.windowTransparency),
        windowTextColor: desktopOptionalHex(data.windowTextColor),
        windowBorderColor: desktopOptionalHex(data.windowBorderColor),
        taskbarColor: desktopNormalizeHex(data.taskbarColor, theme.taskbarColor),
        taskbarTransparency: desktopClampNumber(data.taskbarTransparency, 0, 70, theme.taskbarTransparency),
        taskbarIconColor: desktopOptionalHex(data.taskbarIconColor),
        desktopIconTextColor: desktopOptionalHex(data.desktopIconTextColor),
        iconSize: size
    };
}

function desktopAppearanceSnapshot(app) {
    var a = desktopSanitizeAppearance(app);
    return {
        theme: a.theme,
        accentColor: a.accentColor,
        windowColor: a.windowColor,
        windowTransparency: a.windowTransparency,
        windowTextColor: a.windowTextColor,
        windowBorderColor: a.windowBorderColor,
        taskbarColor: a.taskbarColor,
        taskbarTransparency: a.taskbarTransparency,
        taskbarIconColor: a.taskbarIconColor,
        desktopIconTextColor: a.desktopIconTextColor,
        iconSize: a.iconSize
    };
}

function desktopClampNumber(v, min, max, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (isNaN(n)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, n));
}

function desktopNormalizeHex(v, fallback) {
    if (typeof v !== 'string') {
        return fallback;
    }
    var s = v.trim();
    if (/^#[0-9a-f]{3}$/i.test(s)) {
        return ('#' + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2)
            + s.charAt(3) + s.charAt(3)).toLowerCase();
    }
    if (/^#[0-9a-f]{6}$/i.test(s)) {
        return s.toLowerCase();
    }
    return fallback;
}

function desktopHexToRgb(hex) {
    var s = String(hex || '').replace('#', '');
    if (s.length === 3) {
        s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    }
    if (s.length !== 6) {
        return [0, 0, 0];
    }
    return [
        parseInt(s.substring(0, 2), 16),
        parseInt(s.substring(2, 4), 16),
        parseInt(s.substring(4, 6), 16)
    ];
}

function desktopRgbToHex(r, g, b) {
    var to = function (n) {
        var s = Math.max(0, Math.min(255, Math.round(n))).toString(16);
        return s.length < 2 ? '0' + s : s;
    };
    return '#' + to(r) + to(g) + to(b);
}

/* ratio > 0 向白色混合，ratio < 0 向黑色混合 */
function desktopShadeHex(hex, ratio) {
    var rgb = desktopHexToRgb(hex);
    var target = ratio < 0 ? 0 : 255;
    var p = Math.min(1, Math.abs(ratio));
    return desktopRgbToHex(
        rgb[0] + (target - rgb[0]) * p,
        rgb[1] + (target - rgb[1]) * p,
        rgb[2] + (target - rgb[2]) * p
    );
}

function desktopColorIsDark(hex) {
    var rgb = desktopHexToRgb(hex);
    return (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255 < 0.55;
}

function desktopRgba(hex, alpha) {
    var rgb = desktopHexToRgb(hex);
    return 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + Math.max(0, Math.min(1, alpha)).toFixed(2) + ')';
}

/* 桌面图标大小：桌面根图标与资源管理器窗口内视图互不影响 */
function desktopIconMetrics(size) {
    if (size === 'small') {
        return {
            cellW: 80, cellH: 90, boxW: 76, boxH: 90, gap: 5,
            app: 38, appFont: 20, appRadius: 8,
            folderW: 46, folderH: 38, fileW: 36, fileH: 44, fileFont: 12,
            thumb: 40, nameFont: 11, nameLine: 1.3, nameMaxH: 28,
            padX: 10, padY: 12
        };
    }
    if (size === 'large') {
        return {
            cellW: 120, cellH: 128, boxW: 114, boxH: 128, gap: 7,
            app: 60, appFont: 31, appRadius: 11,
            folderW: 66, folderH: 54, fileW: 54, fileH: 66, fileFont: 18,
            thumb: 58, nameFont: 13, nameLine: 1.35, nameMaxH: 36,
            padX: 14, padY: 18
        };
    }
    return {
        cellW: 96, cellH: 104, boxW: 92, boxH: 104, gap: 6,
        app: 48, appFont: 25, appRadius: 9,
        folderW: 54, folderH: 44, fileW: 44, fileH: 54, fileFont: 15,
        thumb: 48, nameFont: 12, nameLine: 1.32, nameMaxH: 32,
        padX: 12, padY: 16
    };
}

function loadDesktopAppearance() {
    try {
        var raw = localStorage.getItem(DESKTOP_APPEARANCE_KEY);
        var data = raw ? JSON.parse(raw) : null;
        return desktopSanitizeAppearance(data);
    } catch (e) {
        return desktopDefaultAppearance();
    }
}

function saveDesktopAppearance(app) {
    if (!app) {
        return;
    }
    try {
        localStorage.setItem(DESKTOP_APPEARANCE_KEY, JSON.stringify(desktopAppearanceSnapshot(app)));
    } catch (e) { /* ignore */ }
}

/* 用户保存的自定义外观方案（与主题预设分开保存，切换预设不会丢失） */
var DESKTOP_CUSTOM_APPEARANCE_KEY = 'deepshell.desktopCustomAppearances';
var DESKTOP_CUSTOM_APPEARANCE_LIMIT = 20;

function loadDesktopCustomAppearances() {
    try {
        var raw = localStorage.getItem(DESKTOP_CUSTOM_APPEARANCE_KEY);
        var list = raw ? JSON.parse(raw) : null;
        if (!Array.isArray(list)) {
            return [];
        }
        var out = [];
        list.forEach(function (item) {
            if (!item || typeof item !== 'object') {
                return;
            }
            var name = String(item.name || '').trim();
            if (!name) {
                return;
            }
            out.push({
                id: String(item.id || ('custom-' + out.length + '-' + Date.now())),
                name: name.slice(0, 24),
                createdAt: Number(item.createdAt) || Date.now(),
                appearance: desktopSanitizeAppearance(item.appearance)
            });
        });
        return out.slice(0, DESKTOP_CUSTOM_APPEARANCE_LIMIT);
    } catch (e) {
        return [];
    }
}

function saveDesktopCustomAppearances(list) {
    try {
        localStorage.setItem(DESKTOP_CUSTOM_APPEARANCE_KEY,
            JSON.stringify((list || []).slice(0, DESKTOP_CUSTOM_APPEARANCE_LIMIT)));
    } catch (e) { /* ignore */ }
}

/* 任务管理器「启动应用」开关（按浏览器持久化） */
function loadDesktopStartup() {
    try {
        var raw = localStorage.getItem('deepshell.desktopStartup');
        var data = raw ? JSON.parse(raw) : null;
        return data && typeof data === 'object' ? data : {};
    } catch (e) { /* ignore */ }
    return {};
}

/* AI 可视化桌面：每个资源管理器窗口拥有独立的浏览状态与几何信息 */
function createDesktopWindow(id) {
    return {
        id: id || '',
        type: 'explorer',
        termTab: null,
        /* 桌面插件应用窗口 */
        pluginId: '',
        pluginName: '',
        pluginTitle: '',
        pluginVersion: '',
        pluginIconUrl: '',
        pluginUrl: '',
        pluginVerified: false,
        pluginBackend: false,
        /* 桌面代码编辑器窗口 */
        editorPath: '',
        editorTitle: '',
        editorSubtitle: '',
        editorDirty: false,
        editorPendingPath: '',
        editorPendingSeq: 0,
        path: '',
        pathInput: '',
        pathEditing: false,
        entries: [],
        loading: false,
        error: '',
        history: [],
        future: [],
        viewMode: loadDesktopView(),
        sortBy: 'name',
        sortDir: 'asc',
        keyword: '',
        selected: [],
        lastSelected: '',
        marquee: { visible: false, left: 0, top: 0, width: 0, height: 0 },
        dragNames: [],
        dropTarget: '',
        fileDragOver: false,
        winDragOver: false,
        pendingSelect: '',
        pendingOpen: false,
        thumbSrc: {},
        thumbFailed: {},
        /* 回收站窗口状态 */
        trashItems: [],
        trashLoading: false,
        trashError: '',
        /* 磁盘窗口状态（与工作台标签页的磁盘字段一致） */
        diskPath: '',
        diskEntries: [],
        diskTotalKb: null,
        diskLoading: false,
        diskError: '',
        diskTruncated: false,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        min: false,
        max: false,
        normal: null,
        z: 0,
        dragging: false,
        resizing: false,
        /* 任务管理器中的进程视图数据（桌面应用为估算值，随采样刷新） */
        tmPid: 0,
        tmCpu: 0,
        tmMem: 0,
        tmDisk: 0,
        tmNet: 0
    };
}

function loadOpenAfterConnect() {
    try {
        var v = localStorage.getItem('deepshell.openAfterConnect');
        if (v === 'workbench' || v === 'desktop') {
            return v;
        }
    } catch (e) { /* ignore */ }
    return 'desktop';
}

/* 终端危险命令确认：默认开启，可在设置中关闭 */
function loadDangerConfirmEnabled() {
    try {
        return localStorage.getItem('deepshell.dangerConfirm') !== '0';
    } catch (e) { /* ignore */ }
    return true;
}

function loadTermLogHighlight() {
    try {
        return localStorage.getItem('deepshell.termLogHighlight') !== '0';
    } catch (e) { /* ignore */ }
    return true;
}

/* 本次启动（同一标签页会话）只有首个连接自动进桌面，之后新开连接一律保持终端标签 */
function consumeFirstConnect() {
    try {
        if (sessionStorage.getItem('deepshell.firstConnectDone') === '1') {
            return false;
        }
        sessionStorage.setItem('deepshell.firstConnectDone', '1');
        return true;
    } catch (e) {
        return true;
    }
}

/* ---------- AI 终端对话（服务端 SQLite 持久化；这里只保留浏览器旧数据的一次性迁移） ---------- */
var AI_CHAT_MAX = 160;              // 每个对话保留的消息数上限（与后端一致，迁移时裁剪）
var AI_MAX_STEPS_DEFAULT = 50;      // 单轮默认最大步数（可在 AI 设置中调整，1-100）
var AI_MAX_STEPS_LIMIT = 100;
var AI_HISTORY_MAX = 50;            // 输入框 ↑↓ 历史条数
var AI_CONTEXT_WINDOW_DEFAULT = 400000; // 上下文窗口默认值（AI 设置中按模型调整）
var AI_CONTEXT_WINDOW_MIN = 4096;
var AI_CONTEXT_WINDOW_MAX = 2000000;
var AI_CONTEXT_RETAIN_RATIO = 0.16; // 压缩时保留最近约 16% 的上下文窗口（与 DSH 默认一致）
var AI_CONTEXT_THRESHOLD_RATIO = 0.80; // 超过窗口 80% 提示压缩
var AI_SYSTEM_PROMPT_TOKENS = 1200; // 系统提示词与工具说明的粗略固定开销

/* 读取浏览器里旧存的对话（新格式 deepshell.aiConv / 更早的单对话格式），返回待上传数组或 [] */
function readStoredAiConvs(connId) {
    try {
        var s = localStorage.getItem('deepshell.aiConv.' + connId);
        if (s) {
            var d = JSON.parse(s);
            if (d && Array.isArray(d.convs) && d.convs.length) {
                return d.convs.map(function (c) {
                    return {
                        title: c.title || '新对话',
                        cwd: c.cwd || null,
                        active: c.id === d.activeId,
                        msgs: Array.isArray(c.msgs) ? c.msgs.slice(-AI_CHAT_MAX) : []
                    };
                });
            }
        }
    } catch (e) { /* ignore */ }
    try {
        var oldRaw = localStorage.getItem('deepshell.aiChat.' + connId);
        var oldMsgs = oldRaw ? JSON.parse(oldRaw) : null;
        if (Array.isArray(oldMsgs) && oldMsgs.length) {
            var msgs = oldMsgs.slice(-AI_CHAT_MAX);
            var first = msgs.find(function (m) { return m.role === 'user' && m.text; });
            return [{
                title: first ? first.text.slice(0, 20) : '新对话',
                cwd: localStorage.getItem('deepshell.aiCwd.' + connId) || null,
                active: true,
                msgs: msgs
            }];
        }
    } catch (e) { /* ignore */ }
    return [];
}

function clearStoredAiConvs(connId) {
    try {
        localStorage.removeItem('deepshell.aiConv.' + connId);
        localStorage.removeItem('deepshell.aiChat.' + connId);
        localStorage.removeItem('deepshell.aiCwd.' + connId);
    } catch (e) { /* ignore */ }
}

function loadAiChatMode() {
    try {
        if (localStorage.getItem('deepshell.aiChatMode') === 'manual') {
            return 'manual';
        }
    } catch (e) { /* ignore */ }
    return 'auto';
}

/* 端口转发表单默认值 */
function emptyPfForm() {
    return {
        connectionId: null, direction: 'LOCAL', bindHost: '127.0.0.1', bindPort: 8080,
        destHost: '127.0.0.1', destPort: 80, autoStart: true
    };
}

/* 浏览器侧会话键：F5 后带同一个键重连，服务端可复用仍未断开的 SSH 会话 */
function newSessionKey() {
    try {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID().replace(/-/g, '');
        }
    } catch (e) { /* ignore */ }
    return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

/* 终端会话状态：工作台标签与桌面终端窗口共用同一套字段 */
function createTerminalState(connId, conn, clientKey) {
    var tab = {
        key: 'tab' + Date.now() + Math.floor(Math.random() * 1000),
        clientKey: clientKey || newSessionKey(),
        connId: connId,
        autoOpenDesktop: false,
        desktopOpenPath: '',
        desktopOnly: false,
        windowId: '',
        title: conn ? conn.name : ('连接 #' + connId),
        host: conn ? conn.host : '',
        port: conn ? (conn.port || 22) : 22,
        status: 'connecting',
        sessionId: null,
        ws: null,
        term: null,
        reconnectAttempts: 0,
        reconnectTimer: null,
        explicitClose: false,
        serverClosed: false,
        notifyDisconnect: false,
        hostKeyPending: false,
        fit: null,
        sftpPath: '',
        sftpEntries: [],
        sftpSelected: [],
        sftpLoading: false,
        sftpHome: null,
        sftpHistory: [],
        termCwd: null,
        diskPath: '',
        diskEntries: [],
        diskTotalKb: null,
        diskLoading: false,
        diskError: '',
        diskTruncated: false,
        searchAddon: null,
        searchResultIndex: -1,
        searchResultCount: 0,
        stats: null,
        procList: [],
        procLoading: false,
        procKeyword: '',
        procAuto: true,
        cmdText: '',
        cmdVisible: true,
        termAutoScrollEnabled: false,
        cmdHistory: loadHistory(connId),
        desktopBg: loadDesktopBgSettings(connId),
        sendTargets: [],
        aiVisible: false,
        aiText: '',
        aiLoading: false,
        chatConvs: [],
        chatConvId: null,
        chatMsgs: [],
        chatInput: '',
        chatLoading: true,
        chatMode: loadAiChatMode()
    };
    tab.sendTargets = [tab.key];
    return tab;
}

/* 拼给 shell 的安全路径参数（单引号包裹并转义内部单引号） */
function quoteShellPath(path) {
    return "'" + String(path == null || path === '' ? '/' : path).replace(/'/g, "'\\''") + "'";
}

/* 每次 AI 请求的 runId：前端停止时用它通知服务端取消模型/命令 */
function newAiRunId() {
    return 'ai' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/* ---------- AI 回复的轻量 Markdown 渲染（先转义 HTML，模型输出不会注入页面） ---------- */
function escapeAiHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* ---------- 终端危险命令识别 ---------- */
function dangerousCommandRule(command) {
    return dangerousCommandRuleDepth(command, 0);
}

function dangerousCommandRuleDepth(command, depth) {
    var raw = String(command == null ? '' : command);
    if (!raw.trim()) {
        return null;
    }
    var norm = raw.replace(/\\\r?\n/g, ' ').replace(/\r\n?/g, '\n');
    var prefix = '(?:(?:sudo|doas|command|builtin|exec)(?:\\s+-[^\\s]+)*\\s+|env(?:\\s+[A-Za-z_][A-Za-z0-9_]*=\\S+)*\\s+)*';
    var re = new RegExp('(?:^|[;&|\\n]\\s*|[$#]\\s+)\\s*' + prefix
        + '((?:[^\\s/]+/)*[A-Za-z][A-Za-z0-9_.-]*)\\b([^;&|\\n]*)', 'g');
    var match;
    while ((match = re.exec(norm)) !== null) {
        var name = String(match[1] || '').split('/').pop().toLowerCase();
        var args = String(match[2] || '').trim().split(/\s+/).filter(Boolean);
        var rule = dangerousCommandFromArgs(name, args, depth);
        if (rule) {
            return rule;
        }
    }
    if (/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/i.test(norm)) {
        return { id: 'fork-bomb', label: 'Fork 炸弹，可能耗尽系统进程' };
    }
    if (/(?:^|[^0-9A-Za-z_])>\s*\/dev\/(?:sd|vd|nvme|hd|mmcblk|mapper)\w*/i.test(norm)) {
        return { id: 'device-write', label: '直接写入磁盘设备，可能破坏数据' };
    }
    return null;
}

function dangerousCommandFromArgs(name, args, depth) {
    var i;
    if (name === 'rm') {
        var flags = [];
        var targets = [];
        for (i = 0; i < args.length; i++) {
            var a = args[i];
            if (a === '--') {
                continue;
            }
            if (a.charAt(0) === '-' && a.length > 1) {
                flags.push(a);
            } else {
                targets.push(a);
            }
        }
        var flagText = flags.join(' ');
        var recursive = /(^|\s)--recursive(\s|$)/.test(flagText) || /(^|\s)-[A-Za-z]*[rR]/.test(flagText);
        var force = /(^|\s)--force(\s|$)/.test(flagText) || /(^|\s)-[A-Za-z]*f/.test(flagText);
        var noPreserve = /--no-preserve-root/.test(flagText);
        if ((recursive || force || noPreserve)
                && targets.some(function (t) { return protectedSystemTarget(t); })) {
            return { id: 'rm-system', label: '递归或强制删除系统关键目录' };
        }
        return null;
    }
    if (name === 'mkfs' || name.indexOf('mkfs.') === 0) {
        return { id: 'mkfs', label: '格式化文件系统，会清空分区数据' };
    }
    if (name === 'dd') {
        for (i = 0; i < args.length; i++) {
            if (/^of=\/dev\/(?:sd|vd|nvme|hd|mmcblk|mapper)/i.test(args[i])) {
                return { id: 'dd-device', label: '直接写入磁盘设备，可能破坏数据' };
            }
        }
        return null;
    }
    if (name === 'shutdown' || name === 'reboot' || name === 'poweroff' || name === 'halt') {
        return { id: 'power', label: '关机、重启或停机操作' };
    }
    if (name === 'init' && /^(0|6)$/.test(args[0] || '')) {
        return { id: 'init-power', label: '切换运行级别 0/6，会关机或重启' };
    }
    if (name === 'systemctl' && args.some(function (x) {
        return /^(reboot|poweroff|halt|shutdown)$/.test(x);
    })) {
        return { id: 'systemctl-power', label: '关机、重启或停机操作' };
    }
    if (name === 'wipefs') {
        return { id: 'wipefs', label: '擦除文件系统签名，可能导致分区不可用' };
    }
    if ((name === 'fdisk' || name === 'parted' || name === 'sgdisk')
            && !args.some(function (x) { return x === '-l' || x === '--list'; })) {
        return { id: 'partition', label: '磁盘分区编辑操作，可能破坏分区表' };
    }
    if (name === 'kill') {
        var kill9 = args.indexOf('-9') >= 0 || args.indexOf('-KILL') >= 0;
        var pids = args.filter(function (x) { return /^\d+$/.test(x); });
        if (kill9 && pids.indexOf('1') >= 0) {
            return { id: 'kill-init', label: '强制结束 PID 1，可能导致系统崩溃' };
        }
        return null;
    }
    if (name === 'chmod' || name === 'chown') {
        var rootTarget = args.some(function (x) { return protectedSystemTarget(x); });
        if (rootTarget) {
            return {
                id: name + '-system',
                label: name === 'chmod' ? '修改系统关键目录权限' : '修改系统关键目录所有者'
            };
        }
        return null;
    }
    if (name === 'find') {
        var findRoot = args.length && protectedSystemTarget(args[0]);
        var deleting = args.indexOf('-delete') >= 0
            || (args.indexOf('-exec') >= 0 && args.indexOf('rm') >= 0);
        if (findRoot && deleting) {
            return { id: 'find-delete', label: '批量删除系统关键目录文件' };
        }
        return null;
    }
    if ((name === 'bash' || name === 'sh' || name === 'zsh' || name === 'dash') && depth < 2) {
        var ci = args.indexOf('-c');
        if (ci >= 0) {
            var inner = args.slice(ci + 1).join(' ').replace(/^['"]|['"]$/g, '');
            if (inner) {
                return dangerousCommandRuleDepth(inner, depth + 1);
            }
        }
    }
    return null;
}

function protectedSystemTarget(token) {
    var s = String(token || '').replace(/^['"]|['"]$/g, '').toLowerCase();
    if (!s) {
        return false;
    }
    if (/^(~|\$home|\$\{home\})(\/\*?)?$/.test(s)) {
        return true;
    }
    if (/^\/(?:\*?)$/.test(s)) {
        return true;
    }
    return /^\/(?:bin|sbin|etc|usr|var|boot|lib|lib64|opt|home|root|dev|sys|proc|run|srv|mnt|media)(?:\/\*?)?$/.test(s);
}

/* ---------- 终端日志级别高亮 ----------
 * 只在普通缓冲区生效，按 VSCode 日志习惯给 INFO / WARN / ERROR 等级别着色。
 * 高亮器会保留原始 ANSI 转义序列，并缓存跨数据块的不完整转义序列。
 */
var TERM_LOG_LEVEL_COLORS = {
    INFO: '92',
    WARN: '93',
    WARNING: '93',
    ERROR: '91',
    DEBUG: '96',
    TRACE: '90',
    FATAL: '95',
    CRITICAL: '95',
    NOTICE: '94'
};
var TERM_LOG_LEVEL_WORDS = ['INFO', 'WARN', 'WARNING', 'ERROR', 'DEBUG', 'TRACE', 'FATAL', 'CRITICAL', 'NOTICE'];
var TERM_LOG_LEVEL_RE = /\b(INFO|WARN(?:ING)?|ERROR|DEBUG|TRACE|FATAL|CRITICAL|NOTICE)\b/gi;
var TERM_ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-_])/g;

function terminalLogColorizeText(text) {
    return String(text || '').replace(TERM_LOG_LEVEL_RE, function (level) {
        var color = TERM_LOG_LEVEL_COLORS[level.toUpperCase()];
        return color ? ('\x1b[' + color + 'm' + level + '\x1b[39m') : level;
    });
}

function terminalLogAnsiCut(text) {
    var idx = text.lastIndexOf('\x1b');
    if (idx < 0) {
        return text.length;
    }
    var tail = text.slice(idx);
    if (/^\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*)?$/.test(tail)) {
        return idx;
    }
    if (/^\x1b\[[0-?]*[ -/]*[@-~]/.test(tail)
            || /^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/.test(tail)
            || /^\x1b[@-_]/.test(tail)) {
        return text.length;
    }
    return text.length;
}

function terminalLogLevelPrefix(word) {
    var w = String(word || '').toUpperCase();
    if (w.length < 3 || !/^[A-Z]+$/.test(w)) {
        return false;
    }
    for (var i = 0; i < TERM_LOG_LEVEL_WORDS.length; i++) {
        var level = TERM_LOG_LEVEL_WORDS[i];
        if (level !== w && level.indexOf(w) === 0) {
            return true;
        }
    }
    return false;
}

/* 把新输出追加到待处理缓冲，返回可立即写入的文本和需要继续等待的尾部 */
function terminalLogHighlightChunk(pending, chunk) {
    var buf = (pending || '') + (chunk || '');
    if (!buf) {
        return { out: '', pending: '' };
    }
    var cut = terminalLogAnsiCut(buf);
    var head = buf.slice(0, cut);
    var word = head.match(/([A-Za-z]{3,})$/);
    if (word && terminalLogLevelPrefix(word[1])) {
        cut -= word[1].length;
        head = buf.slice(0, cut);
    }
    var out = '';
    var last = 0;
    var match;
    TERM_ANSI_RE.lastIndex = 0;
    while ((match = TERM_ANSI_RE.exec(head)) !== null) {
        out += terminalLogColorizeText(head.slice(last, match.index));
        out += match[0];
        last = match.index + match[0].length;
    }
    out += terminalLogColorizeText(head.slice(last));
    return { out: out, pending: buf.slice(cut) };
}


/* 去掉思考过程 / 正文里残留的 DSML、DSLM 工具调用标记（部分模型会把工具调用写在 reasoning_content） */
function stripDsmlText(src) {
    var text = String(src == null ? '' : src)
        .replace(/｜/g, '|')
        .replace(/＜/g, '<')
        .replace(/＞/g, '>')
        .replace(/\u3000/g, ' ')
        .replace(/＂/g, '"')
        .replace(/＇/g, "'");
    // 模型偶尔把 <system>...</system> 当成正文/思考输出，直接清掉
    text = text.replace(/<\s*system\b[^>]*>[\s\S]*?<\s*\/\s*system\s*>/gi, ' ');
    text = text.replace(/<\s*\|?\s*system\s*\|?\s*>[\s\S]*?<\s*\/\s*\|?\s*system\s*\|?\s*>/gi, ' ');
    text = text.replace(/<\s*\/?\s*\|?\s*system\s*\|?\s*>/gi, ' ');
    var mark = '\\|\\s*\\|?\\s*DS(?:LM|ML)\\s*\\|\\s*\\|?\\s*';
    text = text.replace(new RegExp('<\\s*' + mark + 'calls\\s*>[\\s\\S]*?'
            + '<\\s*\\/\\s*' + mark + 'calls\\s*>', 'gi'), ' ');
    text = text.replace(new RegExp('<\\s*' + mark + 'parameter\\b[^>]*>[\\s\\S]*?'
            + '<\\s*\\/\\s*' + mark + 'parameter\\s*>', 'gi'), ' ');
    text = text.replace(/<\s*parameter\b[^>]*>[\s\S]*?<\s*\/\s*parameter\s*>/gi, ' ');
    text = text.replace(new RegExp('<\\s*\\/?\\s*' + mark + '(?:invoke|parameter)\\b[^>]*>', 'gi'), ' ');
    text = text.replace(/<\s*\/?\s*parameter\b[^>]*>/gi, ' ');
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

Vue.filter('cleanReasoning', function (text) {
    return stripDsmlText(text);
});

/* 模型偶尔把普通回复包成 JSON；兼容标准 JSON 和带真实换行的“漂亮 JSON” */
function extractAiReply(src) {
    var text = String(src == null ? '' : src).trim();
    if (!text || text.charAt(0) !== '{' || text.indexOf('"reply"') < 0) {
        return null;
    }
    try {
        var obj = JSON.parse(text);
        if (obj && typeof obj.reply === 'string' && obj.reply.trim()) {
            return obj.reply;
        }
    } catch (e) {
        // 继续宽松提取
    }
    var at = text.indexOf('"reply"');
    var colon = text.indexOf(':', at + 7);
    if (colon < 0) {
        return null;
    }
    var start = colon + 1;
    while (start < text.length && /\s/.test(text.charAt(start))) {
        start++;
    }
    if (text.charAt(start) !== '"') {
        return null;
    }
    var out = '';
    for (var i = start + 1; i < text.length; i++) {
        var c = text.charAt(i);
        if (c === '\\' && i + 1 < text.length) {
            var e = text.charAt(++i);
            if (e === 'n') {
                out += '\n';
            } else if (e === 'r') {
                out += '\r';
            } else if (e === 't') {
                out += '\t';
            } else if (e === 'u' && i + 4 < text.length) {
                try {
                    out += String.fromCharCode(parseInt(text.substr(i + 1, 4), 16));
                    i += 4;
                } catch (err) {
                    out += 'u';
                }
            } else {
                out += e;
            }
            continue;
        }
        if (c === '"') {
            var j = i + 1;
            while (j < text.length && /\s/.test(text.charAt(j))) {
                j++;
            }
            if (j >= text.length || text.charAt(j) === ',' || text.charAt(j) === '}') {
                break;
            }
            out += c;
            continue;
        }
        out += c;
    }
    return out.trim() ? out : null;
}

function aiInlineMarkdown(text) {
    var codes = [];
    var s = escapeAiHtml(text);
    // 行内代码先占位，避免其中的 * [ ] 被继续解析
    s = s.replace(/`([^`\n]+)`/g, function (_, code) {
        codes.push(code);
        return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) {
        return '<code>' + codes[Number(i)] + '</code>';
    });
    return s;
}

/* 支持标题、列表、代码块、引用、分隔线与段落；未闭合的代码块也能正常展示（流式输出） */
function renderAiMarkdown(src) {
    var text = String(src == null ? '' : src).replace(/\r\n/g, '\n');
    var reply = extractAiReply(text);
    if (reply != null) {
        text = reply;
    }
    if (!text) {
        return '';
    }
    var out = [];
    var para = [];
    var list = '';
    var inCode = false;
    var codeLang = '';
    var code = [];

    function flushPara() {
        if (!para.length) {
            return;
        }
        out.push('<p>' + para.map(aiInlineMarkdown).join('<br>') + '</p>');
        para = [];
    }
    function closeList() {
        if (list) {
            out.push('</' + list + '>');
            list = '';
        }
    }
    function openList(type) {
        if (list === type) {
            return;
        }
        closeList();
        list = type;
        out.push('<' + type + '>');
    }
    function flushCode() {
        out.push('<pre class="md-pre">'
            + (codeLang ? '<span class="md-lang">' + escapeAiHtml(codeLang) + '</span>' : '')
            + '<code>' + escapeAiHtml(code.join('\n')) + '</code></pre>');
        code = [];
        codeLang = '';
    }

    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var trimmed = line.trim();
        if (inCode) {
            if (/^```/.test(trimmed)) {
                inCode = false;
                flushCode();
            } else {
                code.push(line);
            }
            continue;
        }
        var fence = trimmed.match(/^```\s*([A-Za-z0-9_+-]*)\s*$/);
        if (fence) {
            flushPara();
            closeList();
            inCode = true;
            codeLang = fence[1] || '';
            continue;
        }
        if (!trimmed) {
            flushPara();
            closeList();
            continue;
        }
        var h = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (h) {
            flushPara();
            closeList();
            out.push('<div class="md-h md-h' + h[1].length + '">' + aiInlineMarkdown(h[2]) + '</div>');
            continue;
        }
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
            flushPara();
            closeList();
            out.push('<hr class="md-hr">');
            continue;
        }
        var quote = trimmed.match(/^>\s?(.*)$/);
        if (quote) {
            flushPara();
            closeList();
            out.push('<blockquote class="md-quote">' + aiInlineMarkdown(quote[1]) + '</blockquote>');
            continue;
        }
        var ul = line.match(/^\s{0,3}[-*+]\s+(.+)$/);
        if (ul) {
            flushPara();
            openList('ul');
            out.push('<li>' + aiInlineMarkdown(ul[1]) + '</li>');
            continue;
        }
        var ol = line.match(/^\s{0,3}\d+[.)]\s+(.+)$/);
        if (ol) {
            flushPara();
            openList('ol');
            out.push('<li>' + aiInlineMarkdown(ol[1]) + '</li>');
            continue;
        }
        closeList();
        para.push(line);
    }
    flushPara();
    closeList();
    if (inCode) {
        flushCode();
    }
    return out.join('');
}

/* 每个对话独立的运行态：不同对话可同时生成/执行，互不阻塞 */
function createAiConvRun() {
    return {
        busy: false,
        stop: false,
        step: 0,
        seq: 0,
        phase: '',
        streamText: '',
        reasonText: '',
        requestId: '',
        abortController: null,
        execController: null
    };
}

function clipAiSteps(n) {
    var v = parseInt(n, 10);
    if (isNaN(v)) {
        return AI_MAX_STEPS_DEFAULT;
    }
    return Math.max(1, Math.min(AI_MAX_STEPS_LIMIT, v));
}

function clipAiContextWindow(n) {
    var v = parseInt(n, 10);
    if (isNaN(v)) {
        return AI_CONTEXT_WINDOW_DEFAULT;
    }
    return Math.max(AI_CONTEXT_WINDOW_MIN, Math.min(AI_CONTEXT_WINDOW_MAX, v));
}

function formatTokenCount(n) {
    var v = Math.max(0, Math.round(Number(n) || 0));
    if (v < 1000) {
        return String(v);
    }
    var scaled = function (x) {
        return x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10);
    };
    return v < 1000000 ? scaled(v / 1000) + 'K' : scaled(v / 1000000) + 'M';
}

/* 上下文 token 粗估：中文 / 日文 / 韩文约 1.6 字符/token，代码与英文约 4 字符/token */
function estimateTextTokens(text) {
    var s = String(text == null ? '' : text);
    var cjk = 0;
    var other = 0;
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if ((c >= 0x2E80 && c <= 0x9FFF) || (c >= 0xAC00 && c <= 0xD7AF)
                || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFF00 && c <= 0xFFEF)
                || (c >= 0x3040 && c <= 0x30FF)) {
            cjk++;
        } else {
            other++;
        }
    }
    return Math.ceil(cjk / 1.6 + other / 4);
}

/* 自动重连延迟（毫秒），超过次数后停止并提示手动重连 */
var RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000, 30000, 30000, 30000];
var UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;

/* 把 ls 的权限字符串（如 drwxr-xr-x）转成三位八进制 */
function permsToOctal(perms) {
    if (!perms || perms.length < 9) {
        return '';
    }
    var s = perms.slice(-9);
    var out = '';
    for (var i = 0; i < 3; i++) {
        var v = 0;
        if (s.charAt(i * 3) === 'r') v += 4;
        if (s.charAt(i * 3 + 1) === 'w') v += 2;
        var x = s.charAt(i * 3 + 2);
        if (x === 'x' || x === 's' || x === 't') v += 1;
        out += v;
    }
    return out;
}

function clearReconnectTimer(tab) {
    if (tab && tab.reconnectTimer) {
        clearTimeout(tab.reconnectTimer);
        tab.reconnectTimer = null;
    }
}

/* WebSocket 非主动关闭时按退避间隔自动重连；服务端保留会话时会直接附着并回放输出 */
function scheduleReconnect(app, tab) {
    if (!tab || tab.localShell || tab.explicitClose || tab.serverClosed || tab.hostKeyPending) {
        return;
    }
    clearReconnectTimer(tab);
    var attempts = tab.reconnectAttempts || 0;
    if (attempts >= RECONNECT_DELAYS.length) {
        tab.status = 'error';
        if (tab.term) {
            tab.term.write('\r\n\x1b[31m● 自动重连失败，请右键「重新连接」\x1b[0m\r\n');
        }
        return;
    }
    tab.reconnectAttempts = attempts + 1;
    tab.status = 'reconnecting';
    if (tab.term) {
        tab.term.write('\r\n\x1b[33m● 连接中断，正在重连（'
            + tab.reconnectAttempts + '/' + RECONNECT_DELAYS.length + '）…\x1b[0m\r\n');
    }
    var delay = RECONNECT_DELAYS[attempts];
    tab.reconnectTimer = setTimeout(function () {
        tab.reconnectTimer = null;
        if (tab.explicitClose || tab.serverClosed) {
            return;
        }
        app.reconnectTab(tab, true);
    }, delay);
}

/* 记住当前窗口打开的会话标签（sessionStorage 天然按浏览器标签页隔离），用于 F5 后恢复 */
function saveOpenTabs(app) {
    try {
        var state = {
            tabs: app.tabs.map(function (t) {
                return { connId: t.connId, key: t.clientKey };
            }),
            activeKey: app.activeTab ? app.activeTab.clientKey : null
        };
        sessionStorage.setItem('deepshell.openTabs', JSON.stringify(state));
    } catch (e) { /* ignore */ }
}

function loadStored(key, def) {
    try {
        var s = localStorage.getItem(key);
        if (s) {
            var o = JSON.parse(s);
            if (o && typeof o === 'object') {
                for (var k in o) {
                    if (Object.prototype.hasOwnProperty.call(o, k)) {
                        def[k] = o[k];
                    }
                }
            }
        }
    } catch (e) { /* ignore */ }
    return def;
}

function loadFontSettings() {
    return loadStored('deepshell.font', {
        family: '"JetBrains Mono", Consolas, "Courier New", monospace',
        size: 13.5
    });
}

function loadHotkeySettings() {
    return loadStored('deepshell.hotkey', { doubleCtrl: true, tabComplete: true, escClose: true });
}

function loadBgSettings() {
    return loadStored('deepshell.bg', { url: '', opacity: 0.35, blur: 0 });
}

function loadDesktopBgSettings(connId) {
    var def = { url: '', opacity: 0.35, blur: 0 };
    var stored = null;
    try {
        var s = connId != null ? localStorage.getItem('deepshell.desktopBg.' + connId) : null;
        if (!s) {
            // 兼容旧版全局桌面背景：该连接还没单独设置过时沿用
            s = localStorage.getItem('deepshell.desktopBg');
        }
        if (s) {
            stored = JSON.parse(s);
        }
    } catch (e) { /* ignore */ }
    if (stored && typeof stored === 'object') {
        for (var k in stored) {
            if (Object.prototype.hasOwnProperty.call(stored, k)) {
                def[k] = stored[k];
            }
        }
    }
    return def;
}

var sortFolders = function (a, b) {
    return (a.sortOrder || 0) - (b.sortOrder || 0) || a.id - b.id;
};

var sortConns = function (a, b) {
    return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        || (a.sortOrder || 0) - (b.sortOrder || 0)
        || a.id - b.id;
};

/* AI 终端对话面板：右侧面板与桌面 AI 窗口共用同一份模板 */
Vue.component('ai-chat-panel', {
    props: {
        tab: { type: Object, required: true },
        context: { type: String, default: 'panel' }
    },
    template: '#ai-chat-panel-tpl',
    data: function () {
        var ctx = this.context === 'window' ? 'window' : 'panel';
        var width = ctx === 'window' ? 170 : 116;
        try {
            var saved = parseInt(localStorage.getItem('deepshell.aiConvWidth.' + ctx), 10);
            if (saved >= 90) {
                width = Math.min(saved, 360);
            }
        } catch (e) {
            // 本地存储不可用时使用默认宽度
        }
        return {
            stick: true,
            slashOpen: false,
            slashIndex: 0,
            convMenu: { visible: false, x: 0, y: 0, conv: null },
            convWidth: width,
            renamingId: null,
            renameText: ''
        };
    },
    computed: {
        convList: function () {
            var t = this.tab;
            if (!t || !t.chatConvs) {
                return [];
            }
            return t.chatConvs.slice().sort(function (a, b) {
                var pa = a.pinned ? 1 : 0;
                var pb = b.pinned ? 1 : 0;
                if (pa !== pb) {
                    return pb - pa;
                }
                return (b.updatedAt || 0) - (a.updatedAt || 0);
            });
        },
        examples: function () {
            return this.$root.chatExamples || [];
        },
        activeConv: function () {
            return this.$root.aiActiveConv(this.tab);
        },
        activeRun: function () {
            var c = this.activeConv;
            return c && c._run ? c._run : null;
        },
        activeBusy: function () {
            return !!(this.activeRun && this.activeRun.busy);
        },
        stepLimit: function () {
            return this.$root.aiMaxSteps || AI_MAX_STEPS_DEFAULT;
        },
        stepText: function () {
            var run = this.activeRun;
            if (!run || !run.busy) {
                return '';
            }
            return '第 ' + Math.min(run.step || 0, this.stepLimit) + '/' + this.stepLimit + ' 步';
        },
        contextWindow: function () {
            return this.$root.aiContextWindow || AI_CONTEXT_WINDOW_DEFAULT;
        },
        lastUsage: function () {
            return this.$root.aiLastUsage(this.activeConv);
        },
        contextEstimateTokens: function () {
            return this.$root.aiEstimateContextTokens(this.activeConv);
        },
        contextTokens: function () {
            var exact = this.lastUsage && this.lastUsage.promptTokens != null
                ? Number(this.lastUsage.promptTokens) : 0;
            return Math.max(this.contextEstimateTokens, exact);
        },
        contextPercent: function () {
            var w = this.contextWindow || AI_CONTEXT_WINDOW_DEFAULT;
            return Math.max(0, Math.min(100, Math.round(this.contextTokens * 100 / w)));
        },
        contextLevel: function () {
            if (this.contextPercent >= 90) {
                return 'danger';
            }
            return this.contextPercent >= AI_CONTEXT_THRESHOLD_RATIO * 100 ? 'warn' : '';
        },
        contextUsageText: function () {
            return formatTokenCount(this.contextTokens);
        },
        contextWindowText: function () {
            return formatTokenCount(this.contextWindow);
        },
        cacheHitText: function () {
            var u = this.lastUsage;
            if (!u || !u.promptTokens || u.cachedTokens == null) {
                return '—';
            }
            var pct = Number(u.cachedTokens) * 100 / Number(u.promptTokens);
            return (pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)) + '%';
        },
        compacting: function () {
            return !!(this.activeConv && this.activeConv._compacting);
        },
        hasCompact: function () {
            var msgs = (this.activeConv && this.activeConv.msgs) || [];
            for (var i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i] && msgs[i].role === 'compact') {
                    return true;
                }
            }
            return false;
        },
        contextTitle: function () {
            return '上下文估算 ' + this.contextUsageText + ' / ' + this.contextWindowText
                + '（' + this.contextPercent + '%），点击查看用量与压缩';
        },
        queueItems: function () {
            var c = this.activeConv;
            return (c && c._queue) || [];
        },
        canCompact: function () {
            return !!(this.activeConv && !this.activeBusy && !this.compacting
                && this.contextPercent > 50);
        },
        slashItems: function () {
            if (!this.slashOpen) {
                return [];
            }
            var v = (this.tab.chatInput || '').trim();
            var m = v.match(/^\/([^\s]*)$/);
            if (!m) {
                return [];
            }
            var q = m[1].toLowerCase();
            return (this.$root.aiSlashCommands || []).filter(function (c) {
                return !q || c.id.indexOf(q) === 0;
            });
        }
    },
    watch: {
        'tab.chatMsgs': {
            deep: true,
            handler: function () {
                this.scrollToBottom(false);
            }
        },
        'tab.chatLoading': function (v) {
            if (v) {
                this.stick = true;
            }
            this.scrollToBottom(false);
        },
        'tab.chatConvId': function () {
            this.stick = true;
            this.slashOpen = false;
            this.scrollToBottom(true);
        },
        slashItems: function (items) {
            if (this.slashIndex >= items.length) {
                this.slashIndex = 0;
            }
        }
    },
    mounted: function () {
        this.scrollToBottom(true);
        var self = this;
        this._onConvMenuKey = function (e) {
            if (e.key === 'Escape') {
                self.closeConvMenu();
                self.cancelRename();
            }
        };
        window.addEventListener('keydown', this._onConvMenuKey);
        this._onDocPointer = function (e) {
            if (!self.convMenu.visible) {
                return;
            }
            var menu = self.$refs.convMenu;
            if (menu && (menu === e.target || menu.contains(e.target))) {
                return;
            }
            self.closeConvMenu();
        };
        document.addEventListener('mousedown', this._onDocPointer, true);
        document.addEventListener('contextmenu', this._onDocPointer, true);
    },
    beforeDestroy: function () {
        if (this._onConvMenuKey) {
            window.removeEventListener('keydown', this._onConvMenuKey);
            this._onConvMenuKey = null;
        }
        if (this._onDocPointer) {
            document.removeEventListener('mousedown', this._onDocPointer, true);
            document.removeEventListener('contextmenu', this._onDocPointer, true);
            this._onDocPointer = null;
        }
        if (this._onResizeMove) {
            document.removeEventListener('mousemove', this._onResizeMove);
            this._onResizeMove = null;
        }
        if (this._onResizeEnd) {
            document.removeEventListener('mouseup', this._onResizeEnd);
            this._onResizeEnd = null;
        }
        document.body.classList.remove('aichat-resizing');
    },
    methods: {
        onListScroll: function (e) {
            var el = e.target;
            if (!el) {
                return;
            }
            this.stick = el.scrollHeight - el.scrollTop - el.clientHeight < 36;
        },
        noteText: function (m) {
            if (m && m.code === 'noApiKey') {
                return 'AI 还没配置好。点下面的「打开 AI 配置向导」，跟着步骤拿一个 API Key，几分钟就能用。';
            }
            return m ? m.text : '';
        },
        scrollToBottom: function (force) {
            if (force) {
                this.stick = true;
            }
            if (!this.stick) {
                return;
            }
            var self = this;
            this.$nextTick(function () {
                var el = self.$refs.list;
                if (el) {
                    el.scrollTop = el.scrollHeight;
                }
            });
        },
        jumpToBottom: function () {
            this.stick = true;
            this.scrollToBottom(true);
        },
        onInput: function () {
            var v = this.tab.chatInput || '';
            this.slashOpen = /^\/[^\s]*$/.test(v);
            if (this.slashOpen) {
                this.slashIndex = 0;
            }
        },
        keydown: function (e) {
            // 中文输入法组合期间的 Enter / 方向键交给输入法，不触发发送或历史
            if (e.isComposing || e.keyCode === 229) {
                return;
            }
            if (this.slashOpen && this.slashItems.length) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.slashIndex = (this.slashIndex + 1) % this.slashItems.length;
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.slashIndex = (this.slashIndex - 1 + this.slashItems.length) % this.slashItems.length;
                    return;
                }
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                    e.preventDefault();
                    this.chooseSlash(this.slashItems[this.slashIndex]);
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.slashOpen = false;
                    return;
                }
            }
            var plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
                e.preventDefault();
                this.$root.aiChatSteer(null, this.activeConv);
                return;
            }
            if (plain && e.key === 'ArrowUp' && e.target && e.target.selectionStart === 0
                    && this.$root.aiHistoryPrev(this.tab)) {
                e.preventDefault();
                this.resizeInput();
                return;
            }
            if (plain && e.key === 'ArrowDown' && this.$root.aiHistoryNext(this.tab)) {
                e.preventDefault();
                this.resizeInput();
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.$root.aiChatSend(this.tab);
            }
        },
        chooseSlash: function (item) {
            if (!item) {
                return;
            }
            this.slashOpen = false;
            this.tab.chatInput = '';
            this.$root.aiRunSlash(item.id, this.tab);
        },
        /* 桌面窗口可能被 transform 缩放，按元素实际缩放比换算成 .aichat 内的局部坐标 */
        panelPoint: function (clientX, clientY) {
            var el = this.$el;
            var rect = el.getBoundingClientRect();
            var scale = el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
            if (!scale || scale <= 0) {
                scale = 1;
            }
            return {
                x: (clientX - rect.left) / scale,
                y: (clientY - rect.top) / scale,
                width: el.clientWidth,
                height: el.clientHeight,
                scale: scale
            };
        },
        openConvMenu: function (e, c) {
            if (!c) {
                return;
            }
            var p = this.panelPoint(e.clientX, e.clientY);
            var menuWidth = 170;
            var menuHeight = 234;
            var self = this;
            this.renamingId = null;
            this.convMenu = {
                visible: true,
                x: Math.max(4, Math.min(p.x, p.width - menuWidth - 4)),
                y: Math.max(4, Math.min(p.y, p.height - menuHeight - 4)),
                conv: c
            };
            this.$nextTick(function () {
                var el = self.$refs.convMenu;
                if (!el) {
                    return;
                }
                var maxX = Math.max(4, p.width - el.offsetWidth - 4);
                var maxY = Math.max(4, p.height - el.offsetHeight - 4);
                self.convMenu.x = Math.max(4, Math.min(p.x, maxX));
                self.convMenu.y = Math.max(4, Math.min(p.y, maxY));
            });
        },
        startResize: function (e) {
            var self = this;
            var p = this.panelPoint(e.clientX, e.clientY);
            var startWidth = this.convWidth;
            this._onResizeMove = function (ev) {
                var w = Math.round(startWidth + (ev.clientX - e.clientX) / p.scale);
                self.convWidth = Math.max(90, Math.min(self.maxConvWidth(), w));
            };
            this._onResizeEnd = function () {
                document.removeEventListener('mousemove', self._onResizeMove);
                document.removeEventListener('mouseup', self._onResizeEnd);
                self._onResizeMove = null;
                self._onResizeEnd = null;
                document.body.classList.remove('aichat-resizing');
                try {
                    var key = 'deepshell.aiConvWidth.' + (self.context === 'window' ? 'window' : 'panel');
                    localStorage.setItem(key, String(self.convWidth));
                } catch (err) {
                    // 本地存储不可用时只保留本次会话宽度
                }
            };
            document.addEventListener('mousemove', this._onResizeMove);
            document.addEventListener('mouseup', this._onResizeEnd);
            document.body.classList.add('aichat-resizing');
        },
        maxConvWidth: function () {
            var w = this.$el ? this.$el.clientWidth : 0;
            return Math.max(90, Math.min(360, w - 180));
        },
        closeConvMenu: function () {
            if (this.convMenu.visible) {
                this.convMenu.visible = false;
                this.convMenu.conv = null;
            }
        },
        menuRename: function () {
            var c = this.convMenu.conv;
            this.closeConvMenu();
            this.startRename(c);
        },
        menuSummarizeTitle: function () {
            var c = this.convMenu.conv;
            this.closeConvMenu();
            this.$root.aiConvSummarizeTitle(c, true);
        },
        menuExport: function () {
            var c = this.convMenu.conv;
            this.closeConvMenu();
            this.exportConv(c);
        },
        menuPin: function () {
            var c = this.convMenu.conv;
            this.closeConvMenu();
            this.togglePin(c);
        },
        menuUnread: function () {
            var c = this.convMenu.conv;
            this.closeConvMenu();
            if (!c) {
                return;
            }
            if (c.unread) {
                this.$root.aiConvRead(c);
            } else {
                this.$root.aiConvMarkUnread(c);
            }
        },
        menuDelete: function () {
            var c = this.convMenu.conv;
            this.closeConvMenu();
            this.delConv(c);
        },
        startRename: function (c) {
            if (!c || c.id == null) {
                return;
            }
            var self = this;
            this.renamingId = c.id;
            this.renameText = c.title || '';
            this.$nextTick(function () {
                var ref = self.$refs.renameInput;
                var el = Array.isArray(ref) ? ref[0] : ref;
                if (el) {
                    el.focus();
                    if (el.select) {
                        el.select();
                    }
                }
            });
        },
        cancelRename: function () {
            this.renamingId = null;
            this.renameText = '';
        },
        saveRename: function (c) {
            if (!c || this.renamingId !== c.id) {
                return;
            }
            var title = (this.renameText || '').trim();
            if (!title || title === c.title) {
                this.cancelRename();
                return;
            }
            if (title.length > 60) {
                var self = this;
                ELEMENT.Message.warning('对话名称不能超过 60 个字符');
                this.$nextTick(function () {
                    var ref = self.$refs.renameInput;
                    var el = Array.isArray(ref) ? ref[0] : ref;
                    if (el) {
                        el.focus();
                    }
                });
                return;
            }
            this.renamingId = null;
            this.renameText = '';
            var self = this;
            http.put('/api/ai/convs/' + c.id, { title: title }).then(function (d) {
                self.$set(c, 'title', d && d.title ? d.title : title);
                ELEMENT.Message.success('已重命名');
            }).catch(function () { /* 拦截器已提示 */ });
        },
        exportConv: function (c) {
            if (!c) {
                return;
            }
            var tab = this.tab || {};
            var lines = [];
            lines.push('# ' + (c.title || 'AI 对话'));
            lines.push('');
            lines.push('- 主机：' + (tab.host || '') + (tab.username ? ' (' + tab.username + ')' : ''));
            lines.push('- 导出时间：' + new Date().toLocaleString());
            lines.push('');
            (c.msgs || []).forEach(function (m) {
                if (!m) {
                    return;
                }
                if (m.role === 'user') {
                    lines.push('## 用户');
                    lines.push('');
                    lines.push(String(m.text || ''));
                    lines.push('');
                    return;
                }
                if (m.role === 'compact') {
                    lines.push('## 上下文压缩');
                    lines.push('');
                    lines.push(String(m.text || ''));
                    lines.push('');
                    return;
                }
                var reasoning = stripDsmlText(m.reasoning || '');
                if (reasoning) {
                    lines.push('<details>');
                    lines.push('<summary>思考过程</summary>');
                    lines.push('');
                    lines.push(reasoning);
                    lines.push('');
                    lines.push('</details>');
                    lines.push('');
                }
                var reply = extractAiReply(m.text || '');
                if (reply == null && m.text) {
                    reply = String(m.text);
                }
                if (reply && reply.trim()) {
                    lines.push('## AI');
                    lines.push('');
                    lines.push(reply.trim());
                    lines.push('');
                }
                if (m.cmd) {
                    lines.push('### 命令' + (m.note ? '：' + m.note : ''));
                    lines.push('');
                    lines.push('~~~sh');
                    lines.push(String(m.cmd));
                    lines.push('~~~');
                    lines.push('');
                    if (m.output) {
                        lines.push('~~~text');
                        lines.push(String(m.output));
                        lines.push('~~~');
                        lines.push('');
                    }
                    if (m.error) {
                        lines.push('> 错误：' + m.error);
                        lines.push('');
                    }
                }
            });
            var stamp = new Date();
            var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            var time = stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate())
                + '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + pad(stamp.getSeconds());
            var name = (c.title || 'ai-conversation')
                .replace(/[\\/:*?"<>|\r\n]/g, '_')
                .replace(/[. ]+$/, '')
                .slice(0, 60) || 'ai-conversation';
            var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'deepshell-ai-' + name + '-' + time + '.md';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            ELEMENT.Message.success('对话记录已导出');
        },
        newConv: function () {
            this.$root.aiConvNew();
        },
        switchConv: function (c) {
            this.closeConvMenu();
            this.$root.aiConvSwitch(c);
        },
        delConv: function (c) {
            this.$root.aiConvDelete(c);
        },
        togglePin: function (c) {
            this.$root.aiConvPin(c || this.activeConv);
        },
        fork: function (msgIndex) {
            this.$root.aiConvFork(this.activeConv, msgIndex);
        },
        compact: function () {
            this.$root.aiCompactContext(this.tab, this.activeConv);
        },
        fmtTokens: function (n) {
            return formatTokenCount(n);
        },
        usageTitle: function (u) {
            return this.$root.aiUsageTitle(u);
        },
        send: function () {
            this.$root.aiChatSend(this.tab);
        },
        stop: function () {
            this.$root.aiChatStop(this.tab);
        },
        confirm: function (m, allow) {
            this.$root.aiChatConfirm(m, allow);
        },
        modeChange: function (v) {
            this.$root.onChatModeChange(v);
        },
        copy: function (text) {
            this.$root.copyText(text || '');
        },
        fmtTime: function (ms) {
            return this.$root.fmtChatTime(ms);
        },
        renderMd: function (text) {
            return renderAiMarkdown(text);
        },
        fmtDuration: function (ms) {
            if (ms == null) {
                return '';
            }
            if (ms < 1000) {
                return ms + ' ms';
            }
            if (ms < 60000) {
                return (ms / 1000).toFixed(1) + ' s';
            }
            var totalSec = Math.round(ms / 1000);
            return Math.floor(totalSec / 60) + 'm ' + (totalSec % 60) + 's';
        },
        toggleReason: function (m) {
            this.$set(m, 'reasonOpen', !m.reasonOpen);
        },
        toggleOut: function (m) {
            this.$set(m, 'outOpen', !m.outOpen);
        },
        copyOutput: function (m) {
            this.$root.copyText(m.output || '');
        },
        steer: function () {
            this.$root.aiChatSteer(null, this.activeConv);
        },
        removeQueue: function (q) {
            this.$root.aiQueueRemove(this.activeConv, q);
        },
        restoreQueue: function (q) {
            this.$root.aiQueueRestore(this.activeConv, q);
            this.resizeInput();
        },
        sendQueued: function (q) {
            this.$root.aiQueueSend(this.activeConv, q);
        },
        steerQueued: function (q) {
            this.$root.aiQueueSteer(this.activeConv, q);
        },
        clearQueue: function () {
            this.$root.aiQueueClear(this.activeConv);
        },
        useExample: function (text) {
            this.tab.chatInput = text;
            this.resizeInput();
        },
        /* 程序化改写输入框内容后同步高度并聚焦（历史 / 排队恢复） */
        resizeInput: function () {
            var self = this;
            this.$nextTick(function () {
                var el = self.$refs.chatInput;
                if (el && el.resizeTextarea) {
                    el.resizeTextarea();
                }
                if (el && el.focus) {
                    el.focus();
                }
            });
        },
        continueRun: function (m) {
            this.$root.aiChatContinue(m);
        },
        retryRun: function (m) {
            this.$root.aiChatRetry(m);
        },
        openDesktop: function () {
            this.$root.openDesktopInNewTab(this.tab);
        }
    }
});

/* 传输中心列表：终端页气泡与桌面传输窗口共用同一份模板 */
Vue.component('xfer-list', {
    props: {
        items: { type: Array, default: function () { return []; } }
    },
    template: '#xfer-list-tpl',
    methods: {
        fmtSize: function (n) {
            return this.$root.fmtSize(n);
        },
        fmtSpeed: function (bps) {
            return this.$root.fmtRate(bps);
        },
        kindClass: function (t) {
            return t.kind === 'upload' ? 'up' : 'down';
        },
        kindLabel: function (t) {
            return t.kind === 'upload' ? '上传' : '下载';
        },
        nameTitle: function (t) {
            if (t.kind === 'localDownload') {
                return (t.targetPath || '') + (t.currentFile ? ' · ' + t.currentFile : '');
            }
            return t.rel || t.name;
        },
        pct: function (t) {
            if (t.kind === 'localDownload') {
                if (t.status === 'done' || t.status === 'partial') {
                    return 100;
                }
                if (t.totalBytes > 0) {
                    return Math.max(0, Math.min(99,
                        Math.round((t.doneBytes || 0) * 100 / t.totalBytes)));
                }
                if (t.totalFiles > 0) {
                    return Math.max(0, Math.min(99,
                        Math.round((t.doneFiles || 0) * 100 / t.totalFiles)));
                }
                return 0;
            }
            if (!t.size) {
                // 流式打包 ZIP 无法预知总大小，显示不确定进度
                return (t.kind === 'download' && t.status === 'downloading') ? -1 : (t.status === 'done' ? 100 : 0);
            }
            return Math.max(0, Math.min(100, Math.round((t.offset || 0) * 100 / t.size)));
        },
        pctText: function (t) {
            var p = this.pct(t);
            return p < 0 ? this.fmtSize(t.offset || 0) : p + '%';
        },
        statusText: function (t) {
            if (t.kind === 'localDownload') {
                if (t.status === 'queued') return '排队中';
                if (t.status === 'scanning') return '正在统计文件…';
                if (t.status === 'downloading') {
                    return (t.doneFiles || 0) + '/' + (t.totalFiles || 0) + ' 个文件';
                }
                if (t.status === 'partial') {
                    return '完成 ' + (t.doneFiles || 0) + ' 个，失败 ' + (t.errorCount || 0) + ' 个';
                }
                if (t.status === 'done') {
                    return t.totalFiles > 0 ? '已完成 ' + (t.doneFiles || 0) + ' 个文件' : '已完成';
                }
                if (t.status === 'cancelled') return '已取消';
                return t.error || '失败';
            }
            if (t.kind === 'download') {
                if (t.status === 'downloading') {
                    if (t.size > 0) {
                        return this.fmtSize(t.offset || 0) + ' / ' + this.fmtSize(t.size);
                    }
                    return t.offset ? '已下载 ' + this.fmtSize(t.offset) : '下载中…';
                }
                if (t.status === 'done') return '已完成';
                if (t.status === 'cancelled') return '已取消';
                return t.error || '失败';
            }
            if (t.status === 'pending') return '等待中';
            if (t.status === 'uploading') {
                return this.fmtSize(t.offset || 0) + ' / ' + this.fmtSize(t.size);
            }
            if (t.status === 'processing') return '正在写入服务器…';
            if (t.status === 'done') return '已完成';
            if (t.status === 'cancelled') return '已取消';
            return t.error || '失败';
        },
        canCancel: function (t) {
            if (t.kind === 'upload') {
                return t.status === 'pending' || t.status === 'uploading' || t.status === 'processing';
            }
            if (t.kind === 'download') {
                return t.status === 'downloading';
            }
            if (t.kind === 'localDownload') {
                return t.status === 'queued' || t.status === 'scanning' || t.status === 'downloading';
            }
            return false;
        },
        canRetry: function (t) {
            return t.kind === 'upload' && (t.status === 'error' || t.status === 'cancelled');
        },
        canRemove: function (t) {
            return ['pending', 'uploading', 'processing', 'queued', 'scanning', 'downloading']
                .indexOf(t.status) < 0;
        }
    }
});

/* 磁盘占用分析：工作台右侧面板与桌面磁盘窗口共用同一份模板 */
Vue.component('disk-analyzer', {
    props: {
        tab: { type: Object, required: true },
        sessionId: { type: String, default: '' },
        homeDir: { type: String, default: '' },
        context: { type: String, default: 'panel' }
    },
    template: '#disk-analyzer-tpl',
    data: function () {
        return {
            elapsed: 0
        };
    },
    watch: {
        'tab.diskLoading': function (loading) {
            if (loading) {
                this.startTimer();
            } else {
                this.stopTimer();
            }
        }
    },
    mounted: function () {
        if (this.tab.diskLoading) {
            this.startTimer();
        }
    },
    beforeDestroy: function () {
        this.stopTimer();
    },
    methods: {
        analyze: function (path) {
            path = String(path == null ? '' : path).trim();
            if (!this.sessionId) {
                ELEMENT.Message.warning('连接未就绪，请稍后再试');
                return;
            }
            if (!path) {
                ELEMENT.Message.warning('请输入要分析的目录');
                return;
            }
            if (this.tab.diskLoading) {
                return;
            }
            this.$root.startDiskAnalyze(this.tab, this.sessionId, path);
        },
        up: function () {
            var p = String(this.tab.diskPath || '').replace(/\/+$/, '');
            if (!p) {
                return;
            }
            var idx = p.lastIndexOf('/');
            this.analyze(idx <= 0 ? '/' : p.substring(0, idx));
        },
        startTimer: function () {
            var self = this;
            this.stopTimer();
            this.elapsed = 0;
            this._diskTimer = setInterval(function () {
                self.elapsed++;
            }, 1000);
        },
        stopTimer: function () {
            if (this._diskTimer) {
                clearInterval(this._diskTimer);
                this._diskTimer = null;
            }
        },
        sortName: function (a, b) {
            return this.$root.sortDiskName(a, b);
        },
        sortSize: function (a, b) {
            return this.$root.sortDiskSize(a, b);
        },
        fmtDisk: function (kb) {
            return this.$root.fmtDisk(kb);
        }
    }
});

/* 终端命令底栏：工作台与桌面终端窗口共用 */
Vue.component('term-cmd-bar', {
    props: {
        tab: { type: Object, required: true },
        context: { type: String, default: 'workbench' },
        localTerminal: { type: Boolean, default: false }
    },
    template: '#term-cmd-bar-tpl',
    data: function () {
        return {
            histVisible: false,
            optsVisible: false,
            sendToVisible: false,
            snippetsVisible: false,
            searchVisible: false,
            searchText: '',
            searchCaseSensitive: false,
            searchWholeWord: false,
            searchRegex: false,
            searchInvalid: false,
            _histIdx: undefined,
            _histDraft: undefined,
            _altCombo: false
        };
    },
    computed: {
        targets: function () {
            return this.$root.tabs || [];
        },
        snippets: function () {
            return this.$root.snippets || [];
        },
        searchCountText: function () {
            if (this.searchInvalid) {
                return '正则无效';
            }
            if (!this.searchText) {
                return '';
            }
            var count = this.tab && this.tab.searchResultCount || 0;
            if (!count) {
                return '无匹配';
            }
            var index = this.tab && this.tab.searchResultIndex;
            return (index >= 0 ? index + 1 : 0) + ' / ' + count;
        }
    },
    watch: {
        tab: function (nv, ov) {
            if (ov && ov._cmdBar === this) {
                ov._cmdBar = null;
            }
            if (nv) {
                nv._cmdBar = this;
            }
            this.histVisible = false;
            this.optsVisible = false;
            this.sendToVisible = false;
            this.snippetsVisible = false;
            this.searchVisible = false;
            this.searchText = '';
            this.searchInvalid = false;
            if (ov) {
                ov.searchResultIndex = -1;
                ov.searchResultCount = 0;
                if (ov.searchAddon && ov.searchAddon.clearDecorations) {
                    try { ov.searchAddon.clearDecorations(); } catch (e) { /* ignore */ }
                }
            }
            this._histIdx = undefined;
            this._histDraft = undefined;
        },
        searchVisible: function (v) {
            var self = this;
            if (v) {
                this.$nextTick(function () {
                    if (self.$refs.searchInput) {
                        self.$refs.searchInput.focus();
                    }
                });
                return;
            }
            clearTimeout(this._searchTimer);
            this.searchText = '';
            this.searchInvalid = false;
            this.clearSearchHighlights();
        }
    },
    mounted: function () {
        this.tab._cmdBar = this;
    },
    beforeDestroy: function () {
        clearTimeout(this._searchTimer);
        if (this.tab && this.tab._cmdBar === this) {
            this.tab._cmdBar = null;
        }
    },
    methods: {
        focus: function () {
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.cmdInput) {
                    self.$refs.cmdInput.focus();
                }
            });
        },
        focusAi: function () {
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.aiInput) {
                    self.$refs.aiInput.focus();
                }
            });
        },
        send: function () {
            this.$root.sendCmd(this.tab);
        },
        toggleAi: function () {
            this.$root.toggleAiBar(this.tab);
        },
        generateAi: function () {
            this.$root.aiGenerate(this.tab);
        },
        onAiKeydown: function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.generateAi();
            } else if (e.key === 'Escape') {
                e.stopPropagation();
                if (this.tab.aiVisible) {
                    this.toggleAi();
                }
            }
        },
        toggleTarget: function (key, checked) {
            this.$root.toggleTarget(key, checked, this.tab);
        },
        runSnippet: function (c) {
            var t = this.tab;
            if (!t || !t.ws || t.ws.readyState !== 1 || t.status !== 'open') {
                ELEMENT.Message.warning('当前终端未连接');
                return;
            }
            var self = this;
            this.snippetsVisible = false;
            var run = function () {
                if (!t.ws || t.ws.readyState !== 1) {
                    return;
                }
                t.ws.send(JSON.stringify({ type: 'data', data: c.command + '\r' }));
                if (self.$root.pushHistory) {
                    self.$root.pushHistory(t, c.command);
                }
            };
            this.$root.confirmDangerousCommand(c.command, run);
        },
        fillSnippet: function (c) {
            this.tab.cmdText = c.command;
            this.snippetsVisible = false;
            this.focus();
        },
        clearHistory: function () {
            this.$root.clearHistory(this.tab);
        },
        copySelection: function () {
            this.$root.copySelection(this.tab);
        },
        pasteToInput: function () {
            this.$root.pasteToInput(this.tab, this.$refs.cmdInput);
        },
        searchOptions: function () {
            return {
                caseSensitive: this.searchCaseSensitive,
                wholeWord: this.searchWholeWord,
                regex: this.searchRegex
            };
        },
        focusSearchInput: function () {
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.searchInput) {
                    self.$refs.searchInput.focus();
                }
            });
        },
        openSearchWith: function (text) {
            var self = this;
            this.searchVisible = true;
            this.searchText = text || '';
            this.searchInvalid = false;
            this.$nextTick(function () {
                self.focusSearchInput();
                self.runTerminalSearch('next', false);
            });
        },
        clearSearchHighlights: function () {
            if (this.tab && this.tab.searchAddon && this.tab.searchAddon.clearDecorations) {
                try { this.tab.searchAddon.clearDecorations(); } catch (e) { /* ignore */ }
            }
            if (this.tab) {
                this.tab.searchResultIndex = -1;
                this.tab.searchResultCount = 0;
            }
        },
        validateSearch: function () {
            if (!this.searchRegex || !this.searchText) {
                this.searchInvalid = false;
                return true;
            }
            try {
                new RegExp(this.searchText);
                this.searchInvalid = false;
                return true;
            } catch (e) {
                this.searchInvalid = true;
                this.clearSearchHighlights();
                return false;
            }
        },
        runTerminalSearch: function (direction, incremental) {
            if (!this.searchText) {
                this.clearSearchHighlights();
                return;
            }
            if (!this.validateSearch()) {
                return;
            }
            if (direction === 'prev') {
                this.$root.findPrev(this.tab, this.searchText, incremental, this.searchOptions());
            } else {
                this.$root.findNext(this.tab, this.searchText, incremental, this.searchOptions());
            }
        },
        toggleSearchOption: function (name) {
            this[name] = !this[name];
            this.clearSearchHighlights();
            this.runTerminalSearch('next', false);
            this.focusSearchInput();
        },
        findNext: function () {
            this.runTerminalSearch('next', false);
            this.focusSearchInput();
        },
        findPrev: function () {
            this.runTerminalSearch('prev', false);
            this.focusSearchInput();
        },
        onSearchInput: function () {
            var self = this;
            clearTimeout(this._searchTimer);
            this._searchTimer = setTimeout(function () {
                self.runTerminalSearch('next', true);
            }, 180);
        },
        onSearchKey: function (e) {
            clearTimeout(this._searchTimer);
            if (e.altKey) {
                var k = (e.key || '').toLowerCase();
                if (k === 'c') {
                    e.preventDefault();
                    this.toggleSearchOption('searchCaseSensitive');
                    return;
                }
                if (k === 'w') {
                    e.preventDefault();
                    this.toggleSearchOption('searchWholeWord');
                    return;
                }
                if (k === 'r') {
                    e.preventDefault();
                    this.toggleSearchOption('searchRegex');
                    return;
                }
            }
            if (e.key === 'Enter') {
                if (e.shiftKey) {
                    this.findPrev();
                } else {
                    this.findNext();
                }
            }
        },
        resetComp: function () {
            this.tab._comp = null;
            this._histIdx = undefined;
            this._histDraft = undefined;
        },
        histMove: function (dir) {
            var t = this.tab;
            var h = t.cmdHistory || [];
            if (!h.length) {
                return;
            }
            if (this._histIdx === undefined) {
                this._histIdx = -1;
                this._histDraft = t.cmdText;
            }
            if (dir === -1) {
                if (this._histIdx < h.length - 1) {
                    this._histIdx++;
                }
            } else {
                if (this._histIdx > 0) {
                    this._histIdx--;
                } else if (this._histIdx === 0) {
                    this._histIdx = -1;
                    t.cmdText = this._histDraft || '';
                    return;
                }
            }
            if (this._histIdx >= 0) {
                t.cmdText = h[h.length - 1 - this._histIdx];
            }
        },
        onCmdKeydown: function (e) {
            var t = this.tab;
            if (!t) {
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                if (this.$root.hotkeySettings.escClose) {
                    t.cmdVisible = false;
                    var self = this;
                    this.$nextTick(function () {
                        self.$root.fitTab(t);
                        if (t.term) {
                            t.term.focus();
                        }
                    });
                }
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                this.$root.sendCmd(t);
                return;
            }
            if (e.key === 'Tab') {
                if (this.$root.hotkeySettings.tabComplete) {
                    e.preventDefault();
                    this.$root.doComplete(t, this.$refs.cmdInput);
                }
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.histMove(-1);
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.histMove(1);
                return;
            }
            if (e.key === 'Alt') {
                e.preventDefault();
                this._altCombo = false;
            } else if (e.key !== 'Control' && e.key !== 'Shift' && e.key !== 'Meta') {
                this._altCombo = true;
            }
        },
        onCmdKeyup: function (e) {
            if (e.key === 'Alt' && !this._altCombo) {
                this.histVisible = true;
            }
        },
        pickHistory: function (h) {
            this.tab.cmdText = h;
            this.histVisible = false;
            this.focus();
        },
        runHistory: function (h) {
            this.tab.cmdText = h;
            this.histVisible = false;
            this.send();
        }
    }
});

Vue.component('editor-menu-bar', {
    template: '#editor-menu-bar-tpl',
    props: {
        state: { type: Object, default: function () { return {}; } }
    },
    methods: {
        emitCommand: function (cmd) {
            this.$emit('command', cmd);
        }
    }
});

/* AI 桌面文本编辑器应用：多标签、新建 / 打开 / 保存 / 另存为 */
Vue.component('desktop-text-editor', {
    props: {
        tab: { type: Object, default: null },
        win: { type: Object, default: null },
        pendingPath: { type: String, default: '' },
        pendingSeq: { type: Number, default: 0 }
    },
    template: '#desktop-text-editor-tpl',
    data: function () {
        return {
            docs: [],
            activeId: '',
            cursor: { line: 1, col: 1 },
            find: {
                open: false, text: '', replace: '', caseSensitive: false, wholeWord: false, regex: false,
                replaceOpen: false, total: 0, current: 0, countText: '', invalid: false
            },
            filter: {
                on: false, text: '', caseSensitive: false, regex: false,
                rows: [], total: 0, truncated: false, error: ''
            },
            wrap: false,
            lineNumbers: true,
            activeLine: true,
            fontSize: 13,
            opening: false,
            saving: false,
            picker: {
                visible: false, mode: 'open', dir: '/', entries: [], loading: false,
                error: '', selected: null, name: ''
            },
            closeAsk: { visible: false, docId: '', title: '' }
        };
    },
    computed: {
        activeDoc: function () {
            for (var i = 0; i < this.docs.length; i++) {
                if (this.docs[i].id === this.activeId) {
                    return this.docs[i];
                }
            }
            return this.docs.length ? this.docs[0] : null;
        },
        docsDirty: function () {
            return this.docs.some(function (d) {
                return d.dirty;
            });
        },
        closeAskDoc: function () {
            return this.findDoc(this.closeAsk.docId);
        },
        closeAskTitle: function () {
            var d = this.closeAskDoc;
            return d ? d.title : '';
        },
        pickerFullPath: function () {
            if (this.picker.mode === 'save') {
                var name = String(this.picker.name || '').trim();
                return name ? this.joinPath(this.picker.dir, name) : this.picker.dir;
            }
            var sel = this.picker.selected;
            return sel ? this.joinPath(this.picker.dir, sel.name) : this.picker.dir;
        },
        pickerCanConfirm: function () {
            if (this.picker.mode === 'open') {
                return !!(this.picker.selected && !this.picker.selected.dir);
            }
            return this.validName(this.picker.name)
                && this.normalizeDir(this.picker.dir).charAt(0) === '/';
        },
        menuState: function () {
            return {
                wrap: this.wrap,
                lineNumbers: this.lineNumbers,
                activeLine: this.activeLine,
                fontSize: this.fontSize
            };
        }
    },
    watch: {
        pendingSeq: function () {
            if (this.pendingPath) {
                this.openPath(this.pendingPath);
            }
        }
    },
    mounted: function () {
        this.initEditor();
        this.setupResize();
        var self = this;
        this.$nextTick(function () {
            if (self.pendingPath) {
                self.openPath(self.pendingPath);
            } else {
                self.createUntitled();
            }
        });
    },
    beforeDestroy: function () {
        this._destroyed = true;
        this._pickerSeq = (this._pickerSeq || 0) + 1;
        if (this._findTimer) {
            clearTimeout(this._findTimer);
            this._findTimer = null;
        }
        if (this._filterTimer) {
            clearTimeout(this._filterTimer);
            this._filterTimer = null;
        }
        if (this._resizeTimer) {
            clearTimeout(this._resizeTimer);
            this._resizeTimer = null;
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        this.clearMarks();
        this._cm = null;
        this._docMap = {};
    },
    methods: {
        /* ---------- 初始化与文档管理 ---------- */
        sessionId: function () {
            return this.tab && this.tab.sessionId;
        },
        isLocal: function () {
            return !!(this.tab && this.tab.local);
        },
        initEditor: function () {
            var self = this;
            var host = this.$refs.editorHost;
            if (!host || typeof CodeMirror === 'undefined') {
                ELEMENT.Message.error('编辑器组件加载失败，请刷新页面后重试');
                return;
            }
            host.innerHTML = '';
            var cm = CodeMirror(host, {
                value: '',
                mode: null,
                lineNumbers: this.lineNumbers,
                lineWrapping: this.wrap,
                styleActiveLine: this.activeLine,
                matchBrackets: true,
                autoCloseBrackets: true,
                indentUnit: 4,
                tabSize: 4,
                indentWithTabs: false,
                highlightSelectionMatches: { minChars: 2, style: 'keyword-hit' },
                extraKeys: {
                    'Ctrl-O': function () { self.openPicker('open'); },
                    'Cmd-O': function () { self.openPicker('open'); },
                    'Ctrl-S': function () { self.save(); },
                    'Cmd-S': function () { self.save(); },
                    'Shift-Ctrl-S': function () { self.saveAs(); },
                    'Shift-Cmd-S': function () { self.saveAs(); },
                    'Ctrl-Shift-S': function () { self.saveAs(); },
                    'Cmd-Shift-S': function () { self.saveAs(); },
                    'Ctrl-F': function () { self.openFind(false); },
                    'Cmd-F': function () { self.openFind(false); },
                    'Ctrl-H': function () { self.openFind(true); },
                    'Ctrl-G': function () { self.gotoLine(); },
                    'Cmd-G': function () { self.gotoLine(); },
                    'Alt-Z': function () { self.toggleWrap(); },
                    'F3': function () { self.findNext(); },
                    'Shift-F3': function () { self.findPrev(); },
                    'Alt-C': function () { self.toggleOption('caseSensitive'); },
                    'Alt-W': function () { self.toggleOption('wholeWord'); },
                    'Alt-R': function () { self.toggleOption('regex'); },
                    'Ctrl-/': 'toggleComment',
                    'Cmd-/': 'toggleComment'
                }
            });
            this._cm = cm;
            cm.getWrapperElement().style.fontSize = this.fontSize + 'px';
            this._docMap = {};
            this._docSeq = 0;
            this._untitledSeq = 0;
            this._switching = false;
            this._closeAfterSaveDocId = '';
            this._pendingOpen = '';
            cm.on('change', function () { self.onChange(cm); });
            cm.on('cursorActivity', function () { self.onCursorActivity(cm); });
        },
        setupResize: function () {
            var self = this;
            if (typeof ResizeObserver === 'undefined') {
                return;
            }
            this._resizeObserver = new ResizeObserver(function () {
                clearTimeout(self._resizeTimer);
                self._resizeTimer = setTimeout(function () {
                    if (self._cm) {
                        self._cm.refresh();
                    }
                }, 80);
            });
            this._resizeObserver.observe(this.$el);
        },
        createDoc: function (path, content, info, lineSep) {
            var id = 'doc' + (++this._docSeq);
            var title = path ? this.baseName(path) : ('未命名-' + (++this._untitledSeq));
            var cmDoc = CodeMirror.Doc(content || '', info.mode);
            this._docMap[id] = cmDoc;
            var doc = {
                id: id,
                path: path || null,
                title: title,
                original: content || '',
                lineSep: lineSep || '\n',
                dirty: false,
                modeInfo: info,
                modeLabel: info.label,
                lineCount: cmDoc.lineCount(),
                cursor: { line: 0, ch: 0 },
                scrollTop: 0
            };
            this.docs.push(doc);
            return doc;
        },
        createUntitled: function () {
            var active = this.activeDoc;
            if (active && !active.path && !active.dirty
                    && this._docMap[active.id] && this._docMap[active.id].getValue() === '') {
                this.activateDoc(active);
                return active;
            }
            var doc = this.createDoc(null, '', { mode: null, label: '纯文本' }, '\n');
            this.activateDoc(doc);
            return doc;
        },
        newDoc: function () {
            if (!this._cm) {
                return;
            }
            var active = this.activeDoc;
            if (active && !active.path && !active.dirty
                    && this._docMap[active.id] && this._docMap[active.id].getValue() === '') {
                this._cm.focus();
                return;
            }
            this.createUntitled();
        },
        activateDoc: function (doc) {
            if (!doc || !this._cm || !this._docMap[doc.id]) {
                return;
            }
            var self = this;
            var cm = this._cm;
            var prev = this.activeDoc;
            if (this.activeId === doc.id && cm.getDoc() === this._docMap[doc.id]) {
                this.setWinState();
                cm.focus();
                return;
            }
            if (prev && this._docMap[prev.id]) {
                prev.cursor = cm.getCursor();
                prev.scrollTop = cm.getScrollInfo().top;
            }
            this.clearMarks();
            this._switching = true;
            cm.swapDoc(this._docMap[doc.id]);
            this._switching = false;
            this.activeId = doc.id;
            cm.setOption('mode', doc.modeInfo ? doc.modeInfo.mode : null);
            cm.setCursor(doc.cursor || { line: 0, ch: 0 });
            cm.scrollTo(0, doc.scrollTop || 0);
            var activeCursor = cm.getCursor();
            this.cursor = { line: activeCursor.line + 1, col: activeCursor.ch + 1 };
            this.updateStatus();
            this.setWinState();
            if (this.find.open && this.find.text) {
                this.$nextTick(function () {
                    self.applySearch(true);
                });
            } else {
                this.find.total = 0;
                this.find.current = 0;
                this.find.countText = '';
            }
            if (this.filter.on) {
                this.applyFilter();
            }
            this.$nextTick(function () {
                cm.refresh();
                cm.focus();
            });
        },
        removeDoc: function (doc) {
            if (!doc) {
                return;
            }
            var idx = this.docs.indexOf(doc);
            if (idx < 0) {
                return;
            }
            var wasActive = this.activeId === doc.id;
            delete this._docMap[doc.id];
            this.docs.splice(idx, 1);
            if (!this.docs.length) {
                this.activeId = '';
                this.createUntitled();
                return;
            }
            if (wasActive) {
                this.activateDoc(this.docs[Math.min(idx, this.docs.length - 1)]);
            } else {
                this.setWinState();
            }
        },
        findDoc: function (id) {
            for (var i = 0; i < this.docs.length; i++) {
                if (this.docs[i].id === id) {
                    return this.docs[i];
                }
            }
            return null;
        },
        openPath: function (path) {
            path = String(path || '').trim();
            if (!path || path.charAt(0) !== '/') {
                ELEMENT.Message.warning('文件路径不合法');
                return;
            }
            for (var i = 0; i < this.docs.length; i++) {
                if (this.docs[i].path === path) {
                    this.activateDoc(this.docs[i]);
                    return;
                }
            }
            var sid = this.sessionId();
            if (!this.isLocal() && !sid) {
                ELEMENT.Message.warning('请先连接服务器后再打开文件');
                if (!this.docs.length) {
                    this.createUntitled();
                }
                return;
            }
            if (!this._openingPaths) {
                this._openingPaths = {};
            }
            if (this._openingPaths[path]) {
                return;
            }
            this._openingPaths[path] = true;
            var self = this;
            this.opening = true;
            var readReq = this.isLocal()
                ? http.get('/api/local/fs/read', { params: { path: path } })
                : http.get('/api/sftp/read', { params: { sessionId: sid, path: path } });
            readReq
                .then(function (content) {
                    if (self._destroyed) {
                        return;
                    }
                    if (self._openingPaths) {
                        delete self._openingPaths[path];
                    }
                    self.opening = false;
                    var text = content || '';
                    var info = self.modeForPath(path, text);
                    var lineSep = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
                    var blank = null;
                    var active = self.activeDoc;
                    if (active && !active.path && !active.dirty
                            && self._docMap[active.id] && self._docMap[active.id].getValue() === '') {
                        blank = active;
                    }
                    var doc = self.createDoc(path, text, info, lineSep);
                    self.activateDoc(doc);
                    if (blank) {
                        self.removeDoc(blank);
                    }
                    self.picker.visible = false;
                    self.picker.error = '';
                })
                .catch(function (err) {
                    if (self._destroyed) {
                        return;
                    }
                    if (self._openingPaths) {
                        delete self._openingPaths[path];
                    }
                    self.opening = false;
                    self.picker.error = (err && err.message) ? err.message : '打开文件失败';
                    if (!self.docs.length) {
                        self.createUntitled();
                    }
                });
        },
        onChange: function (cm) {
            if (this._switching) {
                return;
            }
            var doc = this.activeDoc;
            if (!doc) {
                return;
            }
            var content = cm.getValue(doc.lineSep || '\n');
            doc.dirty = content !== doc.original;
            doc.lineCount = cm.lineCount();
            this.updateStatus();
            if (this.find.open && this.find.text) {
                this.scheduleSearch(false);
            }
            if (this.filter.on) {
                this.scheduleFilter();
            }
        },
        onCursorActivity: function (cm) {
            var c = cm.getCursor();
            this.cursor = { line: c.line + 1, col: c.ch + 1 };
            var doc = this.activeDoc;
            if (doc) {
                doc.cursor = { line: c.line, ch: c.ch };
            }
        },
        /* ---------- 行过滤：只读视图，只显示匹配到的行 ---------- */
        scheduleFilter: function () {
            var self = this;
            clearTimeout(this._filterTimer);
            this._filterTimer = setTimeout(function () {
                self.applyFilter();
            }, 120);
        },
        onFilterToggle: function () {
            this.applyFilter();
            var self = this;
            this.$nextTick(function () {
                if (self.filter.on && self.$refs.filterInput) {
                    self.$refs.filterInput.focus();
                }
                if (!self.filter.on && self._cm) {
                    self._cm.refresh();
                    self._cm.focus();
                }
            });
        },
        toggleFilterOption: function (key) {
            this.filter[key] = !this.filter[key];
            this.applyFilter();
        },
        applyFilter: function () {
            var f = this.filter;
            if (!f.on) {
                f.rows = [];
                f.total = 0;
                f.truncated = false;
                f.error = '';
                return;
            }
            var doc = this.activeDoc;
            var cmDoc = doc && this._docMap[doc.id];
            if (!cmDoc) {
                f.rows = [];
                f.total = 0;
                return;
            }
            var text = cmDoc.getValue(doc.lineSep || '\n');
            var lines = text.split(/\r?\n/);
            var needle = f.text || '';
            var re = null;
            f.error = '';
            if (needle && f.regex) {
                try {
                    re = new RegExp(needle, 'g' + (f.caseSensitive ? '' : 'i'));
                } catch (e) {
                    f.error = '正则表达式不合法';
                    f.rows = [];
                    f.total = 0;
                    f.truncated = false;
                    return;
                }
            }
            var rows = [];
            var total = 0;
            var limit = 2000;
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                var ranges = [];
                if (needle) {
                    if (re) {
                        re.lastIndex = 0;
                        var m;
                        var guard = 0;
                        while ((m = re.exec(line)) !== null) {
                            if (m[0].length === 0) {
                                re.lastIndex++;
                                if (re.lastIndex > line.length) {
                                    break;
                                }
                                continue;
                            }
                            ranges.push([m.index, m.index + m[0].length]);
                            if (++guard > 200) {
                                break;
                            }
                        }
                        if (!ranges.length) {
                            continue;
                        }
                    } else {
                        var hay = f.caseSensitive ? line : line.toLowerCase();
                        var nee = f.caseSensitive ? needle : needle.toLowerCase();
                        var pos = hay.indexOf(nee);
                        if (pos < 0) {
                            continue;
                        }
                        while (pos >= 0) {
                            ranges.push([pos, pos + nee.length]);
                            pos = hay.indexOf(nee, pos + Math.max(1, nee.length));
                            if (ranges.length > 200) {
                                break;
                            }
                        }
                    }
                }
                total++;
                if (rows.length < limit) {
                    rows.push({ no: i + 1, segs: this.filterSegments(line, ranges) });
                }
            }
            f.rows = rows;
            f.total = total;
            f.truncated = total > rows.length;
        },
        filterSegments: function (line, ranges) {
            if (!ranges || !ranges.length) {
                return [{ text: line, hit: false }];
            }
            var segs = [];
            var pos = 0;
            for (var i = 0; i < ranges.length; i++) {
                var r = ranges[i];
                if (r[0] > pos) {
                    segs.push({ text: line.slice(pos, r[0]), hit: false });
                }
                if (r[1] > r[0]) {
                    segs.push({ text: line.slice(r[0], r[1]), hit: true });
                }
                pos = Math.max(pos, r[1]);
            }
            if (pos < line.length) {
                segs.push({ text: line.slice(pos), hit: false });
            }
            return segs;
        },
        updateStatus: function () {
            var doc = this.activeDoc;
            if (doc && this._cm) {
                doc.lineCount = this._cm.lineCount();
                var c = this._cm.getCursor();
                this.cursor = { line: c.line + 1, col: c.ch + 1 };
            }
            this.setWinState();
        },
        setWinState: function () {
            var doc = this.activeDoc;
            if (this.win) {
                this.win.editorDirty = this.docsDirty;
                this.win.editorTitle = doc ? doc.title : '文本编辑器';
                this.win.editorSubtitle = doc ? (doc.path || '未命名') : '未命名';
                this.win.editorPath = doc && doc.path ? doc.path : '';
            }
            this.$emit('title-change', doc ? doc.title : '');
        },
        /* ---------- 打开 / 保存 / 另存为 ---------- */
        openPicker: function (mode, keepCloseAfter) {
            if (!this.isLocal() && !this.sessionId()) {
                ELEMENT.Message.warning('请先连接服务器后再打开或保存文件');
                return;
            }
            if (!keepCloseAfter) {
                this._closeAfterSaveDocId = '';
            }
            var doc = this.activeDoc;
            var tabDir = this.tab && (this.tab.sftpPath || this.tab.sftpHome);
            var dir = doc && doc.path ? this.dirOf(doc.path) : this.normalizeDir(tabDir || '/');
            var name = doc && doc.path ? this.baseName(doc.path) : 'untitled.txt';
            this.picker = {
                visible: true,
                mode: mode,
                dir: dir,
                entries: [],
                loading: true,
                error: '',
                selected: null,
                name: mode === 'save' ? name : ''
            };
            this.loadPicker(dir);
        },
        loadPicker: function (dir) {
            var d = this.normalizeDir(dir);
            if (d.charAt(0) !== '/') {
                this.picker.error = '请输入绝对路径，例如 /opt/app';
                return;
            }
            var sid = this.sessionId();
            if (!this.isLocal() && !sid) {
                this.picker.error = '会话未就绪';
                return;
            }
            this.picker.dir = d;
            this.picker.loading = true;
            this.picker.error = '';
            this.picker.selected = null;
            this._pickerSeq = (this._pickerSeq || 0) + 1;
            var seq = this._pickerSeq;
            var self = this;
            var listReq = this.isLocal()
                ? http.get('/api/local/fs/list', { params: { path: d }, silent: true })
                : http.get('/api/sftp/list', { params: { sessionId: sid, path: d }, silent: true });
            listReq
                .then(function (list) {
                    if (self._destroyed || seq !== self._pickerSeq || !self.picker.visible) {
                        return;
                    }
                    self.picker.entries = Array.isArray(list) ? list : [];
                    self.picker.loading = false;
                })
                .catch(function (err) {
                    if (self._destroyed || seq !== self._pickerSeq || !self.picker.visible) {
                        return;
                    }
                    self.picker.loading = false;
                    self.picker.entries = [];
                    self.picker.error = (err && err.message) ? err.message : '目录读取失败';
                });
        },
        pickerSelect: function (entry) {
            this.picker.selected = entry;
            if (this.picker.mode === 'save' && !entry.dir) {
                this.picker.name = entry.name;
            }
        },
        pickerDbl: function (entry) {
            if (!entry) {
                return;
            }
            if (entry.dir) {
                this.loadPicker(this.joinPath(this.picker.dir, entry.name));
                return;
            }
            if (this.picker.mode === 'open') {
                this.pickerConfirm();
            } else {
                this.picker.name = entry.name;
            }
        },
        pickerUp: function () {
            this.loadPicker(this.dirOf(this.picker.dir));
        },
        pickerCancel: function () {
            this.picker.visible = false;
            this._closeAfterSaveDocId = '';
        },
        pickerBeforeClose: function (done) {
            this._closeAfterSaveDocId = '';
            done();
        },
        pickerConfirm: function () {
            var p = this.picker;
            if (p.mode === 'open') {
                if (!p.selected || p.selected.dir) {
                    return;
                }
                this.openPath(this.joinPath(p.dir, p.selected.name));
                return;
            }
            var name = String(p.name || '').trim();
            if (!this.validName(name)) {
                ELEMENT.Message.warning('文件名不能包含 / 或 \\，也不能是 . 或 ..');
                return;
            }
            var path = this.joinPath(p.dir, name);
            var exists = (p.entries || []).some(function (e) {
                return !e.dir && e.name === name;
            });
            var self = this;
            if (exists) {
                this.$confirm('目标文件已存在，是否覆盖？', '另存为', {
                    type: 'warning',
                    confirmButtonText: '覆盖',
                    cancelButtonText: '取消'
                }).then(function () {
                    self.saveAsTo(path);
                }).catch(function () { /* 取消 */ });
            } else {
                this.saveAsTo(path);
            }
        },
        saveAsTo: function (path) {
            var doc = this.activeDoc;
            if (!doc) {
                return;
            }
            var self = this;
            this.saveDocTo(doc, path).then(function () {
                self.picker.visible = false;
                if (self._closeAfterSaveDocId === doc.id) {
                    self._closeAfterSaveDocId = '';
                    self.removeDoc(doc);
                }
            }).catch(function (err) {
                self.picker.error = (err && err.message) ? err.message : '保存失败';
            });
        },
        saveDocTo: function (doc, path) {
            var self = this;
            var sid = this.sessionId();
            if (!this.isLocal() && !sid) {
                return Promise.reject(new Error('会话未就绪'));
            }
            var cmDoc = this._docMap[doc.id];
            if (!cmDoc) {
                return Promise.reject(new Error('文档不存在'));
            }
            var content = cmDoc.getValue(doc.lineSep || '\n');
            this.saving = true;
            var writeReq = this.isLocal()
                ? http.post('/api/local/fs/write', { path: path, content: content })
                : http.post('/api/sftp/write', {
                    sessionId: sid,
                    path: path,
                    content: content
                });
            return writeReq.then(function () {
                self.saving = false;
                doc.path = path;
                doc.title = self.baseName(path);
                doc.original = content;
                doc.dirty = false;
                var info = self.modeForPath(path, content);
                doc.modeInfo = info;
                doc.modeLabel = info.label;
                if (self.activeId === doc.id && self._cm) {
                    self._cm.setOption('mode', info.mode);
                }
                self.updateStatus();
                self.setWinState();
                ELEMENT.Message.success('已保存到 ' + path);
                self.$emit('saved', { path: path });
            }).catch(function (err) {
                self.saving = false;
                throw err;
            });
        },
        save: function () {
            var doc = this.activeDoc;
            if (!doc) {
                return;
            }
            if (!this.isLocal() && !this.sessionId()) {
                ELEMENT.Message.warning('请先连接服务器后再保存文件');
                return;
            }
            if (this.saving) {
                return;
            }
            if (!doc.path) {
                this.openPicker('save');
                return;
            }
            var self = this;
            this.saveDocTo(doc, doc.path).catch(function (err) {
                ELEMENT.Message.error((err && err.message) ? err.message : '保存失败');
            });
        },
        saveAs: function () {
            if (this.saving) {
                return;
            }
            if (!this.isLocal() && !this.sessionId()) {
                ELEMENT.Message.warning('请先连接服务器后再保存文件');
                return;
            }
            this.openPicker('save');
        },
        closeDoc: function (doc) {
            if (!doc) {
                return;
            }
            if (doc.dirty) {
                this.closeAsk = { visible: true, docId: doc.id, title: doc.title };
                return;
            }
            this.removeDoc(doc);
        },
        closeAskSave: function () {
            var doc = this.findDoc(this.closeAsk.docId);
            this.closeAsk.visible = false;
            if (!doc) {
                return;
            }
            var self = this;
            if (doc.path) {
                this.saveDocTo(doc, doc.path).then(function () {
                    self.removeDoc(doc);
                }).catch(function (err) {
                    ELEMENT.Message.error((err && err.message) ? err.message : '保存失败');
                });
            } else {
                this.activateDoc(doc);
                this._closeAfterSaveDocId = doc.id;
                this.openPicker('save', true);
            }
        },
        closeAskDiscard: function () {
            var doc = this.findDoc(this.closeAsk.docId);
            this.closeAsk.visible = false;
            this._closeAfterSaveDocId = '';
            if (doc) {
                this.removeDoc(doc);
            }
        },
        closeAskCancel: function () {
            this.closeAsk.visible = false;
            this._closeAfterSaveDocId = '';
        },
        /* ---------- 路径与格式化 ---------- */
        baseName: function (p) {
            var s = String(p || '');
            var idx = s.lastIndexOf('/');
            return idx >= 0 ? (s.substring(idx + 1) || '/') : s;
        },
        dirOf: function (p) {
            var s = this.normalizeDir(p);
            if (s === '/') {
                return '/';
            }
            var idx = s.lastIndexOf('/');
            return idx <= 0 ? '/' : s.substring(0, idx);
        },
        joinPath: function (dir, name) {
            var d = this.normalizeDir(dir);
            return d === '/' ? '/' + name : d + '/' + name;
        },
        normalizeDir: function (p) {
            var s = String(p || '').trim();
            if (!s) {
                return '/';
            }
            if (s.charAt(0) !== '/') {
                s = '/' + s;
            }
            while (s.length > 1 && s.charAt(s.length - 1) === '/') {
                s = s.substring(0, s.length - 1);
            }
            return s;
        },
        validName: function (name) {
            var s = String(name || '').trim();
            return !!s && s !== '.' && s !== '..' && s.length <= 255
                && s.indexOf('/') < 0 && s.indexOf('\\') < 0
                && s.indexOf('\n') < 0 && s.indexOf('\r') < 0;
        },
        fmtSize: function (n) {
            return this.$root.fmtSize(n);
        },
        modeForPath: function (path, content) {
            var p = String(path || '');
            var base = p.substring(p.lastIndexOf('/') + 1).toLowerCase();
            var dot = base.lastIndexOf('.');
            var ext = dot > 0 ? base.substring(dot + 1) : '';
            if (base === 'dockerfile' || base.indexOf('dockerfile.') === 0) {
                return { mode: 'dockerfile', label: 'Dockerfile' };
            }
            if (base === '.bashrc' || base === '.zshrc' || base === '.bash_profile'
                || base === '.profile' || base === '.bash_logout' || base === '.kshrc') {
                return { mode: 'shell', label: 'Shell' };
            }
            if (base === '.env') {
                return { mode: 'properties', label: 'ENV' };
            }
            if (base === 'nginx.conf' || /^nginx.*\.conf$/.test(base)
                || (/\.conf$/.test(base) && p.indexOf('/nginx/') >= 0)) {
                return { mode: 'nginx', label: 'Nginx' };
            }
            var map = {
                sh: ['shell', 'Shell'], bash: ['shell', 'Shell'], zsh: ['shell', 'Shell'],
                ksh: ['shell', 'Shell'], profile: ['shell', 'Shell'],
                py: ['python', 'Python'], pyw: ['python', 'Python'],
                js: ['javascript', 'JavaScript'], mjs: ['javascript', 'JavaScript'],
                cjs: ['javascript', 'JavaScript'], jsx: ['javascript', 'JavaScript'],
                ts: ['text/typescript', 'TypeScript'], tsx: ['text/typescript', 'TypeScript'],
                json: ['application/json', 'JSON'],
                html: ['htmlmixed', 'HTML'], htm: ['htmlmixed', 'HTML'],
                xhtml: ['htmlmixed', 'HTML'], vue: ['htmlmixed', 'HTML'],
                xml: ['xml', 'XML'], svg: ['xml', 'XML'], plist: ['xml', 'XML'],
                css: ['css', 'CSS'], scss: ['text/x-scss', 'SCSS'], less: ['text/x-less', 'LESS'],
                sql: ['sql', 'SQL'],
                yml: ['yaml', 'YAML'], yaml: ['yaml', 'YAML'],
                properties: ['properties', 'Properties'], ini: ['text/x-ini', 'INI'],
                cfg: ['properties', '配置'], env: ['properties', 'ENV'],
                toml: ['properties', 'TOML'], service: ['properties', 'Unit'],
                md: ['markdown', 'Markdown'], markdown: ['markdown', 'Markdown'],
                java: ['text/x-java', 'Java'],
                c: ['text/x-csrc', 'C'], h: ['text/x-csrc', 'C'],
                cpp: ['text/x-c++src', 'C++'], cc: ['text/x-c++src', 'C++'],
                hpp: ['text/x-c++src', 'C++'], cs: ['text/x-csharp', 'C#']
            };
            var hit = map[ext];
            if (hit) {
                return { mode: hit[0], label: hit[1] };
            }
            if (!ext) {
                var first = String(content || '').split('\n')[0];
                if (/^#!.*\bpython/.test(first)) {
                    return { mode: 'python', label: 'Python' };
                }
                if (/^#!.*\b(?:ba|z|k)?sh\b/.test(first)) {
                    return { mode: 'shell', label: 'Shell' };
                }
            }
            return { mode: null, label: '纯文本' };
        },
        /* ---------- 菜单命令与编辑操作 ---------- */
        hasDirtyDocs: function () {
            return this.docsDirty;
        },
        onMenuCommand: function (cmd) {
            var cm = this._cm;
            if (cmd === 'file.new') {
                this.newDoc();
            } else if (cmd === 'file.open') {
                this.openPicker('open');
            } else if (cmd === 'file.save') {
                this.save();
            } else if (cmd === 'file.saveAs') {
                this.saveAs();
            } else if (cmd === 'file.close') {
                if (this.activeDoc) {
                    this.closeDoc(this.activeDoc);
                }
            } else if (cmd === 'edit.undo') {
                if (cm) { cm.undo(); cm.focus(); }
            } else if (cmd === 'edit.redo') {
                if (cm) { cm.redo(); cm.focus(); }
            } else if (cmd === 'edit.cut') {
                this.cutSelection();
            } else if (cmd === 'edit.copy') {
                this.copySelection();
            } else if (cmd === 'edit.paste') {
                this.pasteClipboard();
            } else if (cmd === 'edit.delete') {
                this.deleteSelection();
            } else if (cmd === 'edit.find') {
                this.openFind(false);
            } else if (cmd === 'edit.replace') {
                this.openFind(true);
            } else if (cmd === 'edit.gotoLine') {
                this.gotoLine();
            } else if (cmd === 'select.all') {
                if (cm) { cm.execCommand('selectAll'); cm.focus(); }
            } else if (cmd === 'select.line') {
                this.selectCurrentLine();
            } else if (cmd === 'select.none') {
                this.clearSelection();
            } else if (cmd === 'view.wrap') {
                this.toggleWrap();
            } else if (cmd === 'view.lineNumbers') {
                this.toggleLineNumbers();
            } else if (cmd === 'view.activeLine') {
                this.toggleActiveLine();
            } else if (cmd === 'view.zoomIn') {
                this.setFontSize(this.fontSize + 1);
            } else if (cmd === 'view.zoomOut') {
                this.setFontSize(this.fontSize - 1);
            } else if (cmd === 'view.zoomReset') {
                this.setFontSize(13);
            } else if (cmd === 'help.shortcuts') {
                this.showShortcuts();
            } else if (cmd === 'help.about') {
                this.showAbout();
            }
        },
        gotoLine: function () {
            var cm = this._cm;
            if (!cm) {
                return;
            }
            this.$prompt('输入要跳转的行号（1 - ' + cm.lineCount() + '）', '转到行', {
                inputPattern: /^\d+$/,
                inputErrorMessage: '请输入数字',
                inputValue: String(this.cursor.line)
            }).then(function (res) {
                var n = parseInt(res.value, 10);
                n = Math.max(1, Math.min(cm.lineCount(), n));
                cm.setCursor({ line: n - 1, ch: 0 });
                cm.scrollIntoView({ line: n - 1, ch: 0 }, 80);
                cm.focus();
            }).catch(function () { /* 取消 */ });
        },
        copySelection: function () {
            var cm = this._cm;
            if (!cm) {
                return;
            }
            var sel = cm.getSelection();
            if (!sel) {
                ELEMENT.Message.info('没有选中内容');
                return;
            }
            var self = this;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(sel).then(function () {
                    ELEMENT.Message.success('已复制');
                }).catch(function () {
                    self.copyFallback();
                });
            } else {
                this.copyFallback();
            }
        },
        copyFallback: function () {
            var cm = this._cm;
            if (!cm) {
                return;
            }
            cm.focus();
            try {
                document.execCommand('copy');
                ELEMENT.Message.success('已复制');
            } catch (e) {
                ELEMENT.Message.warning('复制失败，请使用 Ctrl+C');
            }
        },
        cutSelection: function () {
            var cm = this._cm;
            if (!cm) {
                return;
            }
            var sel = cm.getSelection();
            if (!sel) {
                ELEMENT.Message.info('没有选中内容');
                return;
            }
            var remove = function () {
                cm.replaceSelection('');
                cm.focus();
                ELEMENT.Message.success('已剪切');
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(sel).then(remove).catch(function () {
                    cm.focus();
                    try {
                        document.execCommand('copy');
                        remove();
                    } catch (e) {
                        // ignore
                    }
                });
            } else {
                cm.focus();
                try {
                    document.execCommand('copy');
                    remove();
                } catch (e) {
                    // ignore
                }
            }
        },
        pasteClipboard: function () {
            var cm = this._cm;
            if (!cm) {
                return;
            }
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then(function (text) {
                    if (text) {
                        cm.replaceSelection(text);
                    }
                    cm.focus();
                }).catch(function () {
                    ELEMENT.Message.warning('浏览器未授权读取剪贴板，请使用 Ctrl+V');
                });
            } else {
                ELEMENT.Message.warning('当前浏览器不支持读取剪贴板，请使用 Ctrl+V');
            }
        },
        deleteSelection: function () {
            var cm = this._cm;
            if (!cm) {
                return;
            }
            if (cm.somethingSelected()) {
                cm.replaceSelection('');
            } else {
                cm.execCommand('delCharAfter');
            }
            cm.focus();
        },
        selectCurrentLine: function () {
            var cm = this._cm;
            if (!cm) {
                return;
            }
            var c = cm.getCursor();
            cm.setSelection({ line: c.line, ch: 0 }, { line: c.line, ch: cm.getLine(c.line).length });
            cm.focus();
        },
        clearSelection: function () {
            var cm = this._cm;
            if (!cm) {
                return;
            }
            cm.setCursor(cm.getCursor('head'));
            cm.focus();
        },
        toggleLineNumbers: function () {
            this.lineNumbers = !this.lineNumbers;
            if (this._cm) {
                this._cm.setOption('lineNumbers', this.lineNumbers);
                this._cm.focus();
            }
        },
        toggleActiveLine: function () {
            this.activeLine = !this.activeLine;
            if (this._cm) {
                this._cm.setOption('styleActiveLine', this.activeLine);
                this._cm.focus();
            }
        },
        setFontSize: function (size) {
            this.fontSize = Math.max(10, Math.min(24, size));
            if (this._cm) {
                this._cm.getWrapperElement().style.fontSize = this.fontSize + 'px';
                this._cm.refresh();
            }
        },
        showShortcuts: function () {
            this.$alert('<div style="line-height:1.9;font-size:13px;color:#4b5563">'
                + '<b>文件</b><br>Ctrl+O 打开 · Ctrl+S 保存 · Ctrl+Shift+S 另存为<br>'
                + '<b>编辑</b><br>Ctrl+Z 撤销 · Ctrl+Y 重做 · Ctrl+X / C / V 剪切 / 复制 / 粘贴<br>'
                + 'Ctrl+F 查找 · Ctrl+H 替换 · Ctrl+G 转到行<br>'
                + '<b>选择</b><br>Ctrl+A 全选<br>'
                + '<b>视图</b><br>Alt+Z 自动换行</div>', '快捷键', {
                dangerouslyUseHTMLString: true,
                confirmButtonText: '知道了'
            });
        },
        showAbout: function () {
            this.$alert('DeepShell 文本编辑器<br>基于 CodeMirror 5.65.16 · 支持多标签、远程文件、查找替换与语法高亮',
                '关于编辑器', {
                    dangerouslyUseHTMLString: true,
                    confirmButtonText: '知道了'
                });
        },
        /* ---------- 查找 / 替换 ---------- */
        focusFind: function () {

            var ref = this.$refs.editFindInput;
            var el = ref && ref.$el ? ref.$el.querySelector('input') : null;
            if (el) {
                el.focus();
                el.select();
            }
        },
        openFind: function (withReplace) {
            if (!this._cm) {
                return;
            }
            var sel = this._cm.getSelection();
            if (sel && sel.indexOf('\n') < 0 && sel.length <= 200) {
                this.find.text = sel;
            }
            this.find.open = true;
            this.find.replaceOpen = !!withReplace;
            this.applySearch(true);
            var self = this;
            this.$nextTick(function () {
                self.focusFind();
            });
        },
        closeFind: function () {
            if (this._findTimer) {
                clearTimeout(this._findTimer);
                this._findTimer = null;
            }
            this.find.open = false;
            this.find.replaceOpen = false;
            this.find.total = 0;
            this.find.current = 0;
            this.find.countText = '';
            this._findMatches = [];
            this.clearMarks();
            if (this._cm) {
                this._cm.focus();
            }
        },
        onFindKey: function (e) {
            var key = e.key || '';
            if (key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.findPrev();
                } else {
                    this.findNext();
                }
                return;
            }
            if (key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.closeFind();
                return;
            }
            if (e.altKey) {
                var k = key.toLowerCase();
                if (k === 'c') {
                    e.preventDefault();
                    this.toggleOption('caseSensitive');
                } else if (k === 'w') {
                    e.preventDefault();
                    this.toggleOption('wholeWord');
                } else if (k === 'r') {
                    e.preventDefault();
                    this.toggleOption('regex');
                }
            }
        },
        onReplaceKey: function (e) {
            var key = e.key || '';
            if (key === 'Enter') {
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) {
                    this.replaceAll();
                } else {
                    this.replaceOne();
                }
                return;
            }
            if (key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.closeFind();
            }
        },
        onEditorKey: function (e) {
            if (e.key === 'Escape' && this.find.open) {
                this.closeFind();
                return;
            }
            if (e.altKey && (e.key || '').toLowerCase() === 'z') {
                e.preventDefault();
                this.toggleWrap();
                return;
            }
            var mod = e.ctrlKey || e.metaKey;
            if (!mod) {
                return;
            }
            var key = (e.key || '').toLowerCase();
            if (['o', 's', 'f', 'h', 'g'].indexOf(key) < 0) {
                return;
            }
            if (this._cm && this._cm.hasFocus()) {
                return;
            }
            e.preventDefault();
            if (key === 's' && e.shiftKey) {
                this.saveAs();
            } else if (key === 's') {
                this.save();
            } else if (key === 'o') {
                this.openPicker('open');
            } else if (key === 'f') {
                this.openFind(false);
            } else if (key === 'h') {
                this.openFind(true);
            } else if (key === 'g') {
                this.gotoLine();
            }
        },
        toggleReplace: function () {
            this.find.replaceOpen = !this.find.replaceOpen;
            if (this.find.replaceOpen) {
                var self = this;
                this.$nextTick(function () {
                    self.focusFind();
                });
            }
        },
        toggleWrap: function () {
            this.wrap = !this.wrap;
            if (this._cm) {
                this._cm.setOption('lineWrapping', this.wrap);
                this._cm.refresh();
            }
        },
        toggleOption: function (key) {
            this.find[key] = !this.find[key];
            this.applySearch(true);
            this.focusFind();
        },
        scheduleSearch: function (select) {
            var self = this;
            if (!this.find.open) {
                return;
            }
            if (this._findTimer) {
                clearTimeout(this._findTimer);
            }
            this._findTimer = setTimeout(function () {
                self.applySearch(true, select !== false);
            }, 120);
        },
        buildRegex: function () {
            var f = this.find;
            if (!f.text) {
                return null;
            }
            var source = f.text;
            if (!f.regex) {
                source = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }
            if (f.wholeWord) {
                var w = '[A-Za-z0-9_\\u3400-\\u9fff]';
                source = '(?<!' + w + ')(?:' + source + ')(?!' + w + ')';
            }
            try {
                return new RegExp(source, 'gm' + (f.caseSensitive ? '' : 'i'));
            } catch (e) {
                return null;
            }
        },
        applySearch: function (resetCurrent, selectCurrent) {
            var cm = this._cm;
            if (!cm || !this.activeDoc || !this.find.open) {
                return;
            }
            if (selectCurrent === undefined) {
                selectCurrent = true;
            }
            this.clearMarks();
            this._findMatches = [];
            var f = this.find;
            f.invalid = false;
            if (!f.text) {
                f.total = 0;
                f.current = 0;
                f.countText = '';
                return;
            }
            var re = this.buildRegex();
            if (!re) {
                f.total = 0;
                f.current = 0;
                f.countText = '正则无效';
                f.invalid = true;
                return;
            }
            var text = cm.getValue();
            var stored = [];
            var total = 0;
            var m;
            re.lastIndex = 0;
            while ((m = re.exec(text)) !== null) {
                if (m[0].length === 0) {
                    re.lastIndex++;
                    continue;
                }
                total++;
                if (stored.length < 1500) {
                    stored.push({
                        index: m.index,
                        length: m[0].length,
                        whole: m[0],
                        groups: Array.prototype.slice.call(m, 1)
                    });
                }
                if (total >= 100000) {
                    break;
                }
            }
            this._findMatches = stored;
            f.total = total;
            if (!total) {
                f.current = 0;
                f.countText = '无匹配';
                return;
            }
            if (resetCurrent) {
                var cursorIndex = cm.indexFromPos(cm.getCursor());
                f.current = 0;
                for (var i = 0; i < stored.length; i++) {
                    if (stored[i].index >= cursorIndex) {
                        f.current = i;
                        break;
                    }
                }
            } else if (f.current >= stored.length) {
                f.current = 0;
            }
            f.countText = (f.current + 1) + ' / ' + total + (total >= 100000 ? '+' : '');
            this.highlightMatches(selectCurrent);
        },
        highlightMatches: function (selectCurrent) {
            var cm = this._cm;
            if (!cm) {
                return;
            }
            this.clearMarks();
            var stored = this._findMatches || [];
            var f = this.find;
            for (var i = 0; i < stored.length; i++) {
                var m = stored[i];
                var cls = 'cm-search-hit' + (i === f.current ? ' cm-search-hit-current' : '');
                try {
                    this._cmMarks.push(cm.markText(
                        cm.posFromIndex(m.index), cm.posFromIndex(m.index + m.length),
                        { className: cls }
                    ));
                } catch (e) {
                    // ignore
                }
            }
            var cur = stored[f.current];
            if (cur && selectCurrent !== false) {
                cm.setSelection(cm.posFromIndex(cur.index), cm.posFromIndex(cur.index + cur.length));
            }
        },
        clearMarks: function () {
            var marks = this._cmMarks || [];
            for (var i = 0; i < marks.length; i++) {
                try {
                    marks[i].clear();
                } catch (e) {
                    // ignore
                }
            }
            this._cmMarks = [];
        },
        findNext: function () {
            var f = this.find;
            if (!f.text) {
                return;
            }
            if (!this._findMatches || !this._findMatches.length) {
                this.applySearch(true);
                return;
            }
            f.current = (f.current + 1) % this._findMatches.length;
            f.countText = (f.current + 1) + ' / ' + f.total + (f.total >= 100000 ? '+' : '');
            this.highlightMatches();
        },
        findPrev: function () {
            var f = this.find;
            if (!f.text) {
                return;
            }
            if (!this._findMatches || !this._findMatches.length) {
                this.applySearch(true);
                return;
            }
            f.current = (f.current - 1 + this._findMatches.length) % this._findMatches.length;
            f.countText = (f.current + 1) + ' / ' + f.total + (f.total >= 100000 ? '+' : '');
            this.highlightMatches();
        },
        expandReplacement: function (template, whole, groups) {
            if (!this.find.regex) {
                return template;
            }
            return String(template).replace(/\$(\$|&|\d{1,2})/g, function (all, token) {
                if (token === '$') {
                    return '$';
                }
                if (token === '&') {
                    return whole;
                }
                var n = parseInt(token, 10);
                if (n >= 1 && n <= groups.length) {
                    return groups[n - 1] == null ? '' : groups[n - 1];
                }
                if (token.length === 2) {
                    var first = parseInt(token.charAt(0), 10);
                    if (first >= 1 && first <= groups.length) {
                        return (groups[first - 1] == null ? '' : groups[first - 1]) + token.charAt(1);
                    }
                }
                return all;
            });
        },
        replaceOne: function () {
            var cm = this._cm;
            var f = this.find;
            if (!cm || !f.text) {
                return;
            }
            if (!this._findMatches || !this._findMatches.length) {
                this.applySearch(true);
                return;
            }
            var m = this._findMatches[f.current];
            if (!m) {
                this.applySearch(true);
                return;
            }
            var replacement = this.expandReplacement(f.replace, m.whole, m.groups);
            this._editorSelectAfterChange = true;
            cm.replaceRange(replacement, cm.posFromIndex(m.index), cm.posFromIndex(m.index + m.length));
            cm.focus();
        },
        replaceAll: function () {
            var cm = this._cm;
            var f = this.find;
            if (!cm || !f.text) {
                return;
            }
            var re = this.buildRegex();
            if (!re) {
                ELEMENT.Message.warning('正则表达式无效，请检查后重试');
                return;
            }
            var self = this;
            var text = cm.getValue();
            var count = 0;
            var firstOffset = -1;
            var result = text.replace(re, function (whole) {
                if (!whole.length) {
                    return whole;
                }
                var args = Array.prototype.slice.call(arguments);
                var groups = args.slice(1, args.length - 2);
                var offset = args[args.length - 2];
                count++;
                if (firstOffset < 0) {
                    firstOffset = offset;
                }
                return self.expandReplacement(f.replace, whole, groups);
            });
            if (!count) {
                ELEMENT.Message.info('没有可替换的匹配项');
                return;
            }
            var lastLine = cm.lineCount() - 1;
            cm.operation(function () {
                cm.replaceRange(result, { line: 0, ch: 0 },
                    { line: lastLine, ch: cm.getLine(lastLine).length });
            });
            ELEMENT.Message.success('已全部替换 ' + count + ' 处');
            if (firstOffset >= 0) {
                cm.setCursor(cm.posFromIndex(Math.min(firstOffset, result.length)));
            }
            cm.focus();
        }
    }
});

new Vue({
    el: '#app',
    data: {
        tabs: [],
        activeKey: '',
        /* 终端分屏：splitKeys 按窗格位置保存 tab key，splitSizes 为弹性占比（总和 100） */
        splitKeys: [],
        splitSizes: [],
        splitDir: '',
        connections: [],
        folders: [],
        snippets: [],
        panelVisible: true,
        panelTab: 'file',
        panelWidth: 480,
        desktopClipboard: { connId: null, paths: [], names: [], cut: false },
        /* AI 可视化桌面：外观主题（主题预设 + 自定义颜色/透明度/图标大小） */
        desktopThemes: DESKTOP_THEMES,
        desktopIconSizes: DESKTOP_ICON_SIZES,
        desktopAppearance: loadDesktopAppearance(),
        desktopCustomAppearances: loadDesktopCustomAppearances(),
        desktopAppearanceSaveName: '',
        desktopAppIconChoices: loadDesktopAppIconChoices(),
        desktopAppShapes: DESKTOP_APP_SHAPES,
        desktopAppIconColors: DESKTOP_APP_ICON_COLORS,
        /* 资源管理器：内容搜索 / 批量重命名 / 校验和 */
        desktopContentSearch: {
            visible: false,
            winId: '',
            root: '',
            keyword: '',
            include: '',
            caseSensitive: false,
            loading: false,
            searched: false,
            results: [],
            error: ''
        },
        desktopBatchRename: {
            visible: false,
            winId: '',
            surface: false,
            root: '',
            rows: [],
            existingNames: [],
            mode: 'replace',
            find: '',
            replace: '',
            prefix: '',
            suffix: '',
            template: '文件_{n}',
            start: 1,
            padding: 3,
            keepExt: true,
            saving: false,
            error: ''
        },
        desktopChecksum: {
            visible: false,
            winId: '',
            algorithm: 'sha256',
            rows: [],
            loading: false,
            error: ''
        },
        desktopAppProps: {
            visible: false,
            connId: '',
            key: '',
            icon: '',
            color: '#3d7eff',
            shape: 'rounded',
            image: '',
            iconSearch: ''
        },
        /* AI 可视化桌面 */
        desktopViews: [
            { id: 'large', label: '大图标', icon: 'el-icon-menu' },
            { id: 'medium', label: '中图标', icon: 'el-icon-s-grid' },
            { id: 'small', label: '小图标', icon: 'dsk-vsmall' },
            { id: 'list', label: '详细列表', icon: 'el-icon-tickets' }
        ],
        desktopAppIcons: [
            { key: 'app:explorer', type: 'app', action: 'explorer', label: '资源管理器',
              icon: 'el-icon-folder-opened', color: '#e6a23c',
              category: '文件与存储', desc: '浏览、上传、下载和管理远程服务器文件' },
            { key: 'app:trash', type: 'app', action: 'trash', label: '回收站',
              icon: 'el-icon-delete', color: '#7b8798',
              category: '文件与存储', desc: '查看并恢复已删除的远程文件' },
            { key: 'app:editor', type: 'app', action: 'editor', label: '文本编辑器',
              icon: 'el-icon-edit-outline', color: '#3d7eff',
              category: '效率工具', desc: '新建、打开和编辑远程服务器上的文本文件' },
            { key: 'app:terminal', type: 'app', action: 'terminal', label: '终端',
              icon: 'el-icon-monitor', color: '#22a06b',
              category: '终端与连接', desc: '打开新的终端窗口（本地桌面为当前机器的本地 Shell）' },
            { key: 'app:transfers', type: 'app', action: 'transfers', label: '传输中心',
              icon: 'el-icon-s-promotion', color: '#0ea5a4',
              category: '文件与存储', desc: '查看所有会话的上传、下载任务与进度' },
            { key: 'app:settings', type: 'app', action: 'settings', label: '设置',
              icon: 'el-icon-setting', color: '#54657e',
              category: '系统工具', desc: '调整桌面外观、时钟、网络与系统设置' },
            { key: 'app:ai', type: 'app', action: 'ai', label: 'AI 终端',
              icon: 'el-icon-chat-dot-round', color: '#3d7eff',
              category: 'AI 助手', desc: '使用 AI 助手执行命令、排查服务器问题' }
        ],
        /* 已安装的桌面应用插件（由后端扫描数据目录） */
        desktopPlugins: [],
        builtinPlugins: [],
        pluginMgrVisible: false,
        pluginMgrLoading: false,
        pluginBuiltinLoading: false,
        pluginImporting: false,
        pluginBuiltinInstalling: '',
        pluginMgrError: '',
        desktopStartApps: [
            { id: 'ai', label: 'AI 终端', icon: 'el-icon-chat-dot-round', color: '#3d7eff' },
            { id: 'editor', label: '文本编辑器', icon: 'el-icon-edit-outline', color: '#3d7eff' },
            { id: 'terminal', label: '新建终端', icon: 'el-icon-monitor', color: '#22a06b' },
            { id: 'transfers', label: '传输中心', icon: 'el-icon-s-promotion', color: '#0ea5a4' },
            { id: 'taskmgr', label: '任务管理器', icon: 'el-icon-cpu', color: '#0f6cbd' },
            { id: 'services', label: '服务与计划任务', icon: 'el-icon-s-tools', color: '#0f766e' },
            { id: 'nettool', label: '网络工具箱', icon: 'dsk-ico-network', color: '#7c3aed' },
            { id: 'batchcmd', label: '多机命令', icon: 'el-icon-copy-document', color: '#b45309' },
            { id: 'file', label: '资源管理器', icon: 'el-icon-folder-opened', color: '#e6a23c' },
            { id: 'appcenter', label: '应用中心', icon: 'el-icon-shopping-bag-1', color: '#8b5cf6' },
            { id: 'dirs', label: '常用目录', icon: 'el-icon-star-off', color: '#8b5cf6' },
            { id: 'cmd', label: '快捷命令', icon: 'el-icon-caret-right', color: '#22a06b' },
            { id: 'disk', label: '磁盘', icon: 'el-icon-pie-chart', color: '#f59e0b' },
            { id: 'control', label: '设置', icon: 'el-icon-setting', color: '#54657e' },
            { id: 'help', label: '帮助手册', icon: 'el-icon-question', color: '#2f8fce' },
            { id: 'connect', label: '连接管理', icon: 'el-icon-connection', color: '#2f8fce' }
        ],
        desktopStartActions: [
            { id: 'newTerminal', label: '在此打开终端', icon: 'el-icon-monitor', desc: '当前桌面目录' },
            { id: 'newFolder', label: '新建文件夹', icon: 'el-icon-folder-add', desc: '当前桌面目录' },
            { id: 'newFile', label: '新建文本文件', icon: 'el-icon-document-add', desc: '创建后直接编辑' },
            { id: 'upload', label: '上传文件到桌面', icon: 'el-icon-upload2', desc: '选择本机文件' },
            { id: 'refresh', label: '刷新桌面', icon: 'el-icon-refresh', desc: '重新读取桌面目录' },
            { id: 'showDesktop', label: '显示桌面 / 还原窗口', icon: 'el-icon-s-fold', desc: '最小化或还原全部窗口' },
            { id: 'workbench', label: '在新标签页打开工作台', icon: 'el-icon-top-right', desc: '保留当前桌面' }
        ],
        tmNavItems: [
            { id: 'processes', label: '进程', icon: 'el-icon-s-grid' },
            { id: 'performance', label: '性能', icon: 'el-icon-data-line' },
            { id: 'history', label: '应用历史记录', icon: 'el-icon-time' },
            { id: 'startup', label: '启动应用', icon: 'el-icon-s-promotion' },
            { id: 'users', label: '用户', icon: 'el-icon-user' },
            { id: 'details', label: '详细信息', icon: 'el-icon-tickets' },
            { id: 'services', label: '服务', icon: 'el-icon-service' }
        ],
        tmPerfItems: [
            { id: 'cpu', label: 'CPU', icon: 'el-icon-cpu' },
            { id: 'memory', label: '内存', icon: 'el-icon-coin' },
            { id: 'disk', label: '磁盘', icon: 'el-icon-pie-chart' },
            { id: 'network', label: '网络', icon: 'el-icon-connection' }
        ],
        tmStartupApps: [
            { id: 'ai', label: 'AI 终端', desc: '进入桌面时自动打开 AI 对话窗口',
              impact: '中', impactLevel: 'mid', icon: 'el-icon-chat-dot-round', color: '#3d7eff' },
            { id: 'terminal', label: '终端', desc: '进入桌面时自动打开一个终端窗口（本地桌面为本地 Shell）',
              impact: '高', impactLevel: 'high', icon: 'el-icon-monitor', color: '#22a06b' },
            { id: 'transfers', label: '传输中心', desc: '进入桌面时自动打开传输中心',
              impact: '低', impactLevel: 'low', icon: 'el-icon-s-promotion', color: '#0ea5a4' },
            { id: 'disk', label: '磁盘', desc: '进入桌面时自动打开磁盘占用分析',
              impact: '低', impactLevel: 'low', icon: 'el-icon-pie-chart', color: '#f59e0b' },
            { id: 'taskmgr', label: '任务管理器', desc: '进入桌面时自动打开任务管理器',
              impact: '低', impactLevel: 'low', icon: 'el-icon-cpu', color: '#0f6cbd' }
        ],
        desktopSettingsSections: [
            { id: 'appearance', label: '外观与桌面', icon: 'el-icon-monitor' },
            { id: 'time', label: '时间与时钟', icon: 'el-icon-time' },
            { id: 'shortcuts', label: '快捷键', icon: 'el-icon-set-up' },
            { id: 'safety', label: '终端与安全', icon: 'el-icon-lock' },
            { id: 'power', label: '电源与休眠', icon: 'el-icon-switch-button' },
            { id: 'ai', label: 'AI 助手', icon: 'el-icon-magic-stick' },
            { id: 'network', label: '网络与连接', icon: 'el-icon-connection' },
            { id: 'backup', label: '备份与还原', icon: 'el-icon-folder-opened' },
            { id: 'system', label: '系统信息', icon: 'el-icon-cpu' }
        ],
        desktopResizeDirs: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'],
        /* 无 SSH 会话的本地桌面：数据目录 Desktop 沙箱，服务器专属功能禁用 */
        localDesktopTab: {
            key: '__local_desktop__',
            title: '本地桌面',
            connId: null,
            sessionId: '',
            sftpHome: '/',
            status: 'local',
            local: true,
            stats: null
        },
        desktop: {
            visible: false,
            local: false,
            wallDropActive: false,
            tabKey: '',
            windows: [],
            activeWinId: '',
            explorerId: '',
            zSeq: 0,
            ghost: createDesktopWindow(''),
            snapPreview: { visible: false, kind: '', x: 0, y: 0, w: 0, h: 0 },
            wallMenu: { visible: false, x: 0, y: 0 },
            taskMenu: { visible: false, x: 0, y: 0, winId: '' },
            taskbarMenu: { visible: false, x: 0, y: 0 },
            trayMenu: { visible: false, x: 0, y: 0 },
            showDesktopIds: [],
            surface: { dir: '', loading: false, error: '', loaded: false, entries: [] },
            iconLayout: [],
            iconOrder: [],
            iconHidden: [],
            iconSelected: '',
            iconSelectedKeys: [],
            iconMarquee: { visible: false, left: 0, top: 0, width: 0, height: 0 },
            focusSurface: false,
            iconDragKey: '',
            iconDropKey: '',
            iconMenu: { visible: false, x: 0, y: 0, key: '' },
            trashMenu: { visible: false, x: 0, y: 0, item: null, winId: '' },
            archiveWin: null,
            menu: { visible: false, x: 0, y: 0, target: null, surface: false },
            propsVisible: false,
            props: null,
            startOpen: false,
            powerOpen: false,
            startSearch: '',
            startSearching: false,
            startSearched: false,
            startResults: [],
            startError: '',
            startRootPath: '',
            startWinId: '',
            clockNow: Date.now(),
            calendarOpen: false,
            calendarYear: 0,
            calendarMonth: 0,
            calendarSelected: '',
            notifications: [],
            notifUnread: 0,
            notifOpen: false,
            settingsVisible: false,
            settingsSection: 'appearance',
            compressSub: { visible: false, x: 0, y: 0 },
            extractSub: { visible: false, x: 0, y: 0 },
            downloadSub: { visible: false, x: 0, y: 0 },
            thumbnailsEnabled: loadDesktopThumbs(),
            showHidden: loadDesktopShowHidden(),
            clock24h: loadDesktopClock24h(),
            clockSeconds: loadDesktopClockSeconds(),
            clockShowDate: loadDesktopClockShowDate(),
            idleMinutes: loadDesktopIdleMinutes()
        },
        /* 任务管理器（单实例窗口；进程/性能数据均依赖当前桌面连接） */
        taskmgr: {
            winId: '',
            tab: 'processes',
            selected: '',
            collapsedApps: false,
            collapsedBg: false,
            search: '',
            procSortBy: 'cpu',
            procSortDir: 'desc',
            perfItem: 'cpu',
            history: { cpu: [], mem: [], disk: [], rx: [], tx: [] },
            bg: [],
            detail: {
                rows: [], loading: false, error: '', loadedAt: 0, filter: '',
                sortBy: 'cpu', sortDir: 'desc', selectedPid: 0,
                overlayVisible: false, overlayRow: null, overlayCmd: '', overlayLoading: false
            },
            sysInfo: null,
            sysInfoLoading: false,
            sysInfoError: '',
            sysInfoAt: 0,
            appHistory: {},
            startup: loadDesktopStartup(),
            ctxMenu: { visible: false, x: 0, y: 0, kind: '', key: '', title: '' },
            runVisible: false,
            runText: ''
        },
        /* 服务与计划任务 */
        servicesApp: {
            tab: 'services',
            loading: false,
            error: '',
            keyword: '',
            onlyRunning: false,
            items: [],
            busy: '',
            cronLoading: false,
            cronLoaded: false,
            cronError: '',
            cron: { user: [], system: [], timers: [] },
            newCron: '',
            addingCron: false
        },
        /* 网络工具箱 */
        netTool: {
            tab: 'traffic',
            tool: 'ping',
            target: '',
            port: '80',
            running: false,
            error: '',
            output: '',
            exitCode: null,
            durationMs: 0,
            timedOut: false,
            at: 0,
            root: {
                checked: false,
                loading: false,
                user: '',
                uid: -1,
                isRoot: false,
                ready: false,
                passwordless: false,
                needsPassword: false
            },
            rootEnabled: false,
            traffic: {
                data: null,
                error: '',
                paused: false,
                intervalMs: 2000,
                includeLoopback: false,
                keyword: '',
                sortBy: 'rate',
                sortDir: 'desc',
                selectedPid: 0,
                updatedAt: 0
            },
            ports: {
                data: null,
                error: '',
                loading: false,
                keyword: '',
                exposedOnly: false,
                updatedAt: 0,
                rawOpen: false
            }
        },
        /* 多机命令 */
        batchCmd: {
            ids: [],
            keyword: '',
            command: '',
            running: false,
            error: '',
            items: [],
            elapsedMs: 0
        },
        connectDialogVisible: false,
        connFilter: 'all',
        connKeyword: '',
        connExpanded: {},
        connDragId: null,
        connDragOverId: null,
        /* 拖动连接时落点行（按 row.key）与插入位置 before / after */
        connDropKey: null,
        connDropPos: '',
        /* 打开连接弹窗中当前展开设置菜单的行（按 row.key 区分，最近/置顶/列表可能重复出现同一连接） */
        connMenuKey: null,
        editVisible: false,
        editForm: { path: '', content: '', loading: false, saving: false, sessionId: '', tabKey: '' },
        editTab: null,
        editPendingPath: '',
        editPendingSeq: 0,
        editDialogTitle: '',
        distribute: {
            visible: false,
            mode: 'local',
            phase: 'edit',
            files: [],
            targetPath: '',
            keyword: '',
            ids: [],
            dragOver: false,
            starting: false,
            preparePct: 0,
            task: null,
            error: '',
            cancelling: false,
            speed: 0,
            sourceSessionId: '',
            sourceConnId: null,
            sourceDir: ''
        },
        editor: {
            find: {
                text: '', replace: '', caseSensitive: false, wholeWord: false, regex: false,
                replaceOpen: false, total: 0, current: 0, countText: '', invalid: false
            },
            cursor: { line: 1, col: 1 },
            lineCount: 1,
            wrap: false,
            dirty: false,
            modeLabel: '纯文本'
        },
        renameVisible: false,
        renameForm: { path: '', newName: '' },
        archiveDialogVisible: false,
        archiveSaving: false,
        archiveExtracting: false,
        archiveSources: [],
        archiveLastFormat: 'zip',
        archiveForm: { format: 'zip', name: '', level: 'normal', overwrite: false },
        archiveFormats: [
            { id: 'zip', label: 'ZIP', ext: '.zip', desc: 'Windows / Linux 通用' },
            { id: '7z', label: '7Z', ext: '.7z', desc: '高压缩率，需服务器安装 7z' },
            { id: 'tar', label: 'TAR', ext: '.tar', desc: '只打包，不压缩' },
            { id: 'tar.gz', label: 'TAR.GZ', ext: '.tar.gz', desc: 'Linux 常用 gzip 压缩' },
            { id: 'tar.bz2', label: 'TAR.BZ2', ext: '.tar.bz2', desc: 'bzip2 压缩' },
            { id: 'tar.xz', label: 'TAR.XZ', ext: '.tar.xz', desc: 'xz 高压缩率' }
        ],
        archiveLevels: [
            { id: 'store', label: '仅存储', desc: '最快，体积最大' },
            { id: 'fastest', label: '快速', desc: '压缩快，体积较大' },
            { id: 'normal', label: '标准', desc: '速度与体积均衡' },
            { id: 'max', label: '极限', desc: '最慢，体积最小' }
        ],
        newCmd: { name: '', command: '' },
        commonDirsByConn: {},
        newDirPath: '',
        cmdEditDialog: false,
        cmdEditSaving: false,
        cmdEditForm: { id: null, name: '', command: '' },
        sftpFollow: loadSftpFollow(),
        transfers: [],
        transferCenterOpen: false,
        localDownloadStatus: { checked: false, local: false, available: false },
        localDlSummary: { visible: false, item: null },
        permVisible: false,
        permSaving: false,
        permForm: { path: '', name: '', mode: '644' },
        fileDragOver: false,
        cmdOpts: loadCmdOpts(),
        snippetTarget: loadSnippetTarget(),
        snippetTargets: [],
        tabMenu: { visible: false, x: 0, y: 0, tab: null },
        termMenu: { visible: false, x: 0, y: 0, text: '', context: '', tabKey: '', windowId: '', hasSelection: false, canAi: false },
        hostKeyVisible: false,
        hostKeyTrusting: false,
        hostKeyChecked: false,
        hostKeyPrompt: null,
        connHelpVisible: false,
        connHelpError: null,
        connHelpTab: null,
        onboardingVisible: false,
        onboardingChecking: false,
        connImportTab: 'file',
        desktopDropDialog: {
            visible: false, paths: [], names: [], win: null, targetWin: null,
            dest: '', title: '', isDesktop: false, busy: false
        },
        pfVisible: false,
        pfTab: null,
        pfLoading: false,
        pfSaving: false,
        pfRules: [],
        pfEditId: null,
        pfForm: emptyPfForm(),
        folderMenu: { visible: false, x: 0, y: 0, row: null },
        topMenuVisible: false,
        topSubMenu: '',
        topMenuPos: { top: 48, right: 10 },
        connImportVisible: false,
        connExportVisible: false,
        connExportChecked: [],
        backupVisible: false,
        backupBusy: false,
        backupAction: '',
        backupBusyText: '',
        backupFile: null,
        backupFileName: '',
        backupFileSize: 0,
        backupResult: null,
        backupRestored: false,
        fontVisible: false,
        hotkeyVisible: false,
        bgVisible: false,
        helpVisible: false,
        sponsorVisible: false,
        aboutVisible: false,
        protocolVisible: false,
        protocolLoading: false,
        protocolInfo: {
            enabled: true, scheme: 'deepshell', state: 'PENDING', detail: '',
            launcher: '', platform: ''
        },
        integrationVisible: false,
        integrationLoading: false,
        integrationInfo: {
            endpoint: '/api/integration/connections/open',
            token: '', configured: false, clients: 0, scheme: 'http', port: 0
        },
        /* DeepShell 后端自身的关闭 / 重启状态 */
        appLifecycle: {
            visible: false,
            mode: 'shutdown',
            status: 'closing',
            elapsed: 0
        },
        lanVisible: false,
        authSetVisible: false,
        authSetSaving: false,
        authSetHours: 6,
        authStatus: {
            enabled: false,
            defaultPassword: false,
            loggedIn: true,
            username: '',
            tokenExpireHours: 6,
            defaultTokenExpireHours: 6,
            tokenRemainingSeconds: null
        },
        auditVisible: false,
        auditLoading: false,
        auditItems: [],
        auditTotal: 0,
        auditPage: 1,
        auditPageSize: 50,
        auditAction: '',
        auditKeyword: '',
        auditActions: [
            ['LOGIN_SUCCESS', '登录成功'],
            ['LOGIN_FAILURE', '登录失败'],
            ['LOGOUT', '退出登录'],
            ['AI_COMMAND', 'AI 命令'],
            ['TERMINAL_COMMAND', '终端命令'],
            ['AI_CONTEXT_COMPACT', 'AI 上下文压缩'],
            ['FILE_UPLOAD', '上传'],
            ['FILE_DOWNLOAD', '下载'],
            ['FILE_DELETE', '删除'],
            ['FILE_RENAME', '重命名'],
            ['FILE_MOVE', '移动'],
            ['FILE_MKDIR', '新建目录'],
            ['FILE_TOUCH', '新建文件'],
            ['FILE_EDIT', '在线编辑'],
            ['FILE_CHMOD', '修改权限'],
            ['FILE_COMPRESS', '压缩'],
            ['PLUGIN_INSTALL', '安装插件'],
            ['PLUGIN_DELETE', '卸载插件'],
            ['CONNECTION_CREATE', '新建连接'],
            ['CONNECTION_UPDATE', '编辑连接'],
            ['CONNECTION_DELETE', '删除连接'],
            ['CONNECTION_IMPORT', '导入连接'],
            ['CONNECTION_EXPORT', '导出连接'],
            ['PROTOCOL_OPEN', '外部调用'],
            ['PROTOCOL_REGISTER', '注册外部调用'],
            ['INTEGRATION_OPEN', '接口打开连接'],
            ['INTEGRATION_TOKEN', '集成接口 Token'],
            ['NETWORK_ROOT', 'root 采样'],
            ['HOST_KEY', '主机指纹'],
            ['PORT_FORWARD', '端口转发'],
            ['AUTH_SETTINGS', '认证设置']
        ],
        aiSetVisible: false,
        aiSetSaving: false,
        aiSetForm: { provider: 'deepseek', baseUrl: '', model: '', apiKey: '', hasKey: false,
            maxSteps: AI_MAX_STEPS_DEFAULT, contextWindow: AI_CONTEXT_WINDOW_DEFAULT },
        aiMaxSteps: AI_MAX_STEPS_DEFAULT,
        aiContextWindow: AI_CONTEXT_WINDOW_DEFAULT,
        aiSlashCommands: [
            { id: 'new', label: '/new', desc: '开始一个新对话' },
            { id: 'clear', label: '/clear', desc: '清空当前对话记录' },
            { id: 'compact', label: '/compact', desc: '压缩较早上下文，保留最近消息' },
            { id: 'pin', label: '/pin', desc: '置顶 / 取消置顶当前对话' },
            { id: 'fork', label: '/fork', desc: '复制当前对话并开始分叉' },
            { id: 'auto', label: '/auto', desc: '切换为自动执行' },
            { id: 'manual', label: '/manual', desc: '切换为每步确认' },
            { id: 'desktop', label: '/desktop', desc: '打开 AI 可视化桌面' },
            { id: 'stop', label: '/stop', desc: '停止当前生成或命令' },
            { id: 'help', label: '/help', desc: '打开帮助' }
        ],
        aiProviders: [],
        aiModelOptions: [],
        aiModelsLoading: false,
        aiModelsNote: '',
        sysInfoVisible: false,
        sysInfoLoading: false,
        sysInfoError: '',
        sysInfo: null,
        sysInfoAuto: true,
        sysInfoTitle: '',
        sysInfoSessionId: '',
        procDetail: null,
        procDetailVisible: false,
        procDetailCmd: null,
        lanSettings: {
            lanEnabled: false, effectiveLan: false, restartRequired: false, port: 0, urls: [],
            authEnabled: false, defaultPassword: false, tlsEnabled: false, tlsMode: 'auto',
            tlsSelfSigned: false, tlsNextEnabled: false
        },
        appInfo: { version: '1.6.1', java: '', os: '', dataDir: '', buildTime: '',
            protocolState: '', protocolScheme: 'deepshell', protocolDetail: '' },
        fontSettings: loadFontSettings(),
        hotkeySettings: loadHotkeySettings(),
        bgSettings: loadBgSettings(),
        bgTarget: 'terminal',
        bgDraft: { url: '', opacity: 0.35, blur: 0 },
        openAfterConnect: loadOpenAfterConnect(),
        dangerConfirmEnabled: loadDangerConfirmEnabled(),
        termLogHighlightEnabled: loadTermLogHighlight(),
        chatExamples: ['看看哪个目录占用空间最大', '这台服务器上都装了什么服务，分别监听哪些端口',
            '最近的登录记录里有没有异常 IP'],
        fontCandidates: ['Consolas', 'JetBrains Mono', 'Courier New', 'monospace',
            'Microsoft YaHei Mono', 'DejaVu Sans Mono', 'Menlo', 'Monaco']
    },
    watch: {
        hotkeySettings: {
            deep: true,
            handler: function (v) {
                try { localStorage.setItem('deepshell.hotkey', JSON.stringify(v)); } catch (e) { /* ignore */ }
            }
        },
        desktopAppearance: {
            deep: true,
            handler: function (v) {
                var self = this;
                if (this._deskAppearanceSaveTimer) {
                    clearTimeout(this._deskAppearanceSaveTimer);
                }
                this._deskAppearanceSaveTimer = setTimeout(function () {
                    self._deskAppearanceSaveTimer = null;
                    saveDesktopAppearance(v);
                }, 180);
            }
        },
        desktopAppStyleConnId: function (nv, ov) {
            if (nv !== ov) {
                this.applyDesktopAppIconStylesForConn(nv);
            }
        },
        openAfterConnect: function (v) {
            try { localStorage.setItem('deepshell.openAfterConnect', v); } catch (e) { /* ignore */ }
        },
        dangerConfirmEnabled: function (v) {
            try { localStorage.setItem('deepshell.dangerConfirm', v ? '1' : '0'); } catch (e) { /* ignore */ }
        },
        termLogHighlightEnabled: function (v) {
            try { localStorage.setItem('deepshell.termLogHighlight', v ? '1' : '0'); } catch (e) { /* ignore */ }
            this.resetAllTermLogStreams(!v);
        },
        topMenuVisible: function (v) {
            if (!v) {
                this.topSubMenu = '';
            }
        },
        cmdOpts: {
            deep: true,
            handler: function (v) {
                try { localStorage.setItem('deepshell.cmdOpts', JSON.stringify(v)); } catch (e) { /* ignore */ }
            }
        },
        snippetTarget: function (v) {
            try { localStorage.setItem('deepshell.snippetTarget', v); } catch (e) { /* ignore */ }
        },
        activeKey: function () {
            // 常用目录按连接隔离：首次切到某主机的标签时按需加载
            var t = this.activeTab;
            if (t && t.connId != null && !Object.prototype.hasOwnProperty.call(this.commonDirsByConn, t.connId)) {
                this.loadCommonDirs(t.connId);
            }
        },
        sftpFollow: function (v) {
            try { localStorage.setItem('deepshell.sftpFollow', v ? '1' : '0'); } catch (e) { /* ignore */ }
        },
        sysInfoVisible: function (v) {
            this.refreshSysInfoTimer(v && this.sysInfoAuto);
            if (v) {
                this.loadSysInfo();
            }
        },
        sysInfoAuto: function (v) {
            if (this.sysInfoVisible) {
                this.refreshSysInfoTimer(v);
            }
        },
        'desktop.startOpen': function (v) {
            if (!v) {
                this.desktop.powerOpen = false;
            }
        },
        'desktop.startSearch': function () {
            // 关键字变化后旧的递归搜索结果立即失效
            this._deskSearchSeq = (this._deskSearchSeq || 0) + 1;
            this.desktop.startSearching = false;
            this.desktop.startSearched = false;
            this.desktop.startResults = [];
            this.desktop.startError = '';
            this.desktop.startRootPath = '';
            this.desktop.startWinId = '';
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.desktopStartBody) {
                    self.$refs.desktopStartBody.scrollTop = 0;
                }
            });
        },
        // 输入框内容跟随当前对话，切换后各自恢复草稿
        'activeTab.chatInput': function (v) {
            var t = this.activeTab;
            if (!t) {
                return;
            }
            var conv = this.aiActiveConv(t);
            if (conv && conv.input !== v) {
                this.$set(conv, 'input', v || '');
            }
        },
        'desktop.thumbnailsEnabled': function (v) {
            try { localStorage.setItem('deepshell.desktopThumbs', v ? '1' : '0'); } catch (e) { /* ignore */ }
            var self = this;
            if (!v) {
                this.resetSurfaceThumbs();
            } else {
                this.$nextTick(function () {
                    self.loadSurfaceThumbs();
                });
            }
            this.$nextTick(function () {
                self.setupDesktopThumbs(self.desk);
            });
        },
        'desk.viewMode': function () {
            var self = this;
            this.$nextTick(function () {
                self.setupDesktopThumbs(self.desk);
            });
        },
        // 目录内容 / 筛选 / 排序变化后，重新观察当前渲染出的网格项
        desktopShownEntries: function () {
            var self = this;
            this.$nextTick(function () {
                self.setupDesktopThumbs(self.desk);
            });
        },
        'desktop.showHidden': function (v) {
            try { localStorage.setItem('deepshell.desktopShowHidden', v ? '1' : '0'); } catch (e) { /* ignore */ }
            this.rebuildDesktopIconOrder();
            this.loadSurfaceThumbs();
        },
        'desktop.clock24h': function (v) {
            try { localStorage.setItem('deepshell.clock24h', v ? '1' : '0'); } catch (e) { /* ignore */ }
            this.desktop.clockNow = Date.now();
        },
        'desktop.clockSeconds': function (v) {
            try { localStorage.setItem('deepshell.clockSeconds', v ? '1' : '0'); } catch (e) { /* ignore */ }
            this.desktop.clockNow = Date.now();
        },
        'desktop.clockShowDate': function (v) {
            try { localStorage.setItem('deepshell.clockShowDate', v ? '1' : '0'); } catch (e) { /* ignore */ }
        },
        'desktop.idleMinutes': function (v) {
            try { localStorage.setItem('deepshell.idleMinutes', String(v || 0)); } catch (e) { /* ignore */ }
            this._deskLastActivity = Date.now();
        }
    },
    computed: {
        /** 外部调用示例：优先使用列表中的第一条已保存连接，链接不含密码 */
        protocolExampleLink: function () {
            if (this.connections && this.connections.length) {
                return 'deepshell://connect?id=' + this.connections[0].id;
            }
            return 'deepshell://connect?host=192.168.1.10&port=22&username=root&name=Demo&password=your-password';
        },
        integrationEndpointUrl: function () {
            return location.origin + (this.integrationInfo.endpoint || '/api/integration/connections/open');
        },
        integrationCurl: function () {
            var token = this.integrationInfo.token || 'YOUR_TOKEN';
            return "curl -X POST '" + this.integrationEndpointUrl + "' \\\n"
                + "  -H 'Content-Type: application/json' \\\n"
                + "  -H 'X-DeepShell-Integration-Token: " + token + "' \\\n"
                + "  -d '{\"name\":\"生产服务器\",\"host\":\"10.0.0.10\",\"port\":22,"
                + "\"username\":\"root\",\"password\":\"******\","
                + "\"view\":\"desktop\",\"source\":\"jumpserver\"}'";
        },
        splitDividerKeys: function () {
            return this.splitKeys.length > 1 ? this.splitKeys.slice(0, -1) : [];
        },
        appLifecycleTitle: function () {
            var s = this.appLifecycle;
            if (s.mode === 'shutdown') {
                return s.status === 'closing' ? '正在关闭 DeepShell 后端' : 'DeepShell 后端服务已关闭';
            }
            if (s.status === 'timeout') {
                return '等待 DeepShell 重启超时';
            }
            if (s.status === 'restored') {
                return 'DeepShell 已重启，正在刷新页面';
            }
            return '正在重启 DeepShell 后端';
        },
        appLifecycleSub: function () {
            var s = this.appLifecycle;
            if (s.mode === 'shutdown') {
                return s.status === 'closing'
                    ? '正在停止终端、文件传输与 AI 服务，请稍候…'
                    : '终端、文件传输与 AI 服务均已停止。重新启动 DeepShell 后，点击下方按钮刷新页面。';
            }
            if (s.status === 'timeout') {
                return '已等待 ' + s.elapsed + ' 秒仍未检测到服务恢复，请确认 DeepShell 后端是否启动成功，然后刷新页面。';
            }
            if (s.status === 'restored') {
                return '服务已恢复，页面即将自动刷新。';
            }
            return '服务退出后会自动重新启动，已等待 ' + s.elapsed + ' 秒，恢复后页面将自动刷新…';
        },
        /* 当前选中的 AI 厂商预设（弹窗中展示默认地址 / Key 获取地址） */
        aiCurrentPreset: function () {
            var id = this.aiSetForm.provider;
            for (var i = 0; i < this.aiProviders.length; i++) {
                if (this.aiProviders[i].id === id) {
                    return this.aiProviders[i];
                }
            }
            return null;
        },
        sftpSelectedHasFile: function () {
            var t = this.activeTab;
            return !!(t && (t.sftpSelected || []).some(function (r) {
                return !r.dir;
            }));
        },
        localDownloadReady: function () {
            return !!(this.localDownloadStatus.local && this.localDownloadStatus.available);
        },
        distributeFileBytes: function () {
            return this.distribute.files.reduce(function (sum, f) {
                return sum + (f.size || 0);
            }, 0);
        },
        distributeTargets: function () {
            var kw = String(this.distribute.keyword || '').trim().toLowerCase();
            var self = this;
            var list = this.connections.filter(function (c) {
                if (self.distribute.mode === 'cross' && c.id === self.distribute.sourceConnId) {
                    return false;
                }
                if (!kw) {
                    return true;
                }
                var text = [c.name, c.host, c.username, c.port || 22].join(' ').toLowerCase();
                return text.indexOf(kw) >= 0;
            });
            return list.slice().sort(function (a, b) {
                return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN', { numeric: true });
            });
        },
        canDistribute: function () {
            var d = this.distribute;
            return d.files.length > 0 && d.ids.length > 0
                && String(d.targetPath || '').trim().charAt(0) === '/'
                && !d.starting;
        },
        distributeModeWord: function () {
            return this.distribute.mode === 'cross' ? '传输' : '分发';
        },
        distributeTargetTotal: function () {
            var total = (this.connections || []).length;
            if (this.distribute.mode === 'cross' && this.distribute.sourceConnId != null) {
                total = Math.max(0, total - 1);
            }
            return total;
        },
        distributeStatusText: function () {
            var t = this.distribute.task;
            var word = this.distributeModeWord;
            if (!t) {
                return '正在准备' + (this.distribute.mode === 'cross' ? '源文件' : '文件') + '…';
            }
            if (t.status === 'running') {
                return '正在' + word + '到 ' + t.totalTargets + ' 台服务器…';
            }
            if (t.status === 'cancelled') {
                return word + '已取消';
            }
            if (t.failedTargets && t.failedTargets === t.totalTargets) {
                return word + '失败';
            }
            if (t.failedTargets) {
                return word + '完成（部分失败）';
            }
            return word + '完成';
        },
        distributeStatusIcon: function () {
            var t = this.distribute.task;
            if (!t || t.status === 'running') {
                return 'el-icon-loading';
            }
            if (t.status === 'cancelled') {
                return 'el-icon-circle-close';
            }
            if (t.failedTargets && t.failedTargets === t.totalTargets) {
                return 'el-icon-circle-close';
            }
            return 'el-icon-circle-check';
        },
        distributeOverallPct: function () {
            var t = this.distribute.task;
            if (!t) {
                return Math.max(0, Math.min(99, Math.round(this.distribute.preparePct || 0)));
            }
            if (t.status === 'done') {
                return 100;
            }
            var total = t.totalBytes || 0;
            if (!total) {
                return 0;
            }
            var pct = Math.floor((t.doneBytes || 0) * 100 / total);
            return Math.max(0, Math.min(99, pct));
        },
        distributeOverallStatus: function () {
            var t = this.distribute.task;
            if (!t || t.status === 'running') {
                return null;
            }
            if (t.status === 'cancelled') {
                return 'warning';
            }
            if (t.failedTargets && t.failedTargets === t.totalTargets) {
                return 'exception';
            }
            return t.failedTargets ? 'warning' : 'success';
        },
        distributeStatusClass: function () {
            var t = this.distribute.task;
            if (!t || t.status === 'running') {
                return '';
            }
            if (t.status === 'cancelled' || t.failedTargets) {
                return (t.failedTargets && t.failedTargets === t.totalTargets)
                    ? 'dist-status-error' : 'dist-status-warn';
            }
            return 'dist-status-ok';
        },
        pfFirstError: function () {
            var list = this.pfRules || [];
            for (var i = 0; i < list.length; i++) {
                if (list[i].error) {
                    return list[i].error;
                }
            }
            return '';
        },
        activeTab: function () {
            return this.tabs.find(function (t) { return t.key === this.activeKey; }, this) || null;
        },
        /* 当前主机的常用目录（按连接隔离） */
        /* 侧栏面板与桌面工具窗口共用的操作会话：桌面打开时优先当前桌面连接 */
        uiTab: function () {
            return (this.desktop.visible ? this.desktopTab : null) || this.activeTab;
        },
        uiCurrentDir: function () {
            if (this.desktop.visible) {
                return this.desk.path || this.desktopHomeDir || '';
            }
            var t = this.activeTab;
            return t ? (t.sftpPath || '') : '';
        },
        commonDirs: function () {
            var t = this.uiTab;
            if (!t || t.connId == null) {
                return [];
            }
            return this.commonDirsByConn[t.connId] || [];
        },
        /* ---------- AI 可视化桌面 ---------- */
        /* 当前聚焦的资源管理器窗口；AI 窗口激活时仍保留最近使用的资源管理器 */
        desk: function () {
            var id = this.desktop.explorerId;
            if (!id) {
                var active = this.desktopWindowById(this.desktop.activeWinId);
                if (active && active.type === 'explorer') {
                    id = active.id;
                }
            }
            if (id) {
                for (var i = 0; i < this.desktop.windows.length; i++) {
                    if (this.desktop.windows[i].id === id) {
                        return this.desktop.windows[i];
                    }
                }
            }
            return this.desktop.ghost;
        },
        desktopAiWin: function () {
            for (var i = 0; i < this.desktop.windows.length; i++) {
                if (this.desktop.windows[i].type === 'ai') {
                    return this.desktop.windows[i];
                }
            }
            return null;
        },
        desktopTransferWin: function () {
            for (var i = 0; i < this.desktop.windows.length; i++) {
                if (this.desktop.windows[i].type === 'transfer') {
                    return this.desktop.windows[i];
                }
            }
            return null;
        },
        desktopEditorWindow: function () {
            for (var i = 0; i < this.desktop.windows.length; i++) {
                if (this.desktop.windows[i].type === 'editor') {
                    return this.desktop.windows[i];
                }
            }
            return null;
        },
        desktopDiskWin: function () {
            for (var i = 0; i < this.desktop.windows.length; i++) {
                if (this.desktop.windows[i].type === 'disk') {
                    return this.desktop.windows[i];
                }
            }
            return null;
        },
        desktopConnWin: function () {
            for (var i = 0; i < this.desktop.windows.length; i++) {
                if (this.desktop.windows[i].type === 'connect') {
                    return this.desktop.windows[i];
                }
            }
            return null;
        },
        taskmgrWin: function () {
            for (var i = 0; i < this.desktop.windows.length; i++) {
                if (this.desktop.windows[i].type === 'taskmgr') {
                    return this.desktop.windows[i];
                }
            }
            return null;
        },
        desktopTaskWindows: function () {
            return this.desktop.windows.filter(function (w) {
                return w.type === 'explorer' || w.type === 'terminal' || w.type === 'taskmgr'
                    || w.type === 'transfer' || w.type === 'disk' || w.type === 'connect'
                    || w.type === 'dirs' || w.type === 'cmd' || w.type === 'plugin'
                    || w.type === 'editor' || w.type === 'services'
                    || w.type === 'nettool' || w.type === 'batchcmd';
            });
        },
        filteredServiceRows: function () {
            var q = String(this.servicesApp.keyword || '').trim().toLowerCase();
            var onlyRunning = this.servicesApp.onlyRunning;
            return (this.servicesApp.items || []).filter(function (s) {
                if (onlyRunning && s.active !== 'active') {
                    return false;
                }
                if (!q) {
                    return true;
                }
                return String(s.unit + ' ' + (s.description || '')).toLowerCase().indexOf(q) >= 0;
            });
        },
        batchConnectionRows: function () {
            var q = String(this.batchCmd.keyword || '').trim().toLowerCase();
            return (this.connections || []).filter(function (c) {
                if (!q) {
                    return true;
                }
                return String(c.name + ' ' + c.host + ' ' + (c.username || ''))
                    .toLowerCase().indexOf(q) >= 0;
            });
        },
        /* ---------- 任务管理器 ---------- */
        tmApps: function () {
            var q = String(this.taskmgr.search || '').trim().toLowerCase();
            var rows = this.desktop.windows.slice();
            if (q) {
                var self = this;
                rows = rows.filter(function (w) {
                    var name = (self.desktopWindowTitle(w) + ' '
                        + self.desktopWindowSubtitle(w) + ' ' + w.type).toLowerCase();
                    return name.indexOf(q) >= 0;
                });
            }
            return this.tmSortProcessRows(rows);
        },
        tmBackground: function () {
            var q = String(this.taskmgr.search || '').trim().toLowerCase();
            var rows = this.taskmgr.bg.slice();
            if (q) {
                rows = rows.filter(function (p) {
                    return (p.name + ' ' + p.status).toLowerCase().indexOf(q) >= 0;
                });
            }
            return this.tmSortProcessRows(rows);
        },
        tmProcessCount: function () {
            return this.desktop.windows.length + this.taskmgr.bg.length;
        },
        tmSelectedLabel: function () {
            var sel = this.taskmgr.selected || '';
            if (sel.indexOf('win:') === 0) {
                var w = this.desktopWindowById(sel.substring(4));
                return w ? this.desktopWindowTitle(w) : '';
            }
            if (sel.indexOf('bg:') === 0) {
                var pid = sel.substring(3);
                for (var i = 0; i < this.taskmgr.bg.length; i++) {
                    if (String(this.taskmgr.bg[i].pid) === pid) {
                        return this.taskmgr.bg[i].name;
                    }
                }
            }
            return '';
        },
        tmCanEndSelected: function () {
            var sel = this.taskmgr.selected || '';
            return sel.indexOf('win:') === 0 && !!this.desktopWindowById(sel.substring(4));
        },
        tmStats: function () {
            var t = this.desktopTab;
            return t && t.stats ? t.stats : null;
        },
        tmStatsReady: function () {
            var st = this.tmStats;
            return !!(st && !st.error && st.cpu != null);
        },
        tmStatsError: function () {
            var st = this.tmStats;
            return st && st.error ? st.error : '';
        },
        tmHostName: function () {
            var st = this.tmStats;
            var t = this.desktopTab;
            return (st && st.host) || (t && t.host) || '当前会话';
        },
        tmHostTitle: function () {
            var t = this.desktopTab;
            if (!t) {
                return '未连接';
            }
            var conn = null;
            for (var i = 0; i < this.connections.length; i++) {
                if (this.connections[i].id === t.connId) {
                    conn = this.connections[i];
                    break;
                }
            }
            var user = (conn && conn.username) || '';
            var host = (conn && conn.host) || t.host || '';
            return (user ? user + '@' : '') + (host || '未连接');
        },
        tmCpuText: function () {
            var st = this.tmStats;
            return st && st.cpu != null ? Math.round(st.cpu) + '%' : '--';
        },
        tmMemText: function () {
            var st = this.tmStats;
            return st && st.memPct != null ? Math.round(st.memPct) + '%' : '--';
        },
        tmHistoryRows: function () {
            var meta = {
                explorer: { label: '资源管理器', icon: 'el-icon-folder-opened', color: '#e6a23c' },
                terminal: { label: '终端', icon: 'el-icon-monitor', color: '#22a06b' },
                ai: { label: 'AI 终端', icon: 'el-icon-chat-dot-round', color: '#3d7eff' },
                transfer: { label: '传输中心', icon: 'el-icon-s-promotion', color: '#0ea5a4' },
                disk: { label: '磁盘', icon: 'el-icon-pie-chart', color: '#f59e0b' },
                taskmgr: { label: '任务管理器', icon: 'el-icon-cpu', color: '#0f6cbd' }
            };
            var out = [];
            for (var k in this.taskmgr.appHistory) {
                if (!Object.prototype.hasOwnProperty.call(this.taskmgr.appHistory, k) || !meta[k]) {
                    continue;
                }
                var e = this.taskmgr.appHistory[k];
                out.push({
                    type: k,
                    label: meta[k].label,
                    icon: meta[k].icon,
                    color: meta[k].color,
                    cpuSec: e.cpuSec || 0,
                    netBytes: e.netBytes || 0,
                    memPeak: e.memPeak || 0,
                    opens: e.opens || 0
                });
            }
            out.sort(function (a, b) {
                return a.label.localeCompare(b.label, 'zh-CN');
            });
            return out;
        },
        tmUserRows: function () {
            var self = this;
            var out = [];
            this.tabs.forEach(function (t) {
                if (t.connId == null) {
                    return;
                }
                var conn = null;
                for (var i = 0; i < self.connections.length; i++) {
                    if (self.connections[i].id === t.connId) {
                        conn = self.connections[i];
                        break;
                    }
                }
                var st = t.stats || null;
                out.push({
                    key: t.key,
                    user: (conn && conn.username) || '—',
                    host: (conn && conn.host) || t.host || '—',
                    session: t.title || '',
                    status: t.status === 'open' ? '正在运行' : self.statusText(t),
                    online: t.status === 'open',
                    current: t.key === self.desktop.tabKey,
                    cpu: st && !st.error ? st.cpu : null,
                    memPct: st && !st.error ? st.memPct : null
                });
            });
            out.sort(function (a, b) {
                return (b.current ? 1 : 0) - (a.current ? 1 : 0) || a.user.localeCompare(b.user);
            });
            return out;
        },
        tmServiceRows: function () {
            var t = this.desktopTab;
            var connected = !!(t && t.status === 'open');
            var st = this.tmStats;
            var monitoring = !!(st && !st.error);
            var monitorStatus = st && st.error ? '已停止' : (st ? '正在运行' : '等待中');
            var busy = this.transferActiveCount;
            var rows = [
                { pid: 776, name: '桌面外壳', icon: 'el-icon-monitor', desc: '提供桌面、任务栏、开始菜单与窗口管理', running: true, status: '正在运行', startType: '自动' },
                { pid: 1088, name: 'SSH 会话服务', icon: 'el-icon-connection', desc: connected ? '安全会话与终端通道已建立' : '等待 SSH 会话连接', running: connected, status: connected ? '正在运行' : '已停止', startType: '自动' },
                { pid: 2096, name: 'SFTP 文件服务', icon: 'el-icon-folder-opened', desc: '远程文件浏览、上传下载与在线编辑', running: true, status: '正在运行', startType: '自动' },
                { pid: 3184, name: '传输服务', icon: 'el-icon-s-promotion', desc: busy ? '正在处理 ' + busy + ' 个传输任务' : '文件传输队列空闲', running: true, status: busy ? '正在运行' : '空闲', startType: '手动' },
                { pid: 2760, name: 'AI 助手服务', icon: 'el-icon-magic-stick', desc: 'AI 对话、命令生成与自动执行', running: true, status: '正在运行', startType: '手动' },
                { pid: 3520, name: '监控采样服务', icon: 'el-icon-data-line', desc: monitoring ? '采集 CPU / 内存 / 网络指标' : (st && st.error ? st.error : '等待首次采样'), running: monitoring, status: monitorStatus, startType: '自动' }
            ];
            return rows;
        },
        tmDetailRows: function () {
            var rows = this.taskmgr.detail.rows.slice();
            var q = String(this.taskmgr.detail.filter || '').trim().toLowerCase();
            if (q) {
                rows = rows.filter(function (r) {
                    return (String(r.comm || '') + ' ' + String(r.user || '') + ' '
                        + String(r.pid || '') + ' ' + String(r.args || '')).toLowerCase().indexOf(q) >= 0;
                });
            }
            var by = this.taskmgr.detail.sortBy;
            var dir = this.taskmgr.detail.sortDir === 'asc' ? 1 : -1;
            var self = this;
            rows.sort(function (a, b) {
                if (by === 'pid') {
                    return (a.pid - b.pid) * dir;
                }
                if (by === 'user') {
                    return String(a.user || '').localeCompare(String(b.user || '')) * dir;
                }
                if (by === 'comm') {
                    return String(a.comm || '').localeCompare(String(b.comm || ''), 'zh-CN', { numeric: true }) * dir;
                }
                var va;
                var vb;
                if (by === 'mem') {
                    va = a.rssMb || 0;
                    vb = b.rssMb || 0;
                } else {
                    va = self.procCpuValue(a);
                    vb = self.procCpuValue(b);
                }
                return (va - vb) * dir;
            });
            return rows;
        },
        tmDetailSelected: function () {
            var pid = this.taskmgr.detail.selectedPid;
            if (!pid) {
                return null;
            }
            for (var i = 0; i < this.taskmgr.detail.rows.length; i++) {
                if (this.taskmgr.detail.rows[i].pid === pid) {
                    return this.taskmgr.detail.rows[i];
                }
            }
            return null;
        },
        tmChartHasData: function () {
            var key = this.tmHistoryKey(this.taskmgr.perfItem);
            return (this.taskmgr.history[key] || []).length > 0;
        },
        tmChartAreaPoints: function () {
            var key = this.tmHistoryKey(this.taskmgr.perfItem);
            var arr = this.taskmgr.history[key] || [];
            if (arr.length < 2) {
                return '';
            }
            var pts = this.tmChartPoints(key);
            return '0,40 ' + pts + ' ' + this.tmChartX(arr.length - 1, arr.length) + ',40';
        },
        tmChartMaxLabel: function () {
            if (this.taskmgr.perfItem === 'network') {
                return this.fmtRate(this.tmNetChartMax());
            }
            return '100%';
        },
        tmChartEmptyText: function () {
            if (!this.desktopTab || !this.desktopTab.sessionId) {
                return '会话未就绪，无法获取监控数据';
            }
            return this.tmStatsError ? ('监控不可用：' + this.tmStatsError) : '正在等待服务器监控数据…';
        },
        tmPerfTitle: function () {
            var map = { cpu: 'CPU', memory: '内存', disk: '磁盘', network: '网络' };
            return map[this.taskmgr.perfItem] || 'CPU';
        },
        tmPerfSubtitle: function () {
            var host = this.tmHostName;
            var map = {
                cpu: '服务器 ' + host + ' 的处理器实时使用率',
                memory: '服务器 ' + host + ' 的物理内存与交换分区',
                disk: '服务器 ' + host + ' 的根分区使用情况',
                network: '服务器 ' + host + ' 的网卡吞吐'
            };
            return map[this.taskmgr.perfItem] || '';
        },
        tmPerfBigValue: function () {
            var st = this.tmStats;
            if (this.taskmgr.perfItem === 'network') {
                if (!st || st.error) {
                    return '--';
                }
                return this.fmtRate((st.rxRate || 0) + (st.txRate || 0));
            }
            if (this.taskmgr.perfItem === 'disk') {
                var d = this.tmDiskInfo;
                return d && d.pct != null ? d.pct : '--';
            }
            if (this.taskmgr.perfItem === 'memory') {
                return st && st.memPct != null ? Math.round(st.memPct) : '--';
            }
            return st && st.cpu != null ? Math.round(st.cpu) : '--';
        },
        tmPerfUnit: function () {
            return this.taskmgr.perfItem === 'network' ? '' : '%';
        },
        tmCpuModel: function () {
            return this.tmSysValue('cpu', 'CPU 型号') || '—';
        },
        tmCpuCores: function () {
            return this.tmSysValue('cpu', '核心数') || '—';
        },
        tmCpuSpeed: function () {
            return this.tmSysValue('cpu', '主频') || '—';
        },
        tmLoad1: function () {
            var st = this.tmStats;
            return st && st.load1 ? st.load1 : '—';
        },
        tmServerUptime: function () {
            var st = this.tmStats;
            return st && st.uptimeSecs != null ? this.fmtUptime(st.uptimeSecs) : '—';
        },
        tmMemAvailable: function () {
            var st = this.tmStats;
            if (!st || st.memTotalMb == null || st.memUsedMb == null) {
                return '—';
            }
            return this.fmtMb(Math.max(0, st.memTotalMb - st.memUsedMb));
        },
        tmSwapUsed: function () {
            var st = this.tmStats;
            return st ? this.fmtMb(st.swapUsedMb) : '—';
        },
        tmSwapTotal: function () {
            var st = this.tmStats;
            return st && st.swapTotalMb ? this.fmtMb(st.swapTotalMb) : '未启用';
        },
        tmSwapPct: function () {
            var st = this.tmStats;
            return st && st.swapTotalMb ? (st.swapPct != null ? st.swapPct + '%' : '—') : '—';
        },
        tmDiskInfo: function () {
            var info = this.taskmgr.sysInfo;
            if (!info || !info.disk || !info.disk.length) {
                return null;
            }
            for (var i = 0; i < info.disk.length; i++) {
                if (info.disk[i].mount === '/') {
                    return info.disk[i];
                }
            }
            return info.disk[0];
        },
        tmDiskTotal: function () {
            var d = this.tmDiskInfo;
            return d ? this.fmtSize((d.sizeKb || 0) * 1024) : '—';
        },
        tmDiskUsed: function () {
            var d = this.tmDiskInfo;
            return d ? this.fmtSize((d.usedKb || 0) * 1024) : '—';
        },
        tmDiskFree: function () {
            var d = this.tmDiskInfo;
            return d ? this.fmtSize((d.availKb || 0) * 1024) : '—';
        },
        tmRxRate: function () {
            var st = this.tmStats;
            return st && !st.error ? st.rxRate : null;
        },
        tmTxRate: function () {
            var st = this.tmStats;
            return st && !st.error ? st.txRate : null;
        },
        tmNetAdapter: function () {
            var info = this.taskmgr.sysInfo;
            if (!info || !info.net || !info.net.length) {
                return '—';
            }
            return info.net.map(function (n) { return n.name; }).join(', ');
        },
        tmNetRxTotal: function () {
            return this.tmNetTotalBytes('rxBytes');
        },
        tmNetTxTotal: function () {
            return this.tmNetTotalBytes('txBytes');
        },
        tmSampleCaption: function () {
            var st = this.tmStats;
            if (this.taskmgr.perfItem === 'cpu' && st && st.load1) {
                return '负载 ' + st.load1;
            }
            return '实时采样';
        },
        transferActiveCount: function () {
            return this.transfers.filter(function (t) {
                return ['pending', 'uploading', 'processing', 'queued', 'scanning', 'downloading']
                    .indexOf(t.status) >= 0;
            }).length;
        },
        desktopTaskMenuWin: function () {
            return this.desktopWindowById(this.desktop.taskMenu.winId);
        },
        desktopIconItemMap: function () {
            var map = {};
            var self = this;
            this.desktopAppIcons.forEach(function (a) {
                if (!self.desktopAppBlocked(a.action)) {
                    map[a.key] = a;
                }
            });
            var dir = this.desktop.surface.dir;
            (this.desktop.surface.entries || []).forEach(function (e) {
                if (!self.desktop.showHidden && String(e.name).charAt(0) === '.') {
                    return;
                }
                var path = self.pathJoin(dir, e.name);
                var isShortcut = !e.dir && /\.lnk$/i.test(e.name);
                var sc = isShortcut ? e._shortcut : null;
                var targetName = isShortcut
                    ? ((sc && sc.label) ? sc.label : e.name.slice(0, -4))
                    : e.name;
                var targetType = isShortcut
                    ? ((sc && sc.targetType) === 'folder' ? 'folder' : 'file')
                    : (e.dir ? 'folder' : 'file');
                var isFolderVisual = targetType === 'folder';
                var targetRow = { name: targetName, dir: isFolderVisual };
                var kind = isFolderVisual ? 'folder' : self.desktopFileKind(targetRow);
                var ext = isFolderVisual ? '' : self.desktopExtLabel(targetRow);
                var thumbPath = '';
                if (!isFolderVisual && self.isDesktopImage(targetRow)) {
                    thumbPath = isShortcut && sc ? sc.target : path;
                }
                map['file:' + path] = {
                    key: 'file:' + path,
                    type: isShortcut ? 'shortcut' : (isFolderVisual ? 'folder' : 'file'),
                    label: targetName,
                    entry: e,
                    path: path,
                    dir: isFolderVisual,
                    targetType: targetType,
                    isFolderVisual: isFolderVisual,
                    kind: kind,
                    ext: ext,
                    thumbPath: thumbPath,
                    thumb: e._thumb || ''
                };
            });
            return map;
        },
        desktopIconItems: function () {
            var map = this.desktopIconItemMap;
            var out = [];
            for (var i = 0; i < this.desktop.iconOrder.length; i++) {
                var item = map[this.desktop.iconOrder[i]];
                if (item) {
                    out.push(item);
                }
            }
            return out;
        },
        desktopMenuSelectionCount: function () {
            var d = this.desktopMenuContextWin();
            return d && d.selected ? d.selected.length : 0;
        },
        canPasteDesktop: function () {
            var t = this.desktopTab;
            var c = this.desktopClipboard;
            return !!(t && c && c.connId === t.connId
                && c.paths && c.paths.length);
        },
        desktopIconMenuTitle: function () {
            var key = this.desktop.iconMenu.key;
            for (var i = 0; i < this.desktopAppIcons.length; i++) {
                if (this.desktopAppIcons[i].key === key) {
                    return this.desktopAppIcons[i].label;
                }
            }
            return '桌面图标';
        },
        /* ---------- 网络工具箱：实时程序流量 ---------- */
        netTrafficSystem: function () {
            var d = this.netTool.traffic.data;
            return d && d.system ? d.system : {};
        },
        netTrafficUnattributed: function () {
            var d = this.netTool.traffic.data;
            var u = d && d.unattributed ? d.unattributed : {};
            return {
                rxRate: Number(u.rxRate) || 0,
                txRate: Number(u.txRate) || 0
            };
        },
        netTrafficRows: function () {
            var t = this.netTool.traffic;
            var d = t.data;
            if (!d || !Array.isArray(d.programs)) {
                return [];
            }
            var include = !!t.includeLoopback;
            var q = String(t.keyword || '').trim().toLowerCase();
            var rows = [];
            for (var i = 0; i < d.programs.length; i++) {
                var r = d.programs[i] || {};
                if (!include && !(r.extConns > 0)) {
                    continue;
                }
                if (q) {
                    var text = ((r.name || '') + ' ' + r.pid + ' ' + (r.user || '')).toLowerCase();
                    if (text.indexOf(q) < 0) {
                        continue;
                    }
                }
                var rx = Number(include ? r.rxRate : r.extRxRate) || 0;
                var tx = Number(include ? r.txRate : r.extTxRate) || 0;
                var totalRx = Number(include ? r.rxTotal : r.extRxTotal) || 0;
                var totalTx = Number(include ? r.txTotal : r.extTxTotal) || 0;
                rows.push({
                    pid: r.pid,
                    name: r.name || '',
                    user: r.user || '',
                    rx: rx,
                    tx: tx,
                    rate: rx + tx,
                    totalRx: totalRx,
                    totalTx: totalTx,
                    total: totalRx + totalTx,
                    conns: Number(include ? r.conns : r.extConns) || 0,
                    extConns: Number(r.extConns) || 0,
                    loopbackConns: Number(r.loopbackConns) || 0
                });
            }
            var by = t.sortBy || 'rate';
            var dir = t.sortDir === 'asc' ? 1 : -1;
            rows.sort(function (a, b) {
                if (by === 'name') {
                    var an = String(a.name).toLowerCase();
                    var bn = String(b.name).toLowerCase();
                    if (an === bn) {
                        return a.pid - b.pid;
                    }
                    return an < bn ? -dir : dir;
                }
                var va = Number(a[by]) || 0;
                var vb = Number(b[by]) || 0;
                if (va === vb) {
                    return a.rate === b.rate ? a.pid - b.pid : b.rate - a.rate;
                }
                return (va - vb) * dir;
            });
            return rows;
        },
        netTrafficTopPid: function () {
            var rows = this.netTrafficRows;
            var top = 0;
            var max = 0;
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].rate > max) {
                    max = rows[i].rate;
                    top = rows[i].pid;
                }
            }
            return max > 0 ? top : 0;
        },
        netTrafficMaxDown: function () {
            var max = 0;
            var rows = this.netTrafficRows;
            for (var i = 0; i < rows.length; i++) {
                max = Math.max(max, rows[i].rx);
            }
            return max;
        },
        netTrafficMaxUp: function () {
            var max = 0;
            var rows = this.netTrafficRows;
            for (var i = 0; i < rows.length; i++) {
                max = Math.max(max, rows[i].tx);
            }
            return max;
        },
        netPortsRows: function () {
            var d = this.netTool.ports.data;
            var rows = d && Array.isArray(d.ports) ? d.ports : [];
            var q = String(this.netTool.ports.keyword || '').trim().toLowerCase();
            var exposedOnly = !!this.netTool.ports.exposedOnly;
            var out = [];
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i] || {};
                if (exposedOnly && r.scope !== 'all') {
                    continue;
                }
                if (q) {
                    var text = ((r.protocol || '') + ' ' + (r.address || '') + ' ' + r.port + ' '
                        + (r.process || '') + ' ' + (r.pid || '')).toLowerCase();
                    if (text.indexOf(q) < 0) {
                        continue;
                    }
                }
                out.push(r);
            }
            return out;
        },
        netPortsStats: function () {
            var d = this.netTool.ports.data;
            var rows = d && Array.isArray(d.ports) ? d.ports : [];
            var stats = { total: rows.length, exposed: 0, local: 0, bound: 0, tcp: 0, udp: 0, hidden: 0 };
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i] || {};
                if (r.scope === 'all') {
                    stats.exposed++;
                } else if (r.scope === 'local') {
                    stats.local++;
                } else {
                    stats.bound++;
                }
                if (r.protocol === 'tcp') {
                    stats.tcp++;
                } else if (r.protocol === 'udp') {
                    stats.udp++;
                }
                if (!r.pid) {
                    stats.hidden++;
                }
            }
            return stats;
        },
        netFirewallView: function () {
            var d = this.netTool.ports.data;
            var fw = d && d.firewall ? d.firewall : {};
            var active = fw.active;
            return {
                type: fw.type || 'none',
                typeLabel: fw.typeLabel || '未检测到',
                active: active,
                stateText: fw.stateText || '状态未知',
                stateClass: active === true ? 'on' : (active === false ? 'off' : 'unknown'),
                rules: Array.isArray(fw.rules) ? fw.rules : [],
                raw: fw.raw || '',
                hint: fw.hint || '',
                restricted: !!fw.restricted
            };
        },
        netPortsRootText: function () {
            var r = this.netTool.root;
            if (r.loading) {
                return '授权中…';
            }
            return this.netTool.rootEnabled ? 'root 读取中' : '以 root 读取';
        },
        netPortsRootTitle: function () {
            var r = this.netTool.root;
            if (r.isRoot) {
                return '当前 SSH 登录用户是 ' + (r.user || 'root') + '，可读取全部端口和防火墙规则';
            }
            if (this.netTool.rootEnabled) {
                return '正在通过 sudo 以 root 读取；点击恢复为当前用户';
            }
            if (r.passwordless) {
                return '当前用户可免密 sudo，点击直接以 root 读取';
            }
            return '输入 sudo 密码后以 root 读取完整进程名和防火墙规则；密码仅保存在服务内存 30 分钟';
        },
        netToolTrafficIntervalText: function () {
            var ms = Number(this.netTool.traffic.intervalMs) || 2000;
            return (ms / 1000) + ' 秒';
        },
        netTrafficRootText: function () {
            var r = this.netTool.root;
            if (r.loading) {
                return '授权中…';
            }
            return this.netTool.rootEnabled ? 'root 采样中' : '以 root 采样';
        },
        netTrafficRootTitle: function () {
            var r = this.netTool.root;
            if (r.isRoot) {
                return '当前 SSH 登录用户是 ' + (r.user || 'root') + '，可读取全部进程';
            }
            if (this.netTool.rootEnabled) {
                return '正在通过 sudo 以 root 读取全部进程；点击恢复为当前用户';
            }
            if (r.passwordless) {
                return '当前用户可免密 sudo，点击直接以 root 采样';
            }
            return '输入 sudo 密码后以 root 采样，可查看全部进程；密码仅保存在服务内存 30 分钟';
        },
        netTrafficIfaceText: function () {
            var list = this.netTrafficSystem.interfaces;
            if (!Array.isArray(list) || !list.length) {
                return '—';
            }
            var parts = [];
            for (var i = 0; i < list.length; i++) {
                var it = list[i] || {};
                parts.push(it.name + (it.speedMbps ? ' ' + it.speedMbps + ' Mbps' : ''));
            }
            return parts.join(' / ');
        },
        desktopTab: function () {
            if (this.desktop.local) {
                return this.localDesktopTab;
            }
            var self = this;
            return this.tabs.find(function (t) { return t.key === self.desktop.tabKey; }, this)
                || this.activeTab || null;
        },
        desktopIsLocal: function () {
            return !!(this.desktop.visible && this.desktop.local);
        },
        desktopConnDown: function () {
            var t = this.desktopTab;
            return !!t && (t.status === 'closed' || t.status === 'error');
        },
        desktopBgSettings: function () {
            var t = this.desktopTab;
            return (t && t.desktopBg) || { url: '', opacity: 0.35, blur: 0 };
        },
        desktopAppearanceTheme: function () {
            return desktopThemeById(this.desktopAppearance.theme);
        },
        desktopAppearanceScheme: function () {
            return desktopColorIsDark(this.desktopAppearance.windowColor) ? 'dark' : 'light';
        },
        desktopAppearanceCustomized: function () {
            var app = this.desktopAppearance;
            var t = this.desktopAppearanceTheme;
            return String(app.accentColor || t.accent).toLowerCase() !== t.accent
                || String(app.windowColor).toLowerCase() !== t.windowColor
                || Number(app.windowTransparency) !== Number(t.windowTransparency)
                || !!app.windowTextColor
                || !!app.windowBorderColor
                || String(app.taskbarColor).toLowerCase() !== t.taskbarColor
                || Number(app.taskbarTransparency) !== Number(t.taskbarTransparency)
                || !!app.taskbarIconColor
                || !!app.desktopIconTextColor;
        },
        desktopEffectiveAccentColor: function () {
            return this.desktopAppearance.accentColor || this.desktopAppearanceTheme.accent;
        },
        desktopAutoWindowTextColor: function () {
            return desktopColorIsDark(this.desktopAppearance.windowColor) ? '#e9f0fa' : '#253142';
        },
        desktopAutoWindowBorderColor: function () {
            return desktopColorIsDark(this.desktopAppearance.windowColor)
                ? 'rgba(148, 180, 224, .30)' : 'rgba(112, 152, 210, .50)';
        },
        desktopAutoTaskbarIconColor: function () {
            return desktopColorIsDark(this.desktopAppearance.taskbarColor) ? '#e7eefb' : '#26313f';
        },
        desktopAutoDesktopIconTextColor: function () {
            return this.desktopAppearanceTheme.iconFg;
        },
        desktopActiveCustomAppearance: function () {
            var app = desktopAppearanceSnapshot(this.desktopAppearance);
            var list = this.desktopCustomAppearances || [];
            for (var i = 0; i < list.length; i++) {
                if (JSON.stringify(app) === JSON.stringify(list[i].appearance)) {
                    return list[i];
                }
            }
            return null;
        },
        desktopBatchRenamePreview: function () {
            var form = this.desktopBatchRename;
            var self = this;
            var list = (form.rows || []).map(function (row, index) {
                return self.desktopBatchRenameRow(row, index, form);
            });
            return this.desktopValidateBatchRename(list, form);
        },
        desktopBatchRenameErrorCount: function () {
            return this.desktopBatchRenamePreview.filter(function (r) {
                return !!r.error;
            }).length;
        },
        desktopBatchRenameChangedCount: function () {
            return this.desktopBatchRenamePreview.filter(function (r) {
                return !!r.changed && !r.error;
            }).length;
        },
        desktopThemeStyle: function () {
            var app = this.desktopAppearance || desktopDefaultAppearance();
            var theme = this.desktopAppearanceTheme;
            var winDark = desktopColorIsDark(app.windowColor);
            var taskDark = desktopColorIsDark(app.taskbarColor);
            var winAlpha = 1 - desktopClampNumber(app.windowTransparency, 0, 70, 6) / 100;
            var taskAlpha = 1 - desktopClampNumber(app.taskbarTransparency, 0, 70, 8) / 100;
            var panelAlpha = Math.max(winAlpha, 0.94);
            var accent = app.accentColor || theme.accent;
            var autoFg = winDark ? '#e9f0fa' : '#253142';
            var fg = app.windowTextColor || autoFg;
            var fgDim = desktopRgba(fg, winDark ? .64 : .60);
            var line = winDark ? 'rgba(255, 255, 255, .11)' : 'rgba(18, 34, 61, .12)';
            var subtle = winDark ? 'rgba(255, 255, 255, .045)' : 'rgba(18, 34, 61, .035)';
            var hover = winDark ? 'rgba(255, 255, 255, .075)' : 'rgba(47, 111, 214, .075)';
            var taskFg = taskDark ? '#e7eefb' : '#26313f';
            var taskFgDim = taskDark ? 'rgba(226, 236, 250, .62)' : 'rgba(38, 49, 63, .58)';
            var taskIcon = app.taskbarIconColor || taskFg;
            var autoBorder = winDark ? 'rgba(148, 180, 224, .30)' : 'rgba(112, 152, 210, .50)';
            var winBorder = app.windowBorderColor || autoBorder;
            var m = desktopIconMetrics(app.iconSize);
            return {
                '--dsk-wallpaper': theme.wallpaper,
                '--dsk-grid-line': theme.gridLine,
                '--dsk-desktop-fg': app.desktopIconTextColor || theme.iconFg,
                '--dsk-desktop-fg-shadow': theme.iconShadow,
                '--dsk-accent': accent,
                '--dsk-accent-soft': desktopRgba(accent, winDark ? .20 : .12),
                '--dsk-win-bg': desktopRgba(app.windowColor, winAlpha),
                '--dsk-win-border': winBorder,
                '--dsk-win-border-active': app.windowBorderColor || accent,
                '--dsk-win-fg': fg,
                '--dsk-win-fg-dim': fgDim,
                '--dsk-win-line': line,
                '--dsk-win-subtle': subtle,
                '--dsk-win-hover': hover,
                '--dsk-win-selected': desktopRgba(accent, winDark ? .30 : .16),
                '--dsk-win-title-bg': winDark ? 'rgba(255, 255, 255, .055)' : 'rgba(15, 32, 58, .045)',
                '--dsk-win-btn-fg': winDark ? 'rgba(232, 240, 251, .76)' : '#3d4e66',
                '--dsk-win-btn-hover': winDark ? 'rgba(255, 255, 255, .10)' : 'rgba(15, 32, 58, .08)',
                '--dsk-win-shadow': winDark
                    ? '0 18px 46px rgba(0, 0, 0, .50), 0 2px 8px rgba(0, 0, 0, .35)'
                    : '0 18px 46px rgba(15, 30, 55, .28), 0 2px 8px rgba(15, 30, 55, .10)',
                '--dsk-panel-bg': desktopRgba(app.windowColor, panelAlpha),
                '--dsk-panel-fg': fg,
                '--dsk-panel-fg-dim': fgDim,
                '--dsk-panel-line': line,
                '--dsk-panel-subtle': subtle,
                '--dsk-panel-hover': hover,
                '--dsk-panel-head-1': desktopShadeHex(accent, -0.56),
                '--dsk-panel-head-2': desktopShadeHex(accent, -0.74),
                '--dsk-panel-accent': accent,
                '--dsk-panel-shadow': winDark
                    ? '0 18px 48px rgba(0, 0, 0, .55)'
                    : '0 18px 48px rgba(15, 30, 55, .24)',
                '--dsk-card-bg': winDark ? 'rgba(255, 255, 255, .04)' : 'rgba(255, 255, 255, .55)',
                '--dsk-field-bg': winDark ? 'rgba(255, 255, 255, .06)' : 'rgba(255, 255, 255, .72)',
                '--dsk-taskbar-bg': desktopRgba(app.taskbarColor, taskAlpha),
                '--dsk-taskbar-border': taskDark ? 'rgba(0, 0, 0, .45)' : 'rgba(15, 32, 58, .10)',
                '--dsk-taskbar-fg': taskFg,
                '--dsk-taskbar-fg-dim': taskFgDim,
                '--dsk-taskbar-icon': taskIcon,
                '--dsk-taskbar-logo': app.taskbarIconColor || accent,
                '--dsk-taskbar-hover': taskDark ? 'rgba(255, 255, 255, .09)' : 'rgba(15, 32, 58, .07)',
                '--dsk-taskbar-active': taskDark ? 'rgba(255, 255, 255, .14)' : 'rgba(15, 32, 58, .11)',
                '--dsk-taskbar-line': taskDark ? 'rgba(255, 255, 255, .12)' : 'rgba(15, 32, 58, .12)',
                '--dsk-icon-cell-w': m.cellW + 'px',
                '--dsk-icon-cell-h': m.cellH + 'px',
                '--dsk-icon-box-w': m.boxW + 'px',
                '--dsk-icon-box-h': m.boxH + 'px',
                '--dsk-icon-gap': m.gap + 'px',
                '--dsk-icon-app': m.app + 'px',
                '--dsk-icon-app-font': m.appFont + 'px',
                '--dsk-icon-radius': m.appRadius + 'px',
                '--dsk-icon-folder-w': m.folderW + 'px',
                '--dsk-icon-folder-h': m.folderH + 'px',
                '--dsk-icon-file-w': m.fileW + 'px',
                '--dsk-icon-file-h': m.fileH + 'px',
                '--dsk-icon-file-font': m.fileFont + 'px',
                '--dsk-icon-thumb': m.thumb + 'px',
                '--dsk-icon-name-font': m.nameFont + 'px',
                '--dsk-icon-name-line': m.nameLine,
                '--dsk-icon-name-max-h': m.nameMaxH + 'px',
                '--dsk-icon-pad-x': m.padX + 'px',
                '--dsk-icon-pad-y': m.padY + 'px'
            };
        },
        desktopAppStyleConnId: function () {
            var t = this.desktopTab;
            return t && t.connId != null ? String(t.connId) : '';
        },
        desktopAppPropsApp: function () {
            var key = this.desktopAppProps.key;
            for (var i = 0; i < this.desktopAppIcons.length; i++) {
                if (this.desktopAppIcons[i].key === key) {
                    return this.desktopAppIcons[i];
                }
            }
            return null;
        },
        desktopAppPropsIcons: function () {
            var q = String(this.desktopAppProps.iconSearch || '').trim().toLowerCase();
            if (!q) {
                return this.desktopAppIconChoices;
            }
            return this.desktopAppIconChoices.filter(function (ic) {
                return ic.toLowerCase().indexOf(q) >= 0;
            });
        },
        desktopAppReleaseTime: function () {
            return (this.appInfo && this.appInfo.buildTime) || DESKTOP_APP_RELEASE_FALLBACK;
        },
        desktopAppVersion: function () {
            return (this.appInfo && this.appInfo.version) || '1.6.1';
        },
        desktopCommonDirs: function () {
            var t = this.desktopTab;
            if (!t || t.connId == null) {
                return [];
            }
            return this.commonDirsByConn[t.connId] || [];
        },
        desktopAiDir: function () {
            var t = this.desktopTab;
            if (!t) {
                return '';
            }
            var conv = this.aiActiveConv(t);
            return (conv && conv.cwd) || '';
        },
        desktopHomeDir: function () {
            var t = this.desktopTab;
            return t && t.sftpHome ? t.sftpHome : '';
        },
        desktopTrashPath: function () {
            var home = this.desktopHomeDir;
            if (!home) {
                return '.local/share/Trash';
            }
            return String(home).replace(/\/+$/, '') + '/.local/share/Trash';
        },
        desktopQuickDirs: function () {
            return [
                { label: 'home', path: '/home' },
                { label: 'tmp', path: '/tmp' },
                { label: '日志', path: '/var/log' },
                { label: '配置', path: '/etc' },
                { label: '应用', path: '/opt' }
            ];
        },
        desktopShownEntries: function () {
            return this.deskShownEntries(this.desk);
        },
        desktopMenuMulti: function () {
            var d = this.desktopMenuContextWin();
            return d && d.selected ? d.selected.length > 1 : false;
        },
        desktopMenuHasFile: function () {
            return this.desktopSelectedRows(this.desktopMenuContextWin())
                .some(function (r) { return !r.dir; });
        },
        desktopMenuCanExtract: function () {
            var t = this.desktop.menu.target;
            return !!t && !this.desktopMenuMulti && !t.dir
                && !!this.desktopArchiveFormat(t.name);
        },
        desktopMenuExtractName: function () {
            var t = this.desktop.menu.target;
            return t ? t.name : '';
        },
        desktopMenuExtractFolder: function () {
            return this.desktopArchiveBase(this.desktopMenuExtractName);
        },
        archiveNameExists: function () {
            var name = (this.archiveForm.name || '').trim();
            if (!name) {
                return false;
            }
            var d = this.desktop.archiveWin || this.desk;
            return (d.entries || []).some(function (r) {
                return r.name === name;
            });
        },
        desktopMenuTitle: function () {
            var d = this.desktopMenuContextWin();
            if (this.desktopMenuMulti) {
                return '已选择 ' + (d.selected ? d.selected.length : 0) + ' 项';
            }
            var r = this.desktop.menu.target;
            return r ? (r.dir ? '文件夹 · ' + r.name : '文件 · ' + r.name) : '当前目录';
        },
        desktopStartQuery: function () {
            return (this.desktop.startSearch || '').trim();
        },
        desktopStartPluginApps: function () {
            return (this.desktopPlugins || []).map(function (p) {
                return {
                    id: 'plugin:' + p.id,
                    label: p.name,
                    iconUrl: p.iconUrl || '',
                    color: '#eef3fb',
                    plugin: p,
                    desc: p.description || ''
                };
            });
        },
        builtinAvailablePlugins: function () {
            return (this.builtinPlugins || []).filter(function (p) {
                return !p.installed || p.updateAvailable;
            });
        },
        desktopStartAppsView: function () {
            var self = this;
            return this.desktopStartApps.filter(function (a) {
                return !self.desktopAppBlocked(a.id);
            });
        },
        desktopStartAppMatches: function () {
            var q = this.desktopStartQuery.toLowerCase();
            if (!q) {
                return [];
            }
            return this.desktopStartAppsView.concat(this.desktopStartPluginApps).filter(function (a) {
                var text = [a.label, a.id,
                    a.plugin ? a.plugin.description : '',
                    a.plugin ? a.plugin.author : ''].join(' ').toLowerCase();
                return text.indexOf(q) >= 0;
            });
        },
        desktopStartConnMatches: function () {
            var q = this.desktopStartQuery.toLowerCase();
            if (!q) {
                return [];
            }
            return (this.connections || []).filter(function (c) {
                var text = [c.name, c.host, c.username, c.note].join(' ').toLowerCase();
                return text.indexOf(q) >= 0;
            }).slice(0, 6);
        },
        desktopStartActionMatches: function () {
            var q = this.desktopStartQuery.toLowerCase();
            if (!q) {
                return [];
            }
            var self = this;
            return this.desktopStartActions.filter(function (a) {
                return !self.desktopAppBlocked(a.id)
                    && (a.label + ' ' + a.desc + ' ' + a.id).toLowerCase().indexOf(q) >= 0;
            }).slice(0, 6);
        },
        desktopStartEntryMatches: function () {
            var q = this.desktopStartQuery.toLowerCase();
            if (!q) {
                return [];
            }
            var showHidden = this.desktop.showHidden;
            return (this.desk.entries || []).filter(function (r) {
                if (!showHidden && String(r.name).charAt(0) === '.') {
                    return false;
                }
                return String(r.name).toLowerCase().indexOf(q) >= 0;
            }).slice(0, 8);
        },
        desktopStartPlaces: function () {
            if (this.desktop.local) {
                return [{ label: '本地桌面', path: '/', icon: 'el-icon-monitor' }];
            }
            var out = [];
            var seen = {};
            var add = function (label, path, icon) {
                if (!path || seen[path]) {
                    return;
                }
                seen[path] = true;
                out.push({ label: label, path: path, icon: icon });
            };
            add('AI 当前目录', this.desktopAiDir, 'el-icon-cpu');
            add('主目录', this.desktopHomeDir, 'el-icon-user');
            add('根目录', '/', 'el-icon-office-building');
            (this.desktopCommonDirs || []).forEach(function (d) {
                add(d.path, d.path, 'el-icon-star-off');
            });
            return out.slice(0, 8);
        },
        desktopClockTime: function () {
            var d = new Date(this.desktop.clockNow);
            var p = function (x) { return (x < 10 ? '0' : '') + x; };
            var h = d.getHours();
            var sec = this.desktop.clockSeconds ? ':' + p(d.getSeconds()) : '';
            if (this.desktop.clock24h) {
                return p(h) + ':' + p(d.getMinutes()) + sec;
            }
            var ap = h < 12 ? '上午' : '下午';
            var h12 = h % 12 || 12;
            return h12 + ':' + p(d.getMinutes()) + sec + ' ' + ap;
        },
        desktopClockDate: function () {
            var d = new Date(this.desktop.clockNow);
            return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
        },
        desktopClockFull: function () {
            var d = new Date(this.desktop.clockNow);
            var p = function (x) { return (x < 10 ? '0' : '') + x; };
            return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 '
                + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
        },
        desktopClockTimezone: function () {
            try {
                return Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时区';
            } catch (e) {
                return '本地时区';
            }
        },
        desktopClockOffset: function () {
            var off = -new Date(this.desktop.clockNow).getTimezoneOffset();
            var sign = off >= 0 ? '+' : '-';
            var abs = Math.abs(off);
            var p = function (x) { return (x < 10 ? '0' : '') + x; };
            return 'UTC' + sign + Math.floor(abs / 60) + ':' + p(abs % 60);
        },
        desktopCalendarTitle: function () {
            return this.desktop.calendarYear + '年' + (this.desktop.calendarMonth + 1) + '月';
        },
        desktopCalendarWeekdays: function () {
            return ['日', '一', '二', '三', '四', '五', '六'];
        },
        desktopCalendarSelectedDate: function () {
            var key = this.desktop.calendarSelected || this.desktopDateKey(new Date(this.desktop.clockNow));
            return this.parseDesktopDateKey(key);
        },
        desktopCalendarHeading: function () {
            var d = this.desktopCalendarSelectedDate;
            var wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + wd[d.getDay()];
        },
        desktopCalendarCells: function () {
            var y = this.desktop.calendarYear;
            var m = this.desktop.calendarMonth;
            var now = new Date(this.desktop.clockNow);
            var todayKey = this.desktopDateKey(now);
            var selectedKey = this.desktop.calendarSelected || todayKey;
            var first = new Date(y, m, 1);
            var start = new Date(y, m, 1 - first.getDay());
            var cells = [];
            for (var i = 0; i < 42; i++) {
                var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
                var key = this.desktopDateKey(d);
                cells.push({
                    key: key,
                    day: d.getDate(),
                    inMonth: d.getFullYear() === y && d.getMonth() === m,
                    isToday: key === todayKey,
                    isSelected: key === selectedKey
                });
            }
            return cells;
        },
        filteredProcRows: function () {
            var t = this.activeTab;
            if (!t || !t.procList) {
                return [];
            }
            var k = (t.procKeyword || '').trim().toLowerCase();
            if (!k) {
                return t.procList;
            }
            return t.procList.filter(function (p) {
                return (p.comm + ' ' + p.user + ' ' + p.pid + ' ' + (p.args || '')).toLowerCase().indexOf(k) >= 0;
            });
        },
        /* AI 终端的对话列表（最近使用的在前） */
        chatConvList: function () {
            var t = this.activeTab;
            if (!t || !t.chatConvs) {
                return [];
            }
            return t.chatConvs.slice().sort(function (a, b) {
                var pa = a.pinned ? 1 : 0;
                var pb = b.pinned ? 1 : 0;
                if (pa !== pb) {
                    return pb - pa;
                }
                return (b.updatedAt || 0) - (a.updatedAt || 0);
            });
        },
        /* 「打开连接」弹窗的树形列表：置顶区 + 文件夹层级 + 根级连接 */
        connRows: function () {
            var self = this;
            var k = this.connKeyword.trim().toLowerCase();
            var match = function (c) {
                if (!k) {
                    return true;
                }
                return (c.name + ' ' + c.host + ' ' + c.username + ' ' + (c.remark || '')).toLowerCase().indexOf(k) >= 0;
            };
            if (this.connFilter === 'fav') {
                return this.connections.filter(function (c) {
                    return c.favorite && match(c);
                }).sort(sortConns).map(function (c) {
                    return self.connRow(c, 0, 'f');
                });
            }
            // 最近连接（最多 5 条，按打开时间倒序；条目不可拖动）
            var recentRows = [];
            var recent = this.connections.filter(function (c) {
                return c.lastUsedAt && match(c);
            }).sort(function (a, b) {
                return b.lastUsedAt - a.lastUsedAt;
            }).slice(0, 5);
            if (recent.length) {
                recentRows.push({ _rowType: 'section', key: 'sec-recent', label: '最近连接', icon: 'el-icon-time' });
                recent.forEach(function (c) {
                    recentRows.push(self.connRow(c, 0, 'r', true));
                });
            }
            var rows = [];
            // 置顶（提升到顶部，条目不可拖动）
            var pinnedRows = [];
            var pinned = this.connections.filter(function (c) {
                return c.pinned && match(c);
            }).sort(sortConns);
            if (pinned.length) {
                pinnedRows.push({ _rowType: 'section', key: 'sec-pinned', label: '置顶', icon: 'el-icon-top' });
                pinned.forEach(function (c) {
                    pinnedRows.push(self.connRow(c, 0, 'p', true));
                });
            }
            var build = function (parentId, depth, forceAll) {
                var out = [];
                self.folders.filter(function (f) {
                    return (f.parentId == null ? null : f.parentId) === parentId;
                }).sort(sortFolders).forEach(function (f) {
                    var hit = !!k && f.name.toLowerCase().indexOf(k) >= 0;
                    var deep = forceAll || hit;
                    var children = [];
                    // 搜索时忽略折叠状态，自动展开命中项所在层级
                    if (k || self.connExpanded[f.id]) {
                        children = build(f.id, depth + 1, deep);
                        var conns = self.connections.filter(function (c) {
                            return !c.pinned && c.folderId === f.id;
                        }).sort(sortConns);
                        if (k && !deep) {
                            conns = conns.filter(match);
                        }
                        conns.forEach(function (c) {
                            children.push(self.connRow(c, depth + 1));
                        });
                    }
                    if (k && !deep && children.length === 0) {
                        return;
                    }
                    out.push({
                        _rowType: 'folder', key: 'f-' + f.id, id: f.id, name: f.name,
                        _count: self.folderConnCount(f.id), depth: depth
                    });
                    children.forEach(function (ch) {
                        out.push(ch);
                    });
                });
                return out;
            };
            rows = rows.concat(build(null, 0, false));
            var rootConns = this.connections.filter(function (c) {
                return !c.pinned && !c.folderId;
            }).sort(sortConns);
            if (k) {
                rootConns = rootConns.filter(match);
            }
            rootConns.forEach(function (c) {
                rows.push(self.connRow(c, 0));
            });
            // 组装：最近连接 ── 置顶 ── 服务器列表（各区间以分隔线隔开，下方为空时不加）
            var result = recentRows.slice();
            if (result.length && (pinnedRows.length || rows.length)) {
                result.push({ _rowType: 'sep', key: 'sep-recent' });
            }
            result = result.concat(pinnedRows);
            if (pinnedRows.length && rows.length) {
                result.push({ _rowType: 'sep', key: 'sep-pinned' });
            }
            return result.concat(rows);
        }
    },
    methods: {
        /* ---------- 标签与会话 ---------- */
        openTab: function (connId, clientKey, autoAfterConnect, forceDesktop) {
            var self = this;
            if (!this._creatingSplitTab && this.splitKeys.length) {
                this.clearTerminalSplit();
            }
            // 只有本次启动的首个连接才按设置自动进入桌面；强制桌面（新标签打开）不受此限制
            var firstConnect = consumeFirstConnect();
            var conn = this.connections.find(function (c) { return c.id === connId; });
            var tab = createTerminalState(connId, conn, clientKey);
            tab.autoOpenDesktop = !!autoAfterConnect
                && (!!forceDesktop || (firstConnect && this.openAfterConnect === 'desktop'));
            this.tabs.push(tab);
            this.activeKey = tab.key;
            this.connectDialogVisible = false;
            saveOpenTabs(this);
            if (conn) {
                // 记录最近打开时间（本地即时生效，服务端异步持久化）
                conn.lastUsedAt = Date.now();
                http.post('/api/connections/' + connId + '/touch').catch(function () { /* 忽略 */ });
            }
            this.$nextTick(function () {
                self.initTerminal(tab);
                self.loadAiConvs(tab);
            });
            return tab;
        },
        loadConnections: function () {
            var self = this;
            return http.get('/api/connections').then(function (d) {
                self.connections = d || [];
            });
        },
        loadFolders: function () {
            var self = this;
            return http.get('/api/folders').then(function (d) {
                self.folders = d || [];
            });
        },
        openConnectDialog: function () {
            this.loadConnections();
            this.loadFolders();
            this.connectDialogVisible = true;
        },
        /* ---------- 文件夹 / 置顶 / 收藏 ---------- */
        connRow: function (c, depth, prefix, noDrag) {
            return {
                _rowType: 'conn', key: (prefix || 'c') + '-' + c.id, id: c.id, name: c.name,
                host: c.host, port: c.port, username: c.username, folderId: c.folderId,
                favorite: !!c.favorite, pinned: !!c.pinned, depth: depth, noDrag: !!noDrag
            };
        },
        folderConnCount: function (folderId) {
            var self = this;
            var n = this.connections.filter(function (c) {
                return c.folderId === folderId;
            }).length;
            this.folders.forEach(function (f) {
                if ((f.parentId == null ? null : f.parentId) === folderId) {
                    n += self.folderConnCount(f.id);
                }
            });
            return n;
        },
        toggleFolder: function (id) {
            this.$set(this.connExpanded, id, !this.connExpanded[id]);
        },
        expandAllFolders: function (v) {
            var m = {};
            this.folders.forEach(function (f) {
                m[f.id] = v;
            });
            this.connExpanded = m;
        },
        setConnFlag: function (id, field, val) {
            var self = this;
            var body = {};
            body[field] = val;
            http.post('/api/connections/' + id + '/flags', body).then(function () {
                var c = self.connections.find(function (x) {
                    return x.id === id;
                });
                if (c) {
                    c[field] = val;
                }
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        newFolderQuick: function (parentId) {
            var self = this;
            this.$prompt('请输入文件夹名称', '新建文件夹', {
                inputPattern: /\S+/, inputErrorMessage: '名称不能为空'
            }).then(function (r) {
                return http.post('/api/folders', { name: r.value.trim(), parentId: parentId });
            }).then(function () {
                ELEMENT.Message.success('已创建');
                self.loadFolders();
            }).catch(function () {
            });
        },
        editConnFromDialog: function (id) {
            var c = this.connections.find(function (x) { return x.id === id; });
            if (!c) {
                ELEMENT.Message.warning('连接不存在或已被删除');
                return;
            }
            if (this.$refs.connForm) {
                this.$refs.connForm.open(c);
            }
        },
        /* 右键连接行 = 左键点击齿轮，展开同一设置菜单 */
        openConnMenu: function (row) {
            this.connMenuKey = this.connMenuKey === row.key ? null : row.key;
        },
        setConnMenuOpen: function (key, visible) {
            if (visible) {
                this.connMenuKey = key;
            } else if (this.connMenuKey === key) {
                this.connMenuKey = null;
            }
        },
        copyConnFromDialog: function (id) {
            var self = this;
            this.connMenuKey = null;
            http.post('/api/connections/' + id + '/duplicate').then(function (saved) {
                ELEMENT.Message.success('已复制为「' + saved.name + '」');
                self.loadConnections();
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        removeConnFromDialog: function (id) {
            var c = this.connections.find(function (x) { return x.id === id; });
            if (!c) {
                return;
            }
            var openTabs = this.tabs.filter(function (t) { return t.connId === id; });
            var extra = openTabs.length
                ? '（该连接有 ' + openTabs.length + ' 个已打开的标签：终端暂时仍可用，但重新连接将失败）'
                : '';
            var self = this;
            this.$confirm('确定删除连接「' + c.name + '」？' + extra, '删除连接',
                { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
                .then(function () {
                    return http.delete('/api/connections/' + id);
                })
                .then(function () {
                    ELEMENT.Message.success('已删除');
                    self.$delete(self.commonDirsByConn, id);
                    self.loadConnections();
                })
                .catch(function () { /* 已取消或已由拦截器提示 */ });
        },
        renameFolderQuick: function (row) {
            var self = this;
            this.$prompt('请输入新的文件夹名称', '重命名文件夹', {
                inputValue: row.name, inputPattern: /\S+/, inputErrorMessage: '名称不能为空'
            }).then(function (r) {
                return http.put('/api/folders/' + row.id, { name: r.value.trim() });
            }).then(function () {
                ELEMENT.Message.success('已重命名');
                self.loadFolders();
            }).catch(function () {
            });
        },
        removeFolderQuick: function (row) {
            var self = this;
            this.$confirm('删除文件夹「' + row.name + '」？其中的连接与子文件夹将移动到上一级目录。', '提示', { type: 'warning' })
                .then(function () {
                    return http.delete('/api/folders/' + row.id);
                })
                .then(function () {
                    ELEMENT.Message.success('已删除');
                    self.loadFolders();
                    self.loadConnections();
                })
                .catch(function () {
                });
        },
        /* ---------- 文件夹右键：连接所有（含子文件夹） ---------- */
        onFolderContextMenu: function (ev, row) {
            this.folderMenu = {
                visible: true,
                x: Math.max(8, Math.min(ev.clientX, window.innerWidth - 160)),
                y: Math.max(8, Math.min(ev.clientY, window.innerHeight - 120)),
                row: row
            };
        },
        collectFolderConns: function (folderId) {
            var self = this;
            var out = [];
            this.connections.forEach(function (c) {
                if (c.folderId === folderId) {
                    out.push(c);
                }
            });
            this.folders.forEach(function (f) {
                if ((f.parentId == null ? null : f.parentId) === folderId) {
                    self.collectFolderConns(f.id).forEach(function (c) {
                        out.push(c);
                    });
                }
            });
            return out;
        },
        folderMenuConnectAll: function () {
            var row = this.folderMenu.row;
            this.folderMenu.visible = false;
            if (!row) {
                return;
            }
            var conns = this.collectFolderConns(row.id);
            if (!conns.length) {
                ELEMENT.Message.info('「' + row.name + '」中没有连接');
                return;
            }
            var openIds = {};
            this.tabs.forEach(function (t) {
                if (t.connId) {
                    openIds[t.connId] = true;
                }
            });
            var toOpen = conns.filter(function (c) {
                return !openIds[c.id];
            });
            var skipped = conns.length - toOpen.length;
            if (!toOpen.length) {
                ELEMENT.Message.info('「' + row.name + '」中的连接都已打开');
                return;
            }
            var self = this;
            this.$confirm('连接「' + row.name + '」中的 ' + toOpen.length + ' 个服务器？'
                + (skipped ? '（另有 ' + skipped + ' 个已打开，将跳过）' : ''),
                '连接所有', { type: 'info', confirmButtonText: '连接', cancelButtonText: '取消' })
                .then(function () {
                    toOpen.forEach(function (c) {
                        self.openTab(c.id);
                    });
                    ELEMENT.Message.success('已打开 ' + toOpen.length + ' 个连接');
                })
                .catch(function () {
                });
        },
        /* ---------- 拖动连接移动到文件夹 ---------- */
        onConnDragStart: function (e, row) {
            if (!row || row.noDrag) {
                e.preventDefault();
                return;
            }
            this.connDragId = row.id;
            try {
                e.dataTransfer.setData('text/plain', 'conn:' + row.id);
                e.dataTransfer.effectAllowed = 'move';
            } catch (err) { /* ignore */ }
        },
        onConnDragEnd: function () {
            this.connDragId = null;
            this.connDragOverId = null;
            this.connDropKey = null;
            this.connDropPos = '';
        },
        /* ---------- 拖动连接调整同级顺序 ---------- */
        onConnRowDragOver: function (e, row) {
            var draggedId = this.connDragId;
            if (draggedId == null || row.noDrag || row.id === draggedId) {
                this.connDropKey = null;
                this.connDropPos = '';
                return;
            }
            var dragged = this.connections.find(function (c) { return c.id === draggedId; });
            var sameFolder = dragged
                && (dragged.folderId == null ? null : dragged.folderId)
                    === (row.folderId == null ? null : row.folderId);
            if (!sameFolder) {
                // 不同层级仍需拖到文件夹行上完成移动
                this.connDropKey = null;
                this.connDropPos = '';
                return;
            }
            this.connDragOverId = null;
            var rect = e.currentTarget.getBoundingClientRect();
            this.connDropKey = row.key;
            this.connDropPos = (e.clientY - rect.top) > rect.height / 2 ? 'after' : 'before';
        },
        onConnRowDragLeave: function (row) {
            if (this.connDropKey === row.key) {
                this.connDropKey = null;
                this.connDropPos = '';
            }
        },
        onConnRowDrop: function (e, row) {
            var draggedId = this.connDragId;
            var pos = this.connDropPos === 'after' ? 'after' : 'before';
            this.connDragId = null;
            this.connDragOverId = null;
            this.connDropKey = null;
            this.connDropPos = '';
            if (draggedId == null || row.noDrag || row.id === draggedId) {
                return;
            }
            var self = this;
            var dragged = this.connections.find(function (c) { return c.id === draggedId; });
            var folderId = row.folderId == null ? null : row.folderId;
            if (!dragged || (dragged.folderId == null ? null : dragged.folderId) !== folderId) {
                return;
            }
            var ids = this.connections.filter(function (c) {
                return !c.pinned && (c.folderId == null ? null : c.folderId) === folderId;
            }).sort(sortConns).map(function (c) {
                return c.id;
            }).filter(function (id) {
                return id !== draggedId;
            });
            var targetIndex = ids.indexOf(row.id);
            if (targetIndex < 0) {
                return;
            }
            ids.splice(pos === 'after' ? targetIndex + 1 : targetIndex, 0, draggedId);
            ids.forEach(function (id, i) {
                var c = self.connections.find(function (x) { return x.id === id; });
                if (c) {
                    self.$set(c, 'sortOrder', i);
                }
            });
            http.post('/api/connections/reorder', { ids: ids }).catch(function () {
                // 已由拦截器提示，回滚为服务端顺序
                self.loadConnections();
            });
        },
        onFolderDragOver: function (row) {
            if (this.connDragId != null) {
                this.connDragOverId = row.id;
            }
        },
        onFolderDragLeave: function (row) {
            if (this.connDragOverId === row.id) {
                this.connDragOverId = null;
            }
        },
        onConnDrop: function (row) {
            var connId = this.connDragId;
            this.connDragId = null;
            this.connDragOverId = null;
            this.connDropKey = null;
            this.connDropPos = '';
            if (connId == null) {
                return;
            }
            var self = this;
            var c = this.connections.find(function (x) { return x.id === connId; });
            if (!c) {
                return;
            }
            if (c.folderId === row.id) {
                ELEMENT.Message.info('该连接已在「' + row.name + '」中');
                return;
            }
            this.$confirm('将「' + c.name + '」移动到「' + row.name + '」？', '移动连接', { type: 'warning' })
                .then(function () {
                    return http.post('/api/connections/' + connId + '/move', { folderId: row.id });
                })
                .then(function () {
                    ELEMENT.Message.success('已移动到「' + row.name + '」');
                    self.loadConnections();
                })
                .catch(function () { /* 已取消或已由拦截器提示 */ });
        },
        openNewConnDialog: function () {
            // 保持「打开连接」弹窗不关闭，叠加打开可复用的连接编辑弹窗
            this.$refs.connForm.open(null);
        },
        onConnSaved: function () {
            // 保存后刷新列表：新连接立即出现在「打开连接」弹窗内，方便直接点击连接
            var self = this;
            this.loadFolders();
            this.loadConnections().then(function () {
                // 已打开标签同步最新的名称/地址（改完连接名后标签立即生效）
                self.tabs.forEach(function (t) {
                    var c = self.connections.find(function (x) { return x.id === t.connId; });
                    if (c) {
                        t.title = c.name;
                        t.host = c.host;
                        t.port = c.port || 22;
                    }
                });
                self.desktop.windows.forEach(function (w) {
                    if (w.type !== 'terminal' || !w.termTab) {
                        return;
                    }
                    var c = self.connections.find(function (x) { return x.id === w.termTab.connId; });
                    if (c) {
                        w.termTab.title = c.name;
                        w.termTab.host = c.host;
                        w.termTab.port = c.port || 22;
                    }
                });
            });
        },
        /* ---------- 右上角菜单与设置 ---------- */
        toggleTopMenu: function () {
            if (this.topMenuVisible) {
                this.topMenuVisible = false;
                this.topSubMenu = '';
                return;
            }
            var el = this.$refs.menuBtn;
            if (el) {
                var r = el.getBoundingClientRect();
                this.topMenuPos = {
                    top: Math.round(r.bottom + 6),
                    right: Math.max(8, Math.round(window.innerWidth - r.right - 2))
                };
            }
            this.topSubMenu = '';
            this.topMenuVisible = true;
        },
        onMenuCommand: function (cmd) {
            this.topMenuVisible = false;
            this.topSubMenu = '';
            var t = this.activeTab;
            if (cmd === 'openConnection') {
                this.openConnectDialog();
            } else if (cmd === 'newConnection') {
                this.openNewConnDialog();
            } else if (cmd === 'connImport') {
                this.openConnImport();
            } else if (cmd === 'connExport') {
                this.openConnExport();
            } else if (cmd === 'reconnectActive') {
                if (t) {
                    this.reconnectTab(t);
                } else {
                    ELEMENT.Message.warning('当前没有打开的连接');
                }
            } else if (cmd === 'disconnectActive') {
                if (t) {
                    this.disconnectTab(t);
                } else {
                    ELEMENT.Message.warning('当前没有打开的连接');
                }
            } else if (cmd === 'portfwd') {
                if (t) {
                    this.openPortForwards(t);
                } else {
                    ELEMENT.Message.warning('当前没有打开的连接');
                }
            } else if (cmd === 'sysinfo') {
                if (!t || !t.sessionId) {
                    ELEMENT.Message.warning('当前标签尚未连接，无法获取系统信息');
                } else {
                    this.sysInfoTitle = t.title;
                    this.sysInfoSessionId = t.sessionId;
                    this.sysInfo = null;
                    this.sysInfoError = '';
                    this.sysInfoVisible = true;
                }
            } else if (cmd === 'font') {
                this.fontVisible = true;
            } else if (cmd === 'hotkey') {
                this.hotkeyVisible = true;
            } else if (cmd === 'bg') {
                this.openBgSettings('terminal');
            } else if (cmd === 'fitTerminal') {
                this.fitActive();
            } else if (cmd === 'toggleTermLogHighlight') {
                this.termLogHighlightEnabled = !this.termLogHighlightEnabled;
                ELEMENT.Message.success(this.termLogHighlightEnabled
                    ? '已开启日志级别高亮' : '已关闭日志级别高亮');
            } else if (cmd === 'openAiPanel') {
                if (!t) {
                    ELEMENT.Message.warning('当前没有打开的连接');
                } else {
                    this.panelVisible = true;
                    this.panelTab = 'ai';
                    this.ensurePanelWide();
                    var self = this;
                    this.$nextTick(function () {
                        self.fitActive();
                        self.scrollAiChat();
                    });
                }
            } else if (cmd === 'openFilePanel') {
                if (!t) {
                    ELEMENT.Message.warning('当前没有打开的连接');
                } else {
                    this.panelVisible = true;
                    this.panelTab = 'file';
                }
            } else if (cmd === 'toggleDangerConfirm') {
                this.dangerConfirmEnabled = !this.dangerConfirmEnabled;
                ELEMENT.Message.success(this.dangerConfirmEnabled
                    ? '已开启危险命令确认' : '已关闭危险命令确认');
            } else if (cmd === 'help') {
                this.helpVisible = true;
            } else if (cmd === 'sponsor') {
                this.sponsorVisible = true;
            } else if (cmd === 'about') {
                this.loadAppInfo();
                this.aboutVisible = true;
            } else if (cmd === 'lan') {
                this.loadLan();
                this.lanVisible = true;
            } else if (cmd === 'auth') {
                this.openAuthSettings();
            } else if (cmd === 'protocol') {
                this.openProtocolDialog();
            } else if (cmd === 'integration') {
                this.openIntegrationDialog();
            } else if (cmd === 'audit') {
                this.openAudit();
            } else if (cmd === 'ai') {
                this.loadAiConfig();
                this.aiSetVisible = true;
            } else if (cmd === 'aiWizard') {
                this.openAiWizard();
            } else if (cmd === 'desktop') {
                this.openDesktopInNewTab(t);
            } else if (cmd === 'backup') {
                this.openBackupDialog();
            } else if (cmd === 'appRestart') {
                this.askAppLifecycle('restart');
            } else if (cmd === 'appShutdown') {
                this.askAppLifecycle('shutdown');
            }
        },
        /* ---------- AI 设置（厂商预设 + 模型列表实时获取） ---------- */
        openAiWizard: function () {
            if (this.$refs.aiWizard) {
                this.$refs.aiWizard.open();
            }
        },
        onAiWizardSaved: function (d) {
            if (d) {
                this.aiSetForm.provider = d.provider || this.aiSetForm.provider;
                this.aiSetForm.baseUrl = d.baseUrl || this.aiSetForm.baseUrl;
                this.aiSetForm.model = d.model || this.aiSetForm.model;
                this.aiSetForm.hasKey = !!d.hasKey;
                this.aiSetForm.apiKey = '';
            }
            this.loadAiProviders();
            this.loadAiRuntimeConfig();
        },
        aiProviderPreset: function (id) {
            for (var i = 0; i < this.aiProviders.length; i++) {
                if (this.aiProviders[i].id === id) {
                    return this.aiProviders[i];
                }
            }
            return null;
        },
        loadAiProviders: function () {
            var self = this;
            return http.get('/api/ai/providers').then(function (list) {
                self.aiProviders = Array.isArray(list) ? list : [];
            }).catch(function () { /* 忽略 */ });
        },
        /* 启动时只需单轮步数：避免打开 AI 设置前一直用旧的 15 步上限 */
        loadAiRuntimeConfig: function () {
            var self = this;
            return http.get('/api/ai/config').then(function (d) {
                if (d) {
                    self.aiMaxSteps = clipAiSteps(d.maxSteps);
                    self.aiContextWindow = clipAiContextWindow(d.contextWindow);
                }
            }).catch(function () { /* 未配置或接口不可用时用默认值 */ });
        },
        loadAiConfig: function () {
            var self = this;
            this.aiModelsNote = '';
            http.get('/api/ai/config').then(function (d) {
                if (!d) {
                    return;
                }
                self.aiSetForm.provider = d.provider || 'deepseek';
                self.aiSetForm.baseUrl = d.baseUrl || '';
                self.aiSetForm.model = d.model || '';
                self.aiSetForm.hasKey = !!d.hasKey;
                self.aiMaxSteps = clipAiSteps(d.maxSteps);
                self.aiSetForm.maxSteps = self.aiMaxSteps;
                self.aiContextWindow = clipAiContextWindow(d.contextWindow);
                self.aiSetForm.contextWindow = self.aiContextWindow;
                self.aiSetForm.apiKey = '';
                var ready = self.aiProviders.length ? Promise.resolve() : self.loadAiProviders();
                ready.then(function () {
                    self.applyPresetModels();
                    if (self.aiSetForm.hasKey) {
                        self.fetchAiModels(true); // 已配置 Key：打开弹窗即后台实时获取
                    } else {
                        self.aiModelsNote = '尚未配置 API Key，暂展示内置常用模型；填写后可点「刷新列表」实时获取';
                    }
                });
            }).catch(function () { /* 忽略 */ });
        },
        /* 先展示内置常用模型（含已保存的模型），保证下拉不为空 */
        applyPresetModels: function () {
            var p = this.aiProviderPreset(this.aiSetForm.provider);
            var list = p && p.fallbackModels ? p.fallbackModels.slice() : [];
            var cur = (this.aiSetForm.model || '').trim();
            if (cur && list.indexOf(cur) < 0) {
                list.unshift(cur);
            }
            this.aiModelOptions = list;
        },
        onAiProviderChange: function (id) {
            var p = this.aiProviderPreset(id);
            if (p) {
                if (p.baseUrl) {
                    this.aiSetForm.baseUrl = p.baseUrl;
                }
                var list = p.fallbackModels || [];
                if (list.length && list.indexOf((this.aiSetForm.model || '').trim()) < 0) {
                    this.aiSetForm.model = list[0];
                }
            }
            this.applyPresetModels();
            this.aiModelsNote = '';
            if (p && p.id !== 'custom') {
                this.fetchAiModels(true); // 切换厂商即实时获取
            } else {
                this.aiModelsNote = '自定义服务：填写 API 地址与 API Key 后，点「刷新列表」实时获取模型';
            }
        },
        /* silent=true 时静默刷新（打开弹窗 / 切换厂商时自动触发） */
        fetchAiModels: function (silent) {
            var self = this;
            if (this.aiModelsLoading) {
                return;
            }
            var baseUrl = (this.aiSetForm.baseUrl || '').trim();
            if (!baseUrl) {
                if (!silent) {
                    ELEMENT.Message.warning('请先填写 API 地址');
                }
                return;
            }
            if (!this.aiSetForm.apiKey && !this.aiSetForm.hasKey) {
                this.aiModelsNote = '尚未配置 API Key，暂展示内置常用模型；填写后可实时获取';
                if (!silent) {
                    ELEMENT.Message.info('填写 API Key 后才能从厂商接口实时获取模型列表');
                }
                return;
            }
            this.aiModelsLoading = true;
            http.post('/api/ai/models', {
                provider: this.aiSetForm.provider || 'custom',
                baseUrl: baseUrl,
                apiKey: this.aiSetForm.apiKey
            }).then(function (d) {
                if (d && Array.isArray(d.models) && d.models.length) {
                    var list = d.models.slice();
                    var cur = (self.aiSetForm.model || '').trim();
                    if (cur && list.indexOf(cur) < 0) {
                        list.unshift(cur);
                    }
                    self.aiModelOptions = list;
                }
                self.aiModelsNote = d && d.note ? d.note : '';
                if (!silent && d && d.dynamic) {
                    ELEMENT.Message.success('已实时获取 ' + d.models.length + ' 个模型');
                }
            }).catch(function () {
                self.aiModelsNote = '获取模型列表失败，暂展示内置常用模型，也可直接输入模型 ID';
            }).then(function () {
                self.aiModelsLoading = false;
            });
        },
        saveAiConfig: function () {
            var self = this;
            var baseUrl = (this.aiSetForm.baseUrl || '').trim();
            var model = (this.aiSetForm.model || '').trim();
            if (!baseUrl) {
                ELEMENT.Message.warning('请填写 API 地址');
                return;
            }
            if (!model) {
                ELEMENT.Message.warning('请选择或输入模型');
                return;
            }
            this.aiSetSaving = true;
            var maxSteps = clipAiSteps(this.aiSetForm.maxSteps);
            var contextWindow = clipAiContextWindow(this.aiSetForm.contextWindow);
            http.post('/api/ai/config', {
                provider: this.aiSetForm.provider,
                baseUrl: baseUrl,
                model: model,
                apiKey: this.aiSetForm.apiKey,
                maxSteps: maxSteps,
                contextWindow: contextWindow
            }).then(function (d) {
                ELEMENT.Message.success('AI 设置已保存');
                if (d) {
                    self.aiSetForm.provider = d.provider || self.aiSetForm.provider;
                    self.aiSetForm.baseUrl = d.baseUrl || baseUrl;
                    self.aiSetForm.model = d.model || model;
                    self.aiSetForm.hasKey = !!d.hasKey;
                    self.aiMaxSteps = clipAiSteps(d.maxSteps);
                    self.aiSetForm.maxSteps = self.aiMaxSteps;
                    self.aiContextWindow = clipAiContextWindow(d.contextWindow);
                    self.aiSetForm.contextWindow = self.aiContextWindow;
                } else {
                    self.aiContextWindow = contextWindow;
                    self.aiSetForm.contextWindow = contextWindow;
                }
                self.aiSetForm.apiKey = '';
                self.aiSetVisible = false;
            }).catch(function () { /* 已由拦截器提示 */ }).then(function () {
                self.aiSetSaving = false;
            });
        },
        toggleAiBar: function (tab) {
            var t = tab || this.activeTab;
            if (!t) {
                return;
            }
            t.aiVisible = !t.aiVisible;
            var self = this;
            this.$nextTick(function () {
                self.fitTab(t);
                if (t.aiVisible) {
                    self.focusAiInput(t);
                }
            });
        },
        aiGenerate: function (tab) {
            var t = tab || this.activeTab;
            if (!t || t.aiLoading) {
                return;
            }
            var text = (t.aiText || '').trim();
            if (!text) {
                ELEMENT.Message.warning('请输入要生成命令的需求描述');
                return;
            }
            var self = this;
            t.aiLoading = true;
            http.post('/api/ai/translate', {
                text: text,
                cwd: t.sftpPath || t.sftpHome || ''
            }).then(function (d) {
                var cmd = d && d.command ? d.command : '';
                if (!cmd) {
                    ELEMENT.Message.warning('AI 未返回有效命令');
                    return;
                }
                t.cmdText = cmd;
                t.aiVisible = false;
                t.aiText = '';
                ELEMENT.Message.success('已生成命令，确认后回车执行');
                self.$nextTick(function () {
                    self.fitTab(t);
                    self.focusCmdInput(t);
                });
            }).catch(function () { /* 已由拦截器提示 */ }).then(function () {
                t.aiLoading = false;
            });
        },
        /* ---------- AI 终端（对话式：AI 自动执行命令，独立通道；每连接多个对话） ---------- */
        onChatModeChange: function (v) {
            try { localStorage.setItem('deepshell.aiChatMode', v); } catch (e) { /* ignore */ }
        },
        /* 输入框 ↑↓ 历史：返回是否消费了按键 */
        aiHistoryPrev: function (t) {
            var conv = this.aiActiveConv(t);
            if (!conv || !conv._hist || !conv._hist.length) {
                return false;
            }
            if (conv._histIdx == null || conv._histIdx < 0) {
                this.$set(conv, '_histDraft', t.chatInput || '');
                conv._histIdx = conv._hist.length;
            }
            conv._histIdx = Math.max(0, conv._histIdx - 1);
            t.chatInput = conv._hist[conv._histIdx] || '';
            return true;
        },
        aiHistoryNext: function (t) {
            var conv = this.aiActiveConv(t);
            if (!conv || conv._histIdx == null || conv._histIdx < 0 || !conv._hist) {
                return false;
            }
            conv._histIdx++;
            if (conv._histIdx >= conv._hist.length) {
                conv._histIdx = -1;
                t.chatInput = conv._histDraft || '';
            } else {
                t.chatInput = conv._hist[conv._histIdx] || '';
            }
            return true;
        },
        aiPushHistory: function (conv, text) {
            if (!text) {
                return;
            }
            if (!conv._hist) {
                this.$set(conv, '_hist', []);
            }
            if (conv._hist[conv._hist.length - 1] !== text) {
                conv._hist.push(text);
                if (conv._hist.length > AI_HISTORY_MAX) {
                    conv._hist.splice(0, conv._hist.length - AI_HISTORY_MAX);
                }
            }
            conv._histIdx = -1;
            conv._histDraft = '';
        },
        /* “/” 快捷命令：输入框发起的轻量操作，不占对话上下文 */
        aiRunSlash: function (id, t) {
            var conv = this.aiActiveConv(t);
            if (id === 'new') {
                this.aiConvNew();
                return;
            }
            if (!conv) {
                return;
            }
            if (id === 'clear') {
                if (conv._compacting) {
                    ELEMENT.Message.warning('正在压缩上下文，请稍后再清空');
                    return;
                }
                if (conv._run && conv._run.busy) {
                    ELEMENT.Message.warning('该对话正在执行中，请先停止再清空');
                    return;
                }
                var self = this;
                this.$confirm('清空当前对话的全部记录？', '清空对话', { type: 'warning' })
                    .then(function () {
                        conv.msgs = [];
                        conv.title = '新对话';
                        conv.updatedAt = Date.now();
                        t.chatMsgs = conv.msgs;
                        self.saveConv(t, conv);
                        self.saveConvTitle(conv);
                    })
                    .catch(function () { /* 取消 */ });
                return;
            }
            if (id === 'auto' || id === 'manual') {
                t.chatMode = id;
                this.onChatModeChange(id);
                ELEMENT.Message.success(id === 'auto' ? '已切换为自动执行' : '已切换为每步确认');
                return;
            }
            if (id === 'compact') {
                this.aiCompactContext(t, conv);
                return;
            }
            if (id === 'pin') {
                this.aiConvPin(conv);
                return;
            }
            if (id === 'fork') {
                this.aiConvFork(conv, -1);
                return;
            }
            if (id === 'desktop') {
                this.openDesktopInNewTab(t);
                return;
            }
            if (id === 'stop') {
                this.aiChatStop(t);
                return;
            }
            if (id === 'help') {
                this.helpVisible = true;
            }
        },
        /* 按消息定位所属对话（跨对话的继续 / 重试按钮使用） */
        aiConvOfMessage: function (t, m) {
            var found = null;
            (t.chatConvs || []).some(function (c) {
                if (c.msgs && c.msgs.indexOf(m) >= 0) {
                    found = c;
                    return true;
                }
                return false;
            });
            return found;
        },
        aiOpenConvForAction: function (t, conv) {
            if (!conv) {
                return;
            }
            this.aiConvRead(conv);
            if (t.chatConvId !== conv.id) {
                t.chatConvId = conv.id;
                t.chatMsgs = conv.msgs || [];
                t.chatInput = conv.input || '';
                this.scrollAiChat(true);
            }
        },
        aiConvById: function (t, id) {
            return (t.chatConvs || []).find(function (c) { return c.id === id; }) || null;
        },
        aiActiveConv: function (t) {
            return this.aiConvById(t, t.chatConvId) || (t.chatConvs && t.chatConvs[0]) || null;
        },
        /* 对话对象上补充响应式的运行态与输入草稿（服务端返回的对象没有这些字段） */
        aiEnsureConvState: function (conv) {
            if (!conv) {
                return null;
            }
            if (!conv._run) {
                this.$set(conv, '_run', createAiConvRun());
            }
            if (conv.input == null) {
                this.$set(conv, 'input', '');
            }
            if (!conv.msgs) {
                this.$set(conv, 'msgs', []);
            }
            if (conv.pinned == null) {
                this.$set(conv, 'pinned', false);
            }
            if (conv.unread == null) {
                this.$set(conv, 'unread', false);
            }
            if (conv._compacting == null) {
                this.$set(conv, '_compacting', false);
            }
            if (!conv._hist) {
                this.$set(conv, '_hist', []);
            }
            if (conv._histIdx == null) {
                this.$set(conv, '_histIdx', -1);
            }
            if (!conv._queue) {
                this.$set(conv, '_queue', []);
            }
            return conv;
        },
        /* 最近一次真实模型用量：压缩后，旧消息带的用量不能再算作当前上下文 */
        aiLastUsage: function (conv) {
            var msgs = (conv && conv.msgs) || [];
            var compactAt = 0;
            for (var c = msgs.length - 1; c >= 0; c--) {
                if (msgs[c] && msgs[c].role === 'compact') {
                    compactAt = Number(msgs[c].at) || 0;
                    break;
                }
            }
            for (var i = msgs.length - 1; i >= 0; i--) {
                var m = msgs[i];
                if (!m || m.role === 'compact') {
                    continue;
                }
                if (m.usage && (m.usage.promptTokens != null || m.usage.totalTokens != null)) {
                    // 压缩前保留的最近消息仍带着旧 usage，必须用时间戳排除
                    if (compactAt && !(Number(m.usageAt) >= compactAt)) {
                        continue;
                    }
                    return m.usage;
                }
            }
            return null;
        },
        aiUsageTitle: function (usage) {
            if (!usage) {
                return '';
            }
            var parts = [];
            if (usage.promptTokens != null) {
                parts.push('输入 ' + formatTokenCount(usage.promptTokens));
            }
            if (usage.completionTokens != null) {
                parts.push('输出 ' + formatTokenCount(usage.completionTokens));
            }
            if (usage.cachedTokens != null && usage.promptTokens) {
                var pct = Number(usage.cachedTokens) * 100 / Number(usage.promptTokens);
                parts.push('缓存命中 ' + (pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)) + '%');
            }
            if (usage.reasoningTokens) {
                parts.push('思考 ' + formatTokenCount(usage.reasoningTokens));
            }
            if (usage.estimated) {
                parts.push('字符估算');
            }
            return parts.join(' · ');
        },
        aiMsgChars: function (m) {
            if (!m) {
                return 0;
            }
            return (m.text || '').length + (m.cmd || '').length + (m.output || '').length
                + (m.note || '').length + (m.reasoning || '').length + 24;
        },
        aiHistoryEntries: function (msgs) {
            var self = this;
            var out = [];
            (msgs || []).forEach(function (m) {
                if (!m) {
                    return;
                }
                if (m.role === 'compact') {
                    out.push({
                        role: 'user',
                        content: '[较早对话的自动压缩摘要]\n请将以下摘要视为已经发生并确认的背景，'
                            + '不要复述，也不要向用户提及压缩本身，直接继续最近的消息。\n\n' + (m.text || '')
                    });
                } else if (m.role === 'user') {
                    out.push({ role: 'user', content: m.text || '' });
                } else if (m.role === 'ai' && m.cmd) {
                    out.push({
                        role: 'assistant',
                        content: JSON.stringify({ cmd: m.cmd, note: m.note || '' })
                    });
                    if (m.state === 'done') {
                        out.push({ role: 'user', content: self.aiToolResult(m) });
                    } else if (m.state === 'skipped') {
                        out.push({
                            role: 'user',
                            content: '（用户跳过了这条命令）请不要重复执行它，换一种方式或先向用户说明。'
                        });
                    }
                } else if (m.role === 'ai' && m.text) {
                    out.push({ role: 'assistant', content: m.text });
                }
            });
            return out;
        },
        aiEstimateContextTokensForMsgs: function (msgs) {
            var entries = this.aiHistoryEntries(msgs);
            var tokens = AI_SYSTEM_PROMPT_TOKENS;
            entries.forEach(function (e) {
                tokens += estimateTextTokens(e.content) + 4;
            });
            return tokens;
        },
        aiEstimateContextTokens: function (conv) {
            return this.aiEstimateContextTokensForMsgs((conv && conv.msgs) || []);
        },
        /* 当前上下文占用：取最近真实 Prompt 用量与对话估算的较大值，供压缩阈值与提示复用 */
        aiContextStats: function (conv) {
            var estimate = this.aiEstimateContextTokens(conv);
            var u = this.aiLastUsage(conv);
            var exact = u && u.promptTokens != null ? Number(u.promptTokens) : 0;
            var tokens = Math.max(estimate, exact);
            var windowSize = this.aiContextWindow || AI_CONTEXT_WINDOW_DEFAULT;
            var percent = windowSize > 0
                ? Math.max(0, Math.min(100, Math.round(tokens * 100 / windowSize))) : 0;
            return { tokens: tokens, window: windowSize, percent: percent };
        },
        /* 选择较早消息用于压缩：保留最近约 35%（且不超过窗口 16%），优先在用户消息边界切分 */
        aiBuildCompactPlan: function (conv) {
            var msgs = (conv && conv.msgs) || [];
            if (msgs.length < 4) {
                return null;
            }
            var totalChars = 0;
            var lastCompact = -1;
            for (var i = 0; i < msgs.length; i++) {
                totalChars += this.aiMsgChars(msgs[i]);
                if (msgs[i].role === 'compact') {
                    lastCompact = i;
                }
            }
            if (totalChars < 3000) {
                return null;
            }
            var windowSize = this.aiContextWindow || AI_CONTEXT_WINDOW_DEFAULT;
            var retainTokens = Math.max(2000, Math.min(24000, Math.round(windowSize * AI_CONTEXT_RETAIN_RATIO)));
            // 手动压缩可以比自动压缩更积极：保留最近约 35%，同时不超过窗口 16%，最低保留 3000 字符
            var retainChars = Math.max(3000, Math.min(totalChars * 0.35, retainTokens * 4));
            var from = msgs.length;
            var recentChars = 0;
            var guard = 0;
            for (var j = msgs.length - 1; j >= 0; j--) {
                recentChars += this.aiMsgChars(msgs[j]);
                from = j;
                guard++;
                if ((recentChars >= retainChars && guard >= 6) || guard >= 40) {
                    break;
                }
            }
            if (from <= 0) {
                return null;
            }
            // 尽量让最近一段从用户消息开始，避免留下孤立的 AI 回复
            while (from > 0 && msgs[from] && msgs[from].role !== 'user') {
                from--;
            }
            if (from <= 0) {
                return null;
            }
            // 旧压缩摘要必须一起进入新摘要，避免同时残留多张压缩卡
            if (lastCompact >= 0 && from <= lastCompact) {
                from = lastCompact + 1;
                while (from < msgs.length - 1 && msgs[from] && msgs[from].role !== 'user') {
                    from++;
                }
            }
            if (from >= msgs.length) {
                from = msgs.length - 1;
            }
            if (from <= 0 || from >= msgs.length) {
                return null;
            }
            var compacted = msgs.slice(0, from);
            if (compacted.length < 2) {
                return null;
            }
            var compactedChars = 0;
            compacted.forEach(function (m) {
                compactedChars += (m.text || '').length + (m.cmd || '').length
                    + (m.output || '').length + (m.note || '').length;
            });
            if (compactedChars < 800) {
                return null;
            }
            var history = this.aiHistoryEntries(compacted);
            if (history.length < 2) {
                return null;
            }
            var recent = msgs.slice(from);
            var beforeTokens = this.aiEstimateContextTokens(conv);
            var afterTokens = this.aiEstimateContextTokensForMsgs(recent) + 1600;
            return {
                start: from,
                compactCount: compacted.length,
                keepCount: recent.length,
                beforeTokens: beforeTokens,
                afterTokens: Math.min(beforeTokens, afterTokens),
                compactedChars: compactedChars,
                history: history
            };
        },
        /* 压缩较早上下文：调用模型生成结构化检查点，替换旧消息，保留最近消息 */
        aiCompactContext: function (t, conv) {
            if (!conv) {
                return;
            }
            if (conv._compacting) {
                ELEMENT.Message.info('正在压缩上下文，请稍候');
                return;
            }
            var stats = this.aiContextStats(conv);
            if (stats.percent <= 50) {
                ELEMENT.Message.info('上下文使用未超过 50%，暂不需要压缩');
                return;
            }
            var run = this.aiConvRun(conv);
            if (run && run.busy) {
                ELEMENT.Message.warning('AI 正在执行中，请先停止或等待完成');
                return;
            }
            var plan = this.aiBuildCompactPlan(conv);
            if (!plan) {
                ELEMENT.Message.info('对话还不够长，没有可压缩的较早消息');
                return;
            }
            var self = this;
            var msg = '将较早的 ' + plan.compactCount + ' 条消息压缩成一份摘要，保留最近 '
                + plan.keepCount + ' 条消息。\n\n估算上下文：≈' + formatTokenCount(plan.beforeTokens)
                + ' → ≈' + formatTokenCount(plan.afterTokens) + ' tokens。\n\n'
                + '压缩会调用一次模型生成摘要，可能产生少量费用；原对话的最近消息不受影响。';
            this.$confirm(msg, '压缩上下文', {
                type: 'warning',
                confirmButtonText: '开始压缩',
                cancelButtonText: '取消'
            }).then(function () {
                self.$set(conv, '_compacting', true);
                return http.post('/api/ai/compact', {
                    messages: plan.history,
                    cwd: conv.cwd || ''
                }, { silent: true });
            }).then(function (res) {
                if (!res || !res.summary) {
                    throw new Error('模型未返回有效摘要');
                }
                var recent = conv.msgs.slice(plan.start);
                var summaryTokens = estimateTextTokens(res.summary) + 4;
                var afterTokens = self.aiEstimateContextTokensForMsgs(recent) + summaryTokens;
                var compactMsg = {
                    role: 'compact',
                    text: res.summary,
                    beforeMessages: plan.compactCount,
                    keepMessages: recent.length,
                    beforeTokens: plan.beforeTokens,
                    afterTokens: afterTokens,
                    at: Date.now(),
                    open: false,
                    usage: res.usage || null
                };
                conv.msgs = [compactMsg].concat(recent);
                conv.updatedAt = Date.now();
                self.$set(conv, '_compacting', false);
                if (t && t.chatConvId === conv.id) {
                    t.chatMsgs = conv.msgs;
                    self.scrollAiChat(true);
                }
                self.saveConv(t, conv);
                ELEMENT.Message.success('已压缩 ' + plan.compactCount + ' 条消息，估算上下文减少约 '
                    + formatTokenCount(Math.max(0, plan.beforeTokens - afterTokens)) + ' tokens');
            }).catch(function (e) {
                self.$set(conv, '_compacting', false);
                if (e && e.message && e.message !== 'cancel') {
                    if (!(e.response && e.response.status === 401)) {
                        ELEMENT.Message.error(e.message);
                    }
                }
            });
        },
        aiConvPin: function (c) {
            if (!c || c.id == null) {
                return;
            }
            var self = this;
            var next = !c.pinned;
            http.put('/api/ai/convs/' + c.id, { pinned: next }).then(function (d) {
                self.$set(c, 'pinned', d && d.pinned != null ? !!d.pinned : next);
                ELEMENT.Message.success(next ? '对话已置顶' : '已取消置顶');
            }).catch(function () { /* 拦截器已提示 */ });
        },
        aiConvMarkUnread: function (c) {
            if (!c || c.id == null || c.unread) {
                return;
            }
            this.$set(c, 'unread', true);
            http.put('/api/ai/convs/' + c.id, { unread: true }).catch(function () { /* ignore */ });
        },
        aiConvRead: function (c) {
            if (!c || c.id == null || !c.unread) {
                return;
            }
            this.$set(c, 'unread', false);
            http.put('/api/ai/convs/' + c.id, { unread: false }).catch(function () { /* ignore */ });
        },
        /* 总结标题：force=false 用于新对话自动生成，force=true 用于右键菜单覆盖当前标题 */
        aiConvSummarizeTitle: function (c, force, hint) {
            if (!c || c.id == null) {
                return;
            }
            if (c._titleBusy) {
                if (force) {
                    ELEMENT.Message.info('正在总结标题，请稍候');
                }
                return;
            }
            if (force) {
                if (!this.aiConvHasText(c)) {
                    ELEMENT.Message.info('当前对话还没有内容，无法总结标题');
                    return;
                }
                var self = this;
                var current = c.title || '新对话';
                this.$confirm('重新总结会覆盖当前标题「' + current + '」，是否继续？', '再次总结标题', {
                    type: 'warning',
                    confirmButtonText: '重新生成',
                    cancelButtonText: '取消'
                }).then(function () {
                    self.aiConvRequestTitle(c, true);
                }).catch(function () { /* 取消 */ });
                return;
            }
            this.aiConvRequestTitle(c, false, hint);
        },
        aiConvHasText: function (c) {
            return (c && c.msgs || []).some(function (m) {
                return m && (m.role === 'user' || m.role === 'ai') && (m.text || '').trim();
            });
        },
        aiConvRequestTitle: function (c, force, hint) {
            if (!c || c.id == null || c._titleBusy) {
                return;
            }
            var self = this;
            this.$set(c, '_titleBusy', true);
            var loading = force
                ? ELEMENT.Message({ message: '正在重新总结标题…', type: 'info', duration: 0 })
                : null;
            http.post('/api/ai/convs/' + c.id + '/title', {
                force: !!force,
                hint: hint || '',
                expectedTitle: c.title || ''
            }, force ? {} : { silent: true }).then(function (d) {
                if (d && d.title && c.title !== d.title) {
                    self.$set(c, 'title', d.title);
                }
                if (force && d && d.title) {
                    ELEMENT.Message.success('标题已更新为「' + d.title + '」');
                }
            }).catch(function () {
                // 自动总结静默失败；手动失败由拦截器提示
            }).then(function () {
                self.$set(c, '_titleBusy', false);
                if (loading) {
                    loading.close();
                }
            });
        },
        aiConvFork: function (conv, msgIndex) {
            if (!conv || conv.id == null) {
                return;
            }
            if (conv._compacting || (conv._run && conv._run.busy)) {
                ELEMENT.Message.warning('对话正在执行或压缩，请稍后再分叉');
                return;
            }
            var msgs = conv.msgs || [];
            if (!msgs.length) {
                ELEMENT.Message.info('当前对话为空，无法分叉');
                return;
            }
            var count = msgIndex == null || msgIndex < 0
                ? msgs.length : Math.min(msgs.length, msgIndex + 1);
            var self = this;
            this.$confirm('将从「' + conv.title + '」复制前 ' + count + ' 条消息为一个新对话，原对话保持不变。',
                '分叉对话', { type: 'info', confirmButtonText: '创建分叉', cancelButtonText: '取消' })
                .then(function () {
                    return http.post('/api/ai/convs/' + conv.id + '/fork', {
                        msgIndex: msgIndex == null ? -1 : msgIndex
                    });
                })
                .then(function (nc) {
                    if (!nc) {
                        return;
                    }
                    var t = self.activeTab;
                    if (!t || !(t.chatConvs || []).some(function (x) { return x.id === conv.id; })) {
                        t = self.tabs.find(function (tab) {
                            return (tab.chatConvs || []).some(function (x) { return x.id === conv.id; });
                        }) || t;
                    }
                    if (!t) {
                        return;
                    }
                    self.aiEnsureConvState(nc);
                    t.chatConvs.forEach(function (x) { x.active = false; });
                    t.chatConvs.push(nc);
                    t.chatConvId = nc.id;
                    t.chatMsgs = nc.msgs || [];
                    t.chatInput = '';
                    self.scrollAiChat(true);
                    ELEMENT.Message.success('已创建分叉对话「' + nc.title + '」');
                })
                .catch(function () { /* 取消或拦截器已提示 */ });
        },
        aiConvRun: function (conv) {
            return conv && conv._run ? conv._run : null;
        },
        chatAnyBusy: function (t) {
            return !!(t && (t.chatConvs || []).some(function (c) {
                return c._run && c._run.busy;
            }));
        },
        /* 切走前把输入框草稿写回当前对话，保证每个对话草稿独立 */
        aiSaveDraft: function (t) {
            var conv = this.aiActiveConv(t);
            if (conv && conv.input !== t.chatInput) {
                this.$set(conv, 'input', t.chatInput || '');
            }
        },
        /* 保存消息与工作目录（标题走独立接口，避免自动总结完成后被旧请求覆盖） */
        saveConv: function (t, conv) {
            if (!conv || conv.id == null) {
                return Promise.resolve();
            }
            return http.put('/api/ai/convs/' + conv.id, {
                cwd: conv.cwd,
                msgs: conv.msgs,
                unread: !!conv.unread
            }).catch(function () { /* 拦截器已提示 */ });
        },
        saveConvTitle: function (conv, silent) {
            if (!conv || conv.id == null) {
                return Promise.resolve();
            }
            return http.put('/api/ai/convs/' + conv.id, { title: conv.title },
                silent ? { silent: true } : {}).catch(function () { /* ignore */ });
        },
        /* 打开连接时加载该连接的对话列表（服务端没有则迁移浏览器旧数据或新建） */
        loadAiConvs: function (t) {
            var self = this;
            t.chatLoading = true;
            http.get('/api/ai/convs', { params: { connId: t.connId } }).then(function (list) {
                if (list && list.length) {
                    self.applyAiConvs(t, list);
                    return;
                }
                var stored = readStoredAiConvs(t.connId);
                if (stored.length) {
                    self.migrateStoredAiConvs(t, stored);
                    return;
                }
                return self.aiConvCreateRemote(t);
            }).catch(function () { /* 拦截器已提示 */ }).then(function () {
                t.chatLoading = false;
            });
        },
        applyAiConvs: function (t, list) {
            var self = this;
            t.chatConvs = list || [];
            t.chatConvs.forEach(function (c) {
                self.aiEnsureConvState(c);
            });
            var act = t.chatConvs.find(function (c) { return c.active; }) || t.chatConvs[0] || null;
            t.chatConvId = act ? act.id : null;
            t.chatMsgs = act && act.msgs ? act.msgs : [];
            t.chatInput = act ? (act.input || '') : '';
            this.scrollAiChat();
        },
        /* 浏览器里的旧对话一次性上传到服务端，成功后清理本地存储 */
        migrateStoredAiConvs: function (t, stored) {
            var self = this;
            var created = [];
            var chain = Promise.resolve();
            stored.forEach(function (c) {
                chain = chain.then(function () {
                    return http.post('/api/ai/convs', { connId: t.connId }).then(function (nc) {
                        created.push({ id: nc.id, data: c });
                    });
                });
            });
            // 先写入内容（不带 active），最后再单独标记选中的那个，避免被后续创建覆盖
            chain = chain.then(function () {
                var inner = Promise.resolve();
                created.forEach(function (x) {
                    inner = inner.then(function () {
                        return http.put('/api/ai/convs/' + x.id, {
                            title: x.data.title, cwd: x.data.cwd, msgs: x.data.msgs
                        });
                    });
                });
                return inner;
            });
            chain = chain.then(function () {
                var act = created.find(function (x) { return x.data.active; }) || created[created.length - 1];
                return act ? http.put('/api/ai/convs/' + act.id, { active: true }) : null;
            });
            return chain.then(function () {
                clearStoredAiConvs(t.connId);
                return http.get('/api/ai/convs', { params: { connId: t.connId } });
            }).then(function (list) {
                self.applyAiConvs(t, list);
            }).catch(function () { /* 迁移失败保留本地数据，下次打开重试 */ });
        },
        aiConvCreateRemote: function (t) {
            var self = this;
            this.aiSaveDraft(t);
            return http.post('/api/ai/convs', { connId: t.connId }).then(function (c) {
                if (!c) {
                    return null;
                }
                self.aiEnsureConvState(c);
                t.chatConvs.forEach(function (x) { x.active = false; });
                t.chatConvs.push(c);
                t.chatConvId = c.id;
                t.chatMsgs = c.msgs || [];
                t.chatInput = '';
                self.scrollAiChat();
                return c;
            });
        },
        aiConvNew: function () {
            var t = this.activeTab;
            if (!t || t.chatLoading) {
                return;
            }
            var current = this.aiActiveConv(t);
            if (current && current._compacting) {
                ELEMENT.Message.info('正在压缩上下文，请稍候');
                return;
            }
            this.aiConvCreateRemote(t).catch(function () { /* 拦截器已提示 */ });
        },
        aiConvSwitch: function (c) {
            var t = this.activeTab;
            if (!t || !c) {
                return;
            }
            this.aiConvRead(c);
            if (c.id === t.chatConvId) {
                return;
            }
            this.aiSaveDraft(t);
            t.chatConvId = c.id;
            t.chatMsgs = c.msgs || [];
            t.chatInput = c.input || '';
            if (c._queue && c._queue.length && !(c._run && c._run.busy)) {
                ELEMENT.Message.info('该对话有 ' + c._queue.length + ' 条排队消息，可在输入框上方发送');
            }
            // 服务端记住当前对话（纯切换不刷新时间，失败不影响使用）
            http.put('/api/ai/convs/' + c.id, { active: true }).catch(function () { /* ignore */ });
            this.scrollAiChat();
        },
        aiConvDelete: function (c) {
            var t = this.activeTab;
            if (!t || !c) {
                return;
            }
            if (c._compacting) {
                ELEMENT.Message.warning('该对话正在压缩上下文，请稍后再删除');
                return;
            }
            if (c._run && c._run.busy) {
                ELEMENT.Message.warning('该对话正在执行中，请先停止再删除');
                return;
            }
            var self = this;
            this.$confirm('删除对话「' + c.title + '」及其记录？', '删除对话', { type: 'warning' })
                .then(function () {
                    return http.delete('/api/ai/convs/' + c.id);
                })
                .then(function () {
                    var i = t.chatConvs.indexOf(c);
                    if (i >= 0) {
                        t.chatConvs.splice(i, 1);
                    }
                    if (!t.chatConvs.length) {
                        // 删光了就再建一个空对话
                        return self.aiConvCreateRemote(t);
                    }
                    if (c.id === t.chatConvId) {
                        var nc = self.chatConvList[0];
                        t.chatConvId = nc.id;
                        t.chatMsgs = nc.msgs || [];
                        t.chatInput = nc.input || '';
                        http.put('/api/ai/convs/' + nc.id, { active: true }).catch(function () { /* ignore */ });
                    }
                    self.scrollAiChat();
                })
                .catch(function () { /* 取消或失败（已提示） */ });
        },
        aiChatSend: function (tab) {
            var t = tab || this.activeTab;
            if (!t) {
                return;
            }
            if (t.chatLoading) {
                ELEMENT.Message.info('对话正在加载，请稍候');
                return;
            }
            if (!t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            var conv = this.aiActiveConv(t);
            if (!conv) {
                ELEMENT.Message.warning('对话未加载成功，请刷新页面或重开标签');
                return;
            }
            this.aiEnsureConvState(conv);
            this.aiConvRead(conv);
            var run = conv._run;
            var text = (t.chatInput || '').trim();
            if (conv._compacting) {
                ELEMENT.Message.info('正在压缩上下文，请稍候再发送');
                return;
            }
            if (run.busy) {
                // 忙碌时按 Enter 不打断当前任务，而是排队到本轮结束自动发送
                if (!text) {
                    return;
                }
                this.aiEnqueue(conv, text);
                conv.input = '';
                t.chatInput = '';
                ELEMENT.Message.success('已排队（' + conv._queue.length + ' 条），本轮结束后自动发送');
                return;
            }
            if (!text) {
                return;
            }
            t.chatInput = '';
            this.aiChatStartRun(t, conv, text, false);
        },
        /* 真正开始一轮对话：追加用户消息、重置运行态并进入 AI 循环 */
        aiChatStartRun: function (t, conv, text, steer) {
            if (!t || !conv || !text) {
                return;
            }
            this.aiEnsureConvState(conv);
            this.aiConvRead(conv);
            var self = this;
            var firstUser = !conv.msgs.some(function (m) {
                return m && m.role === 'user';
            });
            var placeholderTitle = !conv.title || conv.title === '新对话';
            var autoTitle = firstUser && placeholderTitle;
            var run = conv._run;
            var userMsg = { role: 'user', text: text };
            if (steer) {
                userMsg.steer = true;
            }
            conv.msgs.push(userMsg);
            if (placeholderTitle) {
                conv.title = text.slice(0, 20);
            }
            this.aiPushHistory(conv, text);
            conv.updatedAt = Date.now();
            conv.input = '';
            run.stop = false;
            run.step = 0;
            run.phase = '';
            run.streamText = '';
            run.reasonText = '';
            run.requestId = '';
            run.abortController = null;
            run.execController = null;
            run.seq = (run.seq || 0) + 1;
            run.busy = true;
            this.saveConv(t, conv);
            if (autoTitle) {
                // 先写入首条消息的占位标题，再让模型总结；标题保存完成后才发起，避免旧标题覆盖新标题
                this.saveConvTitle(conv, true).then(function () {
                    self.aiConvSummarizeTitle(conv, false, text);
                });
            } else if (placeholderTitle) {
                this.saveConvTitle(conv, true);
            }
            this.scrollAiChat(true);
            this.aiChatLoop(t, conv, run, run.seq);
        },
        /* 插话：中断当前生成/命令，立即以新要求开始下一轮；不进入排队 */
        aiChatSteer: function (text, conv) {
            var t;
            if (conv) {
                t = this.aiTabOfConv(conv);
            } else {
                t = this.activeTab;
                conv = this.aiActiveConv(t);
            }
            if (!t || !conv) {
                return;
            }
            this.aiEnsureConvState(conv);
            var fromInput = text == null;
            var value = (fromInput ? (t.chatInput || '') : text).trim();
            if (!value) {
                ELEMENT.Message.info('请输入要插话的内容');
                return;
            }
            if (conv._compacting) {
                ELEMENT.Message.info('正在压缩上下文，请稍后再插话');
                return;
            }
            if (!t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            var run = conv._run;
            if (!run.busy) {
                if (fromInput) {
                    t.chatInput = value;
                    this.aiChatSend(t);
                } else {
                    if ((t.chatInput || '').trim() === value) {
                        t.chatInput = '';
                    }
                    this.aiChatStartRun(t, conv, value, false);
                }
                return;
            }
            // 先让旧一轮的异步回调全部失效，再通知服务端取消模型/命令
            run.stop = true;
            run.seq = (run.seq || 0) + 1;
            if (run.requestId) {
                var runId = run.requestId;
                run.requestId = '';
                http.post('/api/ai/agent/cancel', { runId: runId }).catch(function () { /* ignore */ });
            }
            var abortStream = run.abortController;
            run.abortController = null;
            if (abortStream) {
                try { abortStream.abort(); } catch (e) { /* ignore */ }
            }
            var abortExec = run.execController;
            run.execController = null;
            if (abortExec) {
                try { abortExec.abort(); } catch (e) { /* ignore */ }
            }
            run.busy = false;
            run.stop = false;
            run.phase = '';
            run.streamText = '';
            run.reasonText = '';
            (conv.msgs || []).forEach(function (m) {
                if (m.role === 'ai' && m.cmd && (m.state === 'confirm' || m.state === 'running')) {
                    m.state = 'skipped';
                    m.error = '已插话，本轮已中断';
                }
            });
            if (fromInput) {
                t.chatInput = '';
            } else if ((t.chatInput || '').trim() === value) {
                t.chatInput = '';
            }
            this.aiChatStartRun(t, conv, value, true);
            ELEMENT.Message.success('已插话，上一轮已中断');
        },
        aiTabOfConv: function (conv) {
            var t = this.activeTab;
            if (!conv) {
                return t;
            }
            if (t && (t.chatConvs || []).some(function (x) { return x.id === conv.id; })) {
                return t;
            }
            return this.tabs.find(function (tab) {
                return (tab.chatConvs || []).some(function (x) { return x.id === conv.id; });
            }) || t;
        },
        aiEnqueue: function (conv, text) {
            if (!conv || !text) {
                return null;
            }
            this.aiEnsureConvState(conv);
            var item = {
                id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                text: text
            };
            conv._queue.push(item);
            return item;
        },
        aiQueueRemove: function (conv, item) {
            if (!conv || !conv._queue || !item) {
                return;
            }
            var i = conv._queue.indexOf(item);
            if (i >= 0) {
                conv._queue.splice(i, 1);
            }
        },
        aiQueueRestore: function (conv, item) {
            if (!conv || !item) {
                return;
            }
            var t = this.aiTabOfConv(conv);
            this.aiQueueRemove(conv, item);
            if (t) {
                t.chatInput = item.text;
            }
            ELEMENT.Message.info('已放回输入框，可编辑后重新发送');
        },
        aiQueueSend: function (conv, item) {
            if (!conv || !item) {
                return;
            }
            if (conv._run && conv._run.busy) {
                this.aiQueueSteer(conv, item);
                return;
            }
            var t = this.aiTabOfConv(conv);
            this.aiQueueRemove(conv, item);
            if (t) {
                t.chatInput = item.text;
                this.aiChatSend(t);
            }
        },
        aiQueueSteer: function (conv, item) {
            if (!conv || !item) {
                return;
            }
            this.aiQueueRemove(conv, item);
            this.aiChatSteer(item.text, conv);
        },
        aiQueueClear: function (conv) {
            if (conv) {
                this.$set(conv, '_queue', []);
            }
        },
        aiChatStop: function (tab) {
            var t = tab || this.activeTab;
            if (!t) {
                return;
            }
            var conv = this.aiActiveConv(t);
            var run = this.aiConvRun(conv);
            if (!conv || !run || !run.busy) {
                return;
            }
            run.stop = true;
            // 先通知服务端取消：断模型连接 / 断 exec 通道，再 abort 浏览器请求
            if (run.requestId) {
                var runId = run.requestId;
                run.requestId = '';
                http.post('/api/ai/agent/cancel', { runId: runId }).catch(function () { /* ignore */ });
            }
            var abortStream = run.abortController;
            run.abortController = null;
            if (abortStream) {
                try { abortStream.abort(); } catch (e) { /* ignore */ }
            }
            var abortExec = run.execController;
            run.execController = null;
            if (abortExec) {
                try { abortExec.abort(); } catch (e) { /* ignore */ }
            }
            run.streamText = '';
            var waitingConfirm = false;
            (conv.msgs || []).forEach(function (m) {
                if (m.state === 'confirm') {
                    m.state = 'skipped';
                    waitingConfirm = true;
                }
            });
            if (waitingConfirm) {
                // 没有请求在途，等待中的确认直接取消
                this.aiChatFinish(t, conv, '已停止');
            } else {
                // 请求在途（命令可能已执行），等结果返回后收尾
                run.phase = '正在停止…';
                this.saveConv(t, conv);
            }
        },
        aiChatLoop: function (t, conv, run, seq) {
            var self = this;
            if (seq !== run.seq) {
                return;
            }
            if (run.stop) {
                this.aiChatFinish(t, conv, '已停止');
                return;
            }
            var limit = this.aiMaxSteps || AI_MAX_STEPS_DEFAULT;
            if (run.step >= limit) {
                this.aiChatFinish(t, conv,
                    '已达单轮 ' + limit + ' 步上限。可点击「继续执行」恢复，或到 AI 设置中调整上限（1-100）',
                    'continue');
                return;
            }
            run.step++;
            run.phase = 'AI 正在生成（第 ' + run.step + '/' + limit + ' 步）…';
            run.streamText = '';
            run.reasonText = '';
            var requestId = newAiRunId();
            run.requestId = requestId;
            if (t.chatConvId === conv.id) {
                this.scrollAiChat();
            }
            this.aiAgentStream(t, conv, run, seq, {
                sessionId: t.sessionId,
                cwd: conv.cwd || '',
                auto: t.chatMode !== 'manual',
                runId: requestId,
                step: run.step,
                messages: this.aiBuildHistory(conv)
            }).then(function (r) {
                if (run.requestId === requestId) {
                    run.requestId = '';
                }
                run.streamText = '';
                if (seq !== run.seq) {
                    return;
                }
                var reasoning = stripDsmlText(run.reasonText || '').trim();
                run.reasonText = '';
                if (!r || !r.kind) {
                    self.aiChatFinish(t, conv, 'AI 未返回有效内容', 'retry');
                    return;
                }
                if (r.kind === 'reply') {
                    conv.msgs.push({ role: 'ai', text: r.text || '（无内容）',
                        reasoning: reasoning, reasonOpen: false, usage: r.usage || null,
                        usageAt: r.usage ? Date.now() : null });
                    self.aiChatFinish(t, conv, '');
                    return;
                }
                // 字段需一次性建全：Vue 2 对后加的属性不做响应式
                var m = {
                    role: 'ai', cmd: r.command, note: r.note || '',
                    state: 'done', output: '', rc: null, truncated: false, timedOut: false, error: '',
                    reasoning: reasoning, reasonOpen: false, durationMs: 0, outOpen: false, outputLines: 0,
                    usage: r.usage || null, usageAt: r.usage ? Date.now() : null
                };
                if (r.needConfirm) {
                    m.state = 'confirm';
                    conv.msgs.push(m);
                    conv.updatedAt = Date.now();
                    if (run.stop) {
                        m.state = 'skipped';
                        self.aiChatFinish(t, conv, '已停止');
                        return;
                    }
                    run.phase = '等待你确认命令…';
                    self.saveConv(t, conv);
                    if (t.chatConvId === conv.id) {
                        self.scrollAiChat();
                    }
                    return;
                }
                self.aiFillCard(conv, m, r);
                self.onAiDesktopMaybeRefresh(t, conv);
                conv.msgs.push(m);
                conv.updatedAt = Date.now();
                self.saveConv(t, conv);
                if (run.stop) {
                    self.aiChatFinish(t, conv, '已停止（本轮命令已执行完）');
                    return;
                }
                self.aiChatLoop(t, conv, run, seq);
            }).catch(function (e) {
                if (run.requestId === requestId) {
                    run.requestId = '';
                }
                run.streamText = '';
                run.reasonText = '';
                if (seq !== run.seq) {
                    return;
                }
                if (run.stop || (e && (e.name === 'AbortError' || e.code === 'ERR_CANCELED'))) {
                    self.aiChatFinish(t, conv, '已停止');
                    return;
                }
                self.aiChatFinish(t, conv,
                    '请求失败：' + ((e && e.message) || '未知错误'), 'retry');
            });
        },
        /* 流式请求一轮 AI 对话：边读 SSE 边更新该对话的预览文本，返回最终结果 */
        aiAgentStream: function (t, conv, run, seq, payload) {
            var self = this;
            if (typeof fetch !== 'function' || typeof TextDecoder === 'undefined') {
                return Promise.reject(new Error('当前浏览器不支持流式输出，请升级浏览器'));
            }
            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            run.abortController = controller;
            var promise = fetch('/api/ai/agent/step/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                body: JSON.stringify(payload),
                signal: controller ? controller.signal : undefined
            }).then(function (resp) {
                if (resp.status === 401) {
                    redirectToLogin();
                    throw new Error('登录已过期，请重新登录');
                }
                var ct = (resp.headers.get('content-type') || '').toLowerCase();
                if (!resp.ok || ct.indexOf('text/event-stream') < 0) {
                    return resp.text().then(function (txt) {
                        throw new Error(self.aiErrorText(txt) || ('HTTP ' + resp.status));
                    });
                }
                if (!resp.body || !resp.body.getReader) {
                    throw new Error('当前浏览器不支持流式输出，请升级浏览器');
                }
                var reader = resp.body.getReader();
                var decoder = new TextDecoder('utf-8');
                var buf = '';
                var result = null;
                var failure = '';
                var lastScroll = 0;

                function handleBlock(block) {
                    var lines = block.split(/\r?\n/);
                    var data = [];
                    lines.forEach(function (line) {
                        if (line.indexOf('data:') === 0) {
                            data.push(line.slice(5).replace(/^ /, ''));
                        }
                    });
                    if (!data.length) {
                        return;
                    }
                    var ev;
                    try {
                        ev = JSON.parse(data.join('\n'));
                    } catch (e) {
                        return;
                    }
                    if (ev.type === 'result') {
                        result = ev.result;
                    } else if (ev.type === 'error') {
                        failure = ev.message || 'AI 请求失败';
                    } else if (ev.type === 'reasoning' && typeof ev.text === 'string') {
                        if (seq !== run.seq || run.stop) {
                            return;
                        }
                        // 思考过程只做展示，限制最大长度，避免异常服务无限刷屏
                        if ((run.reasonText || '').length < 30000) {
                            run.reasonText = (run.reasonText || '') + ev.text;
                        }
                        var nowR = Date.now();
                        if (t.chatConvId === conv.id && nowR - lastScroll > 120) {
                            lastScroll = nowR;
                            self.scrollAiChat();
                        }
                    } else if (ev.type === 'delta' && typeof ev.text === 'string') {
                        if (seq !== run.seq || run.stop) {
                            return;
                        }
                        run.streamText += ev.text;
                        var now = Date.now();
                        if (t.chatConvId === conv.id && now - lastScroll > 60) {
                            lastScroll = now;
                            self.scrollAiChat();
                        }
                    }
                }

                function pump() {
                    return reader.read().then(function (r) {
                        if (r.done) {
                            buf += decoder.decode();
                            if (buf.trim()) {
                                handleBlock(buf);
                            }
                            if (failure) {
                                throw new Error(failure);
                            }
                            if (!result) {
                                throw new Error('流式响应中断，未收到结果');
                            }
                            return result;
                        }
                        buf += decoder.decode(r.value, { stream: true });
                        buf = buf.replace(/\r\n/g, '\n');
                        var idx;
                        while ((idx = buf.indexOf('\n\n')) >= 0) {
                            handleBlock(buf.slice(0, idx));
                            buf = buf.slice(idx + 2);
                        }
                        return pump();
                    });
                }

                return pump();
            });
            return promise.then(function (r) {
                if (run.abortController === controller) {
                    run.abortController = null;
                }
                return r;
            }, function (e) {
                if (run.abortController === controller) {
                    run.abortController = null;
                }
                throw e;
            });
        },
        aiErrorText: function (txt) {
            if (!txt) {
                return '';
            }
            try {
                var d = JSON.parse(txt);
                return d.msg || (d.error && d.error.message) || '';
            } catch (e) {
                return txt.length > 300 ? txt.slice(0, 300) + '…' : txt;
            }
        },
        aiChatConfirm: function (m, allow) {
            var t = this.activeTab;
            if (!t || !m || m.state !== 'confirm') {
                return;
            }
            var conv = null;
            (t.chatConvs || []).some(function (c) {
                if (c.msgs && c.msgs.indexOf(m) >= 0) {
                    conv = c;
                    return true;
                }
                return false;
            });
            if (!conv) {
                return;
            }
            var run = this.aiConvRun(conv);
            if (!run || !run.busy) {
                return;
            }
            if (!allow) {
                m.state = 'skipped';
                this.saveConv(t, conv);
                this.aiChatLoop(t, conv, run, run.seq);
                return;
            }
            var self = this;
            var seq = run.seq;
            m.state = 'running';
            run.phase = '正在执行命令…';
            var requestId = newAiRunId();
            run.requestId = requestId;
            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            run.execController = controller;
            this.saveConv(t, conv);
            if (t.chatConvId === conv.id) {
                this.scrollAiChat();
            }
            http.post('/api/ai/agent/exec', {
                sessionId: t.sessionId,
                cwd: conv.cwd || '',
                command: m.cmd,
                runId: requestId
            }, controller ? { signal: controller.signal } : undefined).then(function (r) {
                if (run.execController === controller) {
                    run.execController = null;
                }
                if (run.requestId === requestId) {
                    run.requestId = '';
                }
                if (seq !== run.seq) {
                    return;
                }
                self.aiFillCard(conv, m, r || {});
                self.onAiDesktopMaybeRefresh(t, conv);
                conv.updatedAt = Date.now();
                self.saveConv(t, conv);
                if (run.stop) {
                    self.aiChatFinish(t, conv, '已停止');
                    return;
                }
                self.aiChatLoop(t, conv, run, seq);
            }).catch(function (e) {
                if (run.execController === controller) {
                    run.execController = null;
                }
                if (run.requestId === requestId) {
                    run.requestId = '';
                }
                if (seq !== run.seq) {
                    return;
                }
                if (run.stop || (e && (e.name === 'CanceledError' || e.code === 'ERR_CANCELED' || e.name === 'AbortError'))) {
                    m.state = 'done';
                    m.error = '已停止';
                    self.saveConv(t, conv);
                    self.aiChatFinish(t, conv, '已停止');
                    return;
                }
                m.state = 'done';
                m.error = '命令执行失败：' + ((e && e.message) || '未知错误');
                self.saveConv(t, conv);
                self.aiChatFinish(t, conv, '');
            });
        },
        /* 步数上限后的「继续执行」：追加一条明确指令，重新获得一整轮步数 */
        aiChatContinue: function (m) {
            var t = this.activeTab;
            if (!t) {
                return;
            }
            var conv = this.aiConvOfMessage(t, m);
            if (!conv) {
                return;
            }
            this.aiOpenConvForAction(t, conv);
            var run = this.aiConvRun(conv);
            if (run && run.busy) {
                ELEMENT.Message.warning('AI 正在执行，请稍候');
                return;
            }
            this.$set(m, 'action', '');
            this.saveConv(t, conv);
            t.chatInput = '（继续）请基于当前进度继续完成任务。';
            this.aiChatSend();
        },
        /* 请求失败后的「重试」：沿用当前历史直接再请求一次，不重复添加用户消息 */
        aiChatRetry: function (m) {
            var t = this.activeTab;
            if (!t) {
                return;
            }
            var conv = this.aiConvOfMessage(t, m);
            if (!conv) {
                return;
            }
            this.aiOpenConvForAction(t, conv);
            this.aiEnsureConvState(conv);
            var run = conv._run;
            if (run.busy) {
                return;
            }
            this.$set(m, 'action', '');
            // 极端情况下（错误提示之后又产生了回复）最后一条不是用户消息，补一条再重试
            var hist = this.aiBuildHistory(conv);
            if (!hist.length || hist[hist.length - 1].role !== 'user') {
                conv.msgs.push({ role: 'user', text: '（继续）请重新执行上一步请求。' });
            }
            run.stop = false;
            run.step = 0;
            run.seq = (run.seq || 0) + 1;
            run.streamText = '';
            run.reasonText = '';
            run.phase = '正在重试…';
            run.busy = true;
            this.saveConv(t, conv);
            this.aiChatLoop(t, conv, run, run.seq);
        },
        aiFillCard: function (conv, m, r) {
            m.state = 'done';
            m.output = r.output || '';
            m.rc = (r.exitCode == null) ? null : r.exitCode;
            m.truncated = !!r.truncated;
            m.timedOut = !!r.timedOut;
            m.error = r.error || '';
            m.durationMs = r.durationMs == null ? 0 : r.durationMs;
            m.outputLines = m.output ? m.output.replace(/\n$/, '').split('\n').length : 0;
            if (!m.note && r.note) {
                m.note = r.note;
            }
            if (r.cwd) {
                conv.cwd = r.cwd;
            }
            var t = this.activeTab;
            if (t && t.chatConvId === conv.id) {
                this.scrollAiChat();
            }
        },
        aiChatFinish: function (t, conv, note, action) {
            var run = this.aiConvRun(conv);
            if (run) {
                run.busy = false;
                run.stop = false;
                run.phase = '';
                run.streamText = '';
                run.reasonText = '';
                run.requestId = '';
                run.abortController = null;
                run.execController = null;
            }
            if (conv) {
                if (note) {
                    var noteItem = { role: 'note', text: note, action: action || '' };
                    if (note.indexOf('尚未配置 API Key') >= 0) {
                        noteItem.code = 'noApiKey';
                        noteItem.action = 'aiSetup';
                    }
                    conv.msgs.push(noteItem);
                }
                conv.updatedAt = Date.now();
                // 对话不在当前可见的会话/标签页，或页面在后台时留一个未读亮点，点开后清除
                if (!t || t !== this.activeTab || t.chatConvId !== conv.id || document.hidden) {
                    this.$set(conv, 'unread', true);
                }
            }
            this.saveConv(t, conv);
            if (t && conv && t.chatConvId === conv.id) {
                this.scrollAiChat();
            }
            // 本轮正常结束后自动发送队首消息；输入框里新打的草稿会追加到队尾，不覆盖
            if (conv && !note && conv._queue && conv._queue.length && t && t.chatConvId === conv.id
                    && t.sessionId && run && !run.busy) {
                var draft = (t.chatInput || '').trim();
                if (draft) {
                    this.aiEnqueue(conv, draft);
                    t.chatInput = '';
                }
                var queued = conv._queue.shift();
                t.chatInput = queued.text;
                var self = this;
                this.$nextTick(function () {
                    if (t.chatConvId === conv.id && t.chatInput === queued.text
                            && conv._run && !conv._run.busy) {
                        self.aiChatSend(t);
                    }
                });
            }
        },
        /* 把某个对话拼成发给模型的消息序列（assistant=模型的 JSON 命令 / 回复，user=命令执行结果） */
        aiBuildHistory: function (conv) {
            return this.aiHistoryEntries((conv && conv.msgs) || []);
        },
        aiToolResult: function (m) {
            var lines = ['[命令执行结果]', '$ ' + m.cmd, '退出码: ' + (m.rc == null ? '未知' : m.rc)];
            if (m.cwd) {
                lines.push('执行后目录: ' + m.cwd);
            }
            var out = m.error ? m.error : (m.output || '');
            if (!out.trim()) {
                out = '（无输出）';
            } else if (out.length > 4500) {
                out = out.slice(0, 3000) + '\n…（中间省略 ' + (out.length - 4500) + ' 字）…\n' + out.slice(-1500);
            }
            lines.push(out);
            return lines.join('\n');
        },
        fmtChatTime: function (ms) {
            if (!ms) {
                return '';
            }
            var d = new Date(ms);
            var n = new Date();
            var p = function (x) { return (x < 10 ? '0' : '') + x; };
            var hm = p(d.getHours()) + ':' + p(d.getMinutes());
            if (d.toDateString() === n.toDateString()) {
                return hm;
            }
            return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm;
        },
        scrollAiChat: function (force) {
            var self = this;
            this.$nextTick(function () {
                var panels = [];
                if (self.$refs.aiChatPanel) {
                    panels.push(self.$refs.aiChatPanel);
                }
                var winPanel = self.$refs.aiChatWinPanel;
                if (Array.isArray(winPanel)) {
                    panels = panels.concat(winPanel);
                } else if (winPanel) {
                    panels.push(winPanel);
                }
                panels.forEach(function (p) {
                    if (p && p.scrollToBottom) {
                        p.scrollToBottom(force);
                    }
                });
            });
        },

        /* ---------- AI 可视化桌面（Windows 资源管理器式文件页） ---------- */
        openDesktopAfterConnect: function (tab, dirReady) {
            var self = this;
            Promise.resolve(dirReady).then(function () {
                if (tab.status !== 'open' || self.activeKey !== tab.key) {
                    return;
                }
                self.openAiDesktop(tab);
            });
        },
        openAiDesktop: function (tab) {
            var t = tab || this.activeTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            this.desktop.local = false;
            // 终端页的气泡是 body 级浮层，进入桌面后会盖在桌面上，先关闭
            this.transferCenterOpen = false;
            // 同一连接可能在多个标签打开，进入桌面时以存储中的最新背景为准
            t.desktopBg = loadDesktopBgSettings(t.connId);
            var conv = this.aiActiveConv(t);
            var p = t.desktopOpenPath || (conv && conv.cwd) || t.termCwd || t.sftpPath || t.sftpHome || '/';
            t.desktopOpenPath = '';
            var self = this;
            if (!this.desktop.visible || this.desktop.tabKey !== t.key) {
                this.resetDesktopShell(t);
                this.desktop.visible = true;
                this.startDesktopClock();
                this.loadDesktopSurface();
                this.$nextTick(function () {
                    if (!self.desktop.visible) {
                        return;
                    }
                    self.restoreDesktopExplorerSession(p);
                    self.applyDesktopStartupApps();
                    if (self.$refs.desktopRoot) {
                        self.$refs.desktopRoot.focus();
                    }
                });
                return;
            }
            // 已经在该连接的桌面里：再开一个资源管理器窗口
            this.openDesktopWindow(this.desk.path || p);
        },
        /* 直接进入本地桌面：不建立 SSH 会话，文件都放在数据目录的 Desktop 沙箱 */
        openLocalDesktop: function () {
            var t = this.localDesktopTab;
            this.transferCenterOpen = false;
            t.desktopBg = loadDesktopBgSettings(null);
            this.desktop.local = true;
            this.resetDesktopShell(t);
            this.desktop.visible = true;
            if (window.history && history.replaceState) {
                history.replaceState(null, '', '/workspace?local=1');
            }
            this.startDesktopClock();
            this.loadDesktopSurface();
            var self = this;
            this.$nextTick(function () {
                if (!self.desktop.visible) {
                    return;
                }
                self.restoreDesktopExplorerSession('/');
                self.applyDesktopStartupApps();
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
        },
        enterLocalDesktop: function () {
            this.connectDialogVisible = false;
            if (this.desktop.visible) {
                if (this.desktop.local) {
                    ELEMENT.Message.info('当前已经是本地桌面');
                    return;
                }
                if (!window.open('/workspace?local=1', 'deepshell-desktop-local')) {
                    ELEMENT.Message.warning('浏览器拦截了新标签页，请允许弹出窗口后重试');
                }
                return;
            }
            this.openLocalDesktop();
        },
        desktopServerReady: function () {
            if (this.desktop.local) {
                ELEMENT.Message.warning('本地桌面未连接服务器，该功能需要先连接服务器');
                return false;
            }
            return true;
        },
        desktopAppBlocked: function (id) {
            if (!this.desktop.local) {
                return false;
            }
            return ['ai', 'taskmgr', 'services', 'nettool', 'batchcmd',
                'dirs', 'cmd', 'disk', 'trash', 'sysinfo', 'newTerminal'].indexOf(id) >= 0;
        },
        resetDesktopShell: function (t) {
            var self = this;
            this.stopDesktopWindowGestures();
            this.cancelDesktopMarquee();
            this.cancelDesktopIconMarquee();
            this.closeDesktopSubMenus();
            this.resetTaskmgrState();
            this.cancelDesktopThumbQueue();
            this.disconnectDesktopThumbObserver();
            this.resetSurfaceThumbs();
            this.desktop.windows.forEach(function (w) {
                self.releaseDesktopWindowThumbs(w);
                if (w.type === 'terminal') {
                    self.closeDesktopTerminal(w);
                }
            });
            this.desktop.windows = [];
            this.desktop.activeWinId = '';
            this.desktop.explorerId = '';
            this.desktop.zSeq = 0;
            this.desktop.showDesktopIds = [];
            this.desktop.taskbarMenu.visible = false;
            this.desktop.trayMenu.visible = false;
            this.desktop.tabKey = t ? t.key : '';
            this.desktop.surface = { dir: '', loading: false, error: '', loaded: false, entries: [] };
            this.desktop.iconLayout = [];
            this.desktop.iconOrder = [];
            this.desktop.iconHidden = [];
            this.desktop.iconSelected = '';
            this.desktop.iconSelectedKeys = [];
            this.desktop.iconMarquee.visible = false;
            this.desktop.focusSurface = false;
            this.desktop.iconDragKey = '';
            this.desktop.iconDropKey = '';
            this.desktop.iconMenu.visible = false;
            this.desktop.archiveWin = null;
            this.desktop.menu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.taskMenu.visible = false;
            this.desktop.propsVisible = false;
            this.desktop.props = null;
            this.desktop.settingsVisible = false;
            this.desktop.startOpen = false;
            this.desktop.powerOpen = false;
            this.desktop.calendarOpen = false;
            this.desktop.calendarSelected = '';
            this.desktop.startSearch = '';
            this.desktop.startResults = [];
            this.desktop.startSearched = false;
            this.desktop.startError = '';
            this.desktop.startSearching = false;
            this._deskSearchSeq = (this._deskSearchSeq || 0) + 1;
            this._deskLastActivity = Date.now();
            if (t && t.connId != null
                    && !Object.prototype.hasOwnProperty.call(this.commonDirsByConn, t.connId)) {
                this.loadCommonDirs(t.connId);
            }
        },
        closeAiDesktop: function (skipSftpRefresh) {
            if (!skipSftpRefresh && !this._forceCloseDesktop) {
                var dirtyEditors = this.desktop.windows.filter(function (w) {
                    return w.type === 'editor' && w.editorDirty;
                });
                if (dirtyEditors.length) {
                    var topSelf = this;
                    this.$confirm('有 ' + dirtyEditors.length
                        + ' 个编辑器窗口未保存，返回工作台将丢弃修改，确定？', '未保存的修改', {
                        type: 'warning',
                        confirmButtonText: '放弃并返回',
                        cancelButtonText: '继续编辑'
                    }).then(function () {
                        topSelf._forceCloseDesktop = true;
                        topSelf.closeAiDesktop();
                    }).catch(function () { /* 继续编辑 */ });
                    return;
                }
            }
            this._forceCloseDesktop = false;
            this.saveDesktopWinLayouts();
            this.stopDesktopWindowGestures();
            this.stopDesktopDragScroll();
            this.stopDesktopClock();
            this.resetTaskmgrState();
            this.stopNetTraffic();
            this._netTrafficSession = '';
            this.cancelDesktopMarquee();
            this.cancelDesktopIconMarquee();
            this.cancelDesktopThumbQueue();
            this.disconnectDesktopThumbObserver();
            this.resetSurfaceThumbs();
            var self = this;
            this.desktop.windows.forEach(function (w) {
                self.releaseDesktopWindowThumbs(w);
                if (w.type === 'terminal') {
                    self.closeDesktopTerminal(w);
                }
            });
            this._deskSearchSeq = (this._deskSearchSeq || 0) + 1;
            if (this.desktop.local && window.history && history.replaceState) {
                history.replaceState(null, '', '/workspace');
            }
            this.desktop.local = false;
            this.desktop.visible = false;
            this.desktop.windows = [];
            this.desktop.activeWinId = '';
            this.desktop.explorerId = '';
            this.desktop.showDesktopIds = [];
            this.desktop.menu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.taskMenu.visible = false;
            this.desktop.taskbarMenu.visible = false;
            this.desktop.trayMenu.visible = false;
            this.desktop.startOpen = false;
            this.desktopAppProps.visible = false;
            this.desktop.startSearch = '';
            this.desktop.startResults = [];
            this.desktop.startSearched = false;
            this.desktop.startError = '';
            this.desktop.startSearching = false;
            this.desktop.settingsVisible = false;
            this.desktop.powerOpen = false;
            this.desktop.calendarOpen = false;
            this.closeDesktopSubMenus();
            this.$nextTick(function () {
                var t = self.activeTab;
                if (t && t.term) {
                    try { t.term.focus(); } catch (e) { /* ignore */ }
                }
                // 桌面里可能新建 / 删除 / 移动过文件，返回时刷新 SFTP 面板（关机 / 断开前跳过）
                if (!skipSftpRefresh && t && t.sessionId && t.sftpPath) {
                    self.loadDir(t.sftpPath, t);
                }
            });
        },

        /* ---------- 桌面窗口管理 ---------- */
        desktopWindowById: function (id) {
            if (!id) {
                return null;
            }
            for (var i = 0; i < this.desktop.windows.length; i++) {
                if (this.desktop.windows[i].id === id) {
                    return this.desktop.windows[i];
                }
            }
            return null;
        },
        desktopTerminalFocusTab: function () {
            if (!this.desktop.visible) {
                return null;
            }
            var w = this.desktopWindowById(this.desktop.activeWinId);
            return w && w.type === 'terminal' && w.termTab ? w.termTab : null;
        },
        desktopWindowIcon: function (w) {
            var type = (w && w.type) || 'explorer';
            var appAction = ({
                explorer: 'explorer',
                trash: 'trash',
                editor: 'editor',
                terminal: 'terminal',
                transfer: 'transfers',
                ai: 'ai'
            })[type];
            if (appAction) {
                return this.desktopAppIconByAction(appAction, 'el-icon-folder-opened');
            }
            if (type === 'disk') {
                return 'el-icon-pie-chart';
            }
            if (type === 'taskmgr') {
                return 'el-icon-cpu';
            }
            if (type === 'services') {
                return 'el-icon-s-tools';
            }
            if (type === 'appcenter') {
                return this.desktopAppIconByAction('appcenter', 'el-icon-shopping-bag-1');
            }
            if (type === 'nettool') {
                return 'dsk-ico-network';
            }
            if (type === 'batchcmd') {
                return 'el-icon-copy-document';
            }
            if (type === 'connect') {
                return 'el-icon-connection';
            }
            if (type === 'dirs') {
                return 'el-icon-star-off';
            }
            if (type === 'cmd') {
                return 'el-icon-caret-right';
            }
            if (type === 'plugin') {
                return 'el-icon-s-grid';
            }
            return 'el-icon-folder-opened';
        },
        desktopBaseName: function (path) {
            var p = String(path || '');
            var idx = p.lastIndexOf('/');
            return idx >= 0 ? (p.substring(idx + 1) || '/') : p;
        },
        desktopWindowTitle: function (w) {
            if (w && w.type === 'ai') {
                return 'AI 终端';
            }
            if (w && w.type === 'terminal') {
                return w.termTab ? w.termTab.title : '终端';
            }
            if (w && w.type === 'transfer') {
                return '传输中心';
            }
            if (w && w.type === 'disk') {
                return '磁盘';
            }
            if (w && w.type === 'taskmgr') {
                return '任务管理器';
            }
            if (w && w.type === 'services') {
                return '服务与计划任务';
            }
            if (w && w.type === 'appcenter') {
                return '应用中心';
            }
            if (w && w.type === 'nettool') {
                return '网络工具箱';
            }
            if (w && w.type === 'batchcmd') {
                return '多机命令';
            }
            if (w && w.type === 'connect') {
                return '连接管理';
            }
            if (w && w.type === 'dirs') {
                return '常用目录';
            }
            if (w && w.type === 'cmd') {
                return '快捷命令';
            }
            if (w && w.type === 'plugin') {
                return w.pluginTitle || w.pluginName || '插件应用';
            }
            if (w && w.type === 'editor') {
                var editorName = w.editorTitle || this.desktopBaseName(w.editorPath) || '文本编辑器';
                return w.editorDirty ? editorName + ' •' : editorName;
            }
            if (w && w.type === 'trash') {
                return '回收站';
            }
            var p = (w && w.path) || '';
            if (!p || p === '/') {
                return '/';
            }
            var idx = p.lastIndexOf('/');
            return idx >= 0 ? (p.substring(idx + 1) || '/') : p;
        },
        desktopWindowSubtitle: function (w) {
            var host = this.desktopTab ? this.desktopTab.host : '';
            if (w && w.type === 'terminal') {
                var tab = w.termTab;
                if (!tab) {
                    return '';
                }
                if (tab.localShell) {
                    return '本地 Shell · ' + this.statusText(tab);
                }
                var addr = tab.host ? (tab.host + ':' + (tab.port || 22)) : '';
                return '终端 · ' + (addr ? addr + ' · ' : '') + this.statusText(tab);
            }
            if (w && w.type === 'transfer') {
                var busy = this.transferActiveCount;
                var text = busy ? '全部会话 · 进行中 ' + busy : '全部会话';
                return host ? host + ' · ' + text : text;
            }
            if (w && w.type === 'disk') {
                var diskText = '磁盘占用分析';
                var diskPath = w.diskPath || '';
                if (diskPath) {
                    diskText += ' · ' + diskPath;
                }
                return host ? host + ' · ' + diskText : diskText;
            }
            if (w && w.type === 'taskmgr') {
                return host ? host + ' · 进程与性能' : '进程与性能';
            }
            if (w && w.type === 'services') {
                var svcText = this.servicesApp.tab === 'cron'
                    ? '计划任务' : (this.servicesApp.items.length + ' 个服务');
                return host ? host + ' · ' + svcText : svcText;
            }
            if (w && w.type === 'appcenter') {
                return host ? host + ' · 功能建设中' : '功能建设中';
            }
            if (w && w.type === 'nettool') {
                var netText;
                if (this.netTool.tab === 'traffic') {
                    netText = '实时流量' + (this.netTool.traffic.data
                        ? ' · ' + (this.netTool.traffic.data.programCount || 0) + ' 个程序'
                        : '');
                } else if (this.netTool.tab === 'ports') {
                    var ports = this.netTool.ports.data && Array.isArray(this.netTool.ports.data.ports)
                        ? this.netTool.ports.data.ports.length : 0;
                    netText = '端口与防火墙' + (ports ? ' · ' + ports + ' 个端口' : '');
                } else {
                    netText = '连通性测试' + (this.netTool.target ? ' · ' + this.netTool.target : '');
                }
                return host ? host + ' · ' + netText : netText;
            }
            if (w && w.type === 'batchcmd') {
                return (this.batchCmd.ids.length || 0) + ' 台服务器'
                    + (host ? ' · 当前 ' + host : '');
            }
            if (w && w.type === 'trash') {
                var trashText = ((w.trashItems || []).length) + ' 项';
                return host ? host + ' · ' + trashText : '回收站 · ' + trashText;
            }
            if (w && w.type === 'connect') {
                return this.connections.length + ' 个连接 · ' + this.folders.length + ' 个文件夹';
            }
            if (w && w.type === 'dirs') {
                return this.commonDirs.length + ' 个目录' + (host ? ' · ' + host : '');
            }
            if (w && w.type === 'cmd') {
                return this.snippets.length + ' 条命令' + (host ? ' · ' + host : '');
            }
            if (w && w.type === 'ai') {
                var t = this.desktopTab;
                var conv = t ? this.aiActiveConv(t) : null;
                var title = conv && conv.title ? conv.title : '';
                return host ? (title ? host + ' · ' + title : host) : title;
            }
            if (w && w.type === 'plugin') {
                var ver = w.pluginVersion ? ' · v' + w.pluginVersion : '';
                var trust = w.pluginVerified ? ' · 官方签名' : ' · 未验证';
                var backend = w.pluginBackend ? ' · 后端模块' : '';
                return '桌面插件' + ver + trust + backend + ' · 沙箱运行';
            }
            if (w && w.type === 'editor') {
                return '文本编辑器 · ' + (w.editorSubtitle || w.editorPath || '未命名');
            }
            var path = (w && w.path) || '';
            return host ? (path ? host + ' · ' + path : host) : path;
        },
        desktopWindowStyle: function (w) {
            if (!w) {
                return {};
            }
            if (w.max) {
                return { zIndex: w.z };
            }
            return {
                left: w.x + 'px',
                top: w.y + 'px',
                width: w.w + 'px',
                height: w.h + 'px',
                zIndex: w.z
            };
        },
        desktopLayoutKey: function () {
            var t = this.desktopTab;
            if (!t) {
                return '';
            }
            return 'deepshell.desktopWinLayout.' + (t.connId != null ? t.connId : t.key);
        },
        loadDesktopWinLayouts: function () {
            var key = this.desktopLayoutKey();
            if (!key) {
                return [];
            }
            try {
                var arr = JSON.parse(localStorage.getItem(key) || '[]');
                return Array.isArray(arr) ? arr : [];
            } catch (e) {
                return [];
            }
        },
        saveDesktopWinLayouts: function () {
            if (!this.desktop.visible) {
                return;
            }
            var key = this.desktopLayoutKey();
            if (!key) {
                return;
            }
            var list = this.desktop.windows.filter(function (w) {
                return w.type === 'explorer';
            }).map(function (w) {
                var g = w.max && w.normal ? w.normal : { x: w.x, y: w.y, w: w.w, h: w.h };
                return {
                    x: Math.round(g.x || 0),
                    y: Math.round(g.y || 0),
                    w: Math.round(g.w || 0),
                    h: Math.round(g.h || 0),
                    max: !!w.max,
                    path: w.path || ''
                };
            });
            try {
                localStorage.setItem(key, JSON.stringify(list));
            } catch (e) { /* ignore */ }
        },
        scheduleSaveDesktopWinLayouts: function () {
            var self = this;
            if (this._deskLayoutTimer) {
                clearTimeout(this._deskLayoutTimer);
            }
            this._deskLayoutTimer = setTimeout(function () {
                self._deskLayoutTimer = null;
                self.saveDesktopWinLayouts();
            }, 250);
        },
        restoreDesktopExplorerSession: function (defaultPath) {
            var list = this.loadDesktopWinLayouts().filter(function (e) {
                return e && e.path;
            }).slice(0, 6);
            if (!list.length) {
                this.openDesktopWindow(defaultPath, true);
                return false;
            }
            var self = this;
            list.forEach(function (e, i) {
                var w = self.openDesktopWindow(e.path, i === 0);
                if (!w) {
                    return;
                }
                self.applyDesktopWindowGeometry(w, e);
                w.max = !!e.max;
                w.z = ++self.desktop.zSeq;
                if (i === list.length - 1) {
                    self.desktop.activeWinId = w.id;
                    self.desktop.explorerId = w.id;
                }
            });
            return true;
        },
        desktopWindowWorkArea: function () {
            var root = this.$refs.desktopRoot;
            var width = root ? root.clientWidth : window.innerWidth;
            var height = root ? root.clientHeight : window.innerHeight;
            return {
                width: Math.max(320, width),
                height: Math.max(220, height - 48)
            };
        },
        desktopDefaultWindowGeometry: function (index) {
            var area = this.desktopWindowWorkArea();
            var narrow = area.width < 760;
            var width = narrow ? area.width
                : Math.min(1100, Math.max(720, Math.round(area.width * 0.68)));
            var height = narrow ? area.height
                : Math.min(780, Math.max(480, Math.round(area.height * 0.78)));
            width = Math.max(Math.min(520, area.width), Math.min(width, area.width - 16));
            height = Math.max(Math.min(320, area.height), Math.min(height, area.height - 16));
            var x = Math.round((area.width - width) / 2) + (index || 0) * 26;
            var y = Math.round((area.height - height) / 2) + (index || 0) * 26;
            x = Math.max(0, Math.min(x, area.width - width));
            y = Math.max(0, Math.min(y, area.height - height));
            return { x: x, y: y, w: width, h: height, max: narrow };
        },
        applyDesktopWindowGeometry: function (w, layout) {
            var area = this.desktopWindowWorkArea();
            var g = layout || this.desktopDefaultWindowGeometry(this.desktop.windows.length - 1);
            var minW = Math.min(520, area.width);
            var minH = Math.min(320, area.height);
            var width = Math.min(Math.max(Number(g.w) || minW, minW), area.width);
            var height = Math.min(Math.max(Number(g.h) || minH, minH), area.height);
            var x = Math.max(0, Math.min(Number(g.x) || 0, area.width - width));
            var y = Math.max(0, Math.min(Number(g.y) || 0, area.height - height));
            w.x = Math.round(x);
            w.y = Math.round(y);
            w.w = Math.round(width);
            w.h = Math.round(height);
            w.normal = { x: w.x, y: w.y, w: w.w, h: w.h };
            w.max = !!g.max || area.width < 760;
        },
        addDesktopWindow: function (type, first) {
            var seq = (this._deskWinSeq || 0) + 1;
            this._deskWinSeq = seq;
            var w = createDesktopWindow('dw' + seq);
            w.type = type || 'explorer';
            w.tmPid = 4200 + seq * 4;
            w.viewMode = loadDesktopView();
            this.trackTaskmgrAppLaunch(w.type);
            var layouts = null;
            if (w.type === 'explorer') {
                layouts = this.loadDesktopWinLayouts();
            }
            this.desktop.windows.push(w);
            var layout = null;
            if (w.type === 'explorer') {
                var explorerIndex = 0;
                for (var i = 0; i < this.desktop.windows.length; i++) {
                    if (this.desktop.windows[i].type === 'explorer') {
                        explorerIndex++;
                    }
                }
                explorerIndex -= 1;
                layout = first ? (layouts[0] || null) : (layouts[explorerIndex] || null);
            }
            this.applyDesktopWindowGeometry(w, layout);
            w.z = ++this.desktop.zSeq;
            this.desktop.activeWinId = w.id;
            if (w.type === 'explorer') {
                this.desktop.explorerId = w.id;
            }
            this.desktop.showDesktopIds = [];
            this.desktop.menu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.startOpen = false;
            this.closeDesktopSubMenus();
            return w;
        },
        openDesktopWindow: function (path, first) {
            var t = this.desktopTab;
            if (!t || (!t.local && !t.sessionId) || !this.desktop.visible) {
                return null;
            }
            var w = this.addDesktopWindow('explorer', first);
            this.loadDesktopDir(path || this.desktopHomeDir || '/', null, w);
            var self = this;
            this.$nextTick(function () {
                self.setupDesktopThumbs(w);
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
            return w;
        },
        openAiDesktopWindow: function () {
            if (!this.desktop.visible) {
                return null;
            }
            if (!this.desktopServerReady()) {
                return null;
            }
            var existing = this.desktopAiWin;
            if (existing) {
                this.restoreDesktopWindow(existing);
                return existing;
            }
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return null;
            }
            var w = this.addDesktopWindow('ai');
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
            return w;
        },
        toggleDesktopAiApp: function () {
            var w = this.desktopAiWin;
            if (!w) {
                this.openAiDesktopWindow();
                return;
            }
            this.toggleDesktopTaskbarWindow(w);
        },
        openTransferDesktopWindow: function () {
            if (!this.desktop.visible) {
                return null;
            }
            var existing = this.desktopTransferWin;
            if (existing) {
                this.restoreDesktopWindow(existing);
                return existing;
            }
            var w = this.addDesktopWindow('transfer');
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
            return w;
        },
        openDesktopConnectionWindow: function () {
            if (!this.desktop.visible) {
                return null;
            }
            this.desktop.startOpen = false;
            this.desktop.settingsVisible = false;
            this.loadConnections();
            this.loadFolders();
            var existing = this.desktopConnWin;
            if (existing) {
                this.restoreDesktopWindow(existing);
                return existing;
            }
            var w = this.addDesktopWindow('connect');
            var area = this.desktopWindowWorkArea();
            var width = Math.min(area.width - 20, 640);
            var height = Math.min(area.height - 20, Math.max(420, Math.round(area.height * 0.8)));
            this.applyDesktopWindowGeometry(w, {
                x: Math.round((area.width - width) / 2),
                y: Math.round((area.height - height) / 2),
                w: width,
                h: height
            });
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
            return w;
        },
        desktopConnOpen: function (row) {
            if (!row || row.id == null) {
                return;
            }
            if (this.openDesktopTabForConn(row.id)) {
                ELEMENT.Message.success('已在新标签页打开「' + row.name + '」的 AI 桌面');
            }
        },
        openDesktopTabForConn: function (connId, path) {
            if (connId == null) {
                return false;
            }
            var url = '/workspace?connId=' + encodeURIComponent(connId) + '&view=desktop';
            if (path) {
                url += '&path=' + encodeURIComponent(path);
            }
            var win = window.open(url, 'deepshell-desktop-' + connId);
            if (!win) {
                ELEMENT.Message.warning('浏览器拦截了新标签页，请允许弹出窗口后重试');
                return false;
            }
            return true;
        },
        desktopWindowOfType: function (type) {
            for (var i = 0; i < this.desktop.windows.length; i++) {
                if (this.desktop.windows[i].type === type) {
                    return this.desktop.windows[i];
                }
            }
            return null;
        },
        centerDesktopWindow: function (w, width, height) {
            var area = this.desktopWindowWorkArea();
            var ww = Math.min(area.width - 20, width);
            var wh = Math.min(area.height - 20, height);
            this.applyDesktopWindowGeometry(w, {
                x: Math.round((area.width - ww) / 2),
                y: Math.round((area.height - wh) / 2),
                w: ww,
                h: wh
            });
        },
        openDesktopDirsWindow: function () {
            if (!this.desktop.visible) {
                return null;
            }
            if (!this.desktopServerReady()) {
                return null;
            }
            var t = this.desktopTab;
            if (t && t.connId != null) {
                this.loadCommonDirs(t.connId);
            }
            var existing = this.desktopWindowOfType('dirs');
            if (existing) {
                this.restoreDesktopWindow(existing);
                return existing;
            }
            var area = this.desktopWindowWorkArea();
            var w = this.addDesktopWindow('dirs');
            this.centerDesktopWindow(w, 480, Math.max(380, Math.round(area.height * 0.62)));
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
            return w;
        },
        openDesktopCommandsWindow: function () {
            if (!this.desktop.visible) {
                return null;
            }
            if (!this.desktopServerReady()) {
                return null;
            }
            this.loadSnippets();
            var existing = this.desktopWindowOfType('cmd');
            if (existing) {
                this.restoreDesktopWindow(existing);
                return existing;
            }
            var area = this.desktopWindowWorkArea();
            var w = this.addDesktopWindow('cmd');
            this.centerDesktopWindow(w, 620, Math.max(420, Math.round(area.height * 0.72)));
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
            return w;
        },
        openDiskDesktopWindow: function () {
            if (!this.desktop.visible) {
                return null;
            }
            if (!this.desktopServerReady()) {
                return null;
            }
            var existing = this.desktopDiskWin;
            if (existing) {
                this.restoreDesktopWindow(existing);
                return existing;
            }
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return null;
            }
            var w = this.addDesktopWindow('disk');
            var area = this.desktopWindowWorkArea();
            var width = Math.min(area.width - 20, Math.max(560, Math.round(area.width * 0.7)));
            var height = Math.min(area.height - 20, Math.max(420, Math.round(area.height * 0.8)));
            this.applyDesktopWindowGeometry(w, {
                x: Math.round((area.width - width) / 2),
                y: Math.round((area.height - height) / 2),
                w: width,
                h: height
            });
            var startPath = t.sftpPath || t.sftpHome || '';
            w.diskPath = startPath;
            var self = this;
            this.$nextTick(function () {
                if (startPath) {
                    self.startDiskAnalyze(w, t.sessionId, startPath);
                }
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
            return w;
        },
        /* ---------- 服务与计划任务 ---------- */
        openDesktopAppCenterWindow: function () {
            if (!this.desktop.visible) {
                return null;
            }
            var existing = this.desktopWindowOfType('appcenter');
            if (existing) {
                this.restoreDesktopWindow(existing);
                return existing;
            }
            var w = this.addDesktopWindow('appcenter');
            this.centerDesktopWindow(w, 720, 480);
            return w;
        },
        openDesktopServicesWindow: function () {
            if (!this.desktop.visible) {
                return null;
            }
            if (!this.desktopServerReady()) {
                return null;
            }
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return null;
            }
            var existing = this.desktopWindowOfType('services');
            if (existing) {
                this.restoreDesktopWindow(existing);
                if (!this.servicesApp.items.length) {
                    this.loadDesktopServices();
                }
                return existing;
            }
            this.servicesApp.items = [];
            this.servicesApp.keyword = '';
            this.servicesApp.error = '';
            this.servicesApp.busy = '';
            this.servicesApp.tab = 'services';
            this.servicesApp.cronLoaded = false;
            this.servicesApp.cron = { user: [], system: [], timers: [] };
            var w = this.addDesktopWindow('services');
            var area = this.desktopWindowWorkArea();
            this.centerDesktopWindow(w, 960, Math.max(540, Math.round(area.height * 0.84)));
            this.loadDesktopServices();
            return w;
        },
        loadDesktopServices: function () {
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                this.servicesApp.error = '当前桌面未连接服务器';
                return;
            }
            var self = this;
            this.servicesApp.loading = true;
            this.servicesApp.error = '';
            http.get('/api/services/list', { params: { sessionId: t.sessionId } })
                .then(function (d) {
                    self.servicesApp.items = Array.isArray(d) ? d : [];
                    self.servicesApp.loading = false;
                })
                .catch(function (e) {
                    self.servicesApp.loading = false;
                    self.servicesApp.error = (e && e.message) ? e.message : '读取服务列表失败';
                });
        },
        switchServicesTab: function (tab) {
            this.servicesApp.tab = tab;
            if (tab === 'cron') {
                this.loadDesktopCron();
            }
        },
        refreshServicesTab: function () {
            if (this.servicesApp.tab === 'cron') {
                this.loadDesktopCron(true);
            } else {
                this.loadDesktopServices();
            }
        },
        runServiceAction: function (item, action) {
            var self = this;
            var labels = { start: '启动', stop: '停止', restart: '重启', enable: '设置开机自启', disable: '取消开机自启' };
            if (action === 'stop' || action === 'restart') {
                this.$confirm('确定要' + labels[action] + '服务「' + item.unit + '」吗？', '服务操作',
                    { type: 'warning' }).then(function () {
                    self.execServiceAction(item, action, labels[action]);
                }).catch(function () { /* 取消 */ });
                return;
            }
            this.execServiceAction(item, action, labels[action]);
        },
        serviceStateLabel: function (item) {
            if (!item) {
                return '—';
            }
            var labels = {
                running: '运行中', exited: '已退出', dead: '已停止', failed: '失败',
                start: '启动中', stop: '停止中', reloading: '重载中',
                activating: '启动中', deactivating: '停止中', stopped: '已停止'
            };
            return labels[item.sub] || item.sub || item.active || '—';
        },
        serviceEnabledLabel: function (item) {
            if (!item) {
                return '—';
            }
            var labels = {
                enabled: '已启用', 'enabled-runtime': '运行时启用', disabled: '已禁用',
                static: '静态', masked: '已屏蔽', indirect: '间接',
                generated: '自动生成', transient: '临时', unknown: '未知'
            };
            return labels[item.enabled] || item.enabled || '—';
        },
        execServiceAction: function (item, action, label) {
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                return;
            }
            if (this.servicesApp.busy) {
                return;
            }
            var self = this;
            this.servicesApp.busy = item.unit + ':' + action;
            var done = function () {
                self.servicesApp.busy = '';
            };
            http.post('/api/services/action', {
                sessionId: t.sessionId,
                unit: item.unit,
                action: action
            }).then(function () {
                done();
                ELEMENT.Message.success(label + '成功：' + item.unit);
                self.loadDesktopServices();
            }).catch(function () {
                done();
            });
        },
        loadDesktopCron: function (force) {
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                this.servicesApp.cronError = '当前桌面未连接服务器';
                return;
            }
            if (this.servicesApp.cronLoading || (!force && this.servicesApp.cronLoaded)) {
                return;
            }
            var self = this;
            this.servicesApp.cronLoading = true;
            this.servicesApp.cronError = '';
            http.get('/api/services/cron', { params: { sessionId: t.sessionId } })
                .then(function (d) {
                    self.applyDesktopCron(d);
                })
                .catch(function (e) {
                    self.servicesApp.cronLoading = false;
                    self.servicesApp.cronError = (e && e.message) ? e.message : '读取计划任务失败';
                });
        },
        applyDesktopCron: function (data) {
            this.servicesApp.cron = data && typeof data === 'object'
                ? { user: data.user || [], system: data.system || [], timers: data.timers || [] }
                : { user: [], system: [], timers: [] };
            this.servicesApp.cronLoaded = true;
            this.servicesApp.cronLoading = false;
        },
        addDesktopCron: function () {
            var t = this.desktopTab;
            var line = (this.servicesApp.newCron || '').trim();
            if (!t || !t.sessionId) {
                return;
            }
            if (!line) {
                ELEMENT.Message.warning('请输入计划任务行');
                return;
            }
            if (this.servicesApp.addingCron) {
                return;
            }
            var self = this;
            this.servicesApp.addingCron = true;
            http.post('/api/services/cron/add', { sessionId: t.sessionId, line: line })
                .then(function (d) {
                    self.servicesApp.addingCron = false;
                    self.servicesApp.newCron = '';
                    self.applyDesktopCron(d);
                    ELEMENT.Message.success('已添加计划任务');
                })
                .catch(function () {
                    self.servicesApp.addingCron = false;
                });
        },
        deleteDesktopCron: function (line) {
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                return;
            }
            var self = this;
            this.$confirm('确定删除这条用户计划任务？\n' + line, '删除计划任务', { type: 'warning' })
                .then(function () {
                    return http.post('/api/services/cron/delete', {
                        sessionId: t.sessionId,
                        line: line
                    });
                })
                .then(function (d) {
                    if (d) {
                        self.applyDesktopCron(d);
                        ELEMENT.Message.success('已删除计划任务');
                    }
                })
                .catch(function () { /* 取消或失败 */ });
        },
        /* ---------- 网络工具箱 ---------- */
        openDesktopNetToolWindow: function () {
            if (!this.desktop.visible) {
                return null;
            }
            if (!this.desktopServerReady()) {
                return null;
            }
            this.closeTaskmgrProcessDetail();
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return null;
            }
            var existing = this.desktopWindowOfType('nettool');
            if (existing) {
                this.restoreDesktopWindow(existing);
                if (this.netTool.tab === 'traffic') {
                    this.startNetTraffic(false);
                    this.loadNetRootStatus();
                } else if (this.netTool.tab === 'ports') {
                    this.loadNetRootStatus();
                    this.loadNetPorts(true);
                }
                return existing;
            }
            this.netTool.tab = 'traffic';
            this.netTool.running = false;
            this.netTool.error = '';
            this.netTool.output = '';
            this.netTool.exitCode = null;
            this.netTool.durationMs = 0;
            this.netTool.timedOut = false;
            this.netTool.at = 0;
            this.resetNetRootState();
            this.netTool.traffic.data = null;
            this.netTool.traffic.error = '';
            this.netTool.traffic.paused = false;
            this.netTool.traffic.updatedAt = 0;
            this.netTool.ports.data = null;
            this.netTool.ports.error = '';
            this.netTool.ports.loading = false;
            this.netTool.ports.updatedAt = 0;
            this.netTool.ports.rawOpen = false;
            var w = this.addDesktopWindow('nettool');
            this.centerDesktopWindow(w, 1060, 640);
            this.startNetTraffic(true);
            this.loadNetRootStatus();
            return w;
        },
        resetNetRootState: function () {
            var r = this.netTool.root;
            r.checked = false;
            r.loading = false;
            r.user = '';
            r.uid = -1;
            r.isRoot = false;
            r.ready = false;
            r.passwordless = false;
            r.needsPassword = false;
            this.netTool.rootEnabled = false;
        },
        isCurrentNetSession: function (sessionId) {
            return !!this.desktopTab && this.desktopTab.sessionId === sessionId;
        },
        applyNetRootStatus: function (d) {
            var r = this.netTool.root;
            d = d || {};
            r.checked = true;
            r.user = d.user || '';
            r.uid = typeof d.uid === 'number' ? d.uid : -1;
            r.isRoot = !!d.root;
            r.ready = !!d.ready;
            r.passwordless = !!d.passwordless;
            r.needsPassword = !!d.needsPassword;
            if (r.isRoot || !r.ready) {
                this.netTool.rootEnabled = false;
            }
        },
        loadNetRootStatus: function () {
            var tab = this.desktopTab;
            var r = this.netTool.root;
            if (!tab || !tab.sessionId) {
                this.resetNetRootState();
                return;
            }
            var sessionId = tab.sessionId;
            var self = this;
            r.loading = true;
            http.get('/api/nettools/root', {
                params: { sessionId: sessionId },
                silent: true
            }).then(function (d) {
                if (!self.isCurrentNetSession(sessionId)) {
                    return;
                }
                r.loading = false;
                self.applyNetRootStatus(d);
            }).catch(function () {
                if (!self.isCurrentNetSession(sessionId)) {
                    return;
                }
                r.loading = false;
                r.checked = false;
            });
        },
        toggleNetTrafficRoot: function () {
            if (this.netTool.root.isRoot) {
                ELEMENT.Message.info('当前 SSH 登录用户就是 root，无需切换');
                return;
            }
            if (this.netTool.rootEnabled) {
                this.disableNetTrafficRoot();
            } else {
                this.enableNetTrafficRoot();
            }
        },
        enableNetTrafficRoot: function (password) {
            var self = this;
            var tab = this.desktopTab;
            var r = this.netTool.root;
            if (!tab || !tab.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            var sessionId = tab.sessionId;
            r.loading = true;
            http.post('/api/nettools/root', {
                sessionId: sessionId,
                password: password == null ? null : password
            }, { silent: true }).then(function (d) {
                if (!self.isCurrentNetSession(sessionId)) {
                    return;
                }
                r.loading = false;
                self.applyNetRootStatus(d);
                if (d && d.ready) {
                    self.netTool.rootEnabled = true;
                    ELEMENT.Message.success('已切换到 root 读取');
                    self.refreshNetAfterRootChange();
                } else {
                    self.promptNetRootPassword();
                }
            }).catch(function (e) {
                if (!self.isCurrentNetSession(sessionId)) {
                    return;
                }
                r.loading = false;
                r.needsPassword = true;
                ELEMENT.Message.error((e && e.message) ? e.message : '启用 root 采样失败');
            });
        },
        promptNetRootPassword: function () {
            var self = this;
            this.$prompt('请输入当前 SSH 用户的 sudo 密码。密码仅保存在 DeepShell 服务内存中，30 分钟内有效，不会写入日志或数据库。',
                '以 root 采样', {
                    confirmButtonText: '启用',
                    cancelButtonText: '取消',
                    inputType: 'password',
                    inputPlaceholder: 'sudo 密码',
                    inputPattern: /\S+/,
                    inputErrorMessage: '密码不能为空',
                    closeOnClickModal: false
                }).then(function (res) {
                    self.enableNetTrafficRoot(res.value);
                }).catch(function () { /* 取消 */ });
        },
        disableNetTrafficRoot: function () {
            var self = this;
            var tab = this.desktopTab;
            var r = this.netTool.root;
            if (!tab || !tab.sessionId) {
                return;
            }
            var sessionId = tab.sessionId;
            r.loading = true;
            http.delete('/api/nettools/root', {
                params: { sessionId: sessionId },
                silent: true
            }).then(function (d) {
                if (!self.isCurrentNetSession(sessionId)) {
                    return;
                }
                r.loading = false;
                self.applyNetRootStatus(d);
                self.netTool.rootEnabled = false;
                ELEMENT.Message.info('已恢复为当前用户读取');
                self.refreshNetAfterRootChange();
            }).catch(function (e) {
                if (!self.isCurrentNetSession(sessionId)) {
                    return;
                }
                r.loading = false;
                ELEMENT.Message.error((e && e.message) ? e.message : '关闭 root 采样失败');
            });
        },
        refreshNetAfterRootChange: function () {
            if (this.netTool.tab === 'traffic') {
                this.startNetTraffic(true);
            } else if (this.netTool.tab === 'ports') {
                this.loadNetPorts(true);
            }
        },
        switchNetToolTab: function (tab) {
            if (!tab || this.netTool.tab === tab) {
                return;
            }
            this.netTool.tab = tab;
            if (tab === 'traffic') {
                this.startNetTraffic(!this.netTool.traffic.data);
            } else if (tab === 'ports') {
                this.closeTaskmgrProcessDetail();
                this.stopNetTraffic();
                this.loadNetRootStatus();
                this.loadNetPorts(true);
            } else {
                this.closeTaskmgrProcessDetail();
                this.stopNetTraffic();
            }
        },
        loadNetPorts: function (reset) {
            var p = this.netTool.ports;
            var tab = this.desktopTab;
            if (!this.desktop.visible || this.netTool.tab !== 'ports' || !tab || !tab.sessionId) {
                return;
            }
            if (this._netPortsBusy) {
                return;
            }
            var sessionId = tab.sessionId;
            if (this._netPortsSession !== sessionId) {
                this._netPortsSession = sessionId;
                reset = true;
            }
            if (reset) {
                p.data = null;
                p.error = '';
                p.updatedAt = 0;
                p.rawOpen = false;
            }
            p.loading = true;
            this._netPortsBusy = true;
            var self = this;
            http.post('/api/nettools/ports', {
                sessionId: sessionId,
                root: !!this.netTool.rootEnabled
            }, { silent: true }).then(function (d) {
                if (self._netPortsSession !== sessionId) {
                    return;
                }
                p.data = d || null;
                p.error = '';
                p.updatedAt = Date.now();
            }).catch(function (e) {
                if (self._netPortsSession !== sessionId) {
                    return;
                }
                var message = (e && e.message) ? e.message : '读取端口与防火墙失败';
                p.error = message;
                if (self.netTool.rootEnabled && /root|sudo/i.test(message)) {
                    self.netTool.rootEnabled = false;
                    self.loadNetRootStatus();
                }
            }).then(function () {
                p.loading = false;
                self._netPortsBusy = false;
            });
        },
        netPortScopeText: function (scope) {
            if (scope === 'all') {
                return '所有网卡';
            }
            if (scope === 'local') {
                return '仅本机';
            }
            return '指定地址';
        },
        netPortAddressText: function (address) {
            return address === '*' ? '0.0.0.0' : address;
        },
        startNetTraffic: function (reset) {
            this.stopNetTraffic();
            var t = this.netTool.traffic;
            var tab = this.desktopTab;
            t.paused = false;
            if (reset) {
                t.data = null;
                t.error = '';
                t.updatedAt = 0;
            }
            if (!tab || !tab.sessionId) {
                t.error = '会话未就绪，请等 SSH 连接建立后再试';
                return;
            }
            this.sampleNetTraffic(!!reset);
            var self = this;
            this._netTrafficTimer = setInterval(function () {
                self.sampleNetTraffic(false);
            }, Math.max(1000, Number(t.intervalMs) || 2000));
        },
        restartNetTrafficTimer: function () {
            if (this.netTool.tab !== 'traffic' || this.netTool.traffic.paused) {
                return;
            }
            this.startNetTraffic(false);
        },
        stopNetTraffic: function () {
            if (this._netTrafficTimer) {
                clearInterval(this._netTrafficTimer);
                this._netTrafficTimer = null;
            }
        },
        toggleNetTrafficPause: function () {
            var t = this.netTool.traffic;
            t.paused = !t.paused;
            if (t.paused) {
                this.stopNetTraffic();
            } else {
                this.startNetTraffic(false);
            }
        },
        sampleNetTraffic: function (reset) {
            var t = this.netTool.traffic;
            var tab = this.desktopTab;
            if (!this.desktop.visible || this.netTool.tab !== 'traffic' || !tab || !tab.sessionId) {
                this.stopNetTraffic();
                return;
            }
            if (this._netTrafficBusy || document.hidden) {
                return;
            }
            var sessionId = tab.sessionId;
            if (this._netTrafficSession !== sessionId) {
                this._netTrafficSession = sessionId;
                reset = true;
                t.data = null;
                t.updatedAt = 0;
                this.resetNetRootState();
                this.loadNetRootStatus();
            }
            var self = this;
            this._netTrafficBusy = true;
            http.post('/api/nettools/process-traffic', {
                sessionId: sessionId,
                reset: !!reset,
                root: !!this.netTool.rootEnabled
            }, { silent: true }).then(function (d) {
                if (self._netTrafficSession !== sessionId) {
                    return;
                }
                t.data = d || null;
                t.error = '';
                t.updatedAt = Date.now();
            }).catch(function (e) {
                if (self._netTrafficSession !== sessionId) {
                    return;
                }
                var message = (e && e.message) ? e.message : '读取进程流量失败';
                t.error = message;
                if (self.netTool.rootEnabled && /root|sudo/i.test(message)) {
                    self.netTool.rootEnabled = false;
                    self.loadNetRootStatus();
                }
            }).then(function () {
                self._netTrafficBusy = false;
            });
        },
        sortNetTraffic: function (key) {
            var t = this.netTool.traffic;
            if (t.sortBy === key) {
                t.sortDir = t.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                t.sortBy = key;
                t.sortDir = key === 'name' ? 'asc' : 'desc';
            }
        },
        netTrafficSortIcon: function (key) {
            var t = this.netTool.traffic;
            if (t.sortBy !== key) {
                return 'el-icon-sort';
            }
            return t.sortDir === 'asc' ? 'el-icon-sort-up' : 'el-icon-sort-down';
        },
        netTrafficBarWidth: function (row, key) {
            var max = key === 'rx' ? this.netTrafficMaxDown : this.netTrafficMaxUp;
            if (!max || !row || !row[key]) {
                return '0%';
            }
            return Math.max(3, Math.round(row[key] * 100 / max)) + '%';
        },
        /** 实时流量右键：复用任务管理器的进程详情浮层，并异步补全 CPU / 内存等字段。 */
        openNetTrafficProcessDetail: function (row) {
            if (!row) {
                return;
            }
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('当前会话未就绪，无法读取进程详情');
                return;
            }
            this.netTool.traffic.selectedPid = row.pid;
            var proc = {
                pid: row.pid,
                ppid: 0,
                user: row.user || '',
                comm: row.name || '',
                args: '',
                state: 'S',
                cpu: null,
                cpuAvg: null,
                memPct: null,
                rssMb: 0,
                elapsedSecs: -1
            };
            this.openTaskmgrProcessDetail(proc);
            var self = this;
            http.get('/api/process/list', {
                params: { sessionId: t.sessionId },
                silent: true
            }).then(function (list) {
                if (!self.taskmgr.detail.overlayVisible
                        || self.taskmgr.detail.overlayRow !== proc) {
                    return;
                }
                var full = null;
                (list || []).some(function (p) {
                    if (p && p.pid === row.pid) {
                        full = p;
                        return true;
                    }
                    return false;
                });
                if (!full) {
                    return;
                }
                Object.keys(full).forEach(function (k) {
                    if (full[k] !== null && full[k] !== undefined) {
                        self.$set(proc, k, full[k]);
                    }
                });
            }).catch(function () {
                // 保留 PID / 名称 / 用户与命令行详情
            });
        },
        fmtClockTime: function (ts) {
            if (!ts) {
                return '--';
            }
            var d = new Date(ts);
            var p = function (x) { return (x < 10 ? '0' : '') + x; };
            return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
        },
        runNetTool: function () {
            var t = this.desktopTab;
            if (!t || !t.sessionId || this.netTool.running) {
                return;
            }
            var target = (this.netTool.target || '').trim();
            if (!target) {
                ELEMENT.Message.warning('请输入主机名或 IP 地址');
                return;
            }
            var port = parseInt(this.netTool.port, 10);
            if (this.netTool.tool === 'port' && (!port || port < 1 || port > 65535)) {
                ELEMENT.Message.warning('端口范围应为 1-65535');
                return;
            }
            var self = this;
            this.netTool.running = true;
            this.netTool.error = '';
            this.netTool.output = '';
            this.netTool.exitCode = null;
            this.netTool.timedOut = false;
            this.netTool.at = 0;
            http.post('/api/nettools/run', {
                sessionId: t.sessionId,
                tool: this.netTool.tool,
                target: target,
                port: this.netTool.tool === 'port' ? port : null
            }).then(function (d) {
                self.netTool.running = false;
                self.netTool.output = (d && d.output) || '';
                self.netTool.exitCode = d ? d.exitCode : null;
                self.netTool.durationMs = d ? (d.durationMs || 0) : 0;
                self.netTool.timedOut = !!(d && d.timedOut);
                self.netTool.at = Date.now();
            }).catch(function (e) {
                self.netTool.running = false;
                self.netTool.error = (e && e.message) ? e.message : '执行失败';
            });
        },
        /* ---------- 多机命令 ---------- */
        openDesktopBatchCommandWindow: function () {
            if (!this.desktop.visible) {
                return null;
            }
            if (!this.desktopServerReady()) {
                return null;
            }
            this.loadConnections();
            this.loadSnippets();
            var existing = this.desktopWindowOfType('batchcmd');
            if (existing) {
                this.restoreDesktopWindow(existing);
                return existing;
            }
            var cur = this.desktopTab && this.desktopTab.connId != null ? this.desktopTab.connId : null;
            this.batchCmd.ids = cur == null ? [] : [cur];
            this.batchCmd.keyword = '';
            this.batchCmd.command = '';
            this.batchCmd.error = '';
            this.batchCmd.items = [];
            this.batchCmd.elapsedMs = 0;
            this.batchCmd.running = false;
            var w = this.addDesktopWindow('batchcmd');
            var area = this.desktopWindowWorkArea();
            this.centerDesktopWindow(w, 1000, Math.max(560, Math.round(area.height * 0.82)));
            return w;
        },
        batchUseSnippet: function (snippet) {
            if (!snippet) {
                return;
            }
            this.batchCmd.command = snippet.command || '';
        },
        toggleBatchTarget: function (id, checked) {
            var ids = this.batchCmd.ids || (this.batchCmd.ids = []);
            var i = ids.indexOf(id);
            if (checked && i < 0) {
                ids.push(id);
            } else if (!checked && i >= 0) {
                ids.splice(i, 1);
            }
        },
        selectAllBatchTargets: function () {
            var ids = this.batchCmd.ids || (this.batchCmd.ids = []);
            this.batchConnectionRows.forEach(function (c) {
                if (ids.indexOf(c.id) < 0) {
                    ids.push(c.id);
                }
            });
        },
        clearBatchTargets: function () {
            this.batchCmd.ids = [];
        },
        runBatchCommand: function () {
            var ids = (this.batchCmd.ids || []).slice();
            var command = (this.batchCmd.command || '').trim();
            if (!ids.length) {
                ELEMENT.Message.warning('请至少选择一台服务器');
                return;
            }
            if (!command) {
                ELEMENT.Message.warning('请输入要执行的命令');
                return;
            }
            if (this.batchCmd.running) {
                return;
            }
            var self = this;
            this.batchCmd.running = true;
            this.batchCmd.error = '';
            this.batchCmd.items = [];
            this.batchCmd.elapsedMs = 0;
            http.post('/api/batch-command/run', {
                connectionIds: ids,
                command: command,
                timeoutSec: 60
            }).then(function (d) {
                self.batchCmd.running = false;
                self.batchCmd.items = (d && d.items) || [];
                self.batchCmd.elapsedMs = (d && d.elapsedMs) || 0;
            }).catch(function (e) {
                self.batchCmd.running = false;
                self.batchCmd.error = (e && e.message) ? e.message : '执行失败';
            });
        },
        openDesktopTerminalWindow: function (startDir) {
            if (!this.desktop.visible) {
                return null;
            }
            if (this.desktop.local) {
                return this.openLocalShellWindow();
            }
            if (!this.desktopServerReady()) {
                return null;
            }
            var src = this.desktopTab;
            if (!src || src.connId == null) {
                ELEMENT.Message.warning('当前桌面没有可用的连接');
                return null;
            }
            var conn = this.connections.find(function (c) { return c.id === src.connId; });
            var w = this.addDesktopWindow('terminal');
            var tab = createTerminalState(src.connId, conn, newSessionKey());
            tab.desktopOnly = true;
            tab.windowId = w.id;
            tab.initialDir = typeof startDir === 'string' ? startDir : '';
            tab.title = src.title || tab.title;
            tab.host = src.host || tab.host;
            tab.port = src.port || (conn && conn.port) || tab.port;
            tab.sftpHome = src.sftpHome || null;
            tab.sftpPath = src.sftpPath || '';
            tab.termCwd = src.termCwd || null;
            w.termTab = tab;
            var self = this;
            this.$nextTick(function () {
                var ref = self.$refs['desk-term-' + w.id];
                var el = Array.isArray(ref) ? ref[0] : ref;
                self.initTerminal(tab, el);
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
            return w;
        },
        /** 本地桌面：为当前机器开一个本地 Shell 窗口（不经过 SSH） */
        openLocalShellWindow: function () {
            if (!this.desktop.visible || !this.desktop.local) {
                return null;
            }
            var w = this.addDesktopWindow('terminal');
            var tab = createTerminalState(null, null, newSessionKey());
            tab.desktopOnly = true;
            tab.localShell = true;
            tab.localPty = false;
            tab.windowId = w.id;
            tab.title = '本地终端';
            tab.host = '';
            tab.port = 0;
            tab.sftpHome = null;
            tab.sftpPath = '';
            tab.termCwd = null;
            tab.status = 'connecting';
            w.termTab = tab;
            var self = this;
            this.$nextTick(function () {
                var ref = self.$refs['desk-term-' + w.id];
                var el = Array.isArray(ref) ? ref[0] : ref;
                self.initTerminal(tab, el);
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
            return w;
        },
        closeDesktopTerminal: function (w) {
            var tab = w && w.termTab;
            if (!tab) {
                return;
            }
            this.cancelTransfersForTab(tab);
            clearReconnectTimer(tab);
            tab.explicitClose = true;
            tab.serverClosed = true;
            if (tab.ws) {
                try {
                    if (tab.ws.readyState === 1) {
                        tab.ws.send(JSON.stringify({ type: 'close' }));
                    }
                    tab.ws.close();
                } catch (e) { /* ignore */ }
                tab.ws = null;
            }
            if (tab.term) {
                try { tab.term.dispose(); } catch (e) { /* ignore */ }
            }
            tab.term = null;
            tab.fit = null;
            tab.searchAddon = null;
            w.termTab = null;
        },
        openDesktopExplorerWindow: function (path) {
            if (!this.desktop.visible) {
                return null;
            }
            return this.openDesktopWindow(path || this.desk.path || this.desktopHomeDir || '/');
        },
        /** 资源管理器图标默认目录：Termux 的 / 不可写，打开可访问的 Termux 家目录；普通服务器保持 / */
        desktopExplorerStartPath: function () {
            var home = this.desktopHomeDir;
            return home && home.indexOf('/com.termux/files/home') >= 0 ? home : '/';
        },
        openDesktopExplorerFromIcon: function () {
            var self = this;
            var t = this.desktopTab;
            if (t && !t.local && !t.sftpHome && t.sessionId) {
                // 图标可能先于 /api/sftp/home 返回被点击，先补齐家目录
                this.loadHome(t).then(function () {
                    self.openDesktopExplorerWindow(self.desktopExplorerStartPath());
                }).catch(function () {
                    self.openDesktopExplorerWindow('/');
                });
                return;
            }
            this.openDesktopExplorerWindow(this.desktopExplorerStartPath());
        },
        /* Alt+Tab / Alt+` 切换桌面窗口：按 z 序循环，最小化窗口会被还原 */
        cycleDesktopWindows: function (dir) {
            if (!this.desktop.visible) {
                return;
            }
            var list = this.desktop.windows.slice().sort(function (a, b) {
                return (a.z || 0) - (b.z || 0);
            });
            if (!list.length) {
                return;
            }
            var idx = -1;
            for (var i = 0; i < list.length; i++) {
                if (list[i].id === this.desktop.activeWinId) {
                    idx = i;
                    break;
                }
            }
            var next;
            if (idx < 0) {
                next = dir > 0 ? list[list.length - 1] : list[0];
            } else {
                next = list[(idx + (dir > 0 ? 1 : -1) + list.length) % list.length];
            }
            if (next) {
                this.activateDesktopWindow(next.id);
            }
        },
        activateDesktopWindow: function (id) {
            var w = this.desktopWindowById(id);
            if (!w) {
                return;
            }
            var changed = this.desktop.activeWinId !== id;
            if (w.min) {
                w.min = false;
                changed = true;
            }
            this.desktop.activeWinId = id;
            if (w.type === 'explorer') {
                this.desktop.explorerId = id;
            }
            w.z = ++this.desktop.zSeq;
            if (w.type === 'terminal' && w.termTab) {
                var termSelf = this;
                this.$nextTick(function () {
                    if (w.termTab && w.termTab.term) {
                        w.termTab.term.focus();
                    }
                    termSelf.fitTab(w.termTab);
                });
            }
            this.desktop.menu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.taskMenu.visible = false;
            this.desktop.iconMenu.visible = false;
            this.desktop.taskbarMenu.visible = false;
            this.desktop.trayMenu.visible = false;
            this.taskmgr.ctxMenu.visible = false;
            this.taskmgr.runVisible = false;
            this.desktop.iconSelected = '';
            this.desktop.iconSelectedKeys = [];
            this.desktop.focusSurface = false;
            this.desktop.calendarOpen = false;
            this.cancelDesktopIconMarquee();
            this.closeDesktopSubMenus();
            if (this.desktop.startOpen) {
                this.desktop.startOpen = false;
            }
            if (changed) {
                this.desktop.windows.forEach(function (other) {
                    if (other !== w) {
                        other.fileDragOver = false;
                        other.dropTarget = '';
                    }
                });
                var self = this;
                if (w.type === 'explorer') {
                    this.$nextTick(function () {
                        self.setupDesktopThumbs(w);
                    });
                } else {
                    this.$nextTick(function () {
                        self.scrollAiChat();
                    });
                }
            }
        },
        pickDesktopActive: function (excludeId) {
            var best = null;
            this.desktop.windows.forEach(function (w) {
                if (w.id !== excludeId && !w.min && (!best || w.z > best.z)) {
                    best = w;
                }
            });
            this.desktop.activeWinId = best ? best.id : '';
            var current = this.desktopWindowById(this.desktop.explorerId);
            var explorer = null;
            if (current && current.type === 'explorer' && !current.min) {
                explorer = current;
            } else {
                this.desktop.windows.forEach(function (w) {
                    if (w.type === 'explorer' && !w.min && (!explorer || w.z > explorer.z)) {
                        explorer = w;
                    }
                });
                this.desktop.explorerId = explorer ? explorer.id : '';
            }
            if (explorer) {
                var self = this;
                this.$nextTick(function () {
                    self.setupDesktopThumbs(explorer);
                });
            }
        },
        minimizeDesktopWindow: function (w) {
            if (!w) {
                return;
            }
            w.min = true;
            if (this.desktop.activeWinId === w.id) {
                this.pickDesktopActive(w.id);
            }
            this.saveDesktopWinLayouts();
        },
        restoreDesktopWindow: function (w) {
            if (!w) {
                return;
            }
            w.min = false;
            this.activateDesktopWindow(w.id);
            this.saveDesktopWinLayouts();
        },
        toggleDesktopWindowMax: function (w) {
            if (!w) {
                return;
            }
            this.activateDesktopWindow(w.id);
            if (w.max) {
                w.max = false;
                var area = this.desktopWindowWorkArea();
                w.w = Math.min(Math.max(w.w, Math.min(520, area.width)), area.width);
                w.h = Math.min(Math.max(w.h, Math.min(320, area.height)), area.height);
                w.x = Math.min(Math.max(0, w.x), Math.max(0, area.width - w.w));
                w.y = Math.min(Math.max(0, w.y), Math.max(0, area.height - w.h));
            } else {
                w.normal = { x: w.x, y: w.y, w: w.w, h: w.h };
                w.max = true;
            }
            this.saveDesktopWinLayouts();
            var self = this;
            this.$nextTick(function () {
                self.setupDesktopThumbs(w);
                if (w.type === 'terminal') {
                    self.fitTab(w.termTab);
                }
            });
        },
        closeDesktopWindow: function (w) {
            if (!w) {
                return;
            }
            if (w.type === 'editor' && w.editorDirty) {
                var self = this;
                var title = this.desktopWindowTitle(w).replace(/ •$/, '');
                this.$confirm('「' + title + '」有未保存的修改，确定关闭？', '未保存的修改', {
                    type: 'warning',
                    confirmButtonText: '放弃修改',
                    cancelButtonText: '继续编辑'
                }).then(function () {
                    w.editorDirty = false;
                    self.closeDesktopWindow(w);
                }).catch(function () { /* 继续编辑 */ });
                return;
            }
            if (w.type === 'terminal') {
                this.closeDesktopTerminal(w);
            }
            if (w.type === 'nettool') {
                this.closeTaskmgrProcessDetail();
            }
            if (this.desktop.taskMenu.visible && this.desktop.taskMenu.winId === w.id) {
                this.desktop.taskMenu.visible = false;
            }
            if (w.type === 'taskmgr') {
                this.stopTaskmgrTimer();
                this.taskmgr.winId = '';
                this.taskmgr.ctxMenu.visible = false;
                this.taskmgr.runVisible = false;
                this.taskmgr.detail.overlayVisible = false;
            }
            if (w.type === 'nettool') {
                this.stopNetTraffic();
                this._netTrafficSession = '';
            }
            if (this.taskmgr.selected === 'win:' + w.id) {
                this.taskmgr.selected = '';
            }
            this.releaseDesktopWindowThumbs(w);
            var idx = this.desktop.windows.indexOf(w);
            if (idx >= 0) {
                this.desktop.windows.splice(idx, 1);
            }
            var wasActive = this.desktop.activeWinId === w.id;
            if (this.desktop.showDesktopIds.indexOf(w.id) >= 0) {
                this.desktop.showDesktopIds = this.desktop.showDesktopIds.filter(function (id) {
                    return id !== w.id;
                });
            }
            if (wasActive || this.desktop.explorerId === w.id) {
                this.pickDesktopActive(w.id);
            }
            if (!this.desktop.windows.length) {
                this.desktop.activeWinId = '';
                this.desktop.explorerId = '';
                this.desktop.showDesktopIds = [];
            }
            this.saveDesktopWinLayouts();
        },
        toggleDesktopTaskbarWindow: function (w) {
            if (!w) {
                return;
            }
            if (w.min) {
                this.restoreDesktopWindow(w);
            } else if (this.desktop.activeWinId === w.id) {
                this.minimizeDesktopWindow(w);
            } else {
                this.activateDesktopWindow(w.id);
            }
        },
        toggleShowDesktop: function () {
            var visible = this.desktop.windows.filter(function (w) {
                return !w.min;
            });
            var self = this;
            if (visible.length) {
                this.desktop.showDesktopIds = visible.map(function (w) {
                    return w.id;
                });
                visible.forEach(function (w) {
                    w.min = true;
                });
                this.desktop.activeWinId = '';
                this.desktop.explorerId = '';
                this.desktop.menu.visible = false;
                this.desktop.wallMenu.visible = false;
                this.desktop.startOpen = false;
                this.closeDesktopSubMenus();
                return;
            }
            var restoreIds = this.desktop.showDesktopIds.slice();
            this.desktop.windows.forEach(function (w) {
                w.min = false;
            });
            var target = null;
            for (var i = restoreIds.length - 1; i >= 0; i--) {
                target = this.desktopWindowById(restoreIds[i]);
                if (target) {
                    break;
                }
            }
            if (!target) {
                this.desktop.windows.forEach(function (w) {
                    if (!target || w.z > target.z) {
                        target = w;
                    }
                });
            }
            this.desktop.showDesktopIds = [];
            var explorer = target && target.type === 'explorer' ? target : null;
            if (!explorer) {
                this.desktop.windows.forEach(function (w) {
                    if (w.type === 'explorer' && (!explorer || w.z > explorer.z)) {
                        explorer = w;
                    }
                });
            }
            this.desktop.explorerId = explorer ? explorer.id : '';
            if (target) {
                this.desktop.activeWinId = target.id;
                target.z = ++this.desktop.zSeq;
            }
            if (explorer) {
                this.$nextTick(function () {
                    self.setupDesktopThumbs(explorer);
                });
            }
            if (target && target.type === 'ai') {
                this.$nextTick(function () {
                    self.scrollAiChat();
                });
            }
        },
        fitDesktopWindows: function () {
            if (!this.desktop.visible) {
                return;
            }
            var area = this.desktopWindowWorkArea();
            var minW = Math.min(520, area.width);
            var minH = Math.min(320, area.height);
            this.desktop.windows.forEach(function (w) {
                if (w.max) {
                    return;
                }
                w.w = Math.min(Math.max(w.w, minW), area.width);
                w.h = Math.min(Math.max(w.h, minH), area.height);
                w.x = Math.min(Math.max(0, w.x), Math.max(0, area.width - w.w));
                w.y = Math.min(Math.max(0, w.y), Math.max(0, area.height - w.h));
            });
            this.scheduleSaveDesktopWinLayouts();
            var self = this;
            this.$nextTick(function () {
                self.desktop.windows.forEach(function (w) {
                    if (w.type === 'terminal') {
                        self.fitTab(w.termTab);
                    }
                });
            });
        },
        startDesktopWindowDrag: function (ev, w) {
            if (!w || ev.button !== 0 || w.max) {
                return;
            }
            this.activateDesktopWindow(w.id);
            w.dragging = true;
            this._deskMove = {
                w: w,
                startX: ev.clientX,
                startY: ev.clientY,
                ox: w.x,
                oy: w.y,
                area: this.desktopWindowWorkArea()
            };
            document.addEventListener('mousemove', this.onDesktopWindowDragMove);
            document.addEventListener('mouseup', this.onDesktopWindowDragUp);
            ev.preventDefault();
        },
        onDesktopWindowDragMove: function (ev) {
            var s = this._deskMove;
            if (!s) {
                return;
            }
            var x = s.ox + (ev.clientX - s.startX);
            var y = s.oy + (ev.clientY - s.startY);
            s.w.x = Math.max(0, Math.min(x, s.area.width - s.w.w));
            s.w.y = Math.max(0, Math.min(y, s.area.height - s.w.h));
            this.updateDesktopSnapPreview(ev, s);
        },
        updateDesktopSnapPreview: function (ev, s) {
            var root = this.$refs.desktopRoot;
            var p = this.desktop.snapPreview;
            if (!root || !s) {
                p.visible = false;
                return;
            }
            var rect = root.getBoundingClientRect();
            var area = s.area;
            var edge = 16;
            var x = ev.clientX - rect.left;
            var y = ev.clientY - rect.top;
            var kind = '';
            if (y <= edge) {
                kind = 'top';
            } else if (x <= edge) {
                kind = 'left';
            } else if (x >= area.width - edge) {
                kind = 'right';
            }
            if (!kind) {
                p.visible = false;
                return;
            }
            var half = Math.floor(area.width / 2);
            p.visible = true;
            p.kind = kind;
            if (kind === 'top') {
                p.x = 0;
                p.y = 0;
                p.w = area.width;
                p.h = area.height;
            } else if (kind === 'left') {
                p.x = 0;
                p.y = 0;
                p.w = half;
                p.h = area.height;
            } else {
                p.x = half;
                p.y = 0;
                p.w = area.width - half;
                p.h = area.height;
            }
        },
        applyDesktopSnap: function (w, kind) {
            if (!w || !kind) {
                return;
            }
            var area = this.desktopWindowWorkArea();
            var pre = { x: w.x, y: w.y, w: w.w, h: w.h };
            w.normal = pre;
            if (kind === 'top') {
                w.max = true;
            } else {
                var half = Math.floor(area.width / 2);
                w.max = false;
                w.x = kind === 'left' ? 0 : half;
                w.y = 0;
                w.w = kind === 'left' ? half : area.width - half;
                w.h = area.height;
            }
            var self = this;
            this.$nextTick(function () {
                self.setupDesktopThumbs(w);
                if (w.type === 'terminal') {
                    self.fitTab(w.termTab);
                }
            });
        },
        onDesktopWindowDragUp: function () {
            var s = this._deskMove;
            var snapKind = this.desktop.snapPreview.visible ? this.desktop.snapPreview.kind : '';
            this.desktop.snapPreview.visible = false;
            this._deskMove = null;
            document.removeEventListener('mousemove', this.onDesktopWindowDragMove);
            document.removeEventListener('mouseup', this.onDesktopWindowDragUp);
            if (s && s.w) {
                s.w.dragging = false;
                if (snapKind) {
                    this.applyDesktopSnap(s.w, snapKind);
                }
                this.scheduleSaveDesktopWinLayouts();
            }
        },
        onDesktopTaskAppsWheel: function (ev) {
            var el = ev.currentTarget;
            if (!el) {
                return;
            }
            var delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
            el.scrollLeft += delta;
        },
        startDesktopWindowResize: function (ev, w, dir) {
            if (!w || ev.button !== 0 || w.max) {
                return;
            }
            this.activateDesktopWindow(w.id);
            w.resizing = true;
            this._deskResize = {
                w: w,
                dir: dir,
                startX: ev.clientX,
                startY: ev.clientY,
                ox: w.x,
                oy: w.y,
                ow: w.w,
                oh: w.h,
                area: this.desktopWindowWorkArea()
            };
            document.addEventListener('mousemove', this.onDesktopWindowResizeMove);
            document.addEventListener('mouseup', this.onDesktopWindowResizeUp);
            ev.preventDefault();
            ev.stopPropagation();
        },
        onDesktopWindowResizeMove: function (ev) {
            var s = this._deskResize;
            if (!s) {
                return;
            }
            var area = s.area;
            var minW = Math.min(520, area.width);
            var minH = Math.min(320, area.height);
            var dx = ev.clientX - s.startX;
            var dy = ev.clientY - s.startY;
            var x = s.ox;
            var y = s.oy;
            var w = s.ow;
            var h = s.oh;
            if (s.dir.indexOf('e') >= 0) {
                w = Math.max(minW, Math.min(s.ow + dx, area.width - s.ox));
            }
            if (s.dir.indexOf('w') >= 0) {
                x = Math.max(0, Math.min(s.ox + dx, s.ox + s.ow - minW));
                w = s.ox + s.ow - x;
            }
            if (s.dir.indexOf('s') >= 0) {
                h = Math.max(minH, Math.min(s.oh + dy, area.height - s.oy));
            }
            if (s.dir.indexOf('n') >= 0) {
                y = Math.max(0, Math.min(s.oy + dy, s.oy + s.oh - minH));
                h = s.oy + s.oh - y;
            }
            s.w.x = x;
            s.w.y = y;
            s.w.w = w;
            s.w.h = h;
            if (s.w.type === 'terminal') {
                this.fitTab(s.w.termTab);
            }
        },
        onDesktopWindowResizeUp: function () {
            var s = this._deskResize;
            this._deskResize = null;
            document.removeEventListener('mousemove', this.onDesktopWindowResizeMove);
            document.removeEventListener('mouseup', this.onDesktopWindowResizeUp);
            if (s && s.w) {
                s.w.resizing = false;
                this.scheduleSaveDesktopWinLayouts();
                var self = this;
                this.$nextTick(function () {
                    self.setupDesktopThumbs(s.w);
                    if (s.w.type === 'terminal') {
                        self.fitTab(s.w.termTab);
                    }
                });
            }
        },
        stopDesktopWindowGestures: function () {
            this.desktop.snapPreview.visible = false;
            document.removeEventListener('mousemove', this.onDesktopWindowDragMove);
            document.removeEventListener('mouseup', this.onDesktopWindowDragUp);
            document.removeEventListener('mousemove', this.onDesktopWindowResizeMove);
            document.removeEventListener('mouseup', this.onDesktopWindowResizeUp);
            if (this._deskMove && this._deskMove.w) {
                this._deskMove.w.dragging = false;
            }
            if (this._deskResize && this._deskResize.w) {
                this._deskResize.w.resizing = false;
            }
            this._deskMove = null;
            this._deskResize = null;
        },
        onDesktopWallContextMenu: function (ev) {
            this.desktop.startOpen = false;
            this.desktop.menu.visible = false;
            this.desktop.taskMenu.visible = false;
            this.desktop.iconMenu.visible = false;
            this.desktop.trashMenu.visible = false;
            this.desktop.taskbarMenu.visible = false;
            this.taskmgr.ctxMenu.visible = false;
            this.desktop.iconSelected = '';
            this.desktop.iconSelectedKeys = [];
            this.desktop.focusSurface = true;
            this.desktop.calendarOpen = false;
            this.closeDesktopSubMenus();
            this.desktop.wallMenu = {
                visible: true,
                x: Math.max(8, Math.min(ev.clientX, window.innerWidth - 220)),
                y: Math.max(8, Math.min(ev.clientY, window.innerHeight - 360))
            };
            var self = this;
            this.$nextTick(function () {
                var el = self.$refs.deskWallMenu;
                if (!el || !self.desktop.wallMenu.visible) {
                    return;
                }
                var w = el.offsetWidth || 220;
                var h = el.offsetHeight || 340;
                self.desktop.wallMenu.x = Math.max(8, Math.min(ev.clientX, window.innerWidth - w - 8));
                self.desktop.wallMenu.y = Math.max(8, Math.min(ev.clientY, window.innerHeight - h - 8));
            });
        },
        desktopWallMenuAction: function (action) {
            this.desktop.wallMenu.visible = false;
            var surfaceWin = this.desktopSurfaceContextWin();
            var dir = this.desktop.surface.dir;
            if (action === 'newFolder' || action === 'newFile' || action === 'upload' || action === 'openTerminal') {
                if (!dir) {
                    ELEMENT.Message.warning('桌面目录尚未就绪，请稍后再试');
                    return;
                }
            }
            if (action === 'newWindow') {
                this.openDesktopExplorerWindow();
            } else if (action === 'newFolder') {
                this.desktopNewFolder(surfaceWin);
            } else if (action === 'newFile') {
                this.desktopNewFile(surfaceWin);
            } else if (action === 'upload') {
                this.pickDesktopUpload(surfaceWin);
            } else if (action === 'openTerminal') {
                if (this.desktopServerReady()) {
                    this.openDesktopTerminalWindow(dir);
                }
            } else if (action === 'paste') {
                this.pasteDesktop({
                    id: '__surface__',
                    type: 'surface',
                    path: this.desktop.surface.dir
                }, this.desktop.surface.dir);
            } else if (action === 'refresh') {
                this.refreshDesktopSurface();
            } else if (action === 'personalize') {
                this.openDesktopSettings();
            } else if (action === 'return') {
                if (!this.desktop.local) {
                    this.openTerminalInNewTab();
                }
            }
        },
        isDeskFavorite: function (w) {
            var p = (w && w.path) || '';
            if (!p) {
                return false;
            }
            return (this.desktopCommonDirs || []).some(function (d) {
                return d.path === p;
            });
        },
        toggleDeskFavorite: function (w) {
            var t = this.desktopTab;
            if (!t || t.connId == null || !w || !w.path || w.pathEditing) {
                return;
            }
            var self = this;
            var path = w.path;
            var cid = t.connId;
            var ready = Object.prototype.hasOwnProperty.call(this.commonDirsByConn, cid)
                ? Promise.resolve()
                : this.loadCommonDirs(cid);
            ready.then(function () {
                var existing = (self.commonDirsByConn[cid] || []).find(function (d) {
                    return d.path === path;
                });
                if (existing) {
                    self.$confirm('从常用目录中移除「' + path + '」？', '提示', { type: 'warning' })
                        .then(function () {
                            return http.delete('/api/common-dirs/' + existing.id,
                                { params: { connId: cid } });
                        })
                        .then(function () {
                            ELEMENT.Message.success('已从常用目录移除');
                            return self.loadCommonDirs(cid);
                        })
                        .catch(function () { /* 取消或已提示 */ });
                    return;
                }
                http.post('/api/common-dirs', { connId: cid, path: path }).then(function () {
                    ELEMENT.Message.success('已收藏到常用目录');
                    return self.loadCommonDirs(cid);
                }).catch(function () {
                    // 可能已被其他窗口添加，刷新一次同步星标
                    self.loadCommonDirs(cid);
                });
            });
        },
        onDesktopTaskContextMenu: function (ev, w) {
            if (!w) {
                return;
            }
            this.desktop.startOpen = false;
            this.desktop.menu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.calendarOpen = false;
            this.desktop.taskbarMenu.visible = false;
            this.desktop.trayMenu.visible = false;
            this.taskmgr.ctxMenu.visible = false;
            this.closeDesktopSubMenus();
            this.desktop.taskMenu = {
                visible: true,
                x: Math.max(8, Math.min(ev.clientX, window.innerWidth - 260)),
                y: Math.max(8, ev.clientY - 340),
                winId: w.id
            };
            var self = this;
            this.$nextTick(function () {
                var el = self.$refs.deskTaskMenu;
                if (!el || !self.desktop.taskMenu.visible) {
                    return;
                }
                var h = el.offsetHeight || 300;
                var width = el.offsetWidth || 240;
                self.desktop.taskMenu.x = Math.max(8,
                    Math.min(ev.clientX, window.innerWidth - width - 8));
                self.desktop.taskMenu.y = Math.max(8, ev.clientY - h - 8);
            });
        },
        closeDesktopTaskMenu: function () {
            if (this.desktop.taskMenu.visible) {
                this.desktop.taskMenu.visible = false;
            }
            if (this.desktop.iconMenu.visible) {
                this.desktop.iconMenu.visible = false;
            }
            if (this.desktop.taskbarMenu.visible) {
                this.desktop.taskbarMenu.visible = false;
            }
            if (this.desktop.trayMenu.visible) {
                this.desktop.trayMenu.visible = false;
            }
            if (this.taskmgr.ctxMenu.visible) {
                this.taskmgr.ctxMenu.visible = false;
            }
        },
        desktopTaskOpenCommon: function (path) {
            this.desktop.taskMenu.visible = false;
            if (path) {
                this.openDesktopWindow(path);
            }
        },
        desktopTaskNewWindow: function () {
            var w = this.desktopTaskMenuWin;
            this.desktop.taskMenu.visible = false;
            this.openDesktopWindow((w && w.path) || this.desk.path || this.desktopHomeDir || '/');
        },
        desktopTaskNewTerminalWindow: function () {
            var w = this.desktopTaskMenuWin;
            this.desktop.taskMenu.visible = false;
            var tab = w && w.termTab;
            var dir = (tab && (tab.termCwd || tab.initialDir)) || '';
            this.openDesktopTerminalWindow(dir);
        },
        desktopTaskSwitchWindow: function () {
            var w = this.desktopTaskMenuWin;
            this.desktop.taskMenu.visible = false;
            if (w) {
                this.restoreDesktopWindow(w);
            }
        },
        desktopTaskCloseWindow: function () {
            var w = this.desktopTaskMenuWin;
            this.desktop.taskMenu.visible = false;
            if (w) {
                this.closeDesktopWindow(w);
            }
        },

        /* ---------- 任务栏空白右键 / 任务管理器 ---------- */
        onDesktopTaskbarContextMenu: function (ev) {
            var target = ev && ev.target;
            if (target && target.closest
                    && target.closest('button, .dsk-tray, .dsk-tray-clock, .dsk-menu')) {
                return;
            }
            this.desktop.startOpen = false;
            this.desktop.calendarOpen = false;
            this.desktop.taskMenu.visible = false;
            this.desktop.iconMenu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.menu.visible = false;
            this.desktop.trayMenu.visible = false;
            this.taskmgr.ctxMenu.visible = false;
            this.closeDesktopSubMenus();
            this.desktop.taskbarMenu = {
                visible: true,
                x: Math.max(8, Math.min(ev.clientX, window.innerWidth - 240)),
                y: Math.max(8, ev.clientY - 100)
            };
            var self = this;
            this.$nextTick(function () {
                var el = self.$refs.deskTaskbarMenu;
                if (!el || !self.desktop.taskbarMenu.visible) {
                    return;
                }
                var h = el.offsetHeight || 84;
                var w = el.offsetWidth || 216;
                self.desktop.taskbarMenu.x = Math.max(8,
                    Math.min(ev.clientX, window.innerWidth - w - 8));
                self.desktop.taskbarMenu.y = Math.max(8, ev.clientY - h - 8);
            });
        },
        desktopTaskbarMenuAction: function (action) {
            this.desktop.taskbarMenu.visible = false;
            if (action === 'taskmgr') {
                this.openTaskManager();
            } else if (action === 'showDesktop') {
                this.toggleShowDesktop();
            } else if (action === 'reconnect') {
                this.desktopReconnectSession();
            }
        },
        openDesktopTrayMenu: function (ev) {
            if (!this.desktopTab) {
                return;
            }
            this.desktop.startOpen = false;
            this.desktop.calendarOpen = false;
            this.desktop.taskMenu.visible = false;
            this.desktop.taskbarMenu.visible = false;
            this.desktop.iconMenu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.menu.visible = false;
            this.taskmgr.ctxMenu.visible = false;
            this.closeDesktopSubMenus();
            var x = ev ? ev.clientX : 8;
            var y = ev ? ev.clientY : 8;
            this.desktop.trayMenu = {
                visible: true,
                x: Math.max(8, Math.min(x, window.innerWidth - 240)),
                y: Math.max(8, y - 170)
            };
            var self = this;
            this.$nextTick(function () {
                var el = self.$refs.deskTrayMenu;
                if (!el || !self.desktop.trayMenu.visible) {
                    return;
                }
                var h = el.offsetHeight || 180;
                var w = el.offsetWidth || 216;
                self.desktop.trayMenu.x = Math.max(8,
                    Math.min(x, window.innerWidth - w - 8));
                self.desktop.trayMenu.y = Math.max(8, y - h - 8);
            });
        },
        desktopTrayMenuAction: function (action) {
            this.desktop.trayMenu.visible = false;
            if (action === 'reconnect') {
                this.desktopReconnectSession();
            } else if (action === 'disconnect') {
                this.desktopDisconnectSession();
            } else if (action === 'sysinfo') {
                this.openDesktopSysInfo();
            } else if (action === 'settings') {
                this.openDesktopSettings();
                this.desktop.settingsSection = 'network';
            }
        },
        openTaskManager: function () {
            if (!this.desktop.visible) {
                return null;
            }
            if (!this.desktopServerReady()) {
                return null;
            }
            this.desktop.taskbarMenu.visible = false;
            this.desktop.trayMenu.visible = false;
            this.desktop.startOpen = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.taskMenu.visible = false;
            this.desktop.iconMenu.visible = false;
            this.desktop.calendarOpen = false;
            this.closeDesktopSubMenus();
            var existing = this.taskmgrWin;
            if (existing) {
                this.restoreDesktopWindow(existing);
                if (this.taskmgr.tab === 'details') {
                    this.loadTaskmgrDetails(true);
                } else if (this.taskmgr.tab === 'performance') {
                    this.loadTaskmgrSysInfo(false);
                }
                return existing;
            }
            var w = this.addDesktopWindow('taskmgr');
            var area = this.desktopWindowWorkArea();
            var width = Math.min(area.width - 20, Math.max(560, Math.round(area.width * 0.74)));
            var height = Math.min(area.height - 20, Math.max(440, Math.round(area.height * 0.86)));
            this.applyDesktopWindowGeometry(w, {
                x: Math.round((area.width - width) / 2),
                y: Math.round((area.height - height) / 2),
                w: width,
                h: height
            });
            this.taskmgr.winId = w.id;
            this.taskmgr.tab = 'processes';
            this.taskmgr.selected = '';
            this.taskmgr.search = '';
            this.taskmgr.runVisible = false;
            this.taskmgr.runText = '';
            this.taskmgr.ctxMenu.visible = false;
            this.taskmgr.detail.selectedPid = 0;
            this.taskmgr.detail.overlayVisible = false;
            this.taskmgr.history = { cpu: [], mem: [], disk: [], rx: [], tx: [] };
            this.initTaskmgrBg();
            this.taskmgrTick(true);
            this.startTaskmgrTimer();
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
            return w;
        },
        switchTaskmgrTab: function (id) {
            if (!id) {
                return;
            }
            this.taskmgr.tab = id;
            this.taskmgr.ctxMenu.visible = false;
            this.taskmgr.runVisible = false;
            if (id === 'performance') {
                this.loadTaskmgrSysInfo(false);
            } else if (id === 'details') {
                this.loadTaskmgrDetails(true);
            }
        },
        toggleTaskmgrRun: function () {
            this.taskmgr.runVisible = !this.taskmgr.runVisible;
            var self = this;
            if (this.taskmgr.runVisible) {
                this.$nextTick(function () {
                    var r = self.$refs.tmRunInput;
                    if (r && r.focus) {
                        r.focus();
                    }
                });
            }
        },
        runTaskmgrCommand: function () {
            var text = String(this.taskmgr.runText || '').trim().toLowerCase();
            if (!text) {
                return;
            }
            var map = {
                '任务管理器': 'taskmgr', 'taskmgr': 'taskmgr', 'task manager': 'taskmgr',
                '资源管理器': 'file', 'explorer': 'file', '文件': 'file', '文件管理器': 'file',
                '终端': 'terminal', 'terminal': 'terminal', 'ssh': 'terminal',
                'ai': 'ai', 'ai 终端': 'ai', 'ai终端': 'ai',
                '传输中心': 'transfers', '传输': 'transfers', 'transfers': 'transfers',
                '磁盘': 'disk', '磁盘分析': 'disk', '磁盘占用': 'disk', 'disk': 'disk',
                '设置': 'control', '控制面板': 'control', 'settings': 'control'
            };
            var id = map[text];
            if (!id) {
                ELEMENT.Message.warning('找不到应用：' + text
                    + '。可输入：资源管理器、终端、AI 终端、传输中心、磁盘、任务管理器、设置');
                return;
            }
            this.taskmgr.runVisible = false;
            this.taskmgr.runText = '';
            this.desktopLaunchApp(id);
        },
        startTaskmgrTimer: function () {
            this.stopTaskmgrTimer();
            var self = this;
            this._tmTimer = setInterval(function () {
                self.taskmgrTick();
            }, 2000);
        },
        stopTaskmgrTimer: function () {
            if (this._tmTimer) {
                clearInterval(this._tmTimer);
                this._tmTimer = null;
            }
        },
        taskmgrTick: function (initial) {
            if (!this.desktop.visible || !this.taskmgrWin) {
                this.stopTaskmgrTimer();
                return;
            }
            if (!this.taskmgr.bg.length) {
                this.initTaskmgrBg();
            }
            var sec = initial ? 0 : 2;
            this.sampleTaskmgrApps();
            this.sampleTaskmgrBg();
            this.accumulateTaskmgrHistory(sec);
            this.pushTaskmgrHistory();
            if (!initial && this.taskmgr.tab === 'details'
                    && !this.taskmgr.detail.loading
                    && Date.now() - this.taskmgr.detail.loadedAt > 2900) {
                this.loadTaskmgrDetails();
            }
            if (this.taskmgr.tab === 'performance' && !this.taskmgr.sysInfo
                    && !this.taskmgr.sysInfoLoading && !this.taskmgr.sysInfoError) {
                this.loadTaskmgrSysInfo(false);
            }
        },
        initTaskmgrBg: function () {
            if (this.taskmgr.bg.length) {
                return;
            }
            this.taskmgr.bg = [
                { pid: 776, name: '桌面外壳', icon: 'el-icon-monitor', color: '#64748b',
                  desc: '桌面、任务栏与窗口管理', status: '正在运行',
                  cpu: 0.4, mem: 58.2, disk: 0.1, net: 0, baseCpu: 0.4, baseMem: 58 },
                { pid: 1088, name: 'SSH 会话服务', icon: 'el-icon-connection', color: '#3b82f6',
                  desc: '安全会话与终端通道', status: '正在运行',
                  cpu: 0.3, mem: 36.4, disk: 0.1, net: 0, baseCpu: 0.3, baseMem: 36 },
                { pid: 2096, name: 'SFTP 文件服务', icon: 'el-icon-folder-opened', color: '#e6a23c',
                  desc: '远程文件浏览与传输', status: '正在运行',
                  cpu: 0.2, mem: 42.8, disk: 0.1, net: 0, baseCpu: 0.2, baseMem: 42 },
                { pid: 3184, name: '传输服务', icon: 'el-icon-s-promotion', color: '#0ea5a4',
                  desc: '文件传输队列', status: '空闲',
                  cpu: 0.1, mem: 31.6, disk: 0.1, net: 0, baseCpu: 0.1, baseMem: 31 },
                { pid: 2760, name: 'AI 助手服务', icon: 'el-icon-magic-stick', color: '#8b5cf6',
                  desc: 'AI 对话与命令生成', status: '正在运行',
                  cpu: 0.2, mem: 48.3, disk: 0.1, net: 0, baseCpu: 0.2, baseMem: 48 },
                { pid: 3520, name: '监控采样服务', icon: 'el-icon-data-line', color: '#0f6cbd',
                  desc: '采集服务器性能指标', status: '正在运行',
                  cpu: 0.2, mem: 26.5, disk: 0.1, net: 0, baseCpu: 0.2, baseMem: 26 }
            ];
        },
        sampleTaskmgrApps: function () {
            var t = this.desktopTab;
            var aiBusy = t ? !!this.chatAnyBusy(t) : false;
            var transferBusy = this.transferActiveCount;
            this.desktop.windows.forEach(function (w) {
                var baseCpu = 0.3;
                var baseMem = 120;
                if (w.type === 'explorer') {
                    baseCpu = 0.35;
                    baseMem = 150 + (w.entries ? w.entries.length : 0) * 1.1;
                } else if (w.type === 'terminal') {
                    baseCpu = 0.15;
                    baseMem = 68;
                } else if (w.type === 'ai') {
                    baseCpu = aiBusy ? 6 : 0.5;
                    baseMem = 218;
                } else if (w.type === 'transfer') {
                    baseCpu = transferBusy ? 2.6 : 0.25;
                    baseMem = 62;
                } else if (w.type === 'disk') {
                    baseCpu = w.diskLoading ? 4.2 : 0.35;
                    baseMem = 78;
                } else if (w.type === 'taskmgr') {
                    baseCpu = 1.1;
                    baseMem = 42;
                }
                if (w.min) {
                    baseCpu *= 0.25;
                }
                var cpuTarget = baseCpu + Math.random() * (aiBusy && w.type === 'ai' ? 5 : 0.4);
                w.tmCpu = Math.round((w.tmCpu ? w.tmCpu * 0.55 + cpuTarget * 0.45 : cpuTarget) * 10) / 10;
                w.tmMem = Math.round((w.tmMem
                    ? w.tmMem * 0.82 + baseMem * 0.18
                    : baseMem + Math.random() * 8) * 10) / 10;
                w.tmDisk = Math.round((transferBusy && w.type === 'transfer'
                    ? 1 + Math.random() * 2.4
                    : Math.random() * 0.2) * 10) / 10;
                w.tmNet = Math.round((transferBusy && w.type === 'transfer'
                    ? 8 + Math.random() * 56
                    : (aiBusy && w.type === 'ai' ? 0.1 + Math.random() * 0.2 : 0)) * 10) / 10;
            });
        },
        sampleTaskmgrBg: function () {
            var t = this.desktopTab;
            var connected = !!(t && t.status === 'open');
            var st = this.tmStats;
            var aiBusy = t ? !!this.chatAnyBusy(t) : false;
            var busy = this.transferActiveCount;
            this.taskmgr.bg.forEach(function (p) {
                var cpu = p.baseCpu;
                if (p.pid === 1088) {
                    cpu = connected ? 0.3 + Math.random() * 0.3 : 0.04;
                    p.status = connected ? '正在运行' : '已停止';
                } else if (p.pid === 3184) {
                    cpu = busy ? 1.4 + Math.random() * 2.2 : 0.1;
                    p.status = busy ? '正在运行' : '空闲';
                } else if (p.pid === 2760) {
                    cpu = aiBusy ? 3 + Math.random() * 4 : 0.2;
                } else if (p.pid === 3520) {
                    if (st && st.error) {
                        cpu = 0.04;
                        p.status = '已停止';
                    } else if (st) {
                        cpu = 0.2 + Math.random() * 0.15;
                        p.status = '正在运行';
                    } else {
                        cpu = 0.1;
                        p.status = '等待中';
                    }
                } else {
                    cpu = p.baseCpu * (0.7 + Math.random() * 0.6);
                }
                p.cpu = Math.round(cpu * 10) / 10;
                p.mem = Math.round((p.mem * 0.9 + p.baseMem * 0.1
                    + (Math.random() - 0.5) * 0.8) * 10) / 10;
                p.disk = Math.round((busy && p.pid === 3184
                    ? 0.5 + Math.random() * 1.4
                    : Math.random() * 0.15) * 10) / 10;
                p.net = busy && p.pid === 3184 ? Math.round((3 + Math.random() * 8) * 10) / 10 : 0;
            });
        },
        trackTaskmgrAppLaunch: function (type) {
            if (['explorer', 'terminal', 'ai', 'transfer', 'disk', 'taskmgr'].indexOf(type) < 0) {
                return;
            }
            if (!this.taskmgr.appHistory[type]) {
                this.$set(this.taskmgr.appHistory, type, {
                    cpuSec: 0, netBytes: 0, memPeak: 0, opens: 0
                });
            }
            this.taskmgr.appHistory[type].opens =
                (this.taskmgr.appHistory[type].opens || 0) + 1;
        },
        accumulateTaskmgrHistory: function (sec) {
            var totals = {};
            this.desktop.windows.forEach(function (w) {
                var cur = totals[w.type] || { cpu: 0, net: 0, mem: 0 };
                cur.cpu += w.tmCpu || 0;
                cur.net += w.tmNet || 0;
                cur.mem += w.tmMem || 0;
                totals[w.type] = cur;
            });
            var self = this;
            Object.keys(totals).forEach(function (type) {
                var e = self.taskmgr.appHistory[type];
                if (!e) {
                    self.$set(self.taskmgr.appHistory, type, {
                        cpuSec: 0, netBytes: 0, memPeak: 0, opens: 0
                    });
                    e = self.taskmgr.appHistory[type];
                }
                e.cpuSec += totals[type].cpu * sec / 100;
                e.netBytes += totals[type].net * 1000000 / 8 * sec;
                e.memPeak = Math.max(e.memPeak || 0, totals[type].mem);
            });
        },
        clearTaskmgrHistory: function () {
            this.taskmgr.appHistory = {};
            var self = this;
            var seen = {};
            this.desktop.windows.forEach(function (w) {
                if (!seen[w.type]) {
                    seen[w.type] = true;
                    self.trackTaskmgrAppLaunch(w.type);
                }
            });
            this.accumulateTaskmgrHistory(0);
            ELEMENT.Message.success('应用历史记录已清除');
        },
        pushTmSeries: function (key, value) {
            if (value == null || isNaN(value)) {
                return;
            }
            var arr = this.taskmgr.history[key];
            if (!arr) {
                this.$set(this.taskmgr.history, key, []);
                arr = this.taskmgr.history[key];
            }
            arr.push(Number(value));
            while (arr.length > 60) {
                arr.shift();
            }
        },
        pushTaskmgrHistory: function () {
            var st = this.tmStats;
            if (st && !st.error) {
                this.pushTmSeries('cpu', st.cpu);
                this.pushTmSeries('mem', st.memPct);
                this.pushTmSeries('rx', st.rxRate == null ? 0 : st.rxRate);
                this.pushTmSeries('tx', st.txRate == null ? 0 : st.txRate);
            }
            var d = this.tmDiskInfo;
            if (d && d.pct != null) {
                this.pushTmSeries('disk', d.pct);
            }
        },
        tmSortProcessRows: function (rows) {
            var by = this.taskmgr.procSortBy;
            var dir = this.taskmgr.procSortDir === 'asc' ? 1 : -1;
            return rows.slice().sort(function (a, b) {
                var va = by === 'mem' ? (a.tmMem || 0) : (a.tmCpu != null ? a.tmCpu : (a.cpu || 0));
                var vb = by === 'mem' ? (b.tmMem || 0) : (b.tmCpu != null ? b.tmCpu : (b.cpu || 0));
                if (va === vb) {
                    return 0;
                }
                return (va - vb) * dir;
            });
        },
        sortTaskmgrProcesses: function (by) {
            if (this.taskmgr.procSortBy === by) {
                this.taskmgr.procSortDir = this.taskmgr.procSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                this.taskmgr.procSortBy = by;
                this.taskmgr.procSortDir = 'desc';
            }
        },
        tmProcSortIcon: function (by) {
            if (this.taskmgr.procSortBy !== by) {
                return '';
            }
            return this.taskmgr.procSortDir === 'asc' ? 'el-icon-sort-up' : 'el-icon-sort-down';
        },
        selectTaskmgrRow: function (key) {
            this.taskmgr.selected = key;
        },
        tmWindowIcon: function (w) {
            return this.desktopWindowIcon(w);
        },
        tmWindowColor: function (w) {
            var map = {
                explorer: '#e6a23c',
                terminal: '#22a06b',
                ai: '#3d7eff',
                transfer: '#0ea5a4',
                disk: '#f59e0b',
                taskmgr: '#0f6cbd'
            };
            return map[(w && w.type) || 'explorer'] || '#64748b';
        },
        tmFmtPct: function (v) {
            if (v == null || isNaN(v)) {
                return '--';
            }
            return (Math.round(v * 10) / 10) + '%';
        },
        tmFmtDisk: function (v) {
            if (v == null || v < 0.05) {
                return '—';
            }
            return (Math.round(v * 10) / 10) + ' MB/s';
        },
        tmFmtNet: function (v) {
            if (v == null || v < 0.05) {
                return '—';
            }
            return v >= 1 ? (Math.round(v * 10) / 10) + ' Mbps'
                : Math.round(v * 1000) + ' Kbps';
        },
        tmFmtCpuTime: function (sec) {
            var s = Math.max(0, Math.round(sec || 0));
            var h = Math.floor(s / 3600);
            var m = Math.floor(s % 3600 / 60);
            var r = s % 60;
            var pad = function (x) { return x < 10 ? '0' + x : '' + x; };
            return h + ':' + pad(m) + ':' + pad(r);
        },
        endTaskmgrSelected: function () {
            var sel = this.taskmgr.selected || '';
            if (sel.indexOf('win:') !== 0) {
                return;
            }
            this.endTaskmgrWindow(this.desktopWindowById(sel.substring(4)));
        },
        endTaskmgrWindow: function (w) {
            if (!w) {
                return;
            }
            var self = this;
            var name = this.desktopWindowTitle(w);
            this.$confirm('结束「' + name + '」？该窗口将被关闭，未保存的输入可能会丢失。',
                '结束任务', { type: 'warning', confirmButtonText: '结束任务', cancelButtonText: '取消' })
                .then(function () {
                    self.taskmgr.ctxMenu.visible = false;
                    self.closeDesktopWindow(w);
                })
                .catch(function () { /* 取消 */ });
        },
        activateTaskmgrWindow: function (w) {
            if (!w || w.type === 'taskmgr') {
                return;
            }
            this.restoreDesktopWindow(w);
        },
        openTaskmgrContextMenu: function (ev, kind, key) {
            this.desktop.taskMenu.visible = false;
            this.desktop.taskbarMenu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.menu.visible = false;
            this.desktop.startOpen = false;
            var title = '';
            if (kind === 'app') {
                var w = this.desktopWindowById(String(key || '').substring(4));
                if (!w) {
                    return;
                }
                this.taskmgr.selected = key;
                title = this.desktopWindowTitle(w);
            } else if (kind === 'bg') {
                this.taskmgr.selected = key;
                for (var i = 0; i < this.taskmgr.bg.length; i++) {
                    if ('bg:' + this.taskmgr.bg[i].pid === key) {
                        title = this.taskmgr.bg[i].name;
                        break;
                    }
                }
            } else {
                var pid = Number(String(key || '').substring(4));
                this.taskmgr.detail.selectedPid = pid;
                var row = this.tmDetailRowByPid(pid);
                title = (row ? (row.comm || '') : '') + '（PID ' + pid + '）';
            }
            this.taskmgr.ctxMenu = {
                visible: true,
                x: Math.max(8, Math.min(ev.clientX, window.innerWidth - 240)),
                y: Math.max(8, ev.clientY),
                kind: kind,
                key: key,
                title: title
            };
            var self = this;
            this.$nextTick(function () {
                var el = self.$refs.tmCtxMenu;
                if (!el || !self.taskmgr.ctxMenu.visible) {
                    return;
                }
                var h = el.offsetHeight || 160;
                var w = el.offsetWidth || 220;
                self.taskmgr.ctxMenu.x = Math.max(8,
                    Math.min(ev.clientX, window.innerWidth - w - 8));
                self.taskmgr.ctxMenu.y = Math.max(8,
                    Math.min(ev.clientY, window.innerHeight - h - 8));
            });
        },
        tmDetailRowByPid: function (pid) {
            for (var i = 0; i < this.taskmgr.detail.rows.length; i++) {
                if (this.taskmgr.detail.rows[i].pid === pid) {
                    return this.taskmgr.detail.rows[i];
                }
            }
            return null;
        },
        tmCtxAction: function (action) {
            var menu = this.taskmgr.ctxMenu;
            this.taskmgr.ctxMenu.visible = false;
            if (menu.kind === 'app') {
                var w = this.desktopWindowById(String(menu.key || '').substring(4));
                if (!w) {
                    return;
                }
                if (action === 'switch') {
                    this.restoreDesktopWindow(w);
                } else if (action === 'endApp') {
                    this.endTaskmgrWindow(w);
                }
                return;
            }
            if (menu.kind === 'detail') {
                var row = this.tmDetailRowByPid(Number(String(menu.key || '').substring(4)));
                if (!row) {
                    return;
                }
                if (action === 'viewDetail') {
                    this.openTaskmgrProcessDetail(row);
                } else if (action === 'copyCmd') {
                    var cmd = row.args || row.comm || '';
                    if (cmd) {
                        this.copyText(cmd);
                    }
                } else if (action === 'end') {
                    this.killTaskmgrProcess(false, row);
                } else if (action === 'kill') {
                    this.killTaskmgrProcess(true, row);
                }
            }
        },
        loadTaskmgrSysInfo: function (force) {
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                this.taskmgr.sysInfoError = '当前会话未就绪，无法读取服务器信息';
                return;
            }
            if (!force && this.taskmgr.sysInfo
                    && Date.now() - this.taskmgr.sysInfoAt < 60000) {
                return;
            }
            if (this.taskmgr.sysInfoLoading) {
                return;
            }
            var self = this;
            this.taskmgr.sysInfoLoading = true;
            this.taskmgr.sysInfoError = '';
            http.get('/api/system/info', {
                params: { sessionId: t.sessionId },
                silent: true
            }).then(function (info) {
                self.taskmgr.sysInfo = info || null;
                self.taskmgr.sysInfoAt = Date.now();
            }).catch(function (e) {
                self.taskmgr.sysInfoError = '读取服务器信息失败：'
                    + ((e && e.message) || '未知错误');
            }).then(function () {
                self.taskmgr.sysInfoLoading = false;
            });
        },
        tmSysValue: function (section, label) {
            var info = this.taskmgr.sysInfo;
            if (!info || !info[section]) {
                return '';
            }
            var rows = info[section];
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].label === label) {
                    return rows[i].value || '';
                }
            }
            return '';
        },
        loadTaskmgrDetails: function (force) {
            var d = this.taskmgr.detail;
            if (d.loading) {
                return;
            }
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                d.error = '当前会话未就绪，无法读取服务器进程';
                return;
            }
            if (!force && d.loadedAt && Date.now() - d.loadedAt < 2800) {
                return;
            }
            var self = this;
            d.loading = true;
            d.error = '';
            http.get('/api/process/list', {
                params: { sessionId: t.sessionId },
                silent: true
            }).then(function (list) {
                d.rows = list || [];
                d.loadedAt = Date.now();
                if (d.selectedPid && !self.tmDetailRowByPid(d.selectedPid)) {
                    d.selectedPid = 0;
                }
            }).catch(function (e) {
                d.error = '读取服务器进程失败：' + ((e && e.message) || '未知错误');
                d.loadedAt = Date.now();
            }).then(function () {
                d.loading = false;
            });
        },
        sortTaskmgrDetails: function (by) {
            var d = this.taskmgr.detail;
            if (d.sortBy === by) {
                d.sortDir = d.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                d.sortBy = by;
                d.sortDir = by === 'cpu' || by === 'mem' ? 'desc' : 'asc';
            }
        },
        tmDetailSortIcon: function (by) {
            if (this.taskmgr.detail.sortBy !== by) {
                return '';
            }
            return this.taskmgr.detail.sortDir === 'asc' ? 'el-icon-sort-up' : 'el-icon-sort-down';
        },
        openTaskmgrProcessDetail: function (row) {
            if (!row) {
                return;
            }
            var d = this.taskmgr.detail;
            d.selectedPid = row.pid;
            d.overlayRow = row;
            d.overlayCmd = row.args || row.comm || '';
            d.overlayVisible = true;
            d.overlayLoading = true;
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                d.overlayLoading = false;
                return;
            }
            var self = this;
            http.get('/api/process/detail', {
                params: { sessionId: t.sessionId, pid: row.pid },
                silent: true
            }).then(function (data) {
                if (self.taskmgr.detail.overlayRow === row && data && data.command) {
                    self.taskmgr.detail.overlayCmd = data.command;
                }
            }).catch(function () {
                /* 保留列表中的命令行 */
            }).then(function () {
                if (self.taskmgr.detail.overlayRow === row) {
                    self.taskmgr.detail.overlayLoading = false;
                }
            });
        },
        closeTaskmgrProcessDetail: function () {
            this.taskmgr.detail.overlayVisible = false;
            this.taskmgr.detail.overlayRow = null;
            this.taskmgr.detail.overlayCmd = '';
            this.taskmgr.detail.overlayLoading = false;
        },
        copyTaskmgrCmd: function () {
            var d = this.taskmgr.detail;
            var text = d.overlayCmd || (d.overlayRow ? (d.overlayRow.args || d.overlayRow.comm) : '');
            if (!text) {
                ELEMENT.Message.warning('没有可复制的命令行');
                return;
            }
            this.copyText(text);
        },
        killTaskmgrProcess: function (force, row) {
            row = row || this.tmDetailSelected;
            if (!row) {
                return;
            }
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('当前会话未就绪，无法结束服务器进程');
                return;
            }
            var self = this;
            var action = force ? '强制结束（SIGKILL）' : '结束（SIGTERM）';
            this.$confirm(action + ' 进程「' + (row.comm || row.pid) + '」（PID ' + row.pid + '）？',
                '结束服务器进程', { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' })
                .then(function () {
                    return http.post('/api/process/kill', {
                        sessionId: t.sessionId,
                        pid: row.pid,
                        force: !!force
                    });
                })
                .then(function () {
                    ELEMENT.Message.success('已发送 ' + (force ? 'SIGKILL' : 'SIGTERM'));
                    if (self.taskmgr.detail.overlayRow
                            && self.taskmgr.detail.overlayRow.pid === row.pid) {
                        self.closeTaskmgrProcessDetail();
                    }
                    self.taskmgr.detail.loadedAt = 0;
                    self.loadTaskmgrDetails(true);
                })
                .catch(function () { /* 取消或失败（已提示） */ });
        },
        tmPerfValue: function (id) {
            var st = this.tmStats;
            if (id === 'network') {
                if (!st || st.error) {
                    return '--';
                }
                return this.fmtRate((st.rxRate || 0) + (st.txRate || 0));
            }
            if (id === 'disk') {
                var d = this.tmDiskInfo;
                return d && d.pct != null ? d.pct + '%' : '--';
            }
            if (id === 'memory') {
                return st && !st.error && st.memPct != null ? Math.round(st.memPct) + '%' : '--';
            }
            return st && !st.error && st.cpu != null ? Math.round(st.cpu) + '%' : '--';
        },
        tmHistoryKey: function (id) {
            if (id === 'memory') {
                return 'mem';
            }
            if (id === 'network') {
                return 'rx';
            }
            return id;
        },
        tmChartX: function (i, len) {
            if (len <= 1) {
                return 100;
            }
            return Math.round(i * 10000 / (len - 1)) / 100;
        },
        tmChartPoints: function (key) {
            key = this.tmHistoryKey(key);
            var arr = this.taskmgr.history[key] || [];
            if (!arr.length) {
                return '';
            }
            var max = key === 'rx' || key === 'tx' ? this.tmNetChartMax() : 100;
            var y = function (v) {
                return Math.round((38 - Math.min(max, Math.max(0, v)) / max * 36) * 100) / 100;
            };
            if (arr.length === 1) {
                var flat = y(arr[0]);
                return '0,' + flat + ' 100,' + flat;
            }
            var out = [];
            for (var i = 0; i < arr.length; i++) {
                out.push(this.tmChartX(i, arr.length) + ',' + y(arr[i]));
            }
            return out.join(' ');
        },
        tmSparkPoints: function (id) {
            var arr;
            if (id === 'network') {
                var rx = this.taskmgr.history.rx || [];
                var tx = this.taskmgr.history.tx || [];
                var n = Math.max(rx.length, tx.length);
                arr = [];
                for (var i = 0; i < n; i++) {
                    arr.push((rx[i] || 0) + (tx[i] || 0));
                }
            } else {
                arr = this.taskmgr.history[this.tmHistoryKey(id)] || [];
            }
            if (!arr.length) {
                return '';
            }
            var max = id === 'network' ? this.tmNetChartMax() : 100;
            var y = function (v) {
                return Math.round((24 - Math.min(max, Math.max(0, v)) / max * 20) * 100) / 100;
            };
            if (arr.length === 1) {
                var flat = y(arr[0]);
                return '0,' + flat + ' 100,' + flat;
            }
            var out = [];
            for (var j = 0; j < arr.length; j++) {
                out.push(this.tmChartX(j, arr.length) + ',' + y(arr[j]));
            }
            return out.join(' ');
        },
        tmNetChartMax: function () {
            var max = 0;
            ['rx', 'tx'].forEach(function (key) {
                var arr = this.taskmgr.history[key] || [];
                for (var i = 0; i < arr.length; i++) {
                    max = Math.max(max, arr[i] || 0);
                }
            }, this);
            return Math.max(1024, max * 1.15);
        },
        tmNetTotalBytes: function (field) {
            var info = this.taskmgr.sysInfo;
            if (!info || !info.net || !info.net.length) {
                return '—';
            }
            var total = 0;
            info.net.forEach(function (n) {
                total += Number(n[field]) || 0;
            });
            return this.fmtSize(total);
        },
        toggleTaskmgrStartup: function (id) {
            var on = !this.taskmgr.startup[id];
            this.$set(this.taskmgr.startup, id, on);
            try {
                localStorage.setItem('deepshell.desktopStartup',
                    JSON.stringify(this.taskmgr.startup));
            } catch (e) { /* ignore */ }
        },
        applyDesktopStartupApps: function () {
            var cfg = this.taskmgr.startup || {};
            if (cfg.ai && !this.desktopAppBlocked('ai')) {
                this.openAiDesktopWindow();
            }
            if (cfg.transfers) {
                this.openTransferDesktopWindow();
            }
            if (cfg.disk && !this.desktopAppBlocked('disk')) {
                this.openDiskDesktopWindow();
            }
            if (cfg.terminal && !this.desktopAppBlocked('terminal')) {
                this.openDesktopTerminalWindow();
            }
            if (cfg.taskmgr && !this.desktopAppBlocked('taskmgr')) {
                this.openTaskManager();
            }
        },
        resetTaskmgrState: function () {
            this.stopTaskmgrTimer();
            var tm = this.taskmgr;
            tm.winId = '';
            tm.tab = 'processes';
            tm.selected = '';
            tm.search = '';
            tm.runVisible = false;
            tm.runText = '';
            tm.bg = [];
            tm.ctxMenu.visible = false;
            tm.history = { cpu: [], mem: [], disk: [], rx: [], tx: [] };
            tm.detail.rows = [];
            tm.detail.loading = false;
            tm.detail.error = '';
            tm.detail.loadedAt = 0;
            tm.detail.filter = '';
            tm.detail.selectedPid = 0;
            tm.detail.overlayVisible = false;
            tm.detail.overlayRow = null;
            tm.detail.overlayCmd = '';
            tm.detail.overlayLoading = false;
            tm.sysInfo = null;
            tm.sysInfoLoading = false;
            tm.sysInfoError = '';
            tm.sysInfoAt = 0;
            tm.appHistory = {};
        },

        /* ---------- 桌面目录 / 桌面图标 ---------- */
        loadDesktopSurface: function () {
            var t = this.desktopTab;
            if (t && t.local) {
                return this.loadLocalDesktopSurface();
            }
            if (!t || !t.sessionId) {
                return Promise.resolve();
            }
            var self = this;
            var surf = this.desktop.surface;
            this.resetSurfaceThumbs();
            if (!t.sftpHome) {
                surf.loading = true;
                surf.error = '';
                return this.loadHome(t).then(function () {
                    if (!t.sftpHome) {
                        surf.loading = false;
                        surf.error = '无法获取当前用户主目录';
                        return;
                    }
                    return self.loadDesktopSurface();
                });
            }
            var home = t.sftpHome;
            var desktopPath = this.pathJoin(home, 'Desktop');
            var cnPath = this.pathJoin(home, '桌面');
            surf.loading = true;
            surf.error = '';
            var list = function (path) {
                return http.get('/api/sftp/list', {
                    params: { sessionId: t.sessionId, path: path },
                    silent: true
                }).then(function (rows) {
                    return { path: path, rows: rows || [] };
                });
            };
            return list(desktopPath).catch(function () {
                return list(cnPath);
            }).catch(function () {
                return http.post('/api/sftp/mkdir', {
                    sessionId: t.sessionId,
                    path: desktopPath
                }, { silent: true }).then(function () {
                    return list(desktopPath);
                });
            }).then(function (res) {
                res.rows.sort(function (a, b) {
                    if (a.dir !== b.dir) {
                        return a.dir ? -1 : 1;
                    }
                    return String(a.name).localeCompare(String(b.name), 'zh-CN', {
                        numeric: true,
                        sensitivity: 'base'
                    });
                });
                surf.dir = res.path;
                surf.entries = res.rows;
                surf.loaded = true;
                surf.loading = false;
                self.loadSurfaceThumbs();
                self.parseSurfaceShortcuts();
                return self.loadDesktopIconLayout();
            }).catch(function (e) {
                surf.loading = false;
                surf.loaded = false;
                surf.error = '无法读取桌面目录：' + ((e && e.message) || '请检查目录权限');
                self.loadDesktopIconLayout();
                self.rebuildDesktopIconOrder();
            });
        },
        loadLocalDesktopSurface: function () {
            var self = this;
            var surf = this.desktop.surface;
            this.resetSurfaceThumbs();
            surf.loading = true;
            surf.error = '';
            return http.get('/api/local/fs/list', {
                params: { path: '/' },
                silent: true
            }).then(function (list) {
                var rows = list || [];
                rows.sort(function (a, b) {
                    if (a.dir !== b.dir) {
                        return a.dir ? -1 : 1;
                    }
                    return String(a.name).localeCompare(String(b.name), 'zh-CN', {
                        numeric: true,
                        sensitivity: 'base'
                    });
                });
                surf.dir = '/';
                surf.entries = rows;
                surf.loaded = true;
                surf.loading = false;
                self.loadSurfaceThumbs();
                self.parseSurfaceShortcuts();
                return self.loadDesktopIconLayout();
            }).catch(function (e) {
                surf.loading = false;
                surf.loaded = false;
                surf.error = '无法读取本地桌面：' + ((e && e.message) || '请检查数据目录权限');
                self.loadDesktopIconLayout();
                self.rebuildDesktopIconOrder();
            });
        },
        refreshDesktopSurface: function () {
            this.desktop.taskMenu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.iconMenu.visible = false;
            this.desktop.iconSelected = '';
            this.desktop.iconSelectedKeys = [];
            this.cancelDesktopIconMarquee();
            return this.loadDesktopSurface();
        },
        resetSurfaceThumbs: function () {
            this._surfaceThumbGen = (this._surfaceThumbGen || 0) + 1;
            this._surfaceThumbQueued = {};
            this._surfaceThumbActive = 0;
            this._videoThumbActive = 0;
            if (this._surfaceThumbCtrls) {
                this._surfaceThumbCtrls.forEach(function (c) {
                    try { c.abort(); } catch (e) { /* ignore */ }
                });
                this._surfaceThumbCtrls = [];
            }
            var self = this;
            (this.desktop.surface.entries || []).forEach(function (e) {
                if (e._thumb) {
                    try { URL.revokeObjectURL(e._thumb); } catch (err) { /* ignore */ }
                    self.$delete(e, '_thumb');
                }
                if (e._thumbFailed) {
                    self.$delete(e, '_thumbFailed');
                }
            });
        },
        parseSurfaceShortcuts: function () {
            var t = this.desktopTab;
            if (!t || (!t.local && !t.sessionId)) {
                return;
            }
            var self = this;
            var entries = (this.desktop.surface.entries || []).filter(function (e) {
                return !e.dir && /\.lnk$/i.test(e.name);
            });
            if (!entries.length) {
                return;
            }
            var limit = Math.min(entries.length, 50);
            var i = 0;
            var step = function () {
                if (i >= limit) {
                    self.loadSurfaceThumbs();
                    return;
                }
                var e = entries[i++];
                var path = self.pathJoin(self.desktop.surface.dir, e.name);
                var readReq = t.local
                    ? http.get('/api/local/fs/read', { params: { path: path }, silent: true })
                    : http.get('/api/sftp/read', {
                        params: { sessionId: t.sessionId, path: path },
                        silent: true
                    });
                readReq.then(function (text) {
                    var data = null;
                    try {
                        data = JSON.parse(text);
                    } catch (err) { /* ignore */ }
                    if (data && data.type === 'deepshell-shortcut' && data.target) {
                        self.$set(e, '_shortcut', data);
                    }
                }).catch(function () {
                    // 无法解析时保留通用快捷方式图标
                }).then(function () {
                    step();
                });
            };
            step();
        },
        loadSurfaceThumbs: function () {
            var t = this.desktopTab;
            if (!t || (!t.local && !t.sessionId) || !this.desktop.thumbnailsEnabled) {
                return;
            }
            var self = this;
            var gen = this._surfaceThumbGen || 0;
            var tasks = [];
            (this.desktop.surface.entries || []).forEach(function (e) {
                if (!self.desktop.showHidden && String(e.name).charAt(0) === '.') {
                    return;
                }
                var isShortcut = !e.dir && /\.lnk$/i.test(e.name);
                var sc = isShortcut ? e._shortcut : null;
                if (isShortcut && !sc) {
                    return;
                }
                var targetName = isShortcut
                    ? ((sc && sc.label) ? sc.label : e.name.slice(0, -4))
                    : e.name;
                var targetType = isShortcut
                    ? ((sc && sc.targetType) === 'folder' ? 'folder' : 'file')
                    : (e.dir ? 'folder' : 'file');
                if (targetType !== 'file') {
                    return;
                }
                var targetRow = {
                    name: targetName,
                    dir: false,
                    size: isShortcut ? 0 : (e.size || 0)
                };
                if (!self.isDesktopThumbable(targetRow)) {
                    return;
                }
                if (self.isDesktopVideo(targetRow) && targetRow.size > 500 * 1024 * 1024) {
                    return;
                }
                if (e._thumb || e._thumbFailed) {
                    return;
                }
                if (self._surfaceThumbQueued && self._surfaceThumbQueued[e.name]) {
                    return;
                }
                tasks.push({
                    e: e,
                    path: isShortcut && sc
                        ? sc.target
                        : self.pathJoin(self.desktop.surface.dir, e.name),
                    mtime: isShortcut ? 0 : (e.mtime || 0),
                    video: self.isDesktopVideo(targetRow)
                });
            });
            if (!tasks.length) {
                return;
            }
            if (!this._surfaceThumbQueued) {
                this._surfaceThumbQueued = {};
            }
            if (!this._surfaceThumbActive) {
                this._surfaceThumbActive = 0;
            }
            var pump = function () {
                while (self._surfaceThumbActive < 4 && tasks.length) {
                    var pick = -1;
                    for (var pi = 0; pi < tasks.length; pi++) {
                        if (!tasks[pi].video || !(self._videoThumbActive || 0)) {
                            pick = pi;
                            break;
                        }
                    }
                    if (pick < 0) {
                        break;
                    }
                    var task = tasks.splice(pick, 1)[0];
                    if (self._surfaceThumbQueued[task.e.name]) {
                        continue;
                    }
                    self._surfaceThumbQueued[task.e.name] = true;
                    self._surfaceThumbActive++;
                    if (task.video) {
                        self._videoThumbActive = (self._videoThumbActive || 0) + 1;
                    }
                    (function (tk) {
                        var ctrl = (typeof AbortController !== 'undefined')
                            ? new AbortController() : null;
                        if (ctrl) {
                            if (!self._surfaceThumbCtrls) {
                                self._surfaceThumbCtrls = [];
                            }
                            self._surfaceThumbCtrls.push(ctrl);
                        }
                        var apiBase = t.local ? '/api/local/fs/' : '/api/sftp/';
                        var url = apiBase + (tk.video ? 'video' : 'thumbnail')
                            + '?path=' + encodeURIComponent(tk.path)
                            + '&v=' + (tk.mtime || 0);
                        if (!t.local) {
                            url += '&sessionId=' + encodeURIComponent(t.sessionId);
                        }
                        var promise;
                        if (tk.video) {
                            promise = new Promise(function (resolve, reject) {
                                self.captureVideoThumb(url, ctrl, resolve, reject);
                            });
                        } else {
                            promise = fetch(url, {
                                credentials: 'same-origin',
                                signal: ctrl ? ctrl.signal : undefined
                            }).then(function (resp) {
                                if (!resp.ok) {
                                    throw new Error('HTTP ' + resp.status);
                                }
                                var type = resp.headers.get('Content-Type') || '';
                                if (type.indexOf('image/') !== 0) {
                                    throw new Error('not an image');
                                }
                                return resp.blob();
                            }).then(function (blob) {
                                return URL.createObjectURL(blob);
                            });
                        }
                        promise.then(function (thumbUrl) {
                            if (gen !== (self._surfaceThumbGen || 0)) {
                                try { URL.revokeObjectURL(thumbUrl); } catch (err) { /* ignore */ }
                                return;
                            }
                            self.$set(tk.e, '_thumb', thumbUrl);
                        }).catch(function (err) {
                            if (gen !== (self._surfaceThumbGen || 0)
                                    || (err && err.name === 'AbortError')) {
                                return;
                            }
                            self.$set(tk.e, '_thumbFailed', true);
                        }).then(function () {
                            if (ctrl && self._surfaceThumbCtrls) {
                                var idx = self._surfaceThumbCtrls.indexOf(ctrl);
                                if (idx >= 0) {
                                    self._surfaceThumbCtrls.splice(idx, 1);
                                }
                            }
                            self._surfaceThumbActive = Math.max(0,
                                (self._surfaceThumbActive || 0) - 1);
                            if (tk.video) {
                                self._videoThumbActive = Math.max(0,
                                    (self._videoThumbActive || 0) - 1);
                            }
                            if (gen === (self._surfaceThumbGen || 0)) {
                                pump();
                            }
                        });
                    })(task);
                }
            };
            pump();
        },
        onDeskSurfaceThumbError: function (icon) {
            var e = icon && icon.entry;
            if (!e) {
                return;
            }
            if (e._thumb) {
                try { URL.revokeObjectURL(e._thumb); } catch (err) { /* ignore */ }
                this.$delete(e, '_thumb');
            }
            this.$set(e, '_thumbFailed', true);
        },
        loadDesktopIconLayout: function () {
            var t = this.desktopTab;
            if (this.desktop.local) {
                var saved = [];
                try {
                    saved = JSON.parse(localStorage.getItem('deepshell.local-desktop.icons') || '[]');
                } catch (e) {
                    saved = [];
                }
                this.desktop.iconLayout = Array.isArray(saved) ? saved : [];
                this.rebuildDesktopIconOrder();
                return Promise.resolve();
            }
            if (!t || t.connId == null) {
                this.desktop.iconLayout = [];
                this.rebuildDesktopIconOrder();
                return Promise.resolve();
            }
            var self = this;
            return http.get('/api/desktop-icons', {
                params: { connId: t.connId },
                silent: true
            }).then(function (list) {
                self.desktop.iconLayout = list || [];
                self.rebuildDesktopIconOrder();
            }).catch(function () {
                self.desktop.iconLayout = [];
                self.rebuildDesktopIconOrder();
            });
        },
        rebuildDesktopIconOrder: function () {
            var map = this.desktopIconItemMap;
            var layout = this.desktop.iconLayout || [];
            var hidden = {};
            var orderMap = {};
            layout.forEach(function (row) {
                if (!row || !row.iconKey) {
                    return;
                }
                if (row.hidden) {
                    hidden[row.iconKey] = true;
                } else if (orderMap[row.iconKey] == null) {
                    orderMap[row.iconKey] = Number(row.sortOrder) || 0;
                }
            });
            this.desktop.iconHidden = layout.filter(function (row) {
                return row && row.hidden;
            }).map(function (row) {
                return row.iconKey;
            });
            var allKeys = this.desktopAppIcons.map(function (a) { return a.key; });
            Object.keys(map).forEach(function (key) {
                if (allKeys.indexOf(key) < 0) {
                    allKeys.push(key);
                }
            });
            var visible = allKeys.filter(function (key) {
                return map[key] && !hidden[key];
            });
            visible.sort(function (a, b) {
                var oa = orderMap[a];
                var ob = orderMap[b];
                var ha = oa != null;
                var hb = ob != null;
                if (ha && hb) {
                    return oa - ob;
                }
                if (ha) {
                    return -1;
                }
                if (hb) {
                    return 1;
                }
                return allKeys.indexOf(a) - allKeys.indexOf(b);
            });
            this.desktop.iconOrder = visible;
            this.desktop.iconSelectedKeys = this.desktop.iconSelectedKeys.filter(function (k) {
                return visible.indexOf(k) >= 0;
            });
            if (this.desktop.iconSelected
                    && visible.indexOf(this.desktop.iconSelected) < 0) {
                this.desktop.iconSelected = this.desktop.iconSelectedKeys.length
                    ? this.desktop.iconSelectedKeys[this.desktop.iconSelectedKeys.length - 1] : '';
            }
        },
        saveDesktopIconLayout: function () {
            var self = this;
            if (this._deskIconSaveTimer) {
                clearTimeout(this._deskIconSaveTimer);
            }
            this._deskIconSaveTimer = setTimeout(function () {
                self._deskIconSaveTimer = null;
                self.saveDesktopIconLayoutNow();
            }, 180);
        },
        saveDesktopIconLayoutNow: function () {
            var t = this.desktopTab;
            var local = this.desktop.local;
            if (!local && (!t || t.connId == null)) {
                return;
            }
            var items = this.desktop.iconOrder.map(function (key, i) {
                return { iconKey: key, sortOrder: i, hidden: false };
            });
            var base = items.length;
            this.desktop.iconHidden.filter(function (key) {
                return key.indexOf('app:') === 0;
            }).forEach(function (key, i) {
                items.push({ iconKey: key, sortOrder: base + i, hidden: true });
            });
            if (local) {
                try {
                    localStorage.setItem('deepshell.local-desktop.icons', JSON.stringify(items));
                } catch (e) { /* 存储不可用时忽略 */ }
                return;
            }
            http.put('/api/desktop-icons', { connId: t.connId, items: items })
                .catch(function () { /* 拦截器已提示 */ });
        },
        isDesktopAppHidden: function (key) {
            return this.desktop.iconHidden.indexOf(key) >= 0;
        },
        setDesktopAppHidden: function (key, hidden) {
            var idx = this.desktop.iconHidden.indexOf(key);
            var orderIdx = this.desktop.iconOrder.indexOf(key);
            if (hidden) {
                if (idx < 0) {
                    this.desktop.iconHidden.push(key);
                }
                if (orderIdx >= 0) {
                    this.desktop.iconOrder.splice(orderIdx, 1);
                }
            } else {
                if (idx >= 0) {
                    this.desktop.iconHidden.splice(idx, 1);
                }
                if (this.desktop.iconOrder.indexOf(key) < 0) {
                    this.desktop.iconOrder.push(key);
                }
            }
            if (hidden) {
                var selIdx = this.desktop.iconSelectedKeys.indexOf(key);
                if (selIdx >= 0) {
                    this.desktop.iconSelectedKeys.splice(selIdx, 1);
                }
            }
            if (hidden && this.desktop.iconSelected === key) {
                this.desktop.iconSelected = this.desktop.iconSelectedKeys.length
                    ? this.desktop.iconSelectedKeys[this.desktop.iconSelectedKeys.length - 1] : '';
            }
            this.saveDesktopIconLayout();
        },
        selectDesktopIcon: function (item, ev) {
            if (!item) {
                return;
            }
            this.desktop.focusSurface = true;
            var keys = this.desktop.iconSelectedKeys.slice();
            var multi = !!(ev && (ev.ctrlKey || ev.metaKey));
            var range = !!(ev && ev.shiftKey);
            if (range && this.desktop.iconSelected) {
                var all = this.desktopIconItems.map(function (x) { return x.key; });
                var a = all.indexOf(this.desktop.iconSelected);
                var b = all.indexOf(item.key);
                keys = a >= 0 && b >= 0
                    ? all.slice(Math.min(a, b), Math.max(a, b) + 1)
                    : [item.key];
            } else if (multi) {
                var i = keys.indexOf(item.key);
                if (i >= 0) {
                    keys.splice(i, 1);
                } else {
                    keys.push(item.key);
                }
            } else {
                keys = [item.key];
            }
            if (!keys.length) {
                this.desktop.iconSelected = '';
            } else if (keys.indexOf(item.key) >= 0) {
                this.desktop.iconSelected = item.key;
            } else if (keys.indexOf(this.desktop.iconSelected) < 0) {
                this.desktop.iconSelected = keys[keys.length - 1];
            }
            this.desktop.iconSelectedKeys = keys;
            this.desktop.iconMenu.visible = false;
            if (this.desktop.menu.visible) {
                this.desktop.menu.visible = false;
            }
        },
        isDesktopIconSelected: function (key) {
            return this.desktop.iconSelectedKeys.indexOf(key) >= 0;
        },
        desktopSelectedIconItems: function () {
            var map = this.desktopIconItemMap;
            var out = [];
            this.desktop.iconSelectedKeys.forEach(function (key) {
                if (map[key]) {
                    out.push(map[key]);
                }
            });
            return out;
        },
        desktopSurfaceSelectedRows: function () {
            var out = [];
            this.desktopSelectedIconItems().forEach(function (item) {
                if (item.entry) {
                    out.push(item.entry);
                }
            });
            return out;
        },
        selectAllDesktopIcons: function () {
            var keys = this.desktopIconItems.map(function (item) { return item.key; });
            this.desktop.iconSelectedKeys = keys;
            this.desktop.iconSelected = keys.length ? keys[keys.length - 1] : '';
            this.desktop.focusSurface = true;
        },
        /* ---------- 桌面背景空白处拖拽框选 ---------- */
        onDesktopIconsMouseDown: function (ev) {
            if (ev.button !== 0 || !this.desktop.visible) {
                return;
            }
            if (this.desktop.settingsVisible || this.desktop.startOpen
                    || this.desktop.menu.visible || this.hasDesktopDialogOpen()) {
                return;
            }
            var target = ev.target;
            if (!target || !target.closest
                    || target.closest('.dsk-icon, .dsk-icons-msg, .dsk-wall-menu, .dsk-start-menu')) {
                return;
            }
            ev.preventDefault();
            var active = document.activeElement;
            if (active && active !== document.body && active.blur) {
                active.blur();
            }
            this.cancelDesktopIconMarquee();
            var nodes = document.querySelectorAll('.dsk-icon[data-icon-key]');
            var items = [];
            for (var i = 0; i < nodes.length; i++) {
                var r = nodes[i].getBoundingClientRect();
                items.push({
                    key: nodes[i].getAttribute('data-icon-key'),
                    left: r.left,
                    top: r.top,
                    right: r.right,
                    bottom: r.bottom
                });
            }
            var additive = !!(ev.ctrlKey || ev.metaKey);
            this._deskIconMarquee = {
                startX: ev.clientX,
                startY: ev.clientY,
                lastX: ev.clientX,
                lastY: ev.clientY,
                moved: false,
                base: additive ? this.desktop.iconSelectedKeys.slice() : [],
                additive: additive,
                items: items
            };
            document.addEventListener('mousemove', this.onDesktopIconMarqueeMove);
            document.addEventListener('mouseup', this.onDesktopIconMarqueeUp);
        },
        onDesktopIconMarqueeMove: function (ev) {
            var m = this._deskIconMarquee;
            if (!m) {
                return;
            }
            if (ev.buttons === 0) {
                this.onDesktopIconMarqueeUp();
                return;
            }
            m.lastX = ev.clientX;
            m.lastY = ev.clientY;
            if (!m.moved) {
                if (Math.abs(m.lastX - m.startX) < 4 && Math.abs(m.lastY - m.startY) < 4) {
                    return;
                }
                m.moved = true;
            }
            this.updateDesktopIconMarquee();
        },
        updateDesktopIconMarquee: function () {
            var m = this._deskIconMarquee;
            if (!m || !m.moved) {
                return;
            }
            var root = this.$refs.desktopRoot;
            var rr = root ? root.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
            var left = Math.max(rr.left, Math.min(m.startX, m.lastX));
            var right = Math.min(rr.right, Math.max(m.startX, m.lastX));
            var top = Math.max(rr.top, Math.min(m.startY, m.lastY));
            var bottom = Math.min(rr.bottom - 48, Math.max(m.startY, m.lastY));
            var q = this.desktop.iconMarquee;
            q.visible = true;
            q.left = left;
            q.top = top;
            q.width = Math.max(0, right - left);
            q.height = Math.max(0, bottom - top);
            var sel = m.additive ? m.base.slice() : [];
            var last = '';
            for (var i = 0; i < m.items.length; i++) {
                var it = m.items[i];
                if (it.right >= left && it.left <= right && it.bottom >= top && it.top <= bottom) {
                    if (sel.indexOf(it.key) < 0) {
                        sel.push(it.key);
                    }
                    last = it.key;
                }
            }
            this.desktop.iconSelectedKeys = sel;
            this.desktop.iconSelected = last || (sel.length ? sel[sel.length - 1] : '');
            this.desktop.focusSurface = true;
        },
        onDesktopIconMarqueeUp: function () {
            var moved = !!(this._deskIconMarquee && this._deskIconMarquee.moved);
            if (moved) {
                this.updateDesktopIconMarquee();
            }
            this.cancelDesktopIconMarquee();
            if (moved) {
                // 框选结束后补发的 click 不应清掉刚框好的选区
                var suppressClick = function (e) {
                    e.stopPropagation();
                    e.preventDefault();
                    document.removeEventListener('click', suppressClick, true);
                };
                document.addEventListener('click', suppressClick, true);
                setTimeout(function () {
                    document.removeEventListener('click', suppressClick, true);
                }, 300);
            }
        },
        cancelDesktopIconMarquee: function () {
            document.removeEventListener('mousemove', this.onDesktopIconMarqueeMove);
            document.removeEventListener('mouseup', this.onDesktopIconMarqueeUp);
            this._deskIconMarquee = null;
            this.desktop.iconMarquee.visible = false;
        },
        openDesktopIcon: function (item) {
            if (!item) {
                return;
            }
            if (item.type === 'app') {
                if (this.desktopAppBlocked(item.action)) {
                    this.desktopServerReady();
                    return;
                }
                if (item.action === 'explorer') {
                    this.openDesktopExplorerFromIcon();
                } else if (item.action === 'editor') {
                    this.openDesktopEditorApp();
                } else if (item.action === 'terminal') {
                    this.openDesktopTerminalWindow();
                } else if (item.action === 'transfers') {
                    this.openTransferDesktopWindow();
                } else if (item.action === 'settings') {
                    this.openDesktopSettings();
                } else if (item.action === 'appcenter') {
                    this.openDesktopAppCenterWindow();
                } else if (item.action === 'ai') {
                    this.openAiDesktopWindow();
                } else if (item.action === 'trash') {
                    this.openDesktopTrashWindow();
                }
                return;
            }
            if (item.type === 'folder') {
                this.openDesktopExplorerWindow(item.path);
                return;
            }
            if (item.type === 'shortcut') {
                this.openDesktopShortcut(item);
                return;
            }
            if (item.type === 'file') {
                if (this.isDesktopImage(item.entry)) {
                    this.openDesktopImagePreview(item.entry, {
                        path: this.desktop.surface.dir,
                        sortBy: 'name',
                        sortDir: 'asc'
                    });
                } else if (this.isDesktopVideo(item.entry)) {
                    this.openDesktopVideoPreview(item.entry, {
                        path: this.desktop.surface.dir,
                        sortBy: 'name',
                        sortDir: 'asc'
                    });
                } else if (this.isDesktopAudio(item.entry)) {
                    this.openDesktopAudioPreview(item.entry, {
                        path: this.desktop.surface.dir,
                        sortBy: 'name',
                        sortDir: 'asc'
                    });
                } else if (this.desktopArchiveFormat(item.entry.name)) {
                    ELEMENT.Message.info('压缩包请右键选择「解压」');
                } else if (this.desktopTab && (this.desktopTab.sessionId || this.desktopTab.local)) {
                    this.openDesktopEditorWindow(this.desktopTab, item.path);
                }
            }
        },
        isLnkFile: function (row) {
            return !!row && !row.dir && /\.lnk$/i.test(row.name || '');
        },
        openDesktopShortcut: function (item) {
            var t = this.desktopTab;
            if (!t || (!t.local && !t.sessionId) || !item) {
                return;
            }
            var self = this;
            var readReq = t.local
                ? http.get('/api/local/fs/read', { params: { path: item.path }, silent: true })
                : http.get('/api/sftp/read', {
                    params: { sessionId: t.sessionId, path: item.path },
                    silent: true
                });
            readReq.then(function (text) {
                var data = null;
                try {
                    data = JSON.parse(text);
                } catch (e) { /* ignore */ }
                if (!data || data.type !== 'deepshell-shortcut' || !data.target) {
                    ELEMENT.Message.warning('快捷方式格式无法识别');
                    return;
                }
                if (data.targetType === 'folder') {
                    self.openDesktopExplorerWindow(data.target);
                    return;
                }
                var target = String(data.target);
                var idx = target.lastIndexOf('/');
                var parent = idx <= 0 ? '/' : target.substring(0, idx);
                var name = idx >= 0 ? target.substring(idx + 1) : target;
                var row = { name: name, dir: false, size: 0, mtime: 0 };
                if (self.isDesktopImage(row)) {
                    self.openDesktopImagePreview(row, {
                        path: parent,
                        sortBy: 'name',
                        sortDir: 'asc'
                    });
                } else if (self.isDesktopVideo(row)) {
                    self.openDesktopVideoPreview(row, {
                        path: parent,
                        sortBy: 'name',
                        sortDir: 'asc'
                    });
                } else if (self.isDesktopAudio(row)) {
                    self.openDesktopAudioPreview(row, {
                        path: parent,
                        sortBy: 'name',
                        sortDir: 'asc'
                    });
                } else {
                    self.openDesktopEditorWindow(t, target);
                }
            }).catch(function (e) {
                ELEMENT.Message.warning('无法打开快捷方式：'
                    + ((e && e.message) || '格式错误'));
            });
        },
        createDesktopShortcut: function (row, win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            if (!t || (!t.local && !t.sessionId) || !row) {
                return;
            }
            if (this.isLnkFile(row)) {
                ELEMENT.Message.info('不能为快捷方式再创建快捷方式');
                return;
            }
            var target = this.desktopEntryPath(row, d);
            var self = this;
            var ready = this.desktop.surface.loaded
                ? Promise.resolve()
                : this.loadDesktopSurface();
            ready.then(function () {
                var dir = self.desktop.surface.dir;
                if (!dir) {
                    ELEMENT.Message.warning('桌面目录未就绪');
                    return;
                }
                var base = row.name;
                var candidate = base + '.lnk';
                var n = 2;
                var names = (self.desktop.surface.entries || []).map(function (e) {
                    return e.name;
                });
                while (names.indexOf(candidate) >= 0) {
                    candidate = base + ' (' + n + ').lnk';
                    n++;
                }
                var content = JSON.stringify({
                    type: 'deepshell-shortcut',
                    version: 1,
                    target: target,
                    targetType: row.dir ? 'folder' : 'file',
                    label: base,
                    createdAt: Date.now()
                }, null, 2);
                var writeReq = t.local
                    ? http.post('/api/local/fs/write', {
                        path: self.pathJoin(dir, candidate),
                        content: content
                    })
                    : http.post('/api/sftp/write', {
                        sessionId: t.sessionId,
                        path: self.pathJoin(dir, candidate),
                        content: content
                    });
                return writeReq.then(function () {
                    ELEMENT.Message.success('已发送到桌面快捷方式：' + candidate);
                    self.refreshDesktopSurface();
                });
            }).catch(function () { /* 已提示 */ });
        },
        copyDesktopRows: function (rows, win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            rows = rows || [];
            if (!t || (!t.local && t.connId == null) || !rows.length) {
                return;
            }
            var self = this;
            this.desktopClipboard = {
                connId: t.connId,
                paths: rows.map(function (r) {
                    return self.desktopEntryPath(r, d);
                }),
                names: rows.map(function (r) {
                    return r.name;
                }),
                cut: false
            };
            ELEMENT.Message.success(rows.length === 1
                ? ('已复制：' + rows[0].name)
                : ('已复制 ' + rows.length + ' 项'));
        },
        cutDesktopRows: function (rows, win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            rows = rows || [];
            if (!t || (!t.local && t.connId == null) || !rows.length) {
                return;
            }
            var self = this;
            this.desktopClipboard = {
                connId: t.connId,
                paths: rows.map(function (r) {
                    return self.desktopEntryPath(r, d);
                }),
                names: rows.map(function (r) {
                    return r.name;
                }),
                cut: true
            };
            ELEMENT.Message.success(rows.length === 1
                ? ('已剪切：' + rows[0].name)
                : ('已剪切 ' + rows.length + ' 项'));
        },
        isDeskCut: function (win, row) {
            var c = this.desktopClipboard;
            if (!c || !c.cut || !row) {
                return false;
            }
            return c.paths.indexOf(this.deskEntryPath(win || this.desk, row)) >= 0;
        },
        pasteDesktop: function (win, destDir) {
            var t = this.desktopTab;
            var d = win || this.desk;
            var c = this.desktopClipboard;
            if (!t || (!t.local && !t.sessionId) || !c || !c.paths || !c.paths.length) {
                ELEMENT.Message.info('剪贴板为空');
                return;
            }
            if (c.connId !== t.connId) {
                ELEMENT.Message.warning('剪贴板来自其他连接，不能跨连接粘贴');
                return;
            }
            var dest = destDir || (d.type === 'surface'
                ? this.desktop.surface.dir : d.path);
            if (!dest) {
                ELEMENT.Message.warning('目标目录未知');
                return;
            }
            var self = this;
            var parentSame = c.paths.every(function (p) {
                var parent = p.substring(0, p.lastIndexOf('/')) || '/';
                return self.trimSlash(parent) === self.trimSlash(dest);
            });
            // 复制到原目录时允许生成「- 副本」；剪切到原目录仍是原地移动，提示即可
            if (c.cut && parentSame) {
                ELEMENT.Message.info('文件已在该目录中');
                return;
            }
            var loading = ELEMENT.Message({
                message: (c.cut ? '正在移动 ' : '正在粘贴 ') + c.paths.length + ' 项…',
                duration: 0,
                iconClass: 'el-icon-loading'
            });
            var sources = c.paths.slice();
            if (c.cut) {
                var chain = Promise.resolve();
                var ok = 0;
                var fail = 0;
                var failed = [];
                var movedNames = [];
                sources.forEach(function (src) {
                    chain = chain.then(function () {
                        var moveReq = t.local
                            ? http.post('/api/local/fs/move', { path: src, destDir: dest })
                            : http.post('/api/sftp/move', {
                                sessionId: t.sessionId,
                                path: src,
                                destDir: dest
                            });
                        return moveReq.then(function () {
                            ok++;
                            movedNames.push(src.substring(src.lastIndexOf('/') + 1));
                        }).catch(function () {
                            fail++;
                            failed.push(src);
                        });
                    });
                });
                chain.then(function () {
                    loading.close();
                    if (fail === 0) {
                        self.desktopClipboard = { connId: null, paths: [], names: [], cut: false };
                        ELEMENT.Message.success('已移动 ' + ok + ' 项');
                    } else {
                        self.desktopClipboard = {
                            connId: t.connId,
                            paths: failed,
                            names: failed.map(function (p) {
                                return p.substring(p.lastIndexOf('/') + 1);
                            }),
                            cut: true
                        };
                        ELEMENT.Message.warning('移动完成：成功 ' + ok + ' 项，失败 ' + fail + ' 项');
                    }
                    var dirs = {};
                    sources.forEach(function (p) {
                        dirs[p.substring(0, p.lastIndexOf('/')) || '/'] = true;
                    });
                    self.desktop.windows.forEach(function (w) {
                        if (w.type === 'explorer' && dirs[w.path]) {
                            self.desktopRefresh(w);
                        }
                    });
                    if (d.type !== 'surface' && self.trimSlash(dest) === self.trimSlash(d.path)
                            && movedNames.length) {
                        d.pendingSelect = movedNames;
                        d.pendingOpen = false;
                    }
                    self.desktopRefresh(d);
                    if (dirs[self.desktop.surface.dir] || dest === self.desktop.surface.dir) {
                        self.refreshDesktopSurface();
                    }
                });
                return;
            }
            var copyReq = t.local
                ? http.post('/api/local/fs/copy', { destDir: dest, paths: sources })
                : http.post('/api/sftp/copy', {
                    sessionId: t.sessionId,
                    destDir: dest,
                    paths: sources
                });
            copyReq.then(function (created) {
                loading.close();
                ELEMENT.Message.success('已粘贴 ' + sources.length + ' 项');
                var pastedNames = Array.isArray(created) ? created.filter(function (n) { return !!n; }) : [];
                if (pastedNames.length && d.type !== 'surface'
                        && self.trimSlash(dest) === self.trimSlash(d.path)) {
                    d.pendingSelect = pastedNames;
                    d.pendingOpen = false;
                }
                self.desktopRefresh(d);
            }).catch(function () {
                loading.close();
            });
        },
        onDesktopIconDragStart: function (ev, item) {
            if (!item) {
                return;
            }
            this.desktop.iconDragKey = item.key;
            if (this.desktop.iconSelectedKeys.indexOf(item.key) < 0) {
                this.desktop.iconSelectedKeys = [item.key];
                this.desktop.iconSelected = item.key;
            } else {
                this.desktop.iconSelected = item.key;
            }
            this.desktop.focusSurface = true;
            this._deskFileDrag = null;
            if (item.type !== 'app') {
                var self = this;
                var selected = this.desktopSelectedIconItems().filter(function (i) {
                    return i.type !== 'app';
                });
                if (!selected.length) {
                    selected = [item];
                }
                var paths = [];
                var names = [];
                selected.forEach(function (i) {
                    if (!i.path) {
                        return;
                    }
                    paths.push(i.path);
                    names.push(i.entry ? i.entry.name : i.label);
                });
                if (paths.length) {
                    this._deskFileDrag = {
                        win: { type: 'surface', path: this.desktop.surface.dir, dragNames: [] },
                        paths: paths,
                        names: names,
                        fromSurface: true
                    };
                }
            }
            if (ev.dataTransfer) {
                ev.dataTransfer.effectAllowed = 'copyMove';
                try {
                    ev.dataTransfer.setData('text/plain',
                        (this._deskFileDrag && this._deskFileDrag.paths[0]) || item.key);
                    if (this._deskFileDrag) {
                        ev.dataTransfer.setData('application/x-deepshell-paths',
                            JSON.stringify(this._deskFileDrag.paths));
                    }
                } catch (e) { /* ignore */ }
            }
        },
        onDesktopIconDragOver: function (ev, item) {
            if (!item) {
                return;
            }
            var fromKey = this.desktop.iconDragKey;
            if (fromKey) {
                if (fromKey === item.key) {
                    return;
                }
                this.desktop.iconDropKey = item.key;
                return;
            }
            var drag = this._deskFileDrag;
            if (drag && drag.names && drag.names.length && item.key === 'app:trash') {
                this.desktop.iconDropKey = item.key;
                if (ev && ev.dataTransfer) {
                    ev.dataTransfer.dropEffect = 'move';
                }
            }
        },
        onDesktopIconDragLeave: function (item) {
            if (item && this.desktop.iconDropKey === item.key) {
                this.desktop.iconDropKey = '';
            }
        },
        onDesktopIconDrop: function (ev, item) {
            var fromKey = this.desktop.iconDragKey;
            this.desktop.iconDragKey = '';
            this.desktop.iconDropKey = '';
            if (!item) {
                return;
            }
            if (item.key === 'app:trash') {
                if (fromKey && fromKey.indexOf('file:') === 0) {
                    var rows = this.desktopSurfaceSelectedRows();
                    if (!rows.length) {
                        var dragged = this.desktopIconItemMap[fromKey];
                        if (dragged && dragged.entry) {
                            rows = [dragged.entry];
                        }
                    }
                    if (rows.length) {
                        this.desktopDeleteRows(rows, this.desktopSurfaceContextWin(), false);
                    }
                    return;
                }
                var drag = this._deskFileDrag;
                if (drag && drag.names && drag.names.length) {
                    var win = drag.win || this.desk;
                    var entries = (win && win.entries) || [];
                    var movedRows = drag.names.map(function (name) {
                        var hit = null;
                        entries.some(function (r) {
                            if (r.name === name) {
                                hit = r;
                                return true;
                            }
                            return false;
                        });
                        return hit || { name: name, dir: false, size: 0 };
                    });
                    if (win && win.dragNames) {
                        win.dragNames = [];
                    }
                    this._deskFileDrag = null;
                    this.desktopDeleteRows(movedRows, win, false);
                    return;
                }
            }
            if (!fromKey || fromKey === item.key) {
                return;
            }
            var order = this.desktop.iconOrder.slice();
            var from = order.indexOf(fromKey);
            if (from < 0 || order.indexOf(item.key) < 0) {
                return;
            }
            order.splice(from, 1);
            var to = order.indexOf(item.key);
            order.splice(to, 0, fromKey);
            this.desktop.iconOrder = order;
            this.saveDesktopIconLayout();
        },
        onDesktopIconDragEnd: function () {
            this.desktop.iconDragKey = '';
            this.desktop.iconDropKey = '';
            if (this._deskFileDrag && this._deskFileDrag.fromSurface) {
                this._deskFileDrag = null;
            }
            this.desktop.windows.forEach(function (w) {
                w.winDragOver = false;
                w.fileDragOver = false;
                w.dropTarget = '';
            });
        },
        openDesktopIconMenu: function (ev, item) {
            if (!item) {
                return;
            }
            if (this.desktop.iconSelectedKeys.indexOf(item.key) >= 0) {
                // 右键的是已选中图标：保留多选，只把锚点移到它上面
                this.desktop.iconSelected = item.key;
                this.desktop.focusSurface = true;
            } else {
                this.selectDesktopIcon(item, ev);
            }
            if (item.type !== 'app') {
                this.openDesktopSurfaceMenu(ev, item);
                return;
            }
            this.desktop.startOpen = false;
            this.desktop.menu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.taskMenu.visible = false;
            this.desktop.trashMenu.visible = false;
            this.desktop.calendarOpen = false;
            this.closeDesktopSubMenus();
            this.desktop.iconMenu = {
                visible: true,
                x: Math.max(8, Math.min(ev.clientX, window.innerWidth - 240)),
                y: Math.max(8, Math.min(ev.clientY, window.innerHeight - 220)),
                key: item.key
            };
        },
        desktopIconMenuAction: function (action) {
            var key = this.desktop.iconMenu.key;
            this.desktop.iconMenu.visible = false;
            var item = null;
            for (var i = 0; i < this.desktopAppIcons.length; i++) {
                if (this.desktopAppIcons[i].key === key) {
                    item = this.desktopAppIcons[i];
                    break;
                }
            }
            if (!item) {
                return;
            }
            if (action === 'open') {
                this.openDesktopIcon(item);
            } else if (action === 'emptyTrash') {
                this.emptyDesktopTrash();
            } else if (action === 'props') {
                this.openDesktopAppProperties(item);
            } else if (action === 'hide') {
                this.setDesktopAppHidden(key, true);
            }
        },
        /* ---------- 系统应用属性与图标样式 ---------- */
        desktopShapeRadius: function (shape) {
            if (shape === 'circle') {
                return '50%';
            }
            if (shape === 'square') {
                return '3px';
            }
            return '';
        },
        desktopShapeLabel: function (shape) {
            for (var i = 0; i < DESKTOP_APP_SHAPES.length; i++) {
                if (DESKTOP_APP_SHAPES[i].id === shape) {
                    return DESKTOP_APP_SHAPES[i].label;
                }
            }
            return '圆角';
        },
        desktopAppIconImage: function (app) {
            return app && app.image ? app.image : '';
        },
        desktopAppIconStyle: function (app) {
            var color = (app && app.color) || '#54657e';
            var rgb = desktopHexToRgb(color);
            var light = (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255;
            var style = {
                background: color,
                color: light > 0.78 ? '#243044' : '#ffffff'
            };
            var radius = this.desktopShapeRadius(app && app.shape);
            if (radius) {
                style.borderRadius = radius;
            }
            return style;
        },
        desktopAppIconByAction: function (action, fallback) {
            for (var i = 0; i < this.desktopAppIcons.length; i++) {
                if (this.desktopAppIcons[i].action === action) {
                    return this.desktopAppIcons[i].icon;
                }
            }
            return fallback || 'el-icon-s-grid';
        },
        desktopAppImageByAction: function (action) {
            for (var i = 0; i < this.desktopAppIcons.length; i++) {
                if (this.desktopAppIcons[i].action === action) {
                    return this.desktopAppIcons[i].image || '';
                }
            }
            return '';
        },
        desktopWindowIconImage: function (w) {
            var type = (w && w.type) || 'explorer';
            var action = ({
                explorer: 'explorer',
                trash: 'trash',
                editor: 'editor',
                terminal: 'terminal',
                transfer: 'transfers',
                ai: 'ai',
                appcenter: 'appcenter'
            })[type];
            return action ? this.desktopAppImageByAction(action) : '';
        },
        openDesktopAppProperties: function (item) {
            if (typeof item === 'string') {
                for (var i = 0; i < this.desktopAppIcons.length; i++) {
                    if (this.desktopAppIcons[i].key === item) {
                        item = this.desktopAppIcons[i];
                        break;
                    }
                }
            }
            if (!item) {
                return;
            }
            this.desktop.iconMenu.visible = false;
            this.desktop.startOpen = false;
            this.desktop.menu.visible = false;
            this.desktop.calendarOpen = false;
            this.desktop.taskbarMenu.visible = false;
            this.closeDesktopSubMenus();
            this.desktopAppProps = {
                visible: true,
                connId: this.desktopAppStyleConnId,
                key: item.key,
                icon: item.icon,
                color: item.color,
                shape: item.shape || 'rounded',
                image: item.image || '',
                iconSearch: ''
            };
            var self = this;
            this.$nextTick(function () {
                self.scrollDesktopAppIconIntoView();
            });
        },
        scrollDesktopAppIconIntoView: function () {
            var grid = this.$refs.appIconGrid;
            if (!grid) {
                return;
            }
            var active = grid.querySelector('.dsk-icon-choice.active');
            if (!active) {
                return;
            }
            var gr = grid.getBoundingClientRect();
            var ar = active.getBoundingClientRect();
            if (ar.top < gr.top || ar.bottom > gr.bottom) {
                grid.scrollTop += ar.top - gr.top - 8;
            }
        },
        closeDesktopAppProperties: function () {
            this.desktopAppProps.visible = false;
        },
        resetDesktopAppIconForm: function () {
            var app = this.desktopAppPropsApp;
            if (!app) {
                return;
            }
            var def = desktopAppDefaultStyle(app.action);
            if (!def) {
                return;
            }
            this.desktopAppProps.icon = def.icon;
            this.desktopAppProps.color = def.color;
            this.desktopAppProps.shape = 'rounded';
            this.desktopAppProps.image = '';
        },
        pickDesktopAppIconFile: function () {
            if (this.$refs.appIconFileInput) {
                this.$refs.appIconFileInput.click();
            }
        },
        onDesktopAppIconFile: function (ev) {
            var input = ev && ev.target;
            var file = input && input.files && input.files[0];
            if (input) {
                input.value = '';
            }
            if (!file) {
                return;
            }
            if (!/^image\/(?:png|jpe?g|webp)$/i.test(file.type || '')) {
                ELEMENT.Message.warning('仅支持 PNG / JPG / WebP 图片');
                return;
            }
            if (file.size > 8 * 1024 * 1024) {
                ELEMENT.Message.warning('图片不能超过 8 MB');
                return;
            }
            var self = this;
            var reader = new FileReader();
            reader.onload = function () {
                var img = new Image();
                img.onload = function () {
                    try {
                        var size = 192;
                        var canvas = document.createElement('canvas');
                        canvas.width = size;
                        canvas.height = size;
                        var ctx = canvas.getContext('2d');
                        ctx.clearRect(0, 0, size, size);
                        var scale = Math.max(size / img.width, size / img.height);
                        var dw = Math.max(1, Math.round(img.width * scale));
                        var dh = Math.max(1, Math.round(img.height * scale));
                        ctx.drawImage(img, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
                        var data = canvas.toDataURL('image/png');
                        if (!desktopValidAppImage(data)) {
                            ELEMENT.Message.warning('图片处理后体积过大，请换一张更简单的图片');
                            return;
                        }
                        self.desktopAppProps.image = data;
                    } catch (e) {
                        ELEMENT.Message.warning('图片处理失败，请换一张图片重试');
                    }
                };
                img.onerror = function () {
                    ELEMENT.Message.warning('无法读取图片，请更换文件');
                };
                img.src = reader.result;
            };
            reader.onerror = function () {
                ELEMENT.Message.warning('图片读取失败，请重新选择');
            };
            reader.readAsDataURL(file);
        },
        resetDesktopAppIconState: function () {
            var self = this;
            this.desktopAppIcons.forEach(function (a) {
                var def = desktopAppDefaultStyle(a.action);
                if (!def) {
                    return;
                }
                a.icon = def.icon;
                a.color = def.color;
                self.$set(a, 'shape', 'rounded');
                self.$set(a, 'image', '');
            });
            this.desktopStartApps.forEach(function (a) {
                var def = DESKTOP_START_ICON_DEFAULTS[a.id];
                if (!def) {
                    return;
                }
                a.icon = def.icon;
                a.color = def.color;
                self.$set(a, 'shape', 'rounded');
                self.$set(a, 'image', '');
            });
        },
        applyDesktopAppIconStyle: function (action, style) {
            if (!action || !style) {
                return;
            }
            var self = this;
            var image = desktopValidAppImage(style.image) ? style.image : '';
            this.desktopAppIcons.forEach(function (a) {
                if (a.action !== action) {
                    return;
                }
                a.icon = style.icon;
                a.color = style.color;
                self.$set(a, 'shape', style.shape || 'rounded');
                self.$set(a, 'image', image);
            });
            var startId = DESKTOP_APP_START_IDS[action];
            if (!startId) {
                return;
            }
            this.desktopStartApps.forEach(function (a) {
                if (a.id !== startId) {
                    return;
                }
                a.icon = style.icon;
                a.color = style.color;
                self.$set(a, 'shape', style.shape || 'rounded');
                self.$set(a, 'image', image);
            });
        },
        applyDesktopAppIconStylesForConn: function (connId) {
            var self = this;
            this.resetDesktopAppIconState();
            var styles = loadDesktopAppIconStyles(connId);
            Object.keys(styles).forEach(function (action) {
                self.applyDesktopAppIconStyle(action, styles[action]);
            });
        },
        saveDesktopAppIconStyle: function () {
            var app = this.desktopAppPropsApp;
            var form = this.desktopAppProps;
            if (!app) {
                this.closeDesktopAppProperties();
                return;
            }
            var connId = form.connId || this.desktopAppStyleConnId;
            if (!connId) {
                ELEMENT.Message.warning('当前没有可用的连接，无法保存图标样式');
                return;
            }
            var def = desktopAppDefaultStyle(app.action) || { icon: app.icon, color: app.color };
            var icon = (typeof form.icon === 'string' && /^el-icon-[a-z0-9-]+$/.test(form.icon))
                ? form.icon : def.icon;
            var color = desktopNormalizeHex(form.color, def.color);
            var shape = (form.shape === 'circle' || form.shape === 'square') ? form.shape : 'rounded';
            if (form.image && !desktopValidAppImage(form.image)) {
                ELEMENT.Message.warning('当前图片数据无效，请重新上传');
                return;
            }
            var image = form.image || '';
            var styles = loadDesktopAppIconStyles(connId);
            var style = { icon: icon, color: color, shape: shape, image: image };
            if (icon === def.icon && color === def.color && shape === 'rounded' && !image) {
                delete styles[app.action];
            } else {
                styles[app.action] = style;
            }
            saveDesktopAppIconStyles(connId, styles);
            if (styles[app.action]) {
                this.applyDesktopAppIconStyle(app.action, styles[app.action]);
            } else {
                this.applyDesktopAppIconStyle(app.action, {
                    icon: def.icon,
                    color: def.color,
                    shape: 'rounded',
                    image: ''
                });
            }
            this.desktopAppProps.visible = false;
            ELEMENT.Message.success('已更新当前连接的「' + app.label + '」图标样式');
        },
        resetAllDesktopAppIconStyles: function () {
            var self = this;
            var connId = this.desktopAppStyleConnId;
            if (!connId) {
                ELEMENT.Message.warning('当前没有可用的连接');
                return;
            }
            this.$confirm('恢复当前连接所有系统应用的默认图标、颜色、形状和图片？', '恢复默认图标样式',
                { type: 'warning', confirmButtonText: '恢复默认', cancelButtonText: '取消' })
                .then(function () {
                    saveDesktopAppIconStyles(connId, {});
                    self.resetDesktopAppIconState();
                    ELEMENT.Message.success('已恢复当前连接的默认应用图标');
                })
                .catch(function () { /* 取消 */ });
        },
        openDesktopSurfaceMenu: function (ev, item) {
            if (!item || !item.entry) {
                return;
            }
            this.desktop.iconMenu.visible = false;
            this.openDesktopMenu(ev, item.entry, true);
        },
        openDesktopSurfaceRow: function (row) {
            if (!row) {
                return;
            }
            var path = this.pathJoin(this.desktop.surface.dir, row.name);
            var item = this.desktopIconItemMap['file:' + path];
            if (item) {
                this.openDesktopIcon(item);
            }
        },
        desktopMenuContextWin: function () {
            if (this.desktop.menu.surface) {
                var row = this.desktop.menu.target;
                var names = [];
                this.desktopSurfaceSelectedRows().forEach(function (r) {
                    names.push(r.name);
                });
                if (!names.length && row) {
                    names = [row.name];
                }
                return {
                    id: '__surface__',
                    type: 'surface',
                    path: this.desktop.surface.dir,
                    entries: this.desktop.surface.entries,
                    selected: names,
                    lastSelected: row ? row.name : '',
                    sortBy: 'name',
                    sortDir: 'asc'
                };
            }
            return this.desk;
        },

        /* ---------- 按窗口计算视图（模板循环使用） ---------- */
        deskShownEntries: function (w) {
            var d = w || this.desk;
            var kw = (d.keyword || '').trim().toLowerCase();
            var showHidden = this.desktop.showHidden;
            var rows = (d.entries || []).filter(function (r) {
                if (!showHidden && String(r.name).charAt(0) === '.') {
                    return false;
                }
                return !kw || String(r.name).toLowerCase().indexOf(kw) >= 0;
            });
            var by = d.sortBy;
            var dir = d.sortDir === 'desc' ? -1 : 1;
            rows.sort(function (a, b) {
                if (a.dir !== b.dir) {
                    return a.dir ? -1 : 1;
                }
                var v;
                if (by === 'size') {
                    v = (a.size || 0) - (b.size || 0);
                } else if (by === 'mtime') {
                    v = (a.mtime || 0) - (b.mtime || 0);
                } else {
                    v = String(a.name).localeCompare(String(b.name), 'zh-CN', {
                        numeric: true,
                        sensitivity: 'base'
                    });
                }
                return v * dir;
            });
            return rows;
        },
        deskCrumbs: function (w) {
            var d = w || this.desk;
            var p = d.path;
            if (!p) {
                return [];
            }
            var out = [{ name: this.desktop.local ? '本地桌面' : '/', path: '/' }];
            var segs = p.split('/').filter(function (s) { return !!s; });
            var acc = '';
            segs.forEach(function (s) {
                acc += '/' + s;
                out.push({ name: s, path: acc });
            });
            return out;
        },
        isDeskGrid: function (w) {
            return (w || this.desk).viewMode !== 'list';
        },
        deskSortLabel: function (w) {
            var d = w || this.desk;
            var map = { name: '名称', size: '大小', mtime: '修改时间' };
            return map[d.sortBy] + (d.sortDir === 'asc' ? ' ↑' : ' ↓');
        },
        deskSortIcon: function (w, field) {
            var d = w || this.desk;
            if (d.sortBy !== field) {
                return '';
            }
            return d.sortDir === 'asc' ? 'el-icon-top' : 'el-icon-bottom';
        },
        isDeskSelected: function (w, row) {
            return (w || this.desk).selected.indexOf(row.name) >= 0;
        },
        isDeskDragging: function (w, row) {
            return (w || this.desk).dragNames.indexOf(row.name) >= 0;
        },
        deskEntryPath: function (w, row) {
            return this.pathJoin((w || this.desk).path, row.name);
        },
        deskRowByName: function (w, name) {
            if (!name) {
                return null;
            }
            var rows = (w || this.desk).entries || [];
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].name === name) {
                    return rows[i];
                }
            }
            return null;
        },
        deskShowThumb: function (w, row) {
            var d = w || this.desk;
            if (!this.desktop.thumbnailsEnabled) {
                return false;
            }
            if (d.viewMode !== 'large' && d.viewMode !== 'medium') {
                return false;
            }
            var video = this.isDesktopVideo(row);
            if (!this.isDesktopImage(row) && !video) {
                return false;
            }
            // 视频只读取元数据和首帧片段；超大文件仍回退为文件图标，避免拖慢 SFTP
            if (row.size && row.size > (video ? 500 * 1024 * 1024 : 30 * 1024 * 1024)) {
                return false;
            }
            return !d.thumbFailed[this.deskEntryPath(d, row)];
        },
        deskThumbSrc: function (w, row) {
            var d = w || this.desk;
            return d.thumbSrc[this.deskEntryPath(d, row)] || '';
        },
        onDeskThumbError: function (w, row) {
            var d = w || this.desk;
            var path = this.deskEntryPath(d, row);
            var src = d.thumbSrc[path];
            if (src) {
                try { URL.revokeObjectURL(src); } catch (e) { /* ignore */ }
                this.$delete(d.thumbSrc, path);
            }
            this.$set(d.thumbFailed, path, true);
        },
        startDesktopClock: function () {
            this.stopDesktopClock();
            this.desktop.clockNow = Date.now();
            this._deskLastActivity = Date.now();
            var self = this;
            this._deskClockTimer = setInterval(function () {
                self.desktop.clockNow = Date.now();
                self.checkDesktopIdle();
            }, 1000);
        },
        stopDesktopClock: function () {
            if (this._deskClockTimer) {
                clearInterval(this._deskClockTimer);
                this._deskClockTimer = null;
            }
        },
        touchDesktopActivity: function () {
            this._deskLastActivity = Date.now();
        },
        hasDesktopDialogOpen: function () {
            return this.fontVisible || this.hotkeyVisible || this.bgVisible || this.helpVisible
                || this.sponsorVisible
                || this.aboutVisible || this.lanVisible || this.authSetVisible || this.aiSetVisible
                || this.sysInfoVisible || this.procDetailVisible || this.connectDialogVisible
                || this.connImportVisible
                || this.connExportVisible || this.cmdEditDialog || this.editVisible || this.renameVisible
                || this.desktop.propsVisible;
        },
        checkDesktopIdle: function () {
            var mins = this.desktop.idleMinutes;
            if (!mins || !this.desktop.visible) {
                return;
            }
            // 图片预览在新标签页打开时，桌面标签处于隐藏状态，不应按空闲自动返回
            if (document.visibilityState === 'hidden') {
                this._deskLastActivity = Date.now();
                return;
            }
            var busy = this.desktop.windows.some(function (w) {
                return w.loading || w.dragNames.length || w.fileDragOver;
            });
            if (this.desktop.settingsVisible || this.desktop.startOpen
                    || this.desktop.menu.visible || busy || this._deskDragDepth
                    || this.chatAnyBusy(this.desktopTab)) {
                this._deskLastActivity = Date.now();
                return;
            }
            if (this.hasDesktopDialogOpen()) {
                this._deskLastActivity = Date.now();
                return;
            }
            if (Date.now() - (this._deskLastActivity || Date.now()) >= mins * 60000) {
                this._deskLastActivity = Date.now();
                this.closeAiDesktop();
                ELEMENT.Message.info('桌面空闲已 ' + mins + ' 分钟，已自动返回工作台');
            }
        },
        normalizeDesktopPath: function (path, win) {
            var d = win || this.desk;
            var p = (path == null ? '' : String(path)).trim();
            var home = this.desktopHomeDir;
            if (!p) {
                p = d.path || home || '/';
            } else if (p === '~') {
                p = home || '/';
            } else if (p.indexOf('~/') === 0) {
                p = this.pathJoin(home || '/', p.slice(2));
            } else if (p.charAt(0) !== '/') {
                p = this.pathJoin(d.path || home || '/', p);
            }
            p = p.replace(/\/{2,}/g, '/');
            while (p.length > 1 && p.charAt(p.length - 1) === '/') {
                p = p.slice(0, -1);
            }
            return p;
        },
        deskFilesEl: function (w) {
            var id = (w && w.id) || this.desktop.activeWinId;
            if (!id || !this.$el) {
                return null;
            }
            return this.$el.querySelector('#dsk-files-' + id);
        },
        loadDesktopDir: function (path, nav, win) {
            var t = this.desktopTab;
            if (!t || (!t.local && !t.sessionId)) {
                ELEMENT.Message.warning(this.desktop.local
                    ? '本地桌面尚未就绪' : '会话未就绪，请等连接建立后再试');
                return;
            }
            var self = this;
            var d = win || this.desk;
            var target = this.normalizeDesktopPath(path, d);
            var prevPath = d.path;
            var seq = (d.loadSeq || 0) + 1;
            d.loadSeq = seq;
            if (d.id === this.desktop.activeWinId) {
                this.cancelDesktopMarquee();
                this.cancelDesktopThumbQueue();
                this.disconnectDesktopThumbObserver();
            }
            if (nav !== 'back' && nav !== 'forward' && nav !== 'refresh' && target !== prevPath) {
                // 新开一条浏览路径：原来的“前进”栈失效
                d.future = [];
            }
            this.resetDesktopThumbs(d);
            d.loading = true;
            d.error = '';
            d.pathEditing = false;
            var listReq = t.local
                ? http.get('/api/local/fs/list', { params: { path: target } })
                : http.get('/api/sftp/list', { params: { sessionId: t.sessionId, path: target } });
            listReq.then(function (list) {
                if (seq !== d.loadSeq) {
                    return;
                }
                if (nav !== 'back' && prevPath && target !== prevPath
                        && d.history[d.history.length - 1] !== prevPath) {
                    d.history.push(prevPath);
                    if (d.history.length > 50) {
                        d.history.shift();
                    }
                }
                if (nav === 'back' && prevPath && target !== prevPath) {
                    d.future.push(prevPath);
                    if (d.future.length > 50) {
                        d.future.shift();
                    }
                }
                if (target !== prevPath) {
                    d.selected = [];
                    d.lastSelected = '';
                } else {
                    // 刷新后保留仍然存在的选中项
                    var names = (list || []).map(function (r) { return r.name; });
                    d.selected = d.selected.filter(function (n) {
                        return names.indexOf(n) >= 0;
                    });
                }
                d.entries = list || [];
                d.path = target;
                d.pathInput = target;
                d.loading = false;
                if (d.type === 'explorer') {
                    self.scheduleSaveDesktopWinLayouts();
                }
                var pendingSel = d.pendingSelect;
                var pendingNames = Array.isArray(pendingSel)
                    ? pendingSel.filter(function (n) { return !!n; })
                    : (pendingSel ? [pendingSel] : []);
                var pendingOpen = d.pendingOpen;
                d.pendingSelect = '';
                d.pendingOpen = false;
                var pendingHits = pendingNames.length
                    ? (list || []).filter(function (r) { return pendingNames.indexOf(r.name) >= 0; })
                    : [];
                if (pendingHits.length) {
                    d.selected = pendingHits.map(function (r) { return r.name; });
                    d.lastSelected = d.selected[d.selected.length - 1];
                    self.scrollDesktopEntry(d.selected, d);
                    if (pendingOpen) {
                        self.desktopOpenEntry(pendingHits[0], d);
                    }
                } else {
                    self.$nextTick(function () {
                        var root = self.deskFilesEl(d);
                        if (root) {
                            root.scrollTop = 0;
                        }
                    });
                }
                if (d.id === self.desktop.activeWinId) {
                    self.$nextTick(function () {
                        self.setupDesktopThumbs(d);
                    });
                }
            }).catch(function (e) {
                if (seq !== d.loadSeq) {
                    return;
                }
                if (nav === 'back' && d.history[d.history.length - 1] === target) {
                    d.history.push(target);
                }
                if (!d.path) {
                    d.path = target;
                    d.pathInput = target;
                }
                d.pendingSelect = '';
                d.pendingOpen = false;
                d.error = '无法读取目录：' + target
                    + (e && e.message ? '（' + e.message + '）' : '（路径不存在或无权限）');
                d.loading = false;
            });
        },
        desktopGo: function (path, win) {
            var d = win || this.desk;
            var p = this.normalizeDesktopPath(path, d);
            if (!p) {
                return;
            }
            if (p === d.path && !d.error) {
                return;
            }
            this.loadDesktopDir(p, null, d);
        },
        desktopRefresh: function (win) {
            var d = win || this.desk;
            if (d.type === 'surface') {
                this.refreshDesktopSurface();
                return;
            }
            if (!d.path) {
                return;
            }
            this.loadDesktopDir(d.path, 'refresh', d);
        },
        desktopGoBack: function () {
            if (!this.desk.history.length || this.desk.loading) {
                return;
            }
            var p = this.desk.history.pop();
            this.loadDesktopDir(p, 'back');
        },
        desktopGoForward: function () {
            if (!this.desk.future.length || this.desk.loading) {
                return;
            }
            var p = this.desk.future.pop();
            this.loadDesktopDir(p, 'forward');
        },
        desktopUp: function () {
            var p = this.desk.path || '/';
            if (p === '/') {
                return;
            }
            var idx = p.lastIndexOf('/');
            this.loadDesktopDir(idx <= 0 ? '/' : p.substring(0, idx));
        },
        desktopGoHome: function () {
            this.loadDesktopDir(this.desktopHomeDir || '/');
        },
        startDesktopPathEdit: function (win) {
            var d = win || this.desk;
            if (!d || !d.path) {
                return;
            }
            if (d.id) {
                this.desktop.explorerId = d.id;
            }
            d.pathInput = d.path;
            d.pathEditing = true;
            var self = this;
            this.$nextTick(function () {
                var r = document.getElementById('dsk-path-input-' + d.id);
                if (r) {
                    r.focus();
                    if (r.select) {
                        r.select();
                    }
                }
            });
        },
        commitDesktopPathEdit: function (win) {
            var d = win || this.desk;
            if (!d.pathEditing) {
                return;
            }
            d.pathEditing = false;
            var p = this.normalizeDesktopPath(d.pathInput, d);
            if (!p) {
                return;
            }
            if (p === d.path) {
                this.desktopRefresh(d);
            } else {
                this.loadDesktopDir(p, null, d);
            }
        },
        setDesktopView: function (v) {
            var d = this.desk;
            d.viewMode = v;
            try { localStorage.setItem('deepshell.desktopView', v); } catch (e) { /* ignore */ }
            var self = this;
            this.$nextTick(function () {
                self.setupDesktopThumbs(d);
            });
        },
        desktopSortBy: function (field) {
            if (this.desk.sortBy === field) {
                this.desk.sortDir = this.desk.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                this.desk.sortBy = field;
                this.desk.sortDir = field === 'name' ? 'asc' : 'desc';
            }
        },
        desktopSortCommand: function (cmd) {
            if (cmd === 'name' || cmd === 'size' || cmd === 'mtime') {
                this.desktopSortBy(cmd);
            }
        },
        desktopClearSelection: function () {
            this.desk.selected = [];
            this.desk.lastSelected = '';
        },
        onDesktopFilesClick: function (ev) {
            var el = ev && ev.target;
            if (el && el.closest && (el.closest('.dsk-item') || el.closest('.dsk-row')
                    || el.closest('.dsk-list-head'))) {
                return;
            }
            this.desktopClearSelection();
        },
        /* ---------- 空白处左键拖拽框选 ---------- */
        onDesktopFilesMouseDown: function (ev) {
            if (ev.button !== 0 || !this.desktop.visible) {
                return;
            }
            if (this.desk.loading || this.desk.pathEditing
                    || this.desktop.settingsVisible || this.desktop.startOpen
                    || this.desktop.menu.visible || this.hasDesktopDialogOpen()) {
                return;
            }
            var target = ev.target;
            if (target && target.closest && target.closest(
                    '.dsk-item, .dsk-row, .dsk-list-head, .dsk-empty, .dsk-error, .dsk-loading')) {
                return;
            }
            var d = this.desk;
            var root = this.deskFilesEl(d);
            if (!root) {
                return;
            }
            var rect = root.getBoundingClientRect();
            // 右侧 / 底部滚动条区域不触发框选
            if (ev.clientX > rect.right - 14 || ev.clientY > rect.bottom - 14) {
                return;
            }
            ev.preventDefault();
            var active = document.activeElement;
            if (active && active !== document.body && active.blur) {
                active.blur();
            }
            this.cancelDesktopMarquee();
            var nodes = root.querySelectorAll('.dsk-item[data-name], .dsk-row[data-name]');
            var items = [];
            for (var i = 0; i < nodes.length; i++) {
                var r = nodes[i].getBoundingClientRect();
                items.push({
                    name: nodes[i].getAttribute('data-name'),
                    left: r.left,
                    top: r.top,
                    right: r.right,
                    bottom: r.bottom
                });
            }
            var additive = !!(ev.ctrlKey || ev.metaKey);
            this._marquee = {
                win: d,
                startX: ev.clientX,
                startY: ev.clientY,
                lastX: ev.clientX,
                lastY: ev.clientY,
                base: additive ? d.selected.slice() : [],
                additive: additive,
                moved: false,
                items: items,
                scrollLeft: root.scrollLeft,
                scrollTop: root.scrollTop
            };
            document.addEventListener('mousemove', this.onDesktopMarqueeMove);
            document.addEventListener('mouseup', this.onDesktopMarqueeUp);
            var self = this;
            this._marqueeTimer = setInterval(function () {
                self.autoScrollDesktopMarquee();
            }, 40);
        },
        onDesktopMarqueeMove: function (ev) {
            var m = this._marquee;
            if (!m) {
                return;
            }
            if (ev.buttons === 0) {
                this.onDesktopMarqueeUp();
                return;
            }
            m.lastX = ev.clientX;
            m.lastY = ev.clientY;
            if (!m.moved) {
                if (Math.abs(m.lastX - m.startX) < 4 && Math.abs(m.lastY - m.startY) < 4) {
                    return;
                }
                m.moved = true;
            }
            var self = this;
            if (this._marqueeRaf) {
                return;
            }
            this._marqueeRaf = window.requestAnimationFrame(function () {
                self._marqueeRaf = 0;
                self.updateDesktopMarquee();
            });
        },
        updateDesktopMarquee: function () {
            var m = this._marquee;
            if (!m || !m.moved) {
                return;
            }
            var d = m.win || this.desk;
            var root = this.deskFilesEl(d);
            if (!root) {
                return;
            }
            var rr = root.getBoundingClientRect();
            var left = Math.max(rr.left, Math.min(m.startX, m.lastX));
            var right = Math.min(rr.right, Math.max(m.startX, m.lastX));
            var top = Math.max(rr.top, Math.min(m.startY, m.lastY));
            var bottom = Math.min(rr.bottom, Math.max(m.startY, m.lastY));
            d.marquee.visible = true;
            d.marquee.left = left;
            d.marquee.top = top;
            d.marquee.width = Math.max(0, right - left);
            d.marquee.height = Math.max(0, bottom - top);

            // 用拖动开始时的元素矩形 + 滚动差值计算命中，避免每帧都强制浏览器重排
            var dx = root.scrollLeft - m.scrollLeft;
            var dy = root.scrollTop - m.scrollTop;
            var sel = m.additive ? m.base.slice() : [];
            var last = '';
            for (var i = 0; i < m.items.length; i++) {
                var it = m.items[i];
                var itL = it.left - dx;
                var itR = it.right - dx;
                var itT = it.top - dy;
                var itB = it.bottom - dy;
                if (itR >= left && itL <= right && itB >= top && itT <= bottom) {
                    if (sel.indexOf(it.name) < 0) {
                        sel.push(it.name);
                    }
                    last = it.name;
                }
            }
            var same = sel.length === d.selected.length;
            if (same) {
                for (var j = 0; j < sel.length; j++) {
                    if (sel[j] !== d.selected[j]) {
                        same = false;
                        break;
                    }
                }
            }
            if (!same) {
                d.selected = sel;
            }
            if (last) {
                d.lastSelected = last;
            } else if (!m.additive) {
                d.lastSelected = '';
            }
        },
        autoScrollDesktopMarquee: function () {
            var m = this._marquee;
            if (!m || !m.moved) {
                return;
            }
            var root = this.deskFilesEl(m.win || this.desk);
            if (!root) {
                return;
            }
            var rr = root.getBoundingClientRect();
            if (m.lastX < rr.left || m.lastX > rr.right
                    || m.lastY < rr.top || m.lastY > rr.bottom) {
                return;
            }
            var edge = 28;
            var speed = 0;
            if (m.lastY < rr.top + edge) {
                speed = -Math.min(26, Math.ceil((rr.top + edge - m.lastY) / 2));
            } else if (m.lastY > rr.bottom - edge) {
                speed = Math.min(26, Math.ceil((m.lastY - (rr.bottom - edge)) / 2));
            }
            if (!speed) {
                return;
            }
            var before = root.scrollTop;
            root.scrollTop += speed;
            if (root.scrollTop !== before) {
                this.updateDesktopMarquee();
            }
        },
        onDesktopMarqueeUp: function () {
            var moved = !!(this._marquee && this._marquee.moved);
            if (moved) {
                // 补一次最终位置，避免快速拖拽时最后一帧还没渲染
                this.updateDesktopMarquee();
            }
            this.cancelDesktopMarquee();
            if (moved) {
                // 框选结束后浏览器还会补发一次 click，捕获阶段吞掉它，避免清掉刚框好的选区
                var suppressClick = function (e) {
                    e.stopPropagation();
                    e.preventDefault();
                    document.removeEventListener('click', suppressClick, true);
                };
                document.addEventListener('click', suppressClick, true);
                setTimeout(function () {
                    document.removeEventListener('click', suppressClick, true);
                }, 300);
            }
        },
        cancelDesktopMarquee: function () {
            document.removeEventListener('mousemove', this.onDesktopMarqueeMove);
            document.removeEventListener('mouseup', this.onDesktopMarqueeUp);
            if (this._marqueeTimer) {
                clearInterval(this._marqueeTimer);
                this._marqueeTimer = null;
            }
            if (this._marqueeRaf) {
                window.cancelAnimationFrame(this._marqueeRaf);
                this._marqueeRaf = 0;
            }
            var m = this._marquee;
            this._marquee = null;
            if (m && m.win && m.win.marquee.visible) {
                m.win.marquee.visible = false;
            }
        },
        scrollDesktopEntry: function (names, win) {
            var self = this;
            var d = win || this.desk;
            var wanted = Array.isArray(names) ? names : [names];
            this.$nextTick(function () {
                var root = self.deskFilesEl(d);
                if (!root) {
                    return;
                }
                var els = root.querySelectorAll('.dsk-item, .dsk-row');
                var last = null;
                for (var i = 0; i < els.length; i++) {
                    if (wanted.indexOf(els[i].getAttribute('data-name')) >= 0) {
                        last = els[i];
                    }
                }
                if (last) {
                    try {
                        last.scrollIntoView({ block: 'nearest' });
                    } catch (e) { /* ignore */ }
                }
            });
        },
        isDesktopSelected: function (row) {
            return this.desk.selected.indexOf(row.name) >= 0;
        },
        desktopSelect: function (row, ev) {
            var rows = this.desktopShownEntries;
            var sel = this.desk.selected.slice();
            if (ev && ev.shiftKey && this.desk.lastSelected) {
                var a = -1;
                var b = -1;
                rows.forEach(function (r, i) {
                    if (r.name === this.desk.lastSelected) {
                        a = i;
                    }
                    if (r.name === row.name) {
                        b = i;
                    }
                }, this);
                if (a >= 0 && b >= 0) {
                    var range = rows.slice(Math.min(a, b), Math.max(a, b) + 1).map(function (r) {
                        return r.name;
                    });
                    if (ev.ctrlKey || ev.metaKey) {
                        range.forEach(function (n) {
                            if (sel.indexOf(n) < 0) {
                                sel.push(n);
                            }
                        });
                    } else {
                        sel = range;
                    }
                }
            } else if (ev && (ev.ctrlKey || ev.metaKey)) {
                var i = sel.indexOf(row.name);
                if (i >= 0) {
                    sel.splice(i, 1);
                } else {
                    sel.push(row.name);
                }
            } else {
                sel = [row.name];
            }
            this.desk.selected = sel;
            this.desk.lastSelected = row.name;
            this.desktop.menu.visible = false;
        },
        desktopSelectAll: function (win) {
            var d = win || this.desk;
            d.selected = this.deskShownEntries(d).map(function (r) { return r.name; });
        },
        desktopSelectedRows: function (win) {
            var d = win || this.desk;
            var names = d.selected || [];
            return (d.entries || []).filter(function (r) {
                return names.indexOf(r.name) >= 0;
            });
        },
        /* 桌面背景上的图标与资源管理器窗口共用同一套文件操作 */
        desktopSurfaceContextWin: function () {
            var names = [];
            this.desktopSurfaceSelectedRows().forEach(function (row) {
                names.push(row.name);
            });
            var anchor = this.desktop.iconSelected ? this.desktopIconItemMap[this.desktop.iconSelected] : null;
            return {
                id: '__surface__',
                type: 'surface',
                path: this.desktop.surface.dir,
                entries: this.desktop.surface.entries || [],
                selected: names,
                lastSelected: anchor && anchor.entry ? anchor.entry.name : '',
                sortBy: 'name',
                sortDir: 'asc'
            };
        },
        desktopTargetRows: function () {
            var d = this.desktopMenuContextWin();
            var rows = this.desktopSelectedRows(d);
            if (rows.length) {
                return rows;
            }
            var target = this.desktop.menu.target;
            return target ? [target] : [];
        },
        desktopOpenEntry: function (row, win) {
            if (!row) {
                return;
            }
            var d = win || this.desk;
            if (row.dir) {
                this.desktopGo(this.pathJoin(d.path, row.name), d);
            } else if (this.isDesktopImage(row)) {
                this.openDesktopImagePreview(row, d);
            } else if (this.isDesktopVideo(row)) {
                this.openDesktopVideoPreview(row, d);
            } else if (this.isDesktopAudio(row)) {
                this.openDesktopAudioPreview(row, d);
            } else if (this.desktopArchiveFormat(row.name)) {
                ELEMENT.Message.info('压缩包请右键选择「解压」');
            } else {
                this.desktopOpenEdit(row, d);
            }
        },
        desktopEntryPath: function (row, win) {
            var d = win || this.desk;
            return this.pathJoin(d.path, row.name);
        },
        /* 图片在新标签页打开：桌面保持原路径，关掉标签页即可继续浏览 */
        openDesktopImagePreview: function (row, win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            if (!t || (!t.local && !t.sessionId) || !this.isDesktopImage(row)) {
                return;
            }
            var query = '?' + (t.local ? 'local=1&' : 'sessionId=' + encodeURIComponent(t.sessionId) + '&')
                + 'path=' + encodeURIComponent(this.desktopEntryPath(row, d))
                + '&sortBy=' + encodeURIComponent(d.sortBy)
                + '&sortDir=' + encodeURIComponent(d.sortDir)
                + '&hidden=' + (this.desktop.showHidden ? '1' : '0');
            if (!window.open('/image-viewer' + query, '_blank')) {
                ELEMENT.Message.warning('浏览器拦截了新标签页，请允许弹出窗口后重试');
            }
        },
        /* 视频同样在新标签页打开；后端按 Range 流式返回，可边下边播和拖动进度条 */
        openDesktopVideoPreview: function (row, win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            if (!t || (!t.local && !t.sessionId) || !this.isDesktopVideo(row)) {
                return;
            }
            var query = '?' + (t.local ? 'local=1&' : 'sessionId=' + encodeURIComponent(t.sessionId) + '&')
                + 'path=' + encodeURIComponent(this.desktopEntryPath(row, d))
                + '&sortBy=' + encodeURIComponent(d.sortBy)
                + '&sortDir=' + encodeURIComponent(d.sortDir)
                + '&hidden=' + (this.desktop.showHidden ? '1' : '0');
            if (!window.open('/video-viewer' + query, '_blank')) {
                ELEMENT.Message.warning('浏览器拦截了新标签页，请允许弹出窗口后重试');
            }
        },
        /* 音频同样在新标签页打开，后端 Range 流式返回，可拖动进度条并自动连播同目录音频 */
        openDesktopAudioPreview: function (row, win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            if (!t || (!t.local && !t.sessionId) || !this.isDesktopAudio(row)) {
                return;
            }
            var query = '?' + (t.local ? 'local=1&' : 'sessionId=' + encodeURIComponent(t.sessionId) + '&')
                + 'path=' + encodeURIComponent(this.desktopEntryPath(row, d))
                + '&sortBy=' + encodeURIComponent(d.sortBy)
                + '&sortDir=' + encodeURIComponent(d.sortDir)
                + '&hidden=' + (this.desktop.showHidden ? '1' : '0');
            if (!window.open('/audio-viewer' + query, '_blank')) {
                ELEMENT.Message.warning('浏览器拦截了新标签页，请允许弹出窗口后重试');
            }
        },
        /* ---------- 图片缩略图 / 新标签页预览 ---------- */
        /* 只观察当前活动窗口滚动容器里露出来的网格项，避免一次性请求整目录图片 */
        setupDesktopThumbs: function (win) {
            var self = this;
            var d = win || this.desk;
            this.disconnectDesktopThumbObserver();
            this.cancelDesktopThumbQueue();
            if (!d.id || !this.desktop.visible || !this.desktop.thumbnailsEnabled
                    || d.id !== this.desktop.activeWinId
                    || (d.viewMode !== 'large' && d.viewMode !== 'medium')) {
                return;
            }
            var root = this.deskFilesEl(d);
            if (!root) {
                return;
            }
            var items = root.querySelectorAll('.dsk-item');
            if (!items.length) {
                return;
            }
            if (typeof IntersectionObserver === 'undefined') {
                // 老浏览器兜底：交给限并发队列，不阻塞页面
                for (var i = 0; i < items.length; i++) {
                    var row = this.deskRowByName(d, items[i].getAttribute('data-name'));
                    if (row) {
                        this.queueDesktopThumb(d, row);
                    }
                }
                return;
            }
            var observer = new IntersectionObserver(function (entries) {
                for (var k = 0; k < entries.length; k++) {
                    if (!entries[k].isIntersecting) {
                        continue;
                    }
                    observer.unobserve(entries[k].target);
                    var hit = self.deskRowByName(d, entries[k].target.getAttribute('data-name'));
                    if (hit) {
                        self.queueDesktopThumb(d, hit);
                    }
                }
            }, { root: root, rootMargin: '240px 0px' });
            this._thumbObserver = observer;
            for (var j = 0; j < items.length; j++) {
                var r = this.deskRowByName(d, items[j].getAttribute('data-name'));
                if (r && this.deskShowThumb(d, r)
                        && !d.thumbSrc[this.deskEntryPath(d, r)]) {
                    observer.observe(items[j]);
                }
            }
        },
        disconnectDesktopThumbObserver: function () {
            if (this._thumbObserver) {
                this._thumbObserver.disconnect();
                this._thumbObserver = null;
            }
        },
        queueDesktopThumb: function (w, row) {
            var d = w || this.desk;
            if (!this.deskShowThumb(d, row)) {
                return;
            }
            var path = this.deskEntryPath(d, row);
            if (d.thumbSrc[path] || d.thumbFailed[path]) {
                return;
            }
            if (!this._thumbQueued) {
                this._thumbQueued = {};
            }
            if (this._thumbQueued[path]) {
                return;
            }
            this._thumbQueued[path] = true;
            if (!this._thumbQueue) {
                this._thumbQueue = [];
            }
            this._thumbQueue.push({
                w: d,
                path: path,
                mtime: row.mtime || 0,
                video: this.isDesktopVideo(row)
            });
            this.pumpDesktopThumbs();
        },
        /* 限并发：最多 2 个缩略图请求；视频抓帧额外限制为全局 1 个，避免挤占 SFTP 通道 */
        pumpDesktopThumbs: function () {
            var MAX_THUMB_ACTIVE = 2;
            if (!this._thumbQueue) {
                this._thumbQueue = [];
            }
            if (!this._thumbActive) {
                this._thumbActive = 0;
            }
            while (this._thumbActive < MAX_THUMB_ACTIVE && this._thumbQueue.length) {
                var pick = -1;
                for (var i = 0; i < this._thumbQueue.length; i++) {
                    if (!this._thumbQueue[i].video || !(this._videoThumbActive || 0)) {
                        pick = i;
                        break;
                    }
                }
                if (pick < 0) {
                    break;
                }
                this.loadDesktopThumb(this._thumbQueue.splice(pick, 1)[0]);
            }
        },
        /* 浏览器端抓取视频首帧：只读元数据并 seek 到约 10%，不下载整段视频 */
        captureVideoThumb: function (url, ctrl, done, fail) {
            var video = document.createElement('video');
            var finished = false;
            var timer = null;
            var fallbackTimer = null;
            var onAbort = function () {
                finishErr({ name: 'AbortError' });
            };
            var cleanup = function () {
                clearTimeout(timer);
                clearTimeout(fallbackTimer);
                if (ctrl && ctrl.signal && onAbort) {
                    try { ctrl.signal.removeEventListener('abort', onAbort); } catch (e) { /* ignore */ }
                }
                try { video.pause(); } catch (e) { /* ignore */ }
                video.removeAttribute('src');
                try { video.load(); } catch (e) { /* ignore */ }
                if (video.parentNode) {
                    video.parentNode.removeChild(video);
                }
            };
            var finishErr = function (err) {
                if (finished) {
                    return;
                }
                finished = true;
                cleanup();
                fail(err || new Error('video thumbnail failed'));
            };
            var finishOk = function (blobUrl) {
                if (finished) {
                    return;
                }
                finished = true;
                cleanup();
                done(blobUrl);
            };
            var drawFrame = function () {
                if (finished) {
                    return;
                }
                try {
                    var vw = video.videoWidth;
                    var vh = video.videoHeight;
                    if (!vw || !vh) {
                        finishErr(new Error('no video frame'));
                        return;
                    }
                    var max = 200;
                    var scale = Math.min(1, max / Math.max(vw, vh));
                    var w = Math.max(1, Math.round(vw * scale));
                    var h = Math.max(1, Math.round(vh * scale));
                    var canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
                    if (!canvas.toBlob) {
                        finishErr(new Error('canvas toBlob unsupported'));
                        return;
                    }
                    canvas.toBlob(function (blob) {
                        if (!blob) {
                            finishErr(new Error('empty video thumbnail'));
                            return;
                        }
                        if (finished) {
                            return;
                        }
                        finishOk(URL.createObjectURL(blob));
                    }, 'image/jpeg', 0.82);
                } catch (e) {
                    finishErr(e);
                }
            };
            if (ctrl && ctrl.signal) {
                if (ctrl.signal.aborted) {
                    finishErr({ name: 'AbortError' });
                    return;
                }
                ctrl.signal.addEventListener('abort', onAbort, false);
            }
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.setAttribute('playsinline', '');
            video.style.position = 'fixed';
            video.style.left = '-99999px';
            video.style.top = '0';
            video.style.width = '2px';
            video.style.height = '2px';
            video.style.opacity = '0';
            video.addEventListener('loadedmetadata', function () {
                var duration = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
                var seek = duration > 2 ? Math.min(2, duration * 0.1) : 0.1;
                try {
                    video.currentTime = seek;
                } catch (e) {
                    finishErr(e);
                    return;
                }
                // 个别格式 seek 不触发 seeked，用已解码的当前帧兜底
                fallbackTimer = setTimeout(function () {
                    if (!finished) {
                        drawFrame();
                    }
                }, 1400);
            });
            video.addEventListener('seeked', drawFrame);
            video.addEventListener('error', function () {
                finishErr(new Error('video decode failed'));
            });
            timer = setTimeout(function () {
                finishErr(new Error('video thumbnail timeout'));
            }, 15000);
            document.body.appendChild(video);
            try {
                video.src = url;
                video.load();
            } catch (e) {
                finishErr(e);
            }
        },
        loadDesktopThumb: function (item) {
            var self = this;
            var t = this.desktopTab;
            var d = item && item.w;
            if (!t || (!t.local && !t.sessionId) || !this.desktop.visible || !d
                    || this.desktop.windows.indexOf(d) < 0
                    || d.thumbSrc[item.path] || d.thumbFailed[item.path]) {
                if (this._thumbQueued) {
                    this._thumbQueued[item.path] = false;
                }
                return;
            }
            var gen = this._thumbGen || 0;
            var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            if (ctrl) {
                if (!this._thumbCtrls) {
                    this._thumbCtrls = [];
                }
                this._thumbCtrls.push(ctrl);
            }
            this._thumbActive = (this._thumbActive || 0) + 1;
            var isVideo = !!item.video;
            if (isVideo) {
                this._videoThumbActive = (this._videoThumbActive || 0) + 1;
            }
            var apiBase = t.local ? '/api/local/fs/' : '/api/sftp/';
            var url = apiBase + (isVideo ? 'video' : 'thumbnail')
                + '?path=' + encodeURIComponent(item.path)
                + '&v=' + item.mtime;
            if (!t.local) {
                url += '&sessionId=' + encodeURIComponent(t.sessionId);
            }
            var promise;
            if (isVideo) {
                promise = new Promise(function (resolve, reject) {
                    self.captureVideoThumb(url, ctrl, resolve, reject);
                });
            } else {
                promise = fetch(url, { credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined })
                    .then(function (resp) {
                        if (!resp.ok) {
                            throw new Error('HTTP ' + resp.status);
                        }
                        var type = resp.headers.get('Content-Type') || '';
                        if (type.indexOf('image/') !== 0) {
                            throw new Error('not an image');
                        }
                        return resp.blob();
                    })
                    .then(function (blob) {
                        return URL.createObjectURL(blob);
                    });
            }
            promise.then(function (thumbUrl) {
                if (gen !== (self._thumbGen || 0) || self.desktop.windows.indexOf(d) < 0) {
                    try { URL.revokeObjectURL(thumbUrl); } catch (e) { /* ignore */ }
                    return;
                }
                self.$set(d.thumbSrc, item.path, thumbUrl);
            }).catch(function (e) {
                if (gen !== (self._thumbGen || 0) || (e && e.name === 'AbortError')
                        || self.desktop.windows.indexOf(d) < 0) {
                    return;
                }
                self.$set(d.thumbFailed, item.path, true);
            }).then(function () {
                if (ctrl && self._thumbCtrls) {
                    var idx = self._thumbCtrls.indexOf(ctrl);
                    if (idx >= 0) {
                        self._thumbCtrls.splice(idx, 1);
                    }
                }
                if (self._thumbQueued) {
                    self._thumbQueued[item.path] = false;
                }
                self._thumbActive = Math.max(0, (self._thumbActive || 0) - 1);
                if (isVideo) {
                    self._videoThumbActive = Math.max(0, (self._videoThumbActive || 0) - 1);
                }
                if (gen === (self._thumbGen || 0)) {
                    self.pumpDesktopThumbs();
                }
            });
        },
        cancelDesktopThumbQueue: function () {
            this._thumbGen = (this._thumbGen || 0) + 1;
            this._thumbQueue = [];
            this._thumbQueued = {};
            this._thumbActive = 0;
            this._videoThumbActive = 0;
            if (this._thumbCtrls) {
                this._thumbCtrls.forEach(function (c) {
                    try { c.abort(); } catch (e) { /* ignore */ }
                });
                this._thumbCtrls = [];
            }
        },
        releaseDesktopWindowThumbs: function (d) {
            if (!d) {
                return;
            }
            var srcs = d.thumbSrc || {};
            Object.keys(srcs).forEach(function (k) {
                try { URL.revokeObjectURL(srcs[k]); } catch (e) { /* ignore */ }
            });
            d.thumbSrc = {};
            d.thumbFailed = {};
        },
        resetDesktopThumbs: function (win) {
            this.releaseDesktopWindowThumbs(win || this.desk);
        },
        desktopEntryContextMenu: function (ev, row) {
            this.desktop.startOpen = false;
            if (!this.isDesktopSelected(row)) {
                this.desk.selected = [row.name];
                this.desk.lastSelected = row.name;
            }
            this.openDesktopMenu(ev, row);
        },
        desktopBlankContextMenu: function (ev) {
            this.desktop.startOpen = false;
            this.desk.selected = [];
            this.desk.lastSelected = '';
            this.openDesktopMenu(ev, null);
        },
        openDesktopMenu: function (ev, target, surface) {
            var self = this;
            var x = ev.clientX;
            var y = ev.clientY;
            this.desktop.taskMenu.visible = false;
            this.desktop.iconMenu.visible = false;
            this.desktop.trashMenu.visible = false;
            this.desktop.calendarOpen = false;
            this.closeDesktopSubMenus();
            this.desktop.menu = {
                visible: true,
                x: Math.max(8, Math.min(x, window.innerWidth - 232)),
                y: Math.max(8, Math.min(y, window.innerHeight - 320)),
                target: target,
                surface: !!surface
            };
            this.$nextTick(function () {
                var el = self.$refs.deskMenu;
                if (!el || !self.desktop.menu.visible) {
                    return;
                }
                var w = el.offsetWidth || 224;
                var h = el.offsetHeight || 320;
                self.desktop.menu.x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
                self.desktop.menu.y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
            });
        },
        onDesktopSurfaceClick: function (ev) {
            // 只有点击桌面背景/图标层才算聚焦桌面；窗口、任务栏、菜单内的点击会冒泡到这里
            var target = ev && ev.target;
            if (target && target.closest && !target.closest('.dsk-wallpaper, .dsk-icons')) {
                return;
            }
            this.desktop.calendarOpen = false;
            if (this.desktop.menu.visible) {
                this.desktop.menu.visible = false;
            }
            if (this.desktop.wallMenu.visible) {
                this.desktop.wallMenu.visible = false;
            }
            if (this.desktop.taskMenu.visible) {
                this.desktop.taskMenu.visible = false;
            }
            if (this.desktop.iconMenu.visible) {
                this.desktop.iconMenu.visible = false;
            }
            this.desktop.iconSelected = '';
            this.desktop.iconSelectedKeys = [];
            this.desktop.focusSurface = true;
            this.cancelDesktopIconMarquee();
            this.closeDesktopSubMenus();
            if (this.desktop.startOpen) {
                this.desktop.startOpen = false;
            }
        },
        desktopMenuAction: function (action) {
            var target = this.desktop.menu.target;
            var surface = !!this.desktop.menu.surface;
            var ctxWin = this.desktopMenuContextWin();
            var rows = this.desktopTargetRows();
            this.desktop.menu.visible = false;
            this.closeDesktopSubMenus();
            var self = this;
            if (this.desktop.local && ['vscode', 'crossTransfer', 'terminal', 'terminalHere',
                'downloadBundle', 'downloadLocal'].indexOf(action) >= 0) {
                this.desktopServerReady();
                return;
            }
            if (this.desktop.local && (action.indexOf('compress') === 0
                    || action.indexOf('extract') === 0)) {
                this.desktopServerReady();
                return;
            }
            if (this.desktop.local && action === 'delete') {
                this.desktopDeleteRows(rows, ctxWin, true);
                return;
            }
            if (action === 'open') {
                if (surface) {
                    this.openDesktopSurfaceRow(target || rows[0]);
                } else {
                    this.desktopOpenEntry(target || rows[0]);
                }
            } else if (action === 'openNewWindow') {
                if (target && target.dir) {
                    this.openDesktopExplorerWindow(this.desktopEntryPath(target, ctxWin));
                }
            } else if (action === 'shortcut') {
                if (target) {
                    this.createDesktopShortcut(target, ctxWin);
                }
            } else if (action === 'cut') {
                this.cutDesktopRows(rows, ctxWin);
            } else if (action === 'copy') {
                this.copyDesktopRows(rows, ctxWin);
            } else if (action === 'paste') {
                this.pasteDesktop(ctxWin);
            } else if (action === 'pasteInto') {
                if (target && target.dir) {
                    this.pasteDesktop(ctxWin, this.desktopEntryPath(target, ctxWin));
                }
            } else if (action === 'compressDialog') {
                this.desktopOpenArchiveDialog('zip', ctxWin);
            } else if (action.indexOf('compress:') === 0) {
                this.desktopOpenArchiveDialog(action.substring('compress:'.length), ctxWin);
            } else if (action === 'extractHere') {
                this.desktopExtractArchive(target, ctxWin, false);
            } else if (action === 'extractToFolder') {
                this.desktopExtractArchive(target, ctxWin, true);
            } else if (action === 'preview') {
                if (target && this.isDesktopImage(target)) {
                    this.openDesktopImagePreview(target, ctxWin);
                } else if (target && this.isDesktopVideo(target)) {
                    this.openDesktopVideoPreview(target, ctxWin);
                } else if (target && this.isDesktopAudio(target)) {
                    this.openDesktopAudioPreview(target, ctxWin);
                }
            } else if (action === 'edit') {
                if (target && !target.dir) {
                    this.desktopOpenEdit(target, ctxWin);
                }
            } else if (action === 'vscode') {
                if (target && !target.dir) {
                    this.openVscodeEdit(this.desktopTab, this.desktopEntryPath(target, ctxWin));
                }
            } else if (action === 'download') {
                this.desktopDownloadRows(rows, ctxWin);
            } else if (action === 'crossTransfer') {
                this.openCrossTransferDialog(ctxWin);
            } else if (action === 'downloadEach') {
                this.desktopDownloadRows(rows, ctxWin);
            } else if (action === 'downloadBundle') {
                this.desktopDownloadBundle(rows, ctxWin);
            } else if (action === 'downloadLocal') {
                this.desktopDownloadToLocal(rows, ctxWin);
            } else if (action === 'copyPath') {
                this.copyText(rows.map(function (r) {
                    return self.desktopEntryPath(r, ctxWin);
                }).join('\n'));
            } else if (action === 'rename') {
                if (target) {
                    this.desktopRename(target, ctxWin);
                }
            } else if (action === 'batchRename') {
                this.openDesktopBatchRename(rows, ctxWin);
            } else if (action === 'checksum') {
                this.openDesktopChecksum(rows, ctxWin);
            } else if (action === 'contentSearch') {
                this.openDesktopContentSearch(ctxWin);
            } else if (action === 'searchFolder') {
                if (target && target.dir) {
                    this.openDesktopContentSearch({
                        id: ctxWin.id,
                        type: ctxWin.type,
                        path: this.desktopEntryPath(target, ctxWin)
                    });
                }
            } else if (action === 'delete') {
                this.desktopDeleteRows(rows, ctxWin, false);
            } else if (action === 'deletePermanent') {
                this.desktopDeleteRows(rows, ctxWin, true);
            } else if (action === 'props') {
                if (target) {
                    this.desktopShowProps(target, ctxWin);
                }
            } else if (action === 'terminal') {
                this.desktopOpenTerminal(target || rows[0], ctxWin);
            } else if (action === 'terminalHere') {
                this.desktopOpenTerminal(null, ctxWin);
            } else if (action === 'copyCurrentPath') {
                this.copyText(ctxWin.path || this.desk.path);
            } else if (action === 'newFolder') {
                this.desktopNewFolder(ctxWin);
            } else if (action === 'newFile') {
                this.desktopNewFile(ctxWin);
            } else if (action === 'upload') {
                this.pickDesktopUpload(ctxWin);
            } else if (action === 'refresh') {
                this.desktopRefresh(ctxWin);
            } else if (action === 'sortName') {
                this.desktopSortBy('name');
            } else if (action === 'sortSize') {
                this.desktopSortBy('size');
            } else if (action === 'sortMtime') {
                this.desktopSortBy('mtime');
            }
        },
        archiveFormatExt: function (format) {
            for (var i = 0; i < this.archiveFormats.length; i++) {
                if (this.archiveFormats[i].id === format) {
                    return this.archiveFormats[i].ext;
                }
            }
            return '.zip';
        },
        desktopArchiveFormat: function (name) {
            var n = String(name || '').toLowerCase();
            if (/\.(zip|jar|war)$/.test(n)) {
                return 'zip';
            }
            if (/\.(tar|tar\.gz|tgz|tar\.bz2|tbz2|tbz|tar\.xz|txz)$/.test(n)) {
                return 'tar';
            }
            if (/\.7z$/.test(n)) {
                return '7z';
            }
            if (/\.rar$/.test(n)) {
                return 'rar';
            }
            if (/\.gz$/.test(n)) {
                return 'gzip';
            }
            if (/\.bz2$/.test(n)) {
                return 'bzip2';
            }
            if (/\.xz$/.test(n)) {
                return 'xz';
            }
            return '';
        },
        desktopArchiveBase: function (name) {
            var n = String(name || '');
            var lower = n.toLowerCase();
            var exts = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tgz', '.tbz2', '.tbz', '.txz',
                '.zip', '.jar', '.war', '.tar', '.7z', '.rar', '.gz', '.bz2', '.xz'];
            for (var i = 0; i < exts.length; i++) {
                if (lower.slice(-exts[i].length) === exts[i]) {
                    var base = n.slice(0, n.length - exts[i].length);
                    return base || 'extracted';
                }
            }
            return n || 'extracted';
        },
        parentDirOf: function (path) {
            var s = String(path || '');
            var idx = s.lastIndexOf('/');
            return idx <= 0 ? '/' : s.substring(0, idx);
        },
        desktopExtractArchive: function (target, win, toFolder) {
            var t = this.desktopTab;
            if (!t || !t.sessionId || !target) {
                return;
            }
            var format = this.desktopArchiveFormat(target.name);
            if (!format) {
                ELEMENT.Message.warning('暂不支持解压该格式');
                return;
            }
            if (this.archiveExtracting) {
                return;
            }
            var d = win || this.desk;
            var archivePath = this.desktopEntryPath(target, d);
            var parent = this.parentDirOf(archivePath);
            var folderName = this.desktopArchiveBase(target.name);
            var destDir = toFolder ? this.pathJoin(parent, folderName) : parent;
            var self = this;
            this.archiveExtracting = true;
            var loading = ELEMENT.Message({
                message: '正在解压 ' + target.name + ' …',
                duration: 0,
                iconClass: 'el-icon-loading'
            });
            http.post('/api/sftp/extract', {
                sessionId: t.sessionId,
                path: archivePath,
                destDir: destDir,
                overwrite: false
            }).then(function (res) {
                loading.close();
                self.archiveExtracting = false;
                if (res && res.skipped) {
                    ELEMENT.Message.info('目标文件已存在，已跳过解压');
                } else {
                    ELEMENT.Message.success(toFolder
                        ? ('已解压到 ' + folderName + '/')
                        : ('已解压到当前目录：' + parent));
                }
                if (d && d.type !== 'surface') {
                    d.pendingSelect = toFolder ? folderName : target.name;
                }
                self.desktopRefresh(d);
            }).catch(function () {
                loading.close();
                self.archiveExtracting = false;
            });
        },
        positionDesktopSub: function (ev, sub, estimatedHeight) {
            var item = ev && ev.currentTarget;
            var menu = this.$refs.deskMenu;
            if (!item || !menu) {
                return false;
            }
            var ir = item.getBoundingClientRect();
            var mr = menu.getBoundingClientRect();
            var w = 244;
            var h = estimatedHeight || 320;
            var x = mr.right - 4;
            if (x + w > window.innerWidth - 8) {
                x = Math.max(8, mr.left - w + 4);
            }
            var y = Math.max(8, Math.min(ir.top, window.innerHeight - h - 8));
            sub.visible = true;
            sub.x = x;
            sub.y = y;
            return true;
        },
        fitDesktopSubHeight: function (refName, sub) {
            var el = this.$refs[refName];
            if (el) {
                var er = el.getBoundingClientRect();
                if (er.bottom > window.innerHeight - 8) {
                    sub.y = Math.max(8, window.innerHeight - er.height - 8);
                }
            }
        },
        openDesktopCompressSub: function (ev) {
            if (this.desktop.compressSub.visible) {
                this.closeDesktopCompressSub();
                return;
            }
            this.closeDesktopDownloadSub();
            this.closeDesktopExtractSub();
            if (!this.positionDesktopSub(ev, this.desktop.compressSub, 320)) {
                return;
            }
            var self = this;
            this.$nextTick(function () {
                self.fitDesktopSubHeight('deskCompressSub', self.desktop.compressSub);
            });
        },
        closeDesktopCompressSub: function () {
            if (this.desktop.compressSub.visible) {
                this.desktop.compressSub = { visible: false, x: 0, y: 0 };
            }
        },
        openDesktopExtractSub: function (ev) {
            if (this.desktop.extractSub.visible) {
                this.closeDesktopExtractSub();
                return;
            }
            this.closeDesktopCompressSub();
            this.closeDesktopDownloadSub();
            if (!this.positionDesktopSub(ev, this.desktop.extractSub, 140)) {
                return;
            }
            var self = this;
            this.$nextTick(function () {
                self.fitDesktopSubHeight('deskExtractSub', self.desktop.extractSub);
            });
        },
        closeDesktopExtractSub: function () {
            if (this.desktop.extractSub.visible) {
                this.desktop.extractSub = { visible: false, x: 0, y: 0 };
            }
        },
        openDesktopDownloadSub: function (ev) {
            if (this.desktop.downloadSub.visible) {
                this.closeDesktopDownloadSub();
                return;
            }
            this.closeDesktopCompressSub();
            this.closeDesktopExtractSub();
            if (!this.positionDesktopSub(ev, this.desktop.downloadSub, 140)) {
                return;
            }
            var self = this;
            this.$nextTick(function () {
                self.fitDesktopSubHeight('deskDownloadSub', self.desktop.downloadSub);
            });
        },
        closeDesktopDownloadSub: function () {
            if (this.desktop.downloadSub.visible) {
                this.desktop.downloadSub = { visible: false, x: 0, y: 0 };
            }
        },
        closeDesktopSubMenus: function () {
            this.closeDesktopCompressSub();
            this.closeDesktopExtractSub();
            this.closeDesktopDownloadSub();
        },
        desktopOpenArchiveDialog: function (format, win) {
            var rows = this.desktopTargetRows();
            if (!rows.length) {
                return;
            }
            this.desktop.archiveWin = win || this.desk;
            var fmt = format || 'zip';
            var valid = this.archiveFormats.some(function (f) { return f.id === fmt; });
            if (!valid) {
                fmt = 'zip';
            }
            this.closeDesktopSubMenus();
            this.desktop.menu.visible = false;
            var ext = this.archiveFormatExt(fmt);
            var base;
            if (rows.length === 1) {
                base = rows[0].name;
                if (!rows[0].dir) {
                    var idx = base.lastIndexOf('.');
                    if (idx > 0) {
                        base = base.substring(0, idx);
                    }
                }
            } else {
                base = 'archive';
            }
            if (!base) {
                base = 'archive';
            }
            var candidate = base + ext;
            var sourceNames = rows.map(function (r) { return r.name; });
            if (sourceNames.indexOf(candidate) >= 0) {
                candidate = base + '_1' + ext;
            }
            this.archiveForm = {
                format: fmt,
                name: candidate,
                level: 'normal',
                overwrite: false
            };
            this.archiveLastFormat = fmt;
            this.archiveSources = rows.slice();
            this.archiveDialogVisible = true;
        },
        archiveFormatChanged: function () {
            var oldExt = this.archiveFormatExt(this.archiveLastFormat);
            var newExt = this.archiveFormatExt(this.archiveForm.format);
            var name = (this.archiveForm.name || '').trim() || 'archive';
            if (oldExt && name.toLowerCase().endsWith(oldExt.toLowerCase())) {
                name = name.substring(0, name.length - oldExt.length);
            }
            this.archiveForm.name = name + newExt;
            this.archiveLastFormat = this.archiveForm.format;
        },
        archiveCompress: function () {
            var f = this.archiveForm;
            var name = (f.name || '').trim();
            if (!name) {
                ELEMENT.Message.warning('请输入压缩包名称');
                return;
            }
            if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) {
                ELEMENT.Message.warning('压缩包名称不能包含路径分隔符');
                return;
            }
            if (!this.archiveSources.length) {
                ELEMENT.Message.warning('没有要压缩的文件');
                return;
            }
            var ext = this.archiveFormatExt(f.format);
            if (!name.toLowerCase().endsWith(ext.toLowerCase())) {
                name += ext;
            }
            f.name = name;
            if (this.archiveNameExists && !f.overwrite) {
                var self = this;
                this.$confirm('当前目录已存在「' + name + '」，是否覆盖？', '覆盖压缩包', {
                    type: 'warning',
                    confirmButtonText: '覆盖并压缩',
                    cancelButtonText: '取消'
                }).then(function () {
                    self.runArchiveCompress(true);
                }).catch(function () { /* 取消 */ });
                return;
            }
            this.runArchiveCompress(f.overwrite);
        },
        runArchiveCompress: function (overwrite) {
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            var self = this;
            var win = this.desktop.archiveWin || this.desk;
            var form = this.archiveForm;
            var rows = this.archiveSources;
            var paths = rows.map(function (r) {
                return self.pathJoin(win.path, r.name);
            });
            this.archiveSaving = true;
            var loading = ELEMENT.Message({
                message: '正在压缩 ' + rows.length + ' 项到 ' + form.name + ' …',
                duration: 0,
                iconClass: 'el-icon-loading'
            });
            http.post('/api/sftp/compress', {
                sessionId: t.sessionId,
                destDir: win.path,
                paths: paths,
                name: form.name,
                format: form.format,
                level: form.level,
                overwrite: !!overwrite
            }).then(function (d) {
                loading.close();
                self.archiveSaving = false;
                self.archiveDialogVisible = false;
                var finalName = d && d.name ? d.name : form.name;
                ELEMENT.Message.success('压缩完成：' + finalName);
                win.pendingSelect = finalName;
                self.desktopRefresh(win);
                self.desktop.archiveWin = null;
            }).catch(function () {
                loading.close();
                self.archiveSaving = false;
            });
        },
        desktopDownloadRows: function (rows, win) {
            rows = rows || [];
            var d = win || this.desk;
            var files = rows.filter(function (r) { return !r.dir; });
            if (!files.length) {
                ELEMENT.Message.info(this.desktop.local
                    ? '所选项目都是文件夹，本地桌面暂不支持打包下载'
                    : '所选项目都是文件夹，请使用「打包下载」');
                return;
            }
            var skipped = rows.length - files.length;
            if (skipped) {
                ELEMENT.Message.info('已跳过 ' + skipped + ' 个文件夹，正在逐个下载 '
                    + files.length + ' 个文件');
            } else if (files.length > 1) {
                ELEMENT.Message.info('正在逐个下载 ' + files.length
                    + ' 个文件，若浏览器询问多文件下载请选择允许');
            }
            var self = this;
            files.forEach(function (r, i) {
                setTimeout(function () {
                    self.desktopDownloadOne(r, d);
                }, i * 300);
            });
        },
        /* 多选打包下载：后端通过 SFTP 流式打包，浏览器只触发一次下载 */
        desktopDownloadBundle: function (rows, win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            rows = rows || [];
            if (!t || !t.sessionId || !rows.length) {
                return;
            }
            var self = this;
            var paths = rows.map(function (r) {
                return self.desktopEntryPath(r, d);
            });
            this.requestBundleDownload(t.sessionId, d.path, paths, rows.length, t);
        },
        desktopDownloadToLocal: function (rows, win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            rows = rows || [];
            if (!t || !t.sessionId || !rows.length) {
                return;
            }
            var self = this;
            var paths = rows.map(function (r) {
                return self.desktopEntryPath(r, d);
            });
            this.startLocalDownload(t.sessionId, d.path, paths, t.key);
        },
        /* 桌面与 SFTP 面板共用的打包下载：预检 → 隐藏表单提交 */
        requestBundleDownload: function (sessionId, dir, paths, count, tab) {
            if (!sessionId || !paths || !paths.length) {
                return;
            }
            var self = this;
            var loading = ELEMENT.Message({
                message: '正在准备打包 ' + count + ' 项…',
                duration: 0,
                iconClass: 'el-icon-loading'
            });
            http.post('/api/sftp/download-bundle/check', {
                sessionId: sessionId,
                destDir: dir,
                paths: paths
            }).then(function (d) {
                loading.close();
                var name = (d && d.downloadName) || 'download.zip';
                self.createDownloadTask(name).then(function (task) {
                    var item = self.addDownloadTransfer(task, name, tab);
                    self.submitBundleDownload(sessionId, dir, paths, name, task.id);
                    self.pollDownloadTask(item);
                }).catch(function () {
                    // 任务接口异常时退化为普通下载
                    self.submitBundleDownload(sessionId, dir, paths, name);
                });
                ELEMENT.Message.success('已开始下载 ' + name);
            }).catch(function () {
                loading.close();
            });
        },
        /* 表单提交到隐藏 iframe：避免 URI 过长，错误也不会把当前页面导航走 */
        submitBundleDownload: function (sessionId, dir, paths, name, taskId) {
            var frameName = 'dsDownloadFrame';
            if (!document.getElementById(frameName)) {
                var frame = document.createElement('iframe');
                frame.id = frameName;
                frame.name = frameName;
                frame.style.display = 'none';
                document.body.appendChild(frame);
            }
            var form = document.createElement('form');
            form.method = 'POST';
            form.action = '/api/sftp/download-bundle';
            form.target = frameName;
            form.style.display = 'none';
            var addField = function (field, value) {
                var input = document.createElement('input');
                input.type = 'hidden';
                input.name = field;
                input.value = value;
                form.appendChild(input);
            };
            addField('sessionId', sessionId);
            addField('destDir', dir);
            addField('name', name);
            if (taskId) {
                addField('taskId', taskId);
            }
            paths.forEach(function (p) {
                addField('paths', p);
            });
            document.body.appendChild(form);
            form.submit();
            setTimeout(function () {
                form.remove();
            }, 2000);
        },
        desktopDownloadOne: function (row, win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            if (!t || (!t.local && !t.sessionId)) {
                return;
            }
            this.downloadPath(t, this.desktopEntryPath(row, d));
        },
        desktopSelectionHasFile: function (win) {
            return this.desktopSelectedRows(win || this.desk).some(function (r) {
                return r && !r.dir;
            });
        },
        openDesktopTrashWindow: function () {
            if (!this.desktop.visible) {
                return null;
            }
            if (!this.desktopServerReady()) {
                return null;
            }
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return null;
            }
            var existing = this.desktopWindowOfType('trash');
            if (existing) {
                this.restoreDesktopWindow(existing);
                this.loadDesktopTrash(existing);
                return existing;
            }
            var w = this.addDesktopWindow('trash');
            w.trashItems = [];
            w.trashLoading = false;
            w.trashError = '';
            this.centerDesktopWindow(w, 900, 560);
            this.loadDesktopTrash(w);
            return w;
        },
        loadDesktopTrash: function (w) {
            if (!w) {
                return;
            }
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                w.trashError = '连接未就绪';
                w.trashItems = [];
                return;
            }
            var self = this;
            w.trashLoading = true;
            w.trashError = '';
            http.get('/api/sftp/trash/list', {
                params: { sessionId: t.sessionId },
                silent: true
            }).then(function (items) {
                w.trashItems = items || [];
                w.trashLoading = false;
            }).catch(function (err) {
                w.trashLoading = false;
                w.trashItems = [];
                w.trashError = '读取回收站失败：' + ((err && err.message) || '网络错误');
            });
        },
        refreshDesktopTrashWindows: function () {
            var self = this;
            this.desktop.windows.forEach(function (w) {
                if (w.type === 'trash') {
                    self.loadDesktopTrash(w);
                }
            });
        },
        desktopTrashTime: function (ts) {
            var d = new Date(ts || Date.now());
            var p = function (n) { return (n < 10 ? '0' : '') + n; };
            return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate())
                + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        },
        restoreDesktopTrashItem: function (item, w) {
            var t = this.desktopTab;
            if (!t || !t.sessionId || !item) {
                return;
            }
            var self = this;
            http.post('/api/sftp/trash/restore', {
                sessionId: t.sessionId,
                id: item.id
            }).then(function (res) {
                var target = res && res.path ? res.path : item.originalPath;
                ELEMENT.Message.success('已恢复：' + target);
                self.loadDesktopTrash(w);
                self.refreshDesktopAfterRestore(target);
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        purgeDesktopTrashItem: function (item, w) {
            if (!item) {
                return;
            }
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                return;
            }
            var self = this;
            this.$confirm('彻底删除「' + item.name + '」？此操作不可恢复。', '彻底删除', {
                type: 'warning',
                confirmButtonText: '彻底删除',
                cancelButtonText: '取消'
            }).then(function () {
                return http.post('/api/sftp/trash/purge', {
                    sessionId: t.sessionId,
                    ids: [item.id]
                }).then(function (res) {
                    if (res && res.failed) {
                        ELEMENT.Message.warning('彻底删除完成，但有 ' + res.failed + ' 项失败');
                    } else {
                        ELEMENT.Message.success('已彻底删除');
                    }
                    self.loadDesktopTrash(w);
                });
            }).catch(function () { /* 取消或失败 */ });
        },
        desktopTrashEmpty: function (w) {
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                return;
            }
            if (!w || !(w.trashItems || []).length) {
                ELEMENT.Message.info('回收站为空');
                return;
            }
            this.confirmDesktopTrashEmpty(w, w.trashItems.length);
        },
        emptyDesktopTrash: function () {
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                return;
            }
            var w = this.desktopWindowOfType('trash');
            this.confirmDesktopTrashEmpty(w, w ? (w.trashItems || []).length : 0);
        },
        confirmDesktopTrashEmpty: function (w, count) {
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                return;
            }
            var self = this;
            var text = count > 0
                ? ('确定清空回收站中的 ' + count + ' 项？此操作不可恢复。')
                : '确定清空回收站？此操作不可恢复。';
            this.$confirm(text, '清空回收站', {
                type: 'warning',
                confirmButtonText: '清空',
                cancelButtonText: '取消'
            }).then(function () {
                return http.post('/api/sftp/trash/empty', {
                    sessionId: t.sessionId
                }).then(function (res) {
                    var n = res && res.deleted != null ? res.deleted : count;
                    ELEMENT.Message.success(n > 0 ? ('已清空回收站：' + n + ' 项') : '回收站已清空');
                    if (w) {
                        self.loadDesktopTrash(w);
                    }
                    self.refreshDesktopTrashWindows();
                });
            }).catch(function () { /* 取消或失败 */ });
        },
        refreshDesktopAfterRestore: function (target) {
            if (!target) {
                return;
            }
            var idx = target.lastIndexOf('/');
            var parent = idx <= 0 ? '/' : target.substring(0, idx);
            var self = this;
            if (this.desktop.surface.dir === parent) {
                this.refreshDesktopSurface();
            }
            this.desktop.windows.forEach(function (w) {
                if (w.type === 'explorer' && w.path === parent) {
                    self.desktopRefresh(w);
                }
            });
        },
        openDesktopTrashMenu: function (ev, item, w) {
            this.desktop.trashMenu = {
                visible: true,
                x: Math.max(8, Math.min(ev.clientX, window.innerWidth - 240)),
                y: Math.max(8, Math.min(ev.clientY, window.innerHeight - 300)),
                item: item,
                winId: w ? w.id : ''
            };
            this.desktop.iconMenu.visible = false;
            this.desktop.menu.visible = false;
            this.desktop.wallMenu.visible = false;
            var self = this;
            this.$nextTick(function () {
                var el = document.querySelector('.dsk-trash-menu');
                if (!el || !self.desktop.trashMenu.visible) {
                    return;
                }
                var r = el.getBoundingClientRect();
                self.desktop.trashMenu.x = Math.max(8, Math.min(ev.clientX, window.innerWidth - r.width - 8));
                self.desktop.trashMenu.y = Math.max(8, Math.min(ev.clientY, window.innerHeight - r.height - 8));
            });
        },
        desktopTrashMenuAction: function (action) {
            var item = this.desktop.trashMenu.item;
            var w = this.desktopWindowById(this.desktop.trashMenu.winId);
            this.desktop.trashMenu.visible = false;
            if (!item) {
                return;
            }
            if (action === 'restore') {
                this.restoreDesktopTrashItem(item, w);
            } else if (action === 'purge') {
                this.purgeDesktopTrashItem(item, w);
            } else if (action === 'copyPath') {
                this.copyText(item.originalPath);
            } else if (action === 'openParent') {
                var idx = String(item.originalPath || '').lastIndexOf('/');
                this.openDesktopExplorerWindow(idx <= 0 ? '/' : item.originalPath.substring(0, idx));
            } else if (action === 'props') {
                this.desktopTrashProps(item);
            } else if (action === 'refresh') {
                this.loadDesktopTrash(w);
            } else if (action === 'empty') {
                this.confirmDesktopTrashEmpty(w, w ? (w.trashItems || []).length : 0);
            }
        },
        desktopTrashProps: function (item) {
            if (!item) {
                return;
            }
            var size = item.dir ? '文件夹' : this.fmtSize(item.size);
            this.$alert('<div style="line-height:1.9;font-size:13px;color:#4b5563">'
                + '<b>' + escapeAiHtml(item.name) + '</b><br>'
                + '原路径：<span style="font-family:Consolas,monospace">' + escapeAiHtml(item.originalPath) + '</span><br>'
                + '大小：' + escapeAiHtml(size) + '<br>'
                + '删除时间：' + escapeAiHtml(this.desktopTrashTime(item.deletedAt)) + '<br>'
                + '存储位置：<span style="font-family:Consolas,monospace">' + escapeAiHtml(item.storedPath || '') + '</span>'
                + '</div>', '回收站项目属性', {
                dangerouslyUseHTMLString: true,
                confirmButtonText: '知道了'
            });
        },
        desktopDeleteRows: function (rows, win, permanent) {
            var t = this.desktopTab;
            var d = win || this.desk;
            if (!t || (!t.local && !t.sessionId) || !rows || !rows.length) {
                return;
            }
            var self = this;
            var local = this.desktop.local;
            if (local) {
                permanent = true;
            }
            var label = rows.length === 1
                ? ('「' + rows[0].name + '」' + (rows[0].dir ? '及其全部内容' : ''))
                : (rows.length + ' 个项目');
            var message = local
                ? ('确定删除' + label + '？本地桌面不提供回收站，删除后不可恢复。')
                : (permanent
                    ? ('确定彻底删除' + label + '？删除后不可恢复。')
                    : ('确定将' + label + '移入回收站？可在回收站中恢复。'));
            this.$confirm(message, local ? '删除本地文件' : (permanent ? '彻底删除' : '移入回收站'), {
                type: 'warning',
                confirmButtonText: local ? '删除' : (permanent ? '彻底删除' : '移入回收站'),
                cancelButtonText: '取消'
            }).then(function () {
                if (!permanent) {
                    var items = rows.map(function (r) {
                        return {
                            path: self.desktopEntryPath(r, d),
                            name: r.name,
                            dir: !!r.dir,
                            size: r.size || 0
                        };
                    });
                    return http.post('/api/sftp/trash/delete', {
                        sessionId: t.sessionId,
                        items: items
                    }).then(function (results) {
                        var ok = 0;
                        var fail = 0;
                        var firstError = '';
                        (results || []).forEach(function (r) {
                            if (r && r.ok) {
                                ok++;
                            } else {
                                fail++;
                                if (!firstError && r && r.error) {
                                    firstError = r.error;
                                }
                            }
                        });
                        if (fail === 0) {
                            ELEMENT.Message.success('已移入回收站：' + ok + ' 项');
                        } else if (ok > 0) {
                            ELEMENT.Message.warning('移入回收站完成：成功 ' + ok + ' 项，失败 ' + fail + ' 项'
                                + (firstError ? '（' + firstError + '）' : ''));
                        } else {
                            ELEMENT.Message.error(firstError || '移入回收站失败');
                        }
                        d.selected = [];
                        d.lastSelected = '';
                        self.desktopRefresh(d);
                        self.refreshDesktopTrashWindows();
                    });
                }
                var chain = Promise.resolve();
                var ok = 0;
                var fail = 0;
                rows.forEach(function (r) {
                    chain = chain.then(function () {
                        var delReq = t.local
                            ? http.post('/api/local/fs/delete', { path: self.desktopEntryPath(r, d) })
                            : http.post('/api/sftp/delete', {
                                sessionId: t.sessionId,
                                path: self.desktopEntryPath(r, d)
                            });
                        return delReq.then(function () {
                            ok++;
                        }).catch(function () {
                            fail++;
                        });
                    });
                });
                return chain.then(function () {
                    if (fail === 0) {
                        ELEMENT.Message.success('已彻底删除 ' + ok + ' 项');
                    } else {
                        ELEMENT.Message.warning('彻底删除完成：成功 ' + ok + ' 项，失败 ' + fail + ' 项');
                    }
                    d.selected = [];
                    d.lastSelected = '';
                    self.desktopRefresh(d);
                    self.refreshDesktopTrashWindows();
                });
            }).catch(function () { /* 取消或失败（已提示） */ });
        },
        desktopRename: function (row, win) {
            if (!row) {
                return;
            }
            var d = win || this.desk;
            this.renameForm = {
                path: this.desktopEntryPath(row, d),
                newName: row.name,
                desktop: true,
                winId: d.type === 'surface' ? '' : d.id,
                surface: d.type === 'surface'
            };
            this.renameVisible = true;
        },
        /* ---------- 资源管理器：内容搜索 ---------- */
        desktopRelativePath: function (root, path) {
            var base = String(root || '/');
            var p = String(path || '');
            if (base === '/') {
                return p.replace(/^\/+/, '');
            }
            if (p === base) {
                return '.';
            }
            if (p.indexOf(base + '/') === 0) {
                return p.substring(base.length + 1);
            }
            return p;
        },
        desktopSearchHighlight: function (text, keyword) {
            var source = escapeAiHtml(text == null ? '' : String(text));
            var kw = escapeAiHtml(String(keyword || ''));
            if (!kw) {
                return source;
            }
            var pattern = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            var re = new RegExp(pattern, this.desktopContentSearch.caseSensitive ? 'g' : 'gi');
            return source.replace(re, function (m) {
                return '<mark>' + m + '</mark>';
            });
        },
        openDesktopContentSearch: function (win) {
            var d = win || this.desk;
            var t = this.desktopTab;
            if (!t || (!t.local && !t.sessionId) || !d || !d.path) {
                ELEMENT.Message.warning('当前目录尚未就绪');
                return;
            }
            this.desktopContentSearch = {
                visible: true,
                winId: d.type === 'surface' ? '' : (d.id || ''),
                root: d.path,
                keyword: '',
                include: '',
                caseSensitive: false,
                loading: false,
                searched: false,
                results: [],
                error: ''
            };
            var self = this;
            this.$nextTick(function () {
                var input = document.querySelector('.dsk-content-search-input input');
                if (input) {
                    input.focus();
                }
            });
        },
        runDesktopContentSearch: function () {
            var form = this.desktopContentSearch;
            var keyword = String(form.keyword || '').trim();
            if (!keyword) {
                ELEMENT.Message.warning('请输入要搜索的内容');
                return;
            }
            var t = this.desktopTab;
            if (!t || (!t.local && !t.sessionId)) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            var self = this;
            form.loading = true;
            form.error = '';
            form.searched = true;
            var payload = {
                root: form.root,
                keyword: keyword,
                include: form.include,
                caseSensitive: !!form.caseSensitive,
                maxResults: 200
            };
            var req;
            if (t.local) {
                req = http.post('/api/local/fs/content-search', payload);
            } else {
                payload.sessionId = t.sessionId;
                req = http.post('/api/files/content-search', payload);
            }
            req.then(function (list) {
                form.loading = false;
                form.results = (list || []).map(function (r) {
                    return {
                        name: r.name || '',
                        path: r.path || '',
                        line: r.line || 0,
                        text: r.text || '',
                        relativePath: self.desktopRelativePath(form.root, r.path || '')
                    };
                });
            }).catch(function (err) {
                form.loading = false;
                form.results = [];
                form.error = '搜索失败：' + ((err && err.message) || '网络错误');
            });
        },
        desktopContentSearchOpenFile: function (row) {
            var t = this.desktopTab;
            if (!t || !row || !row.path) {
                return;
            }
            this.desktopContentSearch.visible = false;
            this.openDesktopEditorWindow(t, row.path);
        },
        /* ---------- 资源管理器：批量重命名 ---------- */
        openDesktopBatchRename: function (rows, win) {
            var d = win || this.desk;
            var t = this.desktopTab;
            rows = rows || this.desktopSelectedRows(d);
            if (!t || (!t.local && !t.sessionId) || !rows.length) {
                ELEMENT.Message.warning('请先选择要重命名的文件或文件夹');
                return;
            }
            var self = this;
            this.desktopBatchRename = {
                visible: true,
                winId: d.type === 'surface' ? '' : (d.id || ''),
                surface: d.type === 'surface',
                root: d.path,
                rows: rows.map(function (r) {
                    return { name: r.name, dir: !!r.dir };
                }),
                existingNames: (d.entries || []).map(function (r) { return r.name; }),
                mode: 'replace',
                find: '',
                replace: '',
                prefix: '',
                suffix: '',
                template: '文件_{n}',
                start: 1,
                padding: Math.max(2, String(rows.length).length),
                keepExt: true,
                saving: false,
                error: ''
            };
        },
        desktopBatchNameParts: function (name, dir) {
            var s = String(name || '');
            if (dir) {
                return { base: s, ext: '' };
            }
            var dot = s.lastIndexOf('.');
            if (dot <= 0 || dot === s.length - 1) {
                return { base: s, ext: '' };
            }
            return { base: s.substring(0, dot), ext: s.substring(dot) };
        },
        desktopBatchRenameName: function (row, index, form) {
            var parts = this.desktopBatchNameParts(row.name, row.dir);
            var base = parts.base;
            var ext = parts.ext;
            var newBase = base;
            if (form.mode === 'replace') {
                if (!form.find) {
                    return row.name;
                }
                newBase = base.split(form.find).join(form.replace == null ? '' : form.replace);
            } else if (form.mode === 'prefix') {
                newBase = (form.prefix || '') + base;
            } else if (form.mode === 'suffix') {
                newBase = base + (form.suffix || '');
            } else if (form.mode === 'sequence') {
                var template = String(form.template || '文件_{n}');
                var seq = (Number(form.start) || 1) + index;
                var pad = Math.max(1, Math.min(10, Number(form.padding) || 1));
                var num = String(seq);
                while (num.length < pad) {
                    num = '0' + num;
                }
                if (template.indexOf('{n}') < 0) {
                    template += '{n}';
                }
                newBase = template.split('{n}').join(num).split('{name}').join(base);
            }
            newBase = String(newBase || '').trim();
            var keepExt = form.mode !== 'sequence' || form.keepExt !== false;
            return newBase + (row.dir || !keepExt ? '' : ext);
        },
        desktopBatchRenameRow: function (row, index, form) {
            var newName = this.desktopBatchRenameName(row, index, form);
            return {
                name: row.name,
                dir: row.dir,
                newName: newName,
                changed: newName !== row.name,
                error: ''
            };
        },
        desktopValidateBatchRename: function (list, form) {
            var counts = {};
            var sources = {};
            var changedSources = {};
            var existing = {};
            (form.rows || []).forEach(function (r) {
                sources[String(r.name).toLowerCase()] = true;
            });
            list.forEach(function (r) {
                if (r.changed) {
                    changedSources[String(r.name).toLowerCase()] = true;
                }
            });
            (form.existingNames || []).forEach(function (n) {
                existing[n] = true;
            });
            list.forEach(function (r) {
                if (!r.newName) {
                    r.error = '名称不能为空';
                    return;
                }
                if (r.newName.indexOf('/') >= 0 || r.newName.indexOf('\\') >= 0) {
                    r.error = '名称不能包含斜杠';
                    return;
                }
                var key = r.newName.toLowerCase();
                counts[key] = (counts[key] || 0) + 1;
            });
            list.forEach(function (r) {
                if (r.error || !r.changed) {
                    return;
                }
                var key = r.newName.toLowerCase();
                if (counts[key] > 1) {
                    r.error = '多个文件将重命名为相同名称';
                    return;
                }
                for (var name in existing) {
                    if (name.toLowerCase() !== key) {
                        continue;
                    }
                    if (!sources[key]) {
                        r.error = '同名项目已存在';
                    } else if (!changedSources[key]) {
                        // 目标名属于一个不会改名的选中项，改名时会直接冲突
                        r.error = '目标名称与未重命名的项目重复';
                    }
                    break;
                }
            });
            return list;
        },
        runDesktopBatchRename: function () {
            var form = this.desktopBatchRename;
            var t = this.desktopTab;
            if (!t || (!t.local && !t.sessionId)) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            var self = this;
            var preview = this.desktopBatchRenamePreview;
            var changed = preview.filter(function (r) {
                return r.changed && !r.error;
            });
            if (!changed.length) {
                ELEMENT.Message.warning('没有需要重命名的项目');
                return;
            }
            form.saving = true;
            form.error = '';
            var targets = {};
            changed.forEach(function (r) {
                targets[r.newName] = true;
            });
            var used = {};
            (form.existingNames || []).forEach(function (n) { used[n] = true; });
            changed.forEach(function (r) {
                used[r.name] = true;
                used[r.newName] = true;
            });
            var stamp = Date.now().toString(36);
            var tempIndex = 0;
            var plan = changed.map(function (r) {
                var temp = '';
                if (targets[r.name]) {
                    do {
                        temp = '.__ds_rn_' + stamp + '_' + (++tempIndex) + '__';
                    } while (used[temp]);
                    used[temp] = true;
                }
                return { oldName: r.name, newName: r.newName, tempName: temp, failed: false };
            });
            var ok = 0;
            var fail = 0;
            var firstError = '';
            var recordError = function (err) {
                fail++;
                if (!firstError) {
                    firstError = (err && err.message) || '重命名失败';
                }
            };
            var chain = Promise.resolve();
            plan.forEach(function (item) {
                if (!item.tempName) {
                    return;
                }
                chain = chain.then(function () {
                    return self.renameDesktopPath(t, self.pathJoin(form.root, item.oldName), item.tempName)
                        .catch(function (err) {
                            item.failed = true;
                            recordError(err);
                        });
                });
            });
            plan.forEach(function (item) {
                chain = chain.then(function () {
                    if (item.failed) {
                        return null;
                    }
                    var source = item.tempName || item.oldName;
                    return self.renameDesktopPath(t, self.pathJoin(form.root, source), item.newName)
                        .then(function () {
                            ok++;
                        }).catch(function (err) {
                            recordError(err);
                        });
                });
            });
            chain.then(function () {
                form.saving = false;
                if (fail === 0) {
                    ELEMENT.Message.success('已重命名 ' + ok + ' 项');
                } else {
                    ELEMENT.Message.warning('批量重命名完成：成功 ' + ok + ' 项，失败 ' + fail + ' 项'
                        + (firstError ? '（' + firstError + '）' : ''));
                }
                self.desktopBatchRename.visible = false;
                self.desktopRefresh(form.surface ? { type: 'surface' } : self.desktopWindowById(form.winId));
            }).catch(function (err) {
                form.saving = false;
                form.error = (err && err.message) || '批量重命名失败';
            });
        },
        renameDesktopPath: function (tab, path, newName) {
            if (tab.local) {
                return http.post('/api/local/fs/rename', { path: path, newName: newName });
            }
            return http.post('/api/sftp/rename', {
                sessionId: tab.sessionId,
                path: path,
                newName: newName
            });
        },
        /* ---------- 资源管理器：校验和 ---------- */
        openDesktopChecksum: function (rows, win) {
            var d = win || this.desk;
            var t = this.desktopTab;
            var files = (rows || this.desktopSelectedRows(d)).filter(function (r) {
                return r && !r.dir;
            });
            if (!t || (!t.local && !t.sessionId) || !files.length) {
                ELEMENT.Message.info('请选择要计算校验和的文件');
                return;
            }
            var self = this;
            this.desktopChecksum = {
                visible: true,
                winId: d.type === 'surface' ? '' : (d.id || ''),
                algorithm: 'sha256',
                rows: files.map(function (r) {
                    return {
                        name: r.name,
                        path: self.desktopEntryPath(r, d),
                        value: '',
                        error: '',
                        loading: false
                    };
                }),
                loading: false,
                error: ''
            };
            this.$nextTick(function () {
                self.runDesktopChecksum();
            });
        },
        runDesktopChecksum: function () {
            var form = this.desktopChecksum;
            var t = this.desktopTab;
            if (!t || (!t.local && !t.sessionId) || !form.rows.length) {
                return;
            }
            var self = this;
            var alg = form.algorithm;
            form.loading = true;
            form.error = '';
            form.rows.forEach(function (row) {
                row.value = '';
                row.error = '';
                row.loading = true;
            });
            var chain = Promise.resolve();
            form.rows.forEach(function (row) {
                chain = chain.then(function () {
                    var req = t.local
                        ? http.get('/api/local/fs/checksum', {
                            params: { path: row.path, algorithm: alg }
                        })
                        : http.get('/api/files/checksum', {
                            params: {
                                sessionId: t.sessionId,
                                path: row.path,
                                algorithm: alg
                            }
                        });
                    return req.then(function (res) {
                        row.value = res && res.value ? res.value : '';
                        row.loading = false;
                    }).catch(function (err) {
                        row.loading = false;
                        row.error = (err && err.message) || '计算失败';
                    });
                });
            });
            chain.then(function () {
                form.loading = false;
            }).catch(function (err) {
                form.loading = false;
                form.error = (err && err.message) || '计算失败';
            });
        },
        desktopChecksumCopy: function (value) {
            if (!value) {
                return;
            }
            this.copyText(value);
            ELEMENT.Message.success('校验和已复制');
        },
        desktopShowProps: function (row, win) {
            var d = win || this.desk;
            var p = this.desktopEntryPath(row, d);
            var idx = p.lastIndexOf('/');
            this.desktop.props = {
                name: row.name,
                path: p,
                parent: idx <= 0 ? '/' : p.substring(0, idx),
                dir: !!row.dir,
                link: !!row.link,
                size: row.size,
                mtime: row.mtime,
                perms: row.perms,
                kind: this.desktopFileKind(row),
                ext: this.desktopExtLabel(row),
                typeText: this.desktopTypeText(row)
            };
            this.desktop.propsVisible = true;
        },
        desktopFileExt: function (name) {
            var s = String(name || '');
            var i = s.lastIndexOf('.');
            if (i <= 0 || i === s.length - 1) {
                return '';
            }
            return s.substring(i + 1).toLowerCase();
        },
        isDesktopImage: function (row) {
            return !!row && !row.dir && this.desktopFileKind(row) === 'img';
        },
        isDesktopThumbable: function (row) {
            return this.isDesktopImage(row) || this.isDesktopVideo(row);
        },
        isDesktopVideo: function (row) {
            return !!row && !row.dir && this.desktopFileKind(row) === 'video';
        },
        isDesktopAudio: function (row) {
            return !!row && !row.dir && this.desktopFileKind(row) === 'audio';
        },
        desktopPreviewable: function (row) {
            return this.isDesktopImage(row) || this.isDesktopVideo(row) || this.isDesktopAudio(row);
        },
        desktopPreviewLabel: function (row) {
            if (this.isDesktopAudio(row)) {
                return '播放音频';
            }
            return this.isDesktopVideo(row) ? '播放视频' : '预览';
        },
        desktopPreviewIcon: function (row) {
            if (this.isDesktopAudio(row)) {
                return 'el-icon-headset';
            }
            return this.isDesktopVideo(row) ? 'el-icon-video-play' : 'el-icon-picture-outline';
        },
        desktopFileKind: function (row) {
            if (row && row.dir) {
                return 'folder';
            }
            var e = this.desktopFileExt(row && row.name);
            if (!e) {
                return 'other';
            }
            if (['png', 'jpg', 'jpeg', 'jpe', 'jfif', 'gif', 'bmp', 'webp', 'svg', 'ico',
                'tif', 'tiff', 'avif', 'heic', 'heif'].indexOf(e) >= 0) {
                return 'img';
            }
            // .ts / .mts 也可能是 TypeScript 源码，不自动归为视频
            if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'f4v', 'ogv',
                'rmvb', 'rm', 'm2ts', 'mpg', 'mpeg', '3gp', 'asf'].indexOf(e) >= 0) {
                return 'video';
            }
            if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'].indexOf(e) >= 0) {
                return 'audio';
            }
            if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'zst', 'jar', 'war'].indexOf(e) >= 0) {
                return 'archive';
            }
            if (['js', 'ts', 'jsx', 'tsx', 'java', 'py', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'lua', 'sh', 'bash', 'zsh', 'sql', 'html', 'htm', 'css', 'scss', 'less', 'vue', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'properties'].indexOf(e) >= 0) {
                return 'code';
            }
            if (['txt', 'log', 'md', 'markdown', 'csv', 'tsv', 'rst'].indexOf(e) >= 0) {
                return 'text';
            }
            if (e === 'pdf') {
                return 'pdf';
            }
            if (['doc', 'docx', 'rtf', 'odt'].indexOf(e) >= 0) {
                return 'doc';
            }
            if (['xls', 'xlsx', 'ods'].indexOf(e) >= 0) {
                return 'sheet';
            }
            if (['ppt', 'pptx', 'odp', 'key'].indexOf(e) >= 0) {
                return 'slides';
            }
            if (['exe', 'msi', 'dll', 'so', 'bin', 'deb', 'rpm', 'apk', 'appimage', 'dmg', 'iso'].indexOf(e) >= 0) {
                return 'exec';
            }
            return 'other';
        },
        desktopExtLabel: function (row) {
            if (row && row.dir) {
                return '';
            }
            var e = this.desktopFileExt(row && row.name);
            if (!e) {
                return 'FILE';
            }
            var u = e.toUpperCase();
            return u.length > 5 ? u.slice(0, 5) : u;
        },
        desktopTypeText: function (row) {
            if (row && row.dir) {
                return row.link ? '文件夹（符号链接）' : '文件夹';
            }
            var kindMap = {
                img: '图片', video: '视频', audio: '音频', archive: '压缩包',
                code: '源代码', text: '文本文件', pdf: 'PDF 文档', doc: 'Word 文档',
                sheet: '表格', slides: '演示文稿', exec: '可执行文件 / 安装包', other: '文件'
            };
            var e = this.desktopFileExt(row && row.name);
            var kind = kindMap[this.desktopFileKind(row)] || '文件';
            return (e ? e.toUpperCase() + ' ' : '') + kind + (row && row.link ? '（符号链接）' : '');
        },
        desktopNewFolder: function (win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            if (!t || (!t.local && !t.sessionId)) {
                ELEMENT.Message.warning('桌面尚未就绪，请稍后再试');
                return;
            }
            var self = this;
            this.$prompt('请输入文件夹名称', '新建文件夹', {
                inputPattern: /^[^/\\]+$/,
                inputErrorMessage: '名称不合法'
            }).then(function (result) {
                var name = (result.value || '').trim();
                if (!name) {
                    return null;
                }
                var mkdirReq = t.local
                    ? http.post('/api/local/fs/mkdir', { path: self.pathJoin(d.path, name) })
                    : http.post('/api/sftp/mkdir', {
                        sessionId: t.sessionId,
                        path: self.pathJoin(d.path, name)
                    });
                return mkdirReq.then(function () {
                    ELEMENT.Message.success('已创建文件夹：' + name);
                    self.desktopRefresh(d);
                });
            }).catch(function () { /* 取消或失败（已提示） */ });
        },
        desktopNewFile: function (win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            if (!t || (!t.local && !t.sessionId)) {
                ELEMENT.Message.warning('桌面尚未就绪，请稍后再试');
                return;
            }
            var self = this;
            this.$prompt('请输入文件名（如 notes.txt）', '新建文件', {
                inputPattern: /^[^/\\]+$/,
                inputErrorMessage: '文件名不合法'
            }).then(function (result) {
                var name = (result.value || '').trim();
                if (!name) {
                    return null;
                }
                var path = self.pathJoin(d.path, name);
                var touchReq = t.local
                    ? http.post('/api/local/fs/touch', { path: path })
                    : http.post('/api/sftp/touch', {
                        sessionId: t.sessionId,
                        path: path
                    });
                return touchReq.then(function () {
                    ELEMENT.Message.success('已创建 ' + name);
                    self.desktopRefresh(d);
                    self.openDesktopEditorWindow(t, path);
                });
            }).catch(function () { /* 取消或失败（已提示） */ });
        },
        /* 桌面中的文件编辑：复用“文本编辑器”应用窗口（终端工作台仍使用弹窗） */
        openDesktopEditorApp: function () {
            if (!this.desktop.visible) {
                return null;
            }
            var w = this.desktopEditorWindow;
            if (w) {
                this.restoreDesktopWindow(w);
                return w;
            }
            w = this.addDesktopWindow('editor');
            w.editorPath = '';
            w.editorTitle = '文本编辑器';
            w.editorSubtitle = '未命名';
            w.editorDirty = false;
            w.editorPendingPath = '';
            w.editorPendingSeq = 0;
            var area = this.desktopWindowWorkArea();
            var width = Math.min(area.width - 20, Math.max(760, Math.round(area.width * 0.82)));
            var height = Math.min(area.height - 20, Math.max(480, Math.round(area.height * 0.88)));
            width = Math.max(Math.min(520, area.width), width);
            height = Math.max(Math.min(320, area.height), height);
            this.applyDesktopWindowGeometry(w, {
                x: Math.round((area.width - width) / 2),
                y: Math.round((area.height - height) / 2),
                w: width,
                h: height
            });
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
            return w;
        },
        openDesktopEditorWindow: function (tab, path) {
            tab = tab || this.desktopTab;
            if (!this.desktop.visible) {
                if (tab && path && tab.sessionId) {
                    this.openRemoteEdit(tab, path);
                }
                return null;
            }
            var w = this.desktopEditorWindow;
            if (!w) {
                w = this.openDesktopEditorApp();
            } else {
                this.restoreDesktopWindow(w);
            }
            if (w && path) {
                w.editorPendingPath = path;
                w.editorPendingSeq = (w.editorPendingSeq || 0) + 1;
            }
            return w;
        },
        onDesktopEditorSaved: function (payload) {
            var path = payload && payload.path;
            if (!path) {
                return;
            }
            var dir = path.substring(0, path.lastIndexOf('/')) || '/';
            var t = this.desktopTab;
            if (t && t.sftpPath) {
                var p = String(t.sftpPath).replace(/\/+$/, '') || '/';
                if (p === dir) {
                    this.loadDir(t.sftpPath, t);
                }
            }
            if (this.desktop.visible) {
                var self = this;
                this.desktop.windows.forEach(function (w) {
                    if (w.type !== 'explorer') {
                        return;
                    }
                    var p = String(w.path || '').replace(/\/+$/, '') || '/';
                    if (p === dir) {
                        self.desktopRefresh(w);
                    }
                });
                var surfaceDir = String(this.desktop.surface.dir || '').replace(/\/+$/, '') || '/';
                if (surfaceDir === dir) {
                    this.refreshDesktopSurface();
                }
            }
        },
        desktopOpenEdit: function (row, win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            if (!t || (!t.local && !t.sessionId) || !row) {
                return;
            }
            this.openDesktopEditorWindow(t, this.desktopEntryPath(row, d));
        },
        desktopOpenTerminal: function (row, win) {
            var d = win || this.desk;
            var dir = d.path || this.desktop.surface.dir || '/';
            if (row) {
                dir = row.dir ? this.desktopEntryPath(row, d) : (d.path || '/');
            }
            this.openDesktopTerminalWindow(dir);
        },
        pickDesktopUpload: function (win) {
            var d = win || this.desk;
            this._deskUploadWinId = d.type === 'surface' ? '' : d.id;
            this._deskUploadSurface = d.type === 'surface';
            this._deskUploadDir = d.path || this.desktop.surface.dir;
            var el = this.$refs.desktopUpload;
            if (el) {
                el.value = '';
                el.click();
            }
        },
        onDesktopUploadPick: function (ev) {
            var input = ev.target;
            var files = [];
            for (var i = 0; input.files && i < input.files.length; i++) {
                files.push(input.files[i]);
            }
            input.value = '';
            var surface = this._deskUploadSurface;
            var d = this.desktopWindowById(this._deskUploadWinId) || this.desk;
            var win = surface
                ? { id: '__surface__', type: 'surface',
                    path: this._deskUploadDir || this.desktop.surface.dir }
                : d;
            var dir = surface ? (this._deskUploadDir || this.desktop.surface.dir) : d.path;
            this.desktopUploadFiles(files, dir, win);
            this._deskUploadSurface = false;
            this._deskUploadWinId = '';
            this._deskUploadDir = '';
        },
        desktopUploadFiles: function (files, destDir, win) {
            if (!files || !files.length) {
                return Promise.resolve();
            }
            var t = this.desktopTab;
            var d = win || this.desk;
            if (!t || (!t.local && !t.sessionId)) {
                ELEMENT.Message.warning('桌面尚未就绪，请稍后再试');
                return Promise.reject(new Error('session not ready'));
            }
            var self = this;
            var dir = destDir || d.path;
            var loading = ELEMENT.Message({
                message: '正在上传 ' + files.length + ' 个文件到 ' + dir + ' …',
                duration: 0,
                iconClass: 'el-icon-loading'
            });
            var ok = 0;
            var fail = 0;
            var chain = Promise.resolve();
            files.forEach(function (f) {
                chain = chain.then(function () {
                    return self.uploadOne(t, dir, f).then(function () {
                        ok++;
                    }).catch(function () {
                        fail++;
                    });
                });
            });
            return chain.then(function () {
                loading.close();
                d.fileDragOver = false;
                self._deskDragDepth = 0;
                if (fail === 0) {
                    ELEMENT.Message.success(files.length === 1
                        ? ('文件上传成功：' + files[0].name)
                        : ('文件上传成功：' + files.length + ' 个文件 → ' + dir));
                    self.pushDesktopNotice('success', '上传完成',
                        files.length === 1 ? files[0].name : (files.length + ' 个文件 → ' + dir), 'transfers');
                } else if (ok > 0) {
                    ELEMENT.Message.warning('上传完成：成功 ' + ok + ' 个，失败 ' + fail + ' 个');
                    self.pushDesktopNotice('warning', '上传部分失败',
                        '成功 ' + ok + ' 个，失败 ' + fail + ' 个 → ' + dir, 'transfers');
                } else {
                    ELEMENT.Message.error('上传失败');
                    self.pushDesktopNotice('error', '上传失败', dir, 'transfers');
                }
                self.desktopRefresh(d);
            });
        },
        desktopAutoScroll: function (ev, win) {
            var el = this.deskFilesEl(win || this.desk);
            if (!el || !ev) {
                return;
            }
            var r = el.getBoundingClientRect();
            var edge = 46;
            var sp = 0;
            if (ev.clientY - r.top < edge) {
                sp = -Math.ceil((edge - (ev.clientY - r.top)) / 3);
            } else if (r.bottom - ev.clientY < edge) {
                sp = Math.ceil((edge - (r.bottom - ev.clientY)) / 3);
            }
            this._deskScrollSpeed = Math.max(-18, Math.min(18, sp));
            if (sp && !this._deskScrollTimer) {
                var self = this;
                var scrollWin = win || this.desk;
                this._deskScrollTimer = setInterval(function () {
                    var sc = self.deskFilesEl(scrollWin);
                    if (!sc || !self._deskScrollSpeed) {
                        clearInterval(self._deskScrollTimer);
                        self._deskScrollTimer = null;
                        return;
                    }
                    sc.scrollTop += self._deskScrollSpeed;
                }, 16);
            }
        },
        stopDesktopDragScroll: function () {
            this._deskScrollSpeed = 0;
            if (this._deskScrollTimer) {
                clearInterval(this._deskScrollTimer);
                this._deskScrollTimer = null;
            }
        },
        onDesktopDragStart: function (ev, row) {
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                ev.preventDefault();
                return;
            }
            var d = this.desk;
            if (!this.isDesktopSelected(row)) {
                d.selected = [row.name];
                d.lastSelected = row.name;
            }
            var rows = this.desktopTargetRows();
            if (!rows.length) {
                rows = [row];
            }
            var self = this;
            var paths = rows.map(function (r) { return self.desktopEntryPath(r, d); });
            d.dragNames = rows.map(function (r) { return r.name; });
            this._deskFileDrag = {
                win: d,
                names: d.dragNames.slice(),
                paths: paths
            };
            this.desktop.menu.visible = false;
            if (ev.dataTransfer) {
                ev.dataTransfer.effectAllowed = 'copyMove';
                try {
                    ev.dataTransfer.setData('text/plain', paths[0] || '');
                    ev.dataTransfer.setData('application/x-deepshell-paths', JSON.stringify(paths));
                } catch (e) { /* ignore */ }
            }
        },
        onDesktopDragEnd: function () {
            this.desktop.windows.forEach(function (w) {
                w.dragNames = [];
                w.dropTarget = '';
                w.winDragOver = false;
                w.fileDragOver = false;
            });
            this.desktop.wallDropActive = false;
            this._deskFileDrag = null;
            this.stopDesktopDragScroll();
        },
        onDesktopDragOver: function (ev, row, win) {
            var d = win || this.desk;
            var extFiles = this.hasFileDrag(ev);
            if (extFiles) {
                if (ev.dataTransfer) {
                    ev.dataTransfer.dropEffect = 'copy';
                }
                d.dropTarget = row && row.dir ? row.name : '';
                d.winDragOver = false;
                d.fileDragOver = true;
                this.desktopAutoScroll(ev, d);
                return;
            }
            var drag = this._deskFileDrag;
            if (!drag || !drag.names.length) {
                return;
            }
            // 悬停在文件夹上时只高亮该文件夹，隐藏整窗提示
            d.winDragOver = false;
            if (!row || !row.dir || drag.names.indexOf(row.name) >= 0) {
                d.dropTarget = '';
                return;
            }
            var destPath = this.desktopEntryPath(row, d);
            var invalid = drag.paths.some(function (src) {
                return destPath === src || destPath.indexOf(src + '/') === 0;
            });
            if (invalid) {
                d.dropTarget = '';
                if (ev.dataTransfer) {
                    ev.dataTransfer.dropEffect = 'none';
                }
                return;
            }
            d.dropTarget = row.name;
            if (ev.dataTransfer) {
                ev.dataTransfer.dropEffect = 'copy';
            }
            this.desktopAutoScroll(ev, d);
        },
        onDesktopDragLeave: function (row, win) {
            var d = win || this.desk;
            if (row && d.dropTarget === row.name) {
                d.dropTarget = '';
            }
            if (row && d.fileDragOver) {
                d.fileDragOver = false;
            }
            if (row) {
                d.winDragOver = false;
            }
        },
        onDesktopDrop: function (ev, row, win) {
            var d = win || this.desk;
            var files = [];
            if (ev.dataTransfer && ev.dataTransfer.files) {
                for (var i = 0; i < ev.dataTransfer.files.length; i++) {
                    files.push(ev.dataTransfer.files[i]);
                }
            }
            var destDir = row && row.dir ? this.desktopEntryPath(row, d) : d.path;
            d.dropTarget = '';
            d.winDragOver = false;
            d.fileDragOver = false;
            this._deskDragDepth = 0;
            this.stopDesktopDragScroll();
            if (files.length) {
                ev.preventDefault();
                ev.stopPropagation();
                this.desktop.windows.forEach(function (w) {
                    w.dragNames = [];
                });
                this._deskFileDrag = null;
                this.desktopUploadFiles(files, destDir, d);
                return;
            }
            var drag = this._deskFileDrag;
            if (!drag || !drag.names.length) {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            drag.win.dragNames = [];
            this._deskFileDrag = null;
            if (!destDir) {
                ELEMENT.Message.warning('目标目录尚未就绪，请稍后再试');
                return;
            }
            // 拖回原窗口的原目录：没有可执行的操作
            if (drag.win === d && this.trimSlash(destDir) === this.trimSlash(d.path)) {
                return;
            }
            var self = this;
            var sameParent = drag.paths.every(function (src) {
                return self.trimSlash(src.substring(0, src.lastIndexOf('/')) || '/')
                    === self.trimSlash(destDir);
            });
            if (sameParent) {
                ELEMENT.Message.info('文件已在该目录中');
                return;
            }
            var invalid = drag.paths.some(function (src) {
                return destDir === src || destDir.indexOf(src + '/') === 0;
            });
            if (invalid) {
                ELEMENT.Message.warning('不能把文件夹复制或移动到自身或其子目录');
                return;
            }
            this.openDesktopDropDialog({
                paths: drag.paths.slice(),
                names: drag.names.slice(),
                win: drag.win,
                targetWin: d,
                dest: destDir,
                title: '复制或剪切文件',
                fromSurface: !!drag.fromSurface
            });
        },
        onDesktopSurfaceDragOver: function (ev, win) {
            var d = win || this.desk;
            if (this.hasFileDrag(ev)) {
                ev.preventDefault();
                d.dropTarget = '';
                d.winDragOver = false;
                d.fileDragOver = true;
                this.desktopAutoScroll(ev, d);
                return;
            }
            var drag = this._deskFileDrag;
            if (!drag || !drag.names.length) {
                return;
            }
            // 允许把窗口内的文件拖到另一个窗口的空白处
            ev.preventDefault();
            if (ev.dataTransfer) {
                ev.dataTransfer.dropEffect = 'copy';
            }
            d.dropTarget = '';
            d.fileDragOver = false;
            d.winDragOver = drag.win !== d;
            this.desktopAutoScroll(ev, d);
        },
        onDesktopSurfaceDrop: function (ev, win) {
            var d = win || this.desk;
            var files = [];
            if (ev.dataTransfer && ev.dataTransfer.files) {
                for (var i = 0; i < ev.dataTransfer.files.length; i++) {
                    files.push(ev.dataTransfer.files[i]);
                }
            }
            d.dropTarget = '';
            d.winDragOver = false;
            d.fileDragOver = false;
            this._deskDragDepth = 0;
            this.stopDesktopDragScroll();
            if (files.length) {
                ev.preventDefault();
                ev.stopPropagation();
                this.desktopUploadFiles(files, d.path, d);
                return;
            }
            var drag = this._deskFileDrag;
            if (!drag || !drag.names.length) {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            drag.win.dragNames = [];
            this._deskFileDrag = null;
            // 同窗口空白处松开：保持原状
            if (drag.win === d || !d.path) {
                return;
            }
            var self = this;
            var sameParent = drag.paths.every(function (src) {
                return self.trimSlash(src.substring(0, src.lastIndexOf('/')) || '/')
                    === self.trimSlash(d.path);
            });
            if (sameParent) {
                ELEMENT.Message.info('文件已在该目录中');
                return;
            }
            var invalid = drag.paths.some(function (src) {
                return d.path === src || d.path.indexOf(src + '/') === 0;
            });
            if (invalid) {
                ELEMENT.Message.warning('不能把文件夹复制或移动到自身或其子目录');
                return;
            }
            this.openDesktopDropDialog({
                paths: drag.paths.slice(),
                names: drag.names.slice(),
                win: drag.win,
                targetWin: d,
                dest: d.path,
                title: '复制或剪切文件',
                fromSurface: !!drag.fromSurface
            });
        },
        onDesktopSurfaceDragLeave: function (ev, win) {
            var d = win || this.desk;
            var el = ev && ev.currentTarget;
            // 在子元素之间移动不算离开窗口
            if (el && ev.relatedTarget && el.contains(ev.relatedTarget)) {
                return;
            }
            d.dropTarget = '';
            d.winDragOver = false;
            d.fileDragOver = false;
            this.stopDesktopDragScroll();
        },
        /* 窗口级拖放：工具栏、侧栏、状态栏等文件区之外的位置也接收窗口内拖拽 */
        onDesktopWindowDragOver: function (ev, win) {
            if (win.type !== 'explorer' || this.hasFileDrag(ev)) {
                return;
            }
            var drag = this._deskFileDrag;
            if (!drag || !drag.names.length) {
                return;
            }
            ev.preventDefault();
            if (ev.dataTransfer) {
                ev.dataTransfer.dropEffect = 'copy';
            }
            win.winDragOver = drag.win !== win;
        },
        onDesktopWindowDragLeave: function (ev, win) {
            var el = ev && ev.currentTarget;
            if (el && ev.relatedTarget && el.contains(ev.relatedTarget)) {
                return;
            }
            win.winDragOver = false;
        },
        onDesktopWindowDrop: function (ev, win) {
            if (win.type !== 'explorer' || this.hasFileDrag(ev)) {
                // 本机文件：由文件区的上传逻辑处理
                return;
            }
            var drag = this._deskFileDrag;
            if (!drag || !drag.names.length) {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            drag.win.dragNames = [];
            this._deskFileDrag = null;
            win.winDragOver = false;
            if (drag.win === win || !win.path) {
                return;
            }
            var self = this;
            var sameParent = drag.paths.every(function (src) {
                return self.trimSlash(src.substring(0, src.lastIndexOf('/')) || '/')
                    === self.trimSlash(win.path);
            });
            if (sameParent) {
                ELEMENT.Message.info('文件已在该目录中');
                return;
            }
            var invalid = drag.paths.some(function (src) {
                return win.path === src || win.path.indexOf(src + '/') === 0;
            });
            if (invalid) {
                ELEMENT.Message.warning('不能把文件夹复制或移动到自身或其子目录');
                return;
            }
            this.openDesktopDropDialog({
                paths: drag.paths.slice(),
                names: drag.names.slice(),
                win: drag.win,
                targetWin: win,
                dest: win.path,
                title: '复制或剪切文件',
                fromSurface: !!drag.fromSurface
            });
        },
        /* ---------- 从资源管理器拖到桌面 ---------- */
        onDesktopWallDragOver: function (ev) {
            if (this.hasFileDrag(ev)) {
                return;
            }
            var drag = this._deskFileDrag;
            if (!drag || !drag.names || !drag.names.length) {
                return;
            }
            ev.preventDefault();
            if (ev.dataTransfer) {
                ev.dataTransfer.dropEffect = 'copy';
            }
            this.desktop.wallDropActive = true;
        },
        onDesktopWallDragLeave: function () {
            this.desktop.wallDropActive = false;
        },
        onDesktopWallDrop: function (ev) {
            if (this.hasFileDrag(ev)) {
                // 从本机拖入的文件仍交给全局上传逻辑
                return;
            }
            var drag = this._deskFileDrag;
            if (!drag || !drag.names || !drag.names.length) {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            this.desktop.wallDropActive = false;
            if (drag.win) {
                drag.win.dragNames = [];
            }
            this._deskFileDrag = null;
            var dest = this.desktop.surface.dir;
            if (!dest) {
                ELEMENT.Message.warning('桌面目录尚未就绪，请稍后再试');
                return;
            }
            if (drag.fromSurface) {
                // 从桌面拖回桌面本身：保持原状
                return;
            }
            var self = this;
            var sameParent = drag.paths.every(function (src) {
                return self.trimSlash(src.substring(0, src.lastIndexOf('/')) || '/')
                    === self.trimSlash(dest);
            });
            if (sameParent) {
                ELEMENT.Message.info('文件已在该目录中');
                return;
            }
            this.openDesktopDropDialog({
                paths: drag.paths.slice(),
                names: drag.names.slice(),
                win: drag.win,
                targetWin: null,
                dest: dest,
                title: '放到桌面',
                isDesktop: true,
                fromSurface: !!drag.fromSurface
            });
        },
        openDesktopDropDialog: function (opts) {
            this.desktopDropDialog = {
                visible: true,
                paths: (opts.paths || []).slice(),
                names: (opts.names || []).slice(),
                win: opts.win || null,
                targetWin: opts.targetWin || null,
                dest: opts.dest || '',
                title: opts.title || '复制或剪切文件',
                isDesktop: !!opts.isDesktop,
                fromSurface: !!opts.fromSurface,
                busy: false
            };
        },
        applyDesktopDrop: function (mode) {
            var dd = this.desktopDropDialog;
            if (!dd || !dd.paths || !dd.paths.length || dd.busy) {
                return;
            }
            var t = this.desktopTab;
            if (!t || (!t.local && !t.sessionId)) {
                ELEMENT.Message.warning('桌面尚未就绪，请稍后再试');
                return;
            }
            var self = this;
            dd.busy = true;
            var finish = function () {
                dd.busy = false;
                dd.visible = false;
            };
            if (mode === 'cut') {
                Promise.resolve()
                    .then(function () {
                        return self.desktopMoveTo(dd.paths.slice(), dd.dest, dd.win, dd.targetWin, true);
                    })
                    .then(function () {
                        if (dd.isDesktop || dd.fromSurface) {
                            self.loadDesktopSurface();
                        }
                    })
                    .then(finish)
                    .catch(finish);
                return;
            }
            var copyReq = t.local
                ? http.post('/api/local/fs/copy', { destDir: dd.dest, paths: dd.paths.slice() })
                : http.post('/api/sftp/copy', {
                    sessionId: t.sessionId,
                    destDir: dd.dest,
                    paths: dd.paths.slice()
                });
            copyReq.then(function () {
                ELEMENT.Message.success('已复制 ' + dd.names.length + ' 项到 '
                    + (dd.isDesktop ? '桌面' : dd.dest));
                if (dd.targetWin && self.desktop.windows.indexOf(dd.targetWin) >= 0) {
                    self.desktopRefresh(dd.targetWin);
                } else if (dd.isDesktop) {
                    self.loadDesktopSurface();
                }
            }).catch(function () { /* 已提示 */ })
                .then(finish);
        },
        desktopMoveTo: function (sources, destDir, win, targetWin, confirmed) {
            var t = this.desktopTab;
            var d = win || this.desk;
            var target = targetWin || d;
            if (!t || (!t.local && !t.sessionId) || !sources.length) {
                return Promise.resolve();
            }
            var self = this;
            var dest = this.trimSlash(destDir);
            var parentSame = sources.every(function (src) {
                return self.trimSlash(src.substring(0, src.lastIndexOf('/')) || '/') === dest;
            });
            if (parentSame) {
                ELEMENT.Message.info('文件已在该目录中');
                return Promise.resolve();
            }
            var invalid = sources.filter(function (src) {
                return dest === src || dest.indexOf(src + '/') === 0;
            });
            if (invalid.length) {
                ELEMENT.Message.warning('不能把文件夹移动到自身或其子目录');
                return Promise.resolve();
            }
            var names = sources.map(function (src) {
                return src.substring(src.lastIndexOf('/') + 1);
            });
            var label = names.length === 1 ? ('「' + names[0] + '」') : (names.length + ' 个项目');
            var perform = function () {
                var chain = Promise.resolve();
                var ok = 0;
                var fail = 0;
                sources.forEach(function (src) {
                    chain = chain.then(function () {
                        var moveReq = t.local
                            ? http.post('/api/local/fs/move', { path: src, destDir: dest })
                            : http.post('/api/sftp/move', {
                                sessionId: t.sessionId,
                                path: src,
                                destDir: dest
                            });
                        return moveReq.then(function () {
                            ok++;
                        }).catch(function () {
                            fail++;
                        });
                    });
                });
                return chain.then(function () {
                    if (fail === 0) {
                        ELEMENT.Message.success('已移动 ' + ok + ' 项到 ' + dest);
                    } else {
                        ELEMENT.Message.warning('移动完成：成功 ' + ok + ' 项，失败 ' + fail + ' 项');
                    }
                    if (self.desktop.windows.indexOf(d) >= 0) {
                        d.selected = [];
                        d.lastSelected = '';
                        self.desktopRefresh(d);
                    }
                    if (target !== d) {
                        if (self.desktop.windows.indexOf(target) >= 0) {
                            target.selected = [];
                            target.lastSelected = '';
                            self.desktopRefresh(target);
                        } else if (target && target.type === 'surface') {
                            self.refreshDesktopSurface();
                        }
                    }
                });
            };
            if (confirmed) {
                return perform();
            }
            this.$confirm(
                '即将把' + label + '移动到目录：「' + dest + '」，移动后原位置将不再保留。',
                '确认移动文件',
                { type: 'warning', confirmButtonText: '确认移动', cancelButtonText: '取消' }
            ).then(perform).catch(function () { /* 取消或失败（已提示） */ });
        },
        onDesktopSideButton: function (e) {
            var active = this.desktopWindowById(this.desktop.activeWinId);
            if (!this.desktop.visible || !active || active.type !== 'explorer'
                    || (e.button !== 3 && e.button !== 4)) {
                return;
            }
            // 侧键在桌面内接管为目录前进/后退，阻止浏览器自身的页面历史导航
            e.preventDefault();
            if (e.type === 'mousedown') {
                return;
            }
            var now = Date.now();
            if (e.type === 'auxclick' && this._sideNavButton === e.button
                    && now - (this._sideNavAt || 0) < 600) {
                return;
            }
            this._sideNavAt = now;
            this._sideNavButton = e.button;
            this.cancelDesktopMarquee();
            if (this.desktop.settingsVisible || this.desktop.startOpen || this.desk.pathEditing
                    || this.desktop.menu.visible || this.hasDesktopDialogOpen()) {
                return;
            }
            if (e.button === 3) {
                this.desktopGoBack();
            } else {
                this.desktopGoForward();
            }
        },
        onDesktopKeydown: function (e) {
            if (!this.desktop.visible) {
                return;
            }
            this.touchDesktopActivity();
            // 窗口切换：Alt+Tab 正/反向；部分系统会占用 Alt+Tab，可用 Alt+` 作为网页内替代
            if (e.altKey && !e.ctrlKey && !e.metaKey
                    && (e.key === 'Tab' || e.keyCode === 9)) {
                e.preventDefault();
                e.stopPropagation();
                this.cycleDesktopWindows(e.shiftKey ? -1 : 1);
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey
                    && String(e.key || '').toLowerCase() === 'k') {
                e.preventDefault();
                e.stopPropagation();
                if (this.desktop.startOpen) {
                    this.desktop.startOpen = false;
                } else {
                    this.openDesktopStart();
                }
                return;
            }
            if (this.desktopAppProps.visible) {
                if (e.key === 'Escape') {
                    this.closeDesktopAppProperties();
                    e.preventDefault();
                }
                return;
            }
            if (e.key === 'Escape' && this._marquee) {
                this.cancelDesktopMarquee();
                e.preventDefault();
                return;
            }
            if (e.key === 'Escape' && this.desktop.notifOpen) {
                this.desktop.notifOpen = false;
                e.preventDefault();
                return;
            }
            if (e.key === 'Escape' && this.desktop.calendarOpen) {
                this.desktop.calendarOpen = false;
                e.preventDefault();
                return;
            }
            if (e.key === 'Escape' && this.taskmgr.detail.overlayVisible) {
                this.closeTaskmgrProcessDetail();
                e.preventDefault();
                return;
            }
            if (e.key === 'Escape' && this.taskmgr.runVisible) {
                this.taskmgr.runVisible = false;
                e.preventDefault();
                return;
            }
            if (e.key === 'Escape' && this.taskmgr.ctxMenu.visible) {
                this.taskmgr.ctxMenu.visible = false;
                e.preventDefault();
                return;
            }
            if (e.key === 'Escape' && this.desktop.taskbarMenu.visible) {
                this.desktop.taskbarMenu.visible = false;
                e.preventDefault();
                return;
            }
            if (this.desktop.settingsVisible) {
                if (e.key === 'Escape') {
                    // 有子弹窗时交给 Element 自己关闭，避免连同设置面板一起关掉
                    var subDialog = this.fontVisible || this.bgVisible || this.aiSetVisible
                        || this.lanVisible || this.authSetVisible || this.aboutVisible
                        || this.sysInfoVisible || this.connectDialogVisible || this.helpVisible
                        || this.sponsorVisible
                        || this.hotkeyVisible;
                    if (!subDialog) {
                        this.closeDesktopSettings();
                        e.preventDefault();
                    }
                }
                return;
            }
            var tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
            var typing = tag === 'input' || tag === 'textarea'
                || (e.target && e.target.isContentEditable);
            if (e.key === 'Escape') {
                if (this.desktop.compressSub.visible || this.desktop.downloadSub.visible) {
                    this.closeDesktopSubMenus();
                    e.preventDefault();
                } else if (this.desktop.taskMenu.visible) {
                    this.desktop.taskMenu.visible = false;
                    e.preventDefault();
                } else if (this.desktop.iconMenu.visible) {
                    this.desktop.iconMenu.visible = false;
                    e.preventDefault();
                } else if (this.desktop.trashMenu.visible) {
                    this.desktop.trashMenu.visible = false;
                    e.preventDefault();
                } else if (this.desktop.menu.visible) {
                    this.desktop.menu.visible = false;
                    e.preventDefault();
                } else if (this.desktop.startOpen) {
                    this.desktop.startOpen = false;
                    e.preventDefault();
                } else if (this.desk.pathEditing) {
                    this.desk.pathEditing = false;
                    e.preventDefault();
                }
                return;
            }
            if (typing) {
                return;
            }
            if (e.altKey && !e.ctrlKey && !e.metaKey
                    && (e.key === '`' || e.code === 'Backquote')) {
                e.preventDefault();
                e.stopPropagation();
                this.cycleDesktopWindows(e.shiftKey ? -1 : 1);
                return;
            }
            // 任务管理器激活时屏蔽桌面文件快捷键，避免误操作资源管理器
            var focusedWin = this.desktopWindowById(this.desktop.activeWinId);
            if (focusedWin && focusedWin.type === 'taskmgr') {
                return;
            }
            // 桌面背景图标与资源管理器窗口各自维护选中项，按键跟随最近一次点击的上下文
            var surfaceFocused = !!this.desktop.focusSurface;
            var surfaceItems = surfaceFocused ? this.desktopSelectedIconItems() : [];
            var surfaceRows = [];
            surfaceItems.forEach(function (it) {
                if (it.entry) {
                    surfaceRows.push(it.entry);
                }
            });
            var surfaceWin = surfaceFocused ? this.desktopSurfaceContextWin() : null;
            var active = this.desktopWindowById(this.desktop.activeWinId);
            var win = active && active.type === 'explorer' ? active : null;
            var selected = win && !surfaceFocused ? this.desktopSelectedRows(win) : [];
            if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                if (win && !surfaceFocused) {
                    if (e.key === 'ArrowLeft') {
                        this.desktopGoBack();
                    } else {
                        this.desktopGoForward();
                    }
                }
                e.preventDefault();
            } else if (e.key === 'F2') {
                e.preventDefault();
                if (surfaceRows.length === 1) {
                    this.desktopRename(surfaceRows[0], surfaceWin);
                } else if (selected.length === 1) {
                    this.desktopRename(selected[0], win);
                }
            } else if (e.key === 'Delete' || e.key === 'Del') {
                if (surfaceRows.length) {
                    e.preventDefault();
                    this.desktopDeleteRows(surfaceRows, surfaceWin, e.shiftKey);
                } else if (selected.length) {
                    e.preventDefault();
                    this.desktopDeleteRows(selected, win, e.shiftKey);
                }
            } else if (e.key === 'Enter') {
                if (surfaceItems.length === 1) {
                    e.preventDefault();
                    this.openDesktopIcon(surfaceItems[0]);
                } else if (selected.length === 1) {
                    e.preventDefault();
                    this.desktopOpenEntry(selected[0], win);
                }
            } else if (e.key === 'Backspace') {
                e.preventDefault();
                if (win && !surfaceFocused) {
                    this.desktopUp();
                }
            } else if (e.key === 'F5') {
                e.preventDefault();
                if (surfaceFocused) {
                    this.desktopRefresh(surfaceWin);
                } else if (win) {
                    this.desktopRefresh(win);
                }
            } else if (e.ctrlKey || e.metaKey) {
                var key = String(e.key || '').toLowerCase();
                var rows = surfaceRows.length ? surfaceRows : selected;
                var targetWin = surfaceRows.length ? surfaceWin : win;
                if ((key === 'x' || key === 'c') && rows.length) {
                    e.preventDefault();
                    if (key === 'x') {
                        this.cutDesktopRows(rows, targetWin);
                    } else {
                        this.copyDesktopRows(rows, targetWin);
                    }
                } else if (key === 'v' && (surfaceFocused || win) && this.canPasteDesktop) {
                    e.preventDefault();
                    this.pasteDesktop(surfaceFocused ? surfaceWin : win);
                } else if (key === 'a') {
                    if (surfaceFocused) {
                        e.preventDefault();
                        this.selectAllDesktopIcons();
                    } else if (win) {
                        e.preventDefault();
                        this.desktopSelectAll(win);
                    }
                }
            }
        },
        onAiDesktopMaybeRefresh: function (t, conv) {
            if (!this.desktop.visible || this.desktopTab !== t
                    || !conv || !conv.cwd) {
                return;
            }
            var self = this;
            this.desktop.windows.forEach(function (w) {
                if (w.path === conv.cwd) {
                    self.desktopRefresh(w);
                }
            });
        },

        /* ---------- 任务栏时钟与日历 ---------- */
        desktopDateKey: function (d) {
            var p = function (x) { return (x < 10 ? '0' : '') + x; };
            return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        },
        parseDesktopDateKey: function (key) {
            var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
            if (!m) {
                return new Date();
            }
            return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        },
        toggleDesktopCalendar: function () {
            if (this.desktop.calendarOpen) {
                this.desktop.calendarOpen = false;
                return;
            }
            var now = new Date();
            if (!this.desktop.calendarSelected) {
                this.desktop.calendarSelected = this.desktopDateKey(now);
            }
            var base = this.parseDesktopDateKey(this.desktop.calendarSelected);
            this.desktop.calendarYear = base.getFullYear();
            this.desktop.calendarMonth = base.getMonth();
            this.desktop.calendarOpen = true;
            this.desktop.startOpen = false;
            this.desktop.notifOpen = false;
            this.desktop.powerOpen = false;
            this.desktop.menu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.taskMenu.visible = false;
            this.desktop.iconMenu.visible = false;
            this.closeDesktopSubMenus();
        },
        closeDesktopCalendar: function () {
            this.desktop.calendarOpen = false;
        },
        toggleDesktopNotifications: function () {
            if (this.desktop.notifOpen) {
                this.desktop.notifOpen = false;
                return;
            }
            this.desktop.notifOpen = true;
            this.desktop.notifUnread = 0;
            this.desktop.startOpen = false;
            this.desktop.calendarOpen = false;
            this.desktop.powerOpen = false;
            this.desktop.menu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.taskMenu.visible = false;
            this.desktop.iconMenu.visible = false;
            this.desktop.taskbarMenu.visible = false;
            this.desktop.trayMenu.visible = false;
            this.closeDesktopSubMenus();
        },
        clearDesktopNotifications: function () {
            this.desktop.notifications = [];
            this.desktop.notifUnread = 0;
        },
        pushDesktopNotice: function (level, title, text, target) {
            if (!this.desktop.visible) {
                return;
            }
            var d = this.desktop;
            d.notifications.unshift({
                id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                level: level || 'info',
                title: title || '',
                text: text || '',
                target: target || '',
                time: Date.now()
            });
            if (d.notifications.length > 60) {
                d.notifications.length = 60;
            }
            if (!d.notifOpen) {
                d.notifUnread = Math.min(99, d.notifUnread + 1);
            }
        },
        desktopNotifIcon: function (level) {
            if (level === 'success') {
                return 'el-icon-circle-check';
            }
            if (level === 'warning') {
                return 'el-icon-warning-outline';
            }
            if (level === 'error') {
                return 'el-icon-circle-close';
            }
            return 'el-icon-info';
        },
        desktopNotifTime: function (ts) {
            var d = new Date(ts || Date.now());
            var p = function (n) { return (n < 10 ? '0' : '') + n; };
            var now = new Date();
            var sameDay = d.getFullYear() === now.getFullYear()
                && d.getMonth() === now.getMonth()
                && d.getDate() === now.getDate();
            var time = p(d.getHours()) + ':' + p(d.getMinutes());
            return sameDay ? time : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + time;
        },
        desktopNotifClick: function (n) {
            this.desktop.notifOpen = false;
            if (n && n.target === 'transfers') {
                this.openTransferDesktopWindow();
            }
        },
        desktopCalendarShift: function (delta) {
            var d = new Date(this.desktop.calendarYear, this.desktop.calendarMonth + delta, 1);
            this.desktop.calendarYear = d.getFullYear();
            this.desktop.calendarMonth = d.getMonth();
        },
        desktopCalendarPrev: function () {
            this.desktopCalendarShift(-1);
        },
        desktopCalendarNext: function () {
            this.desktopCalendarShift(1);
        },
        desktopCalendarToday: function () {
            var now = new Date();
            this.desktop.calendarSelected = this.desktopDateKey(now);
            this.desktop.calendarYear = now.getFullYear();
            this.desktop.calendarMonth = now.getMonth();
        },
        desktopCalendarSelect: function (cell) {
            if (!cell) {
                return;
            }
            this.desktop.calendarSelected = cell.key;
            var d = this.parseDesktopDateKey(cell.key);
            this.desktop.calendarYear = d.getFullYear();
            this.desktop.calendarMonth = d.getMonth();
        },

        /* ---------- 桌面任务栏 / 开始菜单 ---------- */
        toggleDesktopStart: function () {
            if (this.desktop.startOpen) {
                this.desktop.startOpen = false;
            } else {
                this.openDesktopStart();
            }
        },
        openDesktopStart: function () {
            this.desktop.startOpen = true;
            this.desktop.notifOpen = false;
            if (!this.connections.length) {
                this.loadConnections();
            }
            this.loadDesktopPlugins(false);
            this.desktop.menu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.taskMenu.visible = false;
            this.desktop.iconMenu.visible = false;
            this.desktop.taskbarMenu.visible = false;
            this.taskmgr.ctxMenu.visible = false;
            this.desktop.calendarOpen = false;
            this.closeDesktopSubMenus();
            var self = this;
            this.$nextTick(function () {
                var r = self.$refs.desktopStartSearch;
                if (r) {
                    r.focus();
                }
                if (self.$refs.desktopStartBody) {
                    self.$refs.desktopStartBody.scrollTop = 0;
                }
            });
        },
        closeDesktopStart: function () {
            this.desktop.startOpen = false;
        },
        desktopStartGo: function (path) {
            this.desktop.startOpen = false;
            if (!this.desk.id) {
                this.openDesktopExplorerWindow(path);
                return;
            }
            this.desktopGo(path);
        },
        /* 新浏览器标签打开桌面：同一连接复用同一个标签，避免重复堆叠 */
        openDesktopInNewTab: function (tab) {
            var t = tab || this.activeTab;
            if (!t || t.connId == null) {
                ELEMENT.Message.warning('当前会话没有可用的连接记录');
                return;
            }
            if (!t.sessionId) {
                ELEMENT.Message.warning('该标签尚未连接，无法打开桌面');
                return;
            }
            var conv = this.aiActiveConv(t);
            var path = (conv && conv.cwd) || t.termCwd || '';
            this.openDesktopTabForConn(t.connId, path);
        },
        openTerminalInNewTab: function () {
            this.desktop.startOpen = false;
            this.desktop.powerOpen = false;
            this.desktop.wallMenu.visible = false;
            var t = this.desktopTab;
            if (!t || t.connId == null) {
                ELEMENT.Message.warning('当前会话没有可用的连接记录');
                return;
            }
            var url = '/workspace?connId=' + encodeURIComponent(t.connId) + '&view=workbench';
            if (!window.open(url, '_blank')) {
                ELEMENT.Message.warning('浏览器拦截了新标签页，请允许弹出窗口后重试');
            }
        },
        /* ---------- 桌面应用插件 ---------- */
        loadDesktopPlugins: function (showError) {
            var self = this;
            this.pluginMgrLoading = true;
            return http.get('/api/desktop/plugins', { silent: !showError }).then(function (list) {
                self.desktopPlugins = Array.isArray(list) ? list : [];
                self.pluginMgrLoading = false;
                self.pluginMgrError = '';
            }).catch(function (err) {
                self.pluginMgrLoading = false;
                if (showError) {
                    self.pluginMgrError = (err && err.message) ? err.message : '加载插件失败';
                }
            });
        },
        loadBuiltinPlugins: function (showError) {
            var self = this;
            this.pluginBuiltinLoading = true;
            return http.get('/api/desktop/plugins/builtin', { silent: !showError }).then(function (list) {
                self.builtinPlugins = Array.isArray(list) ? list : [];
                self.pluginBuiltinLoading = false;
            }).catch(function () {
                self.pluginBuiltinLoading = false;
            });
        },
        installBuiltinPlugin: function (p) {
            if (!p || this.pluginBuiltinInstalling) {
                return;
            }
            var self = this;
            var updated = !!p.installed;
            this.pluginBuiltinInstalling = p.key;
            this.pluginMgrError = '';
            if (p.id) {
                this.closePluginWindows(p.id);
            }
            http.post('/api/desktop/plugins/builtin/' + encodeURIComponent(p.key) + '/install')
                .then(function (info) {
                    var name = info && info.name ? info.name : p.name;
                    var needRestart = !!(info && info.hasBackend);
                    var action = updated ? '已更新 ' : '已安装 ';
                    if (needRestart) {
                        if (info && info.id) {
                            self.closePluginWindows(info.id);
                        }
                        ELEMENT.Message({
                            type: 'success',
                            message: action + name + '，重启 DeepShell 后后端模块生效',
                            duration: 7000,
                            showClose: true
                        });
                    } else {
                        ELEMENT.Message({
                            type: 'success',
                            message: action + name,
                            duration: 3000,
                            showClose: true
                        });
                    }
                    return self.loadDesktopPlugins(true).then(function () {
                        return self.loadBuiltinPlugins(true);
                    }).then(function () {
                        if (info && !needRestart) {
                            self.openDesktopPlugin(info);
                        }
                    });
                })
                .catch(function (err) {
                    self.pluginMgrError = (err && err.message) ? err.message : '内置插件安装失败';
                })
                .then(function () {
                    self.pluginBuiltinInstalling = '';
                });
        },
        openPluginManager: function () {
            this.desktop.startOpen = false;
            this.desktop.powerOpen = false;
            this.desktop.wallMenu.visible = false;
            this.pluginMgrVisible = true;
            this.pluginMgrError = '';
            this.loadDesktopPlugins(true);
            this.loadBuiltinPlugins(true);
        },
        /* 桌面插件的受限后端调用桥：iframe 不接触 Cookie，只能调用自己插件的运行时模块 */
        onPluginBridgeMessage: function (ev) {
            var msg = ev && ev.data;
            if (!msg || msg.source !== 'deepshell-plugin' || msg.type !== 'plugin.invoke') {
                return;
            }
            var requestId = msg.requestId;
            if (!requestId) {
                return;
            }
            var sourceWin = null;
            var pluginId = '';
            for (var i = 0; i < this.desktop.windows.length; i++) {
                var w = this.desktop.windows[i];
                if (w.type !== 'plugin' || !w.pluginId) {
                    continue;
                }
                var ref = this.$refs['plugin-frame-' + w.id];
                var frame = Array.isArray(ref) ? ref[0] : ref;
                if (frame && frame.contentWindow === ev.source) {
                    sourceWin = frame.contentWindow;
                    pluginId = w.pluginId;
                    break;
                }
            }
            if (!sourceWin) {
                return;
            }
            var reply = function (ok, data, error) {
                try {
                    sourceWin.postMessage({
                        source: 'deepshell-host',
                        type: 'plugin.invoke.result',
                        requestId: requestId,
                        ok: !!ok,
                        data: data,
                        error: error || ''
                    }, '*');
                } catch (e) { /* 窗口已关闭 */ }
            };
            var plugin = null;
            for (var j = 0; j < this.desktopPlugins.length; j++) {
                if (this.desktopPlugins[j].id === pluginId) {
                    plugin = this.desktopPlugins[j];
                    break;
                }
            }
            if (!plugin || !plugin.hasBackend) {
                reply(false, null, '该插件未声明后端模块');
                return;
            }
            if (plugin.backendLoaded === false) {
                reply(false, null, '插件后端尚未加载，请重启 DeepShell 后重试');
                return;
            }
            var action = String(msg.action || '');
            if (!action || action.length > 128) {
                reply(false, null, '插件 action 不合法');
                return;
            }
            http.post('/api/desktop/plugins/runtime/' + encodeURIComponent(pluginId) + '/invoke', {
                action: action,
                payload: msg.payload == null ? null : msg.payload
            }, { silent: true, timeout: 35000 }).then(function (data) {
                reply(true, data);
            }).catch(function (err) {
                reply(false, null, (err && err.message) ? err.message : '插件请求失败');
            });
        },
        pickPluginZip: function () {
            var el = this.$refs.pluginZipInput;
            if (el) {
                el.value = '';
                el.click();
            }
        },
        onPluginZipPick: function (ev) {
            var input = ev.target;
            var file = input.files && input.files[0];
            input.value = '';
            if (!file) {
                return;
            }
            if (!/\.zip$/i.test(file.name)) {
                ELEMENT.Message.warning('请选择 ZIP 插件包');
                return;
            }
            var self = this;
            this.$confirm('只安装可信来源的插件。未验证插件无法证明发布者身份；包含后端 JAR 的插件会以 DeepShell 服务端权限运行，可读写服务器资源。继续安装？',
                '插件安装风险确认', {
                    type: 'warning',
                    confirmButtonText: '继续安装',
                    cancelButtonText: '取消'
                }).then(function () {
                var fd = new FormData();
                fd.append('file', file, file.name);
                self.pluginImporting = true;
                self.pluginMgrError = '';
                return http.post('/api/desktop/plugins/import', fd, { timeout: 0 })
                    .then(function (info) {
                        var name = info && info.name ? info.name : file.name;
                        var needRestart = !!(info && info.hasBackend);
                        if (info && info.id) {
                            self.closePluginWindows(info.id);
                        }
                        if (needRestart) {
                            ELEMENT.Message({
                                type: 'success',
                                message: (info && info.updated ? '插件已更新：' : '插件已安装：')
                                    + name + '，重启 DeepShell 后后端模块生效',
                                duration: 7000,
                                showClose: true
                            });
                        } else {
                            ELEMENT.Message.success((info && info.updated ? '插件已更新：' : '插件已安装：') + name);
                        }
                        self.loadDesktopPlugins(true);
                        self.loadBuiltinPlugins(true);
                    })
                    .catch(function (err) {
                        self.pluginMgrError = (err && err.message) ? err.message : '插件安装失败';
                    })
                    .then(function () {
                        self.pluginImporting = false;
                    });
            }).catch(function () { /* 用户取消 */ });
        },
        deletePlugin: function (p) {
            if (!p) {
                return;
            }
            var self = this;
            this.$confirm('卸载插件「' + p.name + '」？插件文件将从数据目录中删除。', '卸载插件', {
                type: 'warning',
                confirmButtonText: '卸载',
                cancelButtonText: '取消'
            }).then(function () {
                self.closePluginWindows(p.id);
                return http.delete('/api/desktop/plugins/' + encodeURIComponent(p.id));
            }).then(function () {
                self.loadDesktopPlugins(true);
                self.loadBuiltinPlugins(true);
                if (p.hasBackend) {
                    ELEMENT.Message({
                        type: 'success',
                        message: '已卸载 ' + p.name + '，后端模块已停止运行',
                        duration: 5000,
                        showClose: true
                    });
                } else {
                    ELEMENT.Message.success('已卸载 ' + p.name);
                }
            }).catch(function () { /* 取消或失败（已提示） */ });
        },
        closePluginWindows: function (id) {
            var wins = this.desktop.windows.filter(function (w) {
                return w.type === 'plugin' && w.pluginId === id;
            });
            for (var i = 0; i < wins.length; i++) {
                this.closeDesktopWindow(wins[i]);
            }
        },
        launchDesktopPlugin: function (id) {
            var plugin = null;
            for (var i = 0; i < this.desktopPlugins.length; i++) {
                if (this.desktopPlugins[i].id === id) {
                    plugin = this.desktopPlugins[i];
                    break;
                }
            }
            if (!plugin) {
                ELEMENT.Message.warning('插件不存在或已卸载');
                this.loadDesktopPlugins(true);
                return;
            }
            this.openDesktopPlugin(plugin);
        },
        openDesktopPlugin: function (plugin) {
            if (!plugin || !plugin.entryUrl) {
                return null;
            }
            if (!this.desktop.visible) {
                ELEMENT.Message.warning('请先进入 AI 可视化桌面');
                return null;
            }
            if (plugin.hasBackend && plugin.backendLoaded === false) {
                ELEMENT.Message.warning('插件后端尚未加载，请重启 DeepShell 后再打开');
                return null;
            }
            var existing = null;
            for (var i = 0; i < this.desktop.windows.length; i++) {
                var win = this.desktop.windows[i];
                if (win.type === 'plugin' && win.pluginId === plugin.id) {
                    existing = win;
                    break;
                }
            }
            if (existing) {
                // 插件更新后重新打开时刷新 iframe 地址
                existing.pluginUrl = plugin.entryUrl;
                existing.pluginName = plugin.name;
                existing.pluginTitle = plugin.title || plugin.name;
                existing.pluginVersion = plugin.version || '';
                existing.pluginIconUrl = plugin.iconUrl || '';
                existing.pluginVerified = !!plugin.verified;
                existing.pluginBackend = !!plugin.hasBackend;
                this.restoreDesktopWindow(existing);
                return existing;
            }
            var w = this.addDesktopWindow('plugin');
            w.pluginId = plugin.id;
            w.pluginName = plugin.name;
            w.pluginTitle = plugin.title || plugin.name;
            w.pluginVersion = plugin.version || '';
            w.pluginIconUrl = plugin.iconUrl || '';
            w.pluginUrl = plugin.entryUrl;
            w.pluginVerified = !!plugin.verified;
            w.pluginBackend = !!plugin.hasBackend;
            var area = this.desktopWindowWorkArea();
            var width = Math.min(area.width - 20, Math.max(520, Number(plugin.windowWidth) || 760));
            var height = Math.min(area.height - 20, Math.max(320, Number(plugin.windowHeight) || 520));
            width = Math.max(Math.min(520, area.width), width);
            height = Math.max(Math.min(320, area.height), height);
            this.applyDesktopWindowGeometry(w, {
                x: Math.round((area.width - width) / 2),
                y: Math.round((area.height - height) / 2),
                w: width,
                h: height
            });
            this.pluginMgrVisible = false;
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
            return w;
        },
        desktopStartEnter: function () {
            if (!this.desktopStartQuery) {
                return;
            }
            var app = this.desktopStartAppMatches[0];
            if (app) {
                this.desktopLaunchApp(app.id);
                return;
            }
            var action = this.desktopStartActionMatches[0];
            if (action) {
                this.desktopStartRunAction(action.id);
                return;
            }
            var conn = this.desktopStartConnMatches[0];
            if (conn) {
                this.desktopStartOpenConnection(conn);
                return;
            }
            var entry = this.desktopStartEntryMatches[0];
            if (entry) {
                this.desktopOpenLocalSearchResult(entry);
                return;
            }
            if (!this.desktop.local) {
                this.desktopSearchServer();
            }
        },
        desktopStartOpenConnection: function (c) {
            if (!c || c.id == null) {
                return;
            }
            this.desktop.startOpen = false;
            var t = this.desktopTab;
            if (t && t.connId === c.id) {
                ELEMENT.Message.info('当前桌面已连接「' + c.name + '」');
                return;
            }
            this.openDesktopTabForConn(c.id, this.desktop.surface.dir || '');
        },
        desktopStartRunAction: function (id) {
            if (this.desktopAppBlocked(id)) {
                this.desktopServerReady();
                return;
            }
            this.desktop.startOpen = false;
            var dir = this.desktop.surface.dir;
            var win = this.desktopSurfaceContextWin();
            if (id === 'newTerminal') {
                if (!dir) {
                    ELEMENT.Message.warning('桌面目录尚未就绪，请稍后再试');
                    return;
                }
                this.openDesktopTerminalWindow(dir);
            } else if (id === 'newFolder') {
                if (!dir) {
                    ELEMENT.Message.warning('桌面目录尚未就绪，请稍后再试');
                    return;
                }
                this.desktopNewFolder(win);
            } else if (id === 'newFile') {
                if (!dir) {
                    ELEMENT.Message.warning('桌面目录尚未就绪，请稍后再试');
                    return;
                }
                this.desktopNewFile(win);
            } else if (id === 'upload') {
                if (!dir) {
                    ELEMENT.Message.warning('桌面目录尚未就绪，请稍后再试');
                    return;
                }
                this.pickDesktopUpload(win);
            } else if (id === 'refresh') {
                this.refreshDesktopSurface();
            } else if (id === 'showDesktop') {
                this.toggleShowDesktop();
            } else if (id === 'workbench') {
                this.openTerminalInNewTab();
            }
        },
        desktopLaunchApp: function (id) {
            if (!id || id === 'desktop') {
                return;
            }
            if (this.desktopAppBlocked(id)) {
                this.desktopServerReady();
                return;
            }
            this.desktop.startOpen = false;
            if (id.indexOf('plugin:') === 0) {
                this.launchDesktopPlugin(id.substring(7));
                return;
            }
            var self = this;
            if (id === 'taskmgr') {
                this.openTaskManager();
                return;
            }
            if (id === 'services') {
                this.openDesktopServicesWindow();
                return;
            }
            if (id === 'appcenter') {
                this.openDesktopAppCenterWindow();
                return;
            }
            if (id === 'nettool') {
                this.openDesktopNetToolWindow();
                return;
            }
            if (id === 'batchcmd') {
                this.openDesktopBatchCommandWindow();
                return;
            }
            if (id === 'editor') {
                this.openDesktopEditorApp();
                return;
            }
            if (id === 'ai') {
                this.openAiDesktopWindow();
                return;
            }
            if (id === 'transfers') {
                this.openTransferDesktopWindow();
                return;
            }
            if (id === 'disk') {
                this.openDiskDesktopWindow();
                return;
            }
            if (id === 'terminal') {
                this.openDesktopTerminalWindow();
                return;
            }
            if (id === 'file') {
                this.openDesktopExplorerWindow();
                return;
            }
            if (id === 'dirs') {
                this.openDesktopDirsWindow();
                return;
            }
            if (id === 'cmd') {
                this.openDesktopCommandsWindow();
                return;
            }
            if (id === 'sysinfo') {
                this.openDesktopSysInfo();
                return;
            }
            if (id === 'control') {
                this.openDesktopSettings();
                return;
            }
            if (id === 'connect') {
                this.openDesktopConnectionWindow();
                return;
            }
            if (id === 'help') {
                // 帮助手册在桌面内以弹层打开，不退出可视化桌面
                this.helpVisible = true;
                return;
            }
            if (id === 'settings' || id === 'about') {
                this.closeAiDesktop();
                this.$nextTick(function () {
                    if (id === 'settings') {
                        self.onMenuCommand('ai');
                    } else {
                        self.onMenuCommand(id);
                    }
                });
                return;
            }
            this.closeAiDesktop();
            this.panelVisible = true;
            this.panelTab = id;
            if (id === 'ai' || id === 'process' || id === 'disk') {
                this.ensurePanelWide();
            }
            if (id === 'ai') {
                this.scrollAiChat();
            }
            if (id === 'process' && this.activeTab && this.activeTab.sessionId) {
                this.loadProcesses(this.activeTab);
            }
        },
        /* ---------- 设置（控制面板） ---------- */
        openDesktopSettings: function () {
            this.desktop.startOpen = false;
            this.desktop.menu.visible = false;
            this.desktop.calendarOpen = false;
            this.desktopAppProps.visible = false;
            this.closeDesktopSubMenus();
            this.desktop.settingsVisible = true;
            this.desktop.settingsSection = 'appearance';
            this.loadAppInfo();
            this.loadAiConfig();
            this.loadLan();
        },
        closeDesktopSettings: function () {
            this.desktop.settingsVisible = false;
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
        },
        desktopThemeFor: function (id) {
            return desktopThemeById(id);
        },
        applyDesktopTheme: function (id) {
            var t = desktopThemeById(id);
            var a = this.desktopAppearance;
            a.theme = t.id;
            a.accentColor = '';
            a.windowColor = t.windowColor;
            a.windowTransparency = t.windowTransparency;
            a.windowTextColor = '';
            a.windowBorderColor = '';
            a.taskbarColor = t.taskbarColor;
            a.taskbarTransparency = t.taskbarTransparency;
            a.taskbarIconColor = '';
            a.desktopIconTextColor = '';
        },
        setDesktopIconSize: function (size) {
            if (size !== 'small' && size !== 'medium' && size !== 'large') {
                return;
            }
            this.desktopAppearance.iconSize = size;
        },
        setDesktopAppearanceColor: function (field, value) {
            if (!this.desktopAppearance || !field) {
                return;
            }
            var hex = desktopOptionalHex(value);
            if (hex) {
                this.desktopAppearance[field] = hex;
            }
        },
        clearDesktopAppearanceColor: function (field) {
            if (this.desktopAppearance) {
                this.desktopAppearance[field] = '';
            }
        },
        saveDesktopAppearanceScheme: function () {
            var name = String(this.desktopAppearanceSaveName || '').trim();
            if (!name) {
                ELEMENT.Message.warning('请先输入方案名称');
                return;
            }
            if (name.length > 24) {
                ELEMENT.Message.warning('方案名称最多 24 个字符');
                return;
            }
            var snapshot = desktopAppearanceSnapshot(this.desktopAppearance);
            var list = this.desktopCustomAppearances.slice();
            var existing = null;
            for (var i = 0; i < list.length; i++) {
                if (list[i].name === name) {
                    existing = list[i];
                    break;
                }
            }
            if (existing) {
                existing.appearance = snapshot;
                existing.createdAt = Date.now();
            } else {
                list.unshift({
                    id: 'custom-' + Date.now().toString(36),
                    name: name,
                    createdAt: Date.now(),
                    appearance: snapshot
                });
            }
            this.desktopCustomAppearances = list.slice(0, DESKTOP_CUSTOM_APPEARANCE_LIMIT);
            saveDesktopCustomAppearances(this.desktopCustomAppearances);
            this.desktopAppearanceSaveName = '';
            ELEMENT.Message.success((existing ? '已更新外观方案「' : '已保存外观方案「') + name + '」');
        },
        applyDesktopCustomAppearance: function (item) {
            if (!item || !item.appearance) {
                return;
            }
            var a = this.desktopAppearance;
            var saved = desktopAppearanceSnapshot(item.appearance);
            Object.keys(saved).forEach(function (key) {
                a[key] = saved[key];
            });
            ELEMENT.Message.success('已应用外观方案「' + item.name + '」');
        },
        deleteDesktopCustomAppearance: function (item) {
            if (!item) {
                return;
            }
            var self = this;
            this.$confirm('删除外观方案「' + item.name + '」？当前已应用的颜色不会改变。', '删除外观方案', {
                type: 'warning',
                confirmButtonText: '删除',
                cancelButtonText: '取消'
            }).then(function () {
                self.desktopCustomAppearances = self.desktopCustomAppearances.filter(function (c) {
                    return c.id !== item.id;
                });
                saveDesktopCustomAppearances(self.desktopCustomAppearances);
                ELEMENT.Message.success('已删除外观方案「' + item.name + '」');
            }).catch(function () { /* 取消 */ });
        },
        resetDesktopAppearance: function () {
            var def = desktopDefaultAppearance();
            var a = this.desktopAppearance;
            Object.keys(def).forEach(function (key) {
                a[key] = def[key];
            });
            ELEMENT.Message.success('已恢复默认外观主题');
        },
        resetDesktopSettings: function () {
            var self = this;
            this.$confirm('恢复桌面默认设置？默认视图将改为大图标，并重新开启图片缩略图和隐藏文件显示。',
                '恢复默认设置', { type: 'warning', confirmButtonText: '恢复默认', cancelButtonText: '取消' })
                .then(function () {
                    self.desktop.windows.forEach(function (w) {
                        w.viewMode = 'large';
                        w.sortBy = 'name';
                        w.sortDir = 'asc';
                    });
                    self.desktop.ghost.viewMode = 'large';
                    self.desktop.ghost.sortBy = 'name';
                    self.desktop.ghost.sortDir = 'asc';
                    try { localStorage.setItem('deepshell.desktopView', 'large'); } catch (e) { /* ignore */ }
                    self.desktop.thumbnailsEnabled = true;
                    self.desktop.showHidden = true;
                    ELEMENT.Message.success('已恢复桌面默认设置');
                })
                .catch(function () { /* 取消 */ });
        },
        desktopReconnectSession: function () {
            var t = this.desktopTab;
            this.desktop.trayMenu.visible = false;
            if (!t) {
                ELEMENT.Message.warning('当前桌面没有可用的连接');
                return;
            }
            if (t.status === 'connecting' || t.status === 'reconnecting') {
                ELEMENT.Message.info('正在重新连接，请稍候…');
                return;
            }
            var self = this;
            var doReconnect = function () {
                self.reconnectTab(t);
                ELEMENT.Message.info('正在重新连接「' + t.title + '」…');
            };
            if (t.status !== 'open') {
                doReconnect();
                return;
            }
            this.$confirm('重新连接当前 SSH 会话？当前连接上的命令会中断，桌面会保留并在恢复后自动刷新。',
                '重新连接', { type: 'warning', confirmButtonText: '重新连接', cancelButtonText: '取消' })
                .then(doReconnect)
                .catch(function () { /* 取消 */ });
        },
        refreshDesktopAfterReconnect: function (tab, dirReady) {
            var self = this;
            if (!this.desktop.visible || !tab || tab.key !== this.desktop.tabKey) {
                return;
            }
            Promise.resolve(dirReady).then(function () {
                if (!self.desktop.visible || tab.key !== self.desktop.tabKey || !tab.sessionId) {
                    return;
                }
                self.loadDesktopSurface();
                self.desktop.windows.forEach(function (w) {
                    if (w.type === 'explorer') {
                        self.loadDesktopDir(w.path || tab.sftpHome || '/', 'refresh', w);
                    }
                });
                self.desktop.windows.forEach(function (w) {
                    var wt = w.termTab;
                    if (w.type === 'terminal' && wt && wt !== tab && wt.status !== 'open'
                            && wt.status !== 'connecting' && wt.status !== 'reconnecting') {
                        self.reconnectTab(wt);
                    }
                });
            });
        },
        desktopDisconnectSession: function () {
            var t = this.desktopTab;
            if (!t) {
                return;
            }
            var self = this;
            this.$confirm('断开当前 SSH 会话？桌面会关闭，正在执行的终端命令会中断。',
                '断开连接', { type: 'warning', confirmButtonText: '断开', cancelButtonText: '取消' })
                .then(function () {
                    self.closeAiDesktop();
                    self.$nextTick(function () {
                        self.disconnectTab(t);
                    });
                })
                .catch(function () { /* 取消 */ });
        },
        desktopPowerShutdown: function () {
            this.desktopPowerAction('shutdown');
        },
        desktopPowerReboot: function () {
            this.desktopPowerAction('reboot');
        },
        desktopPowerDisconnect: function () {
            this.desktop.powerOpen = false;
            this.desktopDisconnectSession();
        },
        desktopPowerAction: function (act) {
            var t = this.desktopTab;
            if (!t) {
                return;
            }
            if (!t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            var self = this;
            var isShutdown = act === 'shutdown';
            var label = isShutdown ? '关机' : '重启';
            var cmd = isShutdown ? 'shutdown -h now' : 'shutdown -r now';
            this.desktop.powerOpen = false;
            this.$confirm(
                '确定' + label + '远端服务器「' + t.title + '」？将执行 ' + cmd + '，'
                    + '需要当前用户为 root 或已配置免密 sudo；服务器上的所有服务和连接都会中断。',
                '服务器' + label,
                { type: 'warning', confirmButtonText: label, cancelButtonText: '取消' }
            ).then(function () {
                return http.post('/api/system/power', { sessionId: t.sessionId, action: act });
            }).then(function (r) {
                ELEMENT.Message.success((r && r.message) ? r.message : (label + '指令已发送'));
                self.closeAiDesktop(true);
                if (isShutdown) {
                    // 关机后不会再连上：主动断开并停止自动重连，避免反复重试
                    self.$nextTick(function () {
                        self.disconnectTab(t);
                    });
                }
            }).catch(function () { /* 取消或失败（已由拦截器提示） */ });
        },
        /* ---------- DeepShell 后端关闭 / 重启（与远端服务器的关机 / 重启无关） ---------- */
        askAppLifecycle: function (mode) {
            var self = this;
            this.topMenuVisible = false;
            this.topSubMenu = '';
            this.desktop.startOpen = false;
            this.desktop.powerOpen = false;
            if (this.appLifecycle.visible) {
                return;
            }
            var restarting = mode === 'restart';
            var label = restarting ? '重启' : '关闭';
            var detail = restarting
                ? 'DeepShell 后端会立即退出并自动重新启动。正在执行的终端命令、文件传输和 AI 任务都会中断。'
                : 'DeepShell 后端会立即退出。正在执行的终端命令、文件传输和 AI 任务都会中断，'
                    + '需要手动重新启动 DeepShell 才能继续使用。';
            this.$confirm(detail + '确定' + label + ' DeepShell 吗？', label + ' DeepShell', {
                type: 'warning',
                confirmButtonText: '确定' + label,
                cancelButtonText: '取消'
            }).then(function () {
                self.performAppLifecycle(mode);
            }).catch(function () { /* 取消 */ });
        },
        performAppLifecycle: function (mode) {
            var self = this;
            var restarting = mode === 'restart';
            this.stopAppLifecycleTimer();
            this.appLifecycle = {
                visible: true,
                mode: mode,
                status: restarting ? 'working' : 'closing',
                elapsed: 0
            };
            this._appLifecycleTick = setInterval(function () {
                self.appLifecycle.elapsed += 1;
            }, 1000);

            if (!restarting) {
                // 关闭：服务可能来不及返回响应就退出，因此响应、网络错误和超时都按「已关闭」处理；
                // 只有后端明确返回业务错误时才认为关闭失败并撤掉遮罩
                axios.post('/api/app-lifecycle/shutdown', {}, { timeout: 8000 }).then(function (resp) {
                    var d = resp && resp.data;
                    if (d && d.code !== 0) {
                        self.cancelAppLifecycle(d.msg || '关闭 DeepShell 失败');
                        return;
                    }
                    self.markAppShutdownDone();
                }).catch(function (err) {
                    if (err && err.response) {
                        self.cancelAppLifecycle('关闭 DeepShell 失败');
                    } else {
                        self.markAppShutdownDone();
                    }
                });
                setTimeout(function () {
                    if (self.appLifecycle.visible && self.appLifecycle.mode === 'shutdown'
                            && self.appLifecycle.status === 'closing') {
                        self.markAppShutdownDone();
                    }
                }, 2500);
                return;
            }

            // 重启：先记下当前进程的启动时间，再请求重启，之后轮询等待新进程就绪
            var baseline = '';
            axios.get('/api/app-info', { timeout: 5000 }).then(function (resp) {
                var d = resp && resp.data;
                if (d && d.code === 0 && d.data) {
                    baseline = String(d.data.startedAt || '');
                }
            }).catch(function () { /* 服务可能已开始退出 */ }).then(function () {
                self._appLifecycleBaseline = baseline;
                return axios.post('/api/app-lifecycle/restart', {}, { timeout: 8000 });
            }).then(function (resp) {
                var d = resp && resp.data;
                if (d && d.code !== 0) {
                    self.cancelAppLifecycle(d.msg || '重启 DeepShell 失败');
                    return;
                }
                self.pollAppLifecycle();
            }).catch(function (err) {
                if (err && err.response) {
                    self.cancelAppLifecycle('重启 DeepShell 失败');
                    return;
                }
                self.pollAppLifecycle(); // 请求发出后服务已退出，继续等待新进程
            });
        },
        cancelAppLifecycle: function (message) {
            this.stopAppLifecycleTimer();
            this.appLifecycle.visible = false;
            if (message) {
                ELEMENT.Message.error(message);
            }
        },
        markAppShutdownDone: function () {
            if (this.appLifecycle.mode !== 'shutdown') {
                return;
            }
            this.stopAppLifecycleTimer();
            this.appLifecycle.status = 'closed';
        },
        pollAppLifecycle: function () {
            var self = this;
            var baseline = this._appLifecycleBaseline || '';
            var sawDown = false;
            var began = Date.now();

            function schedule(delay) {
                setTimeout(probe, delay);
            }
            function probe() {
                if (!self.appLifecycle.visible || self.appLifecycle.mode !== 'restart'
                        || self.appLifecycle.status !== 'working') {
                    return;
                }
                if (Date.now() - began > 120000) {
                    self.stopAppLifecycleTimer();
                    self.appLifecycle.status = 'timeout';
                    return;
                }
                axios.get('/api/app-info', { timeout: 3000, params: { _t: Date.now() } })
                    .then(function (resp) {
                        var d = resp && resp.data;
                        if (!d || d.code !== 0 || !d.data) {
                            throw new Error('not ready');
                        }
                        var startedAt = String(d.data.startedAt || '');
                        if (baseline && startedAt) {
                            if (startedAt !== baseline) {
                                self.finishAppRestart();
                                return;
                            }
                            schedule(sawDown ? 700 : 900);
                            return;
                        }
                        // 拿不到启动时间时，至少观察到一次服务不可用后才认为响应来自新进程
                        if (sawDown || Date.now() - began > 3000) {
                            self.finishAppRestart();
                            return;
                        }
                        schedule(700);
                    })
                    .catch(function () {
                        sawDown = true;
                        schedule(700);
                    });
            }
            schedule(1200);
        },
        finishAppRestart: function () {
            this.stopAppLifecycleTimer();
            this.appLifecycle.status = 'restored';
            setTimeout(function () { location.reload(); }, 600);
        },
        stopAppLifecycleTimer: function () {
            if (this._appLifecycleTick) {
                clearInterval(this._appLifecycleTick);
                this._appLifecycleTick = null;
            }
        },
        reloadPage: function () {
            location.reload();
        },
        openDesktopSysInfo: function () {
            if (!this.desktopServerReady()) {
                return;
            }
            this.desktop.startOpen = false;
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            this.sysInfoTitle = t.title;
            this.sysInfoSessionId = t.sessionId;
            this.sysInfo = null;
            this.sysInfoError = '';
            this.sysInfoVisible = true;
        },
        desktopSearchServer: function () {
            var q = this.desktopStartQuery;
            if (!q) {
                return;
            }
            if (!this.desktopServerReady()) {
                return;
            }
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            var self = this;
            var d = this.desk;
            var rootPath = d.path || this.desktopHomeDir || '/';
            this.desktop.startRootPath = rootPath;
            this.desktop.startWinId = d.id || '';
            var seq = (this._deskSearchSeq || 0) + 1;
            this._deskSearchSeq = seq;
            this.desktop.startSearching = true;
            this.desktop.startSearched = false;
            this.desktop.startError = '';
            this.desktop.startResults = [];
            http.get('/api/files/search', {
                params: {
                    sessionId: t.sessionId,
                    root: rootPath,
                    keyword: q,
                    limit: 100
                }
            }).then(function (list) {
                if (seq !== self._deskSearchSeq) {
                    return;
                }
                self.desktop.startResults = list || [];
                self.desktop.startSearching = false;
                self.desktop.startSearched = true;
                self.$nextTick(function () {
                    var body = self.$refs.desktopStartBody;
                    if (!body) {
                        return;
                    }
                    var box = body.querySelector('.dsk-start-server-results');
                    if (box) {
                        var delta = box.getBoundingClientRect().top - body.getBoundingClientRect().top;
                        body.scrollTop = Math.max(0, body.scrollTop + delta - 8);
                    }
                });
            }).catch(function (e) {
                if (seq !== self._deskSearchSeq) {
                    return;
                }
                self.desktop.startSearching = false;
                self.desktop.startSearched = true;
                self.desktop.startError = '搜索失败：' + ((e && e.message) || '未知错误');
            });
        },
        desktopOpenLocalSearchResult: function (row) {
            this.desktop.startOpen = false;
            if (!this.desk.id) {
                this.openDesktopExplorerWindow();
                return;
            }
            this.desktopOpenEntry(row);
        },
        desktopOpenSearchResult: function (row) {
            if (!row) {
                return;
            }
            this.desktop.startOpen = false;
            var d = this.desktopWindowById(this.desktop.startWinId) || this.desk;
            if (!d.id) {
                this.openDesktopExplorerWindow();
                d = this.desk;
                if (!d.id) {
                    return;
                }
            }
            if (row.dir) {
                d.pendingSelect = '';
                d.pendingOpen = false;
                this.desktopGo(row.path, d);
                return;
            }
            var p = row.path || '';
            var idx = p.lastIndexOf('/');
            var parent = idx <= 0 ? '/' : p.substring(0, idx);
            var name = idx >= 0 ? p.substring(idx + 1) : p;
            d.pendingSelect = name;
            d.pendingOpen = true;
            if (parent === d.path) {
                this.desktopRefresh(d);
            } else {
                this.loadDesktopDir(parent, null, d);
            }
        },

        /* ---------- 系统信息（标签右键） ---------- */
        refreshSysInfoTimer: function (on) {
            if (this._sysInfoTimer) {
                clearInterval(this._sysInfoTimer);
                this._sysInfoTimer = null;
            }
            if (on) {
                var self = this;
                this._sysInfoTimer = setInterval(function () {
                    if (!self.sysInfoVisible || !self.sysInfoAuto || self.sysInfoLoading) {
                        return;
                    }
                    self.loadSysInfo();
                }, 10000);
            }
        },
        loadSysInfo: function () {
            var sid = this.sysInfoSessionId;
            if (!sid) {
                return;
            }
            var self = this;
            this.sysInfoLoading = true;
            this.sysInfoError = '';
            http.get('/api/system/info', { params: { sessionId: sid } }).then(function (d) {
                self.sysInfo = d || null;
            }).catch(function (e) {
                self.sysInfoError = (e && e.message) ? e.message : '获取系统信息失败';
            }).then(function () {
                self.sysInfoLoading = false;
            });
        },
        /* ---------- 进程详情（点击进程行） ---------- */
        showProcDetail: function (row) {
            if (!row) {
                return;
            }
            this.procDetail = row;
            // 先用列表里的（可能被截断）命令行立即展示，再异步取完整命令行替换
            this.procDetailCmd = row.args || row.comm || '';
            this.procDetailVisible = true;
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                return;
            }
            var self = this;
            http.get('/api/process/detail', { params: { sessionId: t.sessionId, pid: row.pid } }).then(function (d) {
                if (self.procDetail === row && d && d.command) {
                    self.procDetailCmd = d.command;
                }
            }).catch(function () { /* 读取失败时保留列表里的命令行 */ });
        },
        copyProcCmd: function () {
            var t = this.procDetail;
            if (!t) {
                return;
            }
            var text = this.procDetailCmd || t.args || t.comm || '';
            if (!text) {
                ELEMENT.Message.warning('该进程没有命令行信息');
                return;
            }
            this.copyText(text);
        },
        /* ---------- 磁盘占用分析 ---------- */
        analyzeFromSftp: function () {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                return;
            }
            this.panelTab = 'disk';
            this.ensurePanelWide();
            var p = t.sftpPath || t.sftpHome || '/';
            t.diskPath = p;
            this.startDiskAnalyze(t, t.sessionId, p);
        },
        /* 工作台磁盘面板与桌面磁盘窗口共用的分析入口 */
        startDiskAnalyze: function (target, sessionId, path) {
            if (!target || !sessionId || target.diskLoading) {
                return;
            }
            path = (path || '').trim();
            if (!path) {
                ELEMENT.Message.warning('请输入要分析的目录');
                return;
            }
            target.diskPath = path;
            target.diskLoading = true;
            target.diskError = '';
            target.diskEntries = [];
            target.diskTotalKb = null;
            target.diskTruncated = false;
            http.get('/api/disk/analyze', { params: { sessionId: sessionId, path: path } }).then(function (d) {
                target.diskEntries = (d && d.entries) || [];
                target.diskTotalKb = d ? d.totalKb : null;
                target.diskTruncated = !!(d && d.truncated);
                if (d && d.path) {
                    target.diskPath = d.path;
                }
            }).catch(function (e) {
                target.diskError = (e && e.message) ? e.message : '目录分析失败';
            }).then(function () {
                target.diskLoading = false;
            });
        },
        sortDiskSize: function (a, b) {
            return (a.sizeKb || 0) - (b.sizeKb || 0);
        },
        sortDiskName: function (a, b) {
            return String(a.name || '').localeCompare(String(b.name || ''));
        },
        fmtDisk: function (kb) {
            if (kb == null) {
                return '--';
            }
            if (kb < 1024) {
                return kb + ' K';
            }
            if (kb < 1048576) {
                return (kb / 1024).toFixed(1) + ' M';
            }
            if (kb < 1073741824) {
                return (kb / 1048576).toFixed(2) + ' G';
            }
            return (kb / 1073741824).toFixed(2) + ' T';
        },
        loadLan: function () {
            var self = this;
            http.get('/api/network').then(function (d) {
                if (!d) {
                    return;
                }
                self.lanSettings.lanEnabled = !!d.lanEnabled;
                self.lanSettings.effectiveLan = !!d.effectiveLan;
                self.lanSettings.restartRequired = !!d.restartRequired;
                self.lanSettings.port = d.port;
                self.lanSettings.authEnabled = !!d.authEnabled;
                self.lanSettings.defaultPassword = !!d.defaultPassword;
                self.lanSettings.tlsEnabled = !!d.tlsEnabled;
                self.lanSettings.tlsMode = d.tlsMode || 'auto';
                self.lanSettings.tlsSelfSigned = !!d.tlsSelfSigned;
                self.lanSettings.tlsNextEnabled = !!d.tlsNextEnabled;
                self.lanSettings.urls = [d.localUrl].concat(d.lanUrls || []);
            }).catch(function () { /* 忽略 */ });
        },
        saveLan: function () {
            var self = this;
            if (this.lanSettings.lanEnabled) {
                if (!this.authStatus.enabled) {
                    ELEMENT.Message.warning('开放局域网前请先启用登录认证并修改默认密码（application.yml → deepshell.auth）');
                    this.loadLan();
                    return;
                }
                if (this.authStatus.defaultPassword) {
                    ELEMENT.Message.warning('开放局域网前请先修改默认密码 deepshell.auth.password');
                    this.loadLan();
                    return;
                }
            }
            http.post('/api/network', { lanEnabled: this.lanSettings.lanEnabled }).then(function (r) {
                ELEMENT.Message.success(r && r.message ? r.message : '已保存');
                self.loadLan();
            }).catch(function () {
                // 被拒绝时把开关恢复为服务端当前值
                self.loadLan();
            });
        },
        /* ---------- 登录与 Token 设置 ---------- */
        loadAuthStatus: function () {
            var self = this;
            return http.get('/api/auth/status').then(function (d) {
                if (!d) {
                    return;
                }
                self.authStatus = d;
                self.authSetHours = d.tokenExpireHours || 6;
                if (d.enabled && !d.loggedIn) {
                    redirectToLogin();
                }
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        openAuthSettings: function () {
            var self = this;
            return this.loadAuthStatus().then(function () {
                self.authSetVisible = true;
            });
        },
        saveAuthSettings: function () {
            var hours = parseInt(this.authSetHours, 10);
            if (!hours || hours < 1 || hours > 720) {
                ELEMENT.Message.warning('Token 有效期需在 1 - 720 小时之间');
                return;
            }
            var self = this;
            this.authSetSaving = true;
            http.put('/api/auth/settings', { tokenExpireHours: hours }).then(function (d) {
                if (d) {
                    self.authStatus = d;
                    self.authSetHours = d.tokenExpireHours || hours;
                }
                ELEMENT.Message.success('已保存，Token 已按新有效期重新签发');
            }).catch(function () { /* 已由拦截器提示 */ })
                .then(function () {
                    self.authSetSaving = false;
                });
        },
        logout: function () {
            this.tabs.forEach(function (t) {
                if (t.ws && t.ws.readyState === 1) {
                    try { t.ws.send(JSON.stringify({ type: 'close' })); } catch (e) { /* ignore */ }
                }
            });
            http.post('/api/auth/logout').then(function () {
                location.replace('/login');
            }).catch(function () {
                location.replace('/login');
            });
        },
        pingAuth: function () {
            var self = this;
            if (!this.authStatus.enabled) {
                return;
            }
            http.post('/api/auth/ping').then(function (d) {
                if (d) {
                    self.authStatus = d;
                }
            }).catch(function () { /* 401 时拦截器会跳转登录页 */ });
        },
        fmtTokenRemaining: function () {
            var seconds = this.authStatus.tokenRemainingSeconds;
            if (seconds == null) {
                return '';
            }
            if (seconds <= 0) {
                return '已过期';
            }
            var hours = Math.floor(seconds / 3600);
            var minutes = Math.floor((seconds % 3600) / 60);
            if (hours > 0) {
                return minutes > 0 ? (hours + ' 小时 ' + minutes + ' 分钟') : (hours + ' 小时');
            }
            return Math.max(1, Math.round(seconds / 60)) + ' 分钟';
        },
        /* ---------- 审计日志 ---------- */
        openAudit: function () {
            this.auditVisible = true;
            this.loadAudit(1);
        },
        loadAudit: function (page) {
            var self = this;
            this.auditLoading = true;
            this.auditPage = page || 1;
            http.get('/api/audit', {
                params: {
                    action: this.auditAction || undefined,
                    keyword: this.auditKeyword || undefined,
                    page: this.auditPage,
                    size: this.auditPageSize
                }
            }).then(function (d) {
                self.auditItems = (d && d.items) || [];
                self.auditTotal = (d && d.total) || 0;
                self.auditPage = (d && d.page) || self.auditPage;
            }).catch(function () { /* 已由拦截器提示 */ })
                .then(function () {
                    self.auditLoading = false;
                });
        },
        exportAudit: function () {
            var q = [];
            if (this.auditAction) q.push('action=' + encodeURIComponent(this.auditAction));
            if (this.auditKeyword) q.push('keyword=' + encodeURIComponent(this.auditKeyword));
            window.location.href = '/api/audit/export' + (q.length ? ('?' + q.join('&')) : '');
        },
        auditActionLabel: function (action) {
            for (var i = 0; i < this.auditActions.length; i++) {
                if (this.auditActions[i][0] === action) {
                    return this.auditActions[i][1];
                }
            }
            return action || '';
        },
        copyText: function (text) {
            var done = function () {
                // 长文本（如进程命令行）截断展示，避免提示框被撑爆
                var shown = text.length > 60 ? text.slice(0, 60) + '…' : text;
                ELEMENT.Message.success('已复制: ' + shown);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(function () {
                    var ta = document.createElement('textarea');
                    ta.value = text;
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
                    ta.remove();
                    done();
                });
            } else {
                var ta2 = document.createElement('textarea');
                ta2.value = text;
                document.body.appendChild(ta2);
                ta2.select();
                try { document.execCommand('copy'); } catch (e) { /* ignore */ }
                ta2.remove();
                done();
            }
        },
        loadAppInfo: function () {
            var self = this;
            http.get('/api/app-info').then(function (d) {
                if (d) {
                    self.appInfo = d;
                }
            }).catch(function () { /* 忽略 */ });
        },
        /* ---------- 绿色版首次运行引导 ---------- */
        maybeShowOnboarding: function () {
            var self = this;
            http.get('/api/app-integration/status').then(function (d) {
                if (d && d.local && d.firstRun) {
                    self.onboardingVisible = true;
                }
            }).catch(function () { /* 忽略：非绿色版或非本机访问 */ });
        },
        onOnboardingDone: function () {
            this.onboardingVisible = false;
            this._onboardingMarked = true;
        },
        dismissOnboarding: function () {
            this.onboardingVisible = false;
            if (this._onboardingMarked) {
                return;
            }
            this._onboardingMarked = true;
            http.post('/api/app-integration/onboarding', {}).catch(function () { /* 忽略 */ });
        },
        /* ---------- 外部调用 / 跳板机客户端（deepshell://） ---------- */
        openProtocolDialog: function () {
            this.protocolVisible = true;
            this.loadProtocolStatus();
        },
        loadProtocolStatus: function () {
            var self = this;
            this.protocolLoading = true;
            return http.get('/api/protocol/status').then(function (d) {
                if (d) {
                    self.protocolInfo = d;
                }
            }).catch(function () { /* 已由拦截器提示 */ }).then(function () {
                self.protocolLoading = false;
            });
        },
        reregisterProtocol: function () {
            var self = this;
            this.protocolLoading = true;
            http.post('/api/protocol/register').then(function (d) {
                if (d) {
                    self.protocolInfo = d;
                }
                self.loadAppInfo();
                if (d && d.state === 'REGISTERED') {
                    ELEMENT.Message.success('已注册 ' + (d.scheme || 'deepshell') + ':// 协议');
                } else {
                    ELEMENT.Message.warning((d && d.detail) || '注册未完成，请查看状态说明');
                }
            }).catch(function () { /* 已由拦截器提示 */ }).then(function () {
                self.protocolLoading = false;
            });
        },
        protocolStateText: function (state) {
            var value = state || (this.protocolInfo && this.protocolInfo.state) || '';
            var map = {
                REGISTERED: '已注册',
                PENDING: '注册中',
                DISABLED: '已关闭',
                UNSUPPORTED: '当前环境不支持',
                DEVELOPMENT: '开发模式未注册',
                FAILED: '注册失败'
            };
            return map[value] || (value || '未知');
        },
        protocolStateType: function (state) {
            var value = state || (this.protocolInfo && this.protocolInfo.state) || '';
            if (value === 'REGISTERED') {
                return 'success';
            }
            if (value === 'FAILED') {
                return 'error';
            }
            if (value === 'DEVELOPMENT' || value === 'PENDING') {
                return 'warning';
            }
            return 'info';
        },
        copyProtocolLink: function () {
            this.copyText(this.protocolExampleLink);
        },
        copyConnectionOpenLink: function (id) {
            this.connMenuKey = null;
            var c = null;
            for (var i = 0; i < this.connections.length; i++) {
                if (this.connections[i].id === id) {
                    c = this.connections[i];
                    break;
                }
            }
            if (!c) {
                ELEMENT.Message.warning('连接不存在或已被删除');
                return;
            }
            this.copyText('deepshell://connect?id=' + c.id);
        },
        /* ---------- HTTP 集成接口（JumpServer / 门户） ---------- */
        openIntegrationDialog: function () {
            this.integrationVisible = true;
            this.loadIntegrationStatus();
        },
        loadIntegrationStatus: function () {
            var self = this;
            this.integrationLoading = true;
            return http.get('/api/integration/status').then(function (d) {
                if (d) {
                    self.integrationInfo = d;
                }
            }).catch(function () { /* 已由拦截器提示 */ }).then(function () {
                self.integrationLoading = false;
            });
        },
        regenerateIntegrationToken: function () {
            var self = this;
            this.$confirm('重新生成后，现有 JumpServer / 门户配置的 Token 将立即失效。确定继续？',
                '重新生成集成 Token', { type: 'warning' })
                .then(function () {
                    return http.post('/api/integration/token/regenerate');
                })
                .then(function (d) {
                    if (d) {
                        self.integrationInfo = d;
                    }
                    self.loadAppInfo();
                    ELEMENT.Message.success('已重新生成集成接口 Token');
                })
                .catch(function () { /* 取消或已由拦截器提示 */ });
        },
        copyIntegrationEndpoint: function () {
            this.copyText(this.integrationEndpointUrl);
        },
        copyIntegrationToken: function () {
            if (!this.integrationInfo.token) {
                ELEMENT.Message.warning('Token 尚未生成');
                return;
            }
            this.copyText(this.integrationInfo.token);
        },
        copyIntegrationCurl: function () {
            if (!this.integrationInfo.token) {
                ELEMENT.Message.warning('Token 尚未生成');
                return;
            }
            this.copyText(this.integrationCurl);
        },
        /* ---------- 工作台事件通道：HTTP 接口打开连接 ---------- */
        connectWorkspaceEvents: function () {
            var self = this;
            if (this._eventClosed) {
                return;
            }
            if (this._eventWs && (this._eventWs.readyState === 0 || this._eventWs.readyState === 1)) {
                return;
            }
            var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
            var ws = new WebSocket(proto + location.host + '/ws/events');
            this._eventWs = ws;
            ws.onmessage = function (ev) {
                var msg = null;
                try { msg = JSON.parse(ev.data); } catch (e) { return; }
                self.onWorkspaceEvent(msg);
            };
            ws.onclose = function () {
                if (self._eventWs !== ws) {
                    return;
                }
                self._eventWs = null;
                if (!self._eventClosed) {
                    setTimeout(function () { self.connectWorkspaceEvents(); }, 3000);
                }
            };
            ws.onerror = function () {
                try { ws.close(); } catch (e) { /* ignore */ }
            };
        },
        onWorkspaceEvent: function (msg) {
            if (!msg) {
                return;
            }
            if (msg.type === 'connections-changed') {
                this.loadConnections();
                return;
            }
            if (msg.type === 'update-available') {
                var info = msg.info || {};
                var self = this;
                if (this.desktop.visible) {
                    this.pushDesktopNotice('info', '发现 DeepShell 新版本',
                        (info.latestVersion || '') + ' 可用，可在「设置 → 系统信息 → 应用与更新」中查看');
                }
                ELEMENT.Notification({
                    title: '发现 DeepShell 新版本',
                    message: 'v' + (info.latestVersion || '') + ' 可用。点击打开「关于 → 应用与更新」，再点「检查更新」查看说明。',
                    type: 'info',
                    duration: 0,
                    onClick: function () {
                        self.loadAppInfo();
                        self.aboutVisible = true;
                    }
                });
                return;
            }
            if (msg.type !== 'open-connection') {
                return;
            }
            var connId = Number(msg.connId);
            if (!connId) {
                return;
            }
            var self = this;
            var source = msg.source || '';
            var view = msg.view || '';
            var path = msg.workspaceUrl || ('/workspace?connId=' + connId + '&external=1');
            this.loadConnections().then(function () {
                var conn = self.connections.find(function (c) { return c.id === connId; });
                if (!conn) {
                    ELEMENT.Message.warning('接口请求打开的连接不存在或已被删除');
                    return;
                }
                if (self.desktop.visible) {
                    // 桌面内不能安全地原地插入一个工作台标签，打开新浏览器标签页
                    var win = window.open(path, '_blank');
                    if (!win) {
                        ELEMENT.Notification({
                            title: '接口请求打开连接',
                            message: '点击打开「' + conn.name + '」' + (source ? ' · ' + source : ''),
                            type: 'success',
                            duration: 0,
                            onClick: function () {
                                window.open(path, '_blank');
                            }
                        });
                    }
                    return;
                }
                var forceWorkbench = view === 'workbench';
                var forceDesktop = view === 'desktop';
                var auto = !forceWorkbench;
                var tab = self.openTab(connId, null, auto, forceDesktop);
                if (tab) {
                    ELEMENT.Message.success('接口已打开「' + conn.name + '」'
                        + (source ? ' · 来源：' + source : ''));
                }
            });
        },
        exportConns: function () {
            var a = document.createElement('a');
            a.href = '/api/connections/export';
            document.body.appendChild(a);
            a.click();
            a.remove();
        },
        /* ---------- 连接导入（文件 / SSH config / PuTTY） ---------- */
        openConnImport: function (tab) {
            this.connImportTab = tab || 'file';
            this.connImportVisible = true;
        },
        onExternalImported: function () {
            this.connImportVisible = false;
            this.loadConnections();
            this.loadFolders();
        },
        /* ---------- 连接导入（支持一次多选多个文件） ---------- */
        onImportFilesChange: function (file) {
            var self = this;
            this._importFiles = this._importFiles || [];
            if (file && file.raw) {
                this._importFiles.push(file.raw);
            }
            clearTimeout(this._importTimer);
            this._importTimer = setTimeout(function () {
                self.importConnsBatch();
            }, 120);
        },
        importConnsBatch: function () {
            var files = this._importFiles || [];
            this._importFiles = [];
            if (!files.length) {
                return;
            }
            var fd = new FormData();
            files.forEach(function (f) {
                fd.append('file', f);
            });
            var self = this;
            http.post('/api/connections/import', fd).then(function (r) {
                ELEMENT.Message.success(r && r.message ? r.message : '导入完成');
                self.connImportVisible = false;
                self.loadConnections();
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        /* ---------- 连接导出（弹窗勾选） ---------- */
        openConnExport: function () {
            var self = this;
            Promise.all([this.loadConnections(), this.loadFolders()]).then(function () {
                self.connExportChecked = self.connections.map(function (c) { return c.id; });
                self.connExportVisible = true;
            });
        },
        connExportLabel: function (c) {
            if (!c.folderId) {
                return c.name;
            }
            var f = this.folders.find(function (x) { return x.id === c.folderId; });
            return (f ? f.name + ' / ' : '') + c.name;
        },
        toggleAllExport: function (checked) {
            this.connExportChecked = checked ? this.connections.map(function (c) { return c.id; }) : [];
        },
        exportConnsSelected: function () {
            var ids = this.connExportChecked || [];
            if (!ids.length) {
                ELEMENT.Message.warning('请至少勾选一个连接');
                return;
            }
            var a = document.createElement('a');
            a.href = '/api/connections/export?ids=' + ids.join(',');
            document.body.appendChild(a);
            a.click();
            a.remove();
            this.connExportVisible = false;
            ELEMENT.Message.success('已导出 ' + ids.length + ' 个连接');
        },
        /* ---------- 系统备份与还原 ---------- */
        openBackupDialog: function () {
            this.topMenuVisible = false;
            this.topSubMenu = '';
            this.backupVisible = true;
            this.backupResult = null;
            this.backupRestored = false;
            this.backupFile = null;
            this.backupFileName = '';
            this.backupFileSize = 0;
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.backupFileInput) {
                    self.$refs.backupFileInput.value = '';
                }
            });
        },
        pickBackupFile: function () {
            var el = this.$refs.backupFileInput;
            if (el) {
                el.value = '';
                el.click();
            }
        },
        onBackupFilePick: function (ev) {
            var input = ev.target;
            var file = input.files && input.files[0];
            input.value = '';
            if (!file) {
                return;
            }
            if (!/\.zip$/i.test(file.name)) {
                ELEMENT.Message.warning('请选择 DeepShell 备份 ZIP 文件');
                return;
            }
            this.backupFile = file;
            this.backupFileName = file.name;
            this.backupFileSize = file.size || 0;
        },
        formatBackupSize: function (bytes) {
            var size = Number(bytes) || 0;
            if (size < 1024) {
                return size + ' B';
            }
            if (size < 1024 * 1024) {
                return (size / 1024).toFixed(1) + ' KB';
            }
            if (size < 1024 * 1024 * 1024) {
                return (size / 1024 / 1024).toFixed(1) + ' MB';
            }
            return (size / 1024 / 1024 / 1024).toFixed(2) + ' GB';
        },
        backupCountItems: function (counts) {
            var defs = [
                ['connections', '连接'], ['folders', '文件夹'], ['quickCommands', '快捷命令'],
                ['commonDirs', '常用目录'], ['portForwards', '端口转发'], ['knownHosts', '已知主机'],
                ['desktopLayouts', '桌面布局'], ['aiConversations', 'AI 对话'], ['sshKeys', 'SSH 私钥'],
                ['plugins', '插件'], ['backgrounds', '背景图'], ['pluginDataFiles', '插件数据文件']
            ];
            var data = counts || {};
            return defs.map(function (d) {
                return { label: d[1], value: Number(data[d[0]] || 0) };
            });
        },
        backupErrorText: function (err) {
            if (err && err.response && err.response.data) {
                var data = err.response.data;
                if (typeof data.text === 'function') {
                    return data.text().then(function (text) {
                        try {
                            var json = JSON.parse(text);
                            return json.msg || json.message || '操作失败';
                        } catch (e) {
                            return text ? text.slice(0, 300) : '操作失败';
                        }
                    }).catch(function () {
                        return '操作失败';
                    });
                }
                if (typeof data === 'string') {
                    return Promise.resolve(data.slice(0, 300));
                }
            }
            return Promise.resolve((err && err.message) ? err.message : '操作失败');
        },
        showBackupError: function (err) {
            this.backupErrorText(err).then(function (msg) {
                ELEMENT.Message.error(msg, { duration: 7000, showClose: true });
            });
        },
        backupWarnings: function (resp) {
            var header = resp && resp.headers && (resp.headers['x-backup-warnings']
                || resp.headers['X-Backup-Warnings']);
            if (!header) {
                return [];
            }
            try {
                var bin = atob(header.replace(/-/g, '+').replace(/_/g, '/'));
                var bytes = new Uint8Array(bin.length);
                for (var i = 0; i < bin.length; i++) {
                    bytes[i] = bin.charCodeAt(i);
                }
                return new TextDecoder('utf-8').decode(bytes).split('\n').filter(function (s) {
                    return !!s;
                });
            } catch (e) {
                return [];
            }
        },
        exportSystemBackup: function () {
            if (this.backupBusy) {
                return;
            }
            var self = this;
            var items = {};
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    var key = localStorage.key(i);
                    if (key && key.indexOf('deepshell.') === 0) {
                        items[key] = localStorage.getItem(key);
                    }
                }
            } catch (e) { /* localStorage 不可用时仍导出服务端配置 */ }
            this.backupBusy = true;
            this.backupAction = 'export';
            this.backupBusyText = '正在收集配置并打包，请稍候…';
            axios.post('/api/backup/export', {
                browser: { origin: location.origin, items: items }
            }, { responseType: 'blob', timeout: 0 }).then(function (resp) {
                var blob = resp.data;
                if (blob && blob.type && blob.type.indexOf('json') >= 0) {
                    return blob.text().then(function (text) {
                        var json = null;
                        try { json = JSON.parse(text); } catch (e) { /* ignore */ }
                        throw new Error((json && json.msg) ? json.msg : '导出失败');
                    });
                }
                var name = 'deepshell-backup.zip';
                var cd = (resp.headers && (resp.headers['content-disposition']
                    || resp.headers['Content-Disposition'])) || '';
                var matched = /filename="?([^";]+)"?/i.exec(cd);
                if (matched && matched[1]) {
                    name = matched[1].replace(/"/g, '');
                }
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
                var warnings = self.backupWarnings(resp);
                if (warnings.length) {
                    ELEMENT.Message.warning('备份已导出，但部分文件未包含：'
                        + warnings.slice(0, 3).join('；'), { duration: 9000, showClose: true });
                } else {
                    ELEMENT.Message.success('备份已导出：' + name, { duration: 5000, showClose: true });
                }
            }).catch(function (err) {
                self.showBackupError(err);
            }).then(function () {
                self.backupBusy = false;
                self.backupAction = '';
            });
        },
        importSystemBackup: function () {
            if (!this.backupFile || this.backupBusy) {
                return;
            }
            var self = this;
            this.$confirm('还原会覆盖当前所有连接与密码、快捷命令、AI 对话、桌面外观、背景图、插件与插件数据，'
                + '且无法撤销；备份中的插件后端会以本机权限运行。确定继续？', '覆盖并还原', {
                type: 'warning',
                confirmButtonText: '覆盖并还原',
                cancelButtonText: '取消'
            }).then(function () {
                var fd = new FormData();
                fd.append('file', self.backupFile, self.backupFileName || 'backup.zip');
                self.backupBusy = true;
                self.backupAction = 'import';
                self.backupBusyText = '正在校验备份并还原，请勿关闭页面…';
                self.backupResult = null;
                return axios.post('/api/backup/import', fd, { timeout: 0 }).then(function (resp) {
                    var body = resp.data;
                    if (!body || body.code !== 0) {
                        throw new Error((body && body.msg) ? body.msg : '还原失败');
                    }
                    var result = body.data || {};
                    var failed = self.applyBackupBrowserSettings(result.browser);
                    if (failed > 0) {
                        result.warnings = result.warnings || [];
                        result.warnings.push(failed + ' 项浏览器设置因存储空间不足未能恢复');
                    }
                    self.backupResult = result;
                    self.backupRestored = true;
                    self.backupFile = null;
                    self.backupFileName = '';
                    self.backupFileSize = 0;
                    ELEMENT.Message.success('还原完成，请刷新页面加载新配置');
                });
            }).catch(function (err) {
                if (err === 'cancel' || err === 'close') {
                    return;
                }
                self.showBackupError(err);
            }).then(function () {
                self.backupBusy = false;
                self.backupAction = '';
            });
        },
        applyBackupBrowserSettings: function (browser) {
            if (!browser || !browser.items) {
                return 0;
            }
            var items = browser.items;
            var keys = [];
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    var key = localStorage.key(i);
                    if (key && key.indexOf('deepshell.') === 0) {
                        keys.push(key);
                    }
                }
                keys.forEach(function (key) {
                    localStorage.removeItem(key);
                });
            } catch (e) {
                return 0;
            }
            var failed = 0;
            Object.keys(items).forEach(function (key) {
                if (key.indexOf('deepshell.') !== 0) {
                    return;
                }
                try {
                    localStorage.setItem(key, items[key]);
                } catch (e) {
                    failed++;
                }
            });
            return failed;
        },
        buildTermTheme: function () {
            var th = {};
            for (var k in TERM_THEME) {
                if (Object.prototype.hasOwnProperty.call(TERM_THEME, k)) {
                    th[k] = TERM_THEME[k];
                }
            }
            th.background = this.bgSettings.url ? 'rgba(16, 19, 24, 0.72)' : '#101318';
            return th;
        },
        allTerminalTabs: function () {
            var out = this.tabs.slice();
            this.desktop.windows.forEach(function (w) {
                if (w.type === 'terminal' && w.termTab) {
                    out.push(w.termTab);
                }
            });
            return out;
        },
        applyFont: function () {
            var self = this;
            var f = this.fontSettings;
            try { localStorage.setItem('deepshell.font', JSON.stringify(f)); } catch (e) { /* ignore */ }
            this.allTerminalTabs().forEach(function (x) {
                if (x.term) {
                    x.term.options.fontFamily = f.family;
                    x.term.options.fontSize = f.size;
                    self.$nextTick(function () {
                        if (x.fit) {
                            try { x.fit.fit(); } catch (e) { /* ignore */ }
                        }
                    });
                }
            });
        },
        applyBg: function () {
            try { localStorage.setItem('deepshell.bg', JSON.stringify(this.bgSettings)); } catch (e) { /* ignore */ }
            var theme = this.buildTermTheme();
            this.allTerminalTabs().forEach(function (x) {
                if (x.term) {
                    x.term.options.theme = theme;
                }
            });
        },
        applyDesktopBg: function (tab) {
            var t = tab || this.desktopTab;
            if (!t || !t.desktopBg) {
                return;
            }
            var key = t.connId != null ? 'deepshell.desktopBg.' + t.connId : 'deepshell.desktopBg';
            try {
                localStorage.setItem(key, JSON.stringify(t.desktopBg));
            } catch (e) { /* ignore */ }
        },
        openBgSettings: function (target) {
            this.bgTarget = target === 'desktop' ? 'desktop' : 'terminal';
            var s = this.bgTarget === 'desktop' ? this.desktopBgSettings : this.bgSettings;
            this.bgDraft = {
                url: s.url || '',
                opacity: s.opacity != null ? s.opacity : 0.35,
                blur: s.blur || 0
            };
            this.bgVisible = true;
        },
        applyBgDraft: function () {
            if (this.bgTarget === 'desktop') {
                var t = this.desktopTab;
                if (!t || !t.desktopBg) {
                    return;
                }
                t.desktopBg.url = this.bgDraft.url;
                t.desktopBg.opacity = this.bgDraft.opacity;
                t.desktopBg.blur = this.bgDraft.blur;
                this.applyDesktopBg(t);
            } else {
                this.bgSettings.url = this.bgDraft.url;
                this.bgSettings.opacity = this.bgDraft.opacity;
                this.bgSettings.blur = this.bgDraft.blur;
                this.applyBg();
            }
        },
        uploadBg: function (param) {
            var self = this;
            var fd = new FormData();
            fd.append('file', param.file);
            var url = this.bgTarget === 'desktop' ? '/api/desktop-bg' : '/api/terminal-bg';
            if (this.bgTarget === 'desktop') {
                var t = this.desktopTab;
                if (t && t.connId != null) {
                    fd.append('connId', t.connId);
                }
            }
            http.post(url, fd).then(function (imgUrl) {
                self.bgDraft.url = imgUrl;
                self.applyBgDraft();
                ELEMENT.Message.success(self.bgTarget === 'desktop' ? '桌面背景已设置' : '终端背景已设置');
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        clearBg: function () {
            this.bgDraft.url = '';
            this.applyBgDraft();
            ELEMENT.Message.success('已清除背景');
        },
        allTerminalTabs: function () {
            var out = (this.tabs || []).slice();
            (this.desktop.windows || []).forEach(function (w) {
                if (w.type === 'terminal' && w.termTab) {
                    out.push(w.termTab);
                }
            });
            return out;
        },
        toggleTermAutoScroll: function (tab) {
            if (!tab) {
                return;
            }
            tab.termAutoScrollEnabled = !tab.termAutoScrollEnabled;
            if (tab.termAutoScrollEnabled && tab.term) {
                try { tab.term.scrollToBottom(); } catch (e) { /* ignore */ }
            }
        },
        resetTermLogStream: function (tab, flush) {
            if (!tab) {
                return;
            }
            if (flush && tab._termLogPending && tab.term) {
                try { tab.term.write(tab._termLogPending); } catch (e) { /* ignore */ }
            }
            tab._termLogPending = '';
            try {
                tab._termLogDecoder = (typeof TextDecoder !== 'undefined')
                    ? new TextDecoder('utf-8') : null;
            } catch (e) {
                tab._termLogDecoder = null;
            }
        },
        resetAllTermLogStreams: function (flush) {
            var self = this;
            this.allTerminalTabs().forEach(function (t) {
                self.resetTermLogStream(t, flush);
            });
        },
        writeTermOutput: function (tab, term, data) {
            if (!term || data == null) {
                return;
            }
            var isBuffer = (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer);
            var isBytes = isBuffer
                || (typeof Uint8Array !== 'undefined' && data instanceof Uint8Array);
            var bytes = isBytes ? (isBuffer ? new Uint8Array(data) : data) : null;
            if (!this.termLogHighlightEnabled || !bytes || !tab || !tab._termLogDecoder) {
                term.write(bytes || data);
                return;
            }
            try {
                var active = term.buffer && term.buffer.active;
                if (active && active.type === 'alternate') {
                    tab._termLogPending = '';
                    term.write(bytes);
                    return;
                }
                var text = tab._termLogDecoder.decode(bytes, { stream: true });
                if (!text) {
                    return;
                }
                var result = terminalLogHighlightChunk(tab._termLogPending, text);
                tab._termLogPending = result.pending;
                if (result.out) {
                    term.write(result.out);
                }
            } catch (e) {
                try { term.write(bytes); } catch (err) { /* ignore */ }
            }
        },
        initTerminal: function (tab, el) {
            var self = this;
            if (!el) {
                var ref = tab.desktopOnly && tab.windowId
                    ? this.$refs['desk-term-' + tab.windowId]
                    : this.$refs['term-' + tab.key];
                el = Array.isArray(ref) ? ref[0] : ref;
            }
            if (!el) {
                return;
            }
            var term = new Terminal({
                fontFamily: this.fontSettings.family,
                fontSize: this.fontSettings.size,
                cursorBlink: true,
                scrollback: 5000,
                allowTransparency: true,
                allowProposedApi: true,
                theme: this.buildTermTheme()
            });
            var fit = new FitAddon.FitAddon();
            term.loadAddon(fit);
            if (window.SearchAddon && window.SearchAddon.SearchAddon) {
                var searchAddon = new SearchAddon.SearchAddon();
                term.loadAddon(searchAddon);
                tab.searchAddon = searchAddon;
                if (searchAddon.onDidChangeResults) {
                    searchAddon.onDidChangeResults(function (ev) {
                        tab.searchResultIndex = ev.resultIndex;
                        tab.searchResultCount = ev.resultCount;
                    });
                }
            }
            term.open(el);
            try { fit.fit(); } catch (e) { /* 容器未就绪时忽略 */ }
            tab.term = term;
            tab.fit = fit;
            self.bindTerminalContextMenu(tab, el);
            tab._dangerInput = '';
            tab._dangerInputUnknown = false;
            tab._termLogPending = '';
            try {
                tab._termLogDecoder = (typeof TextDecoder !== 'undefined')
                    ? new TextDecoder('utf-8') : null;
            } catch (e) {
                tab._termLogDecoder = null;
            }
            if (typeof term.onWriteParsed === 'function') {
                term.onWriteParsed(function () {
                    if (tab.termAutoScrollEnabled) {
                        try { term.scrollToBottom(); } catch (e) { /* ignore */ }
                    }
                });
            }

            term.onData(function (data) {
                if (tab.localShell && tab.localLineMode) {
                    self.handleLocalLineInput(tab, term, data);
                    return;
                }
                var newlineCount = (String(data).match(/\r\n|\r|\n/g) || []).length;
                var audit = self.terminalAuditCommand(tab);
                var auditTyped = false;
                var auditSkip = false;
                var auditLine = '';
                if (newlineCount === 0) {
                    auditTyped = true;
                    auditSkip = !(audit && audit.prompt);
                } else if (newlineCount === 1) {
                    auditTyped = true;
                    if (audit && audit.prompt) {
                        var rawCommand = String(data)
                            .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
                            .replace(/[\r\n]+$/, '')
                            .replace(/[\x00-\x1f\x7f]/g, '')
                            .trim();
                        auditLine = audit.command || rawCommand;
                    } else {
                        auditSkip = true;
                    }
                } else if (!audit || !audit.prompt) {
                    auditTyped = true;
                    auditSkip = true;
                }
                var sendData = function () {
                    if (tab.ws && tab.ws.readyState === 1) {
                        var frame = { type: 'data', data: data };
                        if (auditTyped) {
                            frame.auditTyped = true;
                            if (auditSkip) {
                                frame.auditSkip = true;
                            } else if (newlineCount === 1 && auditLine) {
                                frame.auditLine = auditLine;
                            }
                        }
                        tab.ws.send(JSON.stringify(frame));
                    }
                };
                if (newlineCount === 0) {
                    self.trackTerminalDangerInput(tab, data);
                    sendData();
                    return;
                }
                var typed = tab._dangerInputUnknown ? ''
                    : ((tab._dangerInput || '') + data);
                tab._dangerInput = '';
                tab._dangerInputUnknown = false;
                var line = self.terminalCommandLine(tab);
                if (line === null) {
                    // vim / less 等全屏程序直接放行，避免把界面内容误判为命令
                    sendData();
                    return;
                }
                var hit = null;
                if (typed.trim()) {
                    var typedRule = dangerousCommandRule(typed);
                    if (typedRule) {
                        hit = {
                            rule: typedRule,
                            display: typed.replace(/[\r\n]+$/, '').trim()
                        };
                    }
                }
                if (!hit && line && line.trim()) {
                    var lineRule = dangerousCommandRule(line.replace(/[$#]\s+/g, '\n'));
                    if (lineRule) {
                        var stripped = line.replace(/^.*?[$#]\s+/, '').trim();
                        hit = { rule: lineRule, display: stripped || line.trim() };
                    }
                }
                if (!hit) {
                    var plainData = String(data).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
                    var dataRule = dangerousCommandRule(plainData);
                    if (dataRule) {
                        hit = { rule: dataRule, display: plainData.replace(/[\r\n]+/g, ' ').trim() };
                    }
                }
                if (!hit) {
                    sendData();
                    return;
                }
                self.confirmDangerousCommand(hit.display || data, sendData, hit.rule);
            });
            term.onResize(function (size) {
                if (tab.ws && tab.ws.readyState === 1) {
                    tab.ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
                }
            });
            term.focus();

            var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
            var url;
            if (tab.localShell) {
                url = proto + location.host + '/ws/local-shell?cols=' + (term.cols || 120)
                    + '&rows=' + (term.rows || 30)
                    + '&sid=' + encodeURIComponent(tab.clientKey || '');
            } else {
                url = proto + location.host + '/ws/ssh?connId=' + tab.connId
                    + '&cols=' + (term.cols || 120) + '&rows=' + (term.rows || 30)
                    + '&sid=' + encodeURIComponent(tab.clientKey || '');
            }
            var ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';
            tab.ws = ws;

            ws.onmessage = function (ev) {
                if (typeof ev.data === 'string') {
                    var msg;
                    try { msg = JSON.parse(ev.data); } catch (e) { return; }
                    if (msg.type === 'open') {
                        tab.sessionId = tab.localShell ? null : msg.sessionId;
                        tab.localPty = !!msg.pty;
                        if (tab.localShell) {
                            tab.localLineMode = !msg.pty;
                            tab._localLine = '';
                            tab._localPrompt = false;
                        }
                        tab.status = 'open';
                        tab.serverClosed = false;
                        tab.explicitClose = false;
                        tab.hostKeyPending = false;
                        tab.reconnectAttempts = 0;
                        tab.helpShown = false;
                        clearReconnectTimer(tab);
                        if (tab.notifyDisconnect) {
                            tab.notifyDisconnect = false;
                            if (self.desktop.visible && self.desktopTab
                                    && self.desktopTab.connId === tab.connId) {
                                self.pushDesktopNotice('success', '连接已恢复', tab.title);
                            }
                        }
                        if (msg.notice) {
                            term.write('\r\n\x1b[33m● ' + msg.notice + '\x1b[0m\r\n');
                        }
                        if (!tab.localShell && tab.desktopOnly && tab.initialDir && !msg.reattached) {
                            try {
                                ws.send(JSON.stringify({
                                    type: 'data',
                                    data: 'cd ' + quoteShellPath(tab.initialDir) + '\r',
                                    audit: false
                                }));
                            } catch (e) { /* ignore */ }
                        }
                        var dirReady = Promise.resolve();
                        if (!tab.desktopOnly) {
                            if (msg.reattached) {
                                // 服务端会紧接着发来最近输出快照，先清屏避免重复
                                try { term.reset(); } catch (e) { /* ignore */ }
                                self.resetTermLogStream(tab, false);
                                dirReady = tab.sftpHome
                                    ? self.loadDir(tab.sftpPath || tab.sftpHome, tab)
                                    : self.loadHome(tab);
                            } else {
                                dirReady = self.loadHome(tab);
                            }
                        }
                        if (tab.autoOpenDesktop) {
                            tab.autoOpenDesktop = false;
                            self.openDesktopAfterConnect(tab, dirReady);
                        }
                        if (self.desktop.visible && tab.key === self.desktop.tabKey) {
                            self.refreshDesktopAfterReconnect(tab, dirReady);
                        }
                    } else if (msg.type === 'hostkey') {
                        tab.status = 'error';
                        tab.serverClosed = true;
                        clearReconnectTimer(tab);
                        self.showHostKeyPrompt(tab, msg.hostKey);
                    } else if (msg.type === 'error') {
                        tab.status = 'error';
                        tab.serverClosed = true;
                        tab.helpShown = tab.helpShown || false;
                        clearReconnectTimer(tab);
                        term.write('\r\n\x1b[31m● ' + msg.message + '\x1b[0m\r\n');
                        if (msg.diagnosis && !tab.helpShown) {
                            tab.helpShown = true;
                            self.showConnectionHelp(tab, msg.diagnosis);
                        }
                    } else if (msg.type === 'closed') {
                        tab.status = 'closed';
                        // 远端中断（如服务器重启）仍交给 onclose 按退避策略自动重连，避免只能手动恢复
                        tab.serverClosed = false;
                        clearReconnectTimer(tab);
                        term.write('\r\n\x1b[33m● ' + (msg.message || '连接已关闭') + '\x1b[0m\r\n');
                    } else if (msg.type === 'stats') {
                        tab.stats = msg.data;
                    } else if (msg.type === 'cwd') {
                        self.onTermCwd(tab, msg.path);
                    }
                } else {
                    self.writeTermOutput(tab, term, ev.data);
                }
            };
            ws.onclose = function () {
                if (tab.localShell) {
                    tab.status = tab.explicitClose ? 'closed'
                        : (tab.status === 'error' ? 'error' : 'closed');
                    return;
                }
                if (tab.explicitClose || tab.serverClosed) {
                    tab.status = tab.status === 'error' ? 'error' : 'closed';
                    return;
                }
                if (tab.status === 'error') {
                    return;
                }
                if (tab.status === 'open') {
                    tab.notifyDisconnect = true;
                    if (self.desktop.visible && self.desktopTab
                            && self.desktopTab.connId === tab.connId) {
                        self.pushDesktopNotice('warning', '连接已断开', tab.title + '：正在自动重连');
                    }
                }
                scheduleReconnect(self, tab);
            };
        },
        activate: function (key) {
            var self = this;
            if (this.splitKeys.length > 1 && this.splitKeys.indexOf(key) < 0) {
                this.clearTerminalSplit();
            }
            this.activeKey = key;
            if (this.activeTab && this.activeTab.sftpSelected && this.activeTab.sftpSelected.length) {
                this.activeTab.sftpSelected = [];
                this.$nextTick(function () {
                    if (self.$refs.sftpTable) {
                        self.$refs.sftpTable.clearSelection();
                    }
                });
            }
            saveOpenTabs(this);
            this.$nextTick(function () {
                var t = self.activeTab;
                if (self.splitKeys.length > 1) {
                    self.fitSplitPanes();
                } else if (t && t.fit) {
                    try { t.fit.fit(); } catch (e) { /* ignore */ }
                }
                if (t && t.term) {
                    t.term.focus();
                }
                if (t && t.sessionId && self.panelVisible && self.panelTab === 'process') {
                    self.loadProcesses(t);
                }
            });
        },
        closeTab: function (tab) {
            var self = this;
            if (this.desktop.visible && tab.key === this.desktop.tabKey) {
                this.closeAiDesktop();
            }
            var splitIdx = this.splitKeys.indexOf(tab.key);
            var wasActive = this.activeKey === tab.key;
            this.cancelTransfersForTab(tab);
            clearReconnectTimer(tab);
            tab.explicitClose = true;
            tab.serverClosed = true;
            if (tab.ws) {
                try {
                    if (tab.ws.readyState === 1) {
                        tab.ws.send(JSON.stringify({ type: 'close' }));
                    }
                    tab.ws.close();
                } catch (e) { /* ignore */ }
            }
            if (tab.term) {
                try { tab.term.dispose(); } catch (e) { /* ignore */ }
            }
            var idx = this.tabs.indexOf(tab);
            if (idx >= 0) {
                this.tabs.splice(idx, 1);
            }
            if (splitIdx >= 0) {
                this.splitKeys.splice(splitIdx, 1);
                this.splitSizes.splice(splitIdx, 1);
                if (this.splitKeys.length > 1) {
                    this.normalizeSplitSizes();
                    if (wasActive) {
                        this.activeKey = this.splitKeys[Math.min(splitIdx, this.splitKeys.length - 1)];
                    }
                } else {
                    var remaining = this.splitKeys[0] || '';
                    this.splitKeys = [];
                    this.splitSizes = [];
                    this.splitDir = '';
                    if (remaining) {
                        this.activeKey = remaining;
                    } else if (wasActive) {
                        var next = this.tabs[Math.max(0, idx - 1)];
                        this.activeKey = next ? next.key : '';
                    }
                }
            } else if (wasActive) {
                if (this.splitKeys.length > 1) {
                    this.splitKeys = [];
                    this.splitSizes = [];
                    this.splitDir = '';
                }
                var fallback = this.tabs[Math.max(0, idx - 1)];
                this.activeKey = fallback ? fallback.key : '';
            }
            saveOpenTabs(this);
            this.saveSplitState();
            this.$nextTick(function () {
                self.fitActive();
                if (self.activeTab && self.activeTab.term) {
                    try { self.activeTab.term.focus(); } catch (e) { /* ignore */ }
                }
            });
        },
        /* ---------- 刷新恢复上次打开的会话 ---------- */
        restoreOpenTabs: function () {
            var saved = null;
            try {
                saved = JSON.parse(sessionStorage.getItem('deepshell.openTabs') || 'null');
            } catch (e) { /* ignore */ }
            if (!saved) {
                return;
            }
            var entries = [];
            if (saved.tabs && saved.tabs.length) {
                entries = saved.tabs.map(function (t) {
                    return { connId: t.connId, key: t.key };
                });
            } else if (saved.ids && saved.ids.length) {
                // 兼容旧版本的 { ids, active }
                entries = saved.ids.map(function (id) {
                    return { connId: id, key: null };
                });
            }
            if (!entries.length) {
                return;
            }
            var self = this;
            var missing = 0;
            entries.forEach(function (entry) {
                var exists = self.connections.some(function (c) { return c.id === entry.connId; });
                if (exists) {
                    self.openTab(entry.connId, entry.key);
                } else {
                    missing++;
                }
            });
            var activeKey = saved.activeKey || null;
            if (!activeKey && saved.active) {
                var legacy = this.tabs.find(function (t) { return t.connId === saved.active; });
                activeKey = legacy ? legacy.clientKey : null;
            }
            if (activeKey) {
                var at = this.tabs.find(function (t) { return t.clientKey === activeKey; });
                if (at) {
                    this.activate(at.key);
                }
            }
            if (this.tabs.length) {
                ELEMENT.Message.success('已恢复 ' + this.tabs.length + ' 个会话（正在恢复连接）');
            }
            if (missing > 0) {
                ELEMENT.Message.warning(missing + ' 个连接已不存在，未恢复');
            }
            this.restoreSplitState();
        },
        /* ---------- 标签右键菜单 ---------- */
        onTabContextMenu: function (ev, tab) {
            this.tabMenu = {
                visible: true,
                x: Math.max(8, Math.min(ev.clientX, window.innerWidth - 150)),
                y: Math.max(8, Math.min(ev.clientY, window.innerHeight - 420)),
                tab: tab
            };
        },
        menuAction: function (mode) {
            var tab = this.tabMenu.tab;
            this.tabMenu.visible = false;
            if (!tab) {
                return;
            }
            var idx = this.tabs.indexOf(tab);
            if (idx < 0) {
                return;
            }
            var self = this;
            if (mode === 'reconnect') {
                this.reconnectTab(tab);
            } else if (mode === 'disconnect') {
                this.disconnectTab(tab);
            } else if (mode === 'editConn') {
                this.editConnFromDialog(tab.connId);
            } else if (mode === 'duplicateTab') {
                this.openTab(tab.connId);
            } else if (mode === 'aiDesktop') {
                this.openDesktopInNewTab(tab);
            } else if (mode === 'copyIp') {
                if (tab.host) {
                    this.copyText(tab.host);
                } else {
                    ELEMENT.Message.warning('未找到该连接的地址信息');
                }
            } else if (mode === 'portfwd') {
                this.openPortForwards(tab);
            } else if (mode === 'sysinfo') {
                if (!tab.sessionId) {
                    ELEMENT.Message.warning('该标签尚未连接，无法获取系统信息');
                } else {
                    this.sysInfoTitle = tab.title;
                    this.sysInfoSessionId = tab.sessionId;
                    this.sysInfo = null;
                    this.sysInfoError = '';
                    this.sysInfoVisible = true;
                }
            } else if (mode === 'close') {
                this.closeTab(tab);
            } else if (mode === 'closeAll') {
                this.tabs.slice().forEach(function (x) { self.closeTab(x); });
            } else if (mode === 'closeOthers') {
                this.tabs.slice().forEach(function (x) {
                    if (x !== tab) {
                        self.closeTab(x);
                    }
                });
            } else if (mode === 'closeRight') {
                this.tabs.slice(idx + 1).forEach(function (x) { self.closeTab(x); });
            } else if (mode === 'closeLeft') {
                this.tabs.slice(0, idx).forEach(function (x) { self.closeTab(x); });
            }
        },
        reconnectTab: function (tab, silent) {
            var self = this;
            clearReconnectTimer(tab);
            // 连接可能已在连接管理中改过名称/地址，重连时同步到标签
            var conn = this.connections.find(function (c) { return c.id === tab.connId; });
            if (conn) {
                tab.title = conn.name;
                tab.host = conn.host;
                tab.port = conn.port || 22;
            }
            // 静默回收旧连接与终端，避免旧回调写入已销毁的终端
            tab.explicitClose = true;
            if (tab.ws) {
                try {
                    tab.ws.onclose = null;
                    tab.ws.onmessage = null;
                    tab.ws.close();
                } catch (e) { /* ignore */ }
                tab.ws = null;
            }
            if (tab.term) {
                try { tab.term.dispose(); } catch (e) { /* ignore */ }
                tab.term = null;
                tab.fit = null;
                tab.searchAddon = null;
            }
            tab.sessionId = null;
            tab.status = silent ? 'reconnecting' : 'connecting';
            tab.explicitClose = false;
            tab.serverClosed = false;
            tab.hostKeyPending = false;
            if (!silent) {
                tab.reconnectAttempts = 0;
                tab.sftpEntries = [];
                tab.sftpPath = '';
                tab.sftpHome = null;
                tab.sftpHistory = [];
                tab.termCwd = null;
                tab.diskEntries = [];
                tab.diskTotalKb = null;
                tab.diskError = '';
                tab.diskTruncated = false;
                tab.stats = null;
                tab.procList = [];
                tab._comp = null;
            }
            if (this.tabs.indexOf(tab) >= 0) {
                this.activate(tab.key);
            }
            this.$nextTick(function () {
                self.initTerminal(tab);
                self.fitTab(tab);
            });
        },
        /* ---------- 主机指纹确认 ---------- */
        showHostKeyPrompt: function (tab, info) {
            if (tab) {
                tab.hostKeyPending = true;
                clearReconnectTimer(tab);
            }
            this.hostKeyChecked = false;
            this.hostKeyPrompt = { tab: tab, info: info || {} };
            this.hostKeyVisible = true;
        },
        cancelHostKeyPrompt: function () {
            var p = this.hostKeyPrompt;
            if (p && p.tab) {
                p.tab.hostKeyPending = false;
                p.tab.status = 'error';
                p.tab.serverClosed = true;
                if (p.tab.term) {
                    p.tab.term.write('\r\n\x1b[33m● 已取消：主机指纹未信任，连接未建立\x1b[0m\r\n');
                }
            }
            this.hostKeyVisible = false;
            this.hostKeyChecked = false;
            this.hostKeyPrompt = null;
        },
        trustHostKey: function () {
            var p = this.hostKeyPrompt;
            if (!p || !p.info) {
                return;
            }
            if (!this.hostKeyChecked) {
                ELEMENT.Message.warning('请先核对指纹，并勾选“我已核对”');
                return;
            }
            var info = p.info;
            var self = this;
            this.hostKeyTrusting = true;
            http.post('/api/known-hosts/trust', {
                host: info.host, port: info.port, keyType: info.keyType,
                keyBase64: info.keyBase64, replace: !!info.changed,
                role: info.role, roleLabel: info.roleLabel
            }).then(function () {
                self.hostKeyTrusting = false;
                self.hostKeyVisible = false;
                self.hostKeyChecked = false;
                self.hostKeyPrompt = null;
                if (p.tab) {
                    p.tab.hostKeyPending = false;
                    self.reconnectTab(p.tab, false);
                }
            }).catch(function () {
                self.hostKeyTrusting = false;
            });
        },
        /* ---------- 连接失败按类型给步骤 ---------- */
        showConnectionHelp: function (tab, diagnosis) {
            if (!diagnosis) {
                return;
            }
            this.connHelpTab = tab || null;
            this.connHelpError = diagnosis;
            this.connHelpVisible = true;
        },
        editConnectionFromHelp: function () {
            var tab = this.connHelpTab;
            this.connHelpVisible = false;
            if (!tab || tab.connId == null) {
                return;
            }
            this.editConnFromDialog(tab.connId);
        },
        /* ---------- 端口转发 ---------- */
        openPortForwards: function (tab) {
            if (!tab || tab.connId == null) {
                ELEMENT.Message.warning('当前会话没有连接信息');
                return;
            }
            this.pfTab = tab;
            this.pfEditId = null;
            this.pfForm = emptyPfForm();
            this.pfForm.connectionId = tab.connId;
            this.pfVisible = true;
            this.loadPortForwards();
        },
        loadPortForwards: function () {
            var t = this.pfTab;
            if (!t || t.connId == null) {
                return;
            }
            var self = this;
            var qs = '?connectionId=' + encodeURIComponent(t.connId)
                + (t.sessionId ? '&sessionId=' + encodeURIComponent(t.sessionId) : '');
            this.pfLoading = true;
            http.get('/api/port-forwards' + qs).then(function (d) {
                self.pfRules = d || [];
            }).catch(function () { /* 已提示 */ })
                .then(function () { self.pfLoading = false; });
        },
        resetPfForm: function () {
            var connId = this.pfTab ? this.pfTab.connId : null;
            this.pfEditId = null;
            this.pfForm = emptyPfForm();
            this.pfForm.connectionId = connId;
        },
        editPf: function (row) {
            this.pfEditId = row.id;
            this.pfForm = {
                connectionId: row.connectionId, direction: row.direction,
                bindHost: row.bindHost, bindPort: row.bindPort,
                destHost: row.destHost, destPort: row.destPort,
                autoStart: !!row.autoStart
            };
        },
        savePf: function () {
            var f = this.pfForm;
            var t = this.pfTab;
            if (!t) {
                return;
            }
            if (!f.destHost || !f.destHost.trim()) {
                ELEMENT.Message.warning('请填写目标地址');
                return;
            }
            if (!f.bindPort || !f.destPort) {
                ELEMENT.Message.warning('请填写监听端口和目标端口');
                return;
            }
            var self = this;
            var body = {
                connectionId: t.connId, direction: f.direction, bindHost: f.bindHost,
                bindPort: f.bindPort, destHost: f.destHost, destPort: f.destPort,
                autoStart: f.autoStart
            };
            var qs = t.sessionId ? '?sessionId=' + encodeURIComponent(t.sessionId) : '';
            var req = this.pfEditId
                ? http.put('/api/port-forwards/' + this.pfEditId + qs, body)
                : http.post('/api/port-forwards' + qs, body);
            this.pfSaving = true;
            req.then(function () {
                ELEMENT.Message.success('转发规则已保存');
                self.resetPfForm();
                self.loadPortForwards();
            }).catch(function () { /* 已提示 */ })
                .then(function () { self.pfSaving = false; });
        },
        startPf: function (row) {
            var t = this.pfTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('请等待当前连接建立后再启动');
                return;
            }
            var self = this;
            http.post('/api/port-forwards/' + row.id + '/start?sessionId='
                + encodeURIComponent(t.sessionId)).then(function (rt) {
                if (rt && rt.error) {
                    ELEMENT.Message.error(rt.error);
                } else {
                    ELEMENT.Message.success('端口转发已启动');
                }
                self.loadPortForwards();
            }).catch(function () { /* 已提示 */ });
        },
        stopPf: function (row) {
            var t = this.pfTab;
            if (!t || !t.sessionId) {
                return;
            }
            var self = this;
            http.post('/api/port-forwards/' + row.id + '/stop?sessionId='
                + encodeURIComponent(t.sessionId)).then(function () {
                ELEMENT.Message.success('端口转发已停止');
                self.loadPortForwards();
            }).catch(function () { /* 已提示 */ });
        },
        deletePf: function (row) {
            var t = this.pfTab;
            var self = this;
            this.$confirm('删除转发规则「' + row.bindHost + ':' + row.bindPort + ' → '
                + row.destHost + ':' + row.destPort + '」？', '删除转发规则',
                { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
                .then(function () {
                    var qs = t && t.sessionId ? '?sessionId=' + encodeURIComponent(t.sessionId) : '';
                    return http.delete('/api/port-forwards/' + row.id + qs);
                }).then(function () {
                    ELEMENT.Message.success('已删除');
                    if (self.pfEditId === row.id) {
                        self.resetPfForm();
                    }
                    self.loadPortForwards();
                }).catch(function () { /* 取消或已提示 */ });
        },
        disconnectTab: function (tab) {
            this.cancelTransfersForTab(tab);
            clearReconnectTimer(tab);
            tab.explicitClose = true;
            tab.serverClosed = true;
            if (tab.ws && (tab.ws.readyState === 0 || tab.ws.readyState === 1)) {
                try {
                    if (tab.ws.readyState === 1) {
                        tab.ws.send(JSON.stringify({ type: 'close' }));
                    }
                    tab.ws.close();
                } catch (e) { /* ignore */ }
            }
            tab.status = 'closed';
            if (tab.term) {
                tab.term.write('\r\n\x1b[33m● 已断开\x1b[0m\r\n');
            }
        },
        /* ---------- 终端分屏 ---------- */
        isTermVisible: function (t) {
            if (!t) {
                return false;
            }
            if (this.splitKeys.length > 1) {
                return this.splitKeys.indexOf(t.key) >= 0;
            }
            return t.key === this.activeKey;
        },
        termPaneStyle: function (t) {
            if (!t || this.splitKeys.length < 2) {
                return {};
            }
            var idx = this.splitKeys.indexOf(t.key);
            if (idx < 0) {
                return {};
            }
            var size = Number(this.splitSizes[idx]) || 1;
            return {
                order: idx * 2,
                flexGrow: size,
                flexShrink: 1,
                flexBasis: '0px'
            };
        },
        onTermPaneMouseDown: function (t) {
            if (!t || this.splitKeys.length < 2 || this.splitKeys.indexOf(t.key) < 0) {
                return;
            }
            if (this.activeKey === t.key) {
                return;
            }
            this.activate(t.key);
        },
        /** 分屏按钮 = 追加窗格；已有左右/上下分屏后不能切换方向。 */
        splitTerminal: function (dir) {
            if (dir !== 'row' && dir !== 'col') {
                return;
            }
            var main = this.activeTab;
            if (!main) {
                return;
            }
            if (main.connId == null || main.localShell) {
                ELEMENT.Message.warning('当前终端不支持分屏');
                return;
            }
            if (this.splitKeys.length > 1) {
                if (this.splitDir !== dir || this.splitKeys.indexOf(main.key) < 0) {
                    return;
                }
            } else {
                this.splitDir = dir;
                this.splitKeys = [main.key];
                this.splitSizes = [100];
            }
            var secondary = null;
            for (var i = 0; i < this.tabs.length; i++) {
                var x = this.tabs[i];
                if (x === main || x.desktopOnly || x.connId !== main.connId) {
                    continue;
                }
                if (this.splitKeys.indexOf(x.key) >= 0) {
                    continue;
                }
                secondary = x;
                break;
            }
            if (!secondary) {
                this._creatingSplitTab = true;
                try {
                    secondary = this.openTab(main.connId, null, false, false);
                } finally {
                    this._creatingSplitTab = false;
                }
            }
            if (!secondary) {
                if (this.splitKeys.length < 2) {
                    this.splitKeys = [];
                    this.splitSizes = [];
                    this.splitDir = '';
                }
                ELEMENT.Message.warning('无法创建分屏终端');
                return;
            }
            if (this.splitKeys.indexOf(secondary.key) < 0) {
                var count = this.splitKeys.length;
                var nextSize = 100 / (count + 1);
                var resized = [];
                for (var j = 0; j < count; j++) {
                    resized.push((Number(this.splitSizes[j]) || 0) * count / (count + 1));
                }
                resized.push(nextSize);
                this.splitKeys.push(secondary.key);
                this.splitSizes = resized;
            }
            this.splitDir = dir;
            this.normalizeSplitSizes();
            this.activeKey = secondary.key;
            saveOpenTabs(this);
            this.saveSplitState();
            var app = this;
            this.$nextTick(function () {
                setTimeout(function () {
                    app.fitSplitPanes();
                    if (secondary.term) {
                        try { secondary.term.focus(); } catch (e) { /* ignore */ }
                    }
                }, 80);
            });
        },
        askCloseSplitPane: function (tab) {
            if (!tab || this.splitKeys.length < 2) {
                return;
            }
            var title = tab.title || ('连接 #' + tab.connId);
            var self = this;
            this.$confirm('确定关闭分屏「' + title + '」？对应终端会话将断开。', '关闭分屏',
                { type: 'warning', confirmButtonText: '关闭分屏', cancelButtonText: '取消' })
                .then(function () {
                    self.closeTab(tab);
                }).catch(function () { /* 取消 */ });
        },
        clearTerminalSplit: function () {
            this.splitKeys = [];
            this.splitSizes = [];
            this.splitDir = '';
            this.saveSplitState();
        },
        normalizeSplitSizes: function () {
            var count = this.splitKeys.length;
            if (count <= 0) {
                this.splitSizes = [];
                return;
            }
            var sizes = [];
            var total = 0;
            for (var i = 0; i < count; i++) {
                var size = Math.max(0.1, Number(this.splitSizes[i]) || 0);
                sizes.push(size);
                total += size;
            }
            if (total <= 0) {
                var equal = 100 / count;
                for (var j = 0; j < count; j++) {
                    sizes[j] = equal;
                }
            } else {
                for (var k = 0; k < count; k++) {
                    sizes[k] = sizes[k] * 100 / total;
                }
            }
            this.splitSizes = sizes;
        },
        saveSplitState: function () {
            try {
                if (this.splitKeys.length > 1
                        && (this.splitDir === 'row' || this.splitDir === 'col')) {
                    var keys = [];
                    var sizes = [];
                    for (var i = 0; i < this.splitKeys.length; i++) {
                        var key = this.splitKeys[i];
                        var tab = null;
                        for (var j = 0; j < this.tabs.length; j++) {
                            if (this.tabs[j].key === key) {
                                tab = this.tabs[j];
                                break;
                            }
                        }
                        if (tab) {
                            keys.push(tab.clientKey);
                            sizes.push(Number(this.splitSizes[i]) || 1);
                        }
                    }
                    if (keys.length > 1) {
                        sessionStorage.setItem('deepshell.split', JSON.stringify({
                            dir: this.splitDir,
                            keys: keys,
                            sizes: sizes
                        }));
                        return;
                    }
                }
                sessionStorage.removeItem('deepshell.split');
            } catch (e) { /* ignore */ }
        },
        restoreSplitState: function () {
            var state = null;
            try {
                state = JSON.parse(sessionStorage.getItem('deepshell.split') || 'null');
            } catch (e) {
                state = null;
            }
            if (!state || !state.keys || state.keys.length < 2
                    || (state.dir !== 'row' && state.dir !== 'col')) {
                try { sessionStorage.removeItem('deepshell.split'); } catch (e) { /* ignore */ }
                return;
            }
            var byClient = {};
            this.tabs.forEach(function (t) {
                if (t.clientKey) {
                    byClient[t.clientKey] = t;
                }
            });
            var keys = [];
            var sizes = [];
            for (var i = 0; i < state.keys.length; i++) {
                var tab = byClient[state.keys[i]];
                if (tab) {
                    keys.push(tab.key);
                    sizes.push(Number((state.sizes || [])[i]) || 1);
                }
            }
            if (keys.length < 2) {
                try { sessionStorage.removeItem('deepshell.split'); } catch (e) { /* ignore */ }
                return;
            }
            this.splitDir = state.dir;
            this.splitKeys = keys;
            this.splitSizes = sizes;
            this.normalizeSplitSizes();
            if (this.splitKeys.indexOf(this.activeKey) < 0) {
                this.activeKey = this.splitKeys[0];
                saveOpenTabs(this);
            }
            this.saveSplitState();
            var self = this;
            this.$nextTick(function () {
                setTimeout(function () {
                    self.fitSplitPanes();
                }, 120);
            });
        },
        startSplitResize: function (ev, dividerIndex) {
            if (!ev || (ev.button !== undefined && ev.button !== 0)
                    || this.splitKeys.length < 2) {
                return;
            }
            var container = this.$refs.termPanes;
            var index = Number(dividerIndex);
            if (!container || !(index >= 0 && index + 1 < this.splitKeys.length)) {
                return;
            }
            var keyA = this.splitKeys[index];
            var keyB = this.splitKeys[index + 1];
            var elA = container.querySelector('[data-term-key="' + keyA + '"]');
            var elB = container.querySelector('[data-term-key="' + keyB + '"]');
            if (!elA || !elB) {
                return;
            }
            var rectA = elA.getBoundingClientRect();
            var rectB = elB.getBoundingClientRect();
            var row = this.splitDir === 'row';
            var pxA = row ? rectA.width : rectA.height;
            var pxB = row ? rectB.width : rectB.height;
            if (pxA <= 0 || pxB <= 0) {
                return;
            }
            this._splitDrag = {
                index: index,
                row: row,
                start: row ? ev.clientX : ev.clientY,
                pxA: pxA,
                pxB: pxB,
                pxSum: pxA + pxB,
                wA: Number(this.splitSizes[index]) || 1,
                wB: Number(this.splitSizes[index + 1]) || 1
            };
            document.body.classList.add('split-resizing');
            if (!row) {
                document.body.classList.add('split-resizing-col');
            }
            window.addEventListener('mousemove', this.onSplitResizeMove);
            window.addEventListener('mouseup', this.onSplitResizeEnd);
            ev.preventDefault();
        },
        onSplitResizeMove: function (ev) {
            var drag = this._splitDrag;
            if (!drag) {
                return;
            }
            var delta = (drag.row ? ev.clientX : ev.clientY) - drag.start;
            var min = Math.min(120, Math.max(40, drag.pxSum * 0.2));
            min = Math.min(min, drag.pxSum / 2);
            var max = drag.pxSum - min;
            var newA = Math.max(min, Math.min(max, drag.pxA + delta));
            var totalWeight = drag.wA + drag.wB;
            var wA = totalWeight * newA / drag.pxSum;
            this.$set(this.splitSizes, drag.index, wA);
            this.$set(this.splitSizes, drag.index + 1, totalWeight - wA);
            if (ev.preventDefault) {
                ev.preventDefault();
            }
        },
        onSplitResizeEnd: function () {
            if (!this._splitDrag) {
                return;
            }
            this._splitDrag = null;
            document.body.classList.remove('split-resizing');
            document.body.classList.remove('split-resizing-col');
            window.removeEventListener('mousemove', this.onSplitResizeMove);
            window.removeEventListener('mouseup', this.onSplitResizeEnd);
            this.saveSplitState();
            var self = this;
            this.$nextTick(function () {
                self.fitSplitPanes();
            });
        },
        fitSplitPanes: function () {
            if (this.splitKeys.length > 1) {
                var self = this;
                this.splitKeys.forEach(function (key) {
                    var tab = null;
                    for (var i = 0; i < self.tabs.length; i++) {
                        if (self.tabs[i].key === key) {
                            tab = self.tabs[i];
                            break;
                        }
                    }
                    if (tab) {
                        self.fitTab(tab);
                    }
                });
                return;
            }
            var active = this.activeTab;
            if (active) {
                this.fitTab(active);
            }
        },
        fitActive: function () {
            if (this.splitKeys.length > 1) {
                this.fitSplitPanes();
                return;
            }
            var t = this.activeTab;
            if (t && t.fit) {
                try { t.fit.fit(); } catch (e) { /* ignore */ }
            }
        },
        statusText: function (tab) {
            var map = { connecting: '连接中…', reconnecting: '重连中…', open: '已连接', closed: '已断开', error: '连接失败' };
            return map[tab.status] || tab.status;
        },
        connAddress: function (tab) {
            if (!tab || !tab.host) {
                return '';
            }
            return tab.host + ':' + (tab.port || 22);
        },

        /* ---------- SFTP ---------- */
        loadHome: function (tab) {
            var self = this;
            return http.get('/api/sftp/home', { params: { sessionId: tab.sessionId } }).then(function (home) {
                tab.sftpHome = home;
                return self.loadDir(home, tab);
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        loadDir: function (path, tab, nav) {
            tab = tab || this.activeTab;
            if (!tab || !tab.sessionId) {
                return;
            }
            var self = this;
            var prevPath = tab.sftpPath;
            tab.sftpLoading = true;
            return http.get('/api/sftp/list', { params: { sessionId: tab.sessionId, path: path } }).then(function (list) {
                // 路径确实变化且非「返回」时记录旧路径，供返回按钮回退
                if (nav !== 'back' && prevPath && path !== prevPath
                        && tab.sftpHistory[tab.sftpHistory.length - 1] !== prevPath) {
                    tab.sftpHistory.push(prevPath);
                    if (tab.sftpHistory.length > 50) {
                        tab.sftpHistory.shift();
                    }
                }
                tab.sftpEntries = list || [];
                tab.sftpSelected = [];
                tab.sftpPath = path;
                tab.sftpLoading = false;
                if (tab === self.activeTab && self.$refs.sftpTable) {
                    self.$nextTick(function () {
                        if (self.$refs.sftpTable) {
                            self.$refs.sftpTable.clearSelection();
                        }
                    });
                }
            }).catch(function () {
                // 「返回」加载失败时把目标路径放回栈，避免目录临时不可用导致历史丢失
                if (nav === 'back') {
                    tab.sftpHistory.push(path);
                }
                tab.sftpLoading = false;
            });
        },
        sftpGoBack: function () {
            var t = this.activeTab;
            if (!t || !t.sessionId || t.sftpLoading || !t.sftpHistory.length) {
                return;
            }
            var path = t.sftpHistory.pop();
            this.loadDir(path, t, 'back');
        },
        /* ---------- 终端目录跟随（cd 后 SFTP 同步切换） ---------- */
        onTermCwd: function (tab, path) {
            if (!tab || !path || tab.termCwd === path) {
                return;
            }
            tab.termCwd = path;
            if (tab.desktopOnly) {
                return;
            }
            if (!this.sftpFollow || !tab.sessionId) {
                return;
            }
            // 仅当路径确实变化（真实 cd）时联动；用户手动浏览 SFTP 不受影响，直到下次 cd
            if (tab.sftpPath !== path) {
                this.loadDir(path, tab);
            }
        },
        toggleSftpFollow: function () {
            this.sftpFollow = !this.sftpFollow;
            var t = this.activeTab;
            if (this.sftpFollow && t && t.sessionId && t.termCwd && t.termCwd !== t.sftpPath) {
                this.loadDir(t.termCwd, t);
            }
            ELEMENT.Message.success(this.sftpFollow
                ? '已开启：文件面板跟随终端 cd 目录'
                : '已关闭目录跟随');
        },
        pathJoin: function (dir, name) {
            if (!dir || dir === '/') {
                return '/' + name;
            }
            return dir.replace(/\/+$/, '') + '/' + name;
        },
        enterDir: function (row) {
            var t = this.activeTab;
            this.loadDir(this.pathJoin(t.sftpPath, row.name), t);
        },
        refreshSftp: function () {
            var t = this.activeTab;
            if (!t || !t.sessionId || t.sftpLoading) {
                return;
            }
            this.loadDir(t.sftpPath || t.sftpHome || '/', t);
        },
        gotoParent: function () {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                return;
            }
            var p = (t.sftpPath || '/').replace(/\/+$/, '');
            var idx = p.lastIndexOf('/');
            this.loadDir(idx <= 0 ? '/' : p.substring(0, idx), t);
        },
        onNameClick: function (row) {
            if (row.dir) {
                this.enterDir(row);
            }
        },
        onRowDblclick: function (row) {
            if (row.dir) {
                this.enterDir(row);
            } else {
                this.openEdit(row);
            }
        },
        onSftpSelectionChange: function (rows) {
            var t = this.activeTab;
            if (t) {
                t.sftpSelected = rows || [];
            }
        },
        clearSftpSelection: function () {
            if (this.$refs.sftpTable) {
                this.$refs.sftpTable.clearSelection();
            }
            var t = this.activeTab;
            if (t) {
                t.sftpSelected = [];
            }
        },
        fileIcon: function (row) {
            if (row.dir) {
                return 'el-icon-folder';
            }
            if (row.link) {
                return 'el-icon-link';
            }
            return 'el-icon-document';
        },
        fmtSize: function (n) {
            if (n == null) {
                return '';
            }
            if (n < 1024) {
                return n + ' B';
            }
            var units = ['KB', 'MB', 'GB', 'TB'];
            var v = n / 1024;
            var i = 0;
            while (v >= 1024 && i < units.length - 1) {
                v /= 1024;
                i++;
            }
            return v.toFixed(1) + ' ' + units[i];
        },
        fmtTime: function (ms) {
            if (!ms) {
                return '';
            }
            var d = new Date(ms);
            var p = function (x) { return (x < 10 ? '0' : '') + x; };
            return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
                + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        },
        fmtRate: function (bps) {
            if (bps == null) {
                return '--';
            }
            if (bps < 1024) {
                return bps + ' B/s';
            }
            var units = ['KB/s', 'MB/s', 'GB/s'];
            var v = bps / 1024;
            var i = 0;
            while (v >= 1024 && i < units.length - 1) {
                v /= 1024;
                i++;
            }
            return v.toFixed(1) + ' ' + units[i];
        },
        fmtMb: function (mb) {
            if (mb == null) {
                return '--';
            }
            return mb < 1024 ? mb + ' MB' : (mb / 1024).toFixed(1) + ' GB';
        },
        fmtKb: function (kb) {
            if (kb == null) {
                return '--';
            }
            return this.fmtMb(Math.round(kb / 1024));
        },
        fmtUptime: function (secs) {
            if (secs == null) {
                return '--';
            }
            var d = Math.floor(secs / 86400);
            var h = Math.floor(secs % 86400 / 3600);
            var m = Math.floor(secs % 3600 / 60);
            if (d > 0) {
                return d + ' 天 ' + h + ' 小时';
            }
            if (h > 0) {
                return h + ' 小时 ' + m + ' 分钟';
            }
            return m + ' 分钟';
        },
        levelClass: function (v) {
            if (v == null) {
                return '';
            }
            if (v >= 85) {
                return 'lv-err';
            }
            if (v >= 60) {
                return 'lv-warn';
            }
            return 'lv-ok';
        },
        statTooltip: function (tab) {
            var st = tab.stats;
            if (!st) {
                return '';
            }
            return '主机: ' + (st.host || '--')
                + ' ｜ 内存: ' + this.fmtMb(st.memUsedMb) + ' / ' + this.fmtMb(st.memTotalMb)
                + (st.swapTotalMb ? (' ｜ 交换: ' + this.fmtMb(st.swapUsedMb) + ' / ' + this.fmtMb(st.swapTotalMb)) : ' ｜ 交换: 未启用')
                + ' ｜ 负载: ' + (st.load1 || '--')
                + ' ｜ 已运行: ' + this.fmtUptime(st.uptimeSecs);
        },
        download: function (row) {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                return;
            }
            this.downloadPath(t, this.pathJoin(t.sftpPath, row.name));
        },
        downloadPath: function (tab, path) {
            var local = !!(tab && tab.local);
            if (!tab || (!local && !tab.sessionId)) {
                return;
            }
            var self = this;
            var name = path.substring(path.lastIndexOf('/') + 1) || path;
            if (local) {
                this.triggerDownload('/api/local/fs/download?path=' + encodeURIComponent(path), name);
                return;
            }
            var url = '/api/sftp/download?sessionId=' + encodeURIComponent(tab.sessionId)
                + '&path=' + encodeURIComponent(path);
            this.createDownloadTask(name).then(function (task) {
                var item = self.addDownloadTransfer(task, name, tab);
                self.triggerDownload(url + '&taskId=' + encodeURIComponent(task.id), name);
                self.pollDownloadTask(item);
            }).catch(function () {
                // 任务接口异常时退化为普通下载，至少不阻断下载本身
                self.triggerDownload(url, name);
            });
        },
        triggerDownload: function (url, name) {
            var a = document.createElement('a');
            a.href = url;
            if (name) {
                a.download = name;
            }
            document.body.appendChild(a);
            a.click();
            a.remove();
        },
        createDownloadTask: function (name) {
            return http.post('/api/downloads/tasks', { name: name });
        },
        addDownloadTransfer: function (task, name, tab) {
            var item = {
                id: 'rd' + (task && task.id ? task.id : (Date.now().toString(36) + Math.random().toString(36).slice(2, 6))),
                kind: 'download',
                taskId: task ? task.id : '',
                name: name,
                rel: name,
                size: (task && task.totalBytes) || 0,
                offset: (task && task.doneBytes) || 0,
                status: (task && task.status) || 'downloading',
                error: '',
                tabKey: tab ? tab.key : '',
                clientKey: tab ? tab.clientKey : '',
                _timer: null
            };
            return this.pushTransfer(item);
        },
        pollDownloadTask: function (item) {
            if (!item || !item.taskId || item._timer) {
                return;
            }
            var self = this;
            var tick = function () {
                http.get('/api/downloads/tasks/' + encodeURIComponent(item.taskId)).then(function (t) {
                    if (!t) {
                        return;
                    }
                    if (t.totalBytes) {
                        item.size = t.totalBytes;
                    }
                    item.offset = t.doneBytes || 0;
                    item.status = t.status || item.status;
                    item.error = t.error || '';
                    if (item.status === 'error') {
                        // 浏览器可能正在自动续传：保留轮询，任务重新进入下载中时继续显示进度
                        if (!item._errorSince) {
                            item._errorSince = Date.now();
                        }
                        if (Date.now() - item._errorSince < 30000) {
                            return;
                        }
                    } else {
                        item._errorSince = 0;
                    }
                    if (item.status === 'done' || item.status === 'error' || item.status === 'cancelled') {
                        clearInterval(item._timer);
                        item._timer = null;
                        if (item.status === 'done') {
                            item.offset = item.size || item.offset;
                        }
                    }
                }).catch(function () {
                    if (!item._timer) {
                        return;
                    }
                    clearInterval(item._timer);
                    item._timer = null;
                    item.status = 'error';
                    item.error = '无法获取下载进度';
                });
            };
            item._timer = setInterval(tick, 700);
            tick();
        },
        /** 文件夹先打包成 zip 再下载（复用服务端压缩能力） */
        downloadDir: function (row) {
            var t = this.activeTab;
            if (!t || !t.sessionId || !row.dir) {
                return;
            }
            var self = this;
            var zipName = row.name + '.zip';
            var exists = (t.sftpEntries || []).some(function (e) { return e.name === zipName; });
            if (exists) {
                zipName = row.name + '-' + Date.now() + '.zip';
            }
            http.post('/api/sftp/compress', {
                sessionId: t.sessionId,
                destDir: t.sftpPath,
                paths: [self.pathJoin(t.sftpPath, row.name)],
                name: zipName,
                format: 'zip',
                level: 'normal',
                overwrite: false
            }).then(function (r) {
                var path = (r && r.path) || self.pathJoin(t.sftpPath, zipName);
                self.downloadPath(t, path);
                ELEMENT.Message.success('已生成并开始下载：' + zipName + '（压缩包保留在服务器当前目录）');
                self.loadDir(t.sftpPath, t);
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        /* SFTP 面板多选：后端流式打包下载 */
        sftpDownloadBundle: function () {
            var t = this.activeTab;
            var rows = (t && t.sftpSelected) || [];
            if (!t || !t.sessionId || !rows.length) {
                return;
            }
            var self = this;
            var paths = rows.map(function (r) {
                return self.pathJoin(t.sftpPath, r.name);
            });
            this.requestBundleDownload(t.sessionId, t.sftpPath, paths, rows.length, t);
        },
        /* SFTP 面板多选：逐个下载文件（文件夹跳过） */
        sftpDownloadEach: function () {
            var t = this.activeTab;
            var rows = (t && t.sftpSelected) || [];
            var files = rows.filter(function (r) {
                return !r.dir;
            });
            if (!files.length) {
                ELEMENT.Message.info('所选项目都是文件夹，请使用「打包下载」');
                return;
            }
            var skipped = rows.length - files.length;
            if (skipped) {
                ELEMENT.Message.info('已跳过 ' + skipped + ' 个文件夹，正在逐个下载 '
                    + files.length + ' 个文件');
            } else if (files.length > 1) {
                ELEMENT.Message.info('正在逐个下载 ' + files.length
                    + ' 个文件，若浏览器询问多文件下载请选择允许');
            }
            var self = this;
            files.forEach(function (r, i) {
                setTimeout(function () {
                    self.downloadPath(t, self.pathJoin(t.sftpPath, r.name));
                }, i * 300);
            });
        },
        sftpDownloadToLocal: function () {
            var t = this.activeTab;
            var rows = (t && t.sftpSelected) || [];
            if (!t || !t.sessionId || !rows.length) {
                return;
            }
            var self = this;
            var paths = rows.map(function (r) {
                return self.pathJoin(t.sftpPath, r.name);
            });
            this.startLocalDownload(t.sessionId, t.sftpPath, paths, t.key);
        },

        /* ---------- 下载到本机目录（仅本机访问，后台 SFTP 直写） ---------- */
        loadLocalDownloadStatus: function () {
            var self = this;
            http.get('/api/local-download/status').then(function (d) {
                self.localDownloadStatus = {
                    checked: true,
                    local: !!(d && d.local),
                    available: !!(d && d.available)
                };
            }).catch(function () {
                self.localDownloadStatus = { checked: true, local: false, available: false };
            });
        },
        startLocalDownload: function (sessionId, dir, paths, tabKey) {
            if (!this.localDownloadReady || !sessionId || !paths || !paths.length) {
                return;
            }
            var self = this;
            var pickMsg = ELEMENT.Message({
                message: '请在弹出的本机窗口中选择保存目录，然后点击「选择此目录」…',
                duration: 0,
                showClose: true,
                iconClass: 'el-icon-folder-opened'
            });
            http.post('/api/local-download/pick').then(function (picked) {
                pickMsg.close();
                if (!picked || picked.cancelled) {
                    ELEMENT.Message.info('已取消选择本机目录');
                    return;
                }
                var startMsg = ELEMENT.Message({
                    message: '正在启动后台下载…',
                    duration: 0,
                    iconClass: 'el-icon-loading'
                });
                return http.post('/api/local-download/start', {
                    token: picked.token,
                    sessionId: sessionId,
                    dir: dir,
                    paths: paths
                }).then(function (task) {
                    startMsg.close();
                    self.trackLocalDownload(task, tabKey);
                }).catch(function () {
                    startMsg.close();
                });
            }).catch(function () {
                pickMsg.close();
            });
        },
        trackLocalDownload: function (task, tabKey) {
            if (!task || !task.id) {
                return;
            }
            var item = {
                id: 'dl' + task.id,
                kind: 'localDownload',
                taskId: task.id,
                name: task.subDir ? ('下载到本机 · ' + task.subDir) : '下载到本机',
                rel: task.targetPath || '',
                targetPath: task.targetPath || '',
                status: task.status || 'queued',
                totalFiles: task.totalFiles || 0,
                totalDirs: task.totalDirs || 0,
                totalBytes: task.totalBytes || 0,
                doneFiles: task.doneFiles || 0,
                doneBytes: task.doneBytes || 0,
                currentFile: task.currentFile || '',
                errorCount: task.errorCount || 0,
                errors: task.errors || [],
                renamedCount: task.renamedCount || 0,
                renamed: task.renamed || [],
                error: task.message || '',
                tabKey: tabKey || '',
                _timer: null,
                _finished: false
            };
            this.pushTransfer(item);
            if (item.status === 'done' || item.status === 'error') {
                this.finishLocalDownload(item);
            } else {
                this.pollLocalDownload(item);
            }
        },
        pollLocalDownload: function (item) {
            var self = this;
            var busy = false;
            var tick = function () {
                if (busy || !item._timer) {
                    return;
                }
                busy = true;
                http.get('/api/local-download/tasks/' + encodeURIComponent(item.taskId)).then(function (t) {
                    busy = false;
                    if (!t) {
                        return;
                    }
                    item.status = t.status || item.status;
                    item.totalFiles = t.totalFiles || 0;
                    item.totalDirs = t.totalDirs || 0;
                    item.totalBytes = t.totalBytes || 0;
                    item.doneFiles = t.doneFiles || 0;
                    item.doneBytes = t.doneBytes || 0;
                    item.currentFile = t.currentFile || '';
                    item.errorCount = t.errorCount || 0;
                    item.errors = t.errors || [];
                    item.renamedCount = t.renamedCount || 0;
                    item.renamed = t.renamed || [];
                    item.error = t.message || '';
                    item.targetPath = t.targetPath || item.targetPath;
                    if (t.status === 'cancelled') {
                        clearInterval(item._timer);
                        item._timer = null;
                        item.status = 'cancelled';
                        return;
                    }
                    if (t.status === 'done' || t.status === 'error') {
                        clearInterval(item._timer);
                        item._timer = null;
                        self.finishLocalDownload(item);
                    }
                }).catch(function () {
                    busy = false;
                    if (!item._timer) {
                        return;
                    }
                    clearInterval(item._timer);
                    item._timer = null;
                    item.status = 'error';
                    item.error = '无法获取下载进度';
                    self.finishLocalDownload(item);
                });
            };
            item._timer = setInterval(tick, 700);
            tick();
        },
        finishLocalDownload: function (item) {
            if (item._timer) {
                clearInterval(item._timer);
                item._timer = null;
            }
            if (item._finished) {
                return;
            }
            item._finished = true;
            if (item.status === 'error') {
                ELEMENT.Notification({
                    title: '下载到本机失败',
                    message: item.error || '下载失败',
                    type: 'error',
                    duration: 8000
                });
                this.showLocalDownloadSummary(item);
                return;
            }
            var failed = item.errorCount || (item.errors ? item.errors.length : 0);
            if (failed) {
                item.status = 'partial';
                ELEMENT.Notification({
                    title: '下载到本机完成（有失败项）',
                    message: '已下载 ' + item.doneFiles + '/' + item.totalFiles + ' 个文件，失败 '
                        + failed + ' 个；' + item.targetPath,
                    type: 'warning',
                    duration: 8000
                });
                this.showLocalDownloadSummary(item);
            } else {
                item.status = 'done';
                ELEMENT.Notification({
                    title: '下载到本机完成',
                    message: (item.totalFiles > 0
                        ? '已下载 ' + item.doneFiles + ' 个文件到 ' : '已完成目录创建：') + item.targetPath,
                    type: 'success',
                    duration: 6000
                });
            }
        },
        showLocalDownloadSummary: function (item) {
            this.localDlSummary = { visible: true, item: item };
        },
        openLocalDownloadDir: function () {
            var item = this.localDlSummary.item;
            if (!item || !item.taskId) {
                return;
            }
            http.post('/api/local-download/tasks/' + encodeURIComponent(item.taskId) + '/open')
                .then(function () {
                    ELEMENT.Message.success('已在文件管理器中打开下载目录');
                }).catch(function () { /* 已由拦截器提示 */ });
        },

        /* ---------- SFTP 批量分发 ---------- */
        resetDistributeState: function (mode, extra) {
            this.stopDistributePoll();
            this._distRawFiles = {};
            this._distLastBytes = 0;
            this._distLastAt = 0;
            this._distNotifiedTaskId = '';
            this.distribute = Object.assign({
                visible: true,
                mode: mode || 'local',
                phase: 'edit',
                files: [],
                targetPath: '/',
                keyword: '',
                ids: [],
                dragOver: false,
                starting: false,
                preparePct: 0,
                task: null,
                error: '',
                cancelling: false,
                speed: 0,
                sourceSessionId: '',
                sourceConnId: null,
                sourceDir: ''
            }, extra || {});
        },
        openDistributeDialog: function () {
            this.resetDistributeState('local', {
                targetPath: (this.activeTab && this.activeTab.sftpPath) || '/'
            });
        },
        openCrossTransferDialog: function (win) {
            var t = win ? this.desktopTab : this.activeTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            var rows;
            var sourceDir;
            if (win) {
                rows = this.desktopSelectedRows(win);
                sourceDir = win.path || this.desktop.surface.dir || '/';
            } else {
                rows = t.sftpSelected || [];
                sourceDir = t.sftpPath || t.sftpHome || '/';
            }
            var files = [];
            var skippedDir = 0;
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i];
                if (!r) {
                    continue;
                }
                if (r.dir) {
                    skippedDir++;
                    continue;
                }
                var path = win
                    ? this.desktopEntryPath(r, win)
                    : this.pathJoin(sourceDir, r.name);
                files.push({
                    uid: 'ct' + i + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    name: r.name,
                    size: r.size || 0,
                    path: path
                });
            }
            if (!files.length) {
                ELEMENT.Message.warning(skippedDir ? '跨服务器传输暂只支持文件，请选择文件' : '请先选择要传输的文件');
                return;
            }
            if (skippedDir) {
                ELEMENT.Message.warning('已忽略 ' + skippedDir + ' 个文件夹（暂只支持文件）');
            }
            if (!this.connections.length) {
                this.loadConnections();
            }
            this.resetDistributeState('cross', {
                files: files,
                targetPath: sourceDir,
                sourceSessionId: t.sessionId,
                sourceConnId: t.connId,
                sourceDir: sourceDir
            });
        },
        pickDistributeFiles: function () {
            var el = this.$refs.distFileInput;
            if (el) {
                el.value = '';
                el.click();
            }
        },
        onDistributeFilesPick: function (ev) {
            var list = ev.target.files;
            var files = [];
            for (var i = 0; list && i < list.length; i++) {
                files.push(list[i]);
            }
            ev.target.value = '';
            this.addDistributeFiles(files);
        },
        onDistributeDrop: function (ev) {
            this.distribute.dragOver = false;
            if (this.distribute.mode === 'cross') {
                return;
            }
            var dt = ev.dataTransfer;
            if (!dt) {
                return;
            }
            var files = [];
            var folded = 0;
            if (dt.items && dt.items.length) {
                for (var i = 0; i < dt.items.length; i++) {
                    var item = dt.items[i];
                    if (item.kind !== 'file') {
                        continue;
                    }
                    if (item.webkitGetAsEntry) {
                        var entry = item.webkitGetAsEntry();
                        if (entry && entry.isDirectory) {
                            folded++;
                            continue;
                        }
                    }
                    var f = item.getAsFile();
                    if (f) {
                        files.push(f);
                    }
                }
            } else if (dt.files) {
                for (var j = 0; j < dt.files.length; j++) {
                    files.push(dt.files[j]);
                }
            }
            if (folded) {
                ELEMENT.Message.warning('批量分发暂只支持文件，不支持文件夹');
            }
            this.addDistributeFiles(files);
        },
        addDistributeFiles: function (files) {
            if (!files || !files.length || this.distribute.mode === 'cross') {
                return;
            }
            if (!this._distRawFiles) {
                this._distRawFiles = {};
            }
            if (this.distribute.phase !== 'edit') {
                return;
            }
            var d = this.distribute;
            var skipped = 0;
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                if (!f || !f.name) {
                    continue;
                }
                if (d.files.length >= 500) {
                    ELEMENT.Message.warning('一次最多分发 500 个文件');
                    break;
                }
                var exists = false;
                for (var j = 0; j < d.files.length; j++) {
                    if (d.files[j].name === f.name) {
                        exists = true;
                        break;
                    }
                }
                if (exists) {
                    skipped++;
                    continue;
                }
                var uid = 'df' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
                this._distRawFiles[uid] = f;
                d.files.push({ uid: uid, name: f.name, size: f.size || 0 });
            }
            if (skipped > 0) {
                ELEMENT.Message.warning('已忽略 ' + skipped + ' 个同名文件');
            }
        },
        removeDistributeFile: function (index) {
            var removed = this.distribute.files.splice(index, 1)[0];
            if (removed && this._distRawFiles) {
                delete this._distRawFiles[removed.uid];
            }
        },
        clearDistributeFiles: function () {
            this.distribute.files = [];
            this._distRawFiles = {};
        },
        toggleDistributeTarget: function (id) {
            var ids = this.distribute.ids;
            var i = ids.indexOf(id);
            if (i >= 0) {
                ids.splice(i, 1);
            } else {
                ids.push(id);
            }
        },
        selectAllDistributeTargets: function () {
            var ids = [];
            for (var i = 0; i < this.distributeTargets.length; i++) {
                ids.push(this.distributeTargets[i].id);
            }
            this.distribute.ids = ids;
        },
        clearDistributeTargets: function () {
            this.distribute.ids = [];
        },
        connectionIsOpen: function (id) {
            for (var i = 0; i < this.tabs.length; i++) {
                if (this.tabs[i].connId === id && this.tabs[i].sessionId) {
                    return true;
                }
            }
            return false;
        },
        startDistribute: function () {
            var d = this.distribute;
            if (d.starting) {
                return;
            }
            if (!d.files.length) {
                ELEMENT.Message.warning(d.mode === 'cross' ? '请先选择要传输的文件' : '请先选择要分发的文件');
                return;
            }
            if (!d.ids.length) {
                ELEMENT.Message.warning('请选择至少一台目标服务器');
                return;
            }
            if (String(d.targetPath || '').trim().charAt(0) !== '/') {
                ELEMENT.Message.warning('目标目录必须是绝对路径，例如 /opt/app');
                return;
            }
            var self = this;
            if (d.mode === 'cross') {
                var paths = d.files.map(function (f) { return f.path; }).filter(function (p) {
                    return !!p;
                });
                if (!paths.length) {
                    ELEMENT.Message.warning('请先选择要传输的文件');
                    return;
                }
                d.starting = true;
                d.phase = 'run';
                d.task = null;
                d.error = '';
                d.preparePct = 10;
                d.speed = 0;
                this._distLastBytes = 0;
                this._distLastAt = 0;
                http.post('/api/sftp/distribute/cross', {
                    sessionId: d.sourceSessionId,
                    paths: paths,
                    connectionIds: d.ids,
                    targetPath: String(d.targetPath).trim()
                }, { timeout: 0 }).then(function (task) {
                    d.starting = false;
                    d.preparePct = 100;
                    if (!task || !task.id) {
                        d.phase = 'edit';
                        d.error = '服务端未返回传输任务';
                        return;
                    }
                    self.applyDistributeSnapshot(task);
                    self.startDistributePoll();
                }).catch(function (err) {
                    d.starting = false;
                    d.phase = 'edit';
                    d.preparePct = 0;
                    d.error = (err && err.message) ? err.message : '跨服务器传输请求失败';
                });
                return;
            }
            var fd = new FormData();
            var attached = 0;
            for (var i = 0; i < d.files.length; i++) {
                var meta = d.files[i];
                var raw = this._distRawFiles ? this._distRawFiles[meta.uid] : null;
                if (raw) {
                    fd.append('files', raw, meta.name);
                    attached++;
                }
            }
            if (!attached) {
                ELEMENT.Message.warning('文件已失效，请重新选择');
                return;
            }
            for (var j = 0; j < d.ids.length; j++) {
                fd.append('connectionIds', d.ids[j]);
            }
            fd.append('targetPath', String(d.targetPath).trim());

            d.starting = true;
            d.phase = 'run';
            d.task = null;
            d.error = '';
            d.preparePct = 0;
            d.speed = 0;
            this._distLastBytes = 0;
            this._distLastAt = 0;
            http.post('/api/sftp/distribute', fd, {
                timeout: 0,
                onUploadProgress: function (e) {
                    if (e && e.total) {
                        d.preparePct = Math.max(1, Math.min(99, Math.round(e.loaded * 100 / e.total)));
                    }
                }
            }).then(function (task) {
                d.starting = false;
                d.preparePct = 100;
                if (!task || !task.id) {
                    d.phase = 'edit';
                    d.error = '服务端未返回分发任务';
                    return;
                }
                self.applyDistributeSnapshot(task);
                self.startDistributePoll();
            }).catch(function (err) {
                d.starting = false;
                d.phase = 'edit';
                d.preparePct = 0;
                d.error = (err && err.message) ? err.message : '分发请求失败';
            });
        },
        applyDistributeSnapshot: function (task) {
            if (!task || !this.distribute.visible) {
                return;
            }
            var now = Date.now();
            var bytes = task.doneBytes || 0;
            if (this._distLastAt > 0 && now > this._distLastAt) {
                var dt = (now - this._distLastAt) / 1000;
                var inst = (bytes - (this._distLastBytes || 0)) / dt;
                if (inst > 0) {
                    this.distribute.speed = Math.round(this.distribute.speed
                        ? this.distribute.speed * 0.5 + inst * 0.5 : inst);
                } else {
                    this.distribute.speed = 0;
                }
            }
            this._distLastAt = now;
            this._distLastBytes = bytes;
            this.distribute.task = task;
            if (task.status !== 'running' && this._distNotifiedTaskId !== task.id) {
                this._distNotifiedTaskId = task.id;
                this.onDistributeFinished(task);
            }
        },
        startDistributePoll: function () {
            var self = this;
            this.stopDistributePoll();
            var task = this.distribute.task;
            if (!task || task.status !== 'running') {
                return;
            }
            var id = task.id;
            var tick = function () {
                self._distPollTimer = setTimeout(function () {
                    if (!self.distribute.visible || !self.distribute.task
                            || self.distribute.task.id !== id) {
                        return;
                    }
                    http.get('/api/sftp/distribute/' + encodeURIComponent(id), { silent: true })
                        .then(function (t) {
                            if (!self.distribute.visible || !self.distribute.task
                                    || self.distribute.task.id !== id) {
                                return;
                            }
                            self.applyDistributeSnapshot(t);
                            if (t && t.status === 'running') {
                                tick();
                            }
                        })
                        .catch(function (err) {
                            if (self.distribute.visible && self.distribute.task
                                    && self.distribute.task.id === id) {
                                self.distribute.error = '获取分发进度失败：'
                                    + ((err && err.message) ? err.message : '网络错误');
                            }
                        });
                }, 850);
            };
            tick();
        },
        stopDistributePoll: function () {
            if (this._distPollTimer) {
                clearTimeout(this._distPollTimer);
                this._distPollTimer = null;
            }
        },
        cancelDistribute: function () {
            var task = this.distribute.task;
            if (!task || task.status !== 'running' || this.distribute.cancelling) {
                return;
            }
            var self = this;
            this.distribute.cancelling = true;
            http.post('/api/sftp/distribute/' + encodeURIComponent(task.id) + '/cancel')
                .then(function (t) {
                    self.distribute.cancelling = false;
                    self.stopDistributePoll();
                    if (t) {
                        self.applyDistributeSnapshot(t);
                    }
                    ELEMENT.Message.info('已取消分发');
                })
                .catch(function () {
                    self.distribute.cancelling = false;
                });
        },
        retryDistribute: function () {
            var task = this.distribute.task;
            if (!task || task.status === 'running') {
                return;
            }
            var self = this;
            http.post('/api/sftp/distribute/' + encodeURIComponent(task.id) + '/retry')
                .then(function (t) {
                    self._distNotifiedTaskId = '';
                    self._distLastAt = 0;
                    self._distLastBytes = 0;
                    self.distribute.speed = 0;
                    self.applyDistributeSnapshot(t);
                    if (t && t.status === 'running') {
                        self.startDistributePoll();
                    }
                })
                .catch(function () { /* 已由拦截器提示 */ });
        },
        onDistributeFinished: function (task) {
            this.distribute.speed = 0;
            if (task.status === 'done') {
                var ok = task.doneTargets || 0;
                var failed = task.failedTargets || 0;
                var prefix = this.distribute.mode === 'cross' ? '跨服务器传输' : '批量分发';
                var title = prefix + '完成';
                var type = 'success';
                if (!ok && failed) {
                    title = prefix + '失败';
                    type = 'error';
                } else if (failed) {
                    title = prefix + '完成（部分失败）';
                    type = 'warning';
                }
                this.pushDesktopNotice(type === 'success' ? 'success' : type,
                    title, '成功 ' + ok + ' 台' + (failed ? '，失败 ' + failed + ' 台' : ''), 'transfers');
                ELEMENT.Notification({
                    title: title,
                    message: '成功 ' + ok + ' 台' + (failed ? '，失败 ' + failed + ' 台' : ''),
                    type: type,
                    duration: 6000
                });
                this.refreshDistributeDirs(task);
            }
        },
        refreshDistributeDirs: function (task) {
            var done = {};
            for (var i = 0; i < (task.targets || []).length; i++) {
                var t = task.targets[i];
                if (t.status === 'done') {
                    done[t.connectionId] = true;
                }
            }
            var targetPath = task.targetPath;
            var self = this;
            this.tabs.forEach(function (tab) {
                if (!tab.sessionId || !done[tab.connId]) {
                    return;
                }
                var p = String(tab.sftpPath || '').replace(/\/+$/, '') || '/';
                if (p === targetPath) {
                    self.loadDir(tab.sftpPath, tab);
                }
            });
        },
        distributeTargetPct: function (t) {
            if (!t) {
                return 0;
            }
            if (t.status === 'done') {
                return 100;
            }
            var total = t.totalBytes || 0;
            if (!total) {
                return 0;
            }
            return Math.max(0, Math.min(100, Math.floor((t.doneBytes || 0) * 100 / total)));
        },
        distributeTargetStatus: function (t) {
            if (!t) {
                return '';
            }
            if (t.status === 'error') {
                return 'exception';
            }
            if (t.status === 'done') {
                return 'success';
            }
            if (t.status === 'cancelled') {
                return 'warning';
            }
            return '';
        },
        distributeTargetDetail: function (t) {
            if (!t) {
                return '';
            }
            if (t.status === 'pending') {
                return '等待中';
            }
            if (t.status === 'connecting') {
                return '正在建立连接…';
            }
            if (t.status === 'uploading') {
                return '正在上传 ' + (t.currentFile || '') + '（'
                    + (t.fileIndex || 0) + '/' + (t.fileCount || 0) + '） · '
                    + this.fmtSize(t.doneBytes || 0) + ' / ' + this.fmtSize(t.totalBytes || 0);
            }
            if (t.status === 'done') {
                return '已完成 ' + (t.fileCount || 0) + ' 个文件 · '
                    + this.fmtSize(t.totalBytes || 0);
            }
            if (t.status === 'cancelled') {
                return '已取消';
            }
            if (t.status === 'error') {
                return t.error || '分发失败';
            }
            return '';
        },
        closeDistribute: function () {
            var self = this;
            this.beforeDistributeClose(function () {
                self.distribute.visible = false;
            });
        },
        beforeDistributeClose: function (done) {
            if (this.distribute.starting) {
                ELEMENT.Message.warning('正在上传文件准备分发，请稍候');
                return;
            }
            var task = this.distribute.task;
            if (task && task.status === 'running') {
                var self = this;
                this.$confirm('分发仍在进行，关闭将取消本次分发，确定？', '取消分发', {
                    type: 'warning',
                    confirmButtonText: '取消并关闭',
                    cancelButtonText: '继续分发'
                }).then(function () {
                    self.cancelDistribute();
                    done();
                }).catch(function () { /* 继续分发 */ });
                return;
            }
            done();
        },
        onDistributeClosed: function () {
            if (this.distribute.visible) {
                return;
            }
            this.stopDistributePoll();
            this.distribute.starting = false;
            this.distribute.cancelling = false;
            this.distribute.dragOver = false;
            this.distribute.phase = 'edit';
            this.distribute.task = null;
            this.distribute.files = [];
            this.distribute.ids = [];
            this.distribute.error = '';
            this._distRawFiles = {};
        },

        uploadFile: function (param) {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('请先建立连接');
                return;
            }
            this.enqueueUpload(t, t.sftpPath, param.file, param.file.name);
            if (param.onSuccess) {
                param.onSuccess();
            }
        },
        uploadOne: function (tab, dir, file) {
            // 可视化桌面上传：整文件接口 + 上传进度，失败后可转入分片续传重试
            if (!tab || !file) {
                return Promise.reject(new Error('参数缺失'));
            }
            var local = !!tab.local;
            var fd = new FormData();
            if (!local) {
                fd.append('sessionId', tab.sessionId);
            }
            fd.append('path', dir);
            fd.append('file', file);
            var item = {
                id: 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
                kind: 'upload',
                name: file.name,
                dir: dir,
                rel: file.name,
                size: file.size || 0,
                offset: 0,
                status: 'uploading',
                error: '',
                file: file,
                tabKey: tab.key,
                clientKey: tab.clientKey
            };
            this.pushTransfer(item);
            return http.post(local ? '/api/local/fs/upload' : '/api/sftp/upload', fd, {
                onUploadProgress: function (e) {
                    if (e && e.total) {
                        item.offset = Math.min(e.loaded, e.total);
                    }
                }
            }).then(function () {
                item.status = 'done';
                item.offset = item.size;
            }).catch(function (err) {
                item.status = 'error';
                item.error = (err && err.message) ? err.message : '上传失败';
                throw err;
            });
        },
        /* ---------- 传输中心：统一登记、速度采样 ---------- */
        pushTransfer: function (item) {
            item.speed = 0;
            this.transfers.push(item);
            // 桌面模式下不显示终端页气泡，传输中心入口在桌面应用/任务栏
            if (!this.desktop.visible) {
                this.transferCenterOpen = true;
            }
            this.ensureTransferSpeedTimer();
            return item;
        },
        transferBytes: function (t) {
            if (t.kind === 'localDownload') {
                return t.doneBytes || 0;
            }
            return t.offset || 0;
        },
        ensureTransferSpeedTimer: function () {
            if (this._transferSpeedTimer) {
                return;
            }
            var self = this;
            this._transferSpeedTimer = setInterval(function () {
                var now = Date.now();
                self.transfers.forEach(function (t) {
                    var bytes = self.transferBytes(t);
                    var moving = t.status === 'uploading' || t.status === 'downloading';
                    if (moving && t._speedAt) {
                        var dt = (now - t._speedAt) / 1000;
                        var inst = dt > 0 ? Math.max(0, (bytes - (t._speedBytes || 0)) / dt) : 0;
                        if (inst <= 0) {
                            // 长时间没有字节增长时快速归零，避免停在 “1 B/s”
                            t.speed = Math.round((t.speed || 0) * 0.4);
                            if (t.speed < 512) {
                                t.speed = 0;
                            }
                        } else {
                            t.speed = t.speed ? Math.round(t.speed * 0.55 + inst * 0.45) : Math.round(inst);
                        }
                    } else if (!moving) {
                        t.speed = 0;
                    }
                    t._speedBytes = bytes;
                    t._speedAt = now;
                });
            }, 1000);
        },
        /* ---------- 分片上传队列（支持失败重试/续传） ---------- */
        enqueueUpload: function (tab, dir, file, relativePath) {
            if (!tab || !tab.sessionId || !file) {
                return null;
            }
            var item = {
                id: 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
                kind: 'upload',
                name: file.name,
                dir: dir,
                rel: relativePath || file.name,
                size: file.size || 0,
                offset: 0,
                status: 'pending',
                error: '',
                uploadId: '',
                file: file,
                tabKey: tab.key,
                clientKey: tab.clientKey
            };
            this.pushTransfer(item);
            this.pumpTransfers();
            return item;
        },
        pumpTransfers: function () {
            var running = this.transfers.some(function (t) {
                return t.status === 'uploading' || t.status === 'processing';
            });
            if (running) {
                return;
            }
            var next = this.transfers.find(function (t) { return t.status === 'pending'; });
            if (next) {
                this.uploadTransfer(next);
            }
        },
        uploadTransfer: function (item) {
            var self = this;
            var tab = this.tabs.find(function (t) { return t.clientKey === item.clientKey; })
                || this.tabs.find(function (t) { return t.key === item.tabKey; });
            if (!tab || !tab.sessionId) {
                item.status = 'error';
                item.error = '会话已断开';
                this.pumpTransfers();
                return;
            }
            item.status = 'uploading';
            item.error = '';
            http.post('/api/sftp/upload/init', {
                sessionId: tab.sessionId,
                dir: item.dir,
                name: item.name,
                relativePath: item.rel,
                size: item.size,
                uploadId: item.uploadId || null
            }).then(function (r) {
                item.uploadId = r.uploadId;
                item.offset = r.offset || 0;
                function sendNext() {
                    if (item.status === 'cancelled' || item.offset >= item.size) {
                        return Promise.resolve();
                    }
                    var offsetBefore = item.offset;
                    var end = Math.min(item.offset + UPLOAD_CHUNK_SIZE, item.size);
                    var fd = new FormData();
                    fd.append('uploadId', item.uploadId);
                    fd.append('offset', String(item.offset));
                    fd.append('chunk', item.file.slice(offsetBefore, end), item.name);
                    return http.post('/api/sftp/upload/chunk', fd, {
                        timeout: 120000,
                        onUploadProgress: function (e) {
                            if (e && e.total) {
                                item.offset = offsetBefore + Math.min(e.loaded, e.total);
                            }
                        }
                    }).then(function (res) {
                        item.offset = res.offset;
                        return sendNext();
                    });
                }
                return sendNext().then(function () {
                    if (item.status === 'cancelled') {
                        if (item.uploadId) {
                            http.post('/api/sftp/upload/abort', { uploadId: item.uploadId })
                                .catch(function () { /* ignore */ });
                        }
                        return null;
                    }
                    item.status = 'processing';
                    return http.post('/api/sftp/upload/complete', { uploadId: item.uploadId });
                }).then(function (res) {
                    if (!res) {
                        item.uploadId = '';
                        return;
                    }
                    item.status = 'done';
                    item.offset = item.size;
                    item.uploadId = '';
                    if (tab.sftpPath === item.dir) {
                        self.loadDir(item.dir, tab);
                    }
                });
            }).catch(function (err) {
                if (item.status === 'cancelled') {
                    return;
                }
                item.status = 'error';
                item.error = (err && err.message) ? err.message : '上传失败';
                // 保留 uploadId 与 offset：点重试时从服务端已收到的位置继续
            }).then(function () {
                self.pumpTransfers();
            });
        },
        cancelTransfer: function (item) {
            if (!item) {
                return;
            }
            if (item.kind === 'upload') {
                var wasRunning = item.status === 'uploading' || item.status === 'processing';
                item.status = 'cancelled';
                if (!wasRunning && item.uploadId) {
                    http.post('/api/sftp/upload/abort', { uploadId: item.uploadId }).catch(function () {});
                    item.uploadId = '';
                }
                this.pumpTransfers();
                return;
            }
            if (item.kind === 'download') {
                if (item.status !== 'downloading') {
                    return;
                }
                item.status = 'cancelled';
                if (item._timer) {
                    clearInterval(item._timer);
                    item._timer = null;
                }
                if (item.taskId) {
                    http.post('/api/downloads/tasks/' + encodeURIComponent(item.taskId) + '/cancel')
                        .catch(function () { /* 已由拦截器提示 */ });
                }
                return;
            }
            if (item.kind === 'localDownload') {
                if (!item.taskId) {
                    return;
                }
                http.post('/api/local-download/tasks/' + encodeURIComponent(item.taskId) + '/cancel')
                    .then(function () {
                        item.status = 'cancelled';
                        if (item._timer) {
                            clearInterval(item._timer);
                            item._timer = null;
                        }
                    }).catch(function () { /* 已由拦截器提示 */ });
            }
        },
        removeTransfer: function (item) {
            if (!item) {
                return;
            }
            if (item._timer) {
                clearInterval(item._timer);
                item._timer = null;
            }
            this.transfers = this.transfers.filter(function (t) {
                return t !== item;
            });
        },
        retryTransfer: function (item) {
            if (item.kind !== 'upload') {
                return;
            }
            if (item.status !== 'error' && item.status !== 'cancelled') {
                return;
            }
            if (!item.file) {
                ELEMENT.Message.warning('原始文件已不可用，请重新选择文件');
                return;
            }
            item.status = 'pending';
            item.error = '';
            this.pumpTransfers();
        },
        clearFinishedTransfers: function () {
            var active = ['pending', 'uploading', 'processing', 'queued', 'scanning', 'downloading'];
            this.transfers.forEach(function (t) {
                if (active.indexOf(t.status) < 0 && t._timer) {
                    clearInterval(t._timer);
                    t._timer = null;
                }
            });
            this.transfers = this.transfers.filter(function (t) {
                return active.indexOf(t.status) >= 0;
            });
        },
        cancelTransfersForTab: function (tab) {
            var self = this;
            if (!tab) {
                return;
            }
            this.transfers.forEach(function (t) {
                if (t.clientKey === tab.clientKey
                        && (t.status === 'pending' || t.status === 'uploading' || t.status === 'processing')) {
                    self.cancelTransfer(t);
                }
            });
        },
        triggerFolderUpload: function () {
            var el = this.$refs.folderInput;
            if (el) {
                el.click();
            }
        },
        onFolderInput: function (e) {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('请先建立连接');
                return;
            }
            var dir = t.sftpPath || t.sftpHome;
            var files = e.target.files || [];
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                this.enqueueUpload(t, dir, f, f.webkitRelativePath || f.name);
            }
            e.target.value = '';
            if (files.length) {
                ELEMENT.Message.success('已加入传输队列：' + files.length + ' 个文件');
            }
        },
        /* ---------- 权限 ---------- */
        openPerm: function (row) {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                return;
            }
            this.permForm = {
                path: this.entryPath(row),
                name: row.name,
                mode: permsToOctal(row.perms) || (row.dir ? '755' : '644')
            };
            this.permVisible = true;
        },
        openPermFromDesktop: function () {
            var p = this.desktop.props;
            if (!p) {
                return;
            }
            this.permForm = {
                path: p.path,
                name: p.name,
                mode: permsToOctal(p.perms) || (p.dir ? '755' : '644')
            };
            this.permVisible = true;
        },
        savePerm: function () {
            var t = this.desktop.propsVisible ? this.desktopTab : this.activeTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪');
                return;
            }
            var mode = String(this.permForm.mode || '').trim();
            if (!/^[0-7]{3,4}$/.test(mode)) {
                ELEMENT.Message.warning('请输入 3-4 位八进制权限，如 644 / 755');
                return;
            }
            var self = this;
            this.permSaving = true;
            http.post('/api/sftp/chmod', {
                sessionId: t.sessionId,
                path: this.permForm.path,
                mode: parseInt(mode, 8)
            }).then(function () {
                ELEMENT.Message.success('权限已修改');
                self.permVisible = false;
                if (t.sftpPath) {
                    self.loadDir(t.sftpPath, t);
                }
            }).catch(function () { /* 已由拦截器提示 */ })
                .then(function () {
                    self.permSaving = false;
                });
        },
        /* ---------- 从系统拖入文件直接上传 ---------- */
        hasFileDrag: function (e) {
            var types = e.dataTransfer && e.dataTransfer.types;
            if (!types) {
                return false;
            }
            for (var i = 0; i < types.length; i++) {
                if (types[i] === 'Files') {
                    return true;
                }
            }
            return false;
        },
        onWindowDragEnter: function (e) {
            if (!this.hasFileDrag(e)) {
                return;
            }
            if (this.desktop.visible) {
                this._deskDragDepth = (this._deskDragDepth || 0) + 1;
                this.desk.fileDragOver = true;
                return;
            }
            this._dragDepth = (this._dragDepth || 0) + 1;
            this.fileDragOver = true;
        },
        onWindowDragOver: function (e) {
            if (!this.hasFileDrag(e)) {
                return;
            }
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
            }
            if (this.desktop.visible) {
                this.desk.fileDragOver = true;
            } else {
                this.fileDragOver = true;
            }
        },
        onWindowDragLeave: function (e) {
            if (!this.hasFileDrag(e)) {
                return;
            }
            if (this.desktop.visible) {
                this._deskDragDepth = Math.max(0, (this._deskDragDepth || 1) - 1);
                if (this._deskDragDepth === 0 || !e.relatedTarget) {
                    this._deskDragDepth = 0;
                    this.desktop.windows.forEach(function (w) {
                        w.fileDragOver = false;
                        w.dropTarget = '';
                    });
                    this.stopDesktopDragScroll();
                }
                return;
            }
            this._dragDepth = Math.max(0, (this._dragDepth || 1) - 1);
            if (this._dragDepth === 0 || !e.relatedTarget) {
                this._dragDepth = 0;
                this.fileDragOver = false;
            }
        },
        onWindowDrop: function (e) {
            if (!this.hasFileDrag(e)) {
                return;
            }
            e.preventDefault();
            var files = [];
            var list = e.dataTransfer ? e.dataTransfer.files : null;
            for (var i = 0; list && i < list.length; i++) {
                files.push(list[i]);
            }
            this._dragDepth = 0;
            this._deskDragDepth = 0;
            this.fileDragOver = false;
            if (this.desktop.visible && this.desk.id) {
                this.desktop.windows.forEach(function (w) {
                    w.fileDragOver = false;
                    w.dropTarget = '';
                });
                this.stopDesktopDragScroll();
                this.desktopUploadFiles(files, this.desk.path, this.desk);
                return;
            }
            this.desk.fileDragOver = false;
            this.handleDroppedFiles(files);
        },
        handleDroppedFiles: function (files) {
            if (!files || !files.length) {
                return;
            }
            if (this.desktop.visible && this.desk.id) {
                this.desktopUploadFiles(files, this.desk.path, this.desk);
                return;
            }
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('请先建立连接');
                return;
            }
            var dir = t.sftpPath || t.sftpHome;
            if (!dir) {
                ELEMENT.Message.warning('文件面板尚未就绪，请稍后再试');
                return;
            }
            var self = this;
            files.forEach(function (f) {
                self.enqueueUpload(t, dir, f, f.name);
            });
            ELEMENT.Message.success(files.length === 1
                ? ('已加入传输队列：' + files[0].name)
                : ('已加入传输队列：' + files.length + ' 个文件 → ' + dir));
        },
        mkdir: function () {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                return;
            }
            var self = this;
            this.$prompt('请输入文件夹名称', '新建文件夹', { inputPattern: /^[^/\\]+$/, inputErrorMessage: '名称不合法' })
                .then(function (result) {
                    return http.post('/api/sftp/mkdir', {
                        sessionId: t.sessionId,
                        path: self.pathJoin(t.sftpPath, result.value)
                    });
                })
                .then(function () {
                    self.loadDir(t.sftpPath, t);
                })
                .catch(function () { /* 取消或失败 */ });
        },
        openRename: function (row) {
            this.renameForm = {
                path: this.pathJoin(this.activeTab.sftpPath, row.name),
                newName: row.name,
                desktop: false,
                winId: ''
            };
            this.renameVisible = true;
        },
        createFile: function () {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('请先建立连接');
                return;
            }
            var self = this;
            this.$prompt('请输入文件名（如 notes.txt）', '新建文件', {
                inputPattern: /^[^/\\]+$/,
                inputErrorMessage: '文件名不合法'
            }).then(function (result) {
                var name = result.value.trim();
                return http.post('/api/sftp/touch', {
                    sessionId: t.sessionId,
                    path: self.pathJoin(t.sftpPath, name)
                }).then(function () {
                    ELEMENT.Message.success('已创建 ' + name);
                    self.loadDir(t.sftpPath, t);
                    // 创建成功后直接打开在线编辑框
                    self.openEdit({ name: name });
                });
            }).catch(function () { /* 取消或失败（已提示） */ });
        },
        doRename: function () {
            var f = this.renameForm;
            var local = !!(f.desktop && this.desktop.local);
            var t = local ? this.desktopTab : this.activeTab;
            if (!f.newName || !f.newName.trim()) {
                ELEMENT.Message.warning('请输入新名称');
                return;
            }
            if (!local && (!t || !t.sessionId)) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            var self = this;
            var renameReq = local
                ? http.post('/api/local/fs/rename', { path: f.path, newName: f.newName.trim() })
                : http.post('/api/sftp/rename', {
                    sessionId: t.sessionId,
                    path: f.path,
                    newName: f.newName.trim()
                });
            renameReq
                .then(function () {
                    self.renameVisible = false;
                    if (f.desktop) {
                        if (f.surface) {
                            self.refreshDesktopSurface();
                        } else {
                            self.desktopRefresh(self.desktopWindowById(f.winId) || undefined);
                        }
                    } else {
                        self.loadDir(t.sftpPath, t);
                    }
                })
                .catch(function () { /* 已提示 */ });
        },
        remove: function (row) {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                return;
            }
            var self = this;
            this.$confirm('确定删除「' + row.name + '」' + (row.dir ? '及其全部内容' : '') + '？', '危险操作', { type: 'warning' })
                .then(function () {
                    return http.post('/api/sftp/delete', {
                        sessionId: t.sessionId,
                        path: self.pathJoin(t.sftpPath, row.name)
                    });
                })
                .then(function () {
                    ELEMENT.Message.success('已删除');
                    self.loadDir(t.sftpPath, t);
                })
                .catch(function () { /* 取消或失败 */ });
        },
        openEdit: function (row) {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                return;
            }
            this.openRemoteEdit(t, this.pathJoin(t.sftpPath, row.name));
        },
        /* 终端工作台的文本编辑器：仍用弹窗承载，内部复用桌面编辑器组件 */
        openRemoteEdit: function (t, path) {
            if (!t || !t.sessionId || !path) {
                return;
            }
            this.editTab = t;
            this.editPendingPath = path;
            this.editPendingSeq = (this.editPendingSeq || 0) + 1;
            this.editDialogTitle = '';
            this.editVisible = true;
        },
        saveDialogEdit: function () {
            var ed = this.$refs.terminalEditor;
            if (ed) {
                ed.save();
            }
        },
        onDialogEditorSaved: function (payload) {
            var path = payload && payload.path;
            if (!path) {
                return;
            }
            var t = this.editTab || this.activeTab;
            if (!t || !t.sessionId || !t.sftpPath) {
                return;
            }
            var dir = path.substring(0, path.lastIndexOf('/')) || '/';
            var p = String(t.sftpPath).replace(/\/+$/, '') || '/';
            if (p === dir) {
                this.loadDir(t.sftpPath, t);
            }
        },
        beforeEditClose: function (done) {
            var ed = this.$refs.terminalEditor;
            if (ed && ed.hasDirtyDocs && ed.hasDirtyDocs()) {
                this.$confirm('有未保存的修改，关闭后将丢失。', '未保存的修改', {
                    type: 'warning',
                    confirmButtonText: '放弃修改',
                    cancelButtonText: '继续编辑'
                }).then(function () {
                    done();
                }).catch(function () { /* 继续编辑 */ });
                return;
            }
            done();
        },
        cancelEdit: function () {
            var self = this;
            this.beforeEditClose(function () {
                self.editVisible = false;
            });
        },

        /* ---------- 在线编辑器（CodeMirror） ---------- */
        onEditOpened: function () {
            var self = this;
            this.$nextTick(function () {
                if (self.editVisible && !self.editForm.loading) {
                    self.initEditor();
                }
            });
        },
        onEditClosed: function () {
            if (this.editVisible) {
                return;
            }
            this.editTab = null;
            this.editPendingPath = '';
            this.editDialogTitle = '';
        },
        resetEditorInstance: function () {
            if (this._findTimer) {
                clearTimeout(this._findTimer);
                this._findTimer = null;
            }
            this.clearEditorSearchMarks();
            if (this.$refs.editorHost) {
                this.$refs.editorHost.innerHTML = '';
            }
            this._cm = null;
            this._findMatches = [];
        },
        initEditor: function () {
            var self = this;
            if (this._cm) {
                this._cm.refresh();
                return;
            }
            var host = this.$refs.editorHost;
            if (!host || typeof CodeMirror === 'undefined') {
                if (typeof CodeMirror === 'undefined') {
                    ELEMENT.Message.error('编辑器组件加载失败，请刷新页面后重试');
                }
                return;
            }
            var content = this.editForm.content || '';
            var info = this.editorModeForPath(this.editForm.path, content);
            this.editor.modeLabel = info.label;
            host.innerHTML = '';
            var cm = CodeMirror(host, {
                value: content,
                mode: info.mode,
                lineNumbers: true,
                lineWrapping: this.editor.wrap,
                styleActiveLine: true,
                matchBrackets: true,
                autoCloseBrackets: true,
                indentUnit: 4,
                tabSize: 4,
                indentWithTabs: false,
                highlightSelectionMatches: { minChars: 2, style: 'keyword-hit' },
                extraKeys: {
                    'Ctrl-F': function () { self.openEditFind(false); },
                    'Cmd-F': function () { self.openEditFind(false); },
                    'Ctrl-H': function () { self.openEditFind(true); },
                    'Ctrl-S': function () { self.saveEdit(); },
                    'Cmd-S': function () { self.saveEdit(); },
                    'F3': function () { self.editorFindNext(); },
                    'Shift-F3': function () { self.editorFindPrev(); },
                    'Alt-C': function () { self.toggleEditFindOption('caseSensitive'); },
                    'Alt-W': function () { self.toggleEditFindOption('wholeWord'); },
                    'Alt-R': function () { self.toggleEditFindOption('regex'); },
                    'Ctrl-/': 'toggleComment',
                    'Cmd-/': 'toggleComment'
                }
            });
            this._cm = cm;
            this._editorOriginal = content;
            cm.on('change', function () { self.onEditorChange(cm); });
            cm.on('cursorActivity', function () { self.updateEditorCursor(cm); });
            this.editor.lineCount = cm.lineCount();
            this.editor.dirty = false;
            this.updateEditorCursor(cm);
            this.$nextTick(function () {
                if (self._cm === cm) {
                    cm.refresh();
                    cm.focus();
                }
            });
        },
        updateEditorCursor: function (cm) {
            cm = cm || this._cm;
            if (!cm) {
                return;
            }
            var c = cm.getCursor();
            this.editor.cursor = { line: c.line + 1, col: c.ch + 1 };
        },
        onEditorChange: function (cm) {
            this.editor.lineCount = cm.lineCount();
            this.editor.dirty = cm.getValue(this._editorLineSep || '\n') !== this._editorOriginal;
            this.updateEditorCursor(cm);
            if (this.editor.find.text) {
                var select = !!this._editorSelectAfterChange;
                this._editorSelectAfterChange = false;
                this.scheduleEditorSearch(select);
            }
        },
        editorModeForPath: function (path, content) {
            var p = String(path || '');
            var base = p.substring(p.lastIndexOf('/') + 1).toLowerCase();
            var dot = base.lastIndexOf('.');
            var ext = dot > 0 ? base.substring(dot + 1) : '';
            if (base === 'dockerfile' || base.indexOf('dockerfile.') === 0) {
                return { mode: 'dockerfile', label: 'Dockerfile' };
            }
            if (base === '.bashrc' || base === '.zshrc' || base === '.bash_profile'
                || base === '.profile' || base === '.bash_logout' || base === '.kshrc') {
                return { mode: 'shell', label: 'Shell' };
            }
            if (base === '.env') {
                return { mode: 'properties', label: 'ENV' };
            }
            if (base === 'nginx.conf' || /^nginx.*\.conf$/.test(base)
                || (/\.conf$/.test(base) && p.indexOf('/nginx/') >= 0)) {
                return { mode: 'nginx', label: 'Nginx' };
            }
            var map = {
                sh: ['shell', 'Shell'], bash: ['shell', 'Shell'], zsh: ['shell', 'Shell'],
                ksh: ['shell', 'Shell'], profile: ['shell', 'Shell'],
                py: ['python', 'Python'], pyw: ['python', 'Python'],
                js: ['javascript', 'JavaScript'], mjs: ['javascript', 'JavaScript'],
                cjs: ['javascript', 'JavaScript'], jsx: ['javascript', 'JavaScript'],
                ts: ['text/typescript', 'TypeScript'], tsx: ['text/typescript', 'TypeScript'],
                json: ['application/json', 'JSON'],
                html: ['htmlmixed', 'HTML'], htm: ['htmlmixed', 'HTML'],
                xhtml: ['htmlmixed', 'HTML'], vue: ['htmlmixed', 'HTML'],
                xml: ['xml', 'XML'], svg: ['xml', 'XML'], plist: ['xml', 'XML'],
                css: ['css', 'CSS'], scss: ['text/x-scss', 'SCSS'], less: ['text/x-less', 'LESS'],
                sql: ['sql', 'SQL'],
                yml: ['yaml', 'YAML'], yaml: ['yaml', 'YAML'],
                properties: ['properties', 'Properties'], ini: ['text/x-ini', 'INI'],
                cfg: ['properties', '配置'], env: ['properties', 'ENV'],
                toml: ['properties', 'TOML'], service: ['properties', 'Unit'],
                md: ['markdown', 'Markdown'], markdown: ['markdown', 'Markdown'],
                java: ['text/x-java', 'Java'],
                c: ['text/x-csrc', 'C'], h: ['text/x-csrc', 'C'],
                cpp: ['text/x-c++src', 'C++'], cc: ['text/x-c++src', 'C++'],
                hpp: ['text/x-c++src', 'C++'], cs: ['text/x-csharp', 'C#']
            };
            var hit = map[ext];
            if (hit) {
                return { mode: hit[0], label: hit[1] };
            }
            if (!ext) {
                var first = String(content || '').split('\n')[0];
                if (/^#!.*\bpython/.test(first)) {
                    return { mode: 'python', label: 'Python' };
                }
                if (/^#!.*\b(?:ba|z|k)?sh\b/.test(first)) {
                    return { mode: 'shell', label: 'Shell' };
                }
            }
            return { mode: null, label: '纯文本' };
        },
        openEditFind: function (withReplace) {
            var cm = this._cm;
            if (!cm) {
                return;
            }
            var sel = cm.getSelection();
            if (sel && sel.indexOf('\n') < 0 && sel.length <= 200) {
                this.editor.find.text = sel;
            }
            if (withReplace) {
                this.editor.find.replaceOpen = true;
            }
            this.applyEditorSearch(true);
            var self = this;
            this.$nextTick(function () {
                self.focusEditFindInput();
            });
        },
        focusEditFindInput: function () {
            var ref = this.$refs.editFindInput;
            var el = ref && ref.$el ? ref.$el.querySelector('input') : null;
            if (el) {
                el.focus();
                el.select();
            }
        },
        onEditFindKey: function (e) {
            var key = e.key || '';
            if (key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.editorFindPrev();
                } else {
                    this.editorFindNext();
                }
                return;
            }
            if (key === 'Escape') {
                e.preventDefault();
                if (this._cm) {
                    this._cm.focus();
                }
                return;
            }
            if (e.altKey) {
                var k = key.toLowerCase();
                if (k === 'c') {
                    e.preventDefault();
                    this.toggleEditFindOption('caseSensitive');
                } else if (k === 'w') {
                    e.preventDefault();
                    this.toggleEditFindOption('wholeWord');
                } else if (k === 'r') {
                    e.preventDefault();
                    this.toggleEditFindOption('regex');
                }
            }
        },
        onEditReplaceKey: function (e) {
            var key = e.key || '';
            if (key === 'Enter') {
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) {
                    this.editorReplaceAll();
                } else {
                    this.editorReplaceOne();
                }
                return;
            }
            if (key === 'Escape') {
                e.preventDefault();
                if (this._cm) {
                    this._cm.focus();
                }
            }
        },
        toggleEditReplace: function () {
            this.editor.find.replaceOpen = !this.editor.find.replaceOpen;
            if (this.editor.find.replaceOpen) {
                var self = this;
                this.$nextTick(function () {
                    self.focusEditFindInput();
                });
            }
        },
        toggleEditWrap: function () {
            this.editor.wrap = !this.editor.wrap;
            if (this._cm) {
                this._cm.setOption('lineWrapping', this.editor.wrap);
                this._cm.refresh();
            }
        },
        toggleEditFindOption: function (key) {
            this.editor.find[key] = !this.editor.find[key];
            this.applyEditorSearch(true);
            this.focusEditFindInput();
        },
        scheduleEditorSearch: function (select) {
            var self = this;
            if (this._findTimer) {
                clearTimeout(this._findTimer);
            }
            this._findTimer = setTimeout(function () {
                self.applyEditorSearch(true, select !== false);
            }, 120);
        },
        buildEditorSearchRegex: function () {
            var f = this.editor.find;
            if (!f.text) {
                return null;
            }
            var source = f.text;
            if (!f.regex) {
                source = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }
            if (f.wholeWord) {
                var w = '[A-Za-z0-9_\\u3400-\\u9fff]';
                source = '(?<!' + w + ')(?:' + source + ')(?!' + w + ')';
            }
            try {
                return new RegExp(source, 'gm' + (f.caseSensitive ? '' : 'i'));
            } catch (e) {
                return null;
            }
        },
        applyEditorSearch: function (resetCurrent, selectCurrent) {
            var cm = this._cm;
            if (!cm) {
                return;
            }
            if (selectCurrent === undefined) {
                selectCurrent = true;
            }
            this.clearEditorSearchMarks();
            this._findMatches = [];
            var f = this.editor.find;
            f.invalid = false;
            if (!f.text) {
                f.total = 0;
                f.current = 0;
                f.countText = '';
                return;
            }
            var re = this.buildEditorSearchRegex();
            if (!re) {
                f.total = 0;
                f.current = 0;
                f.countText = '正则无效';
                f.invalid = true;
                return;
            }
            var text = cm.getValue();
            var stored = [];
            var total = 0;
            var m;
            re.lastIndex = 0;
            while ((m = re.exec(text)) !== null) {
                if (m[0].length === 0) {
                    re.lastIndex++;
                    continue;
                }
                total++;
                if (stored.length < 1500) {
                    stored.push({
                        index: m.index,
                        length: m[0].length,
                        whole: m[0],
                        groups: Array.prototype.slice.call(m, 1)
                    });
                }
                if (total >= 100000) {
                    break;
                }
            }
            this._findMatches = stored;
            f.total = total;
            if (!total) {
                f.current = 0;
                f.countText = '无匹配';
                return;
            }
            if (resetCurrent) {
                var cursorIndex = cm.indexFromPos(cm.getCursor());
                f.current = 0;
                for (var i = 0; i < stored.length; i++) {
                    if (stored[i].index >= cursorIndex) {
                        f.current = i;
                        break;
                    }
                }
            } else if (f.current >= stored.length) {
                f.current = 0;
            }
            f.countText = (f.current + 1) + ' / ' + total + (total >= 100000 ? '+' : '');
            this.highlightEditorMatches(selectCurrent);
        },
        highlightEditorMatches: function (selectCurrent) {
            var cm = this._cm;
            if (!cm) {
                return;
            }
            this.clearEditorSearchMarks();
            var stored = this._findMatches || [];
            var f = this.editor.find;
            for (var i = 0; i < stored.length; i++) {
                var m = stored[i];
                var cls = 'cm-search-hit' + (i === f.current ? ' cm-search-hit-current' : '');
                try {
                    this._cmMarks.push(cm.markText(
                        cm.posFromIndex(m.index), cm.posFromIndex(m.index + m.length),
                        { className: cls }
                    ));
                } catch (e) { /* 文件被替换时忽略失效位置 */ }
            }
            var cur = stored[f.current];
            if (cur && selectCurrent !== false) {
                cm.setSelection(cm.posFromIndex(cur.index), cm.posFromIndex(cur.index + cur.length));
            }
        },
        clearEditorSearchMarks: function () {
            var marks = this._cmMarks || [];
            for (var i = 0; i < marks.length; i++) {
                try {
                    marks[i].clear();
                } catch (e) { /* ignore */ }
            }
            this._cmMarks = [];
        },
        editorFindNext: function () {
            var f = this.editor.find;
            if (!f.text) {
                return;
            }
            if (!this._findMatches || !this._findMatches.length) {
                this.applyEditorSearch(true);
                return;
            }
            f.current = (f.current + 1) % this._findMatches.length;
            f.countText = (f.current + 1) + ' / ' + f.total + (f.total >= 100000 ? '+' : '');
            this.highlightEditorMatches();
        },
        editorFindPrev: function () {
            var f = this.editor.find;
            if (!f.text) {
                return;
            }
            if (!this._findMatches || !this._findMatches.length) {
                this.applyEditorSearch(true);
                return;
            }
            f.current = (f.current - 1 + this._findMatches.length) % this._findMatches.length;
            f.countText = (f.current + 1) + ' / ' + f.total + (f.total >= 100000 ? '+' : '');
            this.highlightEditorMatches();
        },
        expandEditorReplacement: function (template, whole, groups) {
            if (!this.editor.find.regex) {
                return template;
            }
            return String(template).replace(/\$(\$|&|\d{1,2})/g, function (all, token) {
                if (token === '$') {
                    return '$';
                }
                if (token === '&') {
                    return whole;
                }
                var n = parseInt(token, 10);
                if (n >= 1 && n <= groups.length) {
                    return groups[n - 1] == null ? '' : groups[n - 1];
                }
                if (token.length === 2) {
                    var first = parseInt(token.charAt(0), 10);
                    if (first >= 1 && first <= groups.length) {
                        return (groups[first - 1] == null ? '' : groups[first - 1]) + token.charAt(1);
                    }
                }
                return all;
            });
        },
        editorReplaceOne: function () {
            var cm = this._cm;
            var f = this.editor.find;
            if (!cm || !f.text) {
                return;
            }
            if (!this._findMatches || !this._findMatches.length) {
                this.applyEditorSearch(true);
                return;
            }
            var m = this._findMatches[f.current];
            if (!m) {
                this.applyEditorSearch(true);
                return;
            }
            var replacement = this.expandEditorReplacement(f.replace, m.whole, m.groups);
            this._editorSelectAfterChange = true;
            cm.replaceRange(replacement, cm.posFromIndex(m.index), cm.posFromIndex(m.index + m.length));
            cm.focus();
        },
        editorReplaceAll: function () {
            var cm = this._cm;
            var f = this.editor.find;
            if (!cm || !f.text) {
                return;
            }
            var re = this.buildEditorSearchRegex();
            if (!re) {
                ELEMENT.Message.warning('正则表达式无效，请检查后重试');
                return;
            }
            var self = this;
            var text = cm.getValue();
            var count = 0;
            var firstOffset = -1;
            var result = text.replace(re, function (whole) {
                if (!whole.length) {
                    return whole;
                }
                var args = Array.prototype.slice.call(arguments);
                var groups = args.slice(1, args.length - 2);
                var offset = args[args.length - 2];
                count++;
                if (firstOffset < 0) {
                    firstOffset = offset;
                }
                return self.expandEditorReplacement(f.replace, whole, groups);
            });
            if (!count) {
                ELEMENT.Message.info('没有可替换的匹配项');
                return;
            }
            var lastLine = cm.lineCount() - 1;
            cm.operation(function () {
                cm.replaceRange(result, { line: 0, ch: 0 },
                    { line: lastLine, ch: cm.getLine(lastLine).length });
            });
            ELEMENT.Message.success('已全部替换 ' + count + ' 处');
            if (firstOffset >= 0) {
                cm.setCursor(cm.posFromIndex(Math.min(firstOffset, result.length)));
            }
            cm.focus();
        },
        onEditorGlobalKey: function (e) {
            if (!this.editVisible) {
                return;
            }
            var mod = e.ctrlKey || e.metaKey;
            if (!mod) {
                return;
            }
            var key = (e.key || '').toLowerCase();
            if (key !== 's' && key !== 'f' && key !== 'h') {
                return;
            }
            if (this._cm && this._cm.hasFocus()) {
                return;
            }
            e.preventDefault();
            if (key === 's') {
                this.saveEdit();
            } else if (key === 'f') {
                this.openEditFind(false);
            } else if (key === 'h') {
                this.openEditFind(true);
            }
        },

        /* ---------- 面板拖拽 ---------- */
        startResize: function (e) {
            var self = this;
            var startX = e.clientX;
            var startWidth = this.panelWidth;
            var maxW = Math.max(360, Math.floor(window.innerWidth * 0.8));
            document.body.classList.add('resizing');
            var move = function (ev) {
                var w = startWidth - (ev.clientX - startX);
                if (w < 320) {
                    w = 320;
                }
                if (w > maxW) {
                    w = maxW;
                }
                self.panelWidth = w;
            };
            var up = function () {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                document.body.classList.remove('resizing');
                try {
                    localStorage.setItem('deepshell.panelWidth', String(self.panelWidth));
                } catch (err) { /* ignore */ }
                self.fitActive();
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        },

        /* ---------- 标签拖拽排序 ---------- */
        onTabDragStart: function (ev, tab) {
            this._dragTabKey = tab.key;
            if (ev.dataTransfer) {
                ev.dataTransfer.effectAllowed = 'move';
                try { ev.dataTransfer.setData('text/plain', tab.key); } catch (e) { /* ignore */ }
            }
            var el = ev.target && ev.target.closest ? ev.target.closest('.tab') : null;
            if (el) {
                el.classList.add('tab-dragging');
                this._tabDragEl = el;
            }
        },
        onTabDragOver: function (ev, tab) {
            if (!this._dragTabKey || tab.key === this._dragTabKey) {
                return;
            }
            ev.preventDefault();
            if (ev.dataTransfer) {
                ev.dataTransfer.dropEffect = 'move';
            }
            // 按水平中点判定插到目标标签的前面还是后面
            var el = ev.target && ev.target.closest ? ev.target.closest('.tab') : null;
            if (el) {
                var rect = el.getBoundingClientRect();
                var before = ev.clientX < rect.left + rect.width / 2;
                this._dropTargetKey = tab.key;
                this._dropBefore = before;
                this.clearTabDropClasses();
                el.classList.add(before ? 'drop-before' : 'drop-after');
                this._tabDropEl = el;
            }
            // 标签过多超出可视区时，靠近左右边缘自动滚动
            var bar = this.$refs.tabBar;
            if (bar) {
                var r = bar.getBoundingClientRect();
                var edge = 36;
                var sp = 0;
                if (ev.clientX - r.left < edge) {
                    sp = -Math.ceil((edge - (ev.clientX - r.left)) / 3);
                } else if (r.right - ev.clientX < edge) {
                    sp = Math.ceil((edge - (r.right - ev.clientX)) / 3);
                }
                this._tabScrollSpeed = Math.max(-18, Math.min(18, sp));
                this.startTabScrollLoop();
            }
        },
        onTabBarDragLeave: function () {
            this._tabScrollSpeed = 0;
        },
        startTabScrollLoop: function () {
            var self = this;
            if (this._tabScrollTimer) {
                return;
            }
            this._tabScrollTimer = setInterval(function () {
                if (!self._tabScrollSpeed) {
                    clearInterval(self._tabScrollTimer);
                    self._tabScrollTimer = null;
                    return;
                }
                var bar = self.$refs.tabBar;
                if (!bar) {
                    self._tabScrollSpeed = 0;
                    return;
                }
                bar.scrollLeft += self._tabScrollSpeed;
            }, 16);
        },
        onTabDrop: function (ev, tab) {
            var srcKey = this._dragTabKey;
            var before = this._dropBefore;
            this.clearTabDragState();
            if (!srcKey || srcKey === tab.key) {
                return;
            }
            var from = -1;
            for (var i = 0; i < this.tabs.length; i++) {
                if (this.tabs[i].key === srcKey) {
                    from = i;
                    break;
                }
            }
            if (from < 0) {
                return;
            }
            var moved = this.tabs.splice(from, 1)[0];
            var idx = -1;
            for (var j = 0; j < this.tabs.length; j++) {
                if (this.tabs[j].key === tab.key) {
                    idx = j;
                    break;
                }
            }
            if (idx < 0) {
                this.tabs.push(moved);
                return;
            }
            if (!before) {
                idx += 1;
            }
            this.tabs.splice(idx, 0, moved);
        },
        onTabDragEnd: function () {
            this.clearTabDragState();
        },
        clearTabDropClasses: function () {
            if (this._tabDropEl) {
                this._tabDropEl.classList.remove('drop-before', 'drop-after');
                this._tabDropEl = null;
            }
        },
        clearTabDragState: function () {
            if (this._tabDragEl) {
                this._tabDragEl.classList.remove('tab-dragging');
                this._tabDragEl = null;
            }
            this.clearTabDropClasses();
            this._dragTabKey = null;
            this._dropTargetKey = null;
            this._dropBefore = null;
            this._tabScrollSpeed = 0;
            if (this._tabScrollTimer) {
                clearInterval(this._tabScrollTimer);
                this._tabScrollTimer = null;
            }
        },

        /* ---------- SFTP 拖拽移动 ---------- */
        entryPath: function (row) {
            var t = this.activeTab;
            return t ? this.pathJoin(t.sftpPath, row.name) : row.name;
        },
        sftpScroller: function () {
            var ref = this.$refs.sftpTable;
            var el = Array.isArray(ref) ? ref[0] : ref;
            return el && el.$el ? el.$el.querySelector('.el-table__body-wrapper') : null;
        },
        onFileDragStart: function (ev, row) {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                ev.preventDefault();
                return;
            }
            var p = this.pathJoin(t.sftpPath, row.name);
            this.dragging = true;
            this._dragPath = p;
            if (ev.dataTransfer) {
                ev.dataTransfer.effectAllowed = 'move';
                try { ev.dataTransfer.setData('text/plain', p); } catch (e) { /* ignore */ }
            }
            var tr = ev.target && ev.target.closest ? ev.target.closest('tr') : null;
            if (tr) {
                tr.classList.add('dragging-src');
                this._dragSrcTr = tr;
            }
        },
        endDrag: function () {
            this.dragging = false;
            this._dragPath = null;
            this._dropDirPath = null;
            this._dragScrollSpeed = 0;
            if (this._dragScrollTimer) {
                clearInterval(this._dragScrollTimer);
                this._dragScrollTimer = null;
            }
            if (this._dragOverTr) {
                this._dragOverTr.classList.remove('drag-over');
                this._dragOverTr = null;
            }
            if (this._dragSrcTr) {
                this._dragSrcTr.classList.remove('dragging-src');
                this._dragSrcTr = null;
            }
        },
        onTableDragOver: function (ev) {
            if (!this.dragging || !this._dragPath) {
                return;
            }
            // 边缘自动滚动：靠近表格上下边缘时持续滚动，方便找到远处的文件夹
            var scroller = this.sftpScroller();
            if (scroller) {
                var rect = scroller.getBoundingClientRect();
                var edge = 42;
                var sp = 0;
                if (ev.clientY - rect.top < edge) {
                    sp = -Math.ceil((edge - (ev.clientY - rect.top)) / 3);
                } else if (rect.bottom - ev.clientY < edge) {
                    sp = Math.ceil((edge - (rect.bottom - ev.clientY)) / 3);
                }
                this._dragScrollSpeed = Math.max(-18, Math.min(18, sp));
                this.startDragScrollLoop();
            }
            // 目标文件夹高亮 + 允许放置
            var tr = ev.target && ev.target.closest ? ev.target.closest('tr') : null;
            var dirPath = null;
            if (tr) {
                var dirEl = tr.querySelector('[data-dir-path]');
                if (dirEl) {
                    dirPath = dirEl.getAttribute('data-dir-path');
                }
            }
            var valid = dirPath && dirPath !== this._dragPath
                && dirPath.indexOf(this._dragPath + '/') !== 0;
            if (valid) {
                ev.preventDefault();
                if (ev.dataTransfer) {
                    ev.dataTransfer.dropEffect = 'move';
                }
                if (this._dragOverTr !== tr) {
                    if (this._dragOverTr) {
                        this._dragOverTr.classList.remove('drag-over');
                    }
                    tr.classList.add('drag-over');
                    this._dragOverTr = tr;
                }
                this._dropDirPath = dirPath;
            } else if (this._dragOverTr) {
                this._dragOverTr.classList.remove('drag-over');
                this._dragOverTr = null;
                this._dropDirPath = null;
            }
        },
        onTableDragLeave: function () {
            this._dragScrollSpeed = 0;
        },
        startDragScrollLoop: function () {
            var self = this;
            if (this._dragScrollTimer) {
                return;
            }
            this._dragScrollTimer = setInterval(function () {
                if (!self._dragScrollSpeed || !self.dragging) {
                    clearInterval(self._dragScrollTimer);
                    self._dragScrollTimer = null;
                    return;
                }
                var sc = self.sftpScroller();
                if (!sc) {
                    self._dragScrollSpeed = 0;
                    return;
                }
                sc.scrollTop += self._dragScrollSpeed;
            }, 16);
        },
        onTableDrop: function (ev) {
            ev.preventDefault();
            var src = this._dragPath;
            var dest = this._dropDirPath;
            // 防御：未经 dragover（或落点状态丢失）时从事件目标行回推目标目录
            if (!dest && ev.target && ev.target.closest) {
                var tr = ev.target.closest('tr');
                if (tr) {
                    var dirEl = tr.querySelector('[data-dir-path]');
                    if (dirEl) {
                        dest = dirEl.getAttribute('data-dir-path');
                    }
                }
            }
            this.endDrag();
            if (!src || !dest) {
                return;
            }
            var parent = src.substring(0, src.lastIndexOf('/')) || '/';
            if (this.trimSlash(parent) === this.trimSlash(dest)) {
                ELEMENT.Message.info('文件已在该目录中');
                return;
            }
            if (dest === src || dest.indexOf(src + '/') === 0) {
                ELEMENT.Message.warning('不能移动到自身或其子目录');
                return;
            }
            this.confirmMove(src, dest);
        },
        trimSlash: function (p) {
            var s = p || '';
            while (s.length > 1 && s.endsWith('/')) {
                s = s.substring(0, s.length - 1);
            }
            return s;
        },
        confirmMove: function (srcPath, destDir) {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                return;
            }
            var name = srcPath.substring(srcPath.lastIndexOf('/') + 1);
            var self = this;
            this.$confirm(
                '即将把「' + name + '」移动到目录：「' + this.trimSlash(destDir) + '」，移动后原位置将不再保留该文件。',
                '确认移动文件',
                { type: 'warning', confirmButtonText: '确认移动', cancelButtonText: '取消' }
            ).then(function () {
                return http.post('/api/sftp/move', {
                    sessionId: t.sessionId,
                    path: srcPath,
                    destDir: self.trimSlash(destDir)
                });
            }).then(function () {
                ELEMENT.Message.success('「' + name + '」已移动到 ' + self.trimSlash(destDir));
                self.loadDir(t.sftpPath, t);
            }).catch(function () { /* 取消或失败（已提示） */ });
        },

        /* ---------- 进程管理 ---------- */
        onPanelTabClick: function (pane) {
            if (pane && (pane.name === 'process' || pane.name === 'disk' || pane.name === 'ai')) {
                this.ensurePanelWide();
                if (pane.name === 'process' && this.activeTab && this.activeTab.sessionId) {
                    this.loadProcesses(this.activeTab);
                }
                if (pane.name === 'ai' && this.activeTab) {
                    this.scrollAiChat();
                }
            }
        },
        ensurePanelWide: function () {
            if (this.panelWidth < 560) {
                this.panelWidth = 620;
                var self = this;
                this.$nextTick(function () {
                    self.fitActive();
                });
            }
        },
        loadProcesses: function (tab) {
            tab = tab || this.activeTab;
            if (!tab || !tab.sessionId) {
                return;
            }
            tab.procLoading = true;
            http.get('/api/process/list', { params: { sessionId: tab.sessionId } }).then(function (list) {
                tab.procList = list || [];
                tab.procLoading = false;
            }).catch(function () {
                tab.procLoading = false;
            });
        },
        killProcess: function (row, force) {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                return;
            }
            var self = this;
            var action = force ? '强制结束（SIGKILL）' : '结束（SIGTERM）';
            this.$confirm(action + ' 进程「' + row.comm + '」(PID ' + row.pid + ')？', '进程操作',
                { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' })
                .then(function () {
                    return http.post('/api/process/kill', { sessionId: t.sessionId, pid: row.pid, force: !!force });
                })
                .then(function () {
                    ELEMENT.Message.success('已发送 ' + (force ? 'SIGKILL' : 'SIGTERM'));
                    self.loadProcesses(t);
                })
                .catch(function () { /* 取消或失败 */ });
        },
        procCpuValue: function (row) {
            var v = row.cpu != null ? row.cpu : row.cpuAvg;
            return v == null ? -1 : v;
        },
        fmtProcCpu: function (row) {
            var v = this.procCpuValue(row);
            if (v < 0) {
                return '--';
            }
            return (Math.round(v * 10) / 10) + '%';
        },
        sortByCpu: function (a, b) {
            return this.procCpuValue(a) - this.procCpuValue(b);
        },
        sortByMem: function (a, b) {
            return (a.rssMb || 0) - (b.rssMb || 0);
        },
        statText: function (st) {
            if (!st) {
                return '';
            }
            var map = {
                R: '运行中', S: '休眠', D: '不可中断等待', Z: '僵尸进程',
                T: '已停止', t: '跟踪停止', I: '空闲内核线程', X: '已死亡'
            };
            return map[String(st).charAt(0)] || st;
        },

        sortByName: function (a, b) {
            return String(a.name).localeCompare(String(b.name));
        },
        vscodeEdit: function (row) {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                return;
            }
            this.openVscodeEdit(t, this.pathJoin(t.sftpPath, row.name));
        },
        /* 通用：下载到本机并用 VSCode 打开（保存后自动同步回服务器） */
        openVscodeEdit: function (t, path) {
            if (!t || !t.sessionId || !path) {
                return;
            }
            ELEMENT.Message.info('正在下载并用 VSCode 打开…');
            http.post('/api/sftp/vscode', { sessionId: t.sessionId, path: path })
                .then(function (r) {
                    ELEMENT.Message.success(r && r.message ? r.message : '已用 VSCode 打开');
                })
                .catch(function () { /* 已由拦截器提示 */ });
        },

        /* ---------- 命令输入栏 ---------- */
        fitTab: function (tab) {
            if (tab && tab.fit) {
                try { tab.fit.fit(); } catch (e) { /* ignore */ }
            }
        },
        focusCmdInput: function (tab) {
            var t = tab || this.activeTab;
            var self = this;
            this.$nextTick(function () {
                if (t && t._cmdBar) {
                    t._cmdBar.focus();
                    return;
                }
                var r = self.$refs.cmdInput;
                if (r) {
                    r.focus();
                }
            });
        },
        focusAiInput: function (tab) {
            var t = tab || this.activeTab;
            var self = this;
            this.$nextTick(function () {
                if (t && t._cmdBar) {
                    t._cmdBar.focusAi();
                    return;
                }
                if (self.$refs.aiInput) {
                    self.$refs.aiInput.focus();
                }
            });
        },
        toggleCmdBar: function (tab) {
            var t = tab || this.activeTab;
            if (!t) {
                return;
            }
            t.cmdVisible = !t.cmdVisible;
            var self = this;
            this.$nextTick(function () {
                if (self.splitKeys.length > 1) {
                    self.fitSplitPanes();
                } else {
                    self.fitTab(t);
                }
                if (t.cmdVisible) {
                    self.focusCmdInput(t);
                }
            });
        },
        pushHistory: function (t, text) {
            if (!text || !text.trim()) {
                return;
            }
            var h = t.cmdHistory || (t.cmdHistory = []);
            if (!h.length || h[h.length - 1] !== text) {
                h.push(text);
            }
            if (h.length > 200) {
                h.splice(0, h.length - 200);
            }
            try {
                localStorage.setItem('deepshell.cmdHistory.' + t.connId, JSON.stringify(h));
            } catch (e) { /* ignore */ }
        },
        clearHistory: function (tab) {
            var t = tab || this.activeTab;
            if (!t) {
                return;
            }
            t.cmdHistory = [];
            try {
                localStorage.removeItem('deepshell.cmdHistory.' + t.connId);
            } catch (e) { /* ignore */ }
            ELEMENT.Message.success('历史已清空');
        },
        trackTerminalDangerInput: function (tab, data) {
            var s = tab._dangerInput || '';
            var unknown = !!tab._dangerInputUnknown;
            var str = String(data || '');
            for (var i = 0; i < str.length; i++) {
                var ch = str.charAt(i);
                var code = ch.charCodeAt(0);
                if (ch === '\x7f') {
                    s = s.slice(0, -1);
                } else if (ch === '\x15') {
                    s = '';
                    unknown = false;
                } else if (ch === '\x17') {
                    s = s.replace(/\s*\S+\s*$/, '');
                } else if (ch === '\x03') {
                    s = '';
                    unknown = false;
                } else if (ch === '\t' || ch === '\x1b') {
                    unknown = true;
                } else if (code >= 32 && code !== 127) {
                    s += ch;
                }
            }
            tab._dangerInput = s;
            tab._dangerInputUnknown = unknown;
        },
        terminalCommandLine: function (tab) {
            try {
                var term = tab && tab.term;
                if (!term) {
                    return '';
                }
                var buf = term.buffer && term.buffer.active;
                if (!buf) {
                    return '';
                }
                if (buf.type === 'alternate') {
                    return null;
                }
                var y = buf.baseY + buf.cursorY;
                var line = buf.getLine(y);
                if (!line) {
                    return '';
                }
                var text = line.translateToString(true);
                var guard = 0;
                while (y > 0 && guard < 40) {
                    var prev = buf.getLine(y - 1);
                    if (!prev || !prev.isWrapped) {
                        break;
                    }
                    text = prev.translateToString(true) + text;
                    y--;
                    guard++;
                }
                return text;
            } catch (e) {
                return '';
            }
        },
        /**
         * 从 xterm 当前行提取用户提交的命令（去掉提示符），用于手敲命令审计。
         * 无法识别提示符（密码 / SSH 确认 / 全屏程序等交互提示）时返回 skip，避免把口令写入审计。
         */
        terminalAuditCommand: function (tab) {
            var raw = this.terminalCommandLine(tab);
            if (raw == null) {
                return { prompt: false, command: '' };
            }
            var text = String(raw).replace(/\s+$/, '');
            if (!text.trim()) {
                return { prompt: false, command: '' };
            }
            var m = text.match(/^[A-Za-z]:\\[^>]*>\s*(.*)$/);
            if (m) {
                return { prompt: true, command: m[1].trim() };
            }
            m = text.match(/^PS [^>]*>\s*(.*)$/);
            if (m) {
                return { prompt: true, command: m[1].trim() };
            }
            m = text.match(/^.*?[#$%❯]\s+(.*)$/);
            if (m) {
                return { prompt: true, command: m[1].trim() };
            }
            m = text.match(/^.*?>\s+(.*)$/);
            if (m) {
                return { prompt: true, command: m[1].trim() };
            }
            if (/[#$%❯>]\s*$/.test(text)) {
                return { prompt: true, command: '' };
            }
            return { prompt: false, command: '' };
        },
        /**
         * 本地 Shell 行模式（Windows cmd 的管道不提供行编辑）：前端负责回显与退格，
         * 只在回车时把整行交给后端；密码等无法识别提示符的交互直接透传、不做本地回显。
         */
        handleLocalLineInput: function (tab, term, data) {
            if (!tab || !term || data == null || data === '') {
                return;
            }
            var self = this;
            var sendFrame = function (text, auditLine, skip) {
                if (!tab.ws || tab.ws.readyState !== 1) {
                    return;
                }
                var frame = { type: 'data', data: text, auditTyped: true };
                if (auditLine) {
                    frame.auditLine = auditLine;
                } else if (skip) {
                    frame.auditSkip = true;
                }
                tab.ws.send(JSON.stringify(frame));
            };
            var newlineCount = (String(data).match(/\r\n|\r|\n/g) || []).length;
            if (newlineCount > 1) {
                // 多行粘贴：整段回显后交给后端逐行审计
                var pasteAudit = self.terminalAuditCommand(tab);
                var pasted = String(data).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                if (pasteAudit.prompt) {
                    term.write(pasted.replace(/\n/g, '\r\n'));
                    sendFrame(pasted, '', false);
                } else {
                    sendFrame(pasted, '', true);
                }
                tab._localLine = '';
                tab._localPrompt = false;
                return;
            }
            for (var i = 0; i < data.length; i++) {
                var ch = data.charAt(i);
                var code = data.charCodeAt(i);
                if (code === 27) {
                    // 本地行模式暂不支持方向键编辑，忽略 ESC 序列
                    var j = i + 1;
                    if (data.charAt(j) === '[') {
                        j++;
                        while (j < data.length) {
                            var c = data.charCodeAt(j);
                            if (c >= 0x40 && c <= 0x7e) {
                                break;
                            }
                            j++;
                        }
                    } else if (data.charAt(j) === 'O') {
                        j++;
                    }
                    i = Math.min(j, data.length - 1);
                    continue;
                }
                if (ch === '\r' || ch === '\n') {
                    if (ch === '\r' && data.charAt(i + 1) === '\n') {
                        i++;
                    }
                    var line = tab._localLine || '';
                    var atPrompt = !!tab._localPrompt;
                    term.write('\r\n');
                    sendFrame(line + '\n', atPrompt ? line : '', !atPrompt);
                    tab._localLine = '';
                    tab._localPrompt = false;
                    continue;
                }
                if (code === 127 || code === 8) {
                    if (tab._localLine && tab._localLine.length) {
                        tab._localLine = tab._localLine.slice(0, -1);
                        term.write('\b \b');
                    }
                    continue;
                }
                if (code === 3) {
                    tab._localLine = '';
                    tab._localPrompt = false;
                    term.write('^C\r\n');
                    if (tab.ws && tab.ws.readyState === 1) {
                        tab.ws.send(JSON.stringify({
                            type: 'data', data: '\u0003', auditTyped: true, auditSkip: true
                        }));
                    }
                    continue;
                }
                if (code === 9) {
                    continue;
                }
                if (code < 32) {
                    if (!tab._localLine && tab.ws && tab.ws.readyState === 1) {
                        tab.ws.send(JSON.stringify({
                            type: 'data', data: ch, auditTyped: true, auditSkip: true
                        }));
                    }
                    continue;
                }
                if (!tab._localLine && !tab._localPrompt) {
                    var audit = self.terminalAuditCommand(tab);
                    if (!audit.prompt) {
                        if (tab.ws && tab.ws.readyState === 1) {
                            tab.ws.send(JSON.stringify({
                                type: 'data', data: ch, auditTyped: true, auditSkip: true
                            }));
                        }
                        continue;
                    }
                    tab._localPrompt = true;
                }
                tab._localLine = (tab._localLine || '') + ch;
                term.write(ch);
            }
        },
        confirmDangerousCommand: function (command, proceed, forcedRule) {
            if (!this.dangerConfirmEnabled) {
                if (this._dangerPromptOpen) {
                    return false;
                }
                proceed();
                return true;
            }
            var rule = forcedRule || dangerousCommandRule(command);
            if (!rule) {
                if (this._dangerPromptOpen) {
                    return false;
                }
                proceed();
                return true;
            }
            if (this._dangerPromptOpen) {
                return false;
            }
            var self = this;
            this._dangerPromptOpen = true;
            var cmd = escapeAiHtml(String(command || '').trim());
            var html = '<div class="danger-cmd-content">'
                + '<p>检测到高风险操作：<b>' + escapeAiHtml(rule.label) + '</b></p>'
                + '<pre>' + cmd + '</pre>'
                + '<p class="danger-cmd-tip">只有点击「仍然执行」后，命令才会发送到终端；取消则不会执行。</p>'
                + '</div>';
            this.$confirm(html, '危险命令确认', {
                type: 'warning',
                dangerouslyUseHTMLString: true,
                confirmButtonText: '仍然执行',
                cancelButtonText: '取消',
                closeOnClickModal: false,
                customClass: 'danger-cmd-confirm',
                confirmButtonClass: 'el-button--danger'
            }).then(function () {
                self._dangerPromptOpen = false;
                proceed();
            }).catch(function () {
                self._dangerPromptOpen = false;
            });
            return false;
        },
        sendCmd: function (tab) {
            var t = tab || this.activeTab;
            if (!t || (!t.sessionId && !t.localShell)) {
                return;
            }
            var text = t.cmdText == null ? '' : t.cmdText;
            if (!text.trim() && this.cmdOpts.ignoreBlank) {
                return;
            }
            var payload = text + (this.cmdOpts.appendCr ? '\r' : '');
            var targets;
            if (t.desktopOnly) {
                targets = (t.ws && t.ws.readyState === 1 && t.status === 'open') ? [t] : [];
            } else {
                targets = this.tabs.filter(function (x) {
                    return (t.sendTargets || []).indexOf(x.key) >= 0
                        && x.ws && x.ws.readyState === 1 && x.status === 'open';
                });
            }
            if (!targets.length) {
                ELEMENT.Message.warning('没有已连接的会话');
                return;
            }
            var data = JSON.stringify({ type: 'data', data: payload });
            var self = this;
            this.confirmDangerousCommand(text, function () {
                targets.forEach(function (x) {
                    if (x.ws && x.ws.readyState === 1) {
                        if (x.localShell && x.localLineMode && x.term) {
                            x.term.write('\r\x1b[K' + text.replace(/\r?\n/g, '\r\n') + '\r\n');
                            x._localLine = '';
                            x._localPrompt = false;
                        }
                        x.ws.send(data);
                    }
                });
                self.pushHistory(t, text);
                if (self.cmdOpts.clearAfterSend) {
                    t.cmdText = '';
                }
                t._comp = null;
                self.focusCmdInput(t);
            });
        },
        toggleTarget: function (key, checked, tab) {
            var t = tab || this.activeTab;
            if (!t) {
                return;
            }
            var arr = t.sendTargets || (t.sendTargets = []);
            var i = arr.indexOf(key);
            if (checked && i < 0) {
                arr.push(key);
            }
            if (!checked && i >= 0) {
                arr.splice(i, 1);
            }
        },
        doComplete: function (tab, comp) {
            var self = this;
            var t = tab || this.activeTab;
            var cmdComp = comp || (t && t._cmdBar && t._cmdBar.$refs.cmdInput) || this.$refs.cmdInput;
            if (!t || !cmdComp) {
                return;
            }
            var el = cmdComp.$refs.input;
            var val = t.cmdText || '';
            var pos = el.selectionStart == null ? val.length : el.selectionStart;
            var left = val.slice(0, pos);
            var right = val.slice(pos);
            var m = left.match(/(\S+)$/);
            var token = m ? m[1] : '';
            if (!token) {
                return;
            }
            if (t._comp && t._comp.token === token && t._comp.list && t._comp.list.length > 1) {
                t._comp.idx = (t._comp.idx + 1) % t._comp.list.length;
                this.applyCompletion(t, left, right, token, t._comp);
                return;
            }
            var isPath = token.indexOf('/') >= 0 || token.charAt(0) === '~';
            if (isPath) {
                var slash = token.lastIndexOf('/');
                var dirToken;
                var prefix;
                if (slash >= 0) {
                    dirToken = token.slice(0, slash + 1) || '/';
                    prefix = token.slice(slash + 1);
                } else {
                    dirToken = '~/';
                    prefix = token.slice(1);
                }
                var dir = dirToken;
                if (dir.indexOf('~') === 0) {
                    if (!t.sftpHome) {
                        ELEMENT.Message.warning('主页目录未知，请先打开文件面板');
                        return;
                    }
                    dir = dir.replace('~', t.sftpHome) || '/';
                }
                if (dir.charAt(0) !== '/') {
                    var base = t.sftpPath || t.sftpHome || '/';
                    dir = base.replace(/\/+$/, '') + '/' + dir.replace(/^\.\//, '');
                }
                http.get('/api/sftp/list', { params: { sessionId: t.sessionId, path: dir } }).then(function (list) {
                    var cands = (list || []).filter(function (e) {
                        return e.name.indexOf(prefix) === 0;
                    }).map(function (e) {
                        return dirToken + e.name + (e.dir ? '/' : '');
                    });
                    self.applyCandidates(t, left, right, token, cands);
                }).catch(function () { /* 忽略 */ });
                return;
            }
            var pool = [];
            (t.cmdHistory || []).forEach(function (c) { pool.push(c); });
            (self.snippets || []).forEach(function (s) { pool.push(s.command); });
            var uniq = [];
            pool.forEach(function (c) {
                if (c && c.indexOf(token) === 0 && uniq.indexOf(c) < 0) {
                    uniq.push(c);
                }
            });
            this.applyCandidates(t, left, right, token, uniq, cmdComp);
        },
        applyCandidates: function (t, left, right, token, cands, cmdComp) {
            if (!cands || !cands.length) {
                ELEMENT.Message.info('没有匹配项');
                return;
            }
            t._comp = { token: token, list: cands, idx: 0 };
            this.applyCompletion(t, left, right, token, t._comp, cmdComp);
        },
        applyCompletion: function (t, left, right, token, compState, cmdComp) {
            var choice = compState.list[compState.idx];
            var newLeft = left.slice(0, left.length - token.length) + choice;
            t.cmdText = newLeft + right;
            var self = this;
            this.$nextTick(function () {
                var c2 = cmdComp || (t._cmdBar && t._cmdBar.$refs.cmdInput) || self.$refs.cmdInput;
                if (c2) {
                    var el2 = c2.$refs.input;
                    el2.setSelectionRange(newLeft.length, newLeft.length);
                    el2.focus();
                }
            });
        },
        bindTerminalContextMenu: function (tab, el) {
            var self = this;
            if (!el) {
                return;
            }
            if (el._deepTermMenu && el._deepTermTab === tab) {
                return;
            }
            if (el._deepTermMenu) {
                el.removeEventListener('contextmenu', el._deepTermMenu);
            }
            el._deepTermTab = tab;
            el._deepTermMenu = function (ev) {
                if (ev.button !== 2) {
                    return;
                }
                ev.preventDefault();
                self.openTerminalMenu(tab, ev, el);
            };
            el.addEventListener('contextmenu', el._deepTermMenu);
        },
        openTerminalMenu: function (tab, ev, el) {
            if (!tab || !tab.term) {
                return;
            }
            if (!tab.desktopOnly && this.activeKey !== tab.key) {
                this.activate(tab.key);
            }
            var text = '';
            try {
                text = tab.term.getSelection() || '';
            } catch (e) { /* ignore */ }
            text = text.replace(/\r\n?/g, '\n');
            this.termMenu = {
                visible: true,
                x: ev.clientX,
                y: ev.clientY,
                text: text,
                context: tab.desktopOnly ? 'desktop' : 'workbench',
                tabKey: tab.key,
                windowId: tab.windowId || '',
                hasSelection: !!text.trim(),
                canAi: !tab.localShell && !!tab.sessionId
            };
            var self = this;
            this.$nextTick(function () {
                var menu = self.$refs.termMenu;
                if (!menu) {
                    return;
                }
                var mw = menu.offsetWidth || 180;
                var mh = menu.offsetHeight || 0;
                var rect = el && el.getBoundingClientRect
                    ? el.getBoundingClientRect()
                    : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
                var pad = 4;
                var x = Math.min(Math.max(ev.clientX, rect.left + pad), rect.right - mw - pad);
                var y = Math.min(Math.max(ev.clientY, rect.top + pad), rect.bottom - mh - pad);
                self.termMenu.x = Math.round(Math.max(4, Math.min(x, window.innerWidth - mw - 4)));
                self.termMenu.y = Math.round(Math.max(4, Math.min(y, window.innerHeight - mh - 4)));
            });
        },
        closeTerminalMenu: function () {
            this.termMenu.visible = false;
        },
        termMenuTab: function () {
            var menu = this.termMenu;
            if (menu.context === 'desktop' && menu.windowId) {
                var w = this.desktop.windows.find(function (x) {
                    return x.id === menu.windowId;
                });
                return w && w.termTab ? w.termTab : null;
            }
            return this.tabs.find(function (t) {
                return t.key === menu.tabKey;
            }) || null;
        },
        termMenuCopy: function () {
            var text = this.termMenu.text;
            this.closeTerminalMenu();
            if (text) {
                this.copyText(text);
            }
        },
        termMenuPasteSelection: function () {
            var t = this.termMenuTab();
            var text = this.termMenu.text;
            this.closeTerminalMenu();
            if (!t || !text) {
                return;
            }
            var oneLine = text.replace(/\n+/g, ' ').trim();
            if (!oneLine) {
                return;
            }
            this.insertTextToCmdInput(t, oneLine);
        },
        termMenuExplain: function () {
            var t = this.termMenuTab();
            var text = this.termMenu.text;
            var context = this.termMenu.context;
            var self = this;
            this.closeTerminalMenu();
            if (!t || !text.trim()) {
                return;
            }
            if (t.localShell) {
                ELEMENT.Message.warning('本地终端没有 AI 终端，请连接服务器后使用');
                return;
            }
            if (!t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            var prompt = this.terminalExplainPrompt(text);
            var target = t;
            if (context === 'desktop') {
                if (!this.openAiDesktopWindow()) {
                    return;
                }
                target = this.desktopTab;
            } else {
                this.panelVisible = true;
                this.panelTab = 'ai';
            }
            if (!target) {
                return;
            }
            this.$nextTick(function () {
                self.aiExplainSelection(target, prompt);
            });
        },
        terminalExplainPrompt: function (text) {
            var t = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
            if (t.length > 6000) {
                t = t.slice(0, 1000) + '\n…（中间内容已省略）…\n' + t.slice(-5000);
            }
            return '请解释下面这段终端内容是什么、是否出现错误。'
                + '如果失败，请分析可能原因并给出解决方向；需要更多信息时，只告诉我该运行哪些命令，'
                + '不要自己执行任何命令。\n\n'
                + '--- 终端内容开始 ---\n' + t + '\n--- 终端内容结束 ---';
        },
        aiExplainSelection: function (t, prompt) {
            if (!t || !prompt) {
                return;
            }
            if (t.chatLoading) {
                t.chatInput = prompt;
                ELEMENT.Message.info('AI 对话加载中，解释请求已填入输入框，加载完成后回车发送');
                return;
            }
            var conv = this.aiActiveConv(t);
            if (!conv) {
                t.chatInput = prompt;
                ELEMENT.Message.info('AI 对话尚未就绪，解释请求已填入输入框');
                return;
            }
            if (conv._run && conv._run.busy) {
                t.chatInput = prompt;
                ELEMENT.Message.info('当前 AI 对话正在执行，解释请求已填入输入框');
                return;
            }
            t.chatInput = prompt;
            this.aiChatSend(t);
        },
        termMenuSearch: function () {
            var t = this.termMenuTab();
            var text = (this.termMenu.text || '').trim();
            var self = this;
            this.closeTerminalMenu();
            if (!t || !text) {
                return;
            }
            t.cmdVisible = true;
            this.$nextTick(function () {
                self.fitTab(t);
                var bar = t._cmdBar;
                if (bar && bar.openSearchWith) {
                    bar.openSearchWith(text);
                } else if (t.searchAddon) {
                    try {
                        t.searchAddon.findNext(text, self.buildSearchOptions(false, {}));
                    } catch (e) { /* ignore */ }
                }
            });
        },
        termMenuSelectAll: function () {
            var t = this.termMenuTab();
            this.closeTerminalMenu();
            if (t && t.term) {
                t.term.selectAll();
                t.term.focus();
            }
        },
        termMenuClear: function () {
            var t = this.termMenuTab();
            this.closeTerminalMenu();
            if (!t || !t.term) {
                return;
            }
            t.term.clear();
            try { t.term.clearSelection(); } catch (e) { /* ignore */ }
            if (t.searchAddon && t.searchAddon.clearDecorations) {
                try { t.searchAddon.clearDecorations(); } catch (e) { /* ignore */ }
            }
            t.searchResultIndex = -1;
            t.searchResultCount = 0;
            t.term.focus();
        },
        insertTextToCmdInput: function (tab, text, inputComp) {
            var self = this;
            var t = tab || this.activeTab;
            var txt = text == null ? '' : String(text);
            if (!t || !txt) {
                return;
            }
            t.cmdVisible = true;
            this.$nextTick(function () {
                self.fitTab(t);
                var comp = inputComp || (t._cmdBar && t._cmdBar.$refs.cmdInput) || self.$refs.cmdInput;
                var el = comp && comp.$refs.input;
                var cur = t.cmdText || '';
                if (el) {
                    var s = el.selectionStart == null ? cur.length : el.selectionStart;
                    var e2 = el.selectionEnd == null ? s : el.selectionEnd;
                    t.cmdText = cur.slice(0, s) + txt + cur.slice(e2);
                    var caret = s + txt.length;
                    self.$nextTick(function () {
                        el.setSelectionRange(caret, caret);
                        el.focus();
                    });
                } else {
                    t.cmdText = cur + txt;
                    self.focusCmdInput(t);
                }
            });
        },
        copySelection: function (tab) {
            var t = tab || this.activeTab;
            if (!t) {
                return;
            }
            var text = t.term ? t.term.getSelection() : '';
            if (!text) {
                text = t.cmdText || '';
            }
            var self = this;
            var done = function () {
                ELEMENT.Message.success(text ? '已复制' : '没有可复制的内容');
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(function () {
                    self.legacyCopy(text);
                    done();
                });
            } else {
                this.legacyCopy(text);
                done();
            }
        },
        legacyCopy: function (text) {
            var ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e) { /* ignore */ }
            ta.remove();
        },
        pasteToInput: function (tab, inputComp) {
            var self = this;
            var t = tab || this.activeTab;
            if (!t) {
                return;
            }
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then(function (txt) {
                    if (!txt) {
                        return;
                    }
                    self.insertTextToCmdInput(t, txt, inputComp);
                }).catch(function () {
                    ELEMENT.Message.warning('浏览器未授予剪贴板读取权限，请直接 Ctrl+V');
                });
            } else {
                ELEMENT.Message.warning('当前浏览器不支持剪贴板读取，请直接 Ctrl+V');
            }
        },
        editCurrentConnection: function () {
            var t = this.activeTab;
            if (!t || !t.connId) {
                return;
            }
            // 复用工作台内的连接编辑弹窗（此前的跳首页方式已废弃）
            this.editConnFromDialog(t.connId);
        },
        toggleFullscreen: function () {
            if (!document.fullscreenElement) {
                if (document.documentElement.requestFullscreen) {
                    document.documentElement.requestFullscreen().catch(function () { /* ignore */ });
                }
            } else if (document.exitFullscreen) {
                document.exitFullscreen().catch(function () { /* ignore */ });
            }
        },
        findNext: function (tab, text, incremental, opts) {
            var t = tab || this.activeTab;
            if (t && t.searchAddon && text) {
                try {
                    t.searchAddon.findNext(text, this.buildSearchOptions(incremental, opts));
                } catch (e) { /* 正则无效时忽略，由搜索框提示 */ }
            }
        },
        findPrev: function (tab, text, incremental, opts) {
            var t = tab || this.activeTab;
            if (t && t.searchAddon && text) {
                try {
                    t.searchAddon.findPrevious(text, this.buildSearchOptions(incremental, opts));
                } catch (e) { /* 正则无效时忽略，由搜索框提示 */ }
            }
        },
        buildSearchOptions: function (incremental, opts) {
            var options = {
                decorations: SEARCH_DECOR,
                incremental: !!incremental,
                caseSensitive: !!(opts && opts.caseSensitive),
                wholeWord: !!(opts && opts.wholeWord),
                regex: !!(opts && opts.regex)
            };
            return options;
        },

        /* ---------- 常用目录（按连接/主机隔离） ---------- */
        loadCommonDirs: function (connId) {
            var self = this;
            var cid = connId != null ? connId : (this.activeTab && this.activeTab.connId);
            if (cid == null) {
                return Promise.resolve();
            }
            return http.get('/api/common-dirs', { params: { connId: cid } }).then(function (d) {
                self.$set(self.commonDirsByConn, cid, d || []);
            });
        },
        addCommonDir: function () {
            var self = this;
            var t = this.uiTab;
            if (!t || t.connId == null) {
                ELEMENT.Message.warning('请先连接主机');
                return;
            }
            var p = (this.newDirPath || '').trim();
            if (!p) {
                ELEMENT.Message.warning('请输入目录路径');
                return;
            }
            http.post('/api/common-dirs', { connId: t.connId, path: p }).then(function () {
                ELEMENT.Message.success('已添加');
                self.newDirPath = '';
                self.loadCommonDirs(t.connId);
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        addCurrentDir: function () {
            var self = this;
            var t = this.uiTab;
            if (!t || t.connId == null) {
                ELEMENT.Message.warning('请先连接主机');
                return;
            }
            var p = this.desktop.visible
                ? (this.desk.path || this.desktopHomeDir)
                : (t.sftpPath || t.sftpHome);
            if (!p) {
                ELEMENT.Message.warning('当前目录未知，请先打开文件面板或资源管理器');
                return;
            }
            http.post('/api/common-dirs', { connId: t.connId, path: p }).then(function () {
                ELEMENT.Message.success('已添加：' + p);
                self.loadCommonDirs(t.connId);
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        removeCommonDir: function (d) {
            var self = this;
            var t = this.uiTab;
            if (!t || t.connId == null) {
                return;
            }
            this.$confirm('从常用目录中移除「' + d.path + '」？', '提示', { type: 'warning' })
                .then(function () {
                    return http.delete('/api/common-dirs/' + d.id, { params: { connId: t.connId } });
                })
                .then(function () {
                    ELEMENT.Message.success('已移除');
                    self.loadCommonDirs(t.connId);
                })
                .catch(function () {
                });
        },
        cdIntoDir: function (d) {
            var t = this.uiTab;
            if (!t || !t.ws || t.ws.readyState !== 1 || t.status !== 'open') {
                ELEMENT.Message.warning('当前没有已连接的终端会话');
                return;
            }
            var path = (d && d.path) || '';
            var target;
            if (/^[\w./~-]+$/.test(path)) {
                target = path;
            } else if (path.charAt(0) === '~') {
                // ~ 开头用双引号包裹剩余部分，保留波浪号线展开
                target = '~/"' + path.slice(1).replace(/^\/+/, '').replace(/(["\\$`])/g, '\\$1') + '"';
            } else {
                target = "'" + path.replace(/'/g, "'\\''") + "'";
            }
            t.ws.send(JSON.stringify({ type: 'data', data: 'cd ' + target + '\r' }));
            if (this.desktop.visible) {
                if (this.desk.id) {
                    this.desktopGo(path);
                } else {
                    this.openDesktopExplorerWindow(path);
                }
                return;
            }
            if (t.term) {
                t.term.focus();
            }
            // 立即联动文件面板（目录跟随关闭时也生效；开启时后续 cwd 推送因路径相同不会重复加载）
            if (t.sessionId && t.sftpPath !== path) {
                this.loadDir(path, t);
            }
        },
        /* ---------- 快捷命令 ---------- */
        snippetTargetTabs: function () {
            // 解析快捷命令的目标会话：current=当前 / all=所有已连接 / custom=勾选的已连接会话
            var alive = function (x) {
                return x.ws && x.ws.readyState === 1 && x.status === 'open';
            };
            // 桌面里的快捷命令固定发送到当前桌面连接
            if (this.desktop.visible) {
                var dt = this.uiTab;
                return dt && alive(dt) ? [dt] : [];
            }
            if (this.snippetTarget === 'all') {
                return this.tabs.filter(alive);
            }
            if (this.snippetTarget === 'custom') {
                var keys = this.snippetTargets;
                return this.tabs.filter(function (x) {
                    return keys.indexOf(x.key) >= 0 && alive(x);
                });
            }
            var t = this.uiTab;
            return t && alive(t) ? [t] : [];
        },
        sendSnippetText: function (text) {
            var targets = this.snippetTargetTabs();
            if (!targets.length) {
                ELEMENT.Message.warning(this.snippetTarget === 'custom'
                    ? '没有已连接的指定会话，请重新勾选'
                    : '没有已连接的终端会话');
                return;
            }
            var self = this;
            var payload = JSON.stringify({ type: 'data', data: text });
            var active = this.uiTab;
            var doSend = function () {
                targets.forEach(function (x) {
                    if (x.ws && x.ws.readyState === 1) {
                        x.ws.send(payload);
                    }
                });
                if (!self.desktop.visible && active && targets.indexOf(active) >= 0 && active.term) {
                    active.term.focus();
                }
            };
            if (/[\r\n]/.test(text) && dangerousCommandRule(text)) {
                this.confirmDangerousCommand(text, doSend);
                return;
            }
            doSend();
        },
        toggleSnippetTarget: function (key, checked) {
            var i = this.snippetTargets.indexOf(key);
            if (checked && i < 0) {
                this.snippetTargets.push(key);
            }
            if (!checked && i >= 0) {
                this.snippetTargets.splice(i, 1);
            }
        },
        runSnippet: function (c) {
            this.sendSnippetText(c.command + '\r');
        },
        fillSnippet: function (c) {
            this.sendSnippetText(c.command);
        },
        sendToActive: function (text) {
            var t = this.activeTab;
            if (!t || !t.ws || t.ws.readyState !== 1 || t.status !== 'open') {
                ELEMENT.Message.warning('当前没有已连接的终端会话');
                return;
            }
            var self = this;
            var doSend = function () {
                if (!t.ws || t.ws.readyState !== 1) {
                    return;
                }
                t.ws.send(JSON.stringify({ type: 'data', data: text }));
                if (t.term) {
                    t.term.focus();
                }
            };
            if (/[\r\n]/.test(text) && dangerousCommandRule(text)) {
                this.confirmDangerousCommand(text, doSend);
                return;
            }
            doSend();
        },
        loadSnippets: function () {
            var self = this;
            return http.get('/api/quick-commands').then(function (d) {
                self.snippets = d || [];
            });
        },
        addSnippet: function () {
            var f = this.newCmd;
            if (!f.name || !f.name.trim()) {
                ELEMENT.Message.warning('请输入名称');
                return;
            }
            if (!f.command || !f.command.trim()) {
                ELEMENT.Message.warning('请输入命令内容');
                return;
            }
            var self = this;
            http.post('/api/quick-commands', { name: f.name.trim(), command: f.command.trim() })
                .then(function () {
                    ELEMENT.Message.success('已添加');
                    f.name = '';
                    f.command = '';
                    self.loadSnippets();
                })
                .catch(function () { /* 已由拦截器提示 */ });
        },
        openCmdEdit: function (c) {
            this.cmdEditForm = { id: c.id, name: c.name, command: c.command };
            this.cmdEditDialog = true;
        },
        saveCmdEdit: function () {
            var f = this.cmdEditForm;
            if (!f.id) {
                return;
            }
            if (!f.name || !f.name.trim()) {
                ELEMENT.Message.warning('请输入名称');
                return;
            }
            if (!f.command || !f.command.trim()) {
                ELEMENT.Message.warning('请输入命令内容');
                return;
            }
            var self = this;
            this.cmdEditSaving = true;
            http.put('/api/quick-commands/' + f.id, { name: f.name.trim(), command: f.command.trim() })
                .then(function () {
                    ELEMENT.Message.success('已保存');
                    self.cmdEditDialog = false;
                    self.loadSnippets();
                })
                .catch(function () { /* 已由拦截器提示 */ })
                .then(function () {
                    self.cmdEditSaving = false;
                });
        },
        removeSnippet: function () {
            var f = this.cmdEditForm;
            if (!f.id) {
                return;
            }
            var self = this;
            this.$confirm('确定删除快捷命令「' + f.name + '」？', '提示', { type: 'warning' })
                .then(function () {
                    return http.delete('/api/quick-commands/' + f.id);
                })
                .then(function () {
                    ELEMENT.Message.success('已删除');
                    self.cmdEditDialog = false;
                    self.loadSnippets();
                })
                .catch(function () { /* 已取消或已由拦截器提示 */ });
        }
    },
    created: function () {
        this.applyDesktopAppIconStylesForConn(this.desktopAppStyleConnId);
    },
    mounted: function () {
        var self = this;
        try {
            var w = parseInt(localStorage.getItem('deepshell.panelWidth') || '', 10);
            if (w >= 320 && w <= 1400) {
                this.panelWidth = w;
            }
        } catch (e) { /* ignore */ }
        self.loadConnections().then(function () {
            var params = new URLSearchParams(location.search);
            if (params.get('local') === '1') {
                self.openLocalDesktop();
                return;
            }
            var external = params.get('external') === '1';
            var externalSource = params.get('source') || '';
            var protocolError = params.get('protocolError');
            if (protocolError) {
                // 外部调用失败：现有实例 / 冷启动进程已在浏览器中打开提示页
                history.replaceState(null, '', '/workspace');
                ELEMENT.Message.error(protocolError);
            }
            var cid = params.get('connId');
            if (cid) {
                // 带参打开（连接管理页「连接」/「返回终端」/ 新标签打开桌面 / 外部调用）：仅本次生效，
                // 校验存在后立即清理地址栏参数，避免参数陈旧后被反复重开成「连接 #id」
                var view = params.get('view');
                var forceWorkbench = view === 'workbench';
                var forceDesktop = view === 'desktop';
                var desktopPath = params.get('path') || '';
                history.replaceState(null, '', '/workspace');
                var id = Number(cid);
                var exists = self.connections.some(function (c) { return c.id === id; });
                if (exists) {
                    var tab = self.openTab(id, null, !forceWorkbench, forceDesktop);
                    if (tab) {
                        tab.desktopOpenPath = desktopPath;
                        if (external) {
                            ELEMENT.Message.success('已通过外部调用打开「' + tab.title + '」'
                                + (externalSource ? ' · 来源：' + externalSource : ''));
                        }
                    }
                } else {
                    ELEMENT.Message.warning('连接不存在或已被删除');
                }
                return;
            }
            if (external) {
                history.replaceState(null, '', '/workspace');
            }
            self.restoreOpenTabs();
        });
        self.loadFolders();
        self.loadSnippets();
        self.loadAppInfo();
        self.maybeShowOnboarding();
        self.loadDesktopPlugins(false);
        self.loadBuiltinPlugins(false);
        window.addEventListener('message', self.onPluginBridgeMessage);
        self.connectWorkspaceEvents();
        window.addEventListener('beforeunload', function () {
            self._eventClosed = true;
            if (self._eventWs) {
                try { self._eventWs.close(); } catch (e) { /* ignore */ }
            }
        });
        self.loadLocalDownloadStatus();
        self.loadAuthStatus();
        self.loadAiRuntimeConfig();
        // 记录用户活跃时间：仅在页面可见且有近期操作时续期 Token，避免后台标签页永久保活
        self._lastUserActivity = Date.now();
        var markUserActivity = function () {
            self._lastUserActivity = Date.now();
        };
        ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'touchmove'].forEach(function (evt) {
            window.addEventListener(evt, markUserActivity, { passive: true });
        });
        setInterval(function () {
            if (!self.authStatus.enabled || document.visibilityState === 'hidden') {
                return;
            }
            if (Date.now() - (self._lastUserActivity || 0) > 30 * 60 * 1000) {
                return;
            }
            self.pingAuth();
        }, 5 * 60 * 1000);
        // Token 到期检查：仍在活跃使用则先续期，否则回到登录页
        setInterval(function () {
            if (!self.authStatus.enabled || !self.authStatus.tokenExpiresAt) {
                return;
            }
            if (Date.now() < self.authStatus.tokenExpiresAt - 60 * 1000) {
                return;
            }
            if (document.visibilityState !== 'hidden'
                    && Date.now() - (self._lastUserActivity || 0) <= 30 * 60 * 1000) {
                self.pingAuth();
            } else {
                redirectToLogin();
            }
        }, 60 * 1000);
        window.addEventListener('resize', function () {
            self.termMenu.visible = false;
            self.fitActive();
            self.fitDesktopWindows();
        });
        // 系统文件拖入浏览器窗口 → 上传到当前 SFTP 目录（仅识别 Files 类型，不影响内部拖拽）
        window.addEventListener('dragenter', function (e) {
            self.onWindowDragEnter(e);
        });
        window.addEventListener('dragover', function (e) {
            self.onWindowDragOver(e);
        });
        window.addEventListener('dragleave', function (e) {
            self.onWindowDragLeave(e);
        });
        window.addEventListener('drop', function (e) {
            self.onWindowDrop(e);
        });
        // 双击 Ctrl 显示/隐藏命令输入栏（两次 Ctrl 之间没有其他按键）
        self._lastCtrl = 0;
        self._otherSinceCtrl = false;
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Control') {
                var now = Date.now();
                if (now - self._lastCtrl < 420 && !self._otherSinceCtrl) {
                    self._lastCtrl = 0;
                    if (self.hotkeySettings.doubleCtrl) {
                        var target = self.desktopTerminalFocusTab()
                            || (self.desktop.visible ? null : self.activeTab);
                        if (target) {
                            self.toggleCmdBar(target);
                        }
                    }
                } else {
                    self._lastCtrl = now;
                }
                self._otherSinceCtrl = false;
            } else if (e.key !== 'Meta' && e.key !== 'Shift') {
                self._otherSinceCtrl = true;
            }
        });
        // 右键菜单关闭时机：点击空白 / Esc / 窗口失焦 / 在他处右键
        document.addEventListener('click', function () {
            if (self.termMenu.visible) {
                self.termMenu.visible = false;
            }
            if (self.tabMenu.visible) {
                self.tabMenu.visible = false;
            }
            if (self.topMenuVisible) {
                self.topMenuVisible = false;
            }
            if (self.folderMenu.visible) {
                self.folderMenu.visible = false;
            }
            if (self.desktop.taskMenu.visible) {
                self.desktop.taskMenu.visible = false;
            }
            if (self.desktop.iconMenu.visible) {
                self.desktop.iconMenu.visible = false;
            }
            if (self.desktop.trashMenu.visible) {
                self.desktop.trashMenu.visible = false;
            }
            if (self.desktop.menu.visible) {
                self.desktop.menu.visible = false;
            }
            if (self.desktop.calendarOpen) {
                self.desktop.calendarOpen = false;
            }
            if (self.desktop.taskbarMenu.visible) {
                self.desktop.taskbarMenu.visible = false;
            }
            if (self.desktop.trayMenu.visible) {
                self.desktop.trayMenu.visible = false;
            }
            if (self.desktop.notifOpen) {
                self.desktop.notifOpen = false;
            }
            if (self.taskmgr.ctxMenu.visible) {
                self.taskmgr.ctxMenu.visible = false;
            }
            if (self.taskmgr.runVisible) {
                self.taskmgr.runVisible = false;
            }
            self.closeDesktopSubMenus();
        });
        document.addEventListener('contextmenu', function (e) {
            var target = e.target;
            var inTerminal = target && target.closest && target.closest('.term-box, .dsk-term');
            if (self.termMenu.visible && !inTerminal
                && !(target && target.closest && target.closest('.term-menu'))) {
                self.termMenu.visible = false;
            }
            if (self.tabMenu.visible
                && !(e.target && e.target.closest && e.target.closest('.ws-topbar'))) {
                self.tabMenu.visible = false;
            }
            if (self.folderMenu.visible
                && !(e.target && e.target.closest && e.target.closest('.conn-row.is-folder'))) {
                self.folderMenu.visible = false;
            }
            var inTaskbar = e.target && e.target.closest && e.target.closest('.dsk-taskbar');
            if (self.desktop.taskbarMenu.visible && !inTaskbar) {
                self.desktop.taskbarMenu.visible = false;
            }
            if (self.desktop.trayMenu.visible && !inTaskbar) {
                self.desktop.trayMenu.visible = false;
            }
            if (self.taskmgr.ctxMenu.visible
                    && !(e.target && e.target.closest && e.target.closest('.dsk-tm-ctx'))) {
                self.taskmgr.ctxMenu.visible = false;
            }
        });
        // 可视化桌面：鼠标侧键（后退/前进按钮）接管为目录导航，阻止浏览器页面历史跳转
        ['mousedown', 'mouseup', 'auxclick'].forEach(function (evt) {
            document.addEventListener(evt, function (e) {
                self.onDesktopSideButton(e);
            }, true);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (self.termMenu.visible) {
                    self.termMenu.visible = false;
                }
                if (self.tabMenu.visible) {
                    self.tabMenu.visible = false;
                }
                if (self.topMenuVisible) {
                    self.topMenuVisible = false;
                }
                if (self.folderMenu.visible) {
                    self.folderMenu.visible = false;
                }
            }
        });
        // 可视化桌面快捷键：F2 重命名 / Delete 删除 / Enter 打开 / Backspace 上级 / F5 刷新 / Ctrl+A 全选
        // 捕获阶段注册，避免内层元素拦截或被浏览器默认行为（F2、F5、Alt+←→）抢走
        document.addEventListener('keydown', function (e) {
            self.onDesktopKeydown(e);
        }, true);
        window.addEventListener('blur', function () {
            self.cancelDesktopMarquee();
            self.cancelDesktopIconMarquee();
            self.termMenu.visible = false;
            if (self.tabMenu.visible) {
                self.tabMenu.visible = false;
            }
            if (self.topMenuVisible) {
                self.topMenuVisible = false;
            }
            if (self.folderMenu.visible) {
                self.folderMenu.visible = false;
            }
            if (self.desktop.taskMenu.visible) {
                self.desktop.taskMenu.visible = false;
            }
            if (self.desktop.iconMenu.visible) {
                self.desktop.iconMenu.visible = false;
            }
            if (self.desktop.trashMenu.visible) {
                self.desktop.trashMenu.visible = false;
            }
            if (self.desktop.menu.visible) {
                self.desktop.menu.visible = false;
            }
            if (self.desktop.calendarOpen) {
                self.desktop.calendarOpen = false;
            }
            if (self.desktop.taskbarMenu.visible) {
                self.desktop.taskbarMenu.visible = false;
            }
            if (self.desktop.trayMenu.visible) {
                self.desktop.trayMenu.visible = false;
            }
            if (self.desktop.notifOpen) {
                self.desktop.notifOpen = false;
            }
            if (self.taskmgr.ctxMenu.visible) {
                self.taskmgr.ctxMenu.visible = false;
            }
            self.closeDesktopSubMenus();
        });
        setInterval(function () {
            var t = self.activeTab;
            if (self.panelVisible && self.panelTab === 'process' && t && t.sessionId
                && t.procAuto && !t.procLoading) {
                self.loadProcesses(t);
            }
        }, 3000);
    }
});
