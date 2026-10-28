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
        topics: [],
        topicFilter: '',
        topic: '',
        detail: null,
        topicTab: 'messages',
        messages: [],
        msgLoading: false,
        msgPartition: -1,
        msgMode: 'latest',
        msgLimit: 20,
        msgInfo: '',
        msgTruncated: false,
        groups: [],
        groupsLoading: false,
        group: '',
        groupDetail: null,
        overview: null,
        loadingOverview: false,
        confirmResolve: null,
        message: null
    };

    var dom = {};
    var pending = {};
    var seq = 0;
    var toastTimer = null;

    var IDS = [
        'connBox', 'navOverview', 'navGroups', 'groupCount', 'topicCount', 'topicSearch',
        'topicList', 'topicEmpty', 'btnNewTopicSide', 'btnDisconnect', 'welcome', 'btnOpenConnect',
        'savedProfiles', 'savedProfileList', 'workspace', 'viewTitle', 'viewSub', 'connPill',
        'btnRefresh', 'viewOverview', 'overviewStats', 'overviewCluster', 'brokerTable',
        'quickLatest', 'quickGroups', 'viewGroups', 'groupsHint', 'groupsTable', 'groupDetailTitle',
        'groupDetailMeta', 'groupDetail', 'viewTopic', 'topicName', 'topicBadges', 'btnProduce',
        'btnAddPartitions', 'btnDeleteTopic', 'tabMessages', 'tabPartitions', 'tabConfigs',
        'msgPartition', 'msgMode', 'msgOffset', 'msgLimit', 'btnFetchMessages', 'msgHint',
        'msgTable', 'msgEmpty', 'partitionTable', 'configTable', 'connectModal', 'connectTitle',
        'fName', 'fServers', 'fSecurity', 'fMechanism', 'fUser', 'fPassword', 'fClientId',
        'fTimeout', 'fSave', 'btnDeleteProfile', 'connectError', 'btnConnect', 'produceModal',
        'pTopic', 'pPartition', 'pKey', 'pValue', 'pHeaders', 'produceError', 'btnSendMessage',
        'topicModal', 'tName', 'tPartitions', 'tReplication', 'tConfigs', 'topicError',
        'btnCreateTopic', 'partitionsModal', 'partitionsNote', 'newPartitionTotal',
        'partitionsError', 'btnConfirmPartitions', 'messageModal', 'messageTitle', 'messageMeta',
        'messageKey', 'messageValue', 'messageHeadersWrap', 'messageHeaders', 'btnCopyKey',
        'btnCopyValue', 'confirmModal', 'confirmTitle', 'confirmMessage', 'btnConfirmOk', 'toast'
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

    function fmtNumber(n) {
        var v = Number(n);
        if (!isFinite(v)) { return '—'; }
        return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function fmtBytes(n) {
        var v = Number(n) || 0;
        if (v < 1024) { return v + ' B'; }
        var units = ['KB', 'MB', 'GB'];
        var i = -1;
        do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
        return v.toFixed(v >= 100 ? 0 : 1) + ' ' + units[i];
    }

    function fmtTime(ms) {
        if (!ms) { return '—'; }
        var d = new Date(ms);
        var p = function (x) { return (x < 10 ? '0' : '') + x; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
            + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }

    function prettyMaybe(value, encoding) {
        if (encoding === 'base64') { return value; }
        try {
            return JSON.stringify(JSON.parse(value), null, 2);
        } catch (e) {
            return value;
        }
    }

    function preview(value, encoding) {
        if (value == null) { return ''; }
        if (encoding === 'base64') {
            return 'base64: ' + String(value).substring(0, 400);
        }
        var text = String(value).replace(/\r?\n/g, ' ↵ ');
        return text.length > 400 ? text.substring(0, 400) + '…' : text;
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

    function setView(view) {
        state.view = view;
        dom.navOverview.classList.toggle('active', view === 'overview' || view === 'topic');
        dom.navGroups.classList.toggle('active', view === 'groups');
        hide(dom.viewOverview);
        hide(dom.viewGroups);
        hide(dom.viewTopic);
        if (view === 'overview') {
            show(dom.viewOverview);
            dom.viewTitle.textContent = '集群概览';
            dom.viewSub.textContent = state.conn ? state.conn.clusterId : '';
        } else if (view === 'groups') {
            show(dom.viewGroups);
            dom.viewTitle.textContent = '消费组';
            dom.viewSub.textContent = state.groups.length ? state.groups.length + ' 个消费组' : '';
        } else {
            show(dom.viewTopic);
            dom.viewTitle.textContent = '主题';
            dom.viewSub.textContent = state.topic;
        }
    }

    /* ---------------- host bridge ---------------- */

    function api(action, payload) {
        return new Promise(function (resolve, reject) {
            if (window.parent === window) {
                reject(new Error('请从 DeepShell AI 可视化桌面打开此应用'));
                return;
            }
            var id = 'kq' + (++seq) + '-' + Date.now();
            var timer = setTimeout(function () {
                delete pending[id];
                reject(new Error('请求超时，请确认 Kafka 服务可访问'));
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
            dom.connBox.appendChild(el('div', 'conn-empty', '尚未连接 Kafka'));
            return;
        }
        var box = el('div', 'conn-online');
        box.appendChild(el('span', 'online-dot'));
        var main = el('div', 'conn-main');
        main.appendChild(el('div', 'conn-host', state.connName || state.conn.servers));
        main.appendChild(el('div', 'conn-sub', '集群 ' + (state.conn.clusterId || '—')
            + ' · ' + (state.conn.brokers ? state.conn.brokers.length : 0) + ' Broker'));
        box.appendChild(main);
        dom.connBox.appendChild(box);
    }

    function updateConnectionUi() {
        dom.btnDisconnect.classList.toggle('hidden', !state.connected);
        dom.btnNewTopicSide.classList.toggle('hidden', !state.connected);
        dom.connPill.textContent = state.connected
            ? (state.conn && state.conn.topicCount != null ? state.conn.topicCount + ' 主题' : '已连接')
            : '';
        dom.connPill.classList.toggle('hidden', !state.connected);
    }

    function updateSecurityFields() {
        var sasl = dom.fSecurity.value.indexOf('SASL') === 0;
        dom.fMechanism.disabled = !sasl;
        dom.fUser.disabled = !sasl;
        dom.fPassword.disabled = !sasl;
    }

    function resetConnectForm() {
        state.editingProfileId = '';
        dom.fName.value = '';
        dom.fServers.value = '127.0.0.1:9092';
        dom.fSecurity.value = 'PLAINTEXT';
        dom.fMechanism.value = 'PLAIN';
        dom.fUser.value = '';
        dom.fPassword.value = '';
        dom.fPassword.placeholder = '';
        dom.fClientId.value = '';
        dom.fTimeout.value = '10000';
        dom.fSave.checked = true;
        dom.connectTitle.textContent = '连接 Kafka';
        hide(dom.btnDeleteProfile);
        hide(dom.connectError);
        updateSecurityFields();
    }

    function openConnectModal(profile) {
        resetConnectForm();
        if (profile) {
            state.editingProfileId = profile.id;
            dom.fName.value = profile.name || '';
            dom.fServers.value = profile.servers || '';
            dom.fSecurity.value = profile.securityProtocol || 'PLAINTEXT';
            dom.fMechanism.value = profile.saslMechanism || 'PLAIN';
            dom.fUser.value = profile.username || '';
            dom.fClientId.value = profile.clientId || '';
            dom.fTimeout.value = profile.timeoutMs || 10000;
            dom.fPassword.placeholder = profile.hasPassword ? '留空使用已保存的密码' : '';
            dom.connectTitle.textContent = '编辑连接';
            dom.btnDeleteProfile.classList.remove('hidden');
            dom.fSave.checked = true;
            updateSecurityFields();
        }
        openModal('connectModal');
        setTimeout(function () { dom.fServers.focus(); }, 30);
    }

    function connectPayload(includeIdentity) {
        var payload = {
            servers: dom.fServers.value.trim(),
            securityProtocol: dom.fSecurity.value,
            saslMechanism: dom.fMechanism.value,
            username: dom.fUser.value.trim(),
            password: dom.fPassword.value,
            clientId: dom.fClientId.value.trim(),
            timeoutMs: Number(dom.fTimeout.value) || 10000
        };
        if (includeIdentity && state.editingProfileId) {
            payload.profileId = state.editingProfileId;
        }
        return payload;
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
        state.topics = [];
        state.topic = '';
        state.detail = null;
        state.groups = [];
        state.group = '';
        state.groupDetail = null;
        state.overview = null;
        closeModal('connectModal');
        hide(dom.welcome);
        show(dom.workspace);
        setView('overview');
        renderConnBox();
        updateConnectionUi();
        renderTopics();
        clear(dom.overviewStats);
        clear(dom.brokerTable);
        await Promise.all([loadTopics(), loadOverview()]);
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
            row.appendChild(el('b', null, profile.name || profile.servers));
            row.appendChild(el('span', null, profile.servers
                + (profile.username ? ' · ' + profile.username : '')
                + (profile.lastUsedAt ? ' · ' + fmtTime(profile.lastUsedAt) : '')));
            row.addEventListener('click', function () {
                connectSaved(profile);
            });
            dom.savedProfileList.appendChild(row);
        });
    }

    async function connectSaved(profile) {
        if (state.connecting) { return; }
        try {
            await performConnect({
                profileId: profile.id,
                servers: profile.servers,
                securityProtocol: profile.securityProtocol || 'PLAINTEXT',
                saslMechanism: profile.saslMechanism || 'PLAIN',
                username: profile.username || '',
                password: '',
                clientId: profile.clientId || '',
                timeoutMs: profile.timeoutMs || 10000
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
        var payload = connectPayload(false);
        if (!payload.servers) {
            dom.connectError.textContent = '请填写 Broker 地址';
            show(dom.connectError);
            return;
        }
        hide(dom.connectError);
        try {
            if (dom.fSave.checked) {
                var saveBody = {
                    id: state.editingProfileId,
                    name: dom.fName.value.trim(),
                    servers: payload.servers,
                    securityProtocol: payload.securityProtocol,
                    saslMechanism: payload.saslMechanism,
                    username: payload.username,
                    password: payload.password,
                    clientId: payload.clientId,
                    timeoutMs: payload.timeoutMs
                };
                var saved = await api('profiles/save', saveBody);
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
        var ok = await confirmBox('断开连接', '断开当前 Kafka 连接？浏览消息的临时消费组会被关闭，不影响业务消费组。', '断开');
        if (!ok) { return; }
        var connId = state.conn ? state.conn.connectionId : '';
        state.connected = false;
        state.conn = null;
        state.connName = '';
        state.topics = [];
        state.topic = '';
        state.detail = null;
        state.groups = [];
        state.group = '';
        state.groupDetail = null;
        state.overview = null;
        state.messages = [];
        hide(dom.workspace);
        show(dom.welcome);
        renderConnBox();
        updateConnectionUi();
        renderTopics();
        if (connId) {
            try { await api('disconnect', { connectionId: connId }); } catch (e) { /* ignore */ }
        }
        toast('已断开连接', 'success');
    }

    /* ---------------- overview ---------------- */

    async function loadOverview() {
        if (!state.connected || state.loadingOverview) { return; }
        state.loadingOverview = true;
        try {
            var data = await api('overview', { connectionId: state.conn.connectionId });
            state.overview = data;
            if (state.conn) {
                state.conn.clusterId = data.clusterId;
                state.conn.topicCount = data.topicCount;
                state.conn.brokers = data.brokers;
            }
            dom.connPill.textContent = data.topicCount + ' 主题';
            renderOverview();
            renderConnBox();
        } catch (err) {
            toast(errorText(err), 'error');
        } finally {
            state.loadingOverview = false;
        }
    }

    function renderOverview() {
        var data = state.overview;
        clear(dom.overviewStats);
        clear(dom.brokerTable);
        if (!data) { return; }
        var stats = [
            ['主题', fmtNumber(data.topicCount), '包含内部主题'],
            ['分区', fmtNumber(data.partitionCount), '所有主题的分区总数'],
            ['消费组', fmtNumber(data.groupCount), '含未活跃消费组'],
            ['Broker', fmtNumber((data.brokers || []).length), 'Controller ' + (data.controller >= 0 ? data.controller : '—')]
        ];
        stats.forEach(function (item) {
            var card = el('div', 'stat-card');
            card.appendChild(el('span', null, item[0]));
            card.appendChild(el('b', null, item[1]));
            card.appendChild(el('em', null, item[2]));
            dom.overviewStats.appendChild(card);
        });
        dom.overviewCluster.textContent = '集群 ID：' + (data.clusterId || '—')
            + ' · Controller：' + (data.controller >= 0 ? data.controller : '—');

        var table = el('table');
        var thead = el('thead');
        var hr = el('tr');
        ['ID', '角色', '主机', '端口', '机架'].forEach(function (h) {
            hr.appendChild(el('th', null, h));
        });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = el('tbody');
        (data.brokers || []).forEach(function (broker) {
            var tr = el('tr');
            tr.appendChild(el('td', 'mono', String(broker.id)));
            var role = el('td');
            role.appendChild(el('span', 'badge ' + (broker.controller ? 'purple' : 'blue'),
                broker.controller ? 'Controller' : 'Broker'));
            tr.appendChild(role);
            tr.appendChild(el('td', 'mono', broker.host));
            tr.appendChild(el('td', 'num', String(broker.port)));
            tr.appendChild(el('td', null, broker.rack || '—'));
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        dom.brokerTable.appendChild(table);
        if (!(data.brokers || []).length) {
            dom.brokerTable.appendChild(el('div', 'table-empty', '没有 Broker 信息'));
        }
    }

    /* ---------------- topics ---------------- */

    async function loadTopics() {
        if (!state.connected) { return; }
        try {
            var list = await api('topics/list', { connectionId: state.conn.connectionId });
            state.topics = Array.isArray(list) ? list : [];
            renderTopics();
            if (state.topic && !state.topics.some(function (t) { return t.name === state.topic; })) {
                state.topic = '';
                state.detail = null;
                state.view = 'overview';
            }
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    function renderTopics() {
        clear(dom.topicList);
        var filter = state.topicFilter.toLowerCase();
        var list = state.topics.filter(function (t) {
            return !filter || t.name.toLowerCase().indexOf(filter) >= 0;
        });
        dom.topicCount.textContent = state.topics.length ? String(state.topics.length) : '';
        list.forEach(function (topic) {
            var item = el('button', 'topic-item' + (topic.internal ? ' internal' : '')
                + (state.topic === topic.name ? ' active' : ''));
            item.title = topic.name;
            item.appendChild(el('span', 'topic-name', topic.name));
            item.appendChild(el('span', 'topic-meta', topic.partitions + 'P'));
            item.addEventListener('click', function () {
                selectTopic(topic.name);
            });
            dom.topicList.appendChild(item);
        });
        dom.topicEmpty.classList.toggle('hidden', list.length > 0 || !state.topics.length);
        dom.topicEmpty.textContent = state.topics.length ? '没有匹配的主题' : '';
        if (!state.topics.length && state.connected) {
            dom.topicEmpty.textContent = '集群还没有主题';
            dom.topicEmpty.classList.remove('hidden');
        }
    }

    async function selectTopic(name) {
        if (!name) { return; }
        state.topic = name;
        state.topicTab = 'messages';
        state.msgPartition = -1;
        state.msgMode = 'latest';
        state.messages = [];
        state.msgInfo = '';
        state.detail = null;
        renderTopics();
        switchTab('messages');
        setView('topic');
        dom.topicName.textContent = name;
        dom.msgPartition.innerHTML = '<option value="-1">全部分区</option>';
        dom.msgOffset.classList.add('hidden');
        dom.msgMode.value = 'latest';
        dom.msgLimit.value = String(state.msgLimit);
        await loadTopicDetail();
        await fetchMessages();
    }

    async function loadTopicDetail() {
        if (!state.topic) { return; }
        try {
            var detail = await api('topic/describe', {
                connectionId: state.conn.connectionId,
                topic: state.topic
            });
            state.detail = detail;
            renderTopicDetail();
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    function renderTopicDetail() {
        var detail = state.detail;
        if (!detail) { return; }
        dom.topicName.textContent = detail.name;
        dom.viewSub.textContent = detail.name;
        clear(dom.topicBadges);
        dom.topicBadges.appendChild(el('span', 'badge blue', detail.partitions.length + ' 分区'));
        var replication = 0;
        (detail.partitions || []).forEach(function (p) {
            replication = Math.max(replication, (p.replicas || []).length);
        });
        dom.topicBadges.appendChild(el('span', 'badge green', replication + ' 副本'));
        dom.topicBadges.appendChild(el('span', 'badge gray', fmtNumber(detail.totalMessages) + ' 条消息'));
        if (detail.internal) {
            dom.topicBadges.appendChild(el('span', 'badge yellow', '内部主题'));
        }
        dom.btnDeleteTopic.disabled = !!detail.internal;
        renderPartitions();
        renderConfigs();
        renderPartitionOptions();
    }

    function renderPartitionOptions() {
        var detail = state.detail;
        var current = String(state.msgPartition);
        clear(dom.msgPartition);
        var all = el('option', null, '全部分区');
        all.value = '-1';
        dom.msgPartition.appendChild(all);
        (detail ? detail.partitions : []).forEach(function (p) {
            var option = el('option', null, '分区 ' + p.id);
            option.value = String(p.id);
            dom.msgPartition.appendChild(option);
        });
        var exists = (detail ? detail.partitions : []).some(function (p) {
            return String(p.id) === current;
        });
        dom.msgPartition.value = exists ? current : '-1';
        state.msgPartition = Number(dom.msgPartition.value);
    }

    function renderPartitions() {
        clear(dom.partitionTable);
        var detail = state.detail;
        if (!detail) { return; }
        var table = el('table');
        var thead = el('thead');
        var hr = el('tr');
        ['分区', 'Leader', '副本', 'ISR', '起始位点', '结束位点', '消息数'].forEach(function (h) {
            hr.appendChild(el('th', null, h));
        });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = el('tbody');
        (detail.partitions || []).forEach(function (p) {
            var tr = el('tr');
            tr.appendChild(el('td', 'mono', 'P' + p.id));
            tr.appendChild(el('td', 'mono', String(p.leader)));
            var replicas = el('td');
            (p.replicas || []).forEach(function (r) {
                replicas.appendChild(el('span', 'badge ' + (r === p.leader ? 'purple' : 'gray'), String(r)));
            });
            tr.appendChild(replicas);
            var isr = el('td');
            var lagging = (p.replicas || []).length - (p.isr || []).length;
            (p.isr || []).forEach(function (r) {
                isr.appendChild(el('span', 'badge ' + (lagging ? 'yellow' : 'green'), String(r)));
            });
            tr.appendChild(isr);
            tr.appendChild(el('td', 'num', fmtNumber(p.beginningOffset)));
            tr.appendChild(el('td', 'num', fmtNumber(p.endOffset)));
            tr.appendChild(el('td', 'num', fmtNumber(p.count)));
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        dom.partitionTable.appendChild(table);
    }

    function renderConfigs() {
        clear(dom.configTable);
        var detail = state.detail;
        if (!detail) { return; }
        var table = el('table');
        var thead = el('thead');
        var hr = el('tr');
        ['配置项', '值', '来源'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = el('tbody');
        (detail.configs || []).forEach(function (item) {
            var tr = el('tr');
            tr.appendChild(el('td', 'mono', item.name));
            tr.appendChild(el('td', 'mono', item.sensitive ? '******' : (item.value || '—')));
            tr.appendChild(el('td', null, item.source || '—'));
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        dom.configTable.appendChild(table);
    }

    /* ---------------- messages ---------------- */

    async function fetchMessages() {
        if (!state.connected || !state.topic || state.msgLoading) { return; }
        state.msgLoading = true;
        dom.btnFetchMessages.disabled = true;
        dom.btnFetchMessages.textContent = '拉取中…';
        try {
            var data = await api('messages/fetch', {
                connectionId: state.conn.connectionId,
                topic: state.topic,
                partition: state.msgPartition,
                mode: state.msgMode,
                offset: Number(dom.msgOffset.value) || 0,
                limit: state.msgLimit
            });
            state.messages = data.records || [];
            state.msgTruncated = !!data.truncated;
            state.msgInfo = state.messages.length + ' 条 · ' + (data.partitions || 1) + ' 个分区'
                + (state.msgTruncated ? ' · 已截断' : '');
            renderMessages();
        } catch (err) {
            toast(errorText(err), 'error');
            state.msgInfo = '';
            dom.msgHint.textContent = '';
        } finally {
            state.msgLoading = false;
            dom.btnFetchMessages.disabled = false;
            dom.btnFetchMessages.textContent = '拉取';
        }
    }

    function renderMessages() {
        clear(dom.msgTable);
        dom.msgHint.textContent = state.msgInfo;
        dom.msgEmpty.classList.toggle('hidden', state.messages.length > 0);
        if (!state.messages.length) {
            return;
        }
        var table = el('table');
        var thead = el('thead');
        var hr = el('tr');
        ['分区', '位点', '时间', 'Key', 'Value', '大小'].forEach(function (h) {
            hr.appendChild(el('th', null, h));
        });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = el('tbody');
        state.messages.forEach(function (record, index) {
            var tr = el('tr', 'clickable');
            tr.appendChild(el('td', 'mono', 'P' + record.partition));
            tr.appendChild(el('td', 'num', fmtNumber(record.offset)));
            tr.appendChild(el('td', 'mono', fmtTime(record.timestamp)));
            var key = el('td', 'msg-cell' + (record.key ? '' : ' dim'), record.key ? preview(record.key, record.keyEncoding) : '—');
            tr.appendChild(key);
            tr.appendChild(el('td', 'msg-cell', preview(record.value, record.valueEncoding)));
            tr.appendChild(el('td', 'num', fmtBytes(record.size)));
            tr.addEventListener('click', function () {
                openMessage(record);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        dom.msgTable.appendChild(table);
    }

    function openMessage(record) {
        state.message = record;
        dom.messageTitle.textContent = '消息详情 · P' + record.partition + ' @ ' + record.offset;
        clear(dom.messageMeta);
        var meta = [
            ['主题', state.topic],
            ['分区', String(record.partition)],
            ['位点', String(record.offset)],
            ['时间', fmtTime(record.timestamp)],
            ['时间类型', record.timestampType || '—'],
            ['大小', fmtBytes(record.size)]
        ];
        meta.forEach(function (item) {
            var wrap = el('span', null, item[0]);
            wrap.appendChild(el('b', null, item[1]));
            dom.messageMeta.appendChild(wrap);
        });
        dom.messageKey.textContent = record.key ? prettyMaybe(record.key, record.keyEncoding) : '（空）';
        dom.messageValue.textContent = record.value
            ? prettyMaybe(record.value, record.valueEncoding)
            : '（空）';
        clear(dom.messageHeaders);
        var headers = record.headers || [];
        headers.forEach(function (header) {
            var row = el('div', 'header-row');
            row.appendChild(el('b', null, header.key));
            row.appendChild(el('span', null, header.encoding === 'base64'
                ? 'base64: ' + header.value : header.value));
            dom.messageHeaders.appendChild(row);
        });
        dom.messageHeadersWrap.classList.toggle('hidden', !headers.length);
        openModal('messageModal');
    }

    function copyText(text, label) {
        var value = text == null ? '' : String(text);
        var done = function () { toast(label + '已复制', 'success'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value).then(done).catch(function () { fallbackCopy(value); done(); });
            return;
        }
        fallbackCopy(value);
        done();
    }

    function fallbackCopy(value) {
        var area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try { document.execCommand('copy'); } catch (e) { /* ignore */ }
        document.body.removeChild(area);
    }

    /* ---------------- groups ---------------- */

    async function loadGroups() {
        if (!state.connected || state.groupsLoading) { return; }
        state.groupsLoading = true;
        try {
            var list = await api('groups/list', { connectionId: state.conn.connectionId });
            state.groups = Array.isArray(list) ? list : [];
            dom.groupCount.textContent = state.groups.length ? String(state.groups.length) : '';
            if (state.view === 'groups') {
                dom.viewSub.textContent = state.groups.length + ' 个消费组';
            }
            renderGroups();
        } catch (err) {
            toast(errorText(err), 'error');
        } finally {
            state.groupsLoading = false;
        }
    }

    function renderGroups() {
        clear(dom.groupsTable);
        dom.groupsHint.textContent = state.groups.length ? state.groups.length + ' 个消费组' : '';
        if (!state.groups.length) {
            dom.groupsTable.appendChild(el('div', 'table-empty', '集群没有消费组'));
            return;
        }
        var table = el('table');
        var thead = el('thead');
        var hr = el('tr');
        ['消费组', '状态', '成员', '订阅主题'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = el('tbody');
        state.groups.forEach(function (group) {
            var tr = el('tr', 'clickable' + (state.group === group.groupId ? ' selected' : ''));
            tr.appendChild(el('td', 'mono', group.groupId));
            var stateCell = el('td');
            stateCell.appendChild(el('span', 'status-dot ' + groupStateClass(group.state)));
            stateCell.appendChild(document.createTextNode(group.state || '—'));
            tr.appendChild(stateCell);
            tr.appendChild(el('td', 'num', String(group.members || 0)));
            tr.appendChild(el('td', null, (group.topics || []).join(', ') || '—'));
            tr.addEventListener('click', function () { selectGroup(group.groupId); });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        dom.groupsTable.appendChild(table);
    }

    function groupStateClass(value) {
        var s = String(value || '').toLowerCase();
        if (s === 'stable') { return 'green'; }
        if (s === 'dead' || s === 'empty') { return 'yellow'; }
        if (s.indexOf('preparing') >= 0 || s.indexOf('rebalancing') >= 0) { return 'yellow'; }
        return '';
    }

    async function selectGroup(groupId) {
        state.group = groupId;
        renderGroups();
        dom.groupDetailTitle.textContent = groupId;
        dom.groupDetailMeta.textContent = '';
        dom.groupDetail.textContent = '加载中…';
        dom.groupDetail.className = 'group-detail-empty';
        try {
            var detail = await api('groups/detail', {
                connectionId: state.conn.connectionId,
                groupId: groupId
            });
            state.groupDetail = detail;
            renderGroupDetail();
        } catch (err) {
            dom.groupDetail.textContent = errorText(err);
            toast(errorText(err), 'error');
        }
    }

    function renderGroupDetail() {
        var detail = state.groupDetail;
        if (!detail) { return; }
        dom.groupDetail.className = '';
        clear(dom.groupDetail);
        dom.groupDetailTitle.textContent = detail.groupId;
        dom.groupDetailMeta.textContent = '状态 ' + (detail.state || '—')
            + ' · 协议 ' + (detail.protocol || '—')
            + ' · ' + (detail.members || []).length + ' 个成员';

        var members = el('div', 'group-section');
        var mh = el('h4', null, '成员');
        members.appendChild(mh);
        var list = el('div', 'group-members');
        if (!(detail.members || []).length) {
            list.appendChild(el('div', 'muted', '没有在线成员'));
        }
        (detail.members || []).forEach(function (member) {
            var item = el('div', 'group-member');
            item.appendChild(el('b', null, member.clientId || member.memberId));
            item.appendChild(el('span', null, member.host + ' · ' + member.memberId));
            if (member.assignment && member.assignment.length) {
                item.appendChild(el('span', null, '分配：' + member.assignment.join(', ')));
            }
            list.appendChild(item);
        });
        members.appendChild(list);
        dom.groupDetail.appendChild(members);

        var offsets = el('div', 'group-section');
        var head = el('h4', null, '分区位点');
        var total = el('span', 'group-lag-total' + (detail.totalLag > 1000 ? ' high' : ''),
            '总堆积 ' + fmtNumber(detail.totalLag));
        head.appendChild(document.createTextNode(' '));
        head.appendChild(total);
        offsets.appendChild(head);
        var table = el('table');
        var thead = el('thead');
        var hr = el('tr');
        ['主题', '分区', '已提交', '结束位点', '堆积'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = el('tbody');
        (detail.offsets || []).forEach(function (item) {
            var tr = el('tr');
            tr.appendChild(el('td', 'mono', item.topic));
            tr.appendChild(el('td', 'mono', 'P' + item.partition));
            tr.appendChild(el('td', 'num', item.current < 0 ? '—' : fmtNumber(item.current)));
            tr.appendChild(el('td', 'num', fmtNumber(item.end)));
            var lag = el('td', 'num', item.lag < 0 ? '—' : fmtNumber(item.lag));
            tr.appendChild(lag);
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        offsets.appendChild(table);
        dom.groupDetail.appendChild(offsets);
    }

    /* ---------------- topic actions ---------------- */

    function openProduce() {
        if (!state.topic) { return; }
        dom.pTopic.value = state.topic;
        dom.pPartition.value = '-1';
        dom.pKey.value = '';
        dom.pValue.value = '';
        dom.pHeaders.value = '';
        hide(dom.produceError);
        openModal('produceModal');
        setTimeout(function () { dom.pKey.focus(); }, 30);
    }

    function parseHeaders(text) {
        var out = [];
        (text || '').split(/\r?\n/).forEach(function (line) {
            var value = line.trim();
            if (!value) { return; }
            var index = value.indexOf('=');
            if (index <= 0) {
                throw new Error('Headers 行格式应为 key=value：' + value);
            }
            out.push({ key: value.substring(0, index).trim(), value: value.substring(index + 1) });
        });
        return out;
    }

    async function sendMessage() {
        if (!state.topic) { return; }
        var value = dom.pValue.value;
        if (!value) {
            dom.produceError.textContent = '请填写消息内容';
            show(dom.produceError);
            return;
        }
        var headers;
        try {
            headers = parseHeaders(dom.pHeaders.value);
        } catch (e) {
            dom.produceError.textContent = e.message;
            show(dom.produceError);
            return;
        }
        hide(dom.produceError);
        dom.btnSendMessage.disabled = true;
        dom.btnSendMessage.textContent = '发送中…';
        try {
            var result = await api('message/produce', {
                connectionId: state.conn.connectionId,
                topic: state.topic,
                key: dom.pKey.value,
                value: value,
                partition: Number(dom.pPartition.value) || -1,
                headers: headers
            });
            closeModal('produceModal');
            toast('已发送到 P' + result.partition + ' @ ' + result.offset, 'success');
            await loadTopicDetail();
            if (state.msgMode === 'latest') { await fetchMessages(); }
        } catch (err) {
            dom.produceError.textContent = errorText(err);
            show(dom.produceError);
            toast(errorText(err), 'error');
        } finally {
            dom.btnSendMessage.disabled = false;
            dom.btnSendMessage.textContent = '发送';
        }
    }

    function parseConfigs(text) {
        var out = {};
        (text || '').split(/\r?\n/).forEach(function (line) {
            var value = line.trim();
            if (!value || value.charAt(0) === '#') { return; }
            var index = value.indexOf('=');
            if (index <= 0) {
                throw new Error('配置行格式应为 key=value：' + value);
            }
            out[value.substring(0, index).trim()] = value.substring(index + 1).trim();
        });
        return out;
    }

    async function createTopic() {
        var name = dom.tName.value.trim();
        if (!name) {
            dom.topicError.textContent = '请填写主题名称';
            show(dom.topicError);
            return;
        }
        if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
            dom.topicError.textContent = '主题名称只能包含字母、数字、点、下划线、短横线';
            show(dom.topicError);
            return;
        }
        var configs;
        try {
            configs = parseConfigs(dom.tConfigs.value);
        } catch (e) {
            dom.topicError.textContent = e.message;
            show(dom.topicError);
            return;
        }
        hide(dom.topicError);
        dom.btnCreateTopic.disabled = true;
        dom.btnCreateTopic.textContent = '创建中…';
        try {
            await api('topic/create', {
                connectionId: state.conn.connectionId,
                topic: name,
                partitions: Number(dom.tPartitions.value) || 1,
                replication: Number(dom.tReplication.value) || 1,
                configs: configs
            });
            closeModal('topicModal');
            dom.tName.value = '';
            await loadTopics();
            toast('主题已创建：' + name, 'success');
            selectTopic(name);
        } catch (err) {
            dom.topicError.textContent = errorText(err);
            show(dom.topicError);
        } finally {
            dom.btnCreateTopic.disabled = false;
            dom.btnCreateTopic.textContent = '创建';
        }
    }

    function openAddPartitions() {
        if (!state.detail) { return; }
        var count = state.detail.partitions.length;
        dom.partitionsNote.textContent = '当前 ' + count + ' 个分区。Kafka 只允许增加分区，减少分区需要重建主题。';
        dom.newPartitionTotal.value = String(count + 1);
        dom.newPartitionTotal.min = String(count + 1);
        hide(dom.partitionsError);
        openModal('partitionsModal');
    }

    async function confirmPartitions() {
        if (!state.detail) { return; }
        var total = Number(dom.newPartitionTotal.value) || 0;
        if (total <= state.detail.partitions.length) {
            dom.partitionsError.textContent = '分区总数必须大于当前分区数';
            show(dom.partitionsError);
            return;
        }
        hide(dom.partitionsError);
        dom.btnConfirmPartitions.disabled = true;
        try {
            await api('topic/partitions/add', {
                connectionId: state.conn.connectionId,
                topic: state.topic,
                total: total
            });
            closeModal('partitionsModal');
            toast('分区已增加到 ' + total, 'success');
            await loadTopicDetail();
        } catch (err) {
            dom.partitionsError.textContent = errorText(err);
            show(dom.partitionsError);
        } finally {
            dom.btnConfirmPartitions.disabled = false;
        }
    }

    async function deleteTopic() {
        if (!state.topic) { return; }
        if (state.detail && state.detail.internal) {
            toast('内部主题不能删除', 'error');
            return;
        }
        var ok = await confirmBox('删除主题',
            '删除主题「' + state.topic + '」？主题中的全部消息和消费位点都会丢失，此操作不可撤销。',
            '删除');
        if (!ok) { return; }
        try {
            await api('topic/delete', {
                connectionId: state.conn.connectionId,
                topic: state.topic
            });
            var name = state.topic;
            state.topic = '';
            state.detail = null;
            state.messages = [];
            await loadTopics();
            setView('overview');
            await loadOverview();
            toast('主题已删除：' + name, 'success');
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    /* ---------------- tabs / refresh ---------------- */

    function switchTab(tab) {
        state.topicTab = tab;
        var tabs = document.querySelectorAll('.tabs .tab');
        Array.prototype.forEach.call(tabs, function (node) {
            node.classList.toggle('active', node.getAttribute('data-tab') === tab);
        });
        hide(dom.tabMessages);
        hide(dom.tabPartitions);
        hide(dom.tabConfigs);
        if (tab === 'messages') { show(dom.tabMessages); }
        if (tab === 'partitions') { show(dom.tabPartitions); }
        if (tab === 'configs') { show(dom.tabConfigs); }
    }

    async function refresh() {
        if (!state.connected) { return; }
        if (state.view === 'overview') {
            await Promise.all([loadTopics(), loadOverview()]);
            toast('已刷新', 'success');
            return;
        }
        if (state.view === 'groups') {
            await loadGroups();
            if (state.group) { await selectGroup(state.group); }
            toast('已刷新', 'success');
            return;
        }
        await loadTopics();
        if (!state.topic) {
            setView('overview');
            await loadOverview();
        } else {
            await loadTopicDetail();
            await fetchMessages();
        }
        toast('已刷新', 'success');
    }

    /* ---------------- init ---------------- */

    function bind() {
        IDS.forEach(function (id) { dom[id] = $(id); });

        dom.btnOpenConnect.addEventListener('click', function () { openConnectModal(null); });
        dom.btnNewTopicSide.addEventListener('click', function () {
            if (!state.connected) { openConnectModal(null); return; }
            dom.tName.value = '';
            dom.tPartitions.value = '3';
            dom.tReplication.value = '1';
            dom.tConfigs.value = '';
            hide(dom.topicError);
            openModal('topicModal');
            setTimeout(function () { dom.tName.focus(); }, 30);
        });
        dom.btnDisconnect.addEventListener('click', disconnect);
        dom.btnConnect.addEventListener('click', submitConnect);
        dom.btnDeleteProfile.addEventListener('click', deleteProfile);
        dom.fSecurity.addEventListener('change', updateSecurityFields);
        dom.fServers.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { submitConnect(); }
        });
        dom.fPassword.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { submitConnect(); }
        });

        dom.navOverview.addEventListener('click', function () {
            setView('overview');
            if (state.connected) { loadOverview(); }
        });
        dom.navGroups.addEventListener('click', function () {
            if (!state.connected) { return; }
            setView('groups');
            loadGroups();
        });
        dom.quickGroups.addEventListener('click', function () {
            setView('groups');
            loadGroups();
        });
        dom.quickLatest.addEventListener('click', function () {
            if (!state.topics.length) {
                toast('集群没有主题', 'error');
                return;
            }
            selectTopic(state.topics[0].name);
            toast('已选择主题 ' + state.topics[0].name, 'success');
        });
        dom.btnRefresh.addEventListener('click', refresh);

        dom.topicSearch.addEventListener('input', function () {
            state.topicFilter = dom.topicSearch.value.trim();
            renderTopics();
        });
        dom.tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs .tab'));
        dom.tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                var name = tab.getAttribute('data-tab');
                if (!state.detail && name !== 'messages') { return; }
                switchTab(name);
            });
        });

        dom.msgMode.addEventListener('change', function () {
            state.msgMode = dom.msgMode.value;
            dom.msgOffset.classList.toggle('hidden', state.msgMode !== 'offset');
            if (state.msgMode === 'offset') { dom.msgOffset.focus(); }
        });
        dom.msgPartition.addEventListener('change', function () {
            state.msgPartition = Number(dom.msgPartition.value);
        });
        dom.msgLimit.addEventListener('change', function () {
            state.msgLimit = Number(dom.msgLimit.value) || 20;
        });
        dom.btnFetchMessages.addEventListener('click', fetchMessages);
        dom.msgOffset.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { fetchMessages(); }
        });

        dom.btnProduce.addEventListener('click', openProduce);
        dom.btnSendMessage.addEventListener('click', sendMessage);
        dom.btnCreateTopic.addEventListener('click', createTopic);
        dom.btnAddPartitions.addEventListener('click', openAddPartitions);
        dom.btnConfirmPartitions.addEventListener('click', confirmPartitions);
        dom.btnDeleteTopic.addEventListener('click', deleteTopic);
        dom.btnCopyKey.addEventListener('click', function () {
            copyText(state.message ? state.message.key : '', 'Key ');
        });
        dom.btnCopyValue.addEventListener('click', function () {
            copyText(state.message ? state.message.value : '', 'Value ');
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
            ['connectModal', 'produceModal', 'topicModal', 'partitionsModal', 'messageModal']
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
        renderTopics();
        updateConnectionUi();
        renderConnBox();
        loadProfiles();
    }

    init();
})();
