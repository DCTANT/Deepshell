(function () {
    'use strict';

    var AUTH_LABELS = { none: '无认证', basic: '用户名 / 密码', apiKey: 'API Key' };
    var HEALTH_LABELS = { green: '健康', yellow: '副本未分配', red: '异常' };
    var ROLE_LABELS = {
        c: '协调', d: '数据', f: '冻结', h: '热', i: '摄取', l: '机器学习',
        m: '主节点', r: '远程', s: '内容', t: '转换', v: '投票', w: '温'
    };

    var state = {
        connected: false,
        connecting: false,
        conn: null,
        profiles: [],
        editingProfileId: '',
        indices: [],
        indexFilter: '',
        selectedIndex: '',
        tab: 'overview',
        overview: null,
        overviewLoading: false,
        docs: {
            index: '', query: '', from: 0, size: 20, total: 0, relation: 'eq',
            hits: [], loading: false, error: '', took: 0, reqId: 0, loaded: false
        },
        detail: { index: '', data: null, loading: false, error: '', reqId: 0 },
        console: { method: 'GET', path: '/_cluster/health?pretty', body: '', running: false },
        docModal: { mode: 'create', id: '', deleteVisible: false },
        confirmResolve: null,
        lastTook: 0
    };

    var dom = {};
    var pending = {};
    var seq = 0;
    var toastTimer = null;

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
    function setHidden(node, hidden) {
        if (!node) { return; }
        if (hidden) { node.classList.add('hidden'); } else { node.classList.remove('hidden'); }
    }
    function show(node) { setHidden(node, false); }
    function hide(node) { setHidden(node, true); }
    function errorText(err) { return err && err.message ? err.message : String(err || '请求失败'); }
    function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
    function pretty(v) {
        try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
    }
    function fmtBytes(n) {
        var v = Number(n) || 0;
        if (v < 1024) { return v + ' B'; }
        var units = ['KB', 'MB', 'GB', 'TB', 'PB'];
        var i = -1;
        do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
        return v.toFixed(v >= 100 ? 0 : 1) + ' ' + units[i];
    }
    function fmtNumber(n) {
        var v = Number(n);
        if (!isFinite(v)) { return '—'; }
        var s = String(Math.round(v));
        return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    function fmtTime(ms) {
        if (!ms) { return '—'; }
        var d = new Date(ms);
        var p = function (x) { return (x < 10 ? '0' : '') + x; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
            + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function healthClass(status) {
        return status === 'green' || status === 'yellow' || status === 'red' ? status : '';
    }
    function healthLabel(status) { return HEALTH_LABELS[status] || (status || '未知'); }
    function roleLabel(role) {
        var r = String(role || '');
        if (!r) { return '—'; }
        if (r === 'cdfhilmrstw' || r.length >= 9) { return '全角色'; }
        var out = [];
        for (var i = 0; i < r.length; i++) {
            if (ROLE_LABELS[r.charAt(i)]) { out.push(ROLE_LABELS[r.charAt(i)]); }
        }
        return out.length ? out.join(' / ') : r;
    }
    function numClass(v, warn, bad) {
        var n = Number(v);
        if (!isFinite(n)) { return ''; }
        if (n >= bad) { return 'bad'; }
        if (n >= warn) { return 'warn'; }
        return '';
    }

    function toast(message, type) {
        var node = dom.toast;
        if (!node) { return; }
        node.textContent = message || '';
        node.className = 'toast ' + (type || '');
        node.classList.remove('hidden');
        if (toastTimer) { clearTimeout(toastTimer); }
        toastTimer = setTimeout(function () {
            node.classList.add('hidden');
        }, type === 'error' ? 4600 : 2600);
    }

    function openModal(id) {
        var node = $(id);
        if (node) { node.classList.remove('hidden'); }
    }
    function closeModal(id) {
        var node = $(id);
        if (!node) { return; }
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

    function api(action, payload) {
        return new Promise(function (resolve, reject) {
            if (window.parent === window) {
                reject(new Error('请从 DeepShell AI 可视化桌面打开此应用'));
                return;
            }
            var id = 'rq' + (++seq) + '-' + Date.now();
            var timer = setTimeout(function () {
                delete pending[id];
                reject(new Error('请求超时，请确认 DeepShell 主界面正常'));
            }, 70000);
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

    /* ---------------- connection / profiles ---------------- */

    function loadProfiles() {
        return api('profiles/list').then(function (list) {
            state.profiles = Array.isArray(list) ? list : [];
            renderSavedProfiles();
            renderSavedPicker();
        }).catch(function () {
            state.profiles = [];
            renderSavedProfiles();
            renderSavedPicker();
        });
    }

    function renderSavedProfiles() {
        var list = dom.savedProfileList;
        clear(list);
        setHidden(dom.savedProfiles, state.profiles.length === 0);
        state.profiles.forEach(function (profile) {
            var item = el('div', 'saved-item');
            var main = el('button', 'saved-main');
            main.type = 'button';
            main.appendChild(el('span', 'saved-name', profile.name || profile.url));
            main.appendChild(el('span', 'saved-addr', profile.url || ''));
            main.appendChild(el('span', 'saved-badge', AUTH_LABELS[profile.authType] || '无认证'));
            main.addEventListener('click', function () { connectProfile(profile); });

            var del = el('button', 'saved-op', '删除');
            del.type = 'button';
            del.title = '删除保存的连接';
            del.addEventListener('click', function (ev) {
                ev.stopPropagation();
                confirmAction('删除连接', '确定删除保存的连接「' + (profile.name || profile.url) + '」？', '删除')
                    .then(function (ok) {
                        if (!ok) { return false; }
                        return api('profiles/delete', { id: profile.id }).then(function () { return true; });
                    })
                    .then(function (deleted) {
                        if (!deleted) { return null; }
                        return loadProfiles().then(function () {
                            toast('已删除保存的连接');
                        });
                    })
                    .catch(function (err) { toast(errorText(err), 'error'); });
            });
            item.appendChild(main);
            item.appendChild(del);
            list.appendChild(item);
        });
    }

    function renderSavedPicker() {
        var select = dom.fSaved;
        if (!select) { return; }
        clear(select);
        var opt = el('option', '', '新建连接（手动填写）');
        opt.value = '';
        select.appendChild(opt);
        state.profiles.forEach(function (profile) {
            var o = el('option', '', (profile.name || profile.url) + '  ·  ' + profile.url);
            o.value = profile.id;
            select.appendChild(o);
        });
        setHidden(dom.savedPickerWrap, state.profiles.length === 0);
        select.value = state.editingProfileId || '';
    }

    function fillConnectForm(profile) {
        state.editingProfileId = profile ? profile.id : '';
        dom.fSaved.value = profile ? profile.id : '';
        dom.fName.value = profile ? (profile.name || '') : '';
        dom.fUrl.value = profile ? (profile.url || '') : 'http://127.0.0.1:9200';
        dom.fAuthType.value = profile ? (profile.authType || 'none') : 'none';
        dom.fUsername.value = profile ? (profile.username || '') : '';
        dom.fSecret.value = '';
        dom.fTimeout.value = String(profile ? (profile.timeoutMs || 15000) : 15000);
        dom.fSkipTls.checked = !!(profile && profile.skipTls);
        dom.fSave.checked = true;
        hide(dom.connectError);
        updateAuthFields();
    }

    function updateAuthFields() {
        var type = dom.fAuthType.value;
        setHidden(dom.userField, type !== 'basic');
        setHidden(dom.secretField, type === 'none');
        if (type === 'basic') {
            dom.secretLabel.textContent = '密码';
            dom.fSecret.placeholder = '留空使用已保存凭据';
            dom.fSecret.type = 'password';
        } else if (type === 'apiKey') {
            dom.secretLabel.textContent = 'API Key';
            dom.fSecret.placeholder = 'Base64 API Key，留空使用已保存凭据';
            dom.fSecret.type = 'password';
        }
    }

    function openConnectDialog(profile) {
        fillConnectForm(profile || null);
        openModal('connectModal');
        setTimeout(function () { dom.fUrl.focus(); }, 30);
    }

    function connect(profileId, overrides) {
        var payload = overrides || {};
        if (profileId) { payload.profileId = profileId; }
        state.connecting = true;
        dom.btnConnect.disabled = true;
        dom.btnConnect.textContent = '连接中…';
        hide(dom.connectError);
        return api('connect', payload).then(function (result) {
            state.connecting = false;
            dom.btnConnect.disabled = false;
            dom.btnConnect.textContent = '连接';
            var previous = state.conn && state.conn.connectionId;
            state.conn = result || {};
            state.connected = true;
            state.editingProfileId = result && result.profileId ? result.profileId : '';
            if (previous && previous !== state.conn.connectionId) {
                api('disconnect', { connectionId: previous }).catch(function () { /* 忽略 */ });
            }
            closeModal('connectModal');
            enterWorkspace();
            return true;
        }).catch(function (err) {
            state.connecting = false;
            dom.btnConnect.disabled = false;
            dom.btnConnect.textContent = '连接';
            var msg = errorText(err);
            dom.connectError.textContent = msg;
            show(dom.connectError);
            return false;
        });
    }

    function connectProfile(profile) {
        if (!profile || state.connecting) { return; }
        connect(profile.id, {});
    }

    function submitConnect() {
        if (state.connecting) { return; }
        var url = dom.fUrl.value.trim();
        if (!url) {
            dom.connectError.textContent = '请填写 Elasticsearch 地址';
            show(dom.connectError);
            dom.fUrl.focus();
            return;
        }
        var authType = dom.fAuthType.value;
        var username = dom.fUsername.value.trim();
        if (authType === 'basic' && !username) {
            dom.connectError.textContent = '基础认证需要填写用户名';
            show(dom.connectError);
            dom.fUsername.focus();
            return;
        }
        if (authType === 'apiKey' && !dom.fSecret.value.trim() && !state.editingProfileId) {
            dom.connectError.textContent = 'API Key 认证需要填写 API Key';
            show(dom.connectError);
            dom.fSecret.focus();
            return;
        }
        var overrides = {
            profileId: state.editingProfileId || '',
            url: url,
            username: username,
            authType: authType,
            secret: dom.fSecret.value,
            skipTls: dom.fSkipTls.checked,
            timeoutMs: parseInt(dom.fTimeout.value, 10) || 15000
        };
        connect(state.editingProfileId || '', overrides).then(function (ok) {
            if (!ok) { return; }
            if (dom.fSave.checked) {
                saveProfileAfterConnect(overrides);
            }
        });
    }

    function saveProfileAfterConnect(fields) {
        var payload = {
            id: state.editingProfileId || '',
            name: dom.fName.value.trim(),
            url: fields.url,
            username: fields.username,
            authType: fields.authType,
            secret: fields.secret,
            skipTls: fields.skipTls,
            timeoutMs: fields.timeoutMs
        };
        api('profiles/save', payload).then(function (profile) {
            if (profile && profile.id) {
                state.editingProfileId = profile.id;
            }
            return loadProfiles().then(function () {
                updateConnBox();
                toast('连接信息已保存', 'success');
            });
        }).catch(function (err) {
            toast('已连接，但保存连接失败：' + errorText(err), 'error');
        });
    }

    function disconnect() {
        if (!state.conn || !state.conn.connectionId) {
            resetToWelcome();
            return;
        }
        var id = state.conn.connectionId;
        confirmAction('断开连接', '确定断开当前 Elasticsearch 连接？未保存的查询条件会丢失。', '断开')
            .then(function (ok) {
                if (!ok) { return null; }
                return api('disconnect', { connectionId: id }).catch(function () { /* 忽略 */ })
                    .then(function () { resetToWelcome(); });
            });
    }

    function resetToWelcome() {
        state.connected = false;
        state.conn = null;
        state.editingProfileId = '';
        state.overview = null;
        state.indices = [];
        state.selectedIndex = '';
        state.indexFilter = '';
        if (dom.indexFilter) { dom.indexFilter.value = ''; }
        if (dom.indexTotal) { dom.indexTotal.textContent = ''; }
        state.docs = { index: '', query: '', from: 0, size: 20, total: 0, relation: 'eq', hits: [], loading: false, error: '', took: 0, reqId: (state.docs.reqId || 0) + 1, loaded: false };
        state.detail = { index: '', data: null, loading: false, error: '', reqId: (state.detail.reqId || 0) + 1 };
        state.console = { method: 'GET', path: '/_cluster/health?pretty', body: '', running: false };
        hide(dom.workspace);
        show(dom.welcome);
        hide(dom.btnDisconnect);
        renderConnBox();
        renderIndexList();
        renderDocs();
        renderMapping();
        renderOverview();
        dom.statusConn.textContent = '未连接';
        dom.statusCluster.textContent = '—';
        dom.statusIndex.textContent = '';
        dom.statusMeta.textContent = '';
        loadProfiles();
    }

    function enterWorkspace() {
        hide(dom.welcome);
        show(dom.workspace);
        show(dom.btnDisconnect);
        renderConnBox();
        state.tab = 'overview';
        setTab('overview');
        state.selectedIndex = '';
        state.overview = null;
        state.indices = [];
        renderIndexList();
        renderDocs();
        renderMapping();
        renderOverview();
        loadIndices();
        loadOverview();
    }

    function updateConnBox() {
        renderConnBox();
        if (!state.conn) { return; }
        dom.statusConn.textContent = state.conn.clusterName || '已连接';
        dom.statusCluster.textContent = 'v' + (state.conn.version || '—');
        dom.statusIndex.textContent = state.selectedIndex ? '索引 ' + state.selectedIndex : '';
    }

    function renderConnBox() {
        var box = dom.connBox;
        clear(box);
        if (!state.conn) {
            box.appendChild(el('div', 'conn-empty', '尚未连接 Elasticsearch'));
            return;
        }
        var online = el('div', 'conn-online');
        var dot = el('span', 'online-dot' + (state.overview && state.overview.health
            ? ' ' + healthClass(state.overview.health.status) : ''));
        var main = el('div', 'conn-main');
        main.appendChild(el('div', 'conn-host', state.conn.clusterName || 'Elasticsearch'));
        main.appendChild(el('div', 'conn-sub', state.conn.nodeName || state.conn.url || ''));
        main.appendChild(el('div', 'conn-sub', 'v' + (state.conn.version || '—')
            + ' · ' + (AUTH_LABELS[state.conn.authType] || '无认证')));
        main.appendChild(el('span', 'conn-badge', state.conn.url || ''));
        online.appendChild(dot);
        online.appendChild(main);
        box.appendChild(online);
    }

    /* ---------------- indices ---------------- */

    function loadIndices(silent) {
        if (!state.conn) { return Promise.resolve(); }
        dom.btnOverviewRefresh.classList.add('spin');
        return api('indices', { connectionId: state.conn.connectionId }).then(function (list) {
            state.indices = Array.isArray(list) ? list : [];
            if (state.selectedIndex) {
                var exists = state.indices.some(function (row) { return row.index === state.selectedIndex; });
                if (!exists) {
                    state.selectedIndex = '';
                    state.docs.index = '';
                }
            }
            dom.indexTotal.textContent = state.indices.length + ' 个';
            renderIndexList();
            updateConnBox();
        }).catch(function (err) {
            if (!silent) { toast('读取索引失败：' + errorText(err), 'error'); }
        }).then(function () {
            dom.btnOverviewRefresh.classList.remove('spin');
        });
    }

    function renderIndexList() {
        var list = dom.indexList;
        if (!list) { return; }
        clear(list);
        if (!state.connected) {
            list.appendChild(el('div', 'side-empty', '连接后在这里浏览索引'));
            return;
        }
        var q = String(state.indexFilter || '').trim().toLowerCase();
        var rows = state.indices.filter(function (row) {
            return !q || String(row.index || '').toLowerCase().indexOf(q) >= 0;
        });
        if (!rows.length) {
            list.appendChild(el('div', 'side-empty', state.indices.length ? '没有匹配的索引' : '暂无索引'));
            return;
        }
        rows.forEach(function (row) {
            var btn = el('button', 'idx-item' + (row.index === state.selectedIndex ? ' active' : ''));
            btn.type = 'button';
            btn.title = row.index + '\n文档 ' + fmtNumber(row.docsCount) + ' · ' + fmtBytes(row.storeBytes);
            var dot = el('span', 'idx-health ' + healthClass(row.health));
            var main = el('span', 'idx-main');
            main.appendChild(el('span', 'idx-name', row.index || ''));
            main.appendChild(el('span', 'idx-meta', fmtBytes(row.storeBytes)
                + ' · ' + (healthClass(row.health) ? healthLabel(row.health) : (row.status || '—'))));
            var count = el('span', 'idx-docs', fmtNumber(row.docsCount));
            btn.appendChild(dot);
            btn.appendChild(main);
            btn.appendChild(count);
            btn.addEventListener('click', function () { selectIndex(row.index); });
            list.appendChild(btn);
        });
    }

    function selectIndex(index) {
        state.selectedIndex = index || '';
        state.docs.index = state.selectedIndex;
        state.docs.from = 0;
        state.docs.query = '';
        state.docs.hits = [];
        state.docs.total = 0;
        state.docs.error = '';
        state.detail = { index: '', data: null, loading: false, error: '', reqId: (state.detail.reqId || 0) + 1 };
        state.docs.reqId++;
        state.docs.loaded = false;
        dom.docQuery.value = '';
        dom.statusIndex.textContent = state.selectedIndex ? '索引 ' + state.selectedIndex : '';
        renderIndexList();
        if (state.tab === 'mapping') {
            dom.crumbIndex.textContent = state.selectedIndex || '映射 / 设置';
            loadDetail();
        } else if (state.tab === 'console') {
            dom.crumbIndex.textContent = state.selectedIndex || 'REST 控制台';
        } else {
            setTab('docs');
        }
    }

    /* ---------------- overview ---------------- */

    function loadOverview(silent) {
        if (!state.conn) { return Promise.resolve(); }
        state.overviewLoading = true;
        return api('overview', { connectionId: state.conn.connectionId }).then(function (data) {
            state.overview = data || null;
            state.overviewLoading = false;
            renderOverview();
            renderConnBox();
            updateConnBox();
        }).catch(function (err) {
            state.overviewLoading = false;
            if (!silent) { toast('读取集群概览失败：' + errorText(err), 'error'); }
        });
    }

    function renderOverview() {
        var ov = state.overview;
        var health = ov && ov.health ? ov.health : null;
        var status = health ? health.status : '';
        var card = dom.ovHealth.parentNode;
        card.className = 'ov-card health-card ' + healthClass(status);
        dom.ovHealth.textContent = status ? healthLabel(status) : '—';
        dom.ovHealth.className = status ? '' : 'pending';
        dom.ovHealthHint.textContent = health
            ? ('节点 ' + (health.number_of_nodes || 0)
                + ' · 分片 ' + (health.active_shards || 0)
                + ' · 未分配 ' + (health.unassigned_shards || 0))
            : '等待连接';
        var totals = ov && ov.totals ? ov.totals : {};
        dom.ovIndices.textContent = ov ? fmtNumber(totals.indices) : '—';
        dom.ovIndicesHint.textContent = ov ? (totals.openIndices + ' 个已打开') : '个索引';
        dom.ovDocs.textContent = ov ? fmtNumber(totals.docs) : '—';
        dom.ovStore.textContent = ov ? fmtBytes(totals.storeBytes) : '—';
        var nodes = ov && Array.isArray(ov.nodes) ? ov.nodes : [];
        dom.ovNodes.textContent = ov ? fmtNumber(nodes.length) : '—';
        dom.ovNodesHint.textContent = ov ? '个节点' : '等待连接';
        dom.ovNodesMeta.textContent = nodes.length ? (nodes.length + ' 个节点') : '';
        dom.ovVersion.textContent = ov && ov.version ? 'v' + ov.version : '';
        dom.ovInfo.textContent = ov ? pretty({
            name: ov.nodeName,
            cluster_name: ov.clusterName,
            version: ov.root && ov.root.version ? ov.root.version : undefined,
            tagline: ov.root ? ov.root.tagline : undefined
        }) : '连接后显示集群信息';
        renderNodes(nodes);
    }

    function renderNodes(nodes) {
        var wrap = dom.nodeRows;
        clear(wrap);
        if (!nodes.length) {
            wrap.appendChild(el('div', 'node-row', '暂无节点数据'));
            return;
        }
        nodes.forEach(function (node) {
            var row = el('div', 'node-row');
            var name = el('span', 'node-name', node.name || '—');
            if (String(node.master || '').indexOf('*') >= 0) {
                var star = el('span', 'master-star', '★');
                star.title = '主节点';
                name.appendChild(star);
            }
            row.appendChild(name);
            row.appendChild(el('span', 'node-ip', node.ip || '—'));
            var role = el('span', 'node-role', roleLabel(node['node.role'] || node.role));
            role.title = node['node.role'] || node.role || '';
            row.appendChild(role);
            row.appendChild(el('span', 'node-num ' + numClass(node['heap.percent'], 75, 90),
                (node['heap.percent'] || '—') + '%'));
            row.appendChild(el('span', 'node-num ' + numClass(node['disk.used_percent'], 80, 90),
                node['disk.used_percent'] == null ? '—' : node['disk.used_percent'] + '%'));
            row.appendChild(el('span', 'node-num', node.cpu == null ? '—' : node.cpu + '%'));
            wrap.appendChild(row);
        });
    }

    /* ---------------- documents ---------------- */

    function loadDocs() {
        if (!state.conn || !state.selectedIndex) {
            renderDocs();
            return Promise.resolve();
        }
        state.docs.loading = true;
        state.docs.error = '';
        state.docs.loaded = false;
        var reqId = ++state.docs.reqId;
        renderDocs();
        var d = state.docs;
        return api('search', {
            connectionId: state.conn.connectionId,
            index: state.selectedIndex,
            query: d.query,
            from: d.from,
            size: d.size
        }).then(function (data) {
            if (reqId !== d.reqId) { return; }
            d.loading = false;
            d.total = data && data.total != null ? data.total : 0;
            d.relation = data && data.relation ? data.relation : 'eq';
            d.hits = data && Array.isArray(data.hits) ? data.hits : [];
            d.took = data && data.took != null ? data.took : 0;
            d.error = '';
            d.loaded = true;
            state.lastTook = d.took;
            renderDocs();
        }).catch(function (err) {
            if (reqId !== d.reqId) { return; }
            d.loading = false;
            d.hits = [];
            d.error = errorText(err);
            d.loaded = true;
            renderDocs();
        });
    }

    function renderDocs() {
        var d = state.docs;
        dom.docsIndex.textContent = state.selectedIndex || '未选择索引';
        var sel = state.indices.filter(function (row) { return row.index === state.selectedIndex; })[0];
        dom.docsCount.textContent = sel
            ? (fmtNumber(sel.docsCount) + ' 条文档 · ' + fmtBytes(sel.storeBytes))
            : '';
        var hits = dom.docHits;
        clear(hits);
        if (!state.selectedIndex) {
            hits.appendChild(el('div', 'empty-block', '从左侧选择一个索引开始浏览文档'));
            dom.docsMeta.textContent = '';
            renderPager();
            return;
        }
        if (d.loading) {
            hits.appendChild(el('div', 'empty-block', '正在搜索文档…'));
            dom.docsMeta.textContent = '';
            renderPager();
            return;
        }
        if (d.error) {
            var errBox = el('div', 'empty-block');
            errBox.appendChild(el('div', '', '搜索失败'));
            errBox.appendChild(el('div', 'muted', d.error));
            hits.appendChild(errBox);
            dom.docsMeta.textContent = '';
            renderPager();
            return;
        }
        if (!d.hits.length) {
            hits.appendChild(el('div', 'empty-block', d.query
                ? '没有匹配的文档，试试简化查询条件'
                : '当前索引没有文档'));
            dom.docsMeta.textContent = d.query ? '' : '索引为空';
            renderPager();
            return;
        }
        d.hits.forEach(function (hit) {
            hits.appendChild(renderHit(hit));
        });
        dom.docsMeta.textContent = '返回 ' + d.hits.length + ' 条 · 共 '
            + fmtNumber(d.total) + (d.relation === 'gte' ? '+' : '') + ' 条 · 耗时 '
            + (d.took || 0) + ' ms' + (d.query ? ' · 查询：' + d.query : '');
        renderPager();
    }

    function renderHit(hit) {
        var card = el('div', 'hit-card');
        var head = el('div', 'hit-head');
        head.appendChild(el('span', 'hit-id', hit.id || '（无 ID）'));
        head.appendChild(el('span', 'hit-badge', 'score ' + (hit.score == null ? '—' : hit.score)));
        head.appendChild(el('span', 'hit-index', hit.index || ''));
        var actions = el('div', 'hit-actions');
        var edit = el('button', 'btn btn-ghost btn-xs', '编辑');
        edit.type = 'button';
        edit.addEventListener('click', function () { openDocModal('edit', hit); });
        var del = el('button', 'btn btn-ghost btn-xs danger', '删除');
        del.type = 'button';
        del.addEventListener('click', function () { deleteDoc(hit); });
        actions.appendChild(edit);
        actions.appendChild(del);
        head.appendChild(actions);
        card.appendChild(head);
        var pre = el('pre', 'json-box hit-json');
        pre.textContent = pretty(hit.source == null ? {} : hit.source);
        pre.title = '点击展开 / 收起';
        pre.addEventListener('click', function () {
            card.classList.toggle('expanded');
        });
        card.appendChild(pre);
        var foot = el('div', 'hit-foot', '_index: ' + (hit.index || '—'));
        card.appendChild(foot);
        return card;
    }

    function renderPager() {
        var d = state.docs;
        var page = Math.floor(d.from / d.size) + 1;
        var known = d.relation !== 'gte';
        var pages = known && d.total > 0 ? Math.ceil(d.total / d.size) : 0;
        var info = d.hits.length
            ? ((d.from + 1) + ' - ' + (d.from + d.hits.length)
                + (known ? ' / ' + fmtNumber(d.total) : ' / ' + fmtNumber(d.total) + '+'))
            : '第 ' + page + ' 页';
        if (pages) { info += ' · 第 ' + page + ' / ' + pages + ' 页'; }
        dom.pageInfo.textContent = info;
        dom.btnDocPrev.disabled = d.from <= 0 || d.loading;
        dom.btnDocNext.disabled = d.loading || !d.hits.length
            || (known && d.from + d.size >= d.total);
    }

    function openDocModal(mode, hit) {
        if (!state.selectedIndex) {
            toast('请先选择索引', 'error');
            return;
        }
        var isEdit = mode === 'edit';
        state.docModal.mode = isEdit ? 'edit' : 'create';
        state.docModal.id = isEdit ? (hit.id || '') : '';
        dom.docModalTitle.textContent = isEdit ? '编辑文档' : '新建文档';
        dom.docModalIndex.textContent = state.selectedIndex;
        dom.docIdInput.value = state.docModal.id;
        dom.docIdInput.disabled = isEdit;
        dom.docSource.value = isEdit ? pretty(hit.source == null ? {} : hit.source) : '{\n  \n}';
        hide(dom.docError);
        setHidden(dom.btnDeleteDoc, !isEdit);
        openModal('docModal');
        setTimeout(function () { dom.docSource.focus(); }, 30);
    }

    function saveDoc() {
        var text = dom.docSource.value.trim();
        if (!text) {
            dom.docError.textContent = '文档内容不能为空';
            show(dom.docError);
            return;
        }
        var source;
        try {
            source = JSON.parse(text);
        } catch (e) {
            dom.docError.textContent = 'JSON 格式不正确：' + e.message;
            show(dom.docError);
            return;
        }
        if (!isObject(source)) {
            dom.docError.textContent = '文档内容必须是 JSON 对象';
            show(dom.docError);
            return;
        }
        dom.btnSaveDoc.disabled = true;
        dom.btnSaveDoc.textContent = '保存中…';
        api('document/save', {
            connectionId: state.conn.connectionId,
            index: state.selectedIndex,
            id: dom.docIdInput.value.trim(),
            source: JSON.stringify(source)
        }).then(function (result) {
            dom.btnSaveDoc.disabled = false;
            dom.btnSaveDoc.textContent = '保存';
            closeModal('docModal');
            toast('文档已保存：' + (result && result.id ? result.id : ''), 'success');
            loadDocs();
            setTimeout(function () { loadIndices(true); loadOverview(true); }, 1000);
        }).catch(function (err) {
            dom.btnSaveDoc.disabled = false;
            dom.btnSaveDoc.textContent = '保存';
            dom.docError.textContent = errorText(err);
            show(dom.docError);
        });
    }

    function deleteDoc(hit) {
        confirmAction('删除文档', '确定删除文档「' + (hit.id || '') + '」？\n此操作不可撤销。', '删除')
            .then(function (ok) {
                if (!ok) { return null; }
                return api('document/delete', {
                    connectionId: state.conn.connectionId,
                    index: state.selectedIndex,
                    id: hit.id
                });
            })
            .then(function (done) {
                if (done === null) { return; }
                toast('文档已删除', 'success');
                closeModal('docModal');
                loadDocs();
                setTimeout(function () { loadIndices(true); loadOverview(true); }, 1000);
            })
            .catch(function (err) { toast(errorText(err), 'error'); });
    }

    /* ---------------- mapping ---------------- */

    function loadDetail() {
        if (!state.conn || !state.selectedIndex) {
            renderMapping();
            return Promise.resolve();
        }
        state.detail.loading = true;
        state.detail.error = '';
        var reqId = ++state.detail.reqId;
        renderMapping();
        return api('index', {
            connectionId: state.conn.connectionId,
            index: state.selectedIndex
        }).then(function (data) {
            if (reqId !== state.detail.reqId) { return; }
            state.detail.loading = false;
            state.detail.index = state.selectedIndex;
            state.detail.data = data || null;
            renderMapping();
        }).catch(function (err) {
            if (reqId !== state.detail.reqId) { return; }
            state.detail.loading = false;
            state.detail.index = state.selectedIndex;
            state.detail.data = null;
            state.detail.error = errorText(err);
            renderMapping();
        });
    }

    function renderMapping() {
        var hasIndex = !!state.selectedIndex;
        dom.mapIndex.textContent = hasIndex ? state.selectedIndex : '未选择索引';
        var d = state.detail;
        var data = d.index === state.selectedIndex ? d.data : null;
        setHidden(dom.mappingEmpty, !!data);
        setHidden(dom.mappingContent, !data);
        if (!hasIndex) {
            dom.mappingEmpty.textContent = '从左侧选择一个索引查看映射与设置';
            dom.mapCount.textContent = '';
            return;
        }
        if (d.loading) {
            dom.mappingEmpty.textContent = '正在读取映射与设置…';
            dom.mapCount.textContent = '';
            return;
        }
        if (d.error) {
            dom.mappingEmpty.textContent = '读取失败：' + d.error;
            dom.mapCount.textContent = '';
            return;
        }
        if (!data) {
            dom.mappingEmpty.textContent = '正在读取映射与设置…';
            dom.mapCount.textContent = '';
            return;
        }
        dom.mapCount.textContent = data.count != null && data.count >= 0
            ? (fmtNumber(data.count) + ' 条文档') : '';
        dom.mapMapping.textContent = pretty(data.mapping);
        dom.mapSettings.textContent = pretty(data.settings);
        dom.mapAliases.textContent = pretty(data.aliases);
    }

    function deleteIndex() {
        if (!state.selectedIndex) {
            toast('请先选择索引', 'error');
            return;
        }
        var index = state.selectedIndex;
        confirmAction('删除索引', '确定永久删除索引「' + index + '」及其中全部文档？\n此操作不可恢复，请确认已经备份。', '删除索引')
            .then(function (ok) {
                if (!ok) { return null; }
                return api('index/delete', { connectionId: state.conn.connectionId, index: index });
            })
            .then(function (done) {
                if (done === null) { return; }
                toast('索引已删除：' + index, 'success');
                state.selectedIndex = '';
                state.docs.index = '';
                state.docs.hits = [];
                state.detail = { index: '', data: null, loading: false, error: '', reqId: (state.detail.reqId || 0) + 1 };
                setTab('overview');
                loadIndices(true);
                loadOverview(true);
            })
            .catch(function (err) { toast(errorText(err), 'error'); });
    }

    function refreshIndex() {
        if (!state.selectedIndex) { return; }
        api('index/refresh', { connectionId: state.conn.connectionId, index: state.selectedIndex })
            .then(function () {
                toast('索引已刷新：' + state.selectedIndex, 'success');
                loadDetail();
            })
            .catch(function (err) { toast(errorText(err), 'error'); });
    }

    /* ---------------- create index ---------------- */

    function openCreateIndex() {
        if (!state.connected) {
            toast('请先连接 Elasticsearch', 'error');
            return;
        }
        dom.newIndexName.value = '';
        dom.newIndexBody.value = '{\n  "settings": {\n    "number_of_shards": 1,\n    "number_of_replicas": 0\n  }\n}';
        hide(dom.indexError);
        openModal('indexModal');
        setTimeout(function () { dom.newIndexName.focus(); }, 30);
    }

    function createIndex() {
        var name = dom.newIndexName.value.trim();
        if (!name) {
            dom.indexError.textContent = '请填写索引名称';
            show(dom.indexError);
            return;
        }
        var body = dom.newIndexBody.value.trim();
        if (body) {
            try {
                var parsed = JSON.parse(body);
                if (!isObject(parsed)) {
                    dom.indexError.textContent = '索引配置必须是 JSON 对象';
                    show(dom.indexError);
                    return;
                }
                body = JSON.stringify(parsed);
            } catch (e) {
                dom.indexError.textContent = '索引配置 JSON 格式不正确：' + e.message;
                show(dom.indexError);
                return;
            }
        }
        dom.btnDoCreateIndex.disabled = true;
        dom.btnDoCreateIndex.textContent = '创建中…';
        api('index/create', {
            connectionId: state.conn.connectionId,
            index: name,
            body: body
        }).then(function () {
            dom.btnDoCreateIndex.disabled = false;
            dom.btnDoCreateIndex.textContent = '创建';
            closeModal('indexModal');
            toast('索引已创建：' + name, 'success');
            return loadIndices(true).then(function () {
                var exists = state.indices.some(function (row) { return row.index === name; });
                if (exists) { selectIndex(name); }
                loadOverview(true);
            });
        }).catch(function (err) {
            dom.btnDoCreateIndex.disabled = false;
            dom.btnDoCreateIndex.textContent = '创建';
            dom.indexError.textContent = errorText(err);
            show(dom.indexError);
        });
    }

    /* ---------------- console ---------------- */

    function runConsole() {
        if (!state.conn || state.console.running) { return; }
        var method = dom.consoleMethod.value;
        var path = dom.consolePath.value.trim();
        if (!path) {
            dom.consoleMeta.textContent = '请输入请求路径';
            dom.consoleMeta.className = 'console-meta bad';
            return;
        }
        state.console.running = true;
        dom.btnConsoleRun.disabled = true;
        dom.btnConsoleRun.textContent = '执行中…';
        dom.consoleMeta.textContent = '正在执行 ' + method + ' ' + path;
        dom.consoleMeta.className = 'console-meta muted';
        api('console', {
            connectionId: state.conn.connectionId,
            method: method,
            path: path,
            body: dom.consoleBody.value
        }).then(function (result) {
            state.console.running = false;
            dom.btnConsoleRun.disabled = false;
            dom.btnConsoleRun.textContent = '执行';
            var ok = !!(result && result.ok);
            dom.consoleMeta.textContent = (result ? (result.status + ' · ' + result.tookMs + ' ms') : '完成')
                + (ok ? '' : ' · ' + ((result && result.error) || '请求失败'));
            dom.consoleMeta.className = 'console-meta ' + (ok ? 'ok' : 'bad');
            var body = result ? result.body : null;
            dom.consoleOut.textContent = body == null
                ? '（空响应）'
                : (typeof body === 'string' ? body : pretty(body));
            state.lastTook = result && result.tookMs ? result.tookMs : 0;
            dom.statusMeta.textContent = '耗时 ' + state.lastTook + ' ms';
        }).catch(function (err) {
            state.console.running = false;
            dom.btnConsoleRun.disabled = false;
            dom.btnConsoleRun.textContent = '执行';
            dom.consoleMeta.textContent = errorText(err);
            dom.consoleMeta.className = 'console-meta bad';
            dom.consoleOut.textContent = '';
        });
    }

    /* ---------------- tabs ---------------- */

    function setTab(tab) {
        state.tab = tab;
        Array.prototype.forEach.call(document.querySelectorAll('.tabs .tab'), function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
        });
        ['overview', 'docs', 'mapping', 'console'].forEach(function (id) {
            var node = $('tab' + id.charAt(0).toUpperCase() + id.slice(1));
            if (node) { setHidden(node, id !== tab); }
        });
        dom.crumbIndex.textContent = tab === 'overview' ? '概览'
            : (state.selectedIndex && tab !== 'console' ? state.selectedIndex : tabLabel(tab));
        if (tab === 'overview') {
            if (!state.overview) { loadOverview(); }
        } else if (tab === 'docs') {
            if (state.selectedIndex && !state.docs.loaded && !state.docs.loading) {
                loadDocs();
            } else {
                renderDocs();
            }
        } else if (tab === 'mapping') {
            if (state.selectedIndex && state.detail.index !== state.selectedIndex) {
                loadDetail();
            } else {
                renderMapping();
            }
        } else if (tab === 'console') {
            setTimeout(function () { dom.consolePath.focus(); }, 20);
        }
    }

    function tabLabel(tab) {
        return { overview: '概览', docs: '文档', mapping: '映射 / 设置', console: 'REST 控制台' }[tab] || tab;
    }

    function refreshAll() {
        if (!state.conn) { return; }
        loadIndices();
        loadOverview();
        if (state.tab === 'docs' && state.selectedIndex) { loadDocs(); }
        if (state.tab === 'mapping' && state.selectedIndex) { loadDetail(); }
    }

    /* ---------------- bind ---------------- */

    function bind() {
        dom = {
            welcome: $('welcome'), workspace: $('workspace'),
            connBox: $('connBox'), indexTotal: $('indexTotal'),
            indexFilter: $('indexFilter'), indexList: $('indexList'),
            savedProfiles: $('savedProfiles'), savedProfileList: $('savedProfileList'),
            crumbCluster: $('crumbCluster'), crumbIndex: $('crumbIndex'),
            overviewBody: $('tabOverview'),
            ovHealth: $('ovHealth'), ovHealthHint: $('ovHealthHint'),
            ovIndices: $('ovIndices'), ovIndicesHint: $('ovIndicesHint'),
            ovDocs: $('ovDocs'), ovStore: $('ovStore'),
            ovNodes: $('ovNodes'), ovNodesHint: $('ovNodesHint'),
            ovNodesMeta: $('ovNodesMeta'), ovVersion: $('ovVersion'),
            ovInfo: $('ovInfo'), nodeRows: $('nodeRows'),
            docsIndex: $('docsIndex'), docsCount: $('docsCount'),
            docQuery: $('docQuery'), docsMeta: $('docsMeta'), docHits: $('docHits'),
            pageInfo: $('pageInfo'), docPageSize: $('docPageSize'),
            btnDocPrev: $('btnDocPrev'), btnDocNext: $('btnDocNext'),
            mapIndex: $('mapIndex'), mapCount: $('mapCount'),
            mappingEmpty: $('mappingEmpty'), mappingContent: $('mappingContent'),
            mapMapping: $('mapMapping'), mapSettings: $('mapSettings'), mapAliases: $('mapAliases'),
            consoleMethod: $('consoleMethod'), consolePath: $('consolePath'),
            consoleBody: $('consoleBody'), consoleMeta: $('consoleMeta'), consoleOut: $('consoleOut'),
            btnConsoleRun: $('btnConsoleRun'),
            statusConn: $('statusConn'), statusCluster: $('statusCluster'),
            statusIndex: $('statusIndex'), statusMeta: $('statusMeta'),
            btnConnect: $('btnConnect'), connectError: $('connectError'),
            btnDisconnect: $('btnDisconnect'),
            fSaved: $('fSaved'), savedPickerWrap: $('savedPickerWrap'),
            fName: $('fName'), fUrl: $('fUrl'), fAuthType: $('fAuthType'),
            fUsername: $('fUsername'), fSecret: $('fSecret'), fTimeout: $('fTimeout'),
            fSkipTls: $('fSkipTls'), fSave: $('fSave'),
            userField: $('userField'), secretField: $('secretField'), secretLabel: $('secretLabel'),
            docModalTitle: $('docModalTitle'), docModalIndex: $('docModalIndex'),
            docIdInput: $('docIdInput'), docSource: $('docSource'), docError: $('docError'),
            btnSaveDoc: $('btnSaveDoc'), btnDeleteDoc: $('btnDeleteDoc'),
            newIndexName: $('newIndexName'), newIndexBody: $('newIndexBody'),
            indexError: $('indexError'), btnDoCreateIndex: $('btnDoCreateIndex'),
            confirmTitle: $('confirmTitle'), confirmMessage: $('confirmMessage'),
            btnConfirmOk: $('btnConfirmOk'), toast: $('toast'),
            btnOverviewRefresh: $('btnOverviewRefresh')
        };

        $('btnOpenConnect').addEventListener('click', function () { openConnectDialog(null); });
        $('btnOpenConnectSide').addEventListener('click', function () {
            var profile = null;
            if (state.editingProfileId) {
                for (var i = 0; i < state.profiles.length; i++) {
                    if (state.profiles[i].id === state.editingProfileId) { profile = state.profiles[i]; break; }
                }
            }
            if (!profile && state.conn) {
                profile = {
                    id: '',
                    name: state.conn.clusterName || '',
                    url: state.conn.url || '',
                    username: state.conn.username || '',
                    authType: state.conn.authType || 'none',
                    timeoutMs: state.conn.timeoutMs || 15000,
                    skipTls: !!state.conn.skipTls
                };
            }
            openConnectDialog(profile);
        });
        $('btnDisconnect').addEventListener('click', disconnect);
        $('btnCreateIndex').addEventListener('click', openCreateIndex);
        $('btnOverviewRefresh').addEventListener('click', refreshAll);
        $('btnRefreshMapping').addEventListener('click', loadDetail);
        $('btnRefreshIndex').addEventListener('click', refreshIndex);
        $('btnDeleteIndex').addEventListener('click', deleteIndex);
        $('btnDocSearch').addEventListener('click', function () {
            state.docs.query = dom.docQuery.value.trim();
            state.docs.from = 0;
            loadDocs();
        });
        $('btnDocReset').addEventListener('click', function () {
            dom.docQuery.value = '';
            state.docs.query = '';
            state.docs.from = 0;
            loadDocs();
        });
        $('btnDocRefresh').addEventListener('click', function () { loadDocs(); loadIndices(true); });
        $('btnNewDoc').addEventListener('click', function () { openDocModal('create', null); });
        $('btnDocPrev').addEventListener('click', function () {
            state.docs.from = Math.max(0, state.docs.from - state.docs.size);
            loadDocs();
        });
        $('btnDocNext').addEventListener('click', function () {
            state.docs.from += state.docs.size;
            loadDocs();
        });
        dom.docPageSize.addEventListener('change', function () {
            state.docs.size = parseInt(dom.docPageSize.value, 10) || 20;
            state.docs.from = 0;
            loadDocs();
        });
        dom.docQuery.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                $('btnDocSearch').click();
            }
        });
        dom.indexFilter.addEventListener('input', function () {
            state.indexFilter = dom.indexFilter.value;
            renderIndexList();
        });
        Array.prototype.forEach.call(document.querySelectorAll('.tabs .tab'), function (btn) {
            btn.addEventListener('click', function () { setTab(btn.getAttribute('data-tab')); });
        });
        Array.prototype.forEach.call(document.querySelectorAll('.modal-x, [data-close]'), function (btn) {
            btn.addEventListener('click', function () {
                closeModal(btn.getAttribute('data-close'));
            });
        });
        dom.btnConfirmOk.addEventListener('click', function () {
            var resolve = state.confirmResolve;
            state.confirmResolve = null;
            closeModal('confirmModal');
            if (resolve) { resolve(true); }
        });
        $('connectForm').addEventListener('submit', function (ev) {
            ev.preventDefault();
            submitConnect();
        });
        dom.fAuthType.addEventListener('change', updateAuthFields);
        dom.fSaved.addEventListener('change', function () {
            var id = dom.fSaved.value;
            if (!id) {
                fillConnectForm(null);
                return;
            }
            for (var i = 0; i < state.profiles.length; i++) {
                if (state.profiles[i].id === id) {
                    fillConnectForm(state.profiles[i]);
                    return;
                }
            }
        });
        $('btnDoCreateIndex').addEventListener('click', createIndex);
        dom.newIndexName.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); createIndex(); }
        });
        $('btnFormatDoc').addEventListener('click', function () {
            try {
                var parsed = JSON.parse(dom.docSource.value);
                dom.docSource.value = pretty(parsed);
                hide(dom.docError);
            } catch (e) {
                dom.docError.textContent = 'JSON 格式不正确：' + e.message;
                show(dom.docError);
            }
        });
        dom.btnSaveDoc.addEventListener('click', saveDoc);
        dom.btnDeleteDoc.addEventListener('click', function () {
            if (!state.docModal.id) { return; }
            deleteDoc({ id: state.docModal.id, index: state.selectedIndex });
        });
        dom.consolePath.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); runConsole(); }
        });
        dom.consoleBody.addEventListener('keydown', function (ev) {
            if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
                ev.preventDefault();
                runConsole();
            }
        });
        $('btnConsoleClear').addEventListener('click', function () {
            dom.consoleOut.textContent = '响应会显示在这里';
            dom.consoleMeta.textContent = '';
            dom.consoleMeta.className = 'console-meta muted';
        });
        dom.btnConsoleRun.addEventListener('click', runConsole);
        Array.prototype.forEach.call(document.querySelectorAll('.console-examples button'), function (btn) {
            btn.addEventListener('click', function () {
                dom.consolePath.value = btn.getAttribute('data-path') || '';
                if (btn.getAttribute('data-method')) {
                    dom.consoleMethod.value = btn.getAttribute('data-method');
                }
                dom.consoleBody.value = btn.getAttribute('data-body') || '';
                dom.consolePath.focus();
            });
        });
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') {
                var modals = document.querySelectorAll('.modal:not(.hidden)');
                if (modals.length) {
                    var top = modals[modals.length - 1];
                    if (top.id) { closeModal(top.id); }
                }
            }
        });
    }

    /* ---------------- init ---------------- */

    function init() {
        bind();
        renderConnBox();
        renderIndexList();
        renderDocs();
        renderMapping();
        renderOverview();
        loadProfiles();
    }

    init();
})();
