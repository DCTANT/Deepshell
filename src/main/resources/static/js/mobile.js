/* DeepShell 手机版：手机桌面 + 终端工作台 + 移动端应用
 * 与电脑版复用同一套后端 API 与 /ws/ssh 终端协议，不依赖 workspace.js。 */
(function () {
    'use strict';

    var RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000, 30000, 30000, 30000];
    var TERM_THEME = {
        background: '#080b11',
        foreground: '#d7dde8',
        cursor: '#4c8dff',
        cursorAccent: '#080b11',
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
    var MAX_AI_STEPS_FALLBACK = 50;
    var MAX_PREVIEW_BYTES = 512 * 1024;

    var APPS = [
        {
            id: 'terminal', label: '终端', icon: 'el-icon-monitor', color: '#22a06b',
            bg: 'linear-gradient(150deg, #34d399, #128a5c)', desc: 'SSH 终端工作台'
        },
        {
            id: 'files', label: '文件', icon: 'el-icon-folder-opened', color: '#e6a23c',
            bg: 'linear-gradient(150deg, #f7c05a, #d78b16)', desc: '浏览与传输远程文件'
        },
        {
            id: 'ai', label: 'AI 终端', icon: 'el-icon-chat-dot-round', color: '#4c8dff',
            bg: 'linear-gradient(150deg, #6aa6ff, #6d5ef0)', desc: '自然语言运维'
        },
        {
            id: 'procs', label: '进程', icon: 'el-icon-cpu', color: '#0f6cbd',
            bg: 'linear-gradient(150deg, #38a3f5, #1663ae)', desc: '查看与结束进程'
        },
        {
            id: 'disk', label: '磁盘', icon: 'el-icon-pie-chart', color: '#f59e0b',
            bg: 'linear-gradient(150deg, #fbbf24, #d97706)', desc: '目录占用分析'
        },
        {
            id: 'cmds', label: '快捷命令', icon: 'el-icon-caret-right', color: '#14b8a6',
            bg: 'linear-gradient(150deg, #2dd4bf, #0f9e8c)', desc: '常用命令一键发送'
        },
        {
            id: 'conns', label: '连接', icon: 'el-icon-connection', color: '#2f8fce',
            bg: 'linear-gradient(150deg, #60b8ff, #2f74c9)', desc: '管理 SSH 连接'
        },
        {
            id: 'settings', label: '设置', icon: 'el-icon-setting', color: '#54657e',
            bg: 'linear-gradient(150deg, #8ea3c2, #4b5c78)', desc: '外观与偏好'
        }
    ];

    var DOCK_IDS = ['terminal', 'files', 'ai', 'settings'];

    var WALLPAPERS = [
        { id: 'deep', label: '深海' },
        { id: 'aurora', label: '极光' },
        { id: 'dusk', label: '暮色' },
        { id: 'ocean', label: '深海蓝' },
        { id: 'forest', label: '森林' },
        { id: 'graphite', label: '石墨' }
    ];

    var CTRL_KEYS = [
        { label: 'Ctrl+C', seq: '\x03' },
        { label: 'Ctrl+D', seq: '\x04' },
        { label: 'Ctrl+Z', seq: '\x1a' },
        { label: 'Ctrl+L', seq: '\x0c' },
        { label: 'Ctrl+A', seq: '\x01' },
        { label: 'Ctrl+E', seq: '\x05' },
        { label: 'Ctrl+U', seq: '\x15' },
        { label: 'Ctrl+K', seq: '\x0b' },
        { label: 'Ctrl+W', seq: '\x17' },
        { label: 'Ctrl+R', seq: '\x12' },
        { label: 'PgUp', seq: '\x1b[5~' },
        { label: 'PgDn', seq: '\x1b[6~' },
        { label: 'Home', seq: '\x1b[H' },
        { label: 'End', seq: '\x1b[F' },
        { label: 'Insert', seq: '\x1b[2~' },
        { label: 'Esc Esc', seq: '\x1b\x1b' }
    ];

    var AI_EXAMPLES = [
        '查看磁盘占用最大的前 10 个目录',
        '找出占用 CPU 最高的进程',
        '检查 nginx 服务是否正常运行',
        '分析 /var/log 最近的错误日志'
    ];

    var IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'heic', 'avif'];
    var VIDEO_EXT = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'flv', 'wmv', 'ts'];
    var AUDIO_EXT = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'wma'];
    var ARCHIVE_EXT = ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'jar', 'war'];
    var CODE_EXT = ['sh', 'py', 'js', 'ts', 'json', 'yml', 'yaml', 'xml', 'html', 'css', 'java',
        'c', 'cpp', 'h', 'go', 'rs', 'php', 'rb', 'sql', 'conf', 'ini', 'toml', 'properties', 'log', 'txt', 'md'];
    var SESSION_KEY = 'deepshell.mobile.openTabs';
    var LS_WALLPAPER = 'deepshell.mobile.wallpaper';
    var LS_FONT = 'deepshell.mobile.fontSize';
    var LS_KEYBAR = 'deepshell.mobile.keybar';
    var LS_DANGER = 'deepshell.mobile.dangerConfirm';
    var LS_AI_MODE = 'deepshell.mobile.aiMode';
    var LS_FOLLOW = 'deepshell.mobile.sftpFollow';

    var toastSink = null;

    function showToast(text, type) {
        if (toastSink) {
            toastSink(text, type);
        }
    }

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
                    showToast(d.msg || '请求失败', 'error');
                }
                return Promise.reject(new Error(d.msg || '请求失败'));
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
            showToast('网络异常：' + ((err && err.message) || '请求失败'), 'error');
        }
        return Promise.reject(err);
    });

    function loadBool(key, def) {
        try {
            var v = localStorage.getItem(key);
            return v == null ? def : v === '1';
        } catch (e) {
            return def;
        }
    }

    function saveBool(key, val) {
        try {
            localStorage.setItem(key, val ? '1' : '0');
        } catch (e) { /* ignore */ }
    }

    function loadNum(key, def) {
        try {
            var v = parseInt(localStorage.getItem(key), 10);
            return isNaN(v) ? def : v;
        } catch (e) {
            return def;
        }
    }

    function loadString(key, def) {
        try {
            var v = localStorage.getItem(key);
            return v == null || v === '' ? def : v;
        } catch (e) {
            return def;
        }
    }

    function newSessionKey() {
        try {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                return window.crypto.randomUUID().replace(/-/g, '');
            }
        } catch (e) { /* ignore */ }
        return 'mk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    }

    function newKey() {
        return 'mt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function escapeAiHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function aiInlineMarkdown(text) {
        var codes = [];
        var s = escapeAiHtml(text);
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

    function renderAiMarkdown(src) {
        var text = String(src == null ? '' : src).replace(/\r\n/g, '\n');
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

    /* ---------- 终端危险命令识别（与电脑版保持一致） ---------- */
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

    /* ---------- 格式化工具 ---------- */
    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function fmtSize(n) {
        var v = Number(n) || 0;
        if (v < 1024) {
            return v + ' B';
        }
        var units = ['KB', 'MB', 'GB', 'TB', 'PB'];
        var i = -1;
        do {
            v /= 1024;
            i++;
        } while (v >= 1024 && i < units.length - 1);
        return (v >= 100 ? v.toFixed(0) : (v >= 10 ? v.toFixed(1) : v.toFixed(2))) + ' ' + units[i];
    }

    function fmtSizeKb(kb) {
        return fmtSize((Number(kb) || 0) * 1024);
    }

    function fmtTime(ms) {
        if (!ms) {
            return '';
        }
        var d = new Date(Number(ms));
        if (isNaN(d.getTime())) {
            return '';
        }
        var now = new Date();
        var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
        if (d.toDateString() === now.toDateString()) {
            return '今天 ' + hm;
        }
        if (d.getFullYear() === now.getFullYear()) {
            return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm;
        }
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm;
    }

    function fmtUptime(secs) {
        var s = Number(secs);
        if (!isFinite(s) || s < 0) {
            return '--';
        }
        var d = Math.floor(s / 86400);
        var h = Math.floor((s % 86400) / 3600);
        var m = Math.floor((s % 3600) / 60);
        if (d > 0) {
            return d + ' 天 ' + h + ' 小时';
        }
        if (h > 0) {
            return h + ' 小时 ' + m + ' 分钟';
        }
        return m + ' 分钟';
    }

    function baseName(path) {
        var p = String(path || '');
        var i = p.lastIndexOf('/');
        return i >= 0 ? p.slice(i + 1) : p;
    }

    function parentPath(path) {
        var p = String(path || '/');
        if (p === '/' || !p) {
            return '/';
        }
        var t = p.replace(/\/+$/, '');
        var i = t.lastIndexOf('/');
        return i <= 0 ? '/' : t.slice(0, i);
    }

    function joinPath(dir, name) {
        var d = String(dir || '/');
        if (d === '/') {
            return '/' + name;
        }
        return d.replace(/\/+$/, '') + '/' + name;
    }

    function fileExt(name) {
        var s = String(name || '');
        var i = s.lastIndexOf('.');
        return i > 0 ? s.slice(i + 1).toLowerCase() : '';
    }

    function kindOf(name) {
        var ext = fileExt(name);
        if (IMAGE_EXT.indexOf(ext) >= 0) {
            return 'image';
        }
        if (VIDEO_EXT.indexOf(ext) >= 0) {
            return 'video';
        }
        if (AUDIO_EXT.indexOf(ext) >= 0) {
            return 'audio';
        }
        if (ARCHIVE_EXT.indexOf(ext) >= 0) {
            return 'archive';
        }
        if (CODE_EXT.indexOf(ext) >= 0) {
            return 'text';
        }
        return 'other';
    }

    function copyFallback(text) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, text.length);
            var ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch (e) {
            return false;
        }
    }

    function emptyConnForm() {
        return {
            visible: false,
            returnToSheet: false,
            id: null,
            name: '',
            host: '',
            port: 22,
            username: '',
            authType: 'PASSWORD',
            password: '',
            keyPath: '',
            passphrase: '',
            remark: '',
            persistSession: true,
            groupName: '',
            folderId: null,
            favorite: false,
            pinned: false,
            sortOrder: null,
            proxyType: 'NONE',
            proxyHost: '',
            proxyPort: null,
            proxyUsername: '',
            jumpConnectionId: null,
            saving: false,
            testing: false,
            testText: '',
            testOk: false
        };
    }

    var app = new Vue({
        el: '#mApp',
        data: function () {
            return {
                view: 'home',
                activeApp: '',
                apps: APPS,
                dockApps: APPS.filter(function (a) {
                    return DOCK_IDS.indexOf(a.id) >= 0;
                }),
                wallpapers: WALLPAPERS,
                wallpaperId: loadString(LS_WALLPAPER, 'deep'),
                fontSize: Math.max(11, Math.min(20, loadNum(LS_FONT, 13))),
                keybarEnabled: loadBool(LS_KEYBAR, true),
                dangerConfirm: loadBool(LS_DANGER, true),
                clockTime: '',
                clockDate: '',
                greeting: '',
                clockTimer: null,

                connections: [],
                snippets: [],
                connKeyword: '',
                tabs: [],
                activeKey: '',
                pendingApp: '',

                connSheet: {
                    visible: false,
                    intent: 'terminal',
                    keyword: ''
                },
                sheet: {
                    type: '',
                    entry: null,
                    conn: null,
                    proc: null
                },
                connForm: emptyConnForm(),
                snippetForm: { name: '', command: '' },

                termInputOpen: false,
                termInput: '',
                search: { visible: false, text: '', index: 0, count: 0 },
                _searchTimer: null,

                files: {
                    tabKey: '',
                    path: '',
                    entries: [],
                    loading: false,
                    error: '',
                    follow: loadBool(LS_FOLLOW, true),
                    uploading: false,
                    uploadText: ''
                },
                preview: {
                    visible: false,
                    path: '',
                    name: '',
                    content: '',
                    original: '',
                    loading: false,
                    saving: false,
                    error: '',
                    editable: true
                },
                media: { visible: false, type: '', name: '', path: '', url: '' },

                aiInput: '',
                ai: { tabKey: '' },

                procs: { tabKey: '', keyword: '', list: [], loading: false, error: '' },
                disk: { tabKey: '', path: '/', loading: false, error: '', result: null },
                sysInfo: null,
                sysInfoError: '',

                aiConfig: {
                    loaded: false,
                    loading: false,
                    saving: false,
                    providers: [],
                    provider: 'deepseek',
                    baseUrl: '',
                    model: '',
                    apiKey: '',
                    maxSteps: MAX_AI_STEPS_FALLBACK,
                    contextWindow: 400000,
                    hasKey: false,
                    backTo: ''
                },
                appInfo: null,
                authStatus: { enabled: false },

                hostKey: { visible: false, tab: null, info: null, trusting: false, ack: false },
                dialog: {
                    visible: false, title: '', message: '', code: '', input: false, textarea: false,
                    value: '', placeholder: '', confirmText: '确定', cancelText: '取消',
                    danger: false, single: false
                },
                toastState: { visible: false, text: '', type: '' },
                _toastTimer: null,
                _dialogResolve: null,

                ctrlKeys: CTRL_KEYS,
                aiExamples: AI_EXAMPLES
            };
        },
        computed: {
            activeTab: function () {
                var self = this;
                return this.tabs.find(function (t) {
                    return t.key === self.activeKey;
                }) || null;
            },
            openSessionCount: function () {
                return this.tabs.filter(function (t) {
                    return t.status === 'open';
                }).length;
            },
            currentApp: function () {
                var id = this.activeApp;
                return APPS.find(function (a) {
                    return a.id === id;
                }) || null;
            },
            appTitle: function () {
                if (this.activeApp === 'aiConfig') {
                    return 'AI 模型配置';
                }
                return this.currentApp ? this.currentApp.label : '';
            },
            appSubtitle: function () {
                var id = this.activeApp;
                if (id === 'files') {
                    return this.files.path || '远程文件';
                }
                if (id === 'ai') {
                    var t = this.aiTab;
                    return t ? ((t.aiMode === 'auto' ? '自动执行' : '每步确认') + ' · ' + t.title) : 'AI 终端';
                }
                if (id === 'procs') {
                    return this.procRows.length + ' 个进程';
                }
                if (id === 'disk') {
                    return this.disk.path || '磁盘占用';
                }
                if (id === 'conns') {
                    return this.connections.length + ' 个连接';
                }
                if (id === 'settings') {
                    return this.appInfo ? ('v' + this.appInfo.version) : 'DeepShell';
                }
                if (id === 'aiConfig') {
                    return this.aiConfig.hasKey ? '已配置 API Key' : '尚未配置 API Key';
                }
                return '';
            },
            aiTab: function () {
                var self = this;
                var t = this.tabs.find(function (x) {
                    return x.key === self.ai.tabKey;
                });
                return (t && t.sessionId) ? t : this.sessionTab;
            },
            sessionTab: function () {
                var t = this.activeTab;
                if (t && t.sessionId) {
                    return t;
                }
                return this.tabs.find(function (x) {
                    return x.sessionId;
                }) || null;
            },
            procRows: function () {
                var kw = (this.procs.keyword || '').trim().toLowerCase();
                var rows = this.procs.list.filter(function (p) {
                    if (!kw) {
                        return true;
                    }
                    return String(p.comm || '').toLowerCase().indexOf(kw) >= 0
                        || String(p.user || '').toLowerCase().indexOf(kw) >= 0
                        || String(p.pid).indexOf(kw) >= 0
                        || String(p.args || '').toLowerCase().indexOf(kw) >= 0;
                });
                return rows.slice().sort(function (a, b) {
                    return (b.cpu == null ? -1 : b.cpu) - (a.cpu == null ? -1 : a.cpu);
                });
            },
            filteredConnections: function () {
                return this.filterConns(this.connections, this.connKeyword);
            },
            connSheetRows: function () {
                return this.filterConns(this.connections, this.connSheet.keyword);
            },
            connSheetTitle: function () {
                var map = {
                    terminal: '选择连接',
                    files: '选择文件会话',
                    ai: '选择 AI 会话',
                    procs: '选择进程会话',
                    disk: '选择磁盘会话'
                };
                return map[this.connSheet.intent] || '打开连接';
            },
            aiModels: function () {
                var p = this.aiCurrentProvider;
                return p && p.fallbackModels ? p.fallbackModels : [];
            },
            aiCurrentProvider: function () {
                return this.aiConfig.providers.find(function (x) {
                    return x.id === this.aiConfig.provider;
                }, this) || null;
            }
        },
        watch: {
            fontSize: function (v) {
                try {
                    localStorage.setItem(LS_FONT, String(v));
                } catch (e) { /* ignore */ }
                this.tabs.forEach(function (t) {
                    if (t.term) {
                        try { t.term.options.fontSize = v; } catch (e) { /* ignore */ }
                    }
                });
                var self = this;
                this.$nextTick(function () {
                    self.fitActive();
                });
            },
            keybarEnabled: function (v) {
                saveBool(LS_KEYBAR, v);
                this.$nextTick(this.fitActive);
            },
            dangerConfirm: function (v) {
                saveBool(LS_DANGER, v);
            },
            'files.follow': function (v) {
                saveBool(LS_FOLLOW, v);
            },
            activeApp: function () {
                var self = this;
                this.$nextTick(function () {
                    if (self.activeApp === 'ai') {
                        self.scrollAi();
                    }
                });
            }
        },
        mounted: function () {
            toastSink = this.toast.bind(this);
            this.bindViewport();
            this.tickClock();
            this.clockTimer = setInterval(this.tickClock, 10000);
            this.loadAppInfo();
            this.loadAuthStatus();
            this.loadAiConfig(true);
            var self = this;
            Promise.all([this.loadConnections(), this.loadSnippets()]).then(function () {
                self.restoreTabs();
            }).catch(function () { /* 登录过期时拦截器已跳转 */ });
        },
        beforeDestroy: function () {
            if (this.clockTimer) {
                clearInterval(this.clockTimer);
            }
            this.tabs.slice().forEach(function (t) {
                if (t.ws) {
                    try { t.ws.close(); } catch (e) { /* ignore */ }
                }
            });
        },
        methods: {
            /* ================= 通用 ================= */
            toast: function (text, type) {
                if (!text) {
                    return;
                }
                var self = this;
                clearTimeout(this._toastTimer);
                this.toastState = { visible: true, text: text, type: type || '' };
                this._toastTimer = setTimeout(function () {
                    self.toastState.visible = false;
                }, 2600);
            },
            copyText: function (text) {
                var self = this;
                var value = String(text == null ? '' : text);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(value).then(function () {
                        self.toast('已复制', 'success');
                    }).catch(function () {
                        var ok = copyFallback(value);
                        self.toast(ok ? '已复制' : '复制失败，请长按选择文本', ok ? 'success' : 'error');
                    });
                } else {
                    this.toast(copyFallback(value) ? '已复制' : '复制失败，请长按选择文本');
                }
            },
            askDialog: function (opts) {
                var self = this;
                return new Promise(function (resolve) {
                    self._dialogResolve = resolve;
                    self.dialog = {
                        visible: true,
                        title: opts.title || '提示',
                        message: opts.message || '',
                        code: opts.code || '',
                        input: !!opts.input,
                        textarea: !!opts.textarea,
                        value: opts.value == null ? '' : opts.value,
                        placeholder: opts.placeholder || '',
                        confirmText: opts.confirmText || '确定',
                        cancelText: opts.cancelText || '取消',
                        danger: !!opts.danger,
                        single: !!opts.single
                    };
                    self.$nextTick(function () {
                        var el = self.$refs.dialogInput;
                        if (el && !opts.single) {
                            try { el.focus(); } catch (e) { /* ignore */ }
                        }
                    });
                });
            },
            confirmDialog: function () {
                var d = this.dialog;
                var v = (d.input || d.textarea) ? d.value : true;
                d.visible = false;
                var resolve = this._dialogResolve;
                this._dialogResolve = null;
                if (resolve) {
                    resolve(v);
                }
            },
            cancelDialog: function () {
                var d = this.dialog;
                var v = (d.input || d.textarea) ? null : false;
                d.visible = false;
                var resolve = this._dialogResolve;
                this._dialogResolve = null;
                if (resolve) {
                    resolve(v);
                }
            },
            tickClock: function () {
                var now = new Date();
                this.clockTime = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
                var week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
                this.clockDate = (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + week;
                var h = now.getHours();
                this.greeting = h < 5 ? '夜深了' : h < 9 ? '早上好' : h < 12 ? '上午好'
                    : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
            },
            bindViewport: function () {
                var self = this;
                this._onViewport = function () {
                    self.applyViewport();
                    clearTimeout(self._fitTimer);
                    self._fitTimer = setTimeout(function () {
                        self.fitActive();
                    }, 120);
                };
                window.addEventListener('resize', this._onViewport);
                window.addEventListener('orientationchange', this._onViewport);
                if (window.visualViewport) {
                    window.visualViewport.addEventListener('resize', this._onViewport);
                    window.visualViewport.addEventListener('scroll', this._onViewport);
                }
                this.applyViewport();
            },
            applyViewport: function () {
                var vv = window.visualViewport;
                var h = vv ? vv.height : window.innerHeight;
                if (h > 0) {
                    document.documentElement.style.setProperty('--m-vh', Math.round(h) + 'px');
                }
            },
            fmtSize: fmtSize,
            fmtSizeKb: fmtSizeKb,
            fmtTime: fmtTime,
            fmtUptime: fmtUptime,
            fmtCpu: function (v) {
                return v == null ? '--' : (Math.round(Number(v) * 10) / 10) + '%';
            },
            fmtMb: function (v) {
                var n = Number(v) || 0;
                return n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : n + ' MB';
            },
            renderMd: function (text) {
                return renderAiMarkdown(text);
            },
            diskBarClass: function (pct) {
                var p = Number(pct) || 0;
                return p >= 85 ? 'hot' : (p >= 60 ? 'warn' : '');
            },
            filterConns: function (list, keyword) {
                var kw = String(keyword || '').trim().toLowerCase();
                var arr = (list || []).filter(function (c) {
                    if (!kw) {
                        return true;
                    }
                    return String(c.name || '').toLowerCase().indexOf(kw) >= 0
                        || String(c.host || '').toLowerCase().indexOf(kw) >= 0
                        || String(c.username || '').toLowerCase().indexOf(kw) >= 0
                        || String(c.remark || '').toLowerCase().indexOf(kw) >= 0;
                });
                return arr.slice().sort(function (a, b) {
                    if (!!b.pinned !== !!a.pinned) {
                        return b.pinned ? 1 : -1;
                    }
                    var ta = Number(a.lastUsedAt) || 0;
                    var tb = Number(b.lastUsedAt) || 0;
                    if (ta !== tb) {
                        return tb - ta;
                    }
                    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
                });
            },
            connInitial: function (c) {
                var s = String((c && c.name) || '?').trim();
                return s ? s.charAt(0) : '?';
            },
            connAvatarBg: function (c) {
                var palette = [
                    'linear-gradient(145deg, #5b8def, #3a64c9)',
                    'linear-gradient(145deg, #2fbf8f, #128a64)',
                    'linear-gradient(145deg, #f0a83c, #c97a12)',
                    'linear-gradient(145deg, #9b7bf0, #6c4bd0)',
                    'linear-gradient(145deg, #35b8d6, #1a87a3)',
                    'linear-gradient(145deg, #ef7f7f, #c74f5c)',
                    'linear-gradient(145deg, #93a7c4, #5c6f8e)'
                ];
                var s = String(((c && c.host) || '') + ((c && c.name) || ''));
                var h = 0;
                for (var i = 0; i < s.length; i++) {
                    h = (h * 31 + s.charCodeAt(i)) >>> 0;
                }
                return palette[h % palette.length];
            },

            /* ================= 导航 ================= */
            goHome: function () {
                this.view = 'home';
                this.activeApp = '';
                this.closeSheet();
                this.saveTabs();
            },
            closeApp: function () {
                if (this.activeApp === 'aiConfig' && this.aiConfig.backTo) {
                    var back = this.aiConfig.backTo;
                    this.aiConfig.backTo = '';
                    this.activeApp = back;
                    if (back === 'ai') {
                        this.scrollAi();
                    }
                    return;
                }
                this.activeApp = '';
                this.aiConfig.backTo = '';
                if (this.view === 'term') {
                    var self = this;
                    this.$nextTick(function () {
                        self.fitActive();
                    });
                }
            },
            tapApp: function (app) {
                if (app.id === 'terminal') {
                    if (this.tabs.length) {
                        this.view = 'term';
                        var self = this;
                        this.$nextTick(function () {
                            self.fitActive();
                        });
                    } else {
                        this.openConnSheet('terminal');
                    }
                    return;
                }
                this.openApp(app.id);
            },
            needsSession: function (id) {
                return ['files', 'ai', 'procs', 'disk'].indexOf(id) >= 0;
            },
            openApp: function (id) {
                var tab = this.sessionTab;
                if (this.needsSession(id) && !tab) {
                    this.openConnSheet(id);
                    return;
                }
                this.activeApp = id;
                if (id === 'files') {
                    this.syncFiles(tab);
                } else if (id === 'ai') {
                    this.syncAi(tab);
                    this.loadAiConfig(false);
                } else if (id === 'procs') {
                    this.procs.keyword = '';
                    this.procs.tabKey = tab ? tab.key : '';
                    this.loadProcs();
                } else if (id === 'disk') {
                    this.disk.tabKey = tab ? tab.key : '';
                    var start = (tab && (tab.termCwd || tab.sftpHome)) || this.disk.path || '/';
                    this.disk.path = start;
                    this.analyzeDisk(start);
                } else if (id === 'cmds') {
                    this.loadSnippets();
                } else if (id === 'settings') {
                    this.loadAppInfo();
                    this.loadAuthStatus();
                    this.loadAiConfig(false);
                } else if (id === 'conns') {
                    this.loadConnections();
                }
            },
            openAiConfig: function () {
                this.closeSheet();
                this.aiConfig.backTo = this.activeApp === 'aiConfig' ? '' : this.activeApp;
                this.activeApp = 'aiConfig';
                this.loadAiConfig(false);
            },

            /* ================= 连接选择 ================= */
            openConnSheet: function (intent) {
                this.connSheet.intent = intent || 'terminal';
                this.connSheet.keyword = '';
                this.connSheet.visible = true;
                this.sheet.type = '';
                this.loadConnections();
            },
            closeConnSheet: function () {
                this.connSheet.visible = false;
            },
            chooseIntentApp: function (intent) {
                if (intent && intent !== 'terminal') {
                    this.pendingApp = intent;
                } else {
                    this.pendingApp = '';
                }
            },
            connectFromSheet: function (c) {
                if (!c) {
                    return;
                }
                var intent = this.connSheet.intent;
                this.closeConnSheet();
                this.sheet.type = '';
                this.openConnection(c, intent);
            },
            connectFromApp: function (c) {
                this.activeApp = '';
                this.openConnection(c, 'terminal');
            },
            openConnection: function (conn, intent) {
                var existing = this.tabs.find(function (t) {
                    return t.connId === conn.id;
                });
                if (existing) {
                    this.activateTab(existing.key);
                    this.view = 'term';
                    if (intent && intent !== 'terminal') {
                        if (existing.sessionId) {
                            var self0 = this;
                            this.$nextTick(function () {
                                self0.openApp(intent);
                            });
                        } else {
                            this.pendingApp = intent;
                        }
                    }
                    if (existing.status === 'error' || existing.status === 'closed') {
                        this.reconnectTab(existing);
                    }
                    return;
                }
                this.chooseIntentApp(intent);
                var tab = this.buildTab(conn, null);
                this.tabs.push(tab);
                this.activeKey = tab.key;
                this.view = 'term';
                this.saveTabs();
                var self = this;
                this.$nextTick(function () {
                    self.initTerminal(tab);
                });
                http.post('/api/connections/' + conn.id + '/touch', null, { silent: true })
                    .catch(function () { /* ignore */ });
            },
            loadConnections: function () {
                var self = this;
                return http.get('/api/connections').then(function (d) {
                    self.connections = d || [];
                });
            },
            loadSnippets: function () {
                var self = this;
                return http.get('/api/quick-commands', { silent: true }).then(function (d) {
                    self.snippets = d || [];
                }).catch(function () { /* ignore */ });
            },

            /* ================= 连接增删改 ================= */
            openConnForm: function (c, returnToSheet) {
                this.sheet.type = '';
                this.connSheet.visible = false;
                this.connForm = emptyConnForm();
                this.connForm.visible = true;
                this.connForm.returnToSheet = !!returnToSheet;
                if (c) {
                    this.connForm.id = c.id;
                    this.connForm.name = c.name || '';
                    this.connForm.host = c.host || '';
                    this.connForm.port = c.port || 22;
                    this.connForm.username = c.username || '';
                    this.connForm.authType = c.authType || 'PASSWORD';
                    this.connForm.keyPath = c.keyPath || '';
                    this.connForm.remark = c.remark || '';
                    this.connForm.persistSession = c.persistSession !== false;
                    this.connForm.groupName = c.groupName || '';
                    this.connForm.folderId = c.folderId == null ? null : c.folderId;
                    this.connForm.favorite = !!c.favorite;
                    this.connForm.pinned = !!c.pinned;
                    this.connForm.sortOrder = c.sortOrder == null ? null : c.sortOrder;
                    this.connForm.proxyType = c.proxyType || 'NONE';
                    this.connForm.proxyHost = c.proxyHost || '';
                    this.connForm.proxyPort = c.proxyPort == null ? null : c.proxyPort;
                    this.connForm.proxyUsername = c.proxyUsername || '';
                    this.connForm.jumpConnectionId = c.jumpConnectionId == null ? null : c.jumpConnectionId;
                }
            },
            closeConnForm: function () {
                this.connForm.visible = false;
            },
            saveConn: function () {
                var f = this.connForm;
                if (f.saving) {
                    return;
                }
                if (!f.name.trim()) {
                    this.toast('请填写连接名称', 'warn');
                    return;
                }
                if (!f.host.trim()) {
                    this.toast('请填写主机地址', 'warn');
                    return;
                }
                if (!f.username.trim()) {
                    this.toast('请填写用户名', 'warn');
                    return;
                }
                var port = parseInt(f.port, 10);
                if (isNaN(port) || port < 1 || port > 65535) {
                    this.toast('端口范围应为 1-65535', 'warn');
                    return;
                }
                var body = {
                    name: f.name.trim(),
                    host: f.host.trim(),
                    port: port,
                    username: f.username.trim(),
                    authType: f.authType,
                    password: f.password || '',
                    keyPath: f.keyPath || '',
                    passphrase: f.passphrase || '',
                    remark: f.remark || '',
                    persistSession: !!f.persistSession,
                    groupName: f.groupName || '',
                    folderId: f.folderId,
                    favorite: f.favorite,
                    pinned: f.pinned,
                    sortOrder: f.sortOrder,
                    proxyType: f.proxyType || 'NONE',
                    proxyHost: f.proxyHost || '',
                    proxyPort: f.proxyPort,
                    proxyUsername: f.proxyUsername || '',
                    jumpConnectionId: f.jumpConnectionId
                };
                var self = this;
                var req = f.id ? http.put('/api/connections/' + f.id, body) : http.post('/api/connections', body);
                f.saving = true;
                req.then(function () {
                    f.saving = false;
                    self.connForm.visible = false;
                    self.toast(f.id ? '连接已保存' : '连接已创建', 'success');
                    self.loadConnections();
                    if (self.connForm.returnToSheet) {
                        self.connSheet.visible = true;
                    }
                }).catch(function () {
                    f.saving = false;
                });
            },
            testConnForm: function () {
                var f = this.connForm;
                f.testing = true;
                f.testText = '';
                var body = {
                    id: f.id,
                    name: f.name,
                    host: f.host,
                    port: parseInt(f.port, 10) || 22,
                    username: f.username,
                    authType: f.authType,
                    password: f.password || '',
                    keyPath: f.keyPath || '',
                    passphrase: f.passphrase || ''
                };
                var self = this;
                http.post('/api/connections/test', body, { silent: true }).then(function (r) {
                    f.testing = false;
                    if (r && r.needTrust) {
                        f.testOk = false;
                        f.testText = '连接可用，但主机指纹尚未信任；首次建立终端连接时会弹出确认。';
                    } else if (r && r.ok === false) {
                        f.testOk = false;
                        f.testText = self.mobileTestErrorText(r);
                    } else {
                        f.testOk = true;
                        f.testText = (r && r.message) || '连接成功';
                    }
                }).catch(function (e) {
                    f.testing = false;
                    f.testOk = false;
                    f.testText = (e && e.message) || '连接失败';
                });
            },
            mobileTestErrorText: function (r) {
                var e = r && r.error ? r.error : {};
                var text = (e.title || r.message || '连接失败');
                if (e.steps && e.steps.length) {
                    text += '：' + e.steps[0];
                }
                return text;
            },
            testConn: function (c) {
                if (!c) {
                    return;
                }
                this.sheet.type = '';
                var self = this;
                http.post('/api/connections/test', {
                    id: c.id, host: c.host, port: c.port, username: c.username,
                    authType: c.authType, keyPath: c.keyPath
                }, { silent: true }).then(function (r) {
                    if (r && r.needTrust) {
                        self.toast('连接可用，首次连接时会确认主机指纹', 'warn');
                    } else if (r && r.ok === false) {
                        self.toast(self.mobileTestErrorText(r), 'error');
                    } else {
                        self.toast((r && r.message) || '连接成功', 'success');
                    }
                }).catch(function (e) {
                    self.toast((e && e.message) || '连接失败', 'error');
                });
            },
            deleteConn: function (c) {
                if (!c) {
                    return;
                }
                this.sheet.type = '';
                var open = this.tabs.filter(function (t) {
                    return t.connId === c.id;
                }).length;
                var extra = open ? '\n该连接有 ' + open + ' 个已打开的标签，终端暂时仍可用，但重新连接将失败。' : '';
                var self = this;
                this.askDialog({
                    title: '删除连接',
                    message: '确定删除连接「' + c.name + '」？' + extra,
                    confirmText: '删除',
                    danger: true
                }).then(function (ok) {
                    if (!ok) {
                        return;
                    }
                    http.delete('/api/connections/' + c.id).then(function () {
                        self.toast('连接已删除', 'success');
                        self.loadConnections();
                    });
                });
            },
            showConnActions: function (c) {
                this.connSheet.intent = 'terminal';
                this.openSheet('connActions', { conn: c });
            },

            /* ================= 标签 / 终端 ================= */
            buildTab: function (conn, clientKey) {
                return {
                    key: newKey(),
                    clientKey: clientKey || newSessionKey(),
                    connId: conn.id,
                    title: conn.name || ('连接 #' + conn.id),
                    host: conn.host || '',
                    port: conn.port || 22,
                    username: conn.username || '',
                    status: 'connecting',
                    sessionId: null,
                    ws: null,
                    term: null,
                    fit: null,
                    searchAddon: null,
                    stats: null,
                    termCwd: null,
                    sftpPath: '',
                    sftpHome: null,
                    reconnectAttempts: 0,
                    reconnectTimer: null,
                    explicitClose: false,
                    serverClosed: false,
                    hostKeyPending: false,
                    aiMsgs: [],
                    aiBusy: false,
                    aiPhase: '',
                    aiMode: loadString(LS_AI_MODE, 'auto'),
                    aiStep: 0,
                    aiRunSeq: 0,
                    aiStop: false,
                    aiRunId: ''
                };
            },
            initTerminal: function (tab) {
                if (!tab || !this.tabs.some(function (t) { return t.key === tab.key; })) {
                    return;
                }
                var ref = this.$refs['term-' + tab.key];
                var el = Array.isArray(ref) ? ref[0] : ref;
                if (!el) {
                    tab._initRetry = (tab._initRetry || 0) + 1;
                    if (tab._initRetry <= 30) {
                        var selfRetry = this;
                        setTimeout(function () {
                            selfRetry.initTerminal(tab);
                        }, 60);
                    }
                    return;
                }
                tab._initRetry = 0;
                if (tab.term) {
                    try { tab.term.dispose(); } catch (e) { /* ignore */ }
                }
                var self = this;
                var term = new Terminal({
                    fontFamily: "'Cascadia Code', Consolas, Menlo, monospace",
                    fontSize: this.fontSize,
                    cursorBlink: true,
                    scrollback: 5000,
                    allowTransparency: true,
                    theme: TERM_THEME
                });
                var fit = new FitAddon.FitAddon();
                term.loadAddon(fit);
                if (window.SearchAddon && window.SearchAddon.SearchAddon) {
                    var addon = new SearchAddon.SearchAddon();
                    term.loadAddon(addon);
                    tab.searchAddon = addon;
                    if (addon.onDidChangeResults) {
                        addon.onDidChangeResults(function (ev) {
                            if (self.activeTab === tab) {
                                self.search.index = ev.resultIndex >= 0 ? ev.resultIndex + 1 : 0;
                                self.search.count = ev.resultCount || 0;
                            }
                        });
                    }
                }
                term.open(el);
                tab.term = term;
                tab.fit = fit;
                try { fit.fit(); } catch (e) { /* ignore */ }

                term.onData(function (data) {
                    self.onTermData(tab, data);
                });
                term.onResize(function (size) {
                    if (tab.ws && tab.ws.readyState === 1) {
                        tab.ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
                    }
                });
                setTimeout(function () {
                    try { fit.fit(); } catch (e) { /* ignore */ }
                    self.connectTab(tab);
                }, 20);
            },
            connectTab: function (tab) {
                if (!tab || tab.explicitClose) {
                    return;
                }
                var term = tab.term;
                var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
                var cols = term ? term.cols : 80;
                var rows = term ? term.rows : 24;
                var url = proto + location.host + '/ws/ssh?connId=' + tab.connId
                    + '&cols=' + cols + '&rows=' + rows
                    + '&sid=' + encodeURIComponent(tab.clientKey || '');
                var ws;
                try {
                    ws = new WebSocket(url);
                } catch (e) {
                    tab.status = 'error';
                    this.toast('无法建立 WebSocket 连接', 'error');
                    return;
                }
                ws.binaryType = 'arraybuffer';
                tab.ws = ws;
                tab.status = tab.status === 'reconnecting' ? 'reconnecting' : 'connecting';
                var self = this;
                ws.onmessage = function (ev) {
                    if (typeof ev.data === 'string') {
                        var msg;
                        try { msg = JSON.parse(ev.data); } catch (e) { return; }
                        if (msg.type === 'open') {
                            self.onTermOpen(tab, msg);
                        } else if (msg.type === 'hostkey') {
                            tab.status = 'error';
                            tab.serverClosed = true;
                            tab.hostKeyPending = true;
                            self.clearReconnectTimer(tab);
                            self.pendingApp = '';
                            self.showHostKey(tab, msg.hostKey);
                        } else if (msg.type === 'error') {
                            tab.status = 'error';
                            tab.serverClosed = true;
                            self.clearReconnectTimer(tab);
                            self.pendingApp = '';
                            self.writeTerm(tab, '\r\n\x1b[31m● ' + msg.message + '\x1b[0m\r\n');
                            self.toast(msg.message || '连接失败', 'error');
                        } else if (msg.type === 'closed') {
                            tab.status = 'closed';
                            tab.serverClosed = false;
                            self.writeTerm(tab, '\r\n\x1b[33m● ' + (msg.message || '连接已关闭') + '\x1b[0m\r\n');
                        } else if (msg.type === 'stats') {
                            tab.stats = msg.data;
                        } else if (msg.type === 'cwd') {
                            self.onTermCwd(tab, msg.path);
                        }
                    } else if (tab.term) {
                        try {
                            tab.term.write(new Uint8Array(ev.data));
                        } catch (e) { /* ignore */ }
                    }
                };
                ws.onclose = function () {
                    if (tab.explicitClose || tab.serverClosed) {
                        if (tab.status !== 'error') {
                            tab.status = 'closed';
                        }
                        return;
                    }
                    if (tab.status === 'error') {
                        return;
                    }
                    self.scheduleReconnect(tab);
                };
            },
            onTermOpen: function (tab, msg) {
                tab.sessionId = msg.sessionId;
                tab.status = 'open';
                tab.serverClosed = false;
                tab.explicitClose = false;
                tab.hostKeyPending = false;
                tab.reconnectAttempts = 0;
                this.clearReconnectTimer(tab);
                if (msg.notice) {
                    this.writeTerm(tab, '\r\n\x1b[33m● ' + msg.notice + '\x1b[0m\r\n');
                }
                var self = this;
                this.$nextTick(function () {
                    self.fitActive();
                });
                if (this.pendingApp) {
                    var appId = this.pendingApp;
                    this.pendingApp = '';
                    this.$nextTick(function () {
                        self.openApp(appId);
                    });
                }
            },
            onTermData: function (tab, data) {
                if (!tab) {
                    return;
                }
                var newlineCount = (String(data).match(/\r\n|\r|\n/g) || []).length;
                var audit = this.terminalAuditLine(tab);
                var auditTyped = false;
                var auditSkip = false;
                var auditLine = '';
                if (newlineCount === 0) {
                    auditTyped = true;
                    auditSkip = !audit.prompt;
                } else if (newlineCount === 1) {
                    auditTyped = true;
                    if (audit.prompt) {
                        var rawCommand = String(data)
                            .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
                            .replace(/[\r\n]+$/, '')
                            .replace(/[\x00-\x1f\x7f]/g, '')
                            .trim();
                        auditLine = audit.command || rawCommand;
                    } else {
                        auditSkip = true;
                    }
                } else if (!audit.prompt) {
                    auditTyped = true;
                    auditSkip = true;
                }
                var send = function () {
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
                if (data.indexOf('\r') < 0 && data.indexOf('\n') < 0) {
                    send();
                    return;
                }
                if (!this.dangerConfirm) {
                    send();
                    return;
                }
                var line = this.terminalCommandLine(tab);
                var plain = String(data).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
                var cleaned = line == null ? '' : line.replace(/^.*?[$#>]\s+/, '').trim();
                var rule = null;
                if (cleaned) {
                    rule = dangerousCommandRule(cleaned);
                }
                if (!rule && line) {
                    rule = dangerousCommandRule(line.replace(/[$#]\s+/g, '\n'));
                }
                if (!rule) {
                    rule = dangerousCommandRule(plain);
                }
                if (!rule) {
                    send();
                    return;
                }
                if (tab._dangerBusy) {
                    return;
                }
                tab._dangerBusy = true;
                var self = this;
                this.askDialog({
                    title: '危险命令确认',
                    message: '检测到高风险操作：' + rule.label + '\n只有点击「仍然执行」后，命令才会发送到终端。',
                    code: cleaned || plain.trim(),
                    confirmText: '仍然执行',
                    danger: true
                }).then(function (ok) {
                    tab._dangerBusy = false;
                    if (ok) {
                        send();
                    }
                });
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
            writeTerm: function (tab, text) {
                if (tab && tab.term) {
                    try { tab.term.write(text); } catch (e) { /* ignore */ }
                }
            },
            /** 与桌面端一致：从当前行提取提交的命令；无法识别提示符时返回 prompt=false，避免泄露密码/交互输入。 */
            terminalAuditLine: function (tab) {
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
            sendSeq: function (seq) {
                var tab = this.activeTab;
                if (!tab || !tab.ws || tab.ws.readyState !== 1) {
                    this.toast('终端尚未连接', 'warn');
                    return;
                }
                tab.ws.send(JSON.stringify({ type: 'data', data: seq, auditTyped: true, auditSkip: true }));
            },
            sendCtrl: function (k) {
                this.closeSheet();
                this.sendSeq(k.seq);
            },
            showCtrlSheet: function () {
                this.openSheet('ctrl');
            },
            focusTerm: function () {
                var tab = this.activeTab;
                if (tab && tab.term) {
                    try { tab.term.focus(); } catch (e) { /* ignore */ }
                }
            },
            fitActive: function () {
                var tab = this.activeTab;
                if (tab && tab.fit && this.view === 'term') {
                    try { tab.fit.fit(); } catch (e) { /* ignore */ }
                }
            },
            activateTab: function (key) {
                this.activeKey = key;
                this.view = 'term';
                this.saveTabs();
                var self = this;
                this.$nextTick(function () {
                    var t = self.activeTab;
                    if (t && t.fit) {
                        try { t.fit.fit(); } catch (e) { /* ignore */ }
                    }
                    var strip = self.$refs.tabStrip;
                    var active = strip ? strip.querySelector('.m-tab.active') : null;
                    if (active && active.scrollIntoView) {
                        try {
                            active.scrollIntoView({ inline: 'nearest', block: 'nearest' });
                        } catch (e) { /* ignore */ }
                    }
                });
            },
            closeTab: function (tab) {
                if (!tab) {
                    return;
                }
                var idx = this.tabs.indexOf(tab);
                if (idx < 0) {
                    return;
                }
                this.clearReconnectTimer(tab);
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
                this.tabs.splice(idx, 1);
                if (this.activeKey === tab.key) {
                    var next = this.tabs[Math.max(0, idx - 1)];
                    this.activeKey = next ? next.key : '';
                    this.search.visible = false;
                    this.search.index = 0;
                    this.search.count = 0;
                }
                if (!this.tabs.length) {
                    this.view = 'home';
                }
                this.saveTabs();
                if (this.activeApp === 'files') {
                    this.syncFiles(this.sessionTab);
                }
            },
            closeActiveTab: function () {
                this.closeSheet();
                if (!this.activeTab) {
                    return;
                }
                var tab = this.activeTab;
                var self = this;
                this.askDialog({
                    title: '关闭标签',
                    message: '关闭「' + tab.title + '」会结束当前 SSH 会话（tmux 持久会话可从原连接恢复）。',
                    confirmText: '关闭',
                    danger: true
                }).then(function (ok) {
                    if (ok) {
                        self.closeTab(tab);
                    }
                });
            },
            disconnectActive: function () {
                this.closeSheet();
                var tab = this.activeTab;
                if (!tab) {
                    return;
                }
                var self = this;
                this.askDialog({
                    title: '断开连接',
                    message: '断开「' + tab.title + '」的 SSH 连接？标签会保留，可随时重新连接。',
                    confirmText: '断开',
                    danger: true
                }).then(function (ok) {
                    if (!ok) {
                        return;
                    }
                    tab.explicitClose = true;
                    tab.serverClosed = true;
                    self.clearReconnectTimer(tab);
                    if (tab.ws) {
                        try {
                            if (tab.ws.readyState === 1) {
                                tab.ws.send(JSON.stringify({ type: 'close' }));
                            }
                            tab.ws.close();
                        } catch (e) { /* ignore */ }
                        tab.ws = null;
                    }
                    tab.status = 'closed';
                    tab.sessionId = null;
                    self.writeTerm(tab, '\r\n\x1b[33m● 已断开\x1b[0m\r\n');
                });
            },
            reconnectActive: function () {
                this.closeSheet();
                if (this.activeTab) {
                    this.reconnectTab(this.activeTab);
                }
            },
            reconnectTab: function (tab, silent) {
                if (!tab) {
                    return;
                }
                var self = this;
                this.clearReconnectTimer(tab);
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
                    tab.stats = null;
                    tab.termCwd = null;
                }
                if (this.activeTab === tab) {
                    this.search.visible = false;
                    this.search.index = 0;
                    this.search.count = 0;
                }
                this.$nextTick(function () {
                    self.initTerminal(tab);
                });
            },
            clearReconnectTimer: function (tab) {
                if (tab && tab.reconnectTimer) {
                    clearTimeout(tab.reconnectTimer);
                    tab.reconnectTimer = null;
                }
            },
            scheduleReconnect: function (tab) {
                if (!tab || tab.explicitClose || tab.serverClosed || tab.hostKeyPending) {
                    return;
                }
                this.clearReconnectTimer(tab);
                var attempts = tab.reconnectAttempts || 0;
                if (attempts >= RECONNECT_DELAYS.length) {
                    tab.status = 'error';
                    this.writeTerm(tab, '\r\n\x1b[31m● 自动重连失败，请从菜单重新连接\x1b[0m\r\n');
                    return;
                }
                tab.reconnectAttempts = attempts + 1;
                tab.status = 'reconnecting';
                this.writeTerm(tab, '\r\n\x1b[33m● 连接中断，正在重连（'
                    + tab.reconnectAttempts + '/' + RECONNECT_DELAYS.length + '）…\x1b[0m\r\n');
                var self = this;
                tab.reconnectTimer = setTimeout(function () {
                    tab.reconnectTimer = null;
                    if (tab.explicitClose || tab.serverClosed) {
                        return;
                    }
                    self.reconnectTab(tab, true);
                }, RECONNECT_DELAYS[attempts]);
            },
            statusLabel: function (tab) {
                if (!tab) {
                    return '';
                }
                var map = {
                    connecting: '连接中…',
                    open: '已连接',
                    reconnecting: '重连中…',
                    error: '连接失败',
                    closed: '已断开'
                };
                return map[tab.status] || tab.status;
            },
            statsLabel: function (tab) {
                if (!tab || !tab.stats) {
                    return '';
                }
                var s = tab.stats;
                if (s.error) {
                    return '监控不可用';
                }
                return 'CPU ' + (s.cpu == null ? '--' : s.cpu + '%')
                    + ' · 内存 ' + (s.memPct == null ? '--' : s.memPct + '%');
            },
            onTermCwd: function (tab, path) {
                if (!tab || !path || tab.termCwd === path) {
                    return;
                }
                tab.termCwd = path;
                if (this.files.follow && tab.sessionId) {
                    tab.sftpPath = path;
                    if (this.activeApp === 'files' && this.files.tabKey === tab.key
                        && this.files.path !== path) {
                        this.loadDir(path);
                    }
                }
            },
            saveTabs: function () {
                var self = this;
                clearTimeout(this._saveTimer);
                this._saveTimer = setTimeout(function () {
                    try {
                        var state = {
                            view: self.view,
                            tabs: self.tabs.map(function (t) {
                                return { connId: t.connId, key: t.clientKey };
                            }),
                            activeKey: self.activeTab ? self.activeTab.clientKey : null
                        };
                        sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
                    } catch (e) { /* ignore */ }
                }, 120);
            },
            restoreTabs: function () {
                var saved = null;
                try {
                    saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
                } catch (e) { /* ignore */ }
                if (!saved || !saved.tabs || !saved.tabs.length || saved.view !== 'term') {
                    return;
                }
                var self = this;
                var entries = saved.tabs;
                entries.forEach(function (entry) {
                    var conn = self.connections.find(function (c) {
                        return c.id === entry.connId;
                    });
                    if (conn) {
                        var tab = self.buildTab(conn, entry.key);
                        self.tabs.push(tab);
                    }
                });
                if (!this.tabs.length) {
                    return;
                }
                this.view = 'term';
                var active = this.tabs.find(function (t) {
                    return t.clientKey === saved.activeKey;
                });
                this.activeKey = active ? active.key : this.tabs[0].key;
                this.$nextTick(function () {
                    self.tabs.forEach(function (t) {
                        self.initTerminal(t);
                    });
                    self.toast('已恢复 ' + self.tabs.length + ' 个终端会话', 'success');
                });
            },

            /* ================= 终端菜单 / 搜索 / 剪贴板 ================= */
            showTermMenu: function () {
                this.openSheet('termMenu');
            },
            openSheet: function (type, extra) {
                this.sheet = Object.assign({ type: type, entry: null, conn: null, proc: null }, extra || {});
                this.connSheet.visible = false;
            },
            closeSheet: function () {
                this.sheet = { type: '', entry: null, conn: null, proc: null };
            },
            toggleTermInput: function () {
                this.termInputOpen = !this.termInputOpen;
                var self = this;
                this.$nextTick(function () {
                    if (self.termInputOpen) {
                        var el = self.$refs.termInput;
                        if (el) {
                            try { el.focus(); } catch (e) { /* ignore */ }
                        }
                    }
                    self.fitActive();
                });
            },
            sendTermInput: function () {
                var text = this.termInput;
                if (text == null || !text.trim()) {
                    return;
                }
                var tab = this.activeTab;
                if (!tab || !tab.ws || tab.ws.readyState !== 1) {
                    this.toast('终端尚未连接', 'warn');
                    return;
                }
                var data = text + '\r';
                var rule = this.dangerConfirm ? dangerousCommandRule(text) : null;
                var self = this;
                var doSend = function () {
                    if (tab.ws && tab.ws.readyState === 1) {
                        tab.ws.send(JSON.stringify({ type: 'data', data: data }));
                    }
                };
                if (!rule) {
                    doSend();
                } else {
                    this.askDialog({
                        title: '危险命令确认',
                        message: '检测到高风险操作：' + rule.label,
                        code: text,
                        confirmText: '仍然执行',
                        danger: true
                    }).then(function (ok) {
                        if (ok) {
                            doSend();
                        }
                    });
                }
                this.termInput = '';
            },
            pasteTerm: function () {
                this.closeSheet();
                var tab = this.activeTab;
                if (!tab || !tab.ws || tab.ws.readyState !== 1) {
                    this.toast('终端尚未连接', 'warn');
                    return;
                }
                var send = function (text) {
                    if (!text) {
                        return;
                    }
                    tab.ws.send(JSON.stringify({ type: 'data', data: text }));
                };
                if (navigator.clipboard && navigator.clipboard.readText) {
                    navigator.clipboard.readText().then(send).catch(function () {
                        showToast('无法读取剪贴板，请长按输入框粘贴', 'warn');
                    });
                } else {
                    this.toast('当前浏览器不支持读取剪贴板，可长按终端后粘贴', 'warn');
                }
            },
            copyTermSelection: function () {
                this.closeSheet();
                var tab = this.activeTab;
                var text = '';
                try {
                    text = tab && tab.term ? tab.term.getSelection() : '';
                } catch (e) { /* ignore */ }
                if (!text) {
                    this.toast('请先在终端中长按选择文本', 'warn');
                    return;
                }
                this.copyText(text);
            },
            clearTerm: function () {
                this.closeSheet();
                var tab = this.activeTab;
                if (tab && tab.term) {
                    try {
                        tab.term.clear();
                        tab.term.write('\x1b[2J\x1b[H');
                    } catch (e) { /* ignore */ }
                }
            },
            openSearch: function () {
                this.closeSheet();
                this.search.visible = true;
                var self = this;
                this.$nextTick(function () {
                    var el = self.$refs.searchInput;
                    if (el) {
                        try { el.focus(); } catch (e) { /* ignore */ }
                    }
                    if (self.search.text) {
                        self.runSearch();
                    }
                    self.fitActive();
                });
            },
            closeSearch: function () {
                this.search.visible = false;
                this.search.index = 0;
                this.search.count = 0;
                var tab = this.activeTab;
                if (tab && tab.searchAddon && tab.searchAddon.clearDecorations) {
                    try { tab.searchAddon.clearDecorations(); } catch (e) { /* ignore */ }
                }
                var self = this;
                this.$nextTick(function () {
                    self.fitActive();
                });
            },
            runSearch: function () {
                var self = this;
                clearTimeout(this._searchTimer);
                this._searchTimer = setTimeout(function () {
                    self.doSearch('next', true);
                }, 160);
            },
            findNext: function () {
                this.doSearch('next', false);
            },
            findPrev: function () {
                this.doSearch('prev', false);
            },
            doSearch: function (direction, incremental) {
                var tab = this.activeTab;
                var text = (this.search.text || '').trim();
                if (!tab || !tab.searchAddon || !text) {
                    this.search.index = 0;
                    this.search.count = 0;
                    if (tab && tab.searchAddon && tab.searchAddon.clearDecorations) {
                        try { tab.searchAddon.clearDecorations(); } catch (e) { /* ignore */ }
                    }
                    return;
                }
                var opts = {
                    decorations: SEARCH_DECOR,
                    incremental: !!incremental,
                    caseSensitive: false,
                    wholeWord: false,
                    regex: false
                };
                try {
                    if (direction === 'prev') {
                        tab.searchAddon.findPrevious(text, opts);
                    } else {
                        tab.searchAddon.findNext(text, opts);
                    }
                } catch (e) { /* ignore */ }
            },

            /* ================= 主机指纹 ================= */
            showHostKey: function (tab, info) {
                this.hostKey = { visible: true, tab: tab, info: info || {}, trusting: false, ack: false };
            },
            cancelHostKey: function () {
                var h = this.hostKey;
                if (h.tab) {
                    h.tab.hostKeyPending = false;
                    h.tab.status = 'error';
                    h.tab.serverClosed = true;
                    this.writeTerm(h.tab, '\r\n\x1b[33m● 已取消：主机指纹未信任，连接未建立\x1b[0m\r\n');
                }
                this.hostKey = { visible: false, tab: null, info: null, trusting: false, ack: false };
            },
            trustHostKey: function () {
                var h = this.hostKey;
                if (!h.info) {
                    return;
                }
                if (!h.ack) {
                    this.toast('请先核对指纹，并勾选“我已核对”', 'warn');
                    return;
                }
                var info = h.info;
                var self = this;
                h.trusting = true;
                http.post('/api/known-hosts/trust', {
                    host: info.host, port: info.port, keyType: info.keyType,
                    keyBase64: info.keyBase64, replace: !!info.changed,
                    role: info.role, roleLabel: info.roleLabel
                }).then(function () {
                    var tab = h.tab;
                    self.hostKey = { visible: false, tab: null, info: null, trusting: false, ack: false };
                    if (tab) {
                        tab.hostKeyPending = false;
                        self.reconnectTab(tab, false);
                    }
                }).catch(function () {
                    h.trusting = false;
                });
            },

            /* ================= 文件 SFTP ================= */
            syncFiles: function (tab) {
                if (!tab) {
                    this.files.tabKey = '';
                    this.files.entries = [];
                    this.files.path = '';
                    return;
                }
                if (this.files.tabKey !== tab.key) {
                    this.files.tabKey = tab.key;
                    this.files.path = tab.sftpPath || '';
                    this.files.entries = [];
                    this.files.error = '';
                }
                if (!this.files.entries.length && !this.files.loading) {
                    if (tab.sftpHome) {
                        this.loadDir(tab.sftpPath || tab.sftpHome);
                    } else {
                        this.loadHome();
                    }
                }
            },
            loadHome: function () {
                var t = this.sessionTab;
                if (!t || !t.sessionId) {
                    return Promise.resolve();
                }
                var self = this;
                return http.get('/api/sftp/home', {
                    params: { sessionId: t.sessionId }, silent: true
                }).then(function (home) {
                    t.sftpHome = home;
                    return self.loadDir(home);
                }).catch(function (e) {
                    self.files.error = (e && e.message) || '无法读取用户主目录';
                });
            },
            loadDir: function (path) {
                var t = this.sessionTab;
                if (!t || !t.sessionId) {
                    this.files.error = '请先连接服务器';
                    return Promise.resolve();
                }
                var target = path && String(path).trim() ? String(path).trim() : (t.sftpHome || '/');
                var self = this;
                this.files.loading = true;
                this.files.error = '';
                return http.get('/api/sftp/list', {
                    params: { sessionId: t.sessionId, path: target }, silent: true
                }).then(function (list) {
                    var entries = (list || []).slice();
                    entries.sort(function (a, b) {
                        if (a.dir !== b.dir) {
                            return a.dir ? -1 : 1;
                        }
                        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
                    });
                    self.files.entries = entries;
                    self.files.path = target;
                    self.files.tabKey = t.key;
                    t.sftpPath = target;
                }).catch(function (e) {
                    self.files.error = (e && e.message) || '读取目录失败';
                }).then(function () {
                    self.files.loading = false;
                });
            },
            refreshFiles: function () {
                this.closeSheet();
                if (!this.files.path) {
                    this.loadHome();
                } else {
                    this.loadDir(this.files.path);
                }
            },
            filesUp: function () {
                if (!this.files.path || this.files.path === '/') {
                    return;
                }
                this.loadDir(parentPath(this.files.path));
            },
            filesHome: function () {
                this.closeSheet();
                var t = this.sessionTab;
                if (t && t.sftpHome) {
                    this.loadDir(t.sftpHome);
                } else {
                    this.loadHome();
                }
            },
            editFilesPath: function () {
                var self = this;
                this.askDialog({
                    title: '跳转目录',
                    message: '输入远程服务器上的绝对路径',
                    input: true,
                    value: this.files.path || '/',
                    placeholder: '/var/log'
                }).then(function (path) {
                    if (path != null && String(path).trim()) {
                        self.loadDir(String(path).trim());
                    }
                });
            },
            toggleFollow: function () {
                this.closeSheet();
                this.files.follow = !this.files.follow;
                this.toast(this.files.follow ? '已开启：文件目录跟随终端 cd' : '已关闭目录跟随', 'success');
                var t = this.sessionTab;
                if (this.files.follow && t && t.termCwd) {
                    this.loadDir(t.termCwd);
                }
            },
            enterDir: function (e) {
                this.closeSheet();
                if (e) {
                    this.loadDir(joinPath(this.files.path, e.name));
                }
            },
            tapFile: function (e) {
                if (!e) {
                    return;
                }
                if (e.dir) {
                    this.loadDir(joinPath(this.files.path, e.name));
                    return;
                }
                var kind = kindOf(e.name);
                if (kind === 'image' || kind === 'video' || kind === 'audio') {
                    this.openMedia(e, kind);
                } else if (kind === 'text') {
                    this.openFilePreview(e);
                } else {
                    this.downloadEntry(e);
                }
            },
            isPreviewable: function (e) {
                if (!e || e.dir) {
                    return false;
                }
                var k = kindOf(e.name);
                return k === 'image' || k === 'video' || k === 'audio' || k === 'text';
            },
            fileIcon: function (e) {
                if (!e) {
                    return 'el-icon-document';
                }
                if (e.dir) {
                    return 'el-icon-folder';
                }
                var k = kindOf(e.name);
                if (k === 'image') { return 'el-icon-picture-outline'; }
                if (k === 'video') { return 'el-icon-video-camera'; }
                if (k === 'audio') { return 'el-icon-headset'; }
                if (k === 'archive') { return 'el-icon-box'; }
                if (k === 'text') { return 'el-icon-document'; }
                return 'el-icon-tickets';
            },
            fileIconClass: function (e) {
                if (!e) {
                    return '';
                }
                if (e.dir) {
                    return 'dir';
                }
                var k = kindOf(e.name);
                if (k === 'image') { return 'img'; }
                if (k === 'video') { return 'vid'; }
                if (k === 'audio') { return 'aud'; }
                if (k === 'archive') { return 'zip'; }
                if (k === 'text') { return 'code'; }
                return '';
            },
            showFileMenu: function () {
                this.openSheet('fileMenu');
            },
            showFileActions: function (e) {
                if (!e) {
                    return;
                }
                this.openSheet('fileActions', { entry: e });
            },
            showFileProps: function (e) {
                if (!e) {
                    return;
                }
                this.closeSheet();
                var lines = [
                    '名称：' + e.name,
                    '路径：' + joinPath(this.files.path, e.name),
                    '类型：' + (e.dir ? '文件夹' : '文件'),
                    '大小：' + (e.dir ? '—' : fmtSize(e.size)),
                    '修改时间：' + (e.mtime ? fmtTime(e.mtime) : '—'),
                    '权限：' + (e.perms || '—')
                ];
                this.askDialog({
                    title: '文件属性',
                    message: lines.join('\n'),
                    confirmText: '知道了',
                    single: true
                });
            },
            newFolder: function () {
                this.closeSheet();
                var self = this;
                this.askDialog({
                    title: '新建文件夹',
                    message: '在当前目录创建文件夹',
                    input: true,
                    placeholder: '文件夹名称'
                }).then(function (name) {
                    if (name == null || !String(name).trim()) {
                        return;
                    }
                    var t = self.sessionTab;
                    if (!t) {
                        return;
                    }
                    http.post('/api/sftp/mkdir', {
                        sessionId: t.sessionId,
                        path: joinPath(self.files.path, String(name).trim())
                    }).then(function () {
                        self.toast('文件夹已创建', 'success');
                        self.refreshFiles();
                    });
                });
            },
            newFile: function () {
                this.closeSheet();
                var self = this;
                this.askDialog({
                    title: '新建文本文件',
                    message: '创建后可立即编辑',
                    input: true,
                    placeholder: '文件名，如 notes.txt'
                }).then(function (name) {
                    if (name == null || !String(name).trim()) {
                        return;
                    }
                    var t = self.sessionTab;
                    if (!t) {
                        return;
                    }
                    var path = joinPath(self.files.path, String(name).trim());
                    http.post('/api/sftp/touch', { sessionId: t.sessionId, path: path }).then(function () {
                        self.toast('文件已创建', 'success');
                        self.loadDir(self.files.path);
                        self.openFilePreview({
                            name: String(name).trim(), dir: false, size: 0, mtime: Date.now(),
                            path: path
                        });
                    });
                });
            },
            renameEntry: function (e) {
                if (!e) {
                    return;
                }
                this.closeSheet();
                var self = this;
                this.askDialog({
                    title: '重命名',
                    message: '当前名称：' + e.name,
                    input: true,
                    value: e.name,
                    placeholder: '新名称'
                }).then(function (name) {
                    if (name == null || !String(name).trim() || String(name).trim() === e.name) {
                        return;
                    }
                    var t = self.sessionTab;
                    if (!t) {
                        return;
                    }
                    http.post('/api/sftp/rename', {
                        sessionId: t.sessionId,
                        path: joinPath(self.files.path, e.name),
                        newName: String(name).trim()
                    }).then(function () {
                        self.toast('已重命名', 'success');
                        self.refreshFiles();
                    });
                });
            },
            chmodEntry: function (e) {
                if (!e) {
                    return;
                }
                this.closeSheet();
                var self = this;
                this.askDialog({
                    title: '修改权限',
                    message: '输入八进制权限，如 644 / 755 / 600',
                    input: true,
                    value: e.perms && /^[0-7]{3,4}$/.test(e.perms) ? e.perms : '644',
                    placeholder: '644'
                }).then(function (value) {
                    if (value == null || !/^[0-7]{3,4}$/.test(String(value).trim())) {
                        return;
                    }
                    var t = self.sessionTab;
                    if (!t) {
                        return;
                    }
                    http.post('/api/sftp/chmod', {
                        sessionId: t.sessionId,
                        path: joinPath(self.files.path, e.name),
                        mode: parseInt(String(value).trim(), 8)
                    }).then(function () {
                        self.toast('权限已修改', 'success');
                        self.refreshFiles();
                    });
                });
            },
            deleteEntry: function (e) {
                if (!e) {
                    return;
                }
                this.closeSheet();
                var self = this;
                this.askDialog({
                    title: '删除' + (e.dir ? '文件夹' : '文件'),
                    message: '确定删除「' + e.name + '」？' + (e.dir ? '\n文件夹会被递归删除。' : ''),
                    confirmText: '删除',
                    danger: true
                }).then(function (ok) {
                    if (!ok) {
                        return;
                    }
                    var t = self.sessionTab;
                    if (!t) {
                        return;
                    }
                    http.post('/api/sftp/delete', {
                        sessionId: t.sessionId,
                        path: joinPath(self.files.path, e.name)
                    }).then(function () {
                        self.toast('已删除', 'success');
                        self.refreshFiles();
                    });
                });
            },
            downloadEntry: function (e) {
                if (!e) {
                    return;
                }
                var t = this.sessionTab;
                if (!t) {
                    return;
                }
                var a = document.createElement('a');
                a.href = '/api/sftp/download?sessionId=' + encodeURIComponent(t.sessionId)
                    + '&path=' + encodeURIComponent(joinPath(this.files.path, e.name));
                a.download = e.name;
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
                this.toast('已开始下载：' + e.name);
            },
            chooseUpload: function () {
                this.closeSheet();
                var el = this.$refs.uploadInput;
                if (el) {
                    el.click();
                }
            },
            onUploadFiles: function (ev) {
                var list = Array.prototype.slice.call((ev.target && ev.target.files) || []);
                if (ev.target) {
                    ev.target.value = '';
                }
                if (!list.length) {
                    return;
                }
                this.uploadFiles(list);
            },
            uploadFiles: function (list) {
                var t = this.sessionTab;
                if (!t || !t.sessionId) {
                    this.toast('请先连接服务器', 'warn');
                    return;
                }
                var self = this;
                var i = 0;
                var ok = 0;
                var fail = 0;
                this.files.uploading = true;
                var next = function () {
                    if (i >= list.length) {
                        self.files.uploading = false;
                        self.files.uploadText = '';
                        self.refreshFiles();
                        self.toast('上传完成：成功 ' + ok + ' 个'
                            + (fail ? '，失败 ' + fail + ' 个' : ''), fail ? 'warn' : 'success');
                        return;
                    }
                    var f = list[i++];
                    self.files.uploadText = '正在上传 ' + i + '/' + list.length + '：' + f.name;
                    var fd = new FormData();
                    fd.append('sessionId', t.sessionId);
                    fd.append('path', self.files.path || '/');
                    fd.append('file', f);
                    http.post('/api/sftp/upload', fd, {
                        silent: true,
                        timeout: 0,
                        onUploadProgress: function (ev) {
                            if (ev && ev.total) {
                                self.files.uploadText = '正在上传 ' + i + '/' + list.length + '：'
                                    + f.name + ' ' + Math.round(ev.loaded * 100 / ev.total) + '%';
                            }
                        }
                    }).then(function () {
                        ok++;
                        next();
                    }).catch(function (e) {
                        fail++;
                        self.toast('上传失败：' + f.name + ((e && e.message) ? ' · ' + e.message : ''), 'error');
                        next();
                    });
                };
                next();
            },
            openFilePreview: function (e) {
                var t = this.sessionTab;
                if (!t || !e) {
                    return;
                }
                this.closeSheet();
                this.preview = {
                    visible: true,
                    path: joinPath(this.files.path, e.name),
                    name: e.name,
                    content: '',
                    original: '',
                    loading: true,
                    saving: false,
                    error: '',
                    editable: true
                };
                if (e.size && e.size > MAX_PREVIEW_BYTES) {
                    this.preview.loading = false;
                    this.preview.editable = false;
                    this.preview.error = '文件超过 512 KB，手机版不提供在线编辑，请下载后查看。';
                    return;
                }
                var self = this;
                http.get('/api/sftp/read', {
                    params: { sessionId: t.sessionId, path: this.preview.path }, silent: true
                }).then(function (content) {
                    self.preview.content = content == null ? '' : content;
                    self.preview.original = self.preview.content;
                    self.preview.loading = false;
                }).catch(function (err) {
                    self.preview.loading = false;
                    self.preview.editable = false;
                    self.preview.error = (err && err.message) || '无法读取该文件（可能是二进制文件）';
                });
            },
            savePreview: function () {
                var t = this.sessionTab;
                var p = this.preview;
                if (!t || !p.path || p.saving || !p.editable) {
                    return;
                }
                var self = this;
                p.saving = true;
                http.post('/api/sftp/write', {
                    sessionId: t.sessionId,
                    path: p.path,
                    content: p.content
                }).then(function () {
                    p.saving = false;
                    p.original = p.content;
                    self.toast('文件已保存', 'success');
                    self.loadDir(self.files.path);
                }).catch(function () {
                    p.saving = false;
                });
            },
            closePreview: function () {
                var p = this.preview;
                if (!p.loading && !p.error && p.editable && p.content !== p.original) {
                    var self = this;
                    this.askDialog({
                        title: '未保存的修改',
                        message: '文件「' + p.name + '」有未保存的修改，关闭后会丢失。',
                        confirmText: '放弃修改',
                        danger: true
                    }).then(function (ok) {
                        if (ok) {
                            self.preview.visible = false;
                        }
                    });
                    return;
                }
                p.visible = false;
            },
            openMedia: function (e, kind) {
                var t = this.sessionTab;
                if (!t) {
                    return;
                }
                var path = joinPath(this.files.path, e.name);
                var base = kind === 'image' ? '/api/sftp/preview'
                    : (kind === 'video' ? '/api/sftp/video' : '/api/sftp/audio');
                this.media = {
                    visible: true,
                    type: kind,
                    name: e.name,
                    path: path,
                    url: base + '?sessionId=' + encodeURIComponent(t.sessionId)
                        + '&path=' + encodeURIComponent(path)
                };
            },
            closeMedia: function () {
                this.media.visible = false;
            },
            downloadMedia: function () {
                var t = this.sessionTab;
                if (!t || !this.media.path) {
                    return;
                }
                var a = document.createElement('a');
                a.href = '/api/sftp/download?sessionId=' + encodeURIComponent(t.sessionId)
                    + '&path=' + encodeURIComponent(this.media.path);
                a.download = this.media.name;
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
                this.toast('已开始下载：' + this.media.name);
            },

            /* ================= AI 终端 ================= */
            syncAi: function (tab) {
                this.ai.tabKey = tab ? tab.key : '';
                if (tab && !tab.aiMode) {
                    tab.aiMode = 'auto';
                }
            },
            toggleAiMode: function () {
                var t = this.aiTab;
                if (!t) {
                    return;
                }
                t.aiMode = t.aiMode === 'auto' ? 'manual' : 'auto';
                try {
                    localStorage.setItem(LS_AI_MODE, t.aiMode);
                } catch (e) { /* ignore */ }
                this.toast(t.aiMode === 'auto' ? '已切换为自动执行' : '已切换为每步确认', 'success');
            },
            newAiChat: function () {
                var t = this.aiTab;
                if (!t) {
                    return;
                }
                if (t.aiBusy) {
                    this.toast('AI 正在执行，请先停止', 'warn');
                    return;
                }
                if (!t.aiMsgs.length) {
                    return;
                }
                var self = this;
                this.askDialog({
                    title: '新对话',
                    message: '清空当前 AI 对话记录？',
                    confirmText: '清空'
                }).then(function (ok) {
                    if (!ok) {
                        return;
                    }
                    t.aiMsgs = [];
                    t.aiStep = 0;
                    t.aiRunSeq++;
                    t.aiStop = false;
                    self.aiInput = '';
                    self.toast('已开始新对话', 'success');
                });
            },
            useAiExample: function (text) {
                this.aiInput = text;
                var self = this;
                this.$nextTick(function () {
                    self.resizeAiInput();
                });
            },
            resizeAiInput: function () {
                var el = this.$refs.aiInput;
                if (!el) {
                    return;
                }
                el.style.height = 'auto';
                el.style.height = Math.min(132, Math.max(40, el.scrollHeight)) + 'px';
            },
            onAiKeydown: function (e) {
                if (e.isComposing || e.keyCode === 229) {
                    return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendAi();
                }
            },
            sendAi: function () {
                var t = this.aiTab;
                if (!t) {
                    this.toast('请先连接服务器', 'warn');
                    return;
                }
                if (t.aiBusy) {
                    this.toast('AI 正在执行，请先停止或等待完成', 'warn');
                    return;
                }
                if (!t.sessionId) {
                    this.toast('会话尚未就绪，请稍候', 'warn');
                    return;
                }
                if (this.aiConfig.loaded && !this.aiConfig.hasKey) {
                    this.toast('请先配置 AI API Key', 'warn');
                    this.openAiConfig();
                    return;
                }
                var text = (this.aiInput || '').trim();
                if (!text) {
                    return;
                }
                t.aiMsgs.push({ role: 'user', text: text });
                t.aiStep = 0;
                t.aiStop = false;
                t.aiRunSeq++;
                t.aiBusy = true;
                t.aiPhase = 'AI 正在思考…';
                this.aiInput = '';
                var self = this;
                this.$nextTick(function () {
                    var el = self.$refs.aiInput;
                    if (el) {
                        el.style.height = '40px';
                    }
                });
                this.scrollAi(true);
                this.aiLoop(t, t.aiRunSeq);
            },
            stopAi: function () {
                var t = this.aiTab;
                if (!t) {
                    return;
                }
                t.aiStop = true;
                t.aiRunSeq++;
                var runId = t.aiRunId;
                t.aiRunId = '';
                if (runId) {
                    http.post('/api/ai/agent/cancel', { runId: runId }, { silent: true })
                        .catch(function () { /* ignore */ });
                }
                t.aiBusy = false;
                t.aiPhase = '';
                t.aiMsgs.forEach(function (m) {
                    if (m.role === 'ai' && m.state === 'confirm') {
                        m.state = 'skipped';
                    }
                });
                t.aiMsgs.push({ role: 'ai', text: '已停止本轮执行。' });
                this.scrollAi();
                this.toast('已停止 AI 执行', 'warn');
            },
            aiLoop: function (t, seq) {
                if (!t || seq !== t.aiRunSeq) {
                    return;
                }
                if (t.aiStop) {
                    this.aiFinish(t, '');
                    return;
                }
                var limit = this.aiConfig.maxSteps || MAX_AI_STEPS_FALLBACK;
                if (t.aiStep >= limit) {
                    this.aiFinish(t, '已达单轮 ' + limit + ' 步上限，请发送新消息继续。');
                    return;
                }
                t.aiStep++;
                t.aiBusy = true;
                t.aiPhase = 'AI 正在思考（第 ' + t.aiStep + '/' + limit + ' 步）…';
                var runId = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
                t.aiRunId = runId;
                var payload = {
                    sessionId: t.sessionId,
                    cwd: t.termCwd || '',
                    auto: t.aiMode !== 'manual',
                    runId: runId,
                    step: t.aiStep,
                    messages: this.aiBuildHistory(t)
                };
                var self = this;
                http.post('/api/ai/agent/step', payload, { silent: true, timeout: 180000 }).then(function (r) {
                    if (seq !== t.aiRunSeq) {
                        return;
                    }
                    t.aiRunId = '';
                    if (!r || !r.kind) {
                        self.aiFinish(t, 'AI 未返回有效内容，请重试。');
                        return;
                    }
                    if (r.kind === 'reply') {
                        t.aiMsgs.push({ role: 'ai', text: r.text || '（无内容）' });
                        self.aiFinish(t, '');
                        return;
                    }
                    var m = {
                        role: 'ai',
                        cmd: r.command || '',
                        note: r.note || '',
                        danger: r.danger || '',
                        state: 'done',
                        output: '',
                        rc: null,
                        truncated: false,
                        timedOut: false,
                        error: '',
                        durationMs: 0,
                        open: false,
                        cwd: r.cwd || ''
                    };
                    if (r.needConfirm) {
                        m.state = 'confirm';
                        m.danger = r.danger || '';
                        t.aiMsgs.push(m);
                        t.aiBusy = true;
                        t.aiPhase = '等待你确认命令…';
                        self.scrollAi();
                        return;
                    }
                    self.aiFillMsg(m, r);
                    t.aiMsgs.push(m);
                    if (r.cwd) {
                        t.termCwd = r.cwd;
                    }
                    self.scrollAi();
                    if (t.aiStop) {
                        self.aiFinish(t, '');
                        return;
                    }
                    self.aiLoop(t, seq);
                }).catch(function (e) {
                    if (seq !== t.aiRunSeq) {
                        return;
                    }
                    t.aiRunId = '';
                    self.aiFinish(t, 'AI 请求失败：' + ((e && e.message) || '未知错误'));
                });
            },
            aiFillMsg: function (m, r) {
                m.output = r.output || '';
                m.rc = r.exitCode == null ? null : r.exitCode;
                m.truncated = !!r.truncated;
                m.timedOut = !!r.timedOut;
                m.error = r.error || '';
                m.durationMs = r.durationMs || 0;
                m.cwd = r.cwd || m.cwd || '';
                m.state = 'done';
                m.open = !!(m.error || m.timedOut || (m.rc != null && m.rc !== 0));
            },
            execAiCmd: function (m) {
                var t = this.aiTab;
                if (!t || !t.sessionId || !m || m.state !== 'confirm') {
                    return;
                }
                var self = this;
                var runId = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
                t.aiRunId = runId;
                t.aiBusy = true;
                t.aiPhase = '正在执行命令…';
                http.post('/api/ai/agent/exec', {
                    sessionId: t.sessionId,
                    cwd: t.termCwd || '',
                    command: m.cmd,
                    runId: runId
                }, { silent: true, timeout: 180000 }).then(function (r) {
                    t.aiRunId = '';
                    if (t.aiStop) {
                        self.aiFinish(t, '');
                        return;
                    }
                    self.aiFillMsg(m, r || {});
                    if (r && r.cwd) {
                        t.termCwd = r.cwd;
                    }
                    self.scrollAi();
                    self.aiLoop(t, t.aiRunSeq);
                }).catch(function (e) {
                    t.aiRunId = '';
                    m.state = 'done';
                    m.error = (e && e.message) || '执行失败';
                    m.rc = null;
                    t.aiBusy = false;
                    t.aiPhase = '';
                    self.toast(m.error, 'error');
                });
            },
            skipAiCmd: function (m) {
                var t = this.aiTab;
                if (!t || !m || m.state !== 'confirm') {
                    return;
                }
                m.state = 'skipped';
                this.aiLoop(t, t.aiRunSeq);
            },
            aiFinish: function (t, text) {
                if (!t) {
                    return;
                }
                t.aiBusy = false;
                t.aiPhase = '';
                if (text) {
                    t.aiMsgs.push({ role: 'ai', text: text });
                }
                this.scrollAi();
            },
            aiBuildHistory: function (t) {
                var out = [];
                ((t && t.aiMsgs) || []).forEach(function (m) {
                    if (m.role === 'user') {
                        out.push({ role: 'user', content: m.text || '' });
                    } else if (m.role === 'ai' && m.cmd) {
                        out.push({
                            role: 'assistant',
                            content: JSON.stringify({ cmd: m.cmd, note: m.note || '' })
                        });
                        if (m.state === 'done') {
                            out.push({ role: 'user', content: aiToolResult(m) });
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
            scrollAi: function (force) {
                var self = this;
                this.$nextTick(function () {
                    var list = self.$refs.aiList;
                    if (!list) {
                        return;
                    }
                    var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 160;
                    if (force || nearBottom) {
                        list.scrollTop = list.scrollHeight;
                    }
                });
            },

            /* ================= 进程 ================= */
            loadProcs: function () {
                var t = this.sessionTab;
                this.closeSheet();
                if (!t || !t.sessionId) {
                    this.procs.error = '请先连接服务器';
                    return;
                }
                this.procs.tabKey = t.key;
                this.procs.loading = true;
                this.procs.error = '';
                var self = this;
                http.get('/api/process/list', {
                    params: { sessionId: t.sessionId }, silent: true, timeout: 60000
                }).then(function (list) {
                    self.procs.list = list || [];
                }).catch(function (e) {
                    self.procs.error = (e && e.message) || '读取进程失败';
                }).then(function () {
                    self.procs.loading = false;
                });
            },
            showProc: function (p) {
                if (!p) {
                    return;
                }
                this.openSheet('procActions', { proc: p });
            },
            killProc: function (p, force) {
                if (!p) {
                    return;
                }
                this.closeSheet();
                var t = this.sessionTab;
                if (!t || !t.sessionId) {
                    return;
                }
                var self = this;
                this.askDialog({
                    title: force ? '强制结束进程' : '结束进程',
                    message: '确定' + (force ? '强制结束' : '结束') + '进程「' + p.comm + '」(PID ' + p.pid + ')？',
                    confirmText: '结束进程',
                    danger: true
                }).then(function (ok) {
                    if (!ok) {
                        return;
                    }
                    http.post('/api/process/kill', {
                        sessionId: t.sessionId, pid: p.pid, force: !!force
                    }).then(function () {
                        self.toast('已发送结束信号', 'success');
                        self.loadProcs();
                    });
                });
            },

            /* ================= 磁盘 ================= */
            analyzeDisk: function (path) {
                var t = this.sessionTab;
                if (!t || !t.sessionId) {
                    this.toast('请先连接服务器', 'warn');
                    return;
                }
                var target = String(path || '').trim();
                if (!target) {
                    this.toast('请输入目录路径', 'warn');
                    return;
                }
                this.disk.path = target;
                this.disk.tabKey = t.key;
                this.disk.loading = true;
                this.disk.error = '';
                var self = this;
                http.get('/api/disk/analyze', {
                    params: { sessionId: t.sessionId, path: target },
                    silent: true, timeout: 200000
                }).then(function (r) {
                    self.disk.result = r || null;
                }).catch(function (e) {
                    self.disk.result = null;
                    self.disk.error = (e && e.message) || '目录分析失败';
                }).then(function () {
                    self.disk.loading = false;
                });
            },
            analyzeCurrentDir: function () {
                var path = this.files.path || '/';
                this.closeSheet();
                this.activeApp = 'disk';
                this.disk.path = path;
                this.analyzeDisk(path);
            },
            diskUp: function () {
                if (!this.disk.path || this.disk.path === '/' || this.disk.loading) {
                    return;
                }
                this.analyzeDisk(parentPath(this.disk.path));
            },

            /* ================= 快捷命令 ================= */
            openSnippetForm: function () {
                this.snippetForm = { name: '', command: '' };
                this.openSheet('snippetForm');
            },
            saveSnippet: function () {
                var f = this.snippetForm;
                if (!f.name.trim() || !f.command.trim()) {
                    this.toast('请填写名称与命令', 'warn');
                    return;
                }
                var self = this;
                http.post('/api/quick-commands', {
                    name: f.name.trim(), command: f.command.trim(), sortOrder: 0
                }).then(function () {
                    self.closeSheet();
                    self.toast('快捷命令已添加', 'success');
                    self.loadSnippets();
                });
            },
            deleteSnippet: function (c) {
                if (!c) {
                    return;
                }
                var self = this;
                this.askDialog({
                    title: '删除快捷命令',
                    message: '确定删除「' + c.name + '」？',
                    confirmText: '删除',
                    danger: true
                }).then(function (ok) {
                    if (!ok) {
                        return;
                    }
                    http.delete('/api/quick-commands/' + c.id).then(function () {
                        self.toast('已删除', 'success');
                        self.loadSnippets();
                    });
                });
            },
            runSnippet: function (c) {
                if (!c) {
                    return;
                }
                var t = this.sessionTab;
                if (!t || !t.sessionId) {
                    this.toast('请先连接服务器', 'warn');
                    this.openConnSheet('terminal');
                    return;
                }
                var self = this;
                var doSend = function () {
                    if (!t.ws || t.ws.readyState !== 1) {
                        self.toast('终端尚未连接', 'warn');
                        return;
                    }
                    t.ws.send(JSON.stringify({ type: 'data', data: c.command + '\r' }));
                    self.toast('已发送：' + c.name, 'success');
                };
                var rule = this.dangerConfirm ? dangerousCommandRule(c.command) : null;
                if (!rule) {
                    doSend();
                    return;
                }
                this.askDialog({
                    title: '危险命令确认',
                    message: '检测到高风险操作：' + rule.label,
                    code: c.command,
                    confirmText: '仍然执行',
                    danger: true
                }).then(function (ok) {
                    if (ok) {
                        doSend();
                    }
                });
            },

            /* ================= 系统信息 ================= */
            showSysInfo: function () {
                var t = this.activeTab;
                if (!t || !t.sessionId) {
                    this.toast('终端尚未连接', 'warn');
                    return;
                }
                this.openSheet('sysInfo');
                this.sysInfo = null;
                this.sysInfoError = '';
                var self = this;
                http.get('/api/system/info', {
                    params: { sessionId: t.sessionId }, silent: true, timeout: 30000
                }).then(function (info) {
                    self.sysInfo = info || null;
                }).catch(function (e) {
                    self.sysInfoError = (e && e.message) || '获取系统信息失败';
                });
            },

            /* ================= AI 配置 ================= */
            loadAiConfig: function (force) {
                if (this.aiConfig.loading) {
                    return;
                }
                if (this.aiConfig.loaded && !force) {
                    return;
                }
                this.aiConfig.loading = true;
                var self = this;
                Promise.all([
                    http.get('/api/ai/config', { silent: true }),
                    http.get('/api/ai/providers', { silent: true }).catch(function () { return []; })
                ]).then(function (arr) {
                    var cfg = arr[0] || {};
                    self.aiConfig.providers = arr[1] || [];
                    self.aiConfig.provider = cfg.provider || 'custom';
                    self.aiConfig.baseUrl = cfg.baseUrl || '';
                    self.aiConfig.model = cfg.model || '';
                    self.aiConfig.maxSteps = cfg.maxSteps || MAX_AI_STEPS_FALLBACK;
                    self.aiConfig.contextWindow = cfg.contextWindow || 400000;
                    self.aiConfig.hasKey = !!cfg.hasKey;
                    self.aiConfig.loaded = true;
                    self.aiConfig.loading = false;
                }).catch(function () {
                    self.aiConfig.loading = false;
                });
            },
            onAiProviderChange: function () {
                var p = this.aiConfig.providers.find(function (x) {
                    return x.id === this.aiConfig.provider;
                }, this);
                if (!p) {
                    return;
                }
                if (p.baseUrl) {
                    this.aiConfig.baseUrl = p.baseUrl;
                }
                var models = p.fallbackModels || [];
                if (models.length && (!this.aiConfig.model || models.indexOf(this.aiConfig.model) < 0)) {
                    this.aiConfig.model = models[0];
                }
            },
            saveAiConfig: function () {
                var c = this.aiConfig;
                if (c.saving) {
                    return;
                }
                c.saving = true;
                var self = this;
                http.post('/api/ai/config', {
                    provider: c.provider,
                    baseUrl: c.baseUrl,
                    apiKey: c.apiKey || '',
                    model: c.model,
                    maxSteps: parseInt(c.maxSteps, 10) || MAX_AI_STEPS_FALLBACK,
                    contextWindow: parseInt(c.contextWindow, 10) || 400000
                }, { silent: true }).then(function (saved) {
                    c.saving = false;
                    if (saved) {
                        c.hasKey = !!saved.hasKey;
                    } else if (c.apiKey) {
                        c.hasKey = true;
                    }
                    c.apiKey = '';
                    self.toast('AI 配置已保存', 'success');
                }).catch(function (e) {
                    c.saving = false;
                    self.toast((e && e.message) || '保存失败', 'error');
                });
            },

            /* ================= 设置 / 关于 ================= */
            setWallpaper: function (id) {
                this.wallpaperId = id;
                try {
                    localStorage.setItem(LS_WALLPAPER, id);
                } catch (e) { /* ignore */ }
            },
            changeFontSize: function (delta) {
                var v = Math.max(11, Math.min(20, this.fontSize + delta));
                if (v === this.fontSize) {
                    return;
                }
                this.fontSize = v;
                var self = this;
                this.$nextTick(function () {
                    self.fitActive();
                });
            },
            toggleKeybar: function () {
                this.keybarEnabled = !this.keybarEnabled;
            },
            toggleDangerConfirm: function () {
                this.dangerConfirm = !this.dangerConfirm;
                this.toast(this.dangerConfirm ? '危险命令确认已开启' : '危险命令确认已关闭', 'success');
            },
            loadAppInfo: function () {
                if (this.appInfo) {
                    return;
                }
                var self = this;
                http.get('/api/app-info', { silent: true }).then(function (d) {
                    self.appInfo = d || null;
                }).catch(function () { /* ignore */ });
            },
            loadAuthStatus: function () {
                var self = this;
                http.get('/api/auth/status', { silent: true }).then(function (d) {
                    self.authStatus = d || { enabled: false };
                }).catch(function () { /* ignore */ });
            },
            openDesktopVersion: function () {
                location.href = '/workspace?desktop=1';
            },
            refreshPage: function () {
                location.reload();
            },
            logout: function () {
                var self = this;
                this.askDialog({
                    title: '退出登录',
                    message: '退出后需要重新输入账号密码。',
                    confirmText: '退出',
                    danger: true
                }).then(function (ok) {
                    if (!ok) {
                        return;
                    }
                    http.post('/api/auth/logout', null, { silent: true }).then(function () {
                        location.href = '/login';
                    }).catch(function () {
                        location.href = '/login';
                    });
                });
            }
        }
    });

    function aiToolResult(m) {
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
    }
})();
