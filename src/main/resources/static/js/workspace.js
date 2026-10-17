/* 终端工作台：多标签 xterm + WebSocket + SFTP 面板 + 快捷命令 */
var http = axios.create({});
http.interceptors.response.use(function (resp) {
    var d = resp.data;
    if (d && typeof d === 'object' && 'code' in d) {
        if (d.code !== 0) {
            ELEMENT.Message.error(d.msg || '请求失败');
            return Promise.reject(new Error(d.msg || 'error'));
        }
        return d.data;
    }
    return d;
}, function (err) {
    ELEMENT.Message.error('网络错误: ' + (err.message || err));
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

/* 记住当前窗口打开的会话标签（sessionStorage 天然按浏览器标签页隔离），用于 F5 后恢复 */
function saveOpenTabs(app) {
    try {
        var state = {
            ids: app.tabs.map(function (t) { return t.connId; }),
            active: app.activeTab ? app.activeTab.connId : null
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

var sortFolders = function (a, b) {
    return (a.sortOrder || 0) - (b.sortOrder || 0) || a.id - b.id;
};

var sortConns = function (a, b) {
    return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        || (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)
        || a.id - b.id;
};

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
        /* AI 可视化桌面 */
        desktopViews: [
            { id: 'large', label: '大图标', icon: 'el-icon-s-grid' },
            { id: 'medium', label: '中图标', icon: 'el-icon-menu' },
            { id: 'small', label: '小图标', icon: 'el-icon-grid' },
            { id: 'list', label: '详细列表', icon: 'el-icon-tickets' }
        ],
        desktopTaskApps: [
            { id: 'ai', label: 'AI 终端', icon: 'el-icon-chat-dot-round' },
            { id: 'file', label: '文件 SFTP', icon: 'el-icon-folder' },
            { id: 'process', label: '进程', icon: 'el-icon-cpu' },
            { id: 'disk', label: '磁盘', icon: 'el-icon-pie-chart' }
        ],
        desktopStartApps: [
            { id: 'ai', label: 'AI 终端', icon: 'el-icon-chat-dot-round', color: '#3d7eff' },
            { id: 'file', label: '文件 SFTP', icon: 'el-icon-folder-opened', color: '#e6a23c' },
            { id: 'dirs', label: '常用目录', icon: 'el-icon-star-off', color: '#8b5cf6' },
            { id: 'cmd', label: '快捷命令', icon: 'el-icon-caret-right', color: '#22a06b' },
            { id: 'process', label: '进程', icon: 'el-icon-cpu', color: '#e06c75' },
            { id: 'disk', label: '磁盘', icon: 'el-icon-pie-chart', color: '#f59e0b' },
            { id: 'settings', label: 'AI 设置', icon: 'el-icon-magic-stick', color: '#7c4dff' },
            { id: 'connect', label: '连接管理', icon: 'el-icon-monitor', color: '#2f8fce' }
        ],
        desktop: {
            visible: false,
            tabKey: '',
            path: '',
            pathInput: '',
            pathEditing: false,
            entries: [],
            loading: false,
            error: '',
            history: [],
            viewMode: loadDesktopView(),
            sortBy: 'name',
            sortDir: 'asc',
            keyword: '',
            selected: [],
            lastSelected: '',
            menu: { visible: false, x: 0, y: 0, target: null },
            propsVisible: false,
            props: null,
            dragNames: [],
            dropTarget: '',
            fileDragOver: false,
            startOpen: false,
            startSearch: '',
            startSearching: false,
            startSearched: false,
            startResults: [],
            startError: '',
            clockNow: Date.now(),
            pendingSelect: '',
            pendingOpen: false,
            previewVisible: false,
            previewName: '',
            previewPath: '',
            previewStamp: 0,
            previewLoading: false,
            previewError: '',
            previewZoom: 1,
            previewRotate: 0,
            previewPanX: 0,
            previewPanY: 0,
            previewNaturalW: 0,
            previewNaturalH: 0,
            thumbFailed: {}
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
        newCmd: { name: '', command: '' },
        commonDirs: [],
        newDirPath: '',
        cmdEditDialog: false,
        cmdEditSaving: false,
        cmdEditForm: { id: null, name: '', command: '' },
        sftpFollow: loadSftpFollow(),
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
        cmdOpts: {
            deep: true,
            handler: function (v) {
                try { localStorage.setItem('deepshell.cmdOpts', JSON.stringify(v)); } catch (e) { /* ignore */ }
            }
        },
        snippetTarget: function (v) {
            try { localStorage.setItem('deepshell.snippetTarget', v); } catch (e) { /* ignore */ }
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
        'desktop.startSearch': function () {
            // 关键字变化后旧的递归搜索结果立即失效
            this._deskSearchSeq = (this._deskSearchSeq || 0) + 1;
            this.desktop.startSearching = false;
            this.desktop.startSearched = false;
            this.desktop.startResults = [];
            this.desktop.startError = '';
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.desktopStartBody) {
                    self.$refs.desktopStartBody.scrollTop = 0;
                }
            });
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
        activeTab: function () {
            return this.tabs.find(function (t) { return t.key === this.activeKey; }, this) || null;
        },
        /* ---------- AI 可视化桌面 ---------- */
        desktopTab: function () {
            var self = this;
            return this.tabs.find(function (t) { return t.key === self.desktop.tabKey; }, this)
                || this.activeTab || null;
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
        desktopCrumbs: function () {
            var p = this.desktop.path;
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
        isDesktopGrid: function () {
            return this.desktop.viewMode !== 'list';
        },
        desktopShownEntries: function () {
            var kw = (this.desktop.keyword || '').trim().toLowerCase();
            var rows = (this.desktop.entries || []).filter(function (r) {
                return !kw || String(r.name).toLowerCase().indexOf(kw) >= 0;
            });
            var by = this.desktop.sortBy;
            var dir = this.desktop.sortDir === 'desc' ? -1 : 1;
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
        desktopSortLabel: function () {
            var map = { name: '名称', size: '大小', mtime: '修改时间' };
            return map[this.desktop.sortBy] + (this.desktop.sortDir === 'asc' ? ' ↑' : ' ↓');
        },
        desktopMenuMulti: function () {
            return this.desktop.selected.length > 1;
        },
        desktopMenuHasFile: function () {
            return this.desktopSelectedRows().some(function (r) { return !r.dir; });
        },
        desktopMenuTitle: function () {
            if (this.desktopMenuMulti) {
                return '已选择 ' + this.desktop.selected.length + ' 项';
            }
            var r = this.desktop.menu.target;
            return r ? (r.dir ? '文件夹 · ' + r.name : '文件 · ' + r.name) : '当前目录';
        },
        desktopPreviewImages: function () {
            var self = this;
            return this.desktopShownEntries.filter(function (r) {
                return self.isDesktopImage(r);
            });
        },
        desktopPreviewIndex: function () {
            var name = this.desktop.previewName;
            for (var i = 0; i < this.desktopPreviewImages.length; i++) {
                if (this.desktopPreviewImages[i].name === name) {
                    return i;
                }
            }
            return -1;
        },
        desktopPreviewCurrent: function () {
            var name = this.desktop.previewName;
            return (this.desktop.entries || []).find(function (r) {
                return r.name === name;
            }) || null;
        },
        desktopPreviewUrl: function () {
            var t = this.desktopTab;
            if (!t || !t.sessionId || !this.desktop.previewPath) {
                return '';
            }
            return '/api/sftp/preview?sessionId=' + encodeURIComponent(t.sessionId)
                + '&path=' + encodeURIComponent(this.desktop.previewPath)
                + '&v=' + this.desktop.previewStamp;
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
            return (this.desktop.entries || []).filter(function (r) {
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
            (this.commonDirs || []).forEach(function (d) {
                add(d.path, d.path, 'el-icon-star-off');
            });
            return out.slice(0, 8);
        },
        desktopClockTime: function () {
            var d = new Date(this.desktop.clockNow);
            var p = function (x) { return (x < 10 ? '0' : '') + x; };
            return p(d.getHours()) + ':' + p(d.getMinutes());
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
        openTab: function (connId) {
            var self = this;
            var conn = this.connections.find(function (c) { return c.id === connId; });
            var tab = {
                key: 'tab' + Date.now() + Math.floor(Math.random() * 1000),
                connId: connId,
                title: conn ? conn.name : ('连接 #' + connId),
                host: conn ? conn.host : '',
                status: 'connecting',
                sessionId: null,
                ws: null,
                term: null,
                fit: null,
                sftpPath: '',
                sftpEntries: [],
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
                chatPhase: '',
                chatLoading: true,
                chatMode: loadAiChatMode(),
                chatStop: false,
                chatStep: 0,
                chatRun: 0
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
                this.bgVisible = true;
            } else if (cmd === 'help') {
                this.helpVisible = true;
            } else if (cmd === 'about') {
                this.loadAppInfo();
                this.aboutVisible = true;
            } else if (cmd === 'lan') {
                this.loadLan();
                this.lanVisible = true;
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
            if (t.aiVisible) {
                var self = this;
                this.$nextTick(function () {
                    if (self.$refs.aiInput) {
                        self.$refs.aiInput.focus();
                    }
                });
            }
        },
        onAiKeydown: function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.aiGenerate();
            } else if (e.key === 'Escape') {
                e.stopPropagation();
                if (this.activeTab) {
                    this.activeTab.aiVisible = false;
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
            t.chatPhase = 'AI 正在思考…';
            this.scrollAiChat();
            http.post('/api/ai/agent/step', {
                sessionId: t.sessionId,
                cwd: conv.cwd || '',
                auto: t.chatMode !== 'manual',
                messages: this.aiBuildHistory(conv)
            }).then(function (r) {
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
                if (run !== t.chatRun) {
                    return;
                }
                conv.msgs.push({ role: 'ai', text: '请求失败：' + ((e && e.message) || '未知错误') });
                self.aiChatFinish(t, conv, '');
            });
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
            this.saveConv(t, conv);
            this.scrollAiChat();
            http.post('/api/ai/agent/exec', {
                sessionId: t.sessionId,
                cwd: conv.cwd || '',
                command: m.cmd
            }).then(function (r) {
                if (run !== t.chatRun) {
                    return;
                }
                self.aiFillCard(conv, m, r || {});
                self.onAiDesktopMaybeRefresh(t, conv);
                conv.updatedAt = Date.now();
                self.saveConv(t, conv);
                if (t.chatStop) {
                    self.aiChatFinish(t, conv, '已停止（本轮命令已执行完）');
                    return;
                }
                self.aiChatLoop(t, conv, run);
            }).catch(function (e) {
                if (run !== t.chatRun) {
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
                var el = self.$refs.aiChatList;
                if (el) {
                    el.scrollTop = el.scrollHeight;
                }
            });
        },

        /* ---------- AI 可视化桌面（Windows 资源管理器式文件页） ---------- */
        openAiDesktop: function () {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            var conv = this.aiActiveConv(t);
            var p = (conv && conv.cwd) || t.termCwd || t.sftpPath || t.sftpHome || '/';
            this.desktop.tabKey = t.key;
            this.desktop.visible = true;
            this.desktop.history = [];
            this.desktop.selected = [];
            this.desktop.lastSelected = '';
            this.desktop.keyword = '';
            this.desktop.error = '';
            this.desktop.pathEditing = false;
            this.desktop.menu.visible = false;
            this.desktop.dragNames = [];
            this.desktop.dropTarget = '';
            this.desktop.fileDragOver = false;
            this.desktop.startOpen = false;
            this.desktop.startSearch = '';
            this.desktop.startResults = [];
            this.desktop.startSearched = false;
            this.desktop.startError = '';
            this.desktop.startSearching = false;
            this.desktop.pendingSelect = '';
            this.desktop.pendingOpen = false;
            this.closeDesktopPreview();
            this.loadDesktopDir(p);
            this.startDesktopClock();
            var self = this;
            this.$nextTick(function () {
                if (self.$refs.desktopRoot) {
                    self.$refs.desktopRoot.focus();
                }
            });
        },
        closeAiDesktop: function () {
            this.stopDesktopDragScroll();
            this.stopDesktopClock();
            this._deskSearchSeq = (this._deskSearchSeq || 0) + 1;
            this.desktop.visible = false;
            this.desktop.menu.visible = false;
            this.desktop.pathEditing = false;
            this.desktop.dragNames = [];
            this.desktop.dropTarget = '';
            this.desktop.fileDragOver = false;
            this.desktop.startOpen = false;
            this.desktop.startSearch = '';
            this.desktop.startResults = [];
            this.desktop.startSearched = false;
            this.desktop.startError = '';
            this.desktop.startSearching = false;
            this.desktop.pendingSelect = '';
            this.desktop.pendingOpen = false;
            this.closeDesktopPreview();
            var self = this;
            this.$nextTick(function () {
                var t = self.activeTab;
                if (t && t.term) {
                    try { t.term.focus(); } catch (e) { /* ignore */ }
                }
                // 桌面里可能新建 / 删除 / 移动过文件，返回时刷新 SFTP 面板
                if (t && t.sessionId && t.sftpPath) {
                    self.loadDir(t.sftpPath, t);
                }
            });
        },
        startDesktopClock: function () {
            this.stopDesktopClock();
            this.desktop.clockNow = Date.now();
            var self = this;
            this._deskClockTimer = setInterval(function () {
                self.desktop.clockNow = Date.now();
            }, 1000);
        },
        stopDesktopClock: function () {
            if (this._deskClockTimer) {
                clearInterval(this._deskClockTimer);
                this._deskClockTimer = null;
            }
        },
        normalizeDesktopPath: function (path) {
            var p = (path == null ? '' : String(path)).trim();
            var home = this.desktopHomeDir;
            if (!p) {
                p = this.desktop.path || home || '/';
            } else if (p === '~') {
                p = home || '/';
            } else if (p.indexOf('~/') === 0) {
                p = this.pathJoin(home || '/', p.slice(2));
            } else if (p.charAt(0) !== '/') {
                p = this.pathJoin(this.desktop.path || home || '/', p);
            }
            p = p.replace(/\/{2,}/g, '/');
            while (p.length > 1 && p.charAt(p.length - 1) === '/') {
                p = p.slice(0, -1);
            }
            return p;
        },
        loadDesktopDir: function (path, nav) {
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return;
            }
            var self = this;
            var target = this.normalizeDesktopPath(path);
            var prevPath = this.desktop.path;
            var seq = (this._deskLoadSeq || 0) + 1;
            this._deskLoadSeq = seq;
            this.desktop.loading = true;
            this.desktop.error = '';
            this.desktop.pathEditing = false;
            http.get('/api/sftp/list', { params: { sessionId: t.sessionId, path: target } }).then(function (list) {
                if (seq !== self._deskLoadSeq) {
                    return;
                }
                if (nav !== 'back' && prevPath && target !== prevPath
                        && self.desktop.history[self.desktop.history.length - 1] !== prevPath) {
                    self.desktop.history.push(prevPath);
                    if (self.desktop.history.length > 50) {
                        self.desktop.history.shift();
                    }
                }
                if (target !== prevPath) {
                    self.desktop.selected = [];
                    self.desktop.lastSelected = '';
                } else {
                    // 刷新后保留仍然存在的选中项
                    var names = (list || []).map(function (r) { return r.name; });
                    self.desktop.selected = self.desktop.selected.filter(function (n) {
                        return names.indexOf(n) >= 0;
                    });
                }
                self.desktop.entries = list || [];
                self.desktop.thumbFailed = {};
                self.desktop.path = target;
                self.desktop.pathInput = target;
                self.desktop.loading = false;
                var pendingName = self.desktop.pendingSelect;
                var pendingOpen = self.desktop.pendingOpen;
                self.desktop.pendingSelect = '';
                self.desktop.pendingOpen = false;
                var pendingHit = null;
                if (pendingName) {
                    pendingHit = (list || []).find(function (r) { return r.name === pendingName; });
                    if (pendingHit) {
                        self.desktop.selected = [pendingName];
                        self.desktop.lastSelected = pendingName;
                    }
                }
                if (pendingHit) {
                    self.scrollDesktopEntry(pendingName);
                    if (pendingOpen) {
                        self.desktopOpenEntry(pendingHit);
                    }
                } else {
                    self.$nextTick(function () {
                        if (self.$refs.deskFiles) {
                            self.$refs.deskFiles.scrollTop = 0;
                        }
                    });
                }
            }).catch(function (e) {
                if (seq !== self._deskLoadSeq) {
                    return;
                }
                if (nav === 'back' && self.desktop.history[self.desktop.history.length - 1] === target) {
                    self.desktop.history.push(target);
                }
                if (!self.desktop.path) {
                    self.desktop.path = target;
                    self.desktop.pathInput = target;
                }
                self.desktop.pendingSelect = '';
                self.desktop.pendingOpen = false;
                self.desktop.error = '无法读取目录：' + target
                    + (e && e.message ? '（' + e.message + '）' : '（路径不存在或无权限）');
                self.desktop.loading = false;
            });
        },
        desktopGo: function (path) {
            var p = this.normalizeDesktopPath(path);
            if (!p) {
                return;
            }
            if (p === this.desktop.path && !this.desktop.error) {
                return;
            }
            this.loadDesktopDir(p);
        },
        desktopRefresh: function () {
            if (!this.desktop.path) {
                return;
            }
            this.loadDesktopDir(this.desktop.path, 'refresh');
        },
        desktopGoBack: function () {
            if (!this.desktop.history.length) {
                return;
            }
            var p = this.desktop.history.pop();
            this.loadDesktopDir(p, 'back');
        },
        desktopUp: function () {
            var p = this.desktop.path || '/';
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
            this.desktop.pathInput = this.desktop.path;
            this.desktop.pathEditing = true;
            var self = this;
            this.$nextTick(function () {
                var r = self.$refs.deskPathInput;
                if (r) {
                    r.focus();
                    if (r.select) {
                        r.select();
                    }
                }
            });
        },
        commitDesktopPathEdit: function () {
            if (!this.desktop.pathEditing) {
                return;
            }
            this.desktop.pathEditing = false;
            var p = this.normalizeDesktopPath(this.desktop.pathInput);
            if (!p) {
                return;
            }
            if (p === this.desktop.path) {
                this.desktopRefresh();
            } else {
                this.loadDesktopDir(p);
            }
        },
        setDesktopView: function (v) {
            this.desktop.viewMode = v;
            try { localStorage.setItem('deepshell.desktopView', v); } catch (e) { /* ignore */ }
        },
        desktopSortBy: function (field) {
            if (this.desktop.sortBy === field) {
                this.desktop.sortDir = this.desktop.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                this.desktop.sortBy = field;
                this.desktop.sortDir = field === 'name' ? 'asc' : 'desc';
            }
        },
        desktopSortCommand: function (cmd) {
            if (cmd === 'name' || cmd === 'size' || cmd === 'mtime') {
                this.desktopSortBy(cmd);
            }
        },
        desktopSortIcon: function (field) {
            if (this.desktop.sortBy !== field) {
                return '';
            }
            return this.desktop.sortDir === 'asc' ? 'el-icon-top' : 'el-icon-bottom';
        },
        desktopClearSelection: function () {
            this.desktop.selected = [];
            this.desktop.lastSelected = '';
        },
        onDesktopFilesClick: function (ev) {
            var el = ev && ev.target;
            if (el && el.closest && (el.closest('.dsk-item') || el.closest('.dsk-row')
                    || el.closest('.dsk-list-head'))) {
                return;
            }
            this.desktopClearSelection();
        },
        scrollDesktopEntry: function (name) {
            this.$nextTick(function () {
                var els = document.querySelectorAll('.dsk-item, .dsk-row');
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
            return this.desktop.selected.indexOf(row.name) >= 0;
        },
        isDesktopDragging: function (row) {
            return this.desktop.dragNames.indexOf(row.name) >= 0;
        },
        desktopSelect: function (row, ev) {
            var rows = this.desktopShownEntries;
            var sel = this.desktop.selected.slice();
            if (ev && ev.shiftKey && this.desktop.lastSelected) {
                var a = -1;
                var b = -1;
                rows.forEach(function (r, i) {
                    if (r.name === this.desktop.lastSelected) {
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
            this.desktop.selected = sel;
            this.desktop.lastSelected = row.name;
            this.desktop.menu.visible = false;
        },
        desktopSelectAll: function () {
            this.desktop.selected = this.desktopShownEntries.map(function (r) { return r.name; });
        },
        desktopSelectedRows: function () {
            var names = this.desktop.selected;
            return (this.desktop.entries || []).filter(function (r) {
                return names.indexOf(r.name) >= 0;
            });
        },
        desktopTargetRows: function () {
            var rows = this.desktopSelectedRows();
            if (rows.length) {
                return rows;
            }
            var target = this.desktop.menu.target;
            return target ? [target] : [];
        },
        desktopOpenEntry: function (row) {
            if (!row) {
                return;
            }
            if (row.dir) {
                this.desktopGo(this.pathJoin(this.desktop.path, row.name));
            } else if (this.isDesktopImage(row)) {
                this.desktopOpenPreview(row);
            } else {
                this.desktopOpenEdit(row);
            }
        },
        desktopEntryPath: function (row) {
            return this.pathJoin(this.desktop.path, row.name);
        },
        /* ---------- 图片缩略图 / 预览 ---------- */
        desktopShowThumb: function (row) {
            if (this.desktop.viewMode !== 'large' && this.desktop.viewMode !== 'medium') {
                return false;
            }
            if (!this.isDesktopImage(row)) {
                return false;
            }
            // 超大图片不自动拉取，避免远程连接被大文件拖慢；仍可双击预览
            if (row.size && row.size > 30 * 1024 * 1024) {
                return false;
            }
            return !this.desktop.thumbFailed[this.desktopEntryPath(row)];
        },
        desktopThumbSrc: function (row) {
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                return '';
            }
            return '/api/sftp/preview?sessionId=' + encodeURIComponent(t.sessionId)
                + '&path=' + encodeURIComponent(this.desktopEntryPath(row))
                + '&v=' + (row.mtime || 0);
        },
        onDesktopThumbError: function (row) {
            this.$set(this.desktop.thumbFailed, this.desktopEntryPath(row), true);
        },
        desktopOpenPreview: function (row) {
            if (!this.isDesktopImage(row)) {
                return;
            }
            this.desktop.menu.visible = false;
            this.desktop.startOpen = false;
            this.desktop.previewVisible = true;
            this.desktop.previewName = row.name;
            this.desktop.previewPath = this.desktopEntryPath(row);
            this.desktop.previewStamp = Date.now();
            this.desktop.previewLoading = true;
            this.desktop.previewError = '';
            this.desktop.previewNaturalW = 0;
            this.desktop.previewNaturalH = 0;
            this.resetDesktopPreviewView();
        },
        resetDesktopPreviewView: function () {
            this.desktop.previewZoom = 1;
            this.desktop.previewRotate = 0;
            this.desktop.previewPanX = 0;
            this.desktop.previewPanY = 0;
        },
        closeDesktopPreview: function () {
            this.desktop.previewVisible = false;
            this.desktop.previewName = '';
            this.desktop.previewPath = '';
            this.desktop.previewLoading = false;
            this.desktop.previewError = '';
            this.resetDesktopPreviewView();
        },
        onDesktopPreviewLoad: function (ev) {
            this.desktop.previewLoading = false;
            this.desktop.previewError = '';
            if (ev && ev.target) {
                this.desktop.previewNaturalW = ev.target.naturalWidth || 0;
                this.desktop.previewNaturalH = ev.target.naturalHeight || 0;
            }
        },
        onDesktopPreviewError: function () {
            this.desktop.previewLoading = false;
            this.desktop.previewError = '图片加载失败：格式可能不受浏览器支持，或文件无读取权限';
        },
        desktopPreviewStep: function (delta) {
            var images = this.desktopPreviewImages;
            if (images.length < 2) {
                return;
            }
            var idx = this.desktopPreviewIndex;
            if (idx < 0) {
                idx = 0;
            }
            var next = (idx + delta + images.length) % images.length;
            var row = images[next];
            this.desktop.previewName = row.name;
            this.desktop.previewPath = this.desktopEntryPath(row);
            this.desktop.previewStamp = Date.now();
            this.desktop.previewLoading = true;
            this.desktop.previewError = '';
            this.desktop.previewNaturalW = 0;
            this.desktop.previewNaturalH = 0;
            this.resetDesktopPreviewView();
        },
        desktopPreviewPrev: function () {
            this.desktopPreviewStep(-1);
        },
        desktopPreviewNext: function () {
            this.desktopPreviewStep(1);
        },
        desktopPreviewZoom: function (factor) {
            var z = this.desktop.previewZoom * factor;
            z = Math.max(0.2, Math.min(8, z));
            this.desktop.previewZoom = Math.round(z * 100) / 100;
            if (this.desktop.previewZoom <= 1) {
                this.desktop.previewPanX = 0;
                this.desktop.previewPanY = 0;
            }
        },
        desktopPreviewFit: function () {
            this.resetDesktopPreviewView();
        },
        desktopPreviewRotate: function () {
            this.desktop.previewRotate = (this.desktop.previewRotate + 90) % 360;
            this.desktop.previewPanX = 0;
            this.desktop.previewPanY = 0;
        },
        desktopPreviewWheel: function (ev) {
            this.desktopPreviewZoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15);
        },
        startDesktopPreviewDrag: function (ev) {
            if (this.desktop.previewZoom <= 1) {
                return;
            }
            ev.preventDefault();
            var self = this;
            var sx = ev.clientX;
            var sy = ev.clientY;
            var px = this.desktop.previewPanX;
            var py = this.desktop.previewPanY;
            var move = function (e) {
                self.desktop.previewPanX = px + (e.clientX - sx);
                self.desktop.previewPanY = py + (e.clientY - sy);
            };
            var up = function () {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        },
        desktopDownloadPreview: function () {
            var t = this.desktopTab;
            if (!t || !t.sessionId || !this.desktop.previewPath) {
                return;
            }
            var url = '/api/sftp/download?sessionId=' + encodeURIComponent(t.sessionId)
                + '&path=' + encodeURIComponent(this.desktop.previewPath);
            var a = document.createElement('a');
            a.href = url;
            document.body.appendChild(a);
            a.click();
            a.remove();
        },
        desktopEntryContextMenu: function (ev, row) {
            this.desktop.startOpen = false;
            if (!this.isDesktopSelected(row)) {
                this.desktop.selected = [row.name];
                this.desktop.lastSelected = row.name;
            }
            this.openDesktopMenu(ev, row);
        },
        desktopBlankContextMenu: function (ev) {
            this.desktop.startOpen = false;
            this.desktop.selected = [];
            this.desktop.lastSelected = '';
            this.openDesktopMenu(ev, null);
        },
        openDesktopMenu: function (ev, target) {
            var self = this;
            var x = ev.clientX;
            var y = ev.clientY;
            this.desktop.menu = {
                visible: true,
                x: Math.max(8, Math.min(x, window.innerWidth - 232)),
                y: Math.max(8, Math.min(y, window.innerHeight - 320)),
                target: target
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
            if (this.desktop.menu.visible) {
                this.desktop.menu.visible = false;
            }
            if (this.desktop.startOpen) {
                this.desktop.startOpen = false;
            }
        },
        desktopMenuAction: function (action) {
            var target = this.desktop.menu.target;
            var rows = this.desktopTargetRows();
            this.desktop.menu.visible = false;
            var self = this;
            if (action === 'open') {
                this.desktopOpenEntry(target || rows[0]);
            } else if (action === 'preview') {
                if (target && this.isDesktopImage(target)) {
                    this.desktopOpenPreview(target);
                }
            } else if (action === 'edit') {
                if (target && !target.dir) {
                    this.desktopOpenEdit(target);
                }
            } else if (action === 'vscode') {
                if (target && !target.dir) {
                    this.openVscodeEdit(this.desktopTab, this.desktopEntryPath(target));
                }
            } else if (action === 'download') {
                this.desktopDownloadRows(rows);
            } else if (action === 'copyPath') {
                this.copyText(rows.map(function (r) {
                    return self.desktopEntryPath(r);
                }).join('\n'));
            } else if (action === 'rename') {
                if (target) {
                    this.desktopRename(target);
                }
            } else if (action === 'delete') {
                this.desktopDeleteRows(rows);
            } else if (action === 'props') {
                if (target) {
                    this.desktopShowProps(target);
                }
            } else if (action === 'terminal') {
                this.desktopOpenTerminal(target || rows[0]);
            } else if (action === 'terminalHere') {
                this.desktopOpenTerminal(null);
            } else if (action === 'copyCurrentPath') {
                this.copyText(this.desktop.path);
            } else if (action === 'newFolder') {
                this.desktopNewFolder();
            } else if (action === 'newFile') {
                this.desktopNewFile();
            } else if (action === 'upload') {
                this.pickDesktopUpload();
            } else if (action === 'refresh') {
                this.desktopRefresh();
            } else if (action === 'sortName') {
                this.desktopSortBy('name');
            } else if (action === 'sortSize') {
                this.desktopSortBy('size');
            } else if (action === 'sortMtime') {
                this.desktopSortBy('mtime');
            }
        },
        desktopDownloadRows: function (rows) {
            var files = (rows || []).filter(function (r) { return !r.dir; });
            if (!files.length) {
                ELEMENT.Message.info('文件夹不支持直接下载，请选择文件');
                return;
            }
            var self = this;
            files.forEach(function (r, i) {
                setTimeout(function () {
                    self.desktopDownloadOne(r);
                }, i * 300);
            });
        },
        desktopDownloadOne: function (row) {
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                return;
            }
            var url = '/api/sftp/download?sessionId=' + encodeURIComponent(t.sessionId)
                + '&path=' + encodeURIComponent(this.desktopEntryPath(row));
            var a = document.createElement('a');
            a.href = url;
            document.body.appendChild(a);
            a.click();
            a.remove();
        },
        desktopDeleteRows: function (rows) {
            var t = this.desktopTab;
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
                            path: self.desktopEntryPath(r)
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
                    self.desktopRefresh();
                    self.desktopClearSelection();
                });
            }).catch(function () { /* 取消或失败（已提示） */ });
        },
        desktopRename: function (row) {
            if (!row) {
                return;
            }
            this.renameForm = {
                path: this.desktopEntryPath(row),
                newName: row.name,
                desktop: true
            };
            this.renameVisible = true;
        },
        desktopShowProps: function (row) {
            var p = this.desktopEntryPath(row);
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
        desktopNewFolder: function () {
            var t = this.desktopTab;
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
                    path: self.pathJoin(self.desktop.path, name)
                }).then(function () {
                    ELEMENT.Message.success('已创建文件夹：' + name);
                    self.desktopRefresh();
                });
            }).catch(function () { /* 取消或失败（已提示） */ });
        },
        desktopNewFile: function () {
            var t = this.desktopTab;
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
                var path = self.pathJoin(self.desktop.path, name);
                return http.post('/api/sftp/touch', {
                    sessionId: t.sessionId,
                    path: path
                }).then(function () {
                    ELEMENT.Message.success('已创建 ' + name);
                    self.desktopRefresh();
                    self.openRemoteEdit(t, path);
                });
            }).catch(function () { /* 取消或失败（已提示） */ });
        },
        desktopOpenEdit: function (row) {
            var t = this.desktopTab;
            if (!t || !t.sessionId || !row) {
                return;
            }
            this.openRemoteEdit(t, this.desktopEntryPath(row));
        },
        desktopOpenTerminal: function (row) {
            var t = this.desktopTab;
            if (!t || !t.ws || t.ws.readyState !== 1 || t.status !== 'open') {
                ELEMENT.Message.warning('当前终端未连接，无法在终端中打开');
                return;
            }
            var dir = this.desktop.path;
            if (row) {
                dir = row.dir ? this.desktopEntryPath(row) : this.desktop.path;
            }
            var self = this;
            this.closeAiDesktop();
            this.$nextTick(function () {
                self.cdIntoDir({ path: dir });
            });
        },
        pickDesktopUpload: function () {
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
            this.desktopUploadFiles(files, this.desktop.path);
        },
        desktopUploadFiles: function (files, destDir) {
            if (!files || !files.length) {
                return Promise.resolve();
            }
            var t = this.desktopTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('会话未就绪，请等连接建立后再试');
                return Promise.reject(new Error('session not ready'));
            }
            var self = this;
            var dir = destDir || this.desktop.path;
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
                self.desktop.fileDragOver = false;
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
                self.desktopRefresh();
            });
        },
        desktopAutoScroll: function (ev) {
            var el = this.$refs.deskFiles;
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
                    var sc = self.$refs.deskFiles;
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
            if (!this.isDesktopSelected(row)) {
                this.desktop.selected = [row.name];
                this.desktop.lastSelected = row.name;
            }
            var rows = this.desktopTargetRows();
            if (!rows.length) {
                rows = [row];
            }
            var self = this;
            var paths = rows.map(function (r) { return self.desktopEntryPath(r); });
            this.desktop.dragNames = rows.map(function (r) { return r.name; });
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
            this.desktop.dragNames = [];
            this.desktop.dropTarget = '';
            this.stopDesktopDragScroll();
        },
        onDesktopDragOver: function (ev, row) {
            var extFiles = this.hasFileDrag(ev);
            if (extFiles) {
                if (ev.dataTransfer) {
                    ev.dataTransfer.dropEffect = 'copy';
                }
                this.desktop.dropTarget = row && row.dir ? row.name : '';
                this.desktop.fileDragOver = true;
                this.desktopAutoScroll(ev);
                return;
            }
            if (!this.desktop.dragNames.length) {
                return;
            }
            if (!row || !row.dir || this.desktop.dragNames.indexOf(row.name) >= 0) {
                this.desktop.dropTarget = '';
                return;
            }
            var destPath = this.desktopEntryPath(row);
            var self = this;
            var invalid = this.desktop.dragNames.some(function (name) {
                var src = self.pathJoin(self.desktop.path, name);
                return destPath === src || destPath.indexOf(src + '/') === 0;
            });
            this.desktop.dropTarget = invalid ? '' : row.name;
            this.desktopAutoScroll(ev);
        },
        onDesktopDragLeave: function (row) {
            if (row && this.desktop.dropTarget === row.name) {
                this.desktop.dropTarget = '';
            }
        },
        onDesktopDrop: function (ev, row) {
            var files = [];
            if (ev.dataTransfer && ev.dataTransfer.files) {
                for (var i = 0; i < ev.dataTransfer.files.length; i++) {
                    files.push(ev.dataTransfer.files[i]);
                }
            }
            var destDir = row && row.dir ? this.desktopEntryPath(row) : this.desktop.path;
            this.desktop.dropTarget = '';
            this.desktop.fileDragOver = false;
            this._deskDragDepth = 0;
            this.stopDesktopDragScroll();
            if (files.length) {
                ev.preventDefault();
                ev.stopPropagation();
                this.desktop.dragNames = [];
                this.desktopUploadFiles(files, destDir);
                return;
            }
            if (!this.desktop.dragNames.length) {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            var self = this;
            var sources = this.desktop.dragNames.map(function (name) {
                return self.pathJoin(self.desktop.path, name);
            });
            this.desktop.dragNames = [];
            this.desktopMoveTo(sources, destDir);
        },
        onDesktopSurfaceDragOver: function (ev) {
            if (this.hasFileDrag(ev)) {
                ev.preventDefault();
                this.desktop.dropTarget = '';
                this.desktopAutoScroll(ev);
            }
        },
        onDesktopSurfaceDrop: function (ev) {
            var files = [];
            if (ev.dataTransfer && ev.dataTransfer.files) {
                for (var i = 0; i < ev.dataTransfer.files.length; i++) {
                    files.push(ev.dataTransfer.files[i]);
                }
            }
            this.desktop.dropTarget = '';
            this.desktop.fileDragOver = false;
            this._deskDragDepth = 0;
            this.stopDesktopDragScroll();
            if (files.length) {
                ev.preventDefault();
                ev.stopPropagation();
                this.desktopUploadFiles(files, this.desktop.path);
                return;
            }
            if (this.desktop.dragNames.length) {
                ev.preventDefault();
                ev.stopPropagation();
                this.desktop.dragNames = [];
            }
        },
        onDesktopSurfaceDragLeave: function () {
            this.desktop.dropTarget = '';
        },
        desktopMoveTo: function (sources, destDir) {
            var t = this.desktopTab;
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
                    self.desktopClearSelection();
                    self.desktopRefresh();
                });
            }).catch(function () { /* 取消或失败（已提示） */ });
        },
        onDesktopKeydown: function (e) {
            if (!this.desktop.visible) {
                return;
            }
            if (this.desktop.previewVisible) {
                if (e.key === 'Escape') {
                    this.closeDesktopPreview();
                    e.preventDefault();
                } else if (e.key === 'ArrowLeft') {
                    this.desktopPreviewPrev();
                    e.preventDefault();
                } else if (e.key === 'ArrowRight') {
                    this.desktopPreviewNext();
                    e.preventDefault();
                } else if (e.key === '+' || e.key === '=') {
                    this.desktopPreviewZoom(1.25);
                    e.preventDefault();
                } else if (e.key === '-') {
                    this.desktopPreviewZoom(0.8);
                    e.preventDefault();
                } else if (e.key === '0') {
                    this.desktopPreviewFit();
                    e.preventDefault();
                } else if (e.key === 'r' || e.key === 'R') {
                    this.desktopPreviewRotate();
                    e.preventDefault();
                }
                return;
            }
            var tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
            var typing = tag === 'input' || tag === 'textarea'
                || (e.target && e.target.isContentEditable);
            if (e.key === 'Escape') {
                if (this.desktop.menu.visible) {
                    this.desktop.menu.visible = false;
                    e.preventDefault();
                } else if (this.desktop.startOpen) {
                    this.desktop.startOpen = false;
                    e.preventDefault();
                } else if (this.desktop.pathEditing) {
                    this.desktop.pathEditing = false;
                    e.preventDefault();
                }
                return;
            }
            if (typing) {
                return;
            }
            var selected = this.desktopSelectedRows();
            if (e.key === 'F2') {
                if (selected.length === 1) {
                    this.desktopRename(selected[0]);
                    e.preventDefault();
                }
            } else if (e.key === 'Delete') {
                if (selected.length) {
                    this.desktopDeleteRows(selected);
                    e.preventDefault();
                }
            } else if (e.key === 'Enter') {
                if (selected.length === 1) {
                    this.desktopOpenEntry(selected[0]);
                    e.preventDefault();
                }
            } else if (e.key === 'Backspace') {
                this.desktopUp();
                e.preventDefault();
            } else if (e.key === 'F5') {
                this.desktopRefresh();
                e.preventDefault();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
                this.desktopSelectAll();
                e.preventDefault();
            }
        },
        onAiDesktopMaybeRefresh: function (t, conv) {
            if (this.desktop.visible && this.desktopTab === t
                    && conv && conv.cwd && conv.cwd === this.desktop.path) {
                this.desktopRefresh();
            }
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
            this.desktopGo(path);
        },
        desktopLaunchApp: function (id) {
            if (!id || id === 'desktop') {
                return;
            }
            this.desktop.startOpen = false;
            var self = this;
            if (id === 'sysinfo') {
                this.openDesktopSysInfo();
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
            var seq = (this._deskSearchSeq || 0) + 1;
            this._deskSearchSeq = seq;
            this.desktop.startSearching = true;
            this.desktop.startSearched = false;
            this.desktop.startError = '';
            this.desktop.startResults = [];
            http.get('/api/files/search', {
                params: {
                    sessionId: t.sessionId,
                    root: this.desktop.path,
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
            this.desktopOpenEntry(row);
        },
        desktopOpenSearchResult: function (row) {
            if (!row) {
                return;
            }
            this.desktop.startOpen = false;
            if (row.dir) {
                this.desktop.pendingSelect = '';
                this.desktop.pendingOpen = false;
                this.desktopGo(row.path);
                return;
            }
            var p = row.path || '';
            var idx = p.lastIndexOf('/');
            var parent = idx <= 0 ? '/' : p.substring(0, idx);
            var name = idx >= 0 ? p.substring(idx + 1) : p;
            this.desktop.pendingSelect = name;
            this.desktop.pendingOpen = true;
            if (parent === this.desktop.path) {
                this.desktopRefresh();
            } else {
                this.loadDesktopDir(parent);
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
        uploadBg: function (param) {
            var self = this;
            var fd = new FormData();
            fd.append('file', param.file);
            http.post('/api/terminal-bg', fd).then(function (url) {
                self.bgSettings.url = url;
                self.applyBg();
                ELEMENT.Message.success('背景已设置');
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        clearBg: function () {
            this.bgSettings.url = '';
            this.applyBg();
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
                + '&cols=' + (term.cols || 120) + '&rows=' + (term.rows || 30);
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
                        self.loadHome(tab);
                    } else if (msg.type === 'error') {
                        tab.status = 'error';
                        term.write('\r\n\x1b[31m● ' + msg.message + '\x1b[0m\r\n');
                    } else if (msg.type === 'closed') {
                        tab.status = 'closed';
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
                if (tab.status !== 'closed' && tab.status !== 'error') {
                    tab.status = 'closed';
                    term.write('\r\n\x1b[33m● 连接已断开\x1b[0m\r\n');
                }
            };
        },
        activate: function (key) {
            var self = this;
            this.activeKey = key;
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
            if (tab.ws) {
                try { tab.ws.close(); } catch (e) { /* ignore */ }
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
            if (!saved || !saved.ids || !saved.ids.length) {
                return;
            }
            var self = this;
            var missing = 0;
            saved.ids.forEach(function (id) {
                var exists = self.connections.some(function (c) { return c.id === id; });
                if (exists) {
                    self.openTab(id);
                } else {
                    missing++;
                }
            });
            if (saved.active) {
                var at = this.tabs.find(function (t) { return t.connId === saved.active; });
                if (at) {
                    this.activate(at.key);
                }
            }
            if (this.tabs.length) {
                ELEMENT.Message.success('已恢复 ' + this.tabs.length + ' 个会话（重新连接中）');
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
                y: Math.max(8, Math.min(ev.clientY, window.innerHeight - 310)),
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
        reconnectTab: function (tab) {
            var self = this;
            // 连接可能已在连接管理中改过名称/地址，重连时同步到标签
            var conn = this.connections.find(function (c) { return c.id === tab.connId; });
            if (conn) {
                tab.title = conn.name;
                tab.host = conn.host;
            }
            // 静默回收旧连接与终端，避免旧回调写入已销毁的终端
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
            tab.status = 'connecting';
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
            this.activate(tab.key);
            this.$nextTick(function () {
                self.initTerminal(tab);
            });
        },
        disconnectTab: function (tab) {
            if (tab.ws && (tab.ws.readyState === 0 || tab.ws.readyState === 1)) {
                try { tab.ws.close(); } catch (e) { /* ignore */ }
            } else {
                tab.status = 'closed';
                if (tab.term) {
                    tab.term.write('\r\n\x1b[33m● 已断开\x1b[0m\r\n');
                }
            }
        },
        fitActive: function () {
            var t = this.activeTab;
            if (t && t.fit) {
                try { t.fit.fit(); } catch (e) { /* ignore */ }
            }
        },
        statusText: function (tab) {
            var map = { connecting: '连接中…', open: '已连接', closed: '已断开', error: '连接失败' };
            return map[tab.status] || tab.status;
        },

        /* ---------- SFTP ---------- */
        loadHome: function (tab) {
            var self = this;
            http.get('/api/sftp/home', { params: { sessionId: tab.sessionId } }).then(function (home) {
                tab.sftpHome = home;
                self.loadDir(home, tab);
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
            http.get('/api/sftp/list', { params: { sessionId: tab.sessionId, path: path } }).then(function (list) {
                // 路径确实变化且非「返回」时记录旧路径，供返回按钮回退
                if (nav !== 'back' && prevPath && path !== prevPath
                        && tab.sftpHistory[tab.sftpHistory.length - 1] !== prevPath) {
                    tab.sftpHistory.push(prevPath);
                    if (tab.sftpHistory.length > 50) {
                        tab.sftpHistory.shift();
                    }
                }
                tab.sftpEntries = list || [];
                tab.sftpPath = path;
                tab.sftpLoading = false;
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
            var url = '/api/sftp/download?sessionId=' + encodeURIComponent(t.sessionId)
                + '&path=' + encodeURIComponent(this.pathJoin(t.sftpPath, row.name));
            var a = document.createElement('a');
            a.href = url;
            document.body.appendChild(a);
            a.click();
            a.remove();
        },
        uploadFile: function (param) {
            var t = this.activeTab;
            if (!t || !t.sessionId) {
                ELEMENT.Message.warning('请先建立连接');
                return;
            }
            var self = this;
            this.uploadOne(t, t.sftpPath, param.file).then(function () {
                ELEMENT.Message.success('上传完成: ' + param.file.name);
                self.loadDir(t.sftpPath, t);
            }).catch(function () { /* 已提示 */ });
        },
        uploadOne: function (tab, dir, file) {
            var fd = new FormData();
            fd.append('sessionId', tab.sessionId);
            fd.append('path', dir);
            fd.append('file', file);
            return http.post('/api/sftp/upload', fd);
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
                this.desktop.fileDragOver = true;
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
                this.desktop.fileDragOver = true;
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
                    this.desktop.fileDragOver = false;
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
            if (this.desktop.visible) {
                this.desktop.fileDragOver = false;
                this.stopDesktopDragScroll();
                this.desktopUploadFiles(files, this.desktop.path);
                return;
            }
            this.desktop.fileDragOver = false;
            this.handleDroppedFiles(files);
        },
        handleDroppedFiles: function (files) {
            if (!files || !files.length) {
                return;
            }
            if (this.desktop.visible) {
                this.desktopUploadFiles(files, this.desktop.path);
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
            chain.then(function () {
                loading.close();
                if (fail === 0) {
                    ELEMENT.Message.success(files.length === 1
                        ? ('文件上传成功：' + files[0].name)
                        : ('文件上传成功：' + files.length + ' 个文件 → ' + dir));
                } else if (ok > 0) {
                    ELEMENT.Message.warning('上传完成：成功 ' + ok + ' 个，失败 ' + fail + ' 个');
                } else {
                    ELEMENT.Message.error('上传失败');
                }
                if (t.sftpPath === dir) {
                    self.loadDir(dir, t);
                }
            });
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
                desktop: false
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
                        self.desktopRefresh();
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

        /* ---------- 常用目录 ---------- */
        loadCommonDirs: function () {
            var self = this;
            return http.get('/api/common-dirs').then(function (d) {
                self.commonDirs = d || [];
            });
        },
        addCommonDir: function () {
            var self = this;
            var p = (this.newDirPath || '').trim();
            if (!p) {
                ELEMENT.Message.warning('请输入目录路径');
                return;
            }
            http.post('/api/common-dirs', { path: p }).then(function () {
                ELEMENT.Message.success('已添加');
                self.newDirPath = '';
                self.loadCommonDirs();
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        addCurrentDir: function () {
            var self = this;
            var t = this.activeTab;
            var p = t && (t.sftpPath || t.sftpHome);
            if (!p) {
                ELEMENT.Message.warning('当前目录未知，请先浏览文件面板');
                return;
            }
            http.post('/api/common-dirs', { path: p }).then(function () {
                ELEMENT.Message.success('已添加：' + p);
                self.loadCommonDirs();
            }).catch(function () { /* 已由拦截器提示 */ });
        },
        removeCommonDir: function (d) {
            var self = this;
            this.$confirm('从常用目录中移除「' + d.path + '」？', '提示', { type: 'warning' })
                .then(function () {
                    return http.delete('/api/common-dirs/' + d.id);
                })
                .then(function () {
                    ELEMENT.Message.success('已移除');
                    self.loadCommonDirs();
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
            var cid = new URLSearchParams(location.search).get('connId');
            if (cid) {
                // 带参打开（连接管理页「连接」按钮）：仅本次生效，校验存在后立即清理地址栏参数，
                // 避免参数陈旧后被反复重开成「连接 #id」并触发后端「连接不存在」
                history.replaceState(null, '', '/workspace');
                var id = Number(cid);
                var exists = self.connections.some(function (c) { return c.id === id; });
                if (exists) {
                    self.openTab(id);
                } else {
                    ELEMENT.Message.warning('连接不存在或已被删除');
                }
                return;
            }
            self.restoreOpenTabs();
        });
        self.loadFolders();
        self.loadCommonDirs();
        self.loadSnippets();
        self.loadAppInfo();
        window.addEventListener('resize', function () {
            self.fitActive();
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
            if (self.desktop.menu.visible) {
                self.desktop.menu.visible = false;
            }
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
        document.addEventListener('keydown', function (e) {
            self.onDesktopKeydown(e);
        });
        window.addEventListener('blur', function () {
            if (self.tabMenu.visible) {
                self.tabMenu.visible = false;
            }
            if (self.topMenuVisible) {
                self.topMenuVisible = false;
            }
            if (self.folderMenu.visible) {
                self.folderMenu.visible = false;
            }
            if (self.desktop.menu.visible) {
                self.desktop.menu.visible = false;
            }
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
