(function () {
    'use strict';

    var API_BASE = '/api/desktop/redis';
    var TYPE_LIST = ['all', 'string', 'hash', 'list', 'set', 'zset', 'stream'];
    var TYPE_LABELS = {
        all: '全部', string: 'String', hash: 'Hash', list: 'List',
        set: 'Set', zset: 'ZSet', stream: 'Stream'
    };
    var DANGEROUS = { FLUSHALL: 1, FLUSHDB: 1, SHUTDOWN: 1 };
    var WRITE_COMMANDS = {
        SET: 1, MSET: 1, MSETNX: 1, DEL: 1, UNLINK: 1, EXPIRE: 1, PEXPIRE: 1,
        EXPIREAT: 1, PERSIST: 1, RENAME: 1, RENAMENX: 1, MOVE: 1,
        HSET: 1, HMSET: 1, HDEL: 1, HINCRBY: 1, HINCRBYFLOAT: 1,
        LPUSH: 1, RPUSH: 1, LPOP: 1, RPOP: 1, LSET: 1, LREM: 1, LTRIM: 1,
        SADD: 1, SREM: 1, SPOP: 1, SMOVE: 1,
        ZADD: 1, ZREM: 1, ZINCRBY: 1, ZPOPMIN: 1, ZPOPMAX: 1,
        XADD: 1, XDEL: 1, XTRIM: 1
    };

    var state = {
        connected: false,
        connecting: false,
        conn: null,
        connName: '',
        db: 0,
        dbSize: 0,
        databases: [],
        info: {},
        keys: [],
        keySeen: {},
        cursor: '0',
        pattern: '*',
        typeFilter: 'all',
        viewMode: 'flat',
        collapsed: {},
        keysLoading: false,
        lastScanned: 0,
        scanToken: 0,
        current: null,
        currentLoading: false,
        detailToken: 0,
        currentTab: 'value',
        searchTimer: null,
        consoleLines: [],
        consoleHistory: [],
        consoleIndex: -1,
        confirmResolve: null
    };

    var dom = {
        welcome: document.getElementById('welcome'),
        workspace: document.getElementById('workspace'),
        connBox: document.getElementById('connBox'),
        dbList: document.getElementById('dbList'),
        dbTotal: document.getElementById('dbTotal'),
        btnOpenConnect: document.getElementById('btnOpenConnect'),
        btnOpenConnectSide: document.getElementById('btnOpenConnectSide'),
        btnDisconnect: document.getElementById('btnDisconnect'),
        searchInput: document.getElementById('searchInput'),
        btnSearch: document.getElementById('btnSearch'),
        btnRefreshKeys: document.getElementById('btnRefreshKeys'),
        keyCount: document.getElementById('keyCount'),
        keyPaneCount: document.getElementById('keyPaneCount'),
        btnViewMode: document.getElementById('btnViewMode'),
        keyList: document.getElementById('keyList'),
        keyEmpty: document.getElementById('keyEmpty'),
        btnMoreKeys: document.getElementById('btnMoreKeys'),
        typeFilters: document.getElementById('typeFilters'),
        scanHint: document.getElementById('scanHint'),
        detailEmpty: document.getElementById('detailEmpty'),
        detail: document.getElementById('detail'),
        detailHead: document.querySelector('.detail-head'),
        ttlRow: document.querySelector('.ttl-row'),
        detailType: document.getElementById('detailType'),
        detailKey: document.getElementById('detailKey'),
        detailSize: document.getElementById('detailSize'),
        detailUpdated: document.getElementById('detailUpdated'),
        ttlInput: document.getElementById('ttlInput'),
        ttlText: document.getElementById('ttlText'),
        btnRefreshKey: document.getElementById('btnRefreshKey'),
        btnRenameKey: document.getElementById('btnRenameKey'),
        btnDeleteKey: document.getElementById('btnDeleteKey'),
        btnSaveTtl: document.getElementById('btnSaveTtl'),
        btnPersistTtl: document.getElementById('btnPersistTtl'),
        tabValue: document.getElementById('tabValue'),
        tabConsole: document.getElementById('tabConsole'),
        tabServer: document.getElementById('tabServer'),
        consoleOut: document.getElementById('consoleOut'),
        consoleInput: document.getElementById('consoleInput'),
        btnRunCommand: document.getElementById('btnRunCommand'),
        btnClearConsole: document.getElementById('btnClearConsole'),
        statusConn: document.getElementById('statusConn'),
        statusDb: document.getElementById('statusDb'),
        statusMeta: document.getElementById('statusMeta'),
        connectForm: document.getElementById('connectForm'),
        connectError: document.getElementById('connectError'),
        btnConnect: document.getElementById('btnConnect'),
        fName: document.getElementById('fName'),
        fHost: document.getElementById('fHost'),
        fPort: document.getElementById('fPort'),
        fDb: document.getElementById('fDb'),
        fUser: document.getElementById('fUser'),
        fPassword: document.getElementById('fPassword'),
        fTimeout: document.getElementById('fTimeout'),
        renameForm: document.getElementById('renameForm'),
        renameInput: document.getElementById('renameInput'),
        confirmTitle: document.getElementById('confirmTitle'),
        confirmMessage: document.getElementById('confirmMessage'),
        btnConfirmOk: document.getElementById('btnConfirmOk'),
        toast: document.getElementById('toast'),
        tabs: Array.prototype.slice.call(document.querySelectorAll('.tabs .tab'))
    };

    var pending = {};
    var seq = 0;
    var toastTimer = null;

    /* ---------------- tiny helpers ---------------- */

    function el(tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) {
            node.className = cls;
        }
        if (text != null) {
            node.textContent = text;
        }
        return node;
    }

    function clear(node) {
        while (node && node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    function setHidden(node, hidden) {
        if (!node) {
            return;
        }
        if (hidden) {
            node.classList.add('hidden');
        } else {
            node.classList.remove('hidden');
        }
    }

    function spacer() {
        return el('span', 'spacer');
    }

    function toast(message, type) {
        dom.toast.textContent = message || '';
        dom.toast.className = 'toast ' + (type || '');
        dom.toast.classList.remove('hidden');
        if (toastTimer) {
            clearTimeout(toastTimer);
        }
        toastTimer = setTimeout(function () {
            dom.toast.classList.add('hidden');
        }, type === 'error' ? 4600 : 2600);
    }

    function errorText(err) {
        return err && err.message ? err.message : String(err || '请求失败');
    }

    function openModal(id) {
        var node = document.getElementById(id);
        if (node) {
            node.classList.remove('hidden');
        }
    }

    function closeModal(id) {
        var node = document.getElementById(id);
        if (!node) {
            return;
        }
        node.classList.add('hidden');
        if (id === 'confirmModal' && state.confirmResolve) {
            var resolve = state.confirmResolve;
            state.confirmResolve = null;
            resolve(false);
        }
    }

    function confirmAction(title, message, confirmText) {
        if (state.confirmResolve) {
            state.confirmResolve(false);
            state.confirmResolve = null;
        }
        dom.confirmTitle.textContent = title || '确认';
        dom.confirmMessage.textContent = message || '';
        dom.btnConfirmOk.textContent = confirmText || '确认';
        openModal('confirmModal');
        return new Promise(function (resolve) {
            state.confirmResolve = resolve;
        });
    }

    /* ---------------- host bridge ---------------- */

    function api(method, path, body) {
        return new Promise(function (resolve, reject) {
            if (window.parent === window) {
                reject(new Error('请从 DeepShell AI 可视化桌面打开此应用'));
                return;
            }
            var id = 'rq' + (++seq) + '-' + Date.now();
            var timer = setTimeout(function () {
                delete pending[id];
                reject(new Error('请求超时，请确认 DeepShell 主界面正常'));
            }, 35000);
            pending[id] = { resolve: resolve, reject: reject, timer: timer };
            try {
                window.parent.postMessage({
                    source: 'deepshell-plugin',
                    type: 'redis.api',
                    requestId: id,
                    method: method,
                    path: path,
                    body: body || null
                }, '*');
            } catch (e) {
                clearTimeout(timer);
                delete pending[id];
                reject(e);
            }
        });
    }

    window.addEventListener('message', function (ev) {
        var msg = ev.data;
        if (!msg || msg.source !== 'deepshell-host' || msg.type !== 'redis.api.result') {
            return;
        }
        var item = pending[msg.requestId];
        if (!item) {
            return;
        }
        clearTimeout(item.timer);
        delete pending[msg.requestId];
        if (msg.ok) {
            item.resolve(msg.data);
        } else {
            item.reject(new Error(msg.error || '请求失败'));
        }
    });

    /* ---------------- formatting ---------------- */

    function fmtBytes(n) {
        var v = Number(n) || 0;
        if (v < 1024) { return v + ' B'; }
        if (v < 1024 * 1024) { return (v / 1024).toFixed(1) + ' KB'; }
        if (v < 1024 * 1024 * 1024) { return (v / 1024 / 1024).toFixed(1) + ' MB'; }
        return (v / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    }

    function fmtTtl(ttl) {
        var v = Number(ttl);
        if (v === -1) { return '永久'; }
        if (v === -2) { return '已过期'; }
        if (!isFinite(v) || v < 0) { return '未知'; }
        if (v < 60) { return v + ' 秒'; }
        if (v < 3600) { return Math.round(v / 60) + ' 分钟'; }
        if (v < 86400) { return (v / 3600).toFixed(1) + ' 小时'; }
        return (v / 86400).toFixed(1) + ' 天';
    }

    function fmtUptime(seconds) {
        var s = Number(seconds);
        if (!isFinite(s) || s <= 0) { return '—'; }
        var d = Math.floor(s / 86400);
        var h = Math.floor((s % 86400) / 3600);
        var m = Math.floor((s % 3600) / 60);
        if (d > 0) { return d + ' 天 ' + h + ' 小时'; }
        if (h > 0) { return h + ' 小时 ' + m + ' 分'; }
        return m + ' 分钟';
    }

    function fmtInfoValue(value) {
        return value == null || value === '' ? '—' : String(value);
    }

    function ttlClass(ttl) {
        return Number(ttl) > 0 ? 'key-ttl expiring' : 'key-ttl';
    }

    /* ---------------- connection UI ---------------- */

    function renderConnBox() {
        clear(dom.connBox);
        if (!state.connected || !state.conn) {
            dom.connBox.appendChild(el('div', 'conn-empty', '尚未连接 Redis'));
            setHidden(dom.btnOpenConnectSide, false);
            setHidden(dom.btnDisconnect, true);
            return;
        }
        var box = el('div', 'conn-online');
        box.appendChild(el('span', 'online-dot'));
        var main = el('div', 'conn-main');
        var title = el('span', 'conn-host', state.connName || (state.conn.host + ':' + state.conn.port));
        title.title = state.conn.host + ':' + state.conn.port;
        var sub = el('span', 'conn-sub', 'Redis ' + (state.conn.version || '?') + ' · DB ' + state.db);
        main.appendChild(title);
        main.appendChild(sub);
        box.appendChild(main);
        dom.connBox.appendChild(box);
        setHidden(dom.btnOpenConnectSide, true);
        setHidden(dom.btnDisconnect, false);
    }

    function renderDbList() {
        clear(dom.dbList);
        dom.dbTotal.textContent = state.connected && state.databases.length
            ? state.databases.length + ' 个' : '';
        if (!state.connected) {
            dom.dbList.appendChild(el('div', 'db-empty', '连接后可切换数据库'));
            return;
        }
        if (!state.databases.length) {
            dom.dbList.appendChild(el('div', 'db-empty', '暂无数据库信息'));
            return;
        }
        state.databases.forEach(function (db) {
            var item = el('button', 'db-item' + (Number(db.index) === Number(state.db) ? ' active' : ''));
            item.type = 'button';
            item.title = 'DB ' + db.index + ' · ' + (db.keys || 0) + ' 个键';
            item.appendChild(el('span', 'db-index', String(db.index)));
            item.appendChild(el('span', 'db-name', 'DB ' + db.index));
            item.appendChild(el('span', 'db-count', String(db.keys == null ? 0 : db.keys)));
            item.addEventListener('click', function () {
                selectDb(Number(db.index));
            });
            dom.dbList.appendChild(item);
        });
    }

    function updateStatus() {
        if (!state.connected || !state.conn) {
            dom.statusConn.textContent = '未连接';
            dom.statusDb.textContent = 'DB 0';
            dom.statusMeta.textContent = '';
            return;
        }
        dom.statusConn.textContent = (state.connName || (state.conn.host + ':' + state.conn.port));
        dom.statusDb.textContent = 'DB ' + state.db;
        var meta = [];
        if (state.conn.version) {
            meta.push('Redis ' + state.conn.version);
        }
        meta.push(state.dbSize + ' 键');
        if (state.keys.length) {
            meta.push('已载入 ' + state.keys.length);
        }
        dom.statusMeta.textContent = meta.join(' · ');
    }

    function resetSession() {
        state.connected = false;
        state.conn = null;
        state.connName = '';
        state.db = 0;
        state.dbSize = 0;
        state.databases = [];
        state.info = {};
        state.keys = [];
        state.keySeen = {};
        state.cursor = '0';
        state.pattern = '*';
        state.typeFilter = 'all';
        state.viewMode = 'flat';
        state.collapsed = {};
        state.lastScanned = 0;
        state.current = null;
        state.currentTab = 'value';
        state.consoleLines = [];
        state.consoleHistory = [];
        state.consoleIndex = -1;
        dom.searchInput.value = '';
        dom.searchInput.placeholder = '搜索键，支持 Redis 模式，如 user:*、cache:?';
        setHidden(dom.welcome, false);
        setHidden(dom.workspace, true);
        renderConnBox();
        renderDbList();
        renderTypeFilters();
        renderKeys();
        renderDetailEmpty();
        renderConsole();
        setHidden(dom.detail, true);
        setHidden(dom.detailEmpty, false);
        updateStatus();
    }

    async function doConnect() {
        if (state.connecting) {
            return;
        }
        var host = dom.fHost.value.trim();
        if (!host) {
            showConnectError('请填写 Redis 主机');
            return;
        }
        var port = parseInt(dom.fPort.value, 10) || 6379;
        var db = parseInt(dom.fDb.value, 10);
        if (isNaN(db) || db < 0 || db > 255) {
            showConnectError('数据库编号需在 0-255 之间');
            return;
        }
        state.connecting = true;
        dom.btnConnect.disabled = true;
        dom.btnConnect.textContent = '连接中…';
        dom.connectError.classList.add('hidden');
        try {
            var data = await api('POST', API_BASE + '/connect', {
                host: host,
                port: port,
                username: dom.fUser.value.trim(),
                password: dom.fPassword.value,
                db: db,
                timeoutMs: parseInt(dom.fTimeout.value, 10) || 5000
            });
            if (!data || !data.connectionId) {
                throw new Error('连接返回数据异常');
            }
            state.connected = true;
            state.conn = data;
            state.connName = dom.fName.value.trim() || (data.host + ':' + data.port);
            state.db = Number(data.db) || 0;
            state.dbSize = Number(data.dbSize) || 0;
            state.databases = data.databases || [];
            state.info = data.info || {};
            state.keys = [];
            state.keySeen = {};
            state.cursor = '0';
            state.keys = [];
            state.current = null;
            state.currentTab = 'value';
            state.typeFilter = 'all';
            state.viewMode = 'flat';
            state.collapsed = {};
            state.consoleLines = [];
            dom.searchInput.value = '';
            dom.searchInput.placeholder = '搜索键，支持 Redis 模式，如 user:*、cache:?';
            closeModal('connectModal');
            setHidden(dom.welcome, true);
            setHidden(dom.workspace, false);
            renderConnBox();
            renderDbList();
            renderTypeFilters();
            renderKeys();
            renderDetailEmpty();
            renderConsole();
            updateStatus();
            await scan(true);
            toast('已连接 ' + state.connName, 'success');
        } catch (err) {
            showConnectError(errorText(err));
        } finally {
            state.connecting = false;
            dom.btnConnect.disabled = false;
            dom.btnConnect.textContent = '连接';
        }
    }

    function showConnectError(message) {
        dom.connectError.textContent = message;
        dom.connectError.classList.remove('hidden');
    }

    function openConnectModal() {
        dom.connectError.classList.add('hidden');
        dom.connectError.textContent = '';
        openModal('connectModal');
        setTimeout(function () {
            try { dom.fHost.focus(); } catch (e) { /* ignore */ }
        }, 60);
    }

    async function disconnect() {
        if (!state.conn) {
            return;
        }
        var id = state.conn.connectionId;
        try {
            await api('POST', API_BASE + '/disconnect', { connectionId: id });
        } catch (e) {
            // 即使后端已断开，也把本地界面恢复为空闲状态
        }
        resetSession();
        toast('已断开 Redis 连接');
    }

    async function selectDb(db) {
        if (!state.connected || !state.conn || db === state.db) {
            return;
        }
        try {
            var data = await api('POST', API_BASE + '/select', {
                connectionId: state.conn.connectionId,
                db: db
            });
            state.db = Number(data.db) || db;
            state.dbSize = Number(data.dbSize) || 0;
            state.databases = data.databases || state.databases;
            state.info = data.info || state.info;
            state.keys = [];
            state.keySeen = {};
            state.cursor = '0';
            state.pattern = '*';
            state.collapsed = {};
            state.current = null;
            dom.searchInput.value = '';
            renderDbList();
            renderKeys();
            renderDetailEmpty();
            renderServerInfo();
            updateStatus();
            await scan(true);
            toast('已切换到 DB ' + state.db, 'success');
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    /* ---------------- keys ---------------- */

    function visibleKeys() {
        var list = state.keys.filter(function (item) {
            return state.typeFilter === 'all' || item.type === state.typeFilter;
        });
        return list.sort(function (a, b) {
            return String(a.key).localeCompare(String(b.key));
        });
    }

    function renderTypeFilters() {
        clear(dom.typeFilters);
        TYPE_LIST.forEach(function (type) {
            var chip = el('button', 'type-chip' + (state.typeFilter === type ? ' active' : ''), TYPE_LABELS[type]);
            chip.type = 'button';
            chip.addEventListener('click', function () {
                state.typeFilter = type;
                renderTypeFilters();
                renderKeys();
                updateCounts();
            });
            dom.typeFilters.appendChild(chip);
        });
    }

    function renderViewMode() {
        dom.btnViewMode.textContent = state.viewMode === 'tree' ? '列表' : '树形';
        dom.btnViewMode.title = state.viewMode === 'tree'
            ? '切换为平铺列表' : '按冒号分组显示键树';
    }

    function renderKeys() {
        var scrollTop = dom.keyList.scrollTop;
        clear(dom.keyList);
        var list = visibleKeys();
        var loading = state.keysLoading;
        setHidden(dom.keyEmpty, !(list.length === 0 && !loading));
        setHidden(dom.btnMoreKeys, state.cursor === '0' || loading);
        renderViewMode();
        if (state.viewMode === 'tree') {
            var root = buildKeyTree(list);
            renderTreeRows(dom.keyList, root, 0);
        } else {
            renderFlatKeys(list);
        }
        updateCounts();
        dom.keyList.scrollTop = Math.min(scrollTop, dom.keyList.scrollHeight);
    }

    function renderFlatKeys(list) {
        list.forEach(function (item) {
            var row = el('div', 'key-item' + (state.current && state.current.key === item.key ? ' active' : ''));
            row.title = item.key;
            row.appendChild(el('span', 'key-dot type-' + (item.type || 'unknown')));
            var main = el('div', 'key-main');
            main.appendChild(el('span', 'key-name', item.key));
            main.appendChild(el('span', 'key-sub', item.type || 'unknown'));
            row.appendChild(main);
            row.appendChild(el('span', ttlClass(item.ttl), fmtTtl(item.ttl)));
            row.addEventListener('click', function () {
                selectKey(item.key, false);
            });
            dom.keyList.appendChild(row);
        });
    }

    function buildKeyTree(list) {
        var root = { name: '', path: '', children: {}, item: null };
        list.forEach(function (item) {
            var parts = String(item.key).split(':');
            var node = root;
            var path = '';
            parts.forEach(function (part) {
                path = path ? path + ':' + part : part;
                if (!node.children[path]) {
                    node.children[path] = { name: part, path: path, children: {}, item: null };
                }
                node = node.children[path];
            });
            node.item = item;
        });
        return root;
    }

    function countTreeKeys(node) {
        var n = node.item ? 1 : 0;
        Object.keys(node.children).forEach(function (key) {
            n += countTreeKeys(node.children[key]);
        });
        return n;
    }

    function toggleTree(path) {
        if (state.collapsed[path]) {
            delete state.collapsed[path];
        } else {
            state.collapsed[path] = true;
        }
        renderKeys();
    }

    function renderTreeRows(container, node, depth) {
        var children = Object.keys(node.children).map(function (key) {
            return node.children[key];
        });
        children.sort(function (a, b) {
            var af = Object.keys(a.children).length > 0;
            var bf = Object.keys(b.children).length > 0;
            if (af !== bf) {
                return af ? -1 : 1;
            }
            return String(a.name).localeCompare(String(b.name));
        });
        children.forEach(function (child) {
            var hasChildren = Object.keys(child.children).length > 0;
            var isKey = !!child.item;
            var collapsed = !!state.collapsed[child.path];
            var row = el('div', 'tree-row'
                + (hasChildren && !isKey ? ' folder' : '')
                + (isKey && state.current && state.current.key === child.item.key ? ' active' : ''));
            row.style.paddingLeft = (6 + depth * 13) + 'px';
            row.title = isKey ? child.item.key : child.path;
            if (hasChildren) {
                var caret = el('span', 'tree-caret', collapsed ? '▸' : '▾');
                caret.addEventListener('click', function (e) {
                    e.stopPropagation();
                    toggleTree(child.path);
                });
                row.appendChild(caret);
            } else {
                row.appendChild(el('span', 'tree-spacer'));
            }
            if (isKey) {
                row.appendChild(el('span', 'key-dot type-' + (child.item.type || 'unknown')));
                row.appendChild(el('span', 'tree-name', child.name || child.item.key));
                if (hasChildren) {
                    row.appendChild(el('span', 'tree-count', String(countTreeKeys(child))));
                } else {
                    row.appendChild(el('span', ttlClass(child.item.ttl), fmtTtl(child.item.ttl)));
                }
                row.addEventListener('click', function () {
                    selectKey(child.item.key, false);
                });
            } else {
                row.appendChild(el('span', 'tree-folder'));
                row.appendChild(el('span', 'tree-name', child.name));
                row.appendChild(el('span', 'tree-count', String(countTreeKeys(child))));
                row.addEventListener('click', function () {
                    toggleTree(child.path);
                });
            }
            container.appendChild(row);
            if (hasChildren && !collapsed) {
                renderTreeRows(container, child, depth + 1);
            }
        });
    }

    function updateCounts() {
        var filtered = visibleKeys().length;
        dom.keyCount.textContent = state.dbSize + ' 键';
        dom.keyPaneCount.textContent = state.connected
            ? (state.typeFilter === 'all' ? state.keys.length + ' 已载入'
                : filtered + ' / ' + state.keys.length + ' 已载入')
            : '';
        if (state.keysLoading) {
            dom.scanHint.textContent = '正在扫描…';
        } else if (!state.connected) {
            dom.scanHint.textContent = '';
        } else if (!state.keys.length) {
            dom.scanHint.textContent = '没有匹配的键';
        } else if (state.cursor !== '0') {
            dom.scanHint.textContent = '已载入 ' + state.keys.length + ' 个，继续 SCAN 可加载更多';
        } else {
            dom.scanHint.textContent = '已扫描全部 ' + state.keys.length + ' 个键';
        }
        setHidden(dom.btnMoreKeys, state.cursor === '0' || state.keysLoading);
    }

    async function scan(reset) {
        if (!state.connected || !state.conn) {
            return;
        }
        var token = ++state.scanToken;
        state.keysLoading = true;
        dom.btnSearch.disabled = true;
        updateCounts();
        try {
            var data = await api('POST', API_BASE + '/scan', {
                connectionId: state.conn.connectionId,
                cursor: reset ? '0' : state.cursor,
                match: state.pattern || '*',
                count: 200
            });
            if (token !== state.scanToken) {
                return;
            }
            if (reset) {
                state.keys = [];
                state.keySeen = {};
            }
            var incoming = data.keys || [];
            incoming.forEach(function (item) {
                if (item && item.key && !state.keySeen[item.key]) {
                    state.keySeen[item.key] = true;
                    state.keys.push(item);
                }
            });
            state.cursor = data.cursor == null ? '0' : String(data.cursor);
            state.dbSize = Number(data.dbSize) || 0;
            state.lastScanned = Number(data.scanned) || 0;
            var currentDb = state.databases.filter(function (d) {
                return Number(d.index) === Number(state.db);
            })[0];
            if (currentDb) {
                currentDb.keys = state.dbSize;
            }
            renderDbList();
            renderKeys();
            updateStatus();
            if (!incoming.length && state.cursor === '0' && state.keys.length === 0) {
                dom.scanHint.textContent = '没有匹配的键';
            }
        } catch (err) {
            if (token === state.scanToken) {
                toast(errorText(err), 'error');
                dom.scanHint.textContent = '扫描失败';
            }
        } finally {
            if (token === state.scanToken) {
                state.keysLoading = false;
                dom.btnSearch.disabled = false;
                updateCounts();
            }
        }
    }

    function applySearch() {
        if (!state.connected) {
            return;
        }
        state.pattern = (dom.searchInput.value || '').trim() || '*';
        scan(true);
    }

    /* ---------------- detail / values ---------------- */

    async function selectKey(key, silent) {
        if (!state.connected || !state.conn) {
            return;
        }
        var token = ++state.detailToken;
        state.currentLoading = true;
        if (!silent) {
            state.currentTab = 'value';
        }
        try {
            var data = await api('POST', API_BASE + '/key', {
                connectionId: state.conn.connectionId,
                key: key,
                limit: 500
            });
            if (token !== state.detailToken) {
                return;
            }
            if (!data || data.type === 'none') {
                state.current = null;
                renderDetailEmpty();
                toast('键已不存在或已过期', 'error');
                scan(true);
                return;
            }
            state.current = data;
            renderDetail();
            renderKeys();
            updateStatus();
        } catch (err) {
            if (token === state.detailToken) {
                toast(errorText(err), 'error');
            }
        } finally {
            if (token === state.detailToken) {
                state.currentLoading = false;
            }
        }
    }

    function renderDetailEmpty() {
        if (!state.connected) {
            setHidden(dom.detail, true);
            setHidden(dom.detailEmpty, false);
            dom.detailKey.textContent = '';
            return;
        }
        setHidden(dom.detailEmpty, true);
        setHidden(dom.detail, false);
        dom.detail.classList.add('no-key');
        dom.detailKey.textContent = '';
        dom.detailType.className = 'type-badge type-none';
        dom.detailType.textContent = 'empty';
        dom.detailSize.textContent = '';
        dom.detailUpdated.textContent = '';
        dom.ttlText.textContent = '';
        dom.ttlInput.value = '';
        clear(dom.tabValue);
        var empty = el('div', 'empty-block');
        empty.appendChild(el('b', null, '选择一个键'));
        empty.appendChild(el('span', null, '左侧列表展示当前数据库中的键，点击后查看内容。也可以直接使用命令控制台。'));
        dom.tabValue.appendChild(empty);
        showTab(state.currentTab === 'server' || state.currentTab === 'console'
            ? state.currentTab : 'value');
    }

    function renderDetail() {
        var cur = state.current;
        if (!cur) {
            renderDetailEmpty();
            return;
        }
        dom.detail.classList.remove('no-key');
        setHidden(dom.detailEmpty, true);
        setHidden(dom.detail, false);
        dom.detailType.className = 'type-badge type-' + (cur.type || 'unknown');
        dom.detailType.textContent = cur.type || 'unknown';
        dom.detailKey.textContent = cur.key;
        dom.detailKey.title = cur.key;
        var size = cur.value && cur.value.size;
        if (cur.type === 'string') {
            dom.detailSize.textContent = (size == null ? '' : fmtBytes(size));
        } else if (cur.type === 'stream') {
            dom.detailSize.textContent = (size == null ? '' : size + ' 条');
        } else {
            dom.detailSize.textContent = (size == null ? '' : size + ' 项');
        }
        dom.ttlText.textContent = Number(cur.ttl) > 0 ? fmtTtl(cur.ttl) : '';
        dom.ttlInput.value = Number(cur.ttl) > 0 ? String(cur.ttl) : '';
        dom.detailUpdated.textContent = '已加载';
        renderCurrentValue();
        showTab(state.currentTab);
    }

    function valueNote(text) {
        return el('div', 'value-note', text);
    }

    function makeTable(headers) {
        var table = el('table', 'data-table');
        var thead = el('thead');
        var tr = el('tr');
        headers.forEach(function (h) {
            var th = el('th', h.cls || '', h.label || '');
            if (h.style) {
                th.setAttribute('style', h.style);
            }
            tr.appendChild(th);
        });
        thead.appendChild(tr);
        table.appendChild(thead);
        var tbody = el('tbody');
        table.appendChild(tbody);
        return { table: table, body: tbody };
    }

    function textButton(label, cls, handler) {
        var btn = el('button', 'btn btn-ghost btn-xs ' + (cls || ''), label);
        btn.type = 'button';
        btn.addEventListener('click', handler);
        return btn;
    }

    function bindEnter(inputs, handler) {
        inputs.forEach(function (input) {
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handler();
                }
            });
        });
    }

    function renderCurrentValue() {
        clear(dom.tabValue);
        var cur = state.current;
        if (!cur || !cur.value) {
            dom.tabValue.appendChild(el('div', 'detail-empty', '暂无值'));
            return;
        }
        var value = cur.value;
        if (value.truncated) {
            dom.tabValue.appendChild(valueNote('数据较大，仅展示前 500 项；可使用命令控制台读取完整内容。'));
        }
        if (cur.type === 'string') {
            renderStringValue(value);
        } else if (cur.type === 'hash') {
            renderHashValue(value);
        } else if (cur.type === 'list') {
            renderListValue(value);
        } else if (cur.type === 'set') {
            renderSetValue(value);
        } else if (cur.type === 'zset') {
            renderZsetValue(value);
        } else if (cur.type === 'stream') {
            renderStreamValue(value);
        } else {
            var pre = el('pre', 'value-editor', value.text || '(暂不支持预览该类型)');
            pre.style.whiteSpace = 'pre-wrap';
            dom.tabValue.appendChild(pre);
        }
    }

    function renderStringValue(value) {
        var toolbar = el('div', 'value-toolbar');
        toolbar.appendChild(el('span', null, 'STRING · UTF-8'));
        toolbar.appendChild(spacer());
        toolbar.appendChild(el('span', 'muted', fmtBytes(value.size)));
        var area = el('textarea', 'value-editor');
        area.value = value.text || '';
        area.spellcheck = false;
        area.setAttribute('wrap', 'off');
        var actions = el('div', 'value-actions');
        var count = el('span', 'muted', (value.text || '').length + ' 字符');
        actions.appendChild(count);
        actions.appendChild(spacer());
        var save = el('button', 'btn btn-primary btn-sm', '保存值');
        save.type = 'button';
        save.addEventListener('click', function () {
            saveString(area.value, save);
        });
        actions.appendChild(save);
        dom.tabValue.appendChild(toolbar);
        dom.tabValue.appendChild(area);
        dom.tabValue.appendChild(actions);
        area.addEventListener('input', function () {
            count.textContent = area.value.length + ' 字符';
        });
    }

    async function saveString(text, button) {
        if (!state.current) {
            return;
        }
        button.disabled = true;
        button.textContent = '保存中…';
        try {
            await api('POST', API_BASE + '/key/string', {
                connectionId: state.conn.connectionId,
                key: state.current.key,
                value: text
            });
            toast('字符串已保存', 'success');
            await selectKey(state.current.key, true);
        } catch (err) {
            toast(errorText(err), 'error');
        } finally {
            button.disabled = false;
            button.textContent = '保存值';
        }
    }

    function renderHashValue(value) {
        var wrap = el('div');
        if (value.truncated) {
            wrap.appendChild(valueNote('Hash 字段较多，当前展示第一页。'));
        }
        var t = makeTable([
            { label: 'FIELD' },
            { label: 'VALUE' },
            { label: '', cls: 'col-actions' }
        ]);
        (value.entries || []).forEach(function (entry) {
            var tr = el('tr');
            var ftd = el('td');
            var field = el('span', 'cell-read', entry.field);
            field.title = entry.field;
            ftd.appendChild(field);
            var vtd = el('td');
            var input = el('input', 'cell-input');
            input.value = entry.value;
            input.spellcheck = false;
            vtd.appendChild(input);
            var atd = el('td', 'col-actions');
            atd.appendChild(textButton('保存', '', function () {
                editHash('set', entry.field, input.value);
            }));
            atd.appendChild(textButton('删除', 'danger-text', function () {
                editHash('del', entry.field, '');
            }));
            tr.appendChild(ftd);
            tr.appendChild(vtd);
            tr.appendChild(atd);
            t.body.appendChild(tr);
        });
        wrap.appendChild(t.table);
        var add = el('div', 'add-row');
        add.appendChild(el('span', 'add-label', '新增字段'));
        var field = el('input', 'input');
        field.placeholder = 'field';
        field.spellcheck = false;
        var val = el('input', 'input');
        val.placeholder = 'value';
        val.spellcheck = false;
        var addBtn = el('button', 'btn btn-primary btn-sm', '添加');
        addBtn.type = 'button';
        addBtn.addEventListener('click', function () {
            if (!field.value) {
                toast('请填写 Hash 字段名', 'error');
                return;
            }
            editHash('set', field.value, val.value, true);
        });
        bindEnter([field, val], function () { addBtn.click(); });
        add.appendChild(field);
        add.appendChild(val);
        add.appendChild(addBtn);
        wrap.appendChild(add);
        dom.tabValue.appendChild(wrap);
    }

    async function editHash(op, field, value, clearAfter) {
        if (!state.current) {
            return;
        }
        try {
            await api('POST', API_BASE + '/key/hash', {
                connectionId: state.conn.connectionId,
                key: state.current.key,
                op: op,
                field: field,
                value: value == null ? '' : value
            });
            toast(op === 'del' ? '字段已删除' : '字段已保存', 'success');
            await selectKey(state.current.key, true);
            if (clearAfter) {
                dom.tabValue.querySelectorAll('.add-row .input').forEach(function (input) {
                    input.value = '';
                });
            }
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    function renderListValue(value) {
        var wrap = el('div');
        if (value.truncated) {
            wrap.appendChild(valueNote('List 较长，当前展示前 500 项。'));
        }
        var t = makeTable([
            { label: '#', cls: 'col-index' },
            { label: 'VALUE' },
            { label: '', cls: 'col-actions' }
        ]);
        (value.items || []).forEach(function (item, index) {
            var tr = el('tr');
            var idx = el('td', 'col-index', String(index));
            var vtd = el('td');
            var input = el('input', 'cell-input');
            input.value = item;
            input.spellcheck = false;
            vtd.appendChild(input);
            var atd = el('td', 'col-actions');
            atd.appendChild(textButton('保存', '', function () {
                editList('set', index, input.value);
            }));
            atd.appendChild(textButton('删除', 'danger-text', function () {
                editList('remove', -1, item);
            }));
            tr.appendChild(idx);
            tr.appendChild(vtd);
            tr.appendChild(atd);
            t.body.appendChild(tr);
        });
        wrap.appendChild(t.table);
        var add = el('div', 'add-row');
        add.appendChild(el('span', 'add-label', '新增元素'));
        var input = el('input', 'input');
        input.placeholder = 'value';
        input.spellcheck = false;
        var head = el('button', 'btn btn-ghost btn-sm', '头部插入');
        var tail = el('button', 'btn btn-primary btn-sm', '尾部追加');
        head.type = 'button';
        tail.type = 'button';
        head.addEventListener('click', function () { editList('pushHead', -1, input.value, true); });
        tail.addEventListener('click', function () { editList('pushTail', -1, input.value, true); });
        bindEnter([input], function () { tail.click(); });
        add.appendChild(input);
        add.appendChild(head);
        add.appendChild(tail);
        wrap.appendChild(add);
        dom.tabValue.appendChild(wrap);
    }

    async function editList(op, index, value, clearAfter) {
        if (!state.current) {
            return;
        }
        try {
            await api('POST', API_BASE + '/key/list', {
                connectionId: state.conn.connectionId,
                key: state.current.key,
                op: op,
                index: index,
                value: value == null ? '' : value
            });
            toast(op === 'remove' ? '元素已删除' : 'List 已更新', 'success');
            await selectKey(state.current.key, true);
            if (clearAfter) {
                dom.tabValue.querySelectorAll('.add-row .input').forEach(function (input) {
                    input.value = '';
                });
            }
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    function renderSetValue(value) {
        var wrap = el('div');
        if (value.truncated) {
            wrap.appendChild(valueNote('Set 较大，当前展示第一页。'));
        }
        var chips = el('div', 'chip-list');
        (value.items || []).forEach(function (member) {
            var chip = el('span', 'chip');
            chip.appendChild(el('span', null, member));
            var del = el('button', '', '×');
            del.type = 'button';
            del.title = '移除成员';
            del.addEventListener('click', function () { editSet('remove', member); });
            chip.appendChild(del);
            chips.appendChild(chip);
        });
        wrap.appendChild(chips);
        var add = el('div', 'add-row');
        add.appendChild(el('span', 'add-label', '新增成员'));
        var input = el('input', 'input');
        input.placeholder = 'member';
        input.spellcheck = false;
        var addBtn = el('button', 'btn btn-primary btn-sm', '添加');
        addBtn.type = 'button';
        addBtn.addEventListener('click', function () { editSet('add', input.value, true); });
        bindEnter([input], function () { addBtn.click(); });
        add.appendChild(input);
        add.appendChild(addBtn);
        wrap.appendChild(add);
        dom.tabValue.appendChild(wrap);
    }

    async function editSet(op, member, clearAfter) {
        if (!state.current) {
            return;
        }
        try {
            await api('POST', API_BASE + '/key/set', {
                connectionId: state.conn.connectionId,
                key: state.current.key,
                op: op,
                member: member == null ? '' : member
            });
            toast(op === 'remove' ? '成员已移除' : 'Set 已更新', 'success');
            await selectKey(state.current.key, true);
            if (clearAfter) {
                dom.tabValue.querySelectorAll('.add-row .input').forEach(function (input) {
                    input.value = '';
                });
            }
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    function renderZsetValue(value) {
        var wrap = el('div');
        if (value.truncated) {
            wrap.appendChild(valueNote('ZSet 较大，当前展示前 500 项。'));
        }
        var t = makeTable([
            { label: 'MEMBER' },
            { label: 'SCORE', cls: 'col-score' },
            { label: '', cls: 'col-actions' }
        ]);
        (value.items || []).forEach(function (item) {
            var tr = el('tr');
            var mtd = el('td');
            var member = el('span', 'cell-read member', item.member);
            member.title = item.member;
            mtd.appendChild(member);
            var std = el('td');
            var score = el('input', 'cell-input');
            score.value = item.score;
            score.spellcheck = false;
            std.appendChild(score);
            var atd = el('td', 'col-actions');
            atd.appendChild(textButton('保存', '', function () {
                editZset('add', item.member, score.value);
            }));
            atd.appendChild(textButton('删除', 'danger-text', function () {
                editZset('remove', item.member, '');
            }));
            tr.appendChild(mtd);
            tr.appendChild(std);
            tr.appendChild(atd);
            t.body.appendChild(tr);
        });
        wrap.appendChild(t.table);
        var add = el('div', 'add-row');
        add.appendChild(el('span', 'add-label', '新增成员'));
        var member = el('input', 'input');
        member.placeholder = 'member';
        member.spellcheck = false;
        var score = el('input', 'input narrow');
        score.placeholder = 'score';
        score.value = '0';
        var addBtn = el('button', 'btn btn-primary btn-sm', '添加');
        addBtn.type = 'button';
        addBtn.addEventListener('click', function () { editZset('add', member.value, score.value, true); });
        bindEnter([member, score], function () { addBtn.click(); });
        add.appendChild(member);
        add.appendChild(score);
        add.appendChild(addBtn);
        wrap.appendChild(add);
        dom.tabValue.appendChild(wrap);
    }

    async function editZset(op, member, score, clearAfter) {
        if (!state.current) {
            return;
        }
        var parsed = Number(score);
        if (op === 'add' && (score === '' || !isFinite(parsed))) {
            toast('请输入有效的 score', 'error');
            return;
        }
        try {
            await api('POST', API_BASE + '/key/zset', {
                connectionId: state.conn.connectionId,
                key: state.current.key,
                op: op,
                member: member == null ? '' : member,
                score: op === 'add' ? parsed : 0
            });
            toast(op === 'remove' ? '成员已移除' : 'ZSet 已更新', 'success');
            await selectKey(state.current.key, true);
            if (clearAfter) {
                dom.tabValue.querySelectorAll('.add-row .input').forEach(function (input) {
                    input.value = '';
                });
            }
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    function renderStreamValue(value) {
        var wrap = el('div');
        if (value.truncated) {
            wrap.appendChild(valueNote('Stream 较长，仅展示前 500 条。'));
        }
        (value.entries || []).forEach(function (entry) {
            var card = el('div', 'stream-entry');
            card.appendChild(el('div', 'stream-id', entry.id));
            var fields = el('div', 'stream-fields');
            (entry.fields || []).forEach(function (f) {
                fields.appendChild(el('span', null, f.field));
                fields.appendChild(el('span', null, f.value));
            });
            card.appendChild(fields);
            wrap.appendChild(card);
        });
        if (!(value.entries || []).length) {
            wrap.appendChild(el('div', 'empty-block', 'Stream 为空'));
        }
        dom.tabValue.appendChild(wrap);
    }

    /* ---------------- ttl / rename / delete ---------------- */

    async function saveTtl(ttl) {
        if (!state.current) {
            return;
        }
        try {
            var data = await api('POST', API_BASE + '/key/ttl', {
                connectionId: state.conn.connectionId,
                key: state.current.key,
                ttl: ttl
            });
            state.current.ttl = data.ttl;
            dom.ttlText.textContent = Number(data.ttl) > 0 ? fmtTtl(data.ttl) : '';
            dom.ttlInput.value = Number(data.ttl) > 0 ? String(data.ttl) : '';
            toast(ttl > 0 ? 'TTL 已更新' : '已设置为永久', 'success');
            updateKeyTtlInList(state.current.key, data.ttl);
            renderKeys();
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    function updateKeyTtlInList(key, ttl) {
        state.keys.forEach(function (item) {
            if (item.key === key) {
                item.ttl = ttl;
            }
        });
    }

    function openRename() {
        if (!state.current) {
            return;
        }
        dom.renameInput.value = state.current.key;
        openModal('renameModal');
        setTimeout(function () {
            try {
                dom.renameInput.focus();
                dom.renameInput.select();
            } catch (e) { /* ignore */ }
        }, 60);
    }

    async function submitRename(e) {
        e.preventDefault();
        if (!state.current) {
            return;
        }
        var newKey = dom.renameInput.value.trim();
        if (!newKey) {
            toast('键名不能为空', 'error');
            return;
        }
        try {
            await api('POST', API_BASE + '/key/rename', {
                connectionId: state.conn.connectionId,
                key: state.current.key,
                newKey: newKey
            });
            closeModal('renameModal');
            toast('键已重命名', 'success');
            state.pattern = '*';
            dom.searchInput.value = '';
            await scan(true);
            await selectKey(newKey, false);
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    async function deleteKey() {
        if (!state.current) {
            return;
        }
        var key = state.current.key;
        var ok = await confirmAction('删除键', '确定删除键「' + key + '」？此操作不可撤销。', '删除');
        if (!ok) {
            return;
        }
        try {
            await api('POST', API_BASE + '/key/delete', {
                connectionId: state.conn.connectionId,
                key: key
            });
            state.current = null;
            renderDetailEmpty();
            toast('键已删除', 'success');
            await scan(true);
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    /* ---------------- tabs / console ---------------- */

    function showTab(name) {
        state.currentTab = name;
        dom.tabs.forEach(function (tab) {
            tab.classList.toggle('active', tab.getAttribute('data-tab') === name);
        });
        setHidden(dom.tabValue, name !== 'value');
        setHidden(dom.tabConsole, name !== 'console');
        setHidden(dom.tabServer, name !== 'server');
        if (name === 'console') {
            setTimeout(function () {
                try { dom.consoleInput.focus(); } catch (e) { /* ignore */ }
            }, 30);
        } else if (name === 'server') {
            renderServerInfo();
        }
    }

    function renderConsole() {
        clear(dom.consoleOut);
        if (!state.consoleLines.length) {
            dom.consoleOut.appendChild(el('div', 'console-empty',
                '输入 Redis 命令并执行。示例：PING、DBSIZE、SCAN 0 MATCH user:* COUNT 20'));
            return;
        }
        state.consoleLines.forEach(function (line) {
            var wrap = el('div', 'console-line');
            wrap.appendChild(el('div', 'console-cmd', line.cmd));
            var result = el('pre', 'console-result ' + (line.ok ? 'ok' : 'err'), line.text);
            wrap.appendChild(result);
            dom.consoleOut.appendChild(wrap);
        });
        dom.consoleOut.scrollTop = dom.consoleOut.scrollHeight;
    }

    function appendConsole(cmd, text, ok) {
        state.consoleLines.push({ cmd: cmd, text: text, ok: ok });
        renderConsole();
    }

    async function runConsole() {
        if (!state.connected || !state.conn) {
            return;
        }
        var command = dom.consoleInput.value.trim();
        if (!command) {
            return;
        }
        var head = command.split(/\s+/)[0].toUpperCase();
        if (DANGEROUS[head]) {
            var ok = await confirmAction('危险命令确认',
                '即将执行：\n' + command + '\n\n该命令可能清空数据或停止服务，确定继续？',
                '执行');
            if (!ok) {
                return;
            }
        }
        dom.consoleInput.value = '';
        if (state.consoleHistory[state.consoleHistory.length - 1] !== command) {
            state.consoleHistory.push(command);
        }
        state.consoleIndex = state.consoleHistory.length;
        try {
            var data = await api('POST', API_BASE + '/command', {
                connectionId: state.conn.connectionId,
                command: command
            });
            appendConsole(command, data.text || '(空结果)', true);
            await refreshAfterCommand(command, head);
        } catch (err) {
            appendConsole(command, errorText(err), false);
        }
    }

    async function refreshAfterCommand(command, head) {
        if (head === 'SELECT') {
            var parts = command.split(/\s+/);
            var db = parseInt(parts[1], 10);
            if (!isNaN(db) && db >= 0 && db <= 255) {
                state.db = db;
                state.pattern = '*';
                dom.searchInput.value = '';
                state.current = null;
                renderDbList();
                renderDetailEmpty();
                updateStatus();
                await scan(true);
            }
            return;
        }
        if (head === 'FLUSHALL' || head === 'FLUSHDB') {
            state.current = null;
            renderDetailEmpty();
            await scan(true);
            return;
        }
        if (WRITE_COMMANDS[head]) {
            await scan(true);
            if (state.current) {
                await selectKey(state.current.key, true);
            }
        }
    }

    function renderServerInfo() {
        clear(dom.tabServer);
        if (!state.connected) {
            return;
        }
        var toolbar = el('div', 'value-toolbar');
        toolbar.appendChild(el('span', null, 'SERVER INFO'));
        toolbar.appendChild(spacer());
        var refresh = el('button', 'btn btn-ghost btn-xs', '刷新');
        refresh.type = 'button';
        refresh.addEventListener('click', refreshInfo);
        toolbar.appendChild(refresh);
        dom.tabServer.appendChild(toolbar);

        var info = state.info || {};
        var hero = el('div', 'info-hero');
        addInfoCard(hero, '版本', info.version || '未知');
        addInfoCard(hero, '运行模式', (info.mode || 'standalone') + (info.role ? ' · ' + info.role : ''));
        addInfoCard(hero, '运行时长', fmtUptime(info.uptimeSeconds));
        addInfoCard(hero, '客户端', info.connectedClients || '—');
        addInfoCard(hero, '使用内存', info.usedMemoryHuman || '—');
        addInfoCard(hero, 'Ops / 秒', info.instantaneousOpsPerSec || '—');
        dom.tabServer.appendChild(hero);

        var kv = el('div', 'info-kv');
        addInfoRow(kv, '操作系统', info.os || '—');
        addInfoRow(kv, '架构位数', info.archBits || '—');
        addInfoRow(kv, '累计命令数', info.totalCommandsProcessed || '—');
        addInfoRow(kv, 'Keyspace 命中', info.keyspaceHits || '—');
        addInfoRow(kv, 'Keyspace 未命中', info.keyspaceMisses || '—');
        addInfoRow(kv, '最大内存', info.maxmemoryHuman || '—');
        addInfoRow(kv, '当前 DB 键数', state.dbSize);
        dom.tabServer.appendChild(kv);

        if (!state.databases.length) {
            dom.tabServer.appendChild(valueNote('服务器未返回数据库信息。'));
            return;
        }
        var max = 1;
        state.databases.forEach(function (db) {
            max = Math.max(max, Number(db.keys) || 0);
        });
        var usage = el('div', 'db-usage');
        state.databases.forEach(function (db) {
            var row = el('div', 'db-usage-item');
            row.appendChild(el('span', 'db-name', 'DB ' + db.index));
            var bar = el('span', 'db-bar');
            var fill = el('i');
            fill.style.width = Math.max(0, Math.min(100, ((Number(db.keys) || 0) / max) * 100)) + '%';
            bar.appendChild(fill);
            row.appendChild(bar);
            row.appendChild(el('span', 'db-count', String(db.keys == null ? 0 : db.keys)));
            usage.appendChild(row);
        });
        dom.tabServer.appendChild(usage);
    }

    function addInfoCard(parent, label, value) {
        var card = el('div', 'info-card');
        card.appendChild(el('span', null, label));
        var b = el('b', null, value);
        b.title = String(value);
        card.appendChild(b);
        parent.appendChild(card);
    }

    function addInfoRow(parent, label, value) {
        parent.appendChild(el('div', null, label));
        parent.appendChild(el('div', null, value));
    }

    async function refreshInfo() {
        if (!state.connected || !state.conn) {
            return;
        }
        try {
            var data = await api('POST', API_BASE + '/info', {
                connectionId: state.conn.connectionId
            });
            state.info = data.info || {};
            state.databases = data.databases || state.databases;
            state.db = Number(data.db) || state.db;
            state.dbSize = Number(data.dbSize) || 0;
            if (state.conn) {
                state.conn.version = data.version || state.conn.version;
            }
            renderDbList();
            renderServerInfo();
            updateStatus();
            toast('服务器信息已刷新', 'success');
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    /* ---------------- events ---------------- */

    function wireEvents() {
        dom.btnOpenConnect.addEventListener('click', openConnectModal);
        dom.btnOpenConnectSide.addEventListener('click', openConnectModal);
        dom.btnDisconnect.addEventListener('click', function () {
            confirmAction('断开连接', '断开后不会删除 Redis 中的数据。', '断开').then(function (ok) {
                if (ok) {
                    closeModal('confirmModal');
                    disconnect();
                }
            });
        });
        dom.connectForm.addEventListener('submit', function (e) {
            e.preventDefault();
            doConnect();
        });
        dom.renameForm.addEventListener('submit', submitRename);

        document.querySelectorAll('[data-close]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                closeModal(btn.getAttribute('data-close'));
            });
        });
        document.querySelectorAll('.modal').forEach(function (modal) {
            modal.addEventListener('mousedown', function (e) {
                if (e.target === modal) {
                    closeModal(modal.id);
                }
            });
        });
        dom.btnConfirmOk.addEventListener('click', function () {
            var resolve = state.confirmResolve;
            state.confirmResolve = null;
            closeModal('confirmModal');
            if (resolve) {
                resolve(true);
            }
        });

        dom.btnSearch.addEventListener('click', applySearch);
        dom.btnRefreshKeys.addEventListener('click', applySearch);
        dom.btnViewMode.addEventListener('click', function () {
            state.viewMode = state.viewMode === 'tree' ? 'flat' : 'tree';
            renderKeys();
        });
        dom.btnMoreKeys.addEventListener('click', function () {
            if (!state.keysLoading) {
                scan(false);
            }
        });
        dom.searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                applySearch();
            }
        });
        dom.searchInput.addEventListener('input', function () {
            if (state.searchTimer) {
                clearTimeout(state.searchTimer);
            }
            state.searchTimer = setTimeout(applySearch, 450);
        });

        dom.btnRefreshKey.addEventListener('click', function () {
            if (state.current) {
                selectKey(state.current.key, true);
            }
        });
        dom.btnRenameKey.addEventListener('click', openRename);
        dom.btnDeleteKey.addEventListener('click', deleteKey);
        dom.btnSaveTtl.addEventListener('click', function () {
            var ttl = parseInt(dom.ttlInput.value, 10);
            if (!ttl || ttl <= 0) {
                toast('请输入大于 0 的秒数', 'error');
                return;
            }
            saveTtl(ttl);
        });
        dom.btnPersistTtl.addEventListener('click', function () {
            saveTtl(-1);
        });

        dom.tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                showTab(tab.getAttribute('data-tab'));
            });
        });

        dom.btnRunCommand.addEventListener('click', runConsole);
        dom.consoleInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                runConsole();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!state.consoleHistory.length) {
                    return;
                }
                if (state.consoleIndex < 0 || state.consoleIndex >= state.consoleHistory.length) {
                    state.consoleIndex = state.consoleHistory.length - 1;
                } else if (state.consoleIndex > 0) {
                    state.consoleIndex--;
                }
                dom.consoleInput.value = state.consoleHistory[state.consoleIndex] || '';
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (state.consoleIndex >= 0 && state.consoleIndex < state.consoleHistory.length - 1) {
                    state.consoleIndex++;
                    dom.consoleInput.value = state.consoleHistory[state.consoleIndex] || '';
                } else {
                    state.consoleIndex = state.consoleHistory.length;
                    dom.consoleInput.value = '';
                }
            }
        });
        dom.btnClearConsole.addEventListener('click', function () {
            state.consoleLines = [];
            renderConsole();
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                ['connectModal', 'renameModal', 'confirmModal'].forEach(function (id) {
                    var node = document.getElementById(id);
                    if (node && !node.classList.contains('hidden')) {
                        closeModal(id);
                    }
                });
            }
        });
    }

    /* ---------------- boot ---------------- */

    function boot() {
        wireEvents();
        renderConnBox();
        renderDbList();
        renderTypeFilters();
        renderKeys();
        renderConsole();
        updateStatus();
    }

    boot();
})();
