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

/* AI 可视化桌面：每个资源管理器窗口拥有独立的浏览状态与几何信息 */
function createDesktopWindow(id) {
    return {
        id: id || '',
        type: 'explorer',
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
        pendingSelect: '',
        pendingOpen: false,
        thumbSrc: {},
        thumbFailed: {},
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        min: false,
        max: false,
        normal: null,
        z: 0,
        dragging: false,
        resizing: false
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
var AI_CHAT_MAX = 40;   // 每个对话保留的消息数上限（与后端一致，迁移时裁剪）

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

/* 浏览器侧会话键：F5 后带同一个键重连，服务端可复用仍未断开的 SSH 会话 */
function newSessionKey() {
    try {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID().replace(/-/g, '');
        }
    } catch (e) { /* ignore */ }
    return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

/* 每次 AI 请求的 runId：前端停止时用它通知服务端取消模型/命令 */
function newAiRunId() {
    return 'ai' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
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
    if (!tab || tab.explicitClose || tab.serverClosed) {
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
        || (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)
        || a.id - b.id;
};

/* AI 终端对话面板：右侧面板与桌面 AI 窗口共用同一份模板 */
Vue.component('ai-chat-panel', {
    props: {
        tab: { type: Object, required: true },
        context: { type: String, default: 'panel' }
    },
    template: '#ai-chat-panel-tpl',
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
        }
    },
    watch: {
        'tab.chatMsgs': {
            deep: true,
            handler: function () {
                this.scrollToBottom();
            }
        },
        'tab.chatStreamText': function () {
            this.scrollToBottom();
        },
        'tab.chatLoading': function () {
            this.scrollToBottom();
        },
        'tab.chatBusy': function () {
            this.scrollToBottom();
        },
        'tab.chatConvId': function () {
            this.scrollToBottom();
        }
    },
    mounted: function () {
        this.scrollToBottom();
    },
    methods: {
        scrollToBottom: function () {
            var self = this;
            this.$nextTick(function () {
                var el = self.$refs.list;
                if (el) {
                    el.scrollTop = el.scrollHeight;
                }
            });
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
        keydown: function (e) {
            this.$root.onChatKeydown(e);
        },
        copy: function (text) {
            this.$root.copyText(text);
        },
        fmtTime: function (ms) {
            return this.$root.fmtChatTime(ms);
        },
        openDesktop: function () {
            this.$root.openDesktopInNewTab(this.tab);
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
            { key: 'app:settings', type: 'app', action: 'settings', label: '设置',
              icon: 'el-icon-setting', color: '#54657e' },
            { key: 'app:ai', type: 'app', action: 'ai', label: 'AI 终端',
              icon: 'el-icon-chat-dot-round', color: '#3d7eff' }
        ],
        desktopStartApps: [
            { id: 'ai', label: 'AI 终端', icon: 'el-icon-chat-dot-round', color: '#3d7eff' },
            { id: 'file', label: '文件 SFTP', icon: 'el-icon-folder-opened', color: '#e6a23c' },
            { id: 'dirs', label: '常用目录', icon: 'el-icon-star-off', color: '#8b5cf6' },
            { id: 'cmd', label: '快捷命令', icon: 'el-icon-caret-right', color: '#22a06b' },
            { id: 'process', label: '进程', icon: 'el-icon-cpu', color: '#e06c75' },
            { id: 'disk', label: '磁盘', icon: 'el-icon-pie-chart', color: '#f59e0b' },
            { id: 'control', label: '设置', icon: 'el-icon-setting', color: '#54657e' },
            { id: 'connect', label: '连接管理', icon: 'el-icon-monitor', color: '#2f8fce' }
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
            tabKey: '',
            windows: [],
            activeWinId: '',
            explorerId: '',
            zSeq: 0,
            ghost: createDesktopWindow(''),
            wallMenu: { visible: false, x: 0, y: 0 },
            taskMenu: { visible: false, x: 0, y: 0, winId: '' },
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
        connectDialogVisible: false,
        connFilter: 'all',
        connKeyword: '',
        connExpanded: {},
        connDragId: null,
        connDragOverId: null,
        editVisible: false,
        editForm: { path: '', content: '', loading: false, saving: false },
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
        transferPanelOpen: true,
        localDownloadStatus: { checked: false, local: false, available: false },
        localDlSummary: { visible: false, item: null },
        permVisible: false,
        permSaving: false,
        permForm: { path: '', name: '', mode: '644' },
        fileDragOver: false,
        cmdOpts: loadCmdOpts(),
        snippetTarget: loadSnippetTarget(),
        snippetTargets: [],
        histVisible: false,
        optsVisible: false,
        sendToVisible: false,
        searchVisible: false,
        searchText: '',
        tabMenu: { visible: false, x: 0, y: 0, tab: null },
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
            ['CONNECTION_CREATE', '新建连接'],
            ['CONNECTION_UPDATE', '编辑连接'],
            ['CONNECTION_DELETE', '删除连接'],
            ['CONNECTION_IMPORT', '导入连接'],
            ['CONNECTION_EXPORT', '导出连接'],
            ['AUTH_SETTINGS', '认证设置']
        ],
        aiSetVisible: false,
        aiSetSaving: false,
        aiSetForm: { provider: 'deepseek', baseUrl: '', model: '', apiKey: '', hasKey: false },
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
        diskElapsed: 0,
        lanSettings: { lanEnabled: false, effectiveLan: false, restartRequired: false, port: 0, urls: [] },
        appInfo: { version: '1.0.0', java: '', os: '', dataDir: '' },
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
        searchVisible: function (v) {
            if (!v) {
                var t = this.activeTab;
                if (t && t.searchAddon && t.searchAddon.clearDecorations) {
                    try { t.searchAddon.clearDecorations(); } catch (e) { /* ignore */ }
                }
            }
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
        activeTab: function () {
            return this.tabs.find(function (t) { return t.key === this.activeKey; }, this) || null;
        },
        /* 当前主机的常用目录（按连接隔离） */
        commonDirs: function () {
            var t = this.activeTab;
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
                if (active && active.type !== 'ai') {
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
        desktopExplorerWindows: function () {
            return this.desktop.windows.filter(function (w) {
                return w.type !== 'ai';
            });
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
        desktopStartAppMatches: function () {
            var q = this.desktopStartQuery.toLowerCase();
            if (!q) {
                return [];
            }
            return this.desktopStartApps.filter(function (a) {
                return a.label.toLowerCase().indexOf(q) >= 0 || a.id.indexOf(q) >= 0;
            });
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
            var tab = {
                key: 'tab' + Date.now() + Math.floor(Math.random() * 1000),
                clientKey: clientKey || newSessionKey(),
                connId: connId,
                autoOpenDesktop: !!autoAfterConnect
                    && (!!forceDesktop || (firstConnect && this.openAfterConnect === 'desktop')),
                desktopOpenPath: '',
                title: conn ? conn.name : ('连接 #' + connId),
                host: conn ? conn.host : '',
                status: 'connecting',
                sessionId: null,
                ws: null,
                term: null,
                reconnectAttempts: 0,
                reconnectTimer: null,
                explicitClose: false,
                serverClosed: false,
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
                chatBusy: false,
                chatBusyConvId: null,
                chatStreamText: '',
                chatStreamConvId: null,
                chatPhase: '',
                chatLoading: true,
                chatMode: loadAiChatMode(),
                chatStop: false,
                chatStep: 0,
                chatRun: 0,
                chatAbortController: null,
                chatExecController: null,
                chatRequestId: ''
            };
            tab.sendTargets = [tab.key];
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
                host: c.host, port: c.port, username: c.username,
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
            http.post('/api/ai/config', {
                provider: this.aiSetForm.provider,
                baseUrl: baseUrl,
                model: model,
                apiKey: this.aiSetForm.apiKey
            }).then(function (d) {
                ELEMENT.Message.success('AI 设置已保存');
                if (d) {
                    self.aiSetForm.provider = d.provider || self.aiSetForm.provider;
                    self.aiSetForm.baseUrl = d.baseUrl || baseUrl;
                    self.aiSetForm.model = d.model || model;
                    self.aiSetForm.hasKey = !!d.hasKey;
                }
                self.aiSetForm.apiKey = '';
                self.aiSetVisible = false;
            }).catch(function () { /* 已由拦截器提示 */ }).then(function () {
                self.aiSetSaving = false;
            });
        },
        toggleAiBar: function () {
            var t = this.activeTab;
            if (!t) {
                return;
            }
            t.aiVisible = !t.aiVisible;
            var self = this;
            this.$nextTick(function () {
                self.fitActive();
                if (t.aiVisible && self.$refs.aiInput) {
                    self.$refs.aiInput.focus();
                }
            });
        },
        onAiKeydown: function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.aiGenerate();
            } else if (e.key === 'Escape') {
                e.stopPropagation();
                if (this.activeTab && this.activeTab.aiVisible) {
                    this.toggleAiBar();
                }
            }
        },
        aiGenerate: function () {
            var t = this.activeTab;
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
                    self.fitActive();
                    if (self.$refs.cmdInput) {
                        self.$refs.cmdInput.focus();
                    }
                });
            }).catch(function () { /* 已由拦截器提示 */ }).then(function () {
                t.aiLoading = false;
            });
        },
        /* ---------- AI 终端（对话式：AI 自动执行命令，独立通道；每连接多个对话） ---------- */
        onChatModeChange: function (v) {
            try { localStorage.setItem('deepshell.aiChatMode', v); } catch (e) { /* ignore */ }
        },
        onChatKeydown: function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.aiChatSend();
            }
        },
        aiConvById: function (t, id) {
            return (t.chatConvs || []).find(function (c) { return c.id === id; }) || null;
        },
        aiActiveConv: function (t) {
            return this.aiConvById(t, t.chatConvId) || (t.chatConvs && t.chatConvs[0]) || null;
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
            t.chatConvs = list || [];
            var act = t.chatConvs.find(function (c) { return c.active; }) || t.chatConvs[0] || null;
            t.chatConvId = act ? act.id : null;
            t.chatMsgs = act && act.msgs ? act.msgs : [];
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
            return http.post('/api/ai/convs', { connId: t.connId }).then(function (c) {
                if (!c) {
                    return null;
                }
                t.chatConvs.forEach(function (x) { x.active = false; });
                t.chatConvs.push(c);
                t.chatConvId = c.id;
                t.chatMsgs = c.msgs || [];
                self.scrollAiChat();
                return c;
            });
        },
        aiConvNew: function () {
            var t = this.activeTab;
            if (!t || t.chatBusy || t.chatLoading) {
                return;
            }
            this.aiConvCreateRemote(t).catch(function () { /* 拦截器已提示 */ });
        },
        aiConvSwitch: function (c) {
            var t = this.activeTab;
            if (!t || !c || c.id === t.chatConvId) {
                return;
            }
            t.chatConvId = c.id;
            t.chatMsgs = c.msgs || [];
            // 服务端记住当前对话（纯切换不刷新时间，失败不影响使用）
            http.put('/api/ai/convs/' + c.id, { active: true }).catch(function () { /* ignore */ });
            this.scrollAiChat();
        },
        aiConvDelete: function (c) {
            var t = this.activeTab;
            if (!t || !c) {
                return;
            }
            if (t.chatBusy && t.chatBusyConvId === c.id) {
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
                        http.put('/api/ai/convs/' + nc.id, { active: true }).catch(function () { /* ignore */ });
                    }
                    self.scrollAiChat();
                })
                .catch(function () { /* 取消或失败（已提示） */ });
        },
        aiChatSend: function () {
            var t = this.activeTab;
            if (!t || t.chatBusy) {
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
            var text = (t.chatInput || '').trim();
            if (!text) {
                return;
            }
            var conv = this.aiActiveConv(t);
            if (!conv) {
                ELEMENT.Message.warning('对话未加载成功，请刷新页面或重开标签');
                return;
            }
            conv.msgs.push({ role: 'user', text: text });
            if (!conv.title || conv.title === '新对话') {
                conv.title = text.slice(0, 20);
            }
            conv.updatedAt = Date.now();
            t.chatInput = '';
            t.chatStop = false;
            t.chatStep = 0;
            t.chatRequestId = '';
            t.chatAbortController = null;
            t.chatExecController = null;
            t.chatBusy = true;
            t.chatBusyConvId = conv.id;
            t.chatRun = (t.chatRun || 0) + 1;
            this.saveConv(t, conv);
            this.aiChatLoop(t, conv, t.chatRun);
        },
        aiChatStop: function () {
            var t = this.activeTab;
            if (!t || !t.chatBusy) {
                return;
            }
            t.chatStop = true;
            // 先通知服务端取消：断模型连接 / 断 exec 通道，再 abort 浏览器请求
            if (t.chatRequestId) {
                var runId = t.chatRequestId;
                t.chatRequestId = '';
                http.post('/api/ai/agent/cancel', { runId: runId }).catch(function () { /* ignore */ });
            }
            var abortStream = t.chatAbortController;
            t.chatAbortController = null;
            if (abortStream) {
                try { abortStream.abort(); } catch (e) { /* ignore */ }
            }
            var abortExec = t.chatExecController;
            t.chatExecController = null;
            if (abortExec) {
                try { abortExec.abort(); } catch (e) { /* ignore */ }
            }
            t.chatStreamText = '';
            t.chatStreamConvId = null;
            var conv = this.aiConvById(t, t.chatBusyConvId) || this.aiActiveConv(t);
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
                t.chatPhase = '正在停止…';
                this.saveConv(t, conv);
            }
        },
        aiChatLoop: function (t, conv, run) {
            var self = this;
            if (run !== t.chatRun) {
                return;
            }
            if (t.chatStop) {
                this.aiChatFinish(t, conv, '已停止');
                return;
            }
            if (t.chatStep >= 15) {
                this.aiChatFinish(t, conv, '已达单轮 15 步上限，如任务未完成请继续发消息说明');
                return;
            }
            t.chatStep++;
            t.chatPhase = 'AI 正在生成…';
            t.chatStreamText = '';
            t.chatStreamConvId = conv.id;
            var requestId = newAiRunId();
            t.chatRequestId = requestId;
            this.scrollAiChat();
            this.aiAgentStream(t, conv, run, {
                sessionId: t.sessionId,
                cwd: conv.cwd || '',
                auto: t.chatMode !== 'manual',
                runId: requestId,
                messages: this.aiBuildHistory(conv)
            }).then(function (r) {
                if (t.chatRequestId === requestId) {
                    t.chatRequestId = '';
                }
                t.chatStreamText = '';
                t.chatStreamConvId = null;
                if (run !== t.chatRun) {
                    return;
                }
                if (!r || !r.kind) {
                    self.aiChatFinish(t, conv, 'AI 未返回有效内容');
                    return;
                }
                if (r.kind === 'reply') {
                    conv.msgs.push({ role: 'ai', text: r.text || '（无内容）' });
                    self.aiChatFinish(t, conv, '');
                    return;
                }
                // 字段需一次性建全：Vue 2 对后加的属性不做响应式
                var m = {
                    role: 'ai', cmd: r.command, note: r.note || '', danger: r.danger || '',
                    state: 'done', output: '', rc: null, truncated: false, timedOut: false, error: ''
                };
                if (r.needConfirm) {
                    m.state = 'confirm';
                    conv.msgs.push(m);
                    conv.updatedAt = Date.now();
                    if (t.chatStop) {
                        m.state = 'skipped';
                        self.aiChatFinish(t, conv, '已停止');
                        return;
                    }
                    t.chatPhase = '等待你确认命令…';
                    self.saveConv(t, conv);
                    self.scrollAiChat();
                    return;
                }
                self.aiFillCard(conv, m, r);
                self.onAiDesktopMaybeRefresh(t, conv);
                conv.msgs.push(m);
                conv.updatedAt = Date.now();
                self.saveConv(t, conv);
                if (t.chatStop) {
                    self.aiChatFinish(t, conv, '已停止（本轮命令已执行完）');
                    return;
                }
                self.aiChatLoop(t, conv, run);
            }).catch(function (e) {
                if (t.chatRequestId === requestId) {
                    t.chatRequestId = '';
                }
                t.chatStreamText = '';
                t.chatStreamConvId = null;
                if (run !== t.chatRun) {
                    return;
                }
                if (t.chatStop || (e && (e.name === 'AbortError' || e.code === 'ERR_CANCELED'))) {
                    self.aiChatFinish(t, conv, '已停止');
                    return;
                }
                conv.msgs.push({ role: 'ai', text: '请求失败：' + ((e && e.message) || '未知错误') });
                self.aiChatFinish(t, conv, '');
            });
        },
        /* 流式请求一轮 AI 对话：边读 SSE 边更新预览文本，返回最终结果 */
        aiAgentStream: function (t, conv, run, payload) {
            var self = this;
            if (typeof fetch !== 'function' || typeof TextDecoder === 'undefined') {
                return Promise.reject(new Error('当前浏览器不支持流式输出，请升级浏览器'));
            }
            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            t.chatAbortController = controller;
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
                    } else if (ev.type === 'delta' && typeof ev.text === 'string') {
                        if (run !== t.chatRun || t.chatStop) {
                            return;
                        }
                        if (t.chatStreamConvId !== conv.id) {
                            t.chatStreamConvId = conv.id;
                            t.chatStreamText = '';
                        }
                        t.chatStreamText += ev.text;
                        var now = Date.now();
                        if (now - lastScroll > 60) {
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
                if (t.chatAbortController === controller) {
                    t.chatAbortController = null;
                }
                return r;
            }, function (e) {
                if (t.chatAbortController === controller) {
                    t.chatAbortController = null;
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
            if (!t || !t.chatBusy || !m || m.state !== 'confirm') {
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
            if (!allow) {
                m.state = 'skipped';
                this.saveConv(t, conv);
                this.aiChatLoop(t, conv, t.chatRun);
                return;
            }
            var self = this;
            var run = t.chatRun;
            m.state = 'running';
            t.chatPhase = '正在执行命令…';
            var requestId = newAiRunId();
            t.chatRequestId = requestId;
            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            t.chatExecController = controller;
            this.saveConv(t, conv);
            this.scrollAiChat();
            http.post('/api/ai/agent/exec', {
                sessionId: t.sessionId,
                cwd: conv.cwd || '',
                command: m.cmd,
                runId: requestId
            }, controller ? { signal: controller.signal } : undefined).then(function (r) {
                if (t.chatExecController === controller) {
                    t.chatExecController = null;
                }
                if (t.chatRequestId === requestId) {
                    t.chatRequestId = '';
                }
                if (run !== t.chatRun) {
                    return;
                }
                self.aiFillCard(conv, m, r || {});
                self.onAiDesktopMaybeRefresh(t, conv);
                conv.updatedAt = Date.now();
                self.saveConv(t, conv);
                if (t.chatStop) {
                    self.aiChatFinish(t, conv, '已停止');
                    return;
                }
                self.aiChatLoop(t, conv, run);
            }).catch(function (e) {
                if (t.chatExecController === controller) {
                    t.chatExecController = null;
                }
                if (t.chatRequestId === requestId) {
                    t.chatRequestId = '';
                }
                if (run !== t.chatRun) {
                    return;
                }
                if (t.chatStop || (e && (e.name === 'CanceledError' || e.code === 'ERR_CANCELED' || e.name === 'AbortError'))) {
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
        aiFillCard: function (conv, m, r) {
            m.state = 'done';
            m.output = r.output || '';
            m.rc = (r.exitCode == null) ? null : r.exitCode;
            m.truncated = !!r.truncated;
            m.timedOut = !!r.timedOut;
            m.error = r.error || '';
            if (!m.note && r.note) {
                m.note = r.note;
            }
            if (r.cwd) {
                conv.cwd = r.cwd;
            }
            this.scrollAiChat();
        },
        aiChatFinish: function (t, conv, note) {
            t.chatBusy = false;
            t.chatStop = false;
            t.chatPhase = '';
            t.chatBusyConvId = '';
            t.chatStreamText = '';
            t.chatStreamConvId = null;
            t.chatRequestId = '';
            t.chatAbortController = null;
            t.chatExecController = null;
            if (conv) {
                if (note) {
                    conv.msgs.push({ role: 'note', text: note });
                }
                conv.updatedAt = Date.now();
            }
            this.saveConv(t, conv);
            this.scrollAiChat();
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
        scrollAiChat: function () {
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
                        p.scrollToBottom();
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
                    self.openDesktopWindow(p, true);
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
            this.cancelDesktopThumbQueue();
            this.disconnectDesktopThumbObserver();
            this.resetSurfaceThumbs();
            this.desktop.windows.forEach(function (w) {
                self.releaseDesktopWindowThumbs(w);
            });
            this.desktop.windows = [];
            this.desktop.activeWinId = '';
            this.desktop.explorerId = '';
            this.desktop.zSeq = 0;
            this.desktop.showDesktopIds = [];
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
            this.saveDesktopWinLayouts();
            this.stopDesktopWindowGestures();
            this.stopDesktopDragScroll();
            this.stopDesktopClock();
            this.cancelDesktopMarquee();
            this.cancelDesktopIconMarquee();
            this.cancelDesktopThumbQueue();
            this.disconnectDesktopThumbObserver();
            this.resetSurfaceThumbs();
            var self = this;
            this.desktop.windows.forEach(function (w) {
                self.releaseDesktopWindowThumbs(w);
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
        desktopWindowTitle: function (w) {
            if (w && w.type === 'ai') {
                return 'AI 终端';
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
            if (w && w.type === 'ai') {
                var t = this.desktopTab;
                var conv = t ? this.aiActiveConv(t) : null;
                var title = conv && conv.title ? conv.title : '';
                return host ? (title ? host + ' · ' + title : host) : title;
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
                return w.type !== 'ai';
            }).map(function (w) {
                var g = w.max && w.normal ? w.normal : { x: w.x, y: w.y, w: w.w, h: w.h };
                return {
                    x: Math.round(g.x || 0),
                    y: Math.round(g.y || 0),
                    w: Math.round(g.w || 0),
                    h: Math.round(g.h || 0),
                    max: !!w.max
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
            w.viewMode = loadDesktopView();
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
            if (w.type !== 'ai') {
                this.desktop.explorerId = id;
            }
            w.z = ++this.desktop.zSeq;
            this.desktop.menu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.taskMenu.visible = false;
            this.desktop.iconMenu.visible = false;
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
                if (w.type !== 'ai') {
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
            if (current && current.type !== 'ai' && !current.min) {
                explorer = current;
            } else {
                this.desktop.windows.forEach(function (w) {
                    if (w.type !== 'ai' && !w.min && (!explorer || w.z > explorer.z)) {
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
            });
        },
        closeDesktopWindow: function (w) {
            if (!w) {
                return;
            }
            if (this.desktop.taskMenu.visible && this.desktop.taskMenu.winId === w.id) {
                this.desktop.taskMenu.visible = false;
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
            var explorer = target && target.type !== 'ai' ? target : null;
            if (!explorer) {
                this.desktop.windows.forEach(function (w) {
                    if (w.type !== 'ai' && (!explorer || w.z > explorer.z)) {
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
        },
        onDesktopWindowDragUp: function () {
            var s = this._deskMove;
            this._deskMove = null;
            document.removeEventListener('mousemove', this.onDesktopWindowDragMove);
            document.removeEventListener('mouseup', this.onDesktopWindowDragUp);
            if (s && s.w) {
                s.w.dragging = false;
                this.scheduleSaveDesktopWinLayouts();
            }
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
                });
            }
        },
        stopDesktopWindowGestures: function () {
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
            this.desktop.iconSelected = '';
            this.desktop.iconSelectedKeys = [];
            this.desktop.focusSurface = true;
            this.desktop.calendarOpen = false;
            this.closeDesktopSubMenus();
            this.desktop.wallMenu = {
                visible: true,
                x: Math.max(8, Math.min(ev.clientX, window.innerWidth - 220)),
                y: Math.max(8, Math.min(ev.clientY, window.innerHeight - 130))
            };
        },
        desktopWallMenuAction: function (action) {
            this.desktop.wallMenu.visible = false;
            if (action === 'newWindow') {
                this.openDesktopExplorerWindow();
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
                this.closeAiDesktop();
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
        desktopTaskCloseWindow: function () {
            var w = this.desktopTaskMenuWin;
            this.desktop.taskMenu.visible = false;
            if (w) {
                this.closeDesktopWindow(w);
            }
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
                } else if (item.action === 'settings') {
                    this.openDesktopSettings();
                } else if (item.action === 'ai') {
                    this.openAiDesktopWindow();
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
                } else if (this.desktopTab && this.desktopTab.sessionId) {
                    this.openRemoteEdit(this.desktopTab, item.path);
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
                } else {
                    self.openRemoteEdit(t, target);
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
            if (parentSame) {
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
                        if (w.type !== 'ai' && dirs[w.path]) {
                            self.desktopRefresh(w);
                        }
                    });
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
            }).then(function () {
                loading.close();
                ELEMENT.Message.success('已粘贴 ' + sources.length + ' 项');
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
            this.desktop.iconSelected = item.key;
            this.desktop.iconSelectedKeys = [item.key];
            if (ev.dataTransfer) {
                ev.dataTransfer.effectAllowed = 'move';
                try {
                    ev.dataTransfer.setData('text/plain', item.key);
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
                    || (this.desktopTab && this.desktopTab.chatBusy)) {
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
                var pendingName = d.pendingSelect;
                var pendingOpen = d.pendingOpen;
                d.pendingSelect = '';
                d.pendingOpen = false;
                var pendingHit = null;
                if (pendingName) {
                    pendingHit = (list || []).find(function (r) { return r.name === pendingName; });
                    if (pendingHit) {
                        d.selected = [pendingName];
                        d.lastSelected = pendingName;
                    }
                }
                if (pendingHit) {
                    self.scrollDesktopEntry(pendingName, d);
                    if (pendingOpen) {
                        self.desktopOpenEntry(pendingHit, d);
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
        scrollDesktopEntry: function (name, win) {
            var self = this;
            var d = win || this.desk;
            this.$nextTick(function () {
                var root = self.deskFilesEl(d);
                if (!root) {
                    return;
                }
                var els = root.querySelectorAll('.dsk-item, .dsk-row');
                for (var i = 0; i < els.length; i++) {
                    if (els[i].getAttribute('data-name') === name) {
                        try {
                            els[i].scrollIntoView({ block: 'nearest' });
                        } catch (e) { /* ignore */ }
                        break;
                    }
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
        onDesktopSurfaceClick: function () {
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
                this.desktopDeleteRows(rows, ctxWin);
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
            this.requestBundleDownload(t.sessionId, d.path, paths, rows.length);
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
        requestBundleDownload: function (sessionId, dir, paths, count) {
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
                self.submitBundleDownload(sessionId, dir, paths, name);
                ELEMENT.Message.success('已开始下载 ' + name);
            }).catch(function () {
                loading.close();
            });
        },
        /* 表单提交到隐藏 iframe：避免 URI 过长，错误也不会把当前页面导航走 */
        submitBundleDownload: function (sessionId, dir, paths, name) {
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
            var url = '/api/sftp/download?sessionId=' + encodeURIComponent(t.sessionId)
                + '&path=' + encodeURIComponent(this.desktopEntryPath(row, d));
            var a = document.createElement('a');
            a.href = url;
            document.body.appendChild(a);
            a.click();
            a.remove();
        },
        desktopDeleteRows: function (rows, win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            if (!t || !t.sessionId || !rows || !rows.length) {
                return;
            }
            var self = this;
            var label = rows.length === 1
                ? ('「' + rows[0].name + '」' + (rows[0].dir ? '及其全部内容' : ''))
                : (rows.length + ' 个项目');
            this.$confirm('确定删除' + label + '？删除后不可恢复。', '危险操作', {
                type: 'warning',
                confirmButtonText: '删除',
                cancelButtonText: '取消'
            }).then(function () {
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
                        ELEMENT.Message.success('已删除 ' + ok + ' 项');
                    } else {
                        ELEMENT.Message.warning('删除完成：成功 ' + ok + ' 项，失败 ' + fail + ' 项');
                    }
                    d.selected = [];
                    d.lastSelected = '';
                    self.desktopRefresh(d);
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
            if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'rmvb', 'ts'].indexOf(e) >= 0) {
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
                    self.openRemoteEdit(t, path);
                });
            }).catch(function () { /* 取消或失败（已提示） */ });
        },
        desktopOpenEdit: function (row, win) {
            var t = this.desktopTab;
            var d = win || this.desk;
            if (!t || !t.sessionId || !row) {
                return;
            }
            this.openRemoteEdit(t, this.desktopEntryPath(row, d));
        },
        desktopOpenTerminal: function (row, win) {
            var t = this.desktopTab;
            if (!t || !t.ws || t.ws.readyState !== 1 || t.status !== 'open') {
                ELEMENT.Message.warning('当前终端未连接，无法在终端中打开');
                return;
            }
            var d = win || this.desk;
            var dir = d.path;
            if (row) {
                dir = row.dir ? this.desktopEntryPath(row, d) : d.path;
            }
            var self = this;
            this.closeAiDesktop();
            this.$nextTick(function () {
                self.cdIntoDir({ path: dir });
            });
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
                } else if (ok > 0) {
                    ELEMENT.Message.warning('上传完成：成功 ' + ok + ' 个，失败 ' + fail + ' 个');
                } else {
                    ELEMENT.Message.error('上传失败');
                }
                self.desktopRefresh(d);
            });
        },
        desktopAutoScroll: function (ev) {
            var el = this.deskFilesEl(this.desk);
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
                this._deskScrollTimer = setInterval(function () {
                    var sc = self.deskFilesEl(self.desk);
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
                ev.dataTransfer.effectAllowed = 'move';
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
            });
            this._deskFileDrag = null;
            this.stopDesktopDragScroll();
        },
        onDesktopDragOver: function (ev, row) {
            var d = this.desk;
            var extFiles = this.hasFileDrag(ev);
            if (extFiles) {
                if (ev.dataTransfer) {
                    ev.dataTransfer.dropEffect = 'copy';
                }
                d.dropTarget = row && row.dir ? row.name : '';
                d.fileDragOver = true;
                this.desktopAutoScroll(ev);
                return;
            }
            var drag = this._deskFileDrag;
            if (!drag || !drag.names.length) {
                return;
            }
            if (!row || !row.dir || drag.names.indexOf(row.name) >= 0) {
                d.dropTarget = '';
                return;
            }
            var destPath = this.desktopEntryPath(row, d);
            var invalid = drag.paths.some(function (src) {
                return destPath === src || destPath.indexOf(src + '/') === 0;
            });
            d.dropTarget = invalid ? '' : row.name;
            this.desktopAutoScroll(ev);
        },
        onDesktopDragLeave: function (row) {
            if (row && this.desk.dropTarget === row.name) {
                this.desk.dropTarget = '';
            }
            if (row && this.desk.fileDragOver) {
                this.desk.fileDragOver = false;
            }
        },
        onDesktopDrop: function (ev, row) {
            var d = this.desk;
            var files = [];
            if (ev.dataTransfer && ev.dataTransfer.files) {
                for (var i = 0; i < ev.dataTransfer.files.length; i++) {
                    files.push(ev.dataTransfer.files[i]);
                }
            }
            var destDir = row && row.dir ? this.desktopEntryPath(row, d) : d.path;
            d.dropTarget = '';
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
            this.desktopMoveTo(drag.paths, destDir, drag.win, d);
        },
        onDesktopSurfaceDragOver: function (ev) {
            if (this.hasFileDrag(ev)) {
                ev.preventDefault();
                this.desk.dropTarget = '';
                this.desktopAutoScroll(ev);
            }
        },
        onDesktopSurfaceDrop: function (ev) {
            var d = this.desk;
            var files = [];
            if (ev.dataTransfer && ev.dataTransfer.files) {
                for (var i = 0; i < ev.dataTransfer.files.length; i++) {
                    files.push(ev.dataTransfer.files[i]);
                }
            }
            d.dropTarget = '';
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
            if (drag) {
                ev.preventDefault();
                ev.stopPropagation();
                drag.win.dragNames = [];
                this._deskFileDrag = null;
                if (drag.win !== d) {
                    this.desktopMoveTo(drag.paths, d.path, drag.win, d);
                }
            }
        },
        onDesktopSurfaceDragLeave: function () {
            this.desk.dropTarget = '';
        },
        desktopMoveTo: function (sources, destDir, win, targetWin) {
            var t = this.desktopTab;
            var d = win || this.desk;
            var target = targetWin || d;
            if (!t || !t.sessionId || !sources.length) {
                return;
            }
            var self = this;
            var dest = this.trimSlash(destDir);
            var parentSame = sources.every(function (src) {
                return self.trimSlash(src.substring(0, src.lastIndexOf('/')) || '/') === dest;
            });
            if (parentSame) {
                ELEMENT.Message.info('文件已在该目录中');
                return;
            }
            var invalid = sources.filter(function (src) {
                return dest === src || dest.indexOf(src + '/') === 0;
            });
            if (invalid.length) {
                ELEMENT.Message.warning('不能把文件夹移动到自身或其子目录');
                return;
            }
            var names = sources.map(function (src) {
                return src.substring(src.lastIndexOf('/') + 1);
            });
            var label = names.length === 1 ? ('「' + names[0] + '」') : (names.length + ' 个项目');
            this.$confirm(
                '即将把' + label + '移动到目录：「' + dest + '」，移动后原位置将不再保留。',
                '确认移动文件',
                { type: 'warning', confirmButtonText: '确认移动', cancelButtonText: '取消' }
            ).then(function () {
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
                    if (target !== d && self.desktop.windows.indexOf(target) >= 0) {
                        target.selected = [];
                        target.lastSelected = '';
                        self.desktopRefresh(target);
                    }
                });
            }).catch(function () { /* 取消或失败（已提示） */ });
        },
        onDesktopSideButton: function (e) {
            var active = this.desktopWindowById(this.desktop.activeWinId);
            if (!this.desktop.visible || !active || active.type === 'ai'
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
            if (e.key === 'Escape' && this._marquee) {
                this.cancelDesktopMarquee();
                e.preventDefault();
                return;
            }
            if (e.key === 'Escape' && this.desktop.calendarOpen) {
                this.desktop.calendarOpen = false;
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
            var win = active && active.type !== 'ai' ? active : null;
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
                    this.desktopDeleteRows(surfaceRows, surfaceWin);
                } else if (selected.length) {
                    e.preventDefault();
                    this.desktopDeleteRows(selected, win);
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
            this.desktop.menu.visible = false;
            this.desktop.wallMenu.visible = false;
            this.desktop.taskMenu.visible = false;
            this.desktop.iconMenu.visible = false;
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
            var url = '/workspace?connId=' + encodeURIComponent(t.connId) + '&view=desktop';
            if (path) {
                url += '&path=' + encodeURIComponent(path);
            }
            var win = window.open(url, 'deepshell-desktop-' + t.connId);
            if (!win) {
                ELEMENT.Message.warning('浏览器拦截了新标签页，请允许弹出窗口后重试');
            }
        },
        openTerminalInNewTab: function () {
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
        desktopLaunchApp: function (id) {
            if (!id || id === 'desktop') {
                return;
            }
            this.desktop.startOpen = false;
            var self = this;
            if (id === 'ai') {
                this.openAiDesktopWindow();
                return;
            }
            if (id === 'file') {
                this.openDesktopExplorerWindow();
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
            if (id === 'settings' || id === 'connect' || id === 'help' || id === 'about') {
                this.closeAiDesktop();
                this.$nextTick(function () {
                    if (id === 'connect') {
                        self.openConnectDialog();
                    } else if (id === 'settings') {
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
            if (!t) {
                return;
            }
            var self = this;
            this.$confirm('重新连接当前会话？桌面会关闭，并重新建立 SSH 连接。',
                '重新连接', { type: 'warning', confirmButtonText: '重新连接', cancelButtonText: '取消' })
                .then(function () {
                    self.closeAiDesktop();
                    self.$nextTick(function () {
                        self.reconnectTab(t);
                    });
                })
                .catch(function () { /* 取消 */ });
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
            this.analyzeDisk(p);
        },
        analyzeDisk: function (path) {
            var t = this.activeTab;
            if (!t || !t.sessionId || t.diskLoading) {
                return;
            }
            path = (path || '').trim();
            if (!path) {
                ELEMENT.Message.warning('请输入要分析的目录');
                return;
            }
            var self = this;
            t.diskPath = path;
            t.diskLoading = true;
            t.diskError = '';
            t.diskEntries = [];
            t.diskTotalKb = null;
            this.diskElapsed = 0;
            clearInterval(this._diskTimer);
            this._diskTimer = setInterval(function () {
                self.diskElapsed++;
            }, 1000);
            http.get('/api/disk/analyze', { params: { sessionId: t.sessionId, path: path } }).then(function (d) {
                t.diskEntries = (d && d.entries) || [];
                t.diskTotalKb = d ? d.totalKb : null;
                t.diskTruncated = !!(d && d.truncated);
                if (d && d.path) {
                    t.diskPath = d.path;
                }
            }).catch(function (e) {
                t.diskError = (e && e.message) ? e.message : '目录分析失败';
            }).then(function () {
                t.diskLoading = false;
                clearInterval(self._diskTimer);
            });
        },
        diskUp: function () {
            var t = this.activeTab;
            if (!t || !t.diskPath) {
                return;
            }
            var p = t.diskPath.replace(/\/+$/, '');
            var idx = p.lastIndexOf('/');
            this.analyzeDisk(idx <= 0 ? '/' : p.substring(0, idx));
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
                self.lanSettings.urls = [d.localUrl].concat(d.lanUrls || []);
            }).catch(function () { /* 忽略 */ });
        },
        saveLan: function () {
            var self = this;
            http.post('/api/network', { lanEnabled: this.lanSettings.lanEnabled }).then(function (r) {
                ELEMENT.Message.success(r && r.message ? r.message : '已保存');
                self.loadLan();
            }).catch(function () { /* 已由拦截器提示 */ });
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
        applyFont: function () {
            var self = this;
            var f = this.fontSettings;
            try { localStorage.setItem('deepshell.font', JSON.stringify(f)); } catch (e) { /* ignore */ }
            this.tabs.forEach(function (x) {
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
            this.tabs.forEach(function (x) {
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
        initTerminal: function (tab) {
            var self = this;
            var ref = this.$refs['term-' + tab.key];
            var el = Array.isArray(ref) ? ref[0] : ref;
            if (!el) {
                return;
            }
            var term = new Terminal({
                fontFamily: this.fontSettings.family,
                fontSize: this.fontSettings.size,
                cursorBlink: true,
                scrollback: 5000,
                allowTransparency: true,
                theme: this.buildTermTheme()
            });
            var fit = new FitAddon.FitAddon();
            term.loadAddon(fit);
            if (window.SearchAddon && window.SearchAddon.SearchAddon) {
                var searchAddon = new SearchAddon.SearchAddon();
                term.loadAddon(searchAddon);
                tab.searchAddon = searchAddon;
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
                        tab.reconnectAttempts = 0;
                        clearReconnectTimer(tab);
                        var dirReady;
                        if (msg.reattached) {
                            // 服务端会紧接着发来最近输出快照，先清屏避免重复
                            try { term.reset(); } catch (e) { /* ignore */ }
                            dirReady = tab.sftpHome
                                ? self.loadDir(tab.sftpPath || tab.sftpHome, tab)
                                : self.loadHome(tab);
                        } else {
                            dirReady = self.loadHome(tab);
                        }
                        if (tab.autoOpenDesktop) {
                            tab.autoOpenDesktop = false;
                            self.openDesktopAfterConnect(tab, dirReady);
                        }
                    } else if (msg.type === 'error') {
                        tab.status = 'error';
                        tab.serverClosed = true;
                        clearReconnectTimer(tab);
                        term.write('\r\n\x1b[31m● ' + msg.message + '\x1b[0m\r\n');
                    } else if (msg.type === 'closed') {
                        tab.status = 'closed';
                        tab.serverClosed = true;
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
                if (tab.status === 'closed' || tab.status === 'error') {
                    return;
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
            this.activate(tab.key);
            this.$nextTick(function () {
                self.initTerminal(tab);
            });
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
            var url = '/api/sftp/download?sessionId=' + encodeURIComponent(tab.sessionId)
                + '&path=' + encodeURIComponent(path);
            var a = document.createElement('a');
            a.href = url;
            document.body.appendChild(a);
            a.click();
            a.remove();
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
            this.requestBundleDownload(t.sessionId, t.sftpPath, paths, rows.length);
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
            this.transfers.push(item);
            this.transferPanelOpen = true;
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
            // 兼容可视化桌面上传：仍走整文件接口
            var fd = new FormData();
            fd.append('sessionId', tab.sessionId);
            fd.append('path', dir);
            fd.append('file', file);
            return http.post('/api/sftp/upload', fd);
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
            this.transfers.push(item);
            this.transferPanelOpen = true;
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
            if (item.kind === 'localDownload') {
                return;
            }
            var wasRunning = item.status === 'uploading' || item.status === 'processing';
            item.status = 'cancelled';
            if (!wasRunning && item.uploadId) {
                http.post('/api/sftp/upload/abort', { uploadId: item.uploadId }).catch(function () {});
                item.uploadId = '';
            }
            this.pumpTransfers();
        },
        retryTransfer: function (item) {
            if (item.kind === 'localDownload') {
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
        transferPct: function (item) {
            if (item.kind === 'localDownload') {
                if (item.status === 'done' || item.status === 'partial') {
                    return 100;
                }
                if (item.totalBytes > 0) {
                    return Math.max(0, Math.min(99,
                        Math.round((item.doneBytes || 0) * 100 / item.totalBytes)));
                }
                if (item.totalFiles > 0) {
                    return Math.max(0, Math.min(99,
                        Math.round((item.doneFiles || 0) * 100 / item.totalFiles)));
                }
                return 0;
            }
            if (!item.size) {
                return item.status === 'done' ? 100 : 0;
            }
            return Math.max(0, Math.min(100, Math.round((item.offset || 0) * 100 / item.size)));
        },
        transferStatusText: function (item) {
            if (item.kind === 'localDownload') {
                if (item.status === 'queued') return '排队中';
                if (item.status === 'scanning') return '正在统计文件…';
                if (item.status === 'downloading') {
                    return (item.doneFiles || 0) + '/' + (item.totalFiles || 0) + ' 个文件';
                }
                if (item.status === 'partial') {
                    return '完成 ' + (item.doneFiles || 0) + ' 个，失败 ' + (item.errorCount || 0) + ' 个';
                }
                if (item.status === 'done') {
                    return item.totalFiles > 0 ? '已完成 ' + (item.doneFiles || 0) + ' 个文件' : '已完成';
                }
                return item.error || '失败';
            }
            if (item.status === 'pending') return '等待中';
            if (item.status === 'uploading') {
                return this.fmtSize(item.offset || 0) + ' / ' + this.fmtSize(item.size);
            }
            if (item.status === 'processing') return '正在写入服务器…';
            if (item.status === 'done') return '已完成';
            if (item.status === 'cancelled') return '已取消';
            return item.error || '失败';
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
        /* 通用：在线编辑任意远程文件（SFTP 面板与可视化桌面共用） */
        openRemoteEdit: function (t, path) {
            if (!t || !t.sessionId || !path) {
                return;
            }
            this.editForm = { path: path, content: '', loading: true, saving: false };
            this.editVisible = true;
            var self = this;
            http.get('/api/sftp/read', { params: { sessionId: t.sessionId, path: path } }).then(function (content) {
                self.editForm.content = content || '';
                self.editForm.loading = false;
            }).catch(function () {
                self.editForm.loading = false;
                self.editVisible = false;
            });
        },
        saveEdit: function () {
            var t = this.activeTab;
            var f = this.editForm;
            if (!t || !t.sessionId) {
                return;
            }
            var self = this;
            f.saving = true;
            http.post('/api/sftp/write', { sessionId: t.sessionId, path: f.path, content: f.content })
                .then(function () {
                    ELEMENT.Message.success('已保存到远程');
                    self.editVisible = false;
                    if (t.sftpPath) {
                        self.loadDir(t.sftpPath, t);
                    }
                    if (self.desktop.visible) {
                        self.desktopRefresh();
                    }
                })
                .catch(function () { /* 已提示 */ })
                .then(function () {
                    f.saving = false;
                });
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
        focusCmdInput: function () {
            var self = this;
            this.$nextTick(function () {
                var r = self.$refs.cmdInput;
                if (r) {
                    r.focus();
                }
            });
        },
        toggleCmdBar: function () {
            var t = this.activeTab;
            if (!t) {
                return;
            }
            t.cmdVisible = !t.cmdVisible;
            var self = this;
            this.$nextTick(function () {
                self.fitActive();
                if (t.cmdVisible) {
                    self.focusCmdInput();
                }
            });
        },
        onCmdKeydown: function (e) {
            var t = this.activeTab;
            if (!t) {
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                if (this.hotkeySettings.escClose) {
                    t.cmdVisible = false;
                    var self = this;
                    this.$nextTick(function () { self.fitActive(); });
                }
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                this.sendCmd();
                return;
            }
            if (e.key === 'Tab') {
                if (this.hotkeySettings.tabComplete) {
                    e.preventDefault();
                    this.doComplete();
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
        resetComp: function () {
            var t = this.activeTab;
            if (t) {
                t._comp = null;
            }
            this._histIdx = undefined;
            this._histDraft = undefined;
        },
        histMove: function (dir) {
            var t = this.activeTab;
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
        pickHistory: function (h) {
            var t = this.activeTab;
            if (t) {
                t.cmdText = h;
            }
            this.histVisible = false;
            this.focusCmdInput();
        },
        runHistory: function (h) {
            var t = this.activeTab;
            if (t) {
                t.cmdText = h;
            }
            this.histVisible = false;
            this.sendCmd();
        },
        clearHistory: function () {
            var t = this.activeTab;
            if (!t) {
                return;
            }
            t.cmdHistory = [];
            try {
                localStorage.removeItem('deepshell.cmdHistory.' + t.connId);
            } catch (e) { /* ignore */ }
            ELEMENT.Message.success('历史已清空');
        },
        sendCmd: function () {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                return;
            }
            var text = t.cmdText == null ? '' : t.cmdText;
            if (!text.trim() && this.cmdOpts.ignoreBlank) {
                return;
            }
            var payload = text + (this.cmdOpts.appendCr ? '\r' : '');
            var targets = this.tabs.filter(function (x) {
                return (t.sendTargets || []).indexOf(x.key) >= 0
                    && x.ws && x.ws.readyState === 1 && x.status === 'open';
            });
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
            this.resetComp();
            this.focusCmdInput();
        },
        toggleTarget: function (key, checked) {
            var t = this.activeTab;
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
        doComplete: function () {
            var self = this;
            var t = this.activeTab;
            var comp = this.$refs.cmdInput;
            if (!t || !comp) {
                return;
            }
            var el = comp.$refs.input;
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
            this.applyCandidates(t, left, right, token, uniq);
        },
        applyCandidates: function (t, left, right, token, cands) {
            if (!cands || !cands.length) {
                ELEMENT.Message.info('没有匹配项');
                return;
            }
            t._comp = { token: token, list: cands, idx: 0 };
            this.applyCompletion(t, left, right, token, t._comp);
        },
        applyCompletion: function (t, left, right, token, compState) {
            var choice = compState.list[compState.idx];
            var newLeft = left.slice(0, left.length - token.length) + choice;
            t.cmdText = newLeft + right;
            var self = this;
            this.$nextTick(function () {
                var c2 = self.$refs.cmdInput;
                if (c2) {
                    var el2 = c2.$refs.input;
                    el2.setSelectionRange(newLeft.length, newLeft.length);
                    el2.focus();
                }
            });
        },
        copySelection: function () {
            var t = this.activeTab;
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
        pasteToInput: function () {
            var self = this;
            var t = this.activeTab;
            if (!t) {
                return;
            }
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then(function (txt) {
                    if (!txt) {
                        return;
                    }
                    var comp = self.$refs.cmdInput;
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
        onSearchKey: function (e) {
            if (e.key === 'Enter') {
                if (e.shiftKey) {
                    this.findPrev();
                } else {
                    this.findNext();
                }
            }
        },
        findNext: function () {
            var t = this.activeTab;
            if (t && t.searchAddon && this.searchText) {
                t.searchAddon.findNext(this.searchText, { decorations: SEARCH_DECOR });
            }
        },
        findPrev: function () {
            var t = this.activeTab;
            if (t && t.searchAddon && this.searchText) {
                t.searchAddon.findPrevious(this.searchText, { decorations: SEARCH_DECOR });
            }
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
            var t = this.activeTab;
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
            var t = this.activeTab;
            if (!t || t.connId == null) {
                ELEMENT.Message.warning('请先连接主机');
                return;
            }
            var p = t.sftpPath || t.sftpHome;
            if (!p) {
                ELEMENT.Message.warning('当前目录未知，请先浏览文件面板');
                return;
            }
            http.post('/api/common-dirs', { connId: t.connId, path: p }).then(function () {
                ELEMENT.Message.success('已添加：' + p);
                self.loadCommonDirs(t.connId);
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        removeCommonDir: function (d) {
            var self = this;
            var t = this.activeTab;
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
            var t = this.activeTab;
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
            if (this.snippetTarget === 'all') {
                return this.tabs.filter(alive);
            }
            if (this.snippetTarget === 'custom') {
                var keys = this.snippetTargets;
                return this.tabs.filter(function (x) {
                    return keys.indexOf(x.key) >= 0 && alive(x);
                });
            }
            var t = this.activeTab;
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
            var active = this.activeTab;
            targets.forEach(function (x) {
                x.ws.send(payload);
            });
            if (active && targets.indexOf(active) >= 0 && active.term) {
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
        self.loadLocalDownloadStatus();
        self.loadAuthStatus();
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
                    if (self.hotkeySettings.doubleCtrl && !self.desktop.visible) {
                        self.toggleCmdBar();
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
            if (self.desktop.menu.visible) {
                self.desktop.menu.visible = false;
            }
            if (self.desktop.calendarOpen) {
                self.desktop.calendarOpen = false;
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
            if (self.desktop.menu.visible) {
                self.desktop.menu.visible = false;
            }
            if (self.desktop.calendarOpen) {
                self.desktop.calendarOpen = false;
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
