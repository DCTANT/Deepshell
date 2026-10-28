(function () {
    'use strict';

    var state = {
        connected: false,
        connecting: false,
        conn: null,
        connName: '',
        profiles: [],
        editingProfileId: '',
        view: 'overview',
        overview: null,
        dbs: [],
        db: '',
        dbDetail: null,
        collections: [],
        collectionFilter: '',
        collection: '',
        collStats: null,
        indexes: [],
        tab: 'documents',
        docs: [],
        docsInfo: '',
        docsLoading: false,
        query: { filter: '{}', sort: '', projection: '', limit: 20, skip: 0, total: null },
        editing: { mode: 'edit', doc: null },
        confirmResolve: null,
        command: { db: 'admin', text: '{\n  "ping": 1\n}' }
    };

    var dom = {};
    var pending = {};
    var seq = 0;
    var toastTimer = null;

    var IDS = [
        'connBox', 'navOverview', 'navCommand', 'dbCount', 'dbList', 'collectionsSection',
        'collectionCount', 'collectionSearch', 'collectionList', 'collectionEmpty',
        'btnNewCollectionSide', 'btnDisconnect', 'welcome', 'btnOpenConnect', 'savedProfiles',
        'savedProfileList', 'workspace', 'viewTitle', 'viewSub', 'connPill', 'btnRefresh',
        'viewOverview', 'overviewStats', 'runtimeStats', 'databasesHint',
        'dbTable', 'viewDatabase', 'dbHeader', 'dbStats', 'dbCollectionsHint', 'dbCollections',
        'viewCollection', 'collectionName', 'collectionBadges', 'btnInsertDoc', 'btnCreateIndex',
        'btnDropCollection', 'tabDocuments', 'tabIndexes', 'tabStats', 'queryFilter', 'querySort',
        'queryProjection', 'queryLimit', 'btnRunQuery', 'btnCountDocs', 'docsInfo', 'btnPrevPage',
        'btnNextPage', 'docsTable', 'docsEmpty', 'indexTable', 'collectionStats', 'viewCommand',
        'commandDb', 'btnRunCommand', 'btnClearCommand', 'commandInput', 'commandOutput',
        'connectModal', 'connectTitle', 'fName', 'fHosts', 'fUser', 'fPassword', 'fAuthSource',
        'fMechanism', 'fTimeout', 'fTls', 'fSave', 'btnDeleteProfile', 'connectError', 'btnConnect',
        'docModal', 'docTitle', 'docBody', 'docError', 'btnDeleteDoc', 'btnSaveDoc',
        'newCollectionModal', 'newCollectionNote', 'newCollectionName', 'newCollectionError',
        'btnCreateCollection', 'indexModal', 'indexKeys', 'indexName', 'indexTtl', 'indexUnique',
        'indexSparse', 'indexError', 'btnSaveIndex', 'confirmModal', 'confirmTitle',
        'confirmMessage', 'btnConfirmOk', 'toast'
    ];

    /* ---------------- helpers ---------------- */

    function $(id) { return document.getElementById(id); }

    function el(tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) { node.className = cls; }
        if (text != null) { node.textContent = text; }
        return node;
    }

    function clear(node) {
        while (node && node.firstChild) { node.removeChild(node.firstChild); }
    }

    function show(node) { if (node) { node.classList.remove('hidden'); } }
    function hide(node) { if (node) { node.classList.add('hidden'); } }

    function errorText(err) {
        return err && err.message ? err.message : String(err || '请求失败');
    }

    function fmtBytes(n) {
        var v = Number(n) || 0;
        if (v < 1024) { return v + ' B'; }
        var units = ['KB', 'MB', 'GB', 'TB'];
        var i = -1;
        do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
        return v.toFixed(v >= 100 ? 0 : 1) + ' ' + units[i];
    }

    function fmtNumber(n) {
        var v = Number(n);
        if (!isFinite(v)) { return '—'; }
        return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function fmtDuration(seconds) {
        var s = Number(seconds) || 0;
        var d = Math.floor(s / 86400);
        var h = Math.floor((s % 86400) / 3600);
        var m = Math.floor((s % 3600) / 60);
        if (d > 0) { return d + ' 天 ' + h + ' 小时'; }
        if (h > 0) { return h + ' 小时 ' + m + ' 分'; }
        return m + ' 分钟';
    }

    function fmtTime(ms) {
        if (!ms) { return '—'; }
        var d = new Date(ms);
        var p = function (x) { return (x < 10 ? '0' : '') + x; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
            + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function toast(message, kind) {
        dom.toast.textContent = message;
        dom.toast.className = 'toast' + (kind ? ' ' + kind : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { hide(dom.toast); }, kind === 'error' ? 5200 : 2600);
    }

    function openModal(id) { show($(id)); }
    function closeModal(id) { hide($(id)); }

    function confirmBox(title, message, confirmText) {
        dom.confirmTitle.textContent = title || '确认';
        dom.confirmMessage.textContent = message || '';
        dom.btnConfirmOk.textContent = confirmText || '确认';
        openModal('confirmModal');
        return new Promise(function (resolve) {
            state.confirmResolve = resolve;
        });
    }

    function pretty(value) {
        try {
            return JSON.stringify(JSON.parse(value), null, 2);
        } catch (e) {
            return String(value == null ? '' : value);
        }
    }

    function compact(value, max) {
        var text = String(value == null ? '' : value);
        text = text.replace(/\s+/g, ' ');
        return text.length > (max || 300) ? text.substring(0, max || 300) + '…' : text;
    }

    function setView(view) {
        state.view = view;
        dom.navOverview.classList.toggle('active',
            view === 'overview' || view === 'database' || view === 'collection');
        dom.navCommand.classList.toggle('active', view === 'command');
        hide(dom.viewOverview);
        hide(dom.viewDatabase);
        hide(dom.viewCollection);
        hide(dom.viewCommand);
        if (view === 'overview') {
            show(dom.viewOverview);
            dom.viewTitle.textContent = '服务器概览';
            dom.viewSub.textContent = state.overview
                ? (state.overview.host ? state.overview.host + ' · ' : '') + 'MongoDB ' + (state.overview.version || '')
                : '';
        } else if (view === 'database') {
            show(dom.viewDatabase);
            dom.viewTitle.textContent = '数据库';
            dom.viewSub.textContent = state.db;
        } else if (view === 'collection') {
            show(dom.viewCollection);
            dom.viewTitle.textContent = '集合';
            dom.viewSub.textContent = state.db + '.' + state.collection;
        } else {
            show(dom.viewCommand);
            dom.viewTitle.textContent = '命令控制台';
            dom.viewSub.textContent = '按当前用户的权限执行数据库命令';
        }
    }

    /* ---------------- host bridge ---------------- */

    function api(action, payload) {
        return new Promise(function (resolve, reject) {
            if (window.parent === window) {
                reject(new Error('请从 DeepShell AI 可视化桌面打开此应用'));
                return;
            }
            var id = 'mq' + (++seq) + '-' + Date.now();
            var timer = setTimeout(function () {
                delete pending[id];
                reject(new Error('请求超时，请确认 MongoDB 服务可访问'));
            }, 60000);
            pending[id] = { resolve: resolve, reject: reject, timer: timer };
            try {
                window.parent.postMessage({
                    source: 'deepshell-plugin',
                    type: 'plugin.invoke',
                    requestId: id,
                    action: action,
                    payload: payload || null
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
        if (!msg || msg.source !== 'deepshell-host' || msg.type !== 'plugin.invoke.result') {
            return;
        }
        var item = pending[msg.requestId];
        if (!item) { return; }
        clearTimeout(item.timer);
        delete pending[msg.requestId];
        if (msg.ok) {
            item.resolve(msg.data);
        } else {
            item.reject(new Error(msg.error || '插件请求失败'));
        }
    });

    /* ---------------- connection ---------------- */

    function renderConnBox() {
        clear(dom.connBox);
        if (!state.connected) {
            dom.connBox.appendChild(el('div', 'conn-empty', '尚未连接 MongoDB'));
            return;
        }
        var box = el('div', 'conn-online');
        box.appendChild(el('span', 'online-dot'));
        var main = el('div', 'conn-main');
        main.appendChild(el('div', 'conn-host', state.connName || state.conn.servers));
        main.appendChild(el('div', 'conn-sub', 'MongoDB ' + (state.conn.version || '—')
            + ' · ' + (state.dbs.length ? state.dbs.length + ' 个数据库' : '已连接')));
        box.appendChild(main);
        dom.connBox.appendChild(box);
    }

    function updateConnectionUi() {
        dom.btnDisconnect.classList.toggle('hidden', !state.connected);
        dom.connPill.textContent = state.connected ? (state.dbs.length + ' 数据库') : '';
        dom.connPill.classList.toggle('hidden', !state.connected);
        dom.btnNewCollectionSide.classList.toggle('hidden', !state.connected || !state.db);
    }

    function resetConnectForm() {
        state.editingProfileId = '';
        dom.fName.value = '';
        dom.fHosts.value = '127.0.0.1:27017';
        dom.fUser.value = '';
        dom.fPassword.value = '';
        dom.fPassword.placeholder = '';
        dom.fAuthSource.value = 'admin';
        dom.fMechanism.value = 'SCRAM-SHA-256';
        dom.fTimeout.value = '8000';
        dom.fTls.checked = false;
        dom.fSave.checked = true;
        dom.connectTitle.textContent = '连接 MongoDB';
        hide(dom.btnDeleteProfile);
        hide(dom.connectError);
    }

    function openConnectModal(profile) {
        resetConnectForm();
        if (profile) {
            state.editingProfileId = profile.id;
            dom.fName.value = profile.name || '';
            dom.fHosts.value = profile.hosts || '';
            dom.fUser.value = profile.username || '';
            dom.fAuthSource.value = profile.authSource || 'admin';
            dom.fMechanism.value = profile.mechanism || 'SCRAM-SHA-256';
            dom.fTimeout.value = profile.timeoutMs || 8000;
            dom.fTls.checked = !!profile.tls;
            dom.fPassword.placeholder = profile.hasPassword ? '留空使用已保存的密码' : '';
            dom.connectTitle.textContent = '编辑连接';
            dom.btnDeleteProfile.classList.remove('hidden');
        }
        openModal('connectModal');
        setTimeout(function () { dom.fHosts.focus(); }, 30);
    }

    function connectPayload() {
        return {
            hosts: dom.fHosts.value.trim(),
            username: dom.fUser.value.trim(),
            password: dom.fPassword.value,
            authSource: dom.fAuthSource.value.trim(),
            mechanism: dom.fMechanism.value,
            tls: dom.fTls.checked,
            timeoutMs: Number(dom.fTimeout.value) || 8000
        };
    }

    async function performConnect(payload, name) {
        if (state.connecting) { return null; }
        state.connecting = true;
        dom.btnConnect.disabled = true;
        dom.btnConnect.textContent = '连接中…';
        hide(dom.connectError);
        try {
            var data = await api('connect', payload);
            await applyConnected(data, name);
            return data;
        } finally {
            state.connecting = false;
            dom.btnConnect.disabled = false;
            dom.btnConnect.textContent = '连接';
        }
    }

    async function applyConnected(data, name) {
        state.connected = true;
        state.conn = data;
        state.connName = (name || '').trim() || data.servers || '';
        state.dbs = [];
        state.db = '';
        state.dbDetail = null;
        state.collections = [];
        state.collection = '';
        state.overview = null;
        state.docs = [];
        closeModal('connectModal');
        hide(dom.welcome);
        show(dom.workspace);
        setView('overview');
        renderConnBox();
        renderDbs();
        updateConnectionUi();
        await loadOverview();
        toast('已连接 ' + state.connName, 'success');
    }

    async function loadProfiles() {
        try {
            var list = await api('profiles/list');
            state.profiles = Array.isArray(list) ? list : [];
        } catch (e) {
            state.profiles = [];
        }
        renderSavedProfiles();
    }

    function renderSavedProfiles() {
        clear(dom.savedProfileList);
        if (!state.profiles.length) {
            hide(dom.savedProfiles);
            return;
        }
        show(dom.savedProfiles);
        state.profiles.forEach(function (profile) {
            var row = el('button', 'saved-item');
            row.appendChild(el('b', null, profile.name || profile.hosts));
            row.appendChild(el('span', null, profile.hosts
                + (profile.username ? ' · ' + profile.username : '')
                + (profile.lastUsedAt ? ' · ' + fmtTime(profile.lastUsedAt) : '')));
            row.addEventListener('click', function () { connectSaved(profile); });
            dom.savedProfileList.appendChild(row);
        });
    }

    async function connectSaved(profile) {
        if (state.connecting) { return; }
        try {
            await performConnect({
                profileId: profile.id,
                hosts: profile.hosts,
                username: profile.username || '',
                password: '',
                authSource: profile.authSource || 'admin',
                mechanism: profile.mechanism || 'SCRAM-SHA-256',
                tls: !!profile.tls,
                timeoutMs: profile.timeoutMs || 8000
            }, profile.name);
            state.editingProfileId = profile.id;
            await loadProfiles();
        } catch (err) {
            toast(errorText(err), 'error');
            openConnectModal(profile);
            dom.connectError.textContent = errorText(err);
            show(dom.connectError);
        }
    }

    async function submitConnect() {
        var payload = connectPayload();
        if (!payload.hosts) {
            dom.connectError.textContent = '请填写 MongoDB 地址';
            show(dom.connectError);
            return;
        }
        hide(dom.connectError);
        try {
            if (dom.fSave.checked) {
                var saved = await api('profiles/save', {
                    id: state.editingProfileId,
                    name: dom.fName.value.trim(),
                    hosts: payload.hosts,
                    username: payload.username,
                    password: payload.password,
                    authSource: payload.authSource,
                    mechanism: payload.mechanism,
                    tls: payload.tls,
                    timeoutMs: payload.timeoutMs
                });
                state.editingProfileId = saved.id;
                payload.profileId = saved.id;
                await loadProfiles();
            }
            await performConnect(payload, dom.fName.value.trim());
            await loadProfiles();
        } catch (err) {
            dom.connectError.textContent = errorText(err);
            show(dom.connectError);
            toast(errorText(err), 'error');
        }
    }

    async function deleteProfile() {
        if (!state.editingProfileId) { return; }
        var ok = await confirmBox('删除连接', '删除保存的连接？密码会一并删除，当前连接不受影响。', '删除');
        if (!ok) { return; }
        try {
            await api('profiles/delete', { id: state.editingProfileId });
            state.editingProfileId = '';
            await loadProfiles();
            closeModal('connectModal');
            toast('保存的连接已删除', 'success');
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    async function disconnect() {
        var ok = await confirmBox('断开连接', '断开当前 MongoDB 连接？', '断开');
        if (!ok) { return; }
        var connId = state.conn ? state.conn.connectionId : '';
        state.connected = false;
        state.conn = null;
        state.connName = '';
        state.dbs = [];
        state.db = '';
        state.dbDetail = null;
        state.collections = [];
        state.collection = '';
        state.overview = null;
        state.docs = [];
        hide(dom.workspace);
        show(dom.welcome);
        renderConnBox();
        renderDbs();
        updateConnectionUi();
        if (connId) {
            try { await api('disconnect', { connectionId: connId }); } catch (e) { /* ignore */ }
        }
        toast('已断开连接', 'success');
    }

    /* ---------------- overview / databases ---------------- */

    async function loadOverview() {
        if (!state.connected) { return; }
        try {
            var data = await api('overview', { connectionId: state.conn.connectionId });
            state.overview = data;
            state.dbs = data.databases || [];
            if (state.conn) {
                state.conn.version = data.version;
            }
            renderOverview();
            renderDbs();
            renderConnBox();
            updateConnectionUi();
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    function renderOverview() {
        var data = state.overview;
        clear(dom.overviewStats);
        clear(dom.runtimeStats);
        clear(dom.dbTable);
        if (!data) { return; }
        var stats = [
            ['版本', data.version || '—', (data.storageEngines || []).slice(0, 3).join(' / ')
                || (data.bits ? data.bits + ' 位' : '')],
            ['运行时间', fmtDuration(data.uptime), data.host || '—'],
            ['当前连接', fmtNumber(data.connectionsCurrent), '可用 ' + fmtNumber(data.connectionsAvailable)],
            ['数据库', fmtNumber(data.databaseCount), '常驻内存 ' + fmtNumber(data.memResident) + ' MB']
        ];
        stats.forEach(function (item) {
            var card = el('div', 'stat-card');
            card.appendChild(el('span', null, item[0]));
            card.appendChild(el('b', null, item[1]));
            card.appendChild(el('em', null, item[2]));
            dom.overviewStats.appendChild(card);
        });

        var ops = data.opcounters || {};
        var net = data.network || {};
        [
            ['insert', fmtNumber(ops.insert), '写入'],
            ['query', fmtNumber(ops.query), '查询'],
            ['update', fmtNumber(ops.update), '更新'],
            ['delete', fmtNumber(ops.delete), '删除'],
            ['command', fmtNumber(ops.command), '命令'],
            ['网络流入', fmtBytes(net.bytesIn), '累计'],
            ['网络流出', fmtBytes(net.bytesOut), '累计'],
            ['请求数', fmtNumber(net.numRequests), '累计']
        ].forEach(function (item) {
            var card = el('div', 'mini-stat');
            card.appendChild(el('span', null, item[0]));
            card.appendChild(el('b', null, item[1]));
            card.appendChild(el('em', null, item[2]));
            dom.runtimeStats.appendChild(card);
        });

        var table = el('table');
        var thead = el('thead');
        var hr = el('tr');
        ['数据库', '大小', '状态'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = el('tbody');
        (data.databases || []).forEach(function (db) {
            var tr = el('tr', 'clickable');
            tr.appendChild(el('td', 'mono', db.name));
            tr.appendChild(el('td', 'num', db.empty ? '—' : fmtBytes(db.sizeOnDisk)));
            var stateCell = el('td');
            stateCell.appendChild(el('span', 'badge ' + (db.empty ? 'gray' : 'green'),
                db.empty ? '空' : '可用'));
            tr.appendChild(stateCell);
            tr.addEventListener('click', function () { selectDb(db.name); });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        dom.dbTable.appendChild(table);
        dom.databasesHint.textContent = (data.databases || []).length + ' 个数据库';
    }

    function renderDbs() {
        clear(dom.dbList);
        dom.dbCount.textContent = state.dbs.length ? String(state.dbs.length) : '';
        if (!state.dbs.length) {
            dom.dbList.appendChild(el('div', 'side-empty', state.connected ? '没有数据库' : ''));
        }
        state.dbs.forEach(function (db) {
            var item = el('button', 'db-item' + (state.db === db.name ? ' active' : ''));
            item.title = db.name;
            item.appendChild(el('span', 'db-name', db.name));
            item.appendChild(el('span', 'db-size', db.empty ? '' : fmtBytes(db.sizeOnDisk)));
            item.addEventListener('click', function () { selectDb(db.name); });
            dom.dbList.appendChild(item);
        });
    }

    async function selectDb(name) {
        if (!name) { return; }
        state.db = name;
        state.collection = '';
        state.dbDetail = null;
        state.collections = [];
        state.collectionFilter = '';
        dom.collectionSearch.value = '';
        show(dom.collectionsSection);
        dom.btnNewCollectionSide.classList.remove('hidden');
        renderDbs();
        setView('database');
        dom.dbHeader.textContent = '加载中…';
        try {
            var dbDetail = await api('database/describe', {
                connectionId: state.conn.connectionId,
                database: name
            });
            state.dbDetail = dbDetail;
            var cols = await api('collections/list', {
                connectionId: state.conn.connectionId,
                database: name
            });
            state.collections = Array.isArray(cols) ? cols : [];
            renderDatabase();
            renderCollections();
            updateConnectionUi();
        } catch (err) {
            toast(errorText(err), 'error');
            dom.dbHeader.textContent = errorText(err);
        }
    }

    function renderDatabase() {
        var detail = state.dbDetail;
        clear(dom.dbHeader);
        clear(dom.dbStats);
        clear(dom.dbCollections);
        hide(dom.collectionsSection);
        if (state.db) { show(dom.collectionsSection); }
        if (!detail) { return; }
        var main = el('div', 'db-header-main');
        main.appendChild(el('span', 'type-badge', 'DATABASE'));
        main.appendChild(el('h2', null, detail.name));
        dom.dbHeader.appendChild(main);
        var actions = el('div', 'db-header-actions');
        var newBtn = el('button', 'btn btn-ghost btn-sm', '新建集合');
        newBtn.addEventListener('click', function () { openNewCollection(detail.name); });
        var dropBtn = el('button', 'btn btn-ghost btn-sm danger-text', '删除数据库');
        dropBtn.addEventListener('click', function () { dropDatabase(detail.name); });
        actions.appendChild(newBtn);
        actions.appendChild(dropBtn);
        dom.dbHeader.appendChild(actions);
        dom.viewSub.textContent = detail.name + ' · ' + fmtNumber(detail.collectionsCount) + ' 个集合';

        [
            ['集合', fmtNumber(detail.collectionsCount)],
            ['文档', fmtNumber(detail.objects)],
            ['数据大小', fmtBytes(detail.dataSize)],
            ['存储大小', fmtBytes(detail.storageSize)],
            ['索引', fmtNumber(detail.indexes)]
        ].forEach(function (item) {
            var card = el('div', 'stat-card');
            card.appendChild(el('span', null, item[0]));
            card.appendChild(el('b', null, item[1]));
            dom.dbStats.appendChild(card);
        });
        dom.dbStats.style.gridTemplateColumns = 'repeat(5, minmax(0, 1fr))';

        var table = el('table');
        var thead = el('thead');
        var hr = el('tr');
        ['集合', '类型', '操作'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = el('tbody');
        (state.collections || []).forEach(function (item) {
            var tr = el('tr', 'clickable');
            tr.appendChild(el('td', 'mono', item.name));
            tr.appendChild(el('td', null, item.type || 'collection'));
            var action = el('td');
            action.appendChild(el('span', 'badge blue', '打开'));
            tr.appendChild(action);
            tr.addEventListener('click', function () { selectCollection(item.name); });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        dom.dbCollections.appendChild(table);
        dom.dbCollectionsHint.textContent = (state.collections || []).length + ' 个集合';
        if (!(state.collections || []).length) {
            dom.dbCollections.appendChild(el('div', 'table-empty', '这个数据库还没有集合'));
        }
    }

    function renderCollections() {
        clear(dom.collectionList);
        var filter = state.collectionFilter.toLowerCase();
        var list = state.collections.filter(function (c) {
            return !filter || c.name.toLowerCase().indexOf(filter) >= 0;
        });
        dom.collectionCount.textContent = state.collections.length ? String(state.collections.length) : '';
        list.forEach(function (c) {
            var item = el('button', 'collection-item' + (state.collection === c.name ? ' active' : ''));
            item.title = c.name;
            item.appendChild(el('span', null, c.name));
            if (c.type === 'view') { item.appendChild(el('em', null, 'VIEW')); }
            item.addEventListener('click', function () { selectCollection(c.name); });
            dom.collectionList.appendChild(item);
        });
        dom.collectionEmpty.classList.toggle('hidden', list.length > 0 || !state.collections.length);
        dom.collectionEmpty.textContent = state.collections.length ? '没有匹配的集合' : '';
    }

    /* ---------------- collection ---------------- */

    async function selectCollection(name) {
        if (!name) { return; }
        state.collection = name;
        state.tab = 'documents';
        state.docs = [];
        state.collStats = null;
        state.indexes = [];
        state.query = { filter: '{}', sort: '', projection: '', limit: state.query.limit, skip: 0, total: null };
        dom.queryFilter.value = '{}';
        dom.querySort.value = '';
        dom.queryProjection.value = '';
        dom.queryLimit.value = String(state.query.limit);
        dom.collectionName.textContent = name;
        renderCollections();
        switchTab('documents');
        setView('collection');
        clear(dom.collectionBadges);
        dom.collectionBadges.appendChild(el('span', 'badge blue', '加载中'));
        await Promise.all([loadCollectionStats(), loadDocs(true)]);
    }

    async function loadCollectionStats() {
        if (!state.collection) { return; }
        try {
            var stats = await api('collection/stats', {
                connectionId: state.conn.connectionId,
                database: state.db,
                collection: state.collection
            });
            state.collStats = stats;
            renderCollStats();
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    function renderCollStats() {
        var stats = state.collStats;
        if (!stats) { return; }
        dom.collectionName.textContent = state.collection;
        clear(dom.collectionBadges);
        dom.collectionBadges.appendChild(el('span', 'badge blue', fmtNumber(stats.count) + ' 文档'));
        dom.collectionBadges.appendChild(el('span', 'badge green', fmtBytes(stats.size)));
        if (stats.nindexes) {
            dom.collectionBadges.appendChild(el('span', 'badge gray', stats.nindexes + ' 索引'));
        }
        if (stats.capped) {
            dom.collectionBadges.appendChild(el('span', 'badge yellow', 'Capped'));
        }
        dom.viewSub.textContent = state.db + '.' + state.collection;

        clear(dom.collectionStats);
        var list = el('div', 'stat-list');
        [
            ['命名空间', stats.ns || (state.db + '.' + state.collection)],
            ['文档数', fmtNumber(stats.count)],
            ['数据大小', fmtBytes(stats.size)],
            ['存储大小', fmtBytes(stats.storageSize)],
            ['平均对象大小', fmtBytes(stats.avgObjSize)],
            ['索引数', fmtNumber(stats.nindexes)],
            ['索引大小', fmtBytes(stats.totalIndexSize)],
            ['Capped', stats.capped ? '是' : '否']
        ].forEach(function (item) {
            var cell = el('div');
            cell.appendChild(el('span', null, item[0]));
            cell.appendChild(el('b', null, item[1]));
            list.appendChild(cell);
        });
        dom.collectionStats.appendChild(list);
        var wrap = el('div', 'card full');
        var head = el('div', 'card-head');
        head.appendChild(el('b', null, 'collStats 原始输出'));
        wrap.appendChild(head);
        var pre = el('pre', 'code-block');
        pre.style.maxHeight = '360px';
        pre.textContent = pretty(stats.json || '{}');
        wrap.appendChild(pre);
        dom.collectionStats.appendChild(wrap);
    }

    /* ---------------- documents ---------------- */

    async function loadDocs(reset) {
        if (!state.collection || state.docsLoading) { return; }
        state.docsLoading = true;
        dom.btnRunQuery.disabled = true;
        dom.btnRunQuery.textContent = '查询中…';
        if (reset) { state.query.skip = 0; }
        try {
            var data = await api('docs/find', {
                connectionId: state.conn.connectionId,
                database: state.db,
                collection: state.collection,
                filter: dom.queryFilter.value,
                sort: dom.querySort.value,
                projection: dom.queryProjection.value,
                skip: state.query.skip,
                limit: state.query.limit
            });
            state.docs = data.documents || [];
            var end = state.query.skip + state.docs.length;
            state.docsInfo = state.docs.length
                ? '第 ' + (state.query.skip + 1) + ' - ' + end + ' 条 · 用时 ' + data.elapsedMs + ' ms'
                : '没有记录 · 用时 ' + data.elapsedMs + ' ms';
            if (state.query.total != null) {
                state.docsInfo += ' · 共 ' + fmtNumber(state.query.total) + ' 条';
            }
            renderDocs();
        } catch (err) {
            toast(errorText(err), 'error');
            state.docs = [];
            state.docsInfo = '';
            renderDocs();
        } finally {
            state.docsLoading = false;
            dom.btnRunQuery.disabled = false;
            dom.btnRunQuery.textContent = '查询';
        }
    }

    function renderDocs() {
        clear(dom.docsTable);
        dom.docsInfo.textContent = state.docsInfo;
        dom.docsEmpty.classList.toggle('hidden', state.docs.length > 0);
        dom.btnPrevPage.disabled = state.query.skip <= 0;
        dom.btnNextPage.disabled = state.docs.length < state.query.limit;
        if (!state.docs.length) { return; }
        var table = el('table');
        var thead = el('thead');
        var hr = el('tr');
        ['#', '_id', '文档', ''].forEach(function (h) { hr.appendChild(el('th', null, h)); });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = el('tbody');
        state.docs.forEach(function (json, index) {
            var doc;
            try { doc = JSON.parse(json); } catch (e) { doc = null; }
            var tr = el('tr');
            tr.appendChild(el('td', 'num', String(state.query.skip + index + 1)));
            tr.appendChild(el('td', 'doc-id', doc && doc._id != null ? compact(JSON.stringify(doc._id), 120) : '—'));
            var previewCell = el('td', 'doc-preview', compact(json, 420));
            previewCell.title = json;
            tr.appendChild(previewCell);
            var actions = el('td', 'doc-actions');
            var editBtn = el('button', 'btn btn-ghost btn-xs', '编辑');
            editBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                openDocModal('edit', doc);
            });
            var delBtn = el('button', 'btn btn-ghost btn-xs danger-text', '删除');
            delBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                deleteDoc(doc);
            });
            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            tr.appendChild(actions);
            tr.addEventListener('click', function () { openDocModal('edit', doc); });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        dom.docsTable.appendChild(table);
    }

    async function countDocs() {
        if (!state.collection) { return; }
        try {
            var data = await api('docs/count', {
                connectionId: state.conn.connectionId,
                database: state.db,
                collection: state.collection,
                filter: dom.queryFilter.value,
                estimated: false
            });
            state.query.total = data.count;
            renderDocs();
            toast('匹配 ' + fmtNumber(data.count) + ' 条文档', 'success');
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    function openDocModal(mode, doc) {
        state.editing.mode = mode;
        state.editing.doc = doc || null;
        dom.docTitle.textContent = mode === 'insert' ? '插入文档' : '编辑文档';
        dom.btnDeleteDoc.classList.toggle('hidden', mode !== 'edit');
        dom.docBody.value = mode === 'insert'
            ? '{\n  "name": "示例"\n}'
            : JSON.stringify(doc, null, 2);
        hide(dom.docError);
        openModal('docModal');
        setTimeout(function () {
            dom.docBody.focus();
            dom.docBody.setSelectionRange(0, 0);
            dom.docBody.scrollTop = 0;
        }, 30);
    }

    async function saveDoc() {
        var text = dom.docBody.value;
        var doc;
        try {
            doc = JSON.parse(text);
        } catch (e) {
            dom.docError.textContent = 'JSON 格式不正确：' + e.message;
            show(dom.docError);
            return;
        }
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
            dom.docError.textContent = '文档必须是一个 JSON 对象';
            show(dom.docError);
            return;
        }
        hide(dom.docError);
        dom.btnSaveDoc.disabled = true;
        dom.btnSaveDoc.textContent = '保存中…';
        try {
            if (state.editing.mode === 'insert') {
                var result = await api('docs/insert', {
                    connectionId: state.conn.connectionId,
                    database: state.db,
                    collection: state.collection,
                    document: text
                });
                toast('已插入文档 ' + (result.insertedId || ''), 'success');
            } else {
                var original = state.editing.doc;
                if (!original || original._id == null) {
                    throw new Error('原文档缺少 _id，无法定位更新目标');
                }
                var replacement = JSON.parse(JSON.stringify(doc));
                delete replacement._id;
                var updated = await api('docs/replace', {
                    connectionId: state.conn.connectionId,
                    database: state.db,
                    collection: state.collection,
                    filter: JSON.stringify({ _id: original._id }),
                    document: JSON.stringify(replacement),
                    confirm: false
                });
                toast('已保存，匹配 ' + updated.matched + ' 条，修改 ' + updated.modified + ' 条', 'success');
            }
            closeModal('docModal');
            state.query.total = null;
            await Promise.all([loadDocs(false), loadCollectionStats()]);
        } catch (err) {
            dom.docError.textContent = errorText(err);
            show(dom.docError);
            toast(errorText(err), 'error');
        } finally {
            dom.btnSaveDoc.disabled = false;
            dom.btnSaveDoc.textContent = '保存';
        }
    }

    async function deleteDoc(doc) {
        if (!doc || doc._id == null) { return; }
        var ok = await confirmBox('删除文档', '删除选中的文档？此操作不可撤销。', '删除');
        if (!ok) { return; }
        try {
            await api('docs/delete', {
                connectionId: state.conn.connectionId,
                database: state.db,
                collection: state.collection,
                filter: JSON.stringify({ _id: doc._id }),
                multi: false,
                confirm: false
            });
            toast('文档已删除', 'success');
            state.query.total = null;
            await Promise.all([loadDocs(false), loadCollectionStats()]);
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    /* ---------------- indexes ---------------- */

    async function loadIndexes() {
        if (!state.collection) { return; }
        try {
            var list = await api('indexes/list', {
                connectionId: state.conn.connectionId,
                database: state.db,
                collection: state.collection
            });
            state.indexes = Array.isArray(list) ? list : [];
            renderIndexes();
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    function renderIndexes() {
        clear(dom.indexTable);
        if (!state.indexes.length) {
            dom.indexTable.appendChild(el('div', 'table-empty', '没有索引信息'));
            return;
        }
        var table = el('table');
        var thead = el('thead');
        var hr = el('tr');
        ['索引名称', '字段', '唯一', '稀疏', 'TTL', ''].forEach(function (h) {
            hr.appendChild(el('th', null, h));
        });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = el('tbody');
        state.indexes.forEach(function (index) {
            var tr = el('tr');
            tr.appendChild(el('td', 'mono', index.name));
            tr.appendChild(el('td', 'mono', compact(index.keys, 120)));
            tr.appendChild(el('td', null, index.unique ? '是' : '—'));
            tr.appendChild(el('td', null, index.sparse ? '是' : '—'));
            tr.appendChild(el('td', null, index.ttl > 0 ? index.ttl + ' 秒' : '—'));
            var action = el('td', 'doc-actions');
            if (index.name !== '_id_') {
                var del = el('button', 'btn btn-ghost btn-xs danger-text', '删除');
                del.addEventListener('click', function () { dropIndex(index.name); });
                action.appendChild(del);
            }
            tr.appendChild(action);
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        dom.indexTable.appendChild(table);
    }

    function openIndexModal() {
        dom.indexKeys.value = '{"field": 1}';
        dom.indexName.value = '';
        dom.indexTtl.value = '';
        dom.indexUnique.checked = false;
        dom.indexSparse.checked = false;
        hide(dom.indexError);
        openModal('indexModal');
        setTimeout(function () { dom.indexKeys.focus(); }, 30);
    }

    async function saveIndex() {
        hide(dom.indexError);
        dom.btnSaveIndex.disabled = true;
        try {
            await api('indexes/create', {
                connectionId: state.conn.connectionId,
                database: state.db,
                collection: state.collection,
                keys: dom.indexKeys.value,
                name: dom.indexName.value.trim(),
                unique: dom.indexUnique.checked,
                sparse: dom.indexSparse.checked,
                ttl: Number(dom.indexTtl.value) || -1
            });
            closeModal('indexModal');
            toast('索引已创建', 'success');
            await loadIndexes();
        } catch (err) {
            dom.indexError.textContent = errorText(err);
            show(dom.indexError);
        } finally {
            dom.btnSaveIndex.disabled = false;
        }
    }

    async function dropIndex(name) {
        var ok = await confirmBox('删除索引', '删除索引「' + name + '」？删除后相关查询可能变慢。', '删除');
        if (!ok) { return; }
        try {
            await api('indexes/drop', {
                connectionId: state.conn.connectionId,
                database: state.db,
                collection: state.collection,
                name: name
            });
            toast('索引已删除', 'success');
            await loadIndexes();
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    /* ---------------- collections / databases actions ---------------- */

    function openNewCollection(database) {
        var target = database || state.db;
        if (!target) { return; }
        dom.newCollectionNote.textContent = '在数据库「' + target + '」中创建集合。';
        dom.newCollectionName.value = '';
        hide(dom.newCollectionError);
        openModal('newCollectionModal');
        setTimeout(function () { dom.newCollectionName.focus(); }, 30);
    }

    async function createCollection() {
        var name = dom.newCollectionName.value.trim();
        if (!name) {
            dom.newCollectionError.textContent = '请填写集合名称';
            show(dom.newCollectionError);
            return;
        }
        hide(dom.newCollectionError);
        dom.btnCreateCollection.disabled = true;
        try {
            await api('collection/create', {
                connectionId: state.conn.connectionId,
                database: state.db,
                collection: name
            });
            closeModal('newCollectionModal');
            toast('集合已创建：' + name, 'success');
            await selectDb(state.db);
            await selectCollection(name);
        } catch (err) {
            dom.newCollectionError.textContent = errorText(err);
            show(dom.newCollectionError);
        } finally {
            dom.btnCreateCollection.disabled = false;
        }
    }

    async function dropCollection() {
        if (!state.collection) { return; }
        var ok = await confirmBox('删除集合',
            '删除集合「' + state.db + '.' + state.collection + '」及其全部文档和索引？此操作不可撤销。',
            '删除');
        if (!ok) { return; }
        try {
            await api('collection/drop', {
                connectionId: state.conn.connectionId,
                database: state.db,
                collection: state.collection,
                confirm: true
            });
            var name = state.collection;
            state.collection = '';
            state.docs = [];
            toast('集合已删除：' + name, 'success');
            await selectDb(state.db);
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    async function dropDatabase(database) {
        var ok = await confirmBox('删除数据库',
            '删除数据库「' + database + '」及其全部集合？此操作不可撤销。', '删除数据库');
        if (!ok) { return; }
        try {
            await api('database/drop', {
                connectionId: state.conn.connectionId,
                database: database,
                confirm: true
            });
            state.db = '';
            state.dbDetail = null;
            state.collections = [];
            state.collection = '';
            hide(dom.collectionsSection);
            renderDbs();
            setView('overview');
            toast('数据库已删除：' + database, 'success');
            await loadOverview();
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    /* ---------------- command ---------------- */

    function renderCommandDbs() {
        var current = state.command.db;
        clear(dom.commandDb);
        var names = ['admin'];
        state.dbs.forEach(function (db) {
            if (names.indexOf(db.name) < 0) { names.push(db.name); }
        });
        names.forEach(function (name) {
            var option = el('option', null, name);
            option.value = name;
            dom.commandDb.appendChild(option);
        });
        if (names.indexOf(current) < 0) { current = 'admin'; }
        state.command.db = current;
        dom.commandDb.value = current;
    }

    async function runCommand() {
        if (!state.connected) { return; }
        state.command.text = dom.commandInput.value;
        dom.btnRunCommand.disabled = true;
        dom.btnRunCommand.textContent = '执行中…';
        dom.commandOutput.textContent = '执行中…';
        try {
            var result = await api('command', {
                connectionId: state.conn.connectionId,
                database: dom.commandDb.value || 'admin',
                command: dom.commandInput.value
            });
            dom.commandOutput.textContent = pretty(result);
        } catch (err) {
            dom.commandOutput.textContent = '执行失败：' + errorText(err);
            toast(errorText(err), 'error');
        } finally {
            dom.btnRunCommand.disabled = false;
            dom.btnRunCommand.textContent = '执行命令';
        }
    }

    /* ---------------- tabs / refresh ---------------- */

    function switchTab(tab) {
        state.tab = tab;
        var tabs = document.querySelectorAll('.tabs .tab');
        Array.prototype.forEach.call(tabs, function (node) {
            node.classList.toggle('active', node.getAttribute('data-tab') === tab);
        });
        hide(dom.tabDocuments);
        hide(dom.tabIndexes);
        hide(dom.tabStats);
        if (tab === 'documents') { show(dom.tabDocuments); }
        if (tab === 'indexes') {
            show(dom.tabIndexes);
            loadIndexes();
        }
        if (tab === 'stats') { show(dom.tabStats); }
    }

    async function refresh() {
        if (!state.connected) { return; }
        if (state.view === 'overview') {
            await loadOverview();
            toast('已刷新', 'success');
            return;
        }
        if (state.view === 'command') {
            await loadOverview();
            renderCommandDbs();
            toast('已刷新', 'success');
            return;
        }
        if (state.view === 'database') {
            await selectDb(state.db);
            toast('已刷新', 'success');
            return;
        }
        if (state.collection) {
            await Promise.all([loadCollectionStats(), loadDocs(false)]);
            if (state.tab === 'indexes') { await loadIndexes(); }
            toast('已刷新', 'success');
        }
    }

    /* ---------------- init ---------------- */

    function bind() {
        IDS.forEach(function (id) { dom[id] = $(id); });

        dom.btnOpenConnect.addEventListener('click', function () { openConnectModal(null); });
        dom.btnConnect.addEventListener('click', submitConnect);
        dom.btnDeleteProfile.addEventListener('click', deleteProfile);
        dom.btnDisconnect.addEventListener('click', disconnect);
        dom.btnNewCollectionSide.addEventListener('click', function () { openNewCollection(state.db); });
        dom.fPassword.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { submitConnect(); }
        });
        dom.fHosts.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { submitConnect(); }
        });

        dom.navOverview.addEventListener('click', function () {
            setView('overview');
            if (state.connected) { loadOverview(); }
        });
        dom.navCommand.addEventListener('click', function () {
            if (!state.connected) { return; }
            state.command.db = state.command.db || 'admin';
            renderCommandDbs();
            setView('command');
        });
        dom.btnRefresh.addEventListener('click', refresh);

        dom.collectionSearch.addEventListener('input', function () {
            state.collectionFilter = dom.collectionSearch.value.trim();
            renderCollections();
        });

        dom.tabQuery = null;
        Array.prototype.forEach.call(document.querySelectorAll('.tabs .tab'), function (tab) {
            tab.addEventListener('click', function () {
                var name = tab.getAttribute('data-tab');
                if (!state.collection) { return; }
                switchTab(name);
            });
        });

        dom.btnRunQuery.addEventListener('click', function () {
            state.query.total = null;
            loadDocs(true);
        });
        dom.btnCountDocs.addEventListener('click', countDocs);
        dom.queryFilter.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { loadDocs(true); }
        });
        dom.queryLimit.addEventListener('change', function () {
            state.query.limit = Number(dom.queryLimit.value) || 20;
            loadDocs(true);
        });
        dom.btnPrevPage.addEventListener('click', function () {
            state.query.skip = Math.max(0, state.query.skip - state.query.limit);
            loadDocs(false);
        });
        dom.btnNextPage.addEventListener('click', function () {
            state.query.skip += state.query.limit;
            loadDocs(false);
        });

        dom.btnInsertDoc.addEventListener('click', function () { openDocModal('insert', null); });
        dom.btnSaveDoc.addEventListener('click', saveDoc);
        dom.btnDeleteDoc.addEventListener('click', function () {
            if (state.editing.doc) {
                closeModal('docModal');
                deleteDoc(state.editing.doc);
            }
        });

        dom.btnCreateIndex.addEventListener('click', openIndexModal);
        dom.btnSaveIndex.addEventListener('click', saveIndex);
        dom.btnDropCollection.addEventListener('click', dropCollection);
        dom.btnCreateCollection.addEventListener('click', createCollection);

        dom.btnRunCommand.addEventListener('click', runCommand);
        dom.btnClearCommand.addEventListener('click', function () {
            dom.commandOutput.textContent = '';
        });
        dom.commandDb.addEventListener('change', function () {
            state.command.db = dom.commandDb.value;
        });
        dom.commandInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { runCommand(); }
        });

        dom.btnConfirmOk.addEventListener('click', function () {
            var resolve = state.confirmResolve;
            state.confirmResolve = null;
            closeModal('confirmModal');
            if (resolve) { resolve(true); }
        });

        Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (node) {
            node.addEventListener('click', function () {
                var id = node.getAttribute('data-close');
                if (id === 'confirmModal' && state.confirmResolve) {
                    var resolve = state.confirmResolve;
                    state.confirmResolve = null;
                    resolve(false);
                }
                closeModal(id);
            });
        });

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') { return; }
            ['connectModal', 'docModal', 'newCollectionModal', 'indexModal']
                .forEach(function (id) { hide($(id)); });
            if (state.confirmResolve) {
                var resolve = state.confirmResolve;
                state.confirmResolve = null;
                resolve(false);
            }
            hide(dom.confirmModal);
        });
    }

    function init() {
        bind();
        renderDbs();
        renderConnBox();
        updateConnectionUi();
        loadProfiles();
    }

    init();
})();
