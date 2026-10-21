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
var AI_MAX_STEPS_DEFAULT = 30;      // 单轮默认最大步数（可在 AI 设置中调整，1-100）
var AI_MAX_STEPS_LIMIT = 100;
var AI_HISTORY_MAX = 50;            // 输入框 ↑↓ 历史条数

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
    if (!tab || tab.explicitClose || tab.serverClosed || tab.hostKeyPending) {
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
        return {
            stick: true,
            slashOpen: false,
            slashIndex: 0
        };
    },
    computed: {
        convList: function () {
            var t = this.tab;
            if (!t || !t.chatConvs) {
                return [];
            }
            return t.chatConvs.slice().sort(function (a, b) {
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
        contextChars: function () {
            var n = 0;
            var conv = this.activeConv;
            ((conv && conv.msgs) || []).forEach(function (m) {
                n += (m.text || '').length + (m.cmd || '').length + (m.output || '').length
                    + (m.note || '').length + (m.reasoning || '').length;
            });
            var run = this.activeRun;
            if (run) {
                n += (run.streamText || '').length + (run.reasonText || '').length;
            }
            return n;
        },
        contextTokensText: function () {
            // 中英文混合按约 2.5 字符/token 粗估，仅用于提示上下文规模
            var t = Math.ceil(this.contextChars / 2.5);
            return t >= 1000 ? (t / 1000).toFixed(1) + 'k' : String(t);
        },
        queuedText: function () {
            var c = this.activeConv;
            return (c && c._queued) || '';
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
            if (m && m.code === 'noApiKey' && this.context === 'window') {
                return '请求失败：尚未配置 API Key。请到左下角开始菜单 →「设置」→「AI 助手」中配置';
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
                this.$root.aiChatSend();
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
        newConv: function () {
            this.$root.aiConvNew();
        },
        switchConv: function (c) {
            this.$root.aiConvSwitch(c);
        },
        delConv: function (c) {
            this.$root.aiConvDelete(c);
        },
        send: function () {
            this.$root.aiChatSend();
        },
        stop: function () {
            this.$root.aiChatStop();
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
        cancelQueue: function () {
            var c = this.activeConv;
            if (c) {
                this.$set(c, '_queued', '');
            }
        },
        useExample: function (text) {
            this.tab.chatInput = text;
            this.resizeInput();
        },
        restoreQueue: function () {
            var c = this.activeConv;
            if (!c || this.activeBusy || !c._queued) {
                return;
            }
            this.tab.chatInput = c._queued;
            this.$set(c, '_queued', '');
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
        context: { type: String, default: 'workbench' }
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
            t.ws.send(JSON.stringify({ type: 'data', data: c.command + '\r' }));
            if (this.$root.pushHistory) {
                this.$root.pushHistory(t, c.command);
            }
            this.snippetsVisible = false;
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
            if (!sid) {
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
            http.get('/api/sftp/read', { params: { sessionId: sid, path: path } })
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
        },
        onCursorActivity: function (cm) {
            var c = cm.getCursor();
            this.cursor = { line: c.line + 1, col: c.ch + 1 };
            var doc = this.activeDoc;
            if (doc) {
                doc.cursor = { line: c.line, ch: c.ch };
            }
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
            if (!this.sessionId()) {
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
            if (!sid) {
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
            http.get('/api/sftp/list', { params: { sessionId: sid, path: d }, silent: true })
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
            if (!sid) {
                return Promise.reject(new Error('会话未就绪'));
            }
            var cmDoc = this._docMap[doc.id];
            if (!cmDoc) {
                return Promise.reject(new Error('文档不存在'));
            }
            var content = cmDoc.getValue(doc.lineSep || '\n');
            this.saving = true;
            return http.post('/api/sftp/write', {
                sessionId: sid,
                path: path,
                content: content
            }).then(function () {
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
            if (!this.sessionId()) {
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
            if (!this.sessionId()) {
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
        connections: [],
        folders: [],
        snippets: [],
        panelVisible: true,
        panelTab: 'file',
        panelWidth: 480,
        desktopClipboard: { connId: null, paths: [], names: [], cut: false },
        /* AI 可视化桌面 */
        desktopViews: [
            { id: 'large', label: '大图标', icon: 'el-icon-menu' },
            { id: 'medium', label: '中图标', icon: 'el-icon-s-grid' },
            { id: 'small', label: '小图标', icon: 'dsk-vsmall' },
            { id: 'list', label: '详细列表', icon: 'el-icon-tickets' }
        ],
        desktopAppIcons: [
            { key: 'app:explorer', type: 'app', action: 'explorer', label: '资源管理器',
              icon: 'el-icon-folder-opened', color: '#e6a23c' },
            { key: 'app:trash', type: 'app', action: 'trash', label: '回收站',
              icon: 'el-icon-delete', color: '#7b8798' },
            { key: 'app:editor', type: 'app', action: 'editor', label: '文本编辑器',
              icon: 'el-icon-edit-outline', color: '#3d7eff' },
            { key: 'app:terminal', type: 'app', action: 'terminal', label: '终端',
              icon: 'el-icon-monitor', color: '#22a06b' },
            { key: 'app:transfers', type: 'app', action: 'transfers', label: '传输中心',
              icon: 'el-icon-s-promotion', color: '#0ea5a4' },
            { key: 'app:settings', type: 'app', action: 'settings', label: '设置',
              icon: 'el-icon-setting', color: '#54657e' },
            { key: 'app:ai', type: 'app', action: 'ai', label: 'AI 终端',
              icon: 'el-icon-chat-dot-round', color: '#3d7eff' }
        ],
        /* 已安装的桌面应用插件（由后端扫描数据目录） */
        desktopPlugins: [],
        pluginMgrVisible: false,
        pluginMgrLoading: false,
        pluginImporting: false,
        pluginMgrError: '',
        desktopStartApps: [
            { id: 'ai', label: 'AI 终端', icon: 'el-icon-chat-dot-round', color: '#3d7eff' },
            { id: 'editor', label: '文本编辑器', icon: 'el-icon-edit-outline', color: '#3d7eff' },
            { id: 'terminal', label: '新建终端', icon: 'el-icon-monitor', color: '#22a06b' },
            { id: 'transfers', label: '传输中心', icon: 'el-icon-s-promotion', color: '#0ea5a4' },
            { id: 'taskmgr', label: '任务管理器', icon: 'el-icon-cpu', color: '#0f6cbd' },
            { id: 'file', label: '资源管理器', icon: 'el-icon-folder-opened', color: '#e6a23c' },
            { id: 'dirs', label: '常用目录', icon: 'el-icon-star-off', color: '#8b5cf6' },
            { id: 'cmd', label: '快捷命令', icon: 'el-icon-caret-right', color: '#22a06b' },
            { id: 'disk', label: '磁盘', icon: 'el-icon-pie-chart', color: '#f59e0b' },
            { id: 'control', label: '设置', icon: 'el-icon-setting', color: '#54657e' },
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
            { id: 'terminal', label: '终端', desc: '进入桌面时自动打开一个 SSH 终端窗口',
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
            { id: 'power', label: '电源与休眠', icon: 'el-icon-switch-button' },
            { id: 'ai', label: 'AI 助手', icon: 'el-icon-magic-stick' },
            { id: 'network', label: '网络与连接', icon: 'el-icon-connection' },
            { id: 'system', label: '系统信息', icon: 'el-icon-cpu' }
        ],
        desktopResizeDirs: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'],
        desktop: {
            visible: false,
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
        hostKeyVisible: false,
        hostKeyTrusting: false,
        hostKeyPrompt: null,
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
        topMenuPos: { top: 48, right: 10 },
        connImportVisible: false,
        connExportVisible: false,
        connExportChecked: [],
        fontVisible: false,
        hotkeyVisible: false,
        bgVisible: false,
        helpVisible: false,
        aboutVisible: false,
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
            ['HOST_KEY', '主机指纹'],
            ['PORT_FORWARD', '端口转发'],
            ['AUTH_SETTINGS', '认证设置']
        ],
        aiSetVisible: false,
        aiSetSaving: false,
        aiSetForm: { provider: 'deepseek', baseUrl: '', model: '', apiKey: '', hasKey: false,
            maxSteps: AI_MAX_STEPS_DEFAULT },
        aiMaxSteps: AI_MAX_STEPS_DEFAULT,
        aiSlashCommands: [
            { id: 'new', label: '/new', desc: '开始一个新对话' },
            { id: 'clear', label: '/clear', desc: '清空当前对话记录' },
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
        appInfo: { version: '1.2.0', java: '', os: '', dataDir: '' },
        fontSettings: loadFontSettings(),
        hotkeySettings: loadHotkeySettings(),
        bgSettings: loadBgSettings(),
        bgTarget: 'terminal',
        bgDraft: { url: '', opacity: 0.35, blur: 0 },
        openAfterConnect: loadOpenAfterConnect(),
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
        openAfterConnect: function (v) {
            try { localStorage.setItem('deepshell.openAfterConnect', v); } catch (e) { /* ignore */ }
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
                    || w.type === 'editor';
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
                map[a.key] = a;
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
        desktopTab: function () {
            var self = this;
            return this.tabs.find(function (t) { return t.key === self.desktop.tabKey; }, this)
                || this.activeTab || null;
        },
        desktopConnDown: function () {
            var t = this.desktopTab;
            return !!t && (t.status === 'closed' || t.status === 'error');
        },
        desktopBgSettings: function () {
            var t = this.desktopTab;
            return (t && t.desktopBg) || { url: '', opacity: 0.35, blur: 0 };
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
        desktopStartAppMatches: function () {
            var q = this.desktopStartQuery.toLowerCase();
            if (!q) {
                return [];
            }
            return this.desktopStartApps.concat(this.desktopStartPluginApps).filter(function (a) {
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
            return this.desktopStartActions.filter(function (a) {
                return (a.label + ' ' + a.desc + ' ' + a.id).toLowerCase().indexOf(q) >= 0;
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
            this.topMenuVisible = true;
        },
        onMenuCommand: function (cmd) {
            this.topMenuVisible = false;
            if (cmd === 'connImport') {
                this.connImportVisible = true;
            } else if (cmd === 'connExport') {
                this.openConnExport();
            } else if (cmd === 'font') {
                this.fontVisible = true;
            } else if (cmd === 'hotkey') {
                this.hotkeyVisible = true;
            } else if (cmd === 'bg') {
                this.openBgSettings('terminal');
            } else if (cmd === 'help') {
                this.helpVisible = true;
            } else if (cmd === 'about') {
                this.loadAppInfo();
                this.aboutVisible = true;
            } else if (cmd === 'lan') {
                this.loadLan();
                this.lanVisible = true;
            } else if (cmd === 'auth') {
                this.openAuthSettings();
            } else if (cmd === 'audit') {
                this.openAudit();
            } else if (cmd === 'ai') {
                this.loadAiConfig();
                this.aiSetVisible = true;
            }
        },
        /* ---------- AI 设置（厂商预设 + 模型列表实时获取） ---------- */
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
            http.post('/api/ai/config', {
                provider: this.aiSetForm.provider,
                baseUrl: baseUrl,
                model: model,
                apiKey: this.aiSetForm.apiKey,
                maxSteps: maxSteps
            }).then(function (d) {
                ELEMENT.Message.success('AI 设置已保存');
                if (d) {
                    self.aiSetForm.provider = d.provider || self.aiSetForm.provider;
                    self.aiSetForm.baseUrl = d.baseUrl || baseUrl;
                    self.aiSetForm.model = d.model || model;
                    self.aiSetForm.hasKey = !!d.hasKey;
                    self.aiMaxSteps = clipAiSteps(d.maxSteps);
                    self.aiSetForm.maxSteps = self.aiMaxSteps;
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
            if (id === 'desktop') {
                this.openDesktopInNewTab(t);
                return;
            }
            if (id === 'stop') {
                this.aiChatStop();
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
            if (!conv._hist) {
                this.$set(conv, '_hist', []);
            }
            if (conv._histIdx == null) {
                this.$set(conv, '_histIdx', -1);
            }
            if (conv._queued == null) {
                this.$set(conv, '_queued', '');
            }
            return conv;
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
        /* 保存一条对话（服务端钳制消息数与长度）；失败时内存数据不丢，下次保存重试 */
        saveConv: function (t, conv) {
            if (!conv || conv.id == null) {
                return;
            }
            http.put('/api/ai/convs/' + conv.id, {
                title: conv.title,
                cwd: conv.cwd,
                msgs: conv.msgs
            }).catch(function () { /* 拦截器已提示 */ });
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
            this.aiConvCreateRemote(t).catch(function () { /* 拦截器已提示 */ });
        },
        aiConvSwitch: function (c) {
            var t = this.activeTab;
            if (!t || !c || c.id === t.chatConvId) {
                return;
            }
            this.aiSaveDraft(t);
            t.chatConvId = c.id;
            t.chatMsgs = c.msgs || [];
            t.chatInput = c.input || '';
            // 之前排队但未发出的消息，回到该对话时变成输入框草稿
            if (c._queued && !(c._run && c._run.busy)) {
                t.chatInput = c._queued;
                this.$set(c, '_queued', '');
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
        aiChatSend: function () {
            var t = this.activeTab;
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
            var run = conv._run;
            var text = (t.chatInput || '').trim();
            if (run.busy) {
                // 忙碌时按 Enter 不打断当前任务，而是排队到本轮结束自动发送
                if (!text) {
                    return;
                }
                this.$set(conv, '_queued', text);
                conv.input = '';
                t.chatInput = '';
                ELEMENT.Message.success('已排队，本轮结束后自动发送');
                return;
            }
            if (!text) {
                return;
            }
            conv.msgs.push({ role: 'user', text: text });
            if (!conv.title || conv.title === '新对话') {
                conv.title = text.slice(0, 20);
            }
            this.aiPushHistory(conv, text);
            conv.updatedAt = Date.now();
            conv.input = '';
            t.chatInput = '';
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
            this.scrollAiChat(true);
            this.aiChatLoop(t, conv, run, run.seq);
        },
        aiChatStop: function () {
            var t = this.activeTab;
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
                var reasoning = (run.reasonText || '').trim();
                run.reasonText = '';
                if (!r || !r.kind) {
                    self.aiChatFinish(t, conv, 'AI 未返回有效内容', 'retry');
                    return;
                }
                if (r.kind === 'reply') {
                    conv.msgs.push({ role: 'ai', text: r.text || '（无内容）',
                        reasoning: reasoning, reasonOpen: false });
                    self.aiChatFinish(t, conv, '');
                    return;
                }
                // 字段需一次性建全：Vue 2 对后加的属性不做响应式
                var m = {
                    role: 'ai', cmd: r.command, note: r.note || '', danger: r.danger || '',
                    state: 'done', output: '', rc: null, truncated: false, timedOut: false, error: '',
                    reasoning: reasoning, reasonOpen: false, durationMs: 0, outOpen: false, outputLines: 0
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
                    }
                    conv.msgs.push(noteItem);
                }
                conv.updatedAt = Date.now();
            }
            this.saveConv(t, conv);
            if (t && conv && t.chatConvId === conv.id) {
                this.scrollAiChat();
            }
            // 本轮正常结束后自动发送排队消息；停止 / 失败 / 达上限时保留，交给用户决定
            if (conv && !note && conv._queued && t && t.chatConvId === conv.id
                    && t.sessionId && run && !run.busy) {
                var queued = conv._queued;
                this.$set(conv, '_queued', '');
                t.chatInput = queued;
                var self = this;
                this.$nextTick(function () {
                    if (t.chatConvId === conv.id && t.chatInput === queued
                            && conv._run && !conv._run.busy) {
                        self.aiChatSend();
                    }
                });
            }
        },
        /* 把某个对话拼成发给模型的消息序列（assistant=模型的 JSON 命令 / 回复，user=命令执行结果） */
        aiBuildHistory: function (conv) {
            var self = this;
            var out = [];
            ((conv && conv.msgs) || []).forEach(function (m) {
                if (m.role === 'user') {
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
            if (type === 'ai') {
                return 'el-icon-chat-dot-round';
            }
            if (type === 'transfer') {
                return 'el-icon-s-promotion';
            }
            if (type === 'disk') {
                return 'el-icon-pie-chart';
            }
            if (type === 'terminal') {
                return 'el-icon-monitor';
            }
            if (type === 'taskmgr') {
                return 'el-icon-cpu';
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
            if (type === 'editor') {
                return 'el-icon-edit-outline';
            }
            if (type === 'trash') {
                return 'el-icon-delete';
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
                return '桌面插件' + ver + ' · 沙箱运行';
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
            if (!t || !t.sessionId || !this.desktop.visible) {
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
        openDesktopTerminalWindow: function (startDir) {
            if (!this.desktop.visible) {
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
                this.openDesktopTerminalWindow(dir);
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
                this.openTerminalInNewTab();
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
            if (cfg.ai) {
                this.openAiDesktopWindow();
            }
            if (cfg.transfers) {
                this.openTransferDesktopWindow();
            }
            if (cfg.disk) {
                this.openDiskDesktopWindow();
            }
            if (cfg.terminal) {
                this.openDesktopTerminalWindow();
            }
            if (cfg.taskmgr) {
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
            if (!t || !t.sessionId) {
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
                http.get('/api/sftp/read', {
                    params: { sessionId: t.sessionId, path: path },
                    silent: true
                }).then(function (text) {
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
            if (!t || !t.sessionId || !this.desktop.thumbnailsEnabled) {
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
                if (targetType !== 'file' || !self.isDesktopImage({ name: targetName, dir: false })) {
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
                    mtime: isShortcut ? 0 : (e.mtime || 0)
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
                    var task = tasks.shift();
                    if (self._surfaceThumbQueued[task.e.name]) {
                        continue;
                    }
                    self._surfaceThumbQueued[task.e.name] = true;
                    self._surfaceThumbActive++;
                    var ctrl = (typeof AbortController !== 'undefined')
                        ? new AbortController() : null;
                    if (ctrl) {
                        if (!self._surfaceThumbCtrls) {
                            self._surfaceThumbCtrls = [];
                        }
                        self._surfaceThumbCtrls.push(ctrl);
                    }
                    var url = '/api/sftp/thumbnail?sessionId=' + encodeURIComponent(t.sessionId)
                        + '&path=' + encodeURIComponent(task.path)
                        + '&v=' + (task.mtime || 0);
                    fetch(url, {
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
                        if (gen !== (self._surfaceThumbGen || 0)) {
                            return;
                        }
                        self.$set(task.e, '_thumb', URL.createObjectURL(blob));
                    }).catch(function (err) {
                        if (gen !== (self._surfaceThumbGen || 0)
                                || (err && err.name === 'AbortError')) {
                            return;
                        }
                        self.$set(task.e, '_thumbFailed', true);
                    }).then(function () {
                        if (ctrl && self._surfaceThumbCtrls) {
                            var idx = self._surfaceThumbCtrls.indexOf(ctrl);
                            if (idx >= 0) {
                                self._surfaceThumbCtrls.splice(idx, 1);
                            }
                        }
                        self._surfaceThumbActive = Math.max(0,
                            (self._surfaceThumbActive || 0) - 1);
                        if (gen === (self._surfaceThumbGen || 0)) {
                            pump();
                        }
                    });
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
            if (!t || t.connId == null) {
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
                if (item.action === 'explorer') {
                    this.openDesktopExplorerWindow('/');
                } else if (item.action === 'editor') {
                    this.openDesktopEditorApp();
                } else if (item.action === 'terminal') {
                    this.openDesktopTerminalWindow();
                } else if (item.action === 'transfers') {
                    this.openTransferDesktopWindow();
                } else if (item.action === 'settings') {
                    this.openDesktopSettings();
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
                } else if (this.desktopTab && this.desktopTab.sessionId) {
                    this.openDesktopEditorWindow(this.desktopTab, item.path);
                }
            }
        },
        isLnkFile: function (row) {
            return !!row && !row.dir && /\.lnk$/i.test(row.name || '');
        },
        openDesktopShortcut: function (item) {
            var t = this.desktopTab;
            if (!t || !t.sessionId || !item) {
                return;
            }
            var self = this;
            http.get('/api/sftp/read', {
                params: { sessionId: t.sessionId, path: item.path },
                silent: true
            }).then(function (text) {
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
            if (!t || !t.sessionId || !row) {
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
                return http.post('/api/sftp/write', {
                    sessionId: t.sessionId,
                    path: self.pathJoin(dir, candidate),
                    content: content
                }).then(function () {
                    ELEMENT.Message.success('已发送到桌面快捷方式：' + candidate);
                    self.refreshDesktopSurface();
                });
            }).catch(function () { /* 已提示 */ });
        },
        copyDesktopRows: function (rows, win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            rows = rows || [];
            if (!t || t.connId == null || !rows.length) {
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
            if (!t || t.connId == null || !rows.length) {
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
            if (!t || !t.sessionId || !c || !c.paths || !c.paths.length) {
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
                        return http.post('/api/sftp/move', {
                            sessionId: t.sessionId,
                            path: src,
                            destDir: dest
                        }).then(function () {
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
            http.post('/api/sftp/copy', {
                sessionId: t.sessionId,
                destDir: dest,
                paths: sources
            }).then(function (created) {
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
            if (!item || !this.desktop.iconDragKey || this.desktop.iconDragKey === item.key) {
                return;
            }
            this.desktop.iconDropKey = item.key;
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
            if (!fromKey || !item || fromKey === item.key) {
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
                y: Math.max(8, Math.min(ev.clientY, window.innerHeight - 130)),
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
            } else if (action === 'hide') {
                this.setDesktopAppHidden(key, true);
            }
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
            var out = [{ name: '/', path: '/' }];
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
            if (!this.isDesktopImage(row)) {
                return false;
            }
            if (row.size && row.size > 30 * 1024 * 1024) {
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
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
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
            http.get('/api/sftp/list', { params: { sessionId: t.sessionId, path: target } }).then(function (list) {
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
        startDesktopPathEdit: function () {
            var d = this.desk;
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
            if (!t || !t.sessionId || !this.isDesktopImage(row)) {
                return;
            }
            var query = '?sessionId=' + encodeURIComponent(t.sessionId)
                + '&path=' + encodeURIComponent(this.desktopEntryPath(row, d))
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
            if (!t || !t.sessionId || !this.isDesktopVideo(row)) {
                return;
            }
            var query = '?sessionId=' + encodeURIComponent(t.sessionId)
                + '&path=' + encodeURIComponent(this.desktopEntryPath(row, d))
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
            if (!t || !t.sessionId || !this.isDesktopAudio(row)) {
                return;
            }
            var query = '?sessionId=' + encodeURIComponent(t.sessionId)
                + '&path=' + encodeURIComponent(this.desktopEntryPath(row, d))
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
            this._thumbQueue.push({ w: d, path: path, mtime: row.mtime || 0 });
            this.pumpDesktopThumbs();
        },
        /* 限并发：最多 2 个缩略图请求，给目录读取等 SFTP 操作留出通道 */
        pumpDesktopThumbs: function () {
            var MAX_THUMB_ACTIVE = 2;
            if (!this._thumbQueue) {
                this._thumbQueue = [];
            }
            if (!this._thumbActive) {
                this._thumbActive = 0;
            }
            while (this._thumbActive < MAX_THUMB_ACTIVE && this._thumbQueue.length) {
                this.loadDesktopThumb(this._thumbQueue.shift());
            }
        },
        loadDesktopThumb: function (item) {
            var self = this;
            var t = this.desktopTab;
            var d = item && item.w;
            if (!t || !t.sessionId || !this.desktop.visible || !d
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
            var url = '/api/sftp/thumbnail?sessionId=' + encodeURIComponent(t.sessionId)
                + '&path=' + encodeURIComponent(item.path)
                + '&v=' + item.mtime;
            fetch(url, { credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined })
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
                    if (gen !== (self._thumbGen || 0) || self.desktop.windows.indexOf(d) < 0) {
                        return;
                    }
                    self.$set(d.thumbSrc, item.path, URL.createObjectURL(blob));
                })
                .catch(function (e) {
                    if (gen !== (self._thumbGen || 0) || (e && e.name === 'AbortError')
                            || self.desktop.windows.indexOf(d) < 0) {
                        return;
                    }
                    self.$set(d.thumbFailed, item.path, true);
                })
                .then(function () {
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
        openDesktopDownloadSub: function (ev) {
            if (this.desktop.downloadSub.visible) {
                this.closeDesktopDownloadSub();
                return;
            }
            this.closeDesktopCompressSub();
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
            if (!t || !t.sessionId) {
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
            if (!t || !t.sessionId || !rows || !rows.length) {
                return;
            }
            var self = this;
            var label = rows.length === 1
                ? ('「' + rows[0].name + '」' + (rows[0].dir ? '及其全部内容' : ''))
                : (rows.length + ' 个项目');
            var message = permanent
                ? ('确定彻底删除' + label + '？删除后不可恢复。')
                : ('确定将' + label + '移入回收站？可在回收站中恢复。');
            this.$confirm(message, permanent ? '彻底删除' : '移入回收站', {
                type: 'warning',
                confirmButtonText: permanent ? '彻底删除' : '移入回收站',
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
                        return http.post('/api/sftp/delete', {
                            sessionId: t.sessionId,
                            path: self.desktopEntryPath(r, d)
                        }).then(function () {
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
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
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
                return http.post('/api/sftp/mkdir', {
                    sessionId: t.sessionId,
                    path: self.pathJoin(d.path, name)
                }).then(function () {
                    ELEMENT.Message.success('已创建文件夹：' + name);
                    self.desktopRefresh(d);
                });
            }).catch(function () { /* 取消或失败（已提示） */ });
        },
        desktopNewFile: function (win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
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
                return http.post('/api/sftp/touch', {
                    sessionId: t.sessionId,
                    path: path
                }).then(function () {
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
            if (!t || !t.sessionId || !row) {
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
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
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
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
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
            http.post('/api/sftp/copy', {
                sessionId: t.sessionId,
                destDir: dd.dest,
                paths: dd.paths.slice()
            }).then(function () {
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
            if (!t || !t.sessionId || !sources.length) {
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
                        return http.post('/api/sftp/move', {
                            sessionId: t.sessionId,
                            path: src,
                            destDir: dest
                        }).then(function () {
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
            http.get('/api/desktop/plugins', { silent: !showError }).then(function (list) {
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
        openPluginManager: function () {
            this.desktop.startOpen = false;
            this.desktop.powerOpen = false;
            this.desktop.wallMenu.visible = false;
            this.pluginMgrVisible = true;
            this.pluginMgrError = '';
            this.loadDesktopPlugins(true);
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
            var fd = new FormData();
            fd.append('file', file, file.name);
            this.pluginImporting = true;
            this.pluginMgrError = '';
            http.post('/api/desktop/plugins/import', fd, { timeout: 0 })
                .then(function (info) {
                    ELEMENT.Message.success((info && info.updated ? '插件已更新：' : '插件已安装：')
                        + (info && info.name ? info.name : file.name));
                    self.loadDesktopPlugins(true);
                })
                .catch(function (err) {
                    self.pluginMgrError = (err && err.message) ? err.message : '插件安装失败';
                })
                .then(function () {
                    self.pluginImporting = false;
                });
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
                return http.delete('/api/desktop/plugins/' + encodeURIComponent(p.id));
            }).then(function () {
                self.closePluginWindows(p.id);
                self.loadDesktopPlugins(true);
                ELEMENT.Message.success('已卸载 ' + p.name);
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
            this.desktopSearchServer();
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
            if (id === 'settings' || id === 'help' || id === 'about') {
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
        openDesktopSysInfo: function () {
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
        exportConns: function () {
            var a = document.createElement('a');
            a.href = '/api/connections/export';
            document.body.appendChild(a);
            a.click();
            a.remove();
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

            term.onData(function (data) {
                if (tab.ws && tab.ws.readyState === 1) {
                    tab.ws.send(JSON.stringify({ type: 'data', data: data }));
                }
            });
            term.onResize(function (size) {
                if (tab.ws && tab.ws.readyState === 1) {
                    tab.ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
                }
            });
            term.focus();

            var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
            var url = proto + location.host + '/ws/ssh?connId=' + tab.connId
                + '&cols=' + (term.cols || 120) + '&rows=' + (term.rows || 30)
                + '&sid=' + encodeURIComponent(tab.clientKey || '');
            var ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';
            tab.ws = ws;

            ws.onmessage = function (ev) {
                if (typeof ev.data === 'string') {
                    var msg;
                    try { msg = JSON.parse(ev.data); } catch (e) { return; }
                    if (msg.type === 'open') {
                        tab.sessionId = msg.sessionId;
                        tab.status = 'open';
                        tab.serverClosed = false;
                        tab.explicitClose = false;
                        tab.hostKeyPending = false;
                        tab.reconnectAttempts = 0;
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
                        if (tab.desktopOnly && tab.initialDir && !msg.reattached) {
                            try {
                                ws.send(JSON.stringify({
                                    type: 'data',
                                    data: 'cd ' + quoteShellPath(tab.initialDir) + '\r'
                                }));
                            } catch (e) { /* ignore */ }
                        }
                        var dirReady = Promise.resolve();
                        if (!tab.desktopOnly) {
                            if (msg.reattached) {
                                // 服务端会紧接着发来最近输出快照，先清屏避免重复
                                try { term.reset(); } catch (e) { /* ignore */ }
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
                        clearReconnectTimer(tab);
                        term.write('\r\n\x1b[31m● ' + msg.message + '\x1b[0m\r\n');
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
                    term.write(new Uint8Array(ev.data));
                }
            };
            ws.onclose = function () {
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
                if (t && t.fit) {
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
            if (this.desktop.visible && tab.key === this.desktop.tabKey) {
                this.closeAiDesktop();
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
            }
            if (tab.term) {
                try { tab.term.dispose(); } catch (e) { /* ignore */ }
            }
            var idx = this.tabs.indexOf(tab);
            if (idx >= 0) {
                this.tabs.splice(idx, 1);
            }
            if (this.activeKey === tab.key) {
                var next = this.tabs[Math.max(0, idx - 1)];
                if (next) {
                    this.activate(next.key);
                } else {
                    this.activeKey = '';
                }
            }
            saveOpenTabs(this);
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
            this.hostKeyPrompt = null;
        },
        trustHostKey: function () {
            var p = this.hostKeyPrompt;
            if (!p || !p.info) {
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
                self.hostKeyPrompt = null;
                if (p.tab) {
                    p.tab.hostKeyPending = false;
                    self.reconnectTab(p.tab, false);
                }
            }).catch(function () {
                self.hostKeyTrusting = false;
            });
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
        fitActive: function () {
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
            if (!tab || !tab.sessionId) {
                return;
            }
            var self = this;
            var name = path.substring(path.lastIndexOf('/') + 1) || path;
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
            var fd = new FormData();
            fd.append('sessionId', tab.sessionId);
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
            return http.post('/api/sftp/upload', fd, {
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
            var t = this.activeTab;
            var f = this.renameForm;
            if (!f.newName || !f.newName.trim()) {
                ELEMENT.Message.warning('请输入新名称');
                return;
            }
            var self = this;
            http.post('/api/sftp/rename', { sessionId: t.sessionId, path: f.path, newName: f.newName.trim() })
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
                self.fitTab(t);
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
        sendCmd: function (tab) {
            var t = tab || this.activeTab;
            if (!t || !t.sessionId) {
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
            targets.forEach(function (x) {
                x.ws.send(data);
            });
            this.pushHistory(t, text);
            if (this.cmdOpts.clearAfterSend) {
                t.cmdText = '';
            }
            t._comp = null;
            this.focusCmdInput(t);
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
                    }
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
            var payload = JSON.stringify({ type: 'data', data: text });
            var active = this.uiTab;
            targets.forEach(function (x) {
                x.ws.send(payload);
            });
            if (!this.desktop.visible && active && targets.indexOf(active) >= 0 && active.term) {
                active.term.focus();
            }
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
            t.ws.send(JSON.stringify({ type: 'data', data: text }));
            if (t.term) {
                t.term.focus();
            }
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
            var cid = params.get('connId');
            if (cid) {
                // 带参打开（连接管理页「连接」/「返回终端」/ 新标签打开桌面）：仅本次生效，
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
                    }
                } else {
                    ELEMENT.Message.warning('连接不存在或已被删除');
                }
                return;
            }
            self.restoreOpenTabs();
        });
        self.loadFolders();
        self.loadSnippets();
        self.loadAppInfo();
        self.loadDesktopPlugins(false);
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
