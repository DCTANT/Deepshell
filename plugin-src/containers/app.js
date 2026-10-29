(function () {
    'use strict';

    var state = {
        connected: false,
        connecting: false,
        type: '',
        conn: null,
        profiles: [],
        view: 'overview',
        formType: 'docker',
        editingProfileId: '',
        pendingConnect: null,
        confirmAction: null,
        logs: null,
        exec: null,
        scale: null,
        docker: {
            info: null,
            df: [],
            containers: [],
            stats: [],
            images: [],
            volumes: [],
            networks: [],
            filter: '',
            runningOnly: false,
            imageFilter: ''
        },
        kube: {
            nodes: [],
            namespaces: [],
            pods: [],
            deployments: [],
            services: [],
            events: [],
            namespace: '',
            podFilter: '',
            contexts: [],
            currentContext: '',
            version: ''
        }
    };

    var dom = {};
    var IDS = [
        'connBox', 'sideNav', 'btnDisconnect', 'welcome', 'workspace', 'savedProfiles',
        'savedProfileList', 'viewTitle', 'viewSub', 'viewHost', 'nsFilter', 'connPill',
        'btnRefresh', 'toast', 'connectModal', 'connectTitle', 'connectError', 'fName',
        'dockerFields', 'fDockerMode', 'fDockerCmd', 'fDockerContext', 'sshFields',
        'fSshHost', 'fSshPort', 'fSshUser', 'fSshAuth', 'passwordField', 'fSshPassword',
        'keyFields', 'fSshKey', 'fSshPassphrase', 'kubeFields', 'fKubectlCmd', 'fKubeContext',
        'fKubeconfig', 'fKubeconfigFile', 'fTimeout', 'fSave', 'btnDeleteProfile', 'btnConnect',
        'trustModal', 'trustHost', 'trustType', 'trustFingerprint', 'trustError', 'btnTrustConnect',
        'confirmModal', 'confirmTitle', 'confirmMessage', 'btnConfirmOk',
        'logsModal', 'logsTitle', 'logsTail', 'btnReloadLogs', 'logsContainerWrap', 'logsContainer',
        'logsOutput', 'execModal', 'execTitle', 'execContainerWrap', 'execContainer', 'execShell',
        'execCommand', 'btnRunExec', 'execStatus', 'execOutput', 'viewModal', 'viewModalTitle',
        'viewModalBody', 'pullModal', 'pullRef', 'pullError', 'btnPull', 'scaleModal', 'scaleTitle',
        'scaleReplicas', 'scaleError', 'btnScale'
    ];

    var NAV = {
        overview: { label: '概览', icon: 'grid' },
        containers: { label: '容器', icon: 'box' },
        images: { label: '镜像', icon: 'layers' },
        volumes: { label: '卷', icon: 'db' },
        networks: { label: '网络', icon: 'share' },
        nodes: { label: '节点', icon: 'server' },
        pods: { label: 'Pod', icon: 'hex' },
        deployments: { label: 'Deployment', icon: 'deploy' },
        services: { label: 'Service', icon: 'link' },
        events: { label: '事件', icon: 'bell' }
    };
    var DOCKER_NAV = ['overview', 'containers', 'images', 'volumes', 'networks'];
    var KUBE_NAV = ['overview', 'nodes', 'pods', 'deployments', 'services', 'events'];

    function $(id) { return document.getElementById(id); }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function icon(name) {
        var paths = {
            grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"></rect><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"></rect><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"></rect><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"></rect>',
            box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"></path><path d="M4 7.5l8 4.5 8-4.5"></path><path d="M12 12v9"></path>',
            layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"></path><path d="M3 12l9 5 9-5"></path><path d="M3 16l9 5 9-5"></path>',
            db: '<ellipse cx="12" cy="5.5" rx="7" ry="3"></ellipse><path d="M5 5.5v13c0 1.7 3.1 3 7 3s7-1.3 7-3v-13"></path><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"></path>',
            share: '<circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="6" r="2.5"></circle><circle cx="18" cy="18" r="2.5"></circle><path d="M8.3 10.8l7.4-3.6"></path><path d="M8.3 13.2l7.4 3.6"></path>',
            server: '<rect x="3.5" y="4.5" width="17" height="6" rx="2"></rect><rect x="3.5" y="13.5" width="17" height="6" rx="2"></rect><path d="M7 7.5h.01M7 16.5h.01"></path>',
            hex: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9L12 3z"></path><path d="M8.5 10.5h7M8.5 13.5h7"></path>',
            deploy: '<path d="M12 3l6 6-6 12-6-12 6-6z"></path><circle cx="12" cy="9" r="1.6"></circle>',
            link: '<path d="M10 13a5 5 0 0 0 7.1 0l1.4-1.4a5 5 0 0 0-7.1-7.1L10 5.9"></path><path d="M14 11a5 5 0 0 0-7.1 0l-1.4 1.4a5 5 0 0 0 7.1 7.1l1.4-1.4"></path>',
            bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path>'
        };
        return '<svg class="ico" viewBox="0 0 24 24">' + (paths[name] || paths.grid) + '</svg>';
    }

    function toast(message, type) {
        dom.toast.textContent = message;
        dom.toast.className = 'toast ' + (type || '');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(function () { dom.toast.className = 'toast hidden'; }, 3200);
    }

    function api(action, payload, timeoutMs) {
        return new Promise(function (resolve, reject) {
            if (window.parent === window) {
                reject(new Error('请从 DeepShell 可视化桌面打开此应用'));
                return;
            }
            var id = 'cq' + (++api.seq) + '-' + Date.now();
            var timer = setTimeout(function () {
                delete api.pending[id];
                reject(new Error('请求超时，请检查 docker / kubectl 命令是否可用'));
            }, timeoutMs || 90000);
            api.pending[id] = { resolve: resolve, reject: reject, timer: timer };
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
                delete api.pending[id];
                reject(e);
            }
        });
    }
    api.pending = {};
    api.seq = 0;

    window.addEventListener('message', function (ev) {
        var msg = ev.data;
        if (!msg || msg.source !== 'deepshell-host' || msg.type !== 'plugin.invoke.result') {
            return;
        }
        var item = api.pending[msg.requestId];
        if (!item) { return; }
        clearTimeout(item.timer);
        delete api.pending[msg.requestId];
        if (msg.ok) {
            item.resolve(msg.data);
        } else {
            item.reject(new Error(msg.error || '插件请求失败'));
        }
    });

    function openModal(id) { $(id).classList.remove('hidden'); }
    function closeModal(id) { $(id).classList.add('hidden'); }
    function modalOpen(id) { return !$(id).classList.contains('hidden'); }

    function parseJson(text, fallback) {
        if (text == null) { return fallback; }
        var value = String(text).trim();
        if (!value) { return fallback; }
        try { return JSON.parse(value); } catch (e) { /* 继续尝试截取 */ }
        var a = value.indexOf('{');
        var b = value.indexOf('[');
        var start = a < 0 ? b : (b < 0 ? a : Math.min(a, b));
        if (start > 0) {
            try { return JSON.parse(value.substring(start)); } catch (e2) { /* ignore */ }
        }
        return fallback;
    }

    function parseLines(text) {
        var out = [];
        String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
            var value = line.trim();
            if (!value) { return; }
            try {
                var obj = JSON.parse(value);
                if (obj && typeof obj === 'object') { out.push(obj); }
            } catch (e) { /* 忽略非 JSON 行 */ }
        });
        return out;
    }

    function outputOf(resp) {
        return resp && resp.output != null ? String(resp.output) : '';
    }

    function fmtBytes(value) {
        if (value == null || value === '') { return '—'; }
        if (typeof value === 'string' && /[a-zA-Z]/.test(value)) { return value; }
        var n = Number(value);
        if (!isFinite(n)) { return String(value); }
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = 0;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return (i === 0 ? Math.round(n) : n.toFixed(n >= 100 ? 0 : 1)) + ' ' + units[i];
    }

    function parseDateValue(value) {
        if (value == null || value === '') { return NaN; }
        if (typeof value === 'number') { return value; }
        var text = String(value).trim();
        // Docker 的 CreatedAt 形如 "2026-10-29 10:12:03 +0800 CST"，
        // 末尾的 CST 会被浏览器误判为美国中部时间，先去掉时区缩写
        text = text.replace(/([+-]\d{2}:?\d{2})\s+[A-Za-z]{2,6}$/, '$1');
        var t = Date.parse(text);
        if (isFinite(t)) { return t; }
        return Date.parse(text.replace(' ', 'T'));
    }

    function fmtAge(timestamp) {
        if (!timestamp) { return '—'; }
        var t = parseDateValue(timestamp);
        if (!isFinite(t)) { return '—'; }
        var diff = Math.max(0, Date.now() - t);
        var sec = Math.floor(diff / 1000);
        if (sec < 60) { return sec + ' 秒'; }
        var min = Math.floor(sec / 60);
        if (min < 60) { return min + ' 分'; }
        var hour = Math.floor(min / 60);
        if (hour < 24) { return hour + ' 时'; }
        var day = Math.floor(hour / 24);
        if (day < 30) { return day + ' 天'; }
        return Math.floor(day / 30) + ' 月';
    }

    function fmtTime(value) {
        if (!value) { return '—'; }
        var t = parseDateValue(value);
        if (!isFinite(t)) { return String(value); }
        var d = new Date(t);
        var p = function (x) { return (x < 10 ? '0' : '') + x; };
        return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function badge(text, color) {
        return '<span class="badge ' + (color || 'gray') + '">' + esc(text) + '</span>';
    }

    function stateBadge(value) {
        var v = String(value || '').toLowerCase();
        if (v === 'running' || v === 'up' || v === 'succeeded' || v === 'ready') {
            return badge(value, v === 'succeeded' ? 'blue' : 'green');
        }
        if (v === 'exited' || v === 'failed' || v === 'notready' || v === 'error') {
            return badge(value, 'red');
        }
        if (v === 'paused' || v === 'pending' || v === 'restarting' || v === 'warning') {
            return badge(value, 'yellow');
        }
        return badge(value || '—', 'gray');
    }

    function containerBadge(container) {
        var stateValue = String(container.State || '').toLowerCase();
        var color = stateValue === 'running' ? 'green'
            : (stateValue === 'exited' || stateValue === 'dead' ? 'red'
                : (stateValue === 'paused' || stateValue === 'restarting' ? 'yellow' : 'gray'));
        return badge(container.Status || container.State || '—', color);
    }

    function typeBadge(type) {
        return type === 'kubernetes'
            ? '<span class="badge purple">K8s</span>'
            : '<span class="badge blue">Docker</span>';
    }

    function emptyBlock(title, sub) {
        return '<div class="empty-block">' + esc(title)
            + (sub ? '<br><small>' + esc(sub) + '</small>' : '') + '</div>';
    }

    function table(headers, rows, emptyText) {
        if (!rows || !rows.length) {
            return emptyBlock(emptyText || '暂无数据');
        }
        var html = '<div class="table-wrap"><table><thead><tr>';
        headers.forEach(function (h) {
            html += '<th' + (h.right ? ' style="text-align:right"' : '') + '>' + esc(h.label) + '</th>';
        });
        html += '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
        return html;
    }

    function card(title, sub, body, extraClass) {
        return '<section class="card ' + (extraClass || '') + '">'
            + '<div class="card-head"><b>' + esc(title) + '</b><span class="muted">' + esc(sub || '') + '</span></div>'
            + body + '</section>';
    }

    /* ---------------- boot ---------------- */

    function init() {
        IDS.forEach(function (id) { dom[id] = $(id); });
        bindEvents();
        loadProfiles();
        renderWelcome();
    }

    function bindEvents() {
        document.addEventListener('click', function (e) {
            var closer = e.target.closest('[data-close]');
            if (closer) {
                closeModal(closer.getAttribute('data-close'));
            }
        });

        document.getElementById('welcome').addEventListener('click', function (e) {
            var typeCard = e.target.closest('.type-card');
            if (typeCard) {
                openConnectModal(typeCard.getAttribute('data-type'), null);
                return;
            }
            var profileItem = e.target.closest('.saved-item');
            if (profileItem) {
                var profile = state.profiles.find(function (p) { return p.id === profileItem.getAttribute('data-id'); });
                if (profile) { openConnectModal(profile.type, profile); }
            }
        });

        dom.btnDisconnect.addEventListener('click', disconnect);
        dom.btnRefresh.addEventListener('click', function () { loadView(state.view, true); });
        dom.btnConnect.addEventListener('click', submitConnect);
        dom.btnTrustConnect.addEventListener('click', trustAndConnect);
        dom.btnConfirmOk.addEventListener('click', function () {
            var action = state.confirmAction;
            state.confirmAction = null;
            closeModal('confirmModal');
            if (action) { action(); }
        });
        dom.fDockerMode.addEventListener('change', toggleDockerMode);
        dom.fSshAuth.addEventListener('change', toggleSshAuth);
        dom.fKubeconfigFile.addEventListener('change', readKubeconfigFile);
        dom.btnDeleteProfile.addEventListener('click', deleteEditingProfile);
        dom.btnReloadLogs.addEventListener('click', loadLogs);
        dom.logsTail.addEventListener('change', loadLogs);
        dom.btnRunExec.addEventListener('click', runExec);
        dom.btnPull.addEventListener('click', pullImage);
        dom.btnScale.addEventListener('click', scaleDeployment);
        dom.nsFilter.addEventListener('change', function () {
            state.kube.namespace = dom.nsFilter.value;
            loadView(state.view, true);
        });

        dom.sideNav.addEventListener('click', function (e) {
            var item = e.target.closest('.nav-item');
            if (item) { setView(item.getAttribute('data-view')); }
        });

        dom.viewHost.addEventListener('click', onViewClick);
        dom.viewHost.addEventListener('input', onViewInput);
        dom.viewHost.addEventListener('change', onViewInput);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                ['viewModal', 'pullModal', 'scaleModal', 'execModal', 'logsModal',
                    'confirmModal', 'trustModal', 'connectModal'].some(function (id) {
                    if (modalOpen(id)) { closeModal(id); return true; }
                    return false;
                });
            }
        });
    }

    /* ---------------- profiles / welcome ---------------- */

    function loadProfiles() {
        return api('profiles/list', {}).then(function (list) {
            state.profiles = list || [];
            renderSavedProfiles();
        }).catch(function () {
            state.profiles = [];
            renderSavedProfiles();
        });
    }

    function renderWelcome() {
        dom.welcome.classList.remove('hidden');
        dom.workspace.classList.add('hidden');
        dom.sideNav.innerHTML = '';
        dom.btnDisconnect.classList.add('hidden');
        dom.nsFilter.classList.add('hidden');
        dom.connPill.textContent = '';
        dom.connBox.innerHTML = '<div class="conn-empty">尚未连接</div>';
        renderSavedProfiles();
    }

    function renderSavedProfiles() {
        if (!state.profiles.length) {
            dom.savedProfiles.classList.add('hidden');
            return;
        }
        dom.savedProfiles.classList.remove('hidden');
        var html = '';
        state.profiles.forEach(function (p) {
            var target = p.type === 'kubernetes'
                ? (p.kubeContext || '默认 context')
                : (p.mode === 'ssh' ? (p.sshUser + '@' + p.sshHost) : (p.dockerContext || '本机 Docker'));
            html += '<button class="saved-item" data-id="' + esc(p.id) + '" title="点击编辑并连接">'
                + typeBadge(p.type)
                + '<b>' + esc(p.name || target) + '</b>'
                + '<span>' + esc(target) + '</span>'
                + '</button>';
        });
        dom.savedProfileList.innerHTML = html;
    }

    /* ---------------- connect flow ---------------- */

    function openConnectModal(type, profile) {
        state.formType = type || 'docker';
        state.editingProfileId = profile ? profile.id : '';
        dom.connectError.classList.add('hidden');
        dom.connectError.textContent = '';
        dom.connectTitle.textContent = profile ? ('编辑连接 · ' + (profile.name || '')) : ('连接 ' + (state.formType === 'docker' ? 'Docker' : 'Kubernetes'));
        dom.btnDeleteProfile.classList.toggle('hidden', !profile);

        dom.fName.value = profile ? (profile.name || '') : '';
        dom.fTimeout.value = profile ? (profile.timeoutMs || 20000) : 20000;
        dom.fSave.checked = true;

        dom.fDockerCmd.value = profile ? (profile.dockerCmd || 'docker') : 'docker';
        dom.fDockerMode.value = profile ? (profile.mode || 'local') : 'local';
        dom.fDockerContext.value = profile ? (profile.dockerContext || '') : '';
        dom.fSshHost.value = profile ? (profile.sshHost || '') : '';
        dom.fSshPort.value = profile ? (profile.sshPort || 22) : 22;
        dom.fSshUser.value = profile ? (profile.sshUser || '') : '';
        dom.fSshAuth.value = profile ? (profile.sshAuth || 'password') : 'password';
        dom.fSshPassword.value = '';
        dom.fSshKey.value = '';
        dom.fSshPassphrase.value = '';
        dom.fSshPassword.placeholder = profile && profile.hasPassword ? '已保存密码，留空保持不变' : '请输入 SSH 密码';
        dom.fSshKey.placeholder = profile && profile.hasKey
            ? '已保存私钥，留空保持不变'
            : '-----BEGIN OPENSSH PRIVATE KEY-----';

        dom.fKubectlCmd.value = profile ? (profile.kubectlCmd || 'kubectl') : 'kubectl';
        dom.fKubeContext.value = profile ? (profile.kubeContext || '') : '';
        dom.fKubeconfig.value = '';
        dom.fKubeconfig.placeholder = profile && profile.hasKubeconfig
            ? '已保存 kubeconfig，留空保持不变；留空且无已保存配置时使用本机默认 ~/.kube/config'
            : 'apiVersion: v1\nkind: Config\n...';
        dom.fKubeconfigFile.value = '';

        toggleConnectType(state.formType);
        toggleDockerMode();
        toggleSshAuth();
        openModal('connectModal');
        setTimeout(function () { dom.fName.focus(); }, 50);
    }

    function toggleConnectType(type) {
        state.formType = type;
        var docker = type === 'docker';
        dom.dockerFields.classList.toggle('hidden', !docker);
        dom.kubeFields.classList.toggle('hidden', docker);
        dom.connectTitle.textContent = state.editingProfileId
            ? '编辑连接' : ('连接 ' + (docker ? 'Docker' : 'Kubernetes'));
    }

    function toggleDockerMode() {
        var ssh = dom.fDockerMode.value === 'ssh';
        dom.sshFields.classList.toggle('hidden', !ssh);
        dom.fDockerContext.disabled = ssh;
    }

    function toggleSshAuth() {
        var key = dom.fSshAuth.value === 'key';
        dom.passwordField.classList.toggle('hidden', key);
        dom.keyFields.classList.toggle('hidden', !key);
    }

    function readKubeconfigFile() {
        var file = dom.fKubeconfigFile.files && dom.fKubeconfigFile.files[0];
        if (!file) { return; }
        var reader = new FileReader();
        reader.onload = function () {
            dom.fKubeconfig.value = String(reader.result || '');
            toast('已读取 kubeconfig：' + file.name, 'success');
        };
        reader.readAsText(file);
    }

    function formPayload() {
        var type = state.formType;
        var p = {
            type: type,
            name: dom.fName.value.trim(),
            timeoutMs: Number(dom.fTimeout.value) || 20000
        };
        if (state.editingProfileId) {
            p.profileId = state.editingProfileId;
        }
        if (type === 'docker') {
            p.mode = dom.fDockerMode.value;
            p.dockerCmd = dom.fDockerCmd.value.trim() || 'docker';
            p.dockerContext = dom.fDockerContext.value.trim();
            if (p.mode === 'ssh') {
                p.sshHost = dom.fSshHost.value.trim();
                p.sshPort = Number(dom.fSshPort.value) || 22;
                p.sshUser = dom.fSshUser.value.trim();
                p.sshAuth = dom.fSshAuth.value;
                p.password = dom.fSshPassword.value;
                p.privateKey = dom.fSshKey.value;
                p.passphrase = dom.fSshPassphrase.value;
            }
        } else {
            p.kubectlCmd = dom.fKubectlCmd.value.trim() || 'kubectl';
            p.kubeconfig = dom.fKubeconfig.value;
            p.kubeContext = dom.fKubeContext.value.trim();
        }
        return p;
    }

    function validatePayload(p) {
        if (p.type === 'docker') {
            if (p.mode === 'ssh') {
                if (!p.sshHost) { return '请填写 SSH 主机'; }
                if (!p.sshUser) { return '请填写 SSH 用户名'; }
                if (!p.password && !p.privateKey && !state.editingProfileId) {
                    return '请填写 SSH 密码或私钥';
                }
            }
            if (!p.dockerCmd) { return '请填写 docker 命令'; }
        } else if (!p.kubectlCmd) {
            return '请填写 kubectl 命令';
        }
        return '';
    }

    function submitConnect() {
        var payload = formPayload();
        var error = validatePayload(payload);
        if (error) {
            showConnectError(error);
            return;
        }
        setBusy(dom.btnConnect, true, '连接中…');
        connect(payload, false).catch(function (e) {
            showConnectError(e.message || String(e));
        }).then(function () {
            setBusy(dom.btnConnect, false, '测试并连接');
        });
    }

    function showConnectError(message) {
        dom.connectError.textContent = message;
        dom.connectError.classList.remove('hidden');
    }

    function connect(payload, trustHostKey) {
        var action = payload.type === 'docker' ? 'docker/connect' : 'kube/connect';
        var data = Object.assign({}, payload);
        if (trustHostKey) { data.trustHostKey = true; }
        return api(action, data, 40000).then(function (resp) {
            if (resp && resp.trustRequired) {
                state.pendingConnect = payload;
                dom.trustHost.textContent = resp.host || '';
                dom.trustType.textContent = resp.keyType || '';
                dom.trustFingerprint.textContent = resp.fingerprint || '';
                dom.trustError.classList.add('hidden');
                openModal('trustModal');
                return null;
            }
            return onConnected(resp, payload);
        });
    }

    function trustAndConnect() {
        if (!state.pendingConnect) { return; }
        setBusy(dom.btnTrustConnect, true, '连接中…');
        connect(state.pendingConnect, true).catch(function (e) {
            dom.trustError.textContent = e.message || String(e);
            dom.trustError.classList.remove('hidden');
        }).then(function () {
            setBusy(dom.btnTrustConnect, false, '信任并连接');
        });
    }

    function onConnected(resp, payload) {
        if (dom.fSave.checked) {
            var save = Object.assign({}, payload);
            delete save.profileId;
            delete save.trustHostKey;
            save.id = state.editingProfileId || '';
            api('profiles/save', save).then(function () {
                loadProfiles();
            }).catch(function (e) {
                toast('连接成功，但保存连接失败：' + (e.message || e), 'error');
            });
        }
        state.connected = true;
        state.conn = resp || {};
        state.type = state.conn.type || payload.type;
        state.view = 'overview';
        state.pendingConnect = null;
        closeModal('connectModal');
        closeModal('trustModal');
        dom.welcome.classList.add('hidden');
        dom.workspace.classList.remove('hidden');
        if (state.type === 'docker') {
            state.docker.info = parseJson(resp.info, {});
            state.kube.namespace = '';
        } else {
            state.kube.contexts = resp.contexts || [];
            state.kube.currentContext = resp.currentContext || resp.context || '';
            state.kube.namespace = '';
            state.kube.podFilter = '';
            var version = parseJson(resp.version, {});
            state.kube.version = version.gitVersion || (version.major && version.minor
                ? ('v' + version.major + '.' + version.minor) : '');
        }
        renderNav();
        renderConn();
        setView('overview');
        toast('已连接 ' + (state.conn.target || ''), 'success');
    }

    function renderConn() {
        if (!state.connected) { return; }
        var name = state.conn.name || state.conn.target || '';
        var sub = '';
        if (state.type === 'docker') {
            var info = state.docker.info || {};
            sub = 'Docker ' + (info.ServerVersion || '')
                + ' · ' + (info.ContainersRunning == null ? '—' : info.ContainersRunning)
                + '/' + (info.Containers == null ? '—' : info.Containers) + ' 运行';
            dom.connPill.textContent = 'Docker ' + (info.ServerVersion || '') + ' · ' + (info.Containers || 0) + ' 容器';
        } else {
            sub = 'Context ' + (state.kube.currentContext || state.conn.target || '—')
                + (state.kube.version ? ' · ' + state.kube.version : '');
            dom.connPill.textContent = 'K8s ' + (state.kube.version || '') + ' · ' + (state.kube.currentContext || '');
        }
        dom.connBox.innerHTML = '<div class="conn-online"><span class="online-dot"></span>'
            + '<div class="conn-main"><div class="conn-host" title="' + esc(name) + '">' + esc(name) + '</div>'
            + '<div class="conn-sub">' + esc(sub) + '</div></div></div>';
        dom.btnDisconnect.classList.remove('hidden');
    }

    function disconnect() {
        var id = state.conn && state.conn.connectionId;
        if (id) {
            api('disconnect', { connectionId: id }, 15000).catch(function () { /* ignore */ });
        }
        state.connected = false;
        state.conn = null;
        state.type = '';
        state.view = 'overview';
        state.docker = {
            info: null, df: [], containers: [], stats: [], images: [], volumes: [],
            networks: [], filter: '', runningOnly: false, imageFilter: ''
        };
        state.kube = {
            nodes: [], namespaces: [], pods: [], deployments: [], services: [], events: [],
            namespace: '', podFilter: '', contexts: [], currentContext: '', version: ''
        };
        closeModal('logsModal');
        closeModal('execModal');
        renderWelcome();
        loadProfiles();
    }

    function setBusy(button, busy, text) {
        if (!button) { return; }
        if (busy) {
            button.dataset.label = button.textContent;
            button.textContent = text || '处理中…';
            button.disabled = true;
        } else {
            button.textContent = text || button.dataset.label || button.textContent;
            button.disabled = false;
        }
    }

    /* ---------------- navigation / loading ---------------- */

    function renderNav() {
        var items = state.type === 'kubernetes' ? KUBE_NAV : (state.type === 'docker' ? DOCKER_NAV : []);
        var html = '';
        items.forEach(function (key) {
            var item = NAV[key];
            var count = navCount(key);
            html += '<button class="nav-item' + (state.view === key ? ' active' : '') + '" data-view="' + key + '">'
                + icon(item.icon) + '<span>' + esc(item.label) + '</span>'
                + (count ? '<em class="nav-count">' + esc(count) + '</em>' : '')
                + '</button>';
        });
        dom.sideNav.innerHTML = html;
    }

    function navCount(key) {
        if (state.type === 'docker') {
            if (key === 'containers') { return state.docker.containers.length || ''; }
            if (key === 'images') { return state.docker.images.length || ''; }
            if (key === 'volumes') { return state.docker.volumes.length || ''; }
            if (key === 'networks') { return state.docker.networks.length || ''; }
        } else {
            if (key === 'nodes') { return state.kube.nodes.length || ''; }
            if (key === 'pods') { return state.kube.pods.length || ''; }
            if (key === 'deployments') { return state.kube.deployments.length || ''; }
            if (key === 'services') { return state.kube.services.length || ''; }
        }
        return '';
    }

    function setView(view) {
        state.view = view;
        renderNav();
        updateNsFilter();
        var titles = {
            overview: '概览', containers: '容器', images: '镜像', volumes: '卷', networks: '网络',
            nodes: '节点', pods: 'Pod', deployments: 'Deployment', services: 'Service', events: '事件'
        };
        dom.viewTitle.textContent = titles[view] || view;
        dom.viewSub.textContent = state.conn ? (state.conn.target || '') : '';
        loadView(view, false);
    }

    function updateNsFilter() {
        var show = state.type === 'kubernetes'
            && ['pods', 'deployments', 'services', 'events'].indexOf(state.view) >= 0;
        dom.nsFilter.classList.toggle('hidden', !show);
        if (!show) { return; }
        var html = '<option value="">全部命名空间</option>';
        state.kube.namespaces.forEach(function (name) {
            html += '<option value="' + esc(name) + '"'
                + (state.kube.namespace === name ? ' selected' : '') + '>' + esc(name) + '</option>';
        });
        dom.nsFilter.innerHTML = html;
        dom.nsFilter.value = state.kube.namespace || '';
    }

    function currentView(view) {
        return state.connected && state.view === view;
    }

    function loadView(view, silent) {
        if (!state.connected) { return; }
        if (!silent || !dom.viewHost.innerHTML) {
            dom.viewHost.innerHTML = emptyBlock('正在读取…', state.conn && state.conn.target);
        }
        var task;
        if (state.type === 'docker') {
            if (view === 'overview') { task = loadDockerOverview(); }
            else if (view === 'containers') { task = loadContainers(); }
            else if (view === 'images') { task = loadImages(); }
            else if (view === 'volumes') { task = loadVolumes(); }
            else if (view === 'networks') { task = loadNetworks(); }
        } else {
            if (view === 'overview') { task = loadKubeOverview(); }
            else if (view === 'nodes') { task = loadNodes(); }
            else if (view === 'pods') { task = loadPods(); }
            else if (view === 'deployments') { task = loadDeployments(); }
            else if (view === 'services') { task = loadServices(); }
            else if (view === 'events') { task = loadEvents(); }
        }
        if (!task) { return Promise.resolve(); }
        return task.catch(function (e) {
            dom.viewHost.innerHTML = emptyBlock('读取失败', e.message || String(e));
            toast(e.message || String(e), 'error');
        });
    }

    /* ---------------- docker loaders/renderers ---------------- */

    function connId() { return state.conn ? state.conn.connectionId : ''; }

    function loadDockerOverview() {
        return api('docker/overview', { connectionId: connId() }).then(function (resp) {
            if (!currentView('overview')) { return; }
            state.docker.info = parseJson(resp && resp.info, state.docker.info || {});
            state.docker.df = parseLines(resp && resp.df);
            renderDockerOverview();
            renderConn();
            renderNav();
        });
    }

    function renderDockerOverview() {
        var info = state.docker.info || {};
        var running = Number(info.ContainersRunning) || 0;
        var total = Number(info.Containers) || 0;
        var images = Number(info.Images) || 0;
        var stats = '<div class="stat-grid">'
            + statCard('运行中容器', running, '共 ' + total + ' 个容器')
            + statCard('镜像', images, '本地镜像数量')
            + statCard('CPU', info.NCPU == null ? '—' : info.NCPU, '宿主机核心数')
            + statCard('内存', fmtBytes(info.MemTotal), '宿主机总内存')
            + '</div>';
        var infoRows = [
            ['Server 版本', info.ServerVersion || '—'],
            ['操作系统', info.OperatingSystem || '—'],
            ['架构', info.Architecture || '—'],
            ['存储驱动', info.Driver || '—'],
            ['Docker Root', info.DockerRootDir || '—'],
            ['主机名', info.Name || '—']
        ].map(function (row) {
            return '<div><span>' + esc(row[0]) + '</span><b>' + esc(row[1]) + '</b></div>';
        }).join('');
        var dfRows = (state.docker.df || []).map(function (d) {
            return '<tr><td>' + esc(d.Type || '—') + '</td><td class="num">' + esc(d.TotalCount || d.Total || '—')
                + '</td><td class="num">' + esc(d.Active || '—') + '</td><td class="num">' + esc(d.Size || '—')
                + '</td><td class="num">' + esc(d.Reclaimable || '—') + '</td></tr>';
        });
        var quick = '<div class="quick-grid">'
            + quickCard('containers', '容器', total + ' 个，' + running + ' 个运行中')
            + quickCard('images', '镜像', images + ' 个本地镜像')
            + quickCard('volumes', '数据卷', '查看与清理 Docker 卷')
            + quickCard('networks', '网络', '查看与清理 Docker 网络')
            + '</div>';
        dom.viewHost.innerHTML = '<div class="overview-view">' + stats
            + '<div class="overview-grid">'
            + card('Docker 引擎', info.ServerVersion || '', '<div class="info-list">' + infoRows + '</div>')
            + card('磁盘占用', 'docker system df', table([
                { label: '类型' }, { label: '总数', right: true }, { label: '活跃', right: true },
                { label: '大小', right: true }, { label: '可回收', right: true }
            ], dfRows, '暂无占用信息'))
            + card('快捷入口', '', quick, 'full')
            + '</div></div>';
    }

    function statCard(label, value, sub) {
        return '<div class="stat-card"><span>' + esc(label) + '</span><b>' + esc(value) + '</b><em>' + esc(sub || '') + '</em></div>';
    }

    function quickCard(view, title, sub) {
        return '<button class="quick-card" data-act="go" data-view="' + esc(view) + '"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></button>';
    }

    function loadContainers() {
        return Promise.all([
            api('docker/containers', { connectionId: connId() }),
            api('docker/stats', { connectionId: connId() }).catch(function () { return { output: '' }; })
        ]).then(function (results) {
            if (!currentView('containers')) { return; }
            state.docker.containers = parseLines(outputOf(results[0]));
            state.docker.stats = parseLines(outputOf(results[1]));
            renderContainers();
            renderNav();
        });
    }

    function renderContainers() {
        dom.viewHost.innerHTML = '<section class="card">'
            + '<div class="list-toolbar">'
            + '<input id="ctFilter" class="input" placeholder="筛选名称 / 镜像 / 端口" value="' + esc(state.docker.filter) + '">'
            + '<label class="check"><input id="ctRunning" type="checkbox"' + (state.docker.runningOnly ? ' checked' : '')
            + '> 仅运行中</label>'
            + '<span class="spacer"></span>'
            + '<span class="muted" id="ctCount"></span>'
            + '</div>'
            + '<div id="ctTable"></div></section>';
        renderContainerRows();
    }

    function renderContainerRows() {
        var statMap = {};
        state.docker.stats.forEach(function (s) {
            if (s.Name) { statMap[s.Name] = s; }
            if (s.ID) { statMap[String(s.ID).substring(0, 12)] = s; }
        });
        var keyword = state.docker.filter.trim().toLowerCase();
        var list = state.docker.containers.filter(function (c) {
            if (state.docker.runningOnly && String(c.State).toLowerCase() !== 'running') { return false; }
            if (!keyword) { return true; }
            return [c.Names, c.Image, c.Ports, c.Status].join(' ').toLowerCase().indexOf(keyword) >= 0;
        });
        var count = document.getElementById('ctCount');
        if (count) { count.textContent = list.length + ' / ' + state.docker.containers.length + ' 个容器'; }
        var rows = list.map(function (c) {
            var st = statMap[c.Names] || statMap[String(c.ID).substring(0, 12)] || {};
            var running = String(c.State).toLowerCase() === 'running';
            var action = running ? 'stop' : 'start';
            return '<tr>'
                + '<td><b>' + esc(c.Names || '—') + '</b><span class="cell-sub mono">' + esc(String(c.ID || '').substring(0, 12)) + '</span></td>'
                + '<td class="mono">' + esc(c.Image || '—') + '</td>'
                + '<td>' + containerBadge(c) + '</td>'
                + '<td class="mono">' + esc(c.Ports || '—') + '</td>'
                + '<td class="num">' + esc(st.CPUPerc || '—') + '</td>'
                + '<td class="num">' + esc(st.MemUsage || '—') + '</td>'
                + '<td class="num">' + esc(fmtAge(c.CreatedAt)) + '</td>'
                + '<td><div class="table-actions">'
                + '<button class="btn btn-ghost btn-xs" data-act="container-logs" data-id="' + esc(c.ID) + '" data-title="' + esc(c.Names) + '">日志</button>'
                + '<button class="btn btn-ghost btn-xs" data-act="container-exec" data-id="' + esc(c.ID) + '" data-title="' + esc(c.Names) + '">命令</button>'
                + '<button class="btn btn-ghost btn-xs" data-act="container-inspect" data-id="' + esc(c.ID) + '" data-title="' + esc(c.Names) + '">详情</button>'
                + '<button class="btn btn-ghost btn-xs" data-act="container-action" data-id="' + esc(c.ID) + '" data-action="' + action + '" data-title="' + esc(c.Names) + '">' + (running ? '停止' : '启动') + '</button>'
                + '<button class="btn btn-ghost btn-xs danger-text" data-act="container-remove" data-id="' + esc(c.ID) + '" data-title="' + esc(c.Names) + '">删除</button>'
                + '</div></td></tr>';
        });
        var html = table([
            { label: '名称' }, { label: '镜像' }, { label: '状态' }, { label: '端口' },
            { label: 'CPU', right: true }, { label: '内存', right: true }, { label: '创建', right: true },
            { label: '操作' }
        ], rows, '没有匹配的容器');
        var target = document.getElementById('ctTable');
        if (target) { target.innerHTML = html; }
    }

    function loadImages() {
        return api('docker/images', { connectionId: connId() }).then(function (resp) {
            if (!currentView('images')) { return; }
            state.docker.images = parseLines(outputOf(resp));
            renderImages();
            renderNav();
        });
    }

    function renderImages() {
        var keyword = state.docker.imageFilter.trim().toLowerCase();
        var list = state.docker.images.filter(function (img) {
            if (!keyword) { return true; }
            return ((img.Repository || '') + ':' + (img.Tag || '')).toLowerCase().indexOf(keyword) >= 0;
        });
        var rows = list.map(function (img) {
            var name = (img.Repository || '<none>') + (img.Tag && img.Tag !== '<none>' ? ':' + img.Tag : '');
            return '<tr>'
                + '<td class="mono">' + esc(name) + '</td>'
                + '<td class="mono">' + esc(String(img.ID || '').replace('sha256:', '').substring(0, 12)) + '</td>'
                + '<td class="num">' + esc(img.Size || '—') + '</td>'
                + '<td class="num">' + esc(img.CreatedSince || img.CreatedAt || '—') + '</td>'
                + '<td><div class="table-actions">'
                + '<button class="btn btn-ghost btn-xs danger-text" data-act="image-remove" data-id="' + esc(img.ID) + '" data-title="' + esc(name) + '">删除</button>'
                + '</div></td></tr>';
        });
        dom.viewHost.innerHTML = '<section class="card">'
            + '<div class="list-toolbar">'
            + '<input id="imgFilter" class="input" placeholder="筛选镜像" value="' + esc(state.docker.imageFilter) + '">'
            + '<span class="spacer"></span>'
            + '<button class="btn btn-primary btn-sm" data-act="image-pull">拉取镜像</button>'
            + '</div>'
            + table([
                { label: '镜像' }, { label: 'ID' }, { label: '大小', right: true },
                { label: '创建', right: true }, { label: '操作' }
            ], rows, '没有镜像') + '</section>';
    }

    function loadVolumes() {
        return api('docker/volumes', { connectionId: connId() }).then(function (resp) {
            if (!currentView('volumes')) { return; }
            state.docker.volumes = parseLines(outputOf(resp));
            renderSimpleList('卷', 'volume', state.docker.volumes, function (v) {
                return ['<td class="mono">' + esc(v.Name || '—') + '</td>',
                    '<td>' + esc(v.Driver || '—') + '</td>',
                    '<td class="mono">' + esc(v.Mountpoint || '—') + '</td>'];
            }, 'Name');
            renderNav();
        });
    }

    function loadNetworks() {
        return api('docker/networks', { connectionId: connId() }).then(function (resp) {
            if (!currentView('networks')) { return; }
            state.docker.networks = parseLines(outputOf(resp));
            renderSimpleList('网络', 'network', state.docker.networks, function (n) {
                return ['<td class="mono">' + esc(n.Name || '—') + '</td>',
                    '<td class="mono">' + esc(String(n.ID || '').substring(0, 12)) + '</td>',
                    '<td>' + esc(n.Driver || '—') + '</td>',
                    '<td>' + esc(n.Scope || '—') + '</td>'];
            }, 'Name');
            renderNav();
        });
    }

    function renderSimpleList(title, kind, items, cells, nameField) {
        var rows = items.map(function (item) {
            return '<tr>' + cells(item).join('')
                + '<td><div class="table-actions"><button class="btn btn-ghost btn-xs danger-text" data-act="' + kind + '-remove"'
                + ' data-name="' + esc(item[nameField]) + '" data-title="' + esc(item[nameField]) + '">删除</button></div></td></tr>';
        });
        var headers = kind === 'volume'
            ? [{ label: '名称' }, { label: '驱动' }, { label: '挂载点' }, { label: '操作' }]
            : [{ label: '名称' }, { label: 'ID' }, { label: '驱动' }, { label: '范围' }, { label: '操作' }];
        dom.viewHost.innerHTML = '<section class="card">'
            + '<div class="card-head"><b>' + esc(title) + '</b><span class="muted">' + items.length + ' 项</span></div>'
            + table(headers, rows, '暂无' + title) + '</section>';
    }

    /* ---------------- kubernetes loaders/renderers ---------------- */

    function loadKubeOverview() {
        return Promise.all([
            api('kube/overview', { connectionId: connId() }, 60000),
            api('kube/events', { connectionId: connId(), namespace: '' }, 60000)
                .catch(function () { return { output: '' }; })
        ]).then(function (results) {
            if (!currentView('overview')) { return; }
            var data = results[0] || {};
            var nodes = parseJson(data.nodes, { items: [] });
            var namespaces = parseJson(data.namespaces, { items: [] });
            var pods = parseJson(data.pods, { items: [] });
            var deployments = parseJson(data.deployments, { items: [] });
            state.kube.nodes = nodes.items || [];
            state.kube.namespaces = (namespaces.items || []).map(function (n) {
                return n.metadata && n.metadata.name;
            }).filter(Boolean).sort();
            state.kube.pods = pods.items || [];
            state.kube.deployments = deployments.items || [];
            state.kube.events = parseJson(outputOf(results[1]), { items: [] }).items || [];
            renderKubeOverview();
            renderConn();
            renderNav();
            updateNsFilter();
        });
    }

    function nodeReady(node) {
        var conditions = (node.status && node.status.conditions) || [];
        for (var i = 0; i < conditions.length; i++) {
            if (conditions[i].type === 'Ready') { return conditions[i].status === 'True'; }
        }
        return false;
    }

    function nodeIp(node) {
        var addresses = (node.status && node.status.addresses) || [];
        for (var i = 0; i < addresses.length; i++) {
            if (addresses[i].type === 'InternalIP') { return addresses[i].address; }
        }
        return '—';
    }

    function nodeRole(node) {
        var labels = (node.metadata && node.metadata.labels) || {};
        var roles = [];
        if (labels['node-role.kubernetes.io/control-plane'] != null) { roles.push('control-plane'); }
        if (labels['node-role.kubernetes.io/master'] != null) { roles.push('master'); }
        if (!roles.length) { roles.push('worker'); }
        return roles.join(', ');
    }

    function podReady(pod) {
        var statuses = (pod.status && pod.status.containerStatuses) || [];
        var ready = statuses.filter(function (s) { return s.ready; }).length;
        return ready + '/' + statuses.length;
    }

    function podRestarts(pod) {
        var statuses = (pod.status && pod.status.containerStatuses) || [];
        return statuses.reduce(function (sum, s) { return sum + (s.restartCount || 0); }, 0);
    }

    function podContainers(pod) {
        var containers = (pod.spec && pod.spec.containers) || [];
        return containers.map(function (c) { return c.name; });
    }

    function renderKubeOverview() {
        var nodes = state.kube.nodes || [];
        var readyNodes = nodes.filter(nodeReady).length;
        var pods = state.kube.pods || [];
        var runningPods = pods.filter(function (p) { return p.status && p.status.phase === 'Running'; }).length;
        var deployments = state.kube.deployments || [];
        var depReady = deployments.filter(function (d) {
            return d.status && d.spec && d.status.readyReplicas >= d.spec.replicas;
        }).length;
        var stats = '<div class="stat-grid">'
            + statCard('节点', readyNodes + '/' + nodes.length, 'Ready 节点 / 总数')
            + statCard('Pod', runningPods + '/' + pods.length, 'Running / 总数')
            + statCard('Deployment', depReady + '/' + deployments.length, '就绪 / 总数')
            + statCard('命名空间', state.kube.namespaces.length, '可见命名空间')
            + '</div>';
        var nodeRows = nodes.slice(0, 8).map(function (n) {
            var name = n.metadata ? n.metadata.name : '—';
            return '<tr>'
                + '<td><b>' + esc(name) + '</b><span class="cell-sub">' + esc(nodeRole(n)) + '</span></td>'
                + '<td>' + (nodeReady(n) ? badge('Ready', 'green') : badge('NotReady', 'red')) + '</td>'
                + '<td class="mono">' + esc((n.status && n.status.nodeInfo && n.status.nodeInfo.kubeletVersion) || '—') + '</td>'
                + '<td class="mono">' + esc(nodeIp(n)) + '</td>'
                + '<td class="num">' + esc(fmtAge(n.metadata && n.metadata.creationTimestamp)) + '</td>'
                + '<td><div class="table-actions"><button class="btn btn-ghost btn-xs" data-act="node-describe" data-name="' + esc(name) + '">详情</button></div></td>'
                + '</tr>';
        });
        var warnings = (state.kube.events || []).filter(function (e) {
            return String(e.type).toLowerCase() === 'warning';
        }).sort(function (a, b) {
            return Date.parse(b.lastTimestamp || b.eventTime || 0) - Date.parse(a.lastTimestamp || a.eventTime || 0);
        }).slice(0, 8);
        var warningRows = warnings.map(function (e) {
            return '<tr class="warn-row"><td>' + esc(e.reason || '—') + '</td>'
                + '<td>' + esc((e.involvedObject && e.involvedObject.kind) || '') + ' '
                + esc((e.involvedObject && e.involvedObject.name) || '') + '</td>'
                + '<td>' + esc(e.message || '') + '</td>'
                + '<td class="num">' + esc(e.count || 1) + '</td>'
                + '<td class="num">' + esc(fmtAge(e.lastTimestamp || e.eventTime)) + '</td></tr>';
        });
        dom.viewHost.innerHTML = '<div class="overview-view">' + stats
            + '<div class="overview-grid">'
            + card('节点', nodes.length + ' 个', table([
                { label: '名称' }, { label: '状态' }, { label: '版本' }, { label: '内网 IP' },
                { label: '创建', right: true }, { label: '操作' }
            ], nodeRows, '没有节点'))
            + card('最近警告事件', warnings.length + ' 条', table([
                { label: '原因' }, { label: '对象' }, { label: '消息' },
                { label: '次数', right: true }, { label: '时间', right: true }
            ], warningRows, '没有警告事件'))
            + '</div></div>';
    }

    function loadNodes() {
        return api('kube/nodes', { connectionId: connId() }).then(function (resp) {
            if (!currentView('nodes')) { return; }
            state.kube.nodes = parseJson(outputOf(resp), { items: [] }).items || [];
            renderNodes();
            renderNav();
        });
    }

    function renderNodes() {
        var rows = state.kube.nodes.map(function (n) {
            var name = n.metadata ? n.metadata.name : '—';
            var info = (n.status && n.status.nodeInfo) || {};
            return '<tr>'
                + '<td><b>' + esc(name) + '</b><span class="cell-sub">' + esc(nodeRole(n)) + '</span></td>'
                + '<td>' + (nodeReady(n) ? badge('Ready', 'green') : badge('NotReady', 'red')) + '</td>'
                + '<td class="mono">' + esc(info.kubeletVersion || '—') + '</td>'
                + '<td class="mono">' + esc(nodeIp(n)) + '</td>'
                + '<td>' + esc(info.osImage || '—') + '</td>'
                + '<td>' + esc(info.containerRuntimeVersion || '—') + '</td>'
                + '<td class="num">' + esc(fmtAge(n.metadata && n.metadata.creationTimestamp)) + '</td>'
                + '<td><div class="table-actions"><button class="btn btn-ghost btn-xs" data-act="node-describe" data-name="' + esc(name) + '">详情</button></div></td>'
                + '</tr>';
        });
        dom.viewHost.innerHTML = '<section class="card"><div class="card-head"><b>节点</b><span class="muted">'
            + state.kube.nodes.length + ' 个</span></div>'
            + table([
                { label: '名称' }, { label: '状态' }, { label: '版本' }, { label: '内网 IP' },
                { label: '系统' }, { label: '容器运行时' }, { label: '创建', right: true }, { label: '操作' }
            ], rows, '没有节点') + '</section>';
    }

    function loadPods() {
        return api('kube/pods', { connectionId: connId(), namespace: state.kube.namespace }).then(function (resp) {
            if (!currentView('pods')) { return; }
            state.kube.pods = parseJson(outputOf(resp), { items: [] }).items || [];
            renderPods();
            renderNav();
        });
    }

    function renderPods() {
        dom.viewHost.innerHTML = '<section class="card">'
            + '<div class="list-toolbar">'
            + '<input id="podFilter" class="input" placeholder="筛选 Pod / 镜像 / 节点" value="' + esc(state.kube.podFilter || '') + '">'
            + '<span class="spacer"></span><span class="muted" id="podCount"></span>'
            + '</div><div id="podTable"></div></section>';
        renderPodRows();
    }

    function renderPodRows() {
        var keyword = String(state.kube.podFilter || '').trim().toLowerCase();
        var list = state.kube.pods.filter(function (p) {
            if (!keyword) { return true; }
            var meta = p.metadata || {};
            var containers = podContainers(p).join(',');
            return [meta.namespace, meta.name, containers, p.spec && p.spec.nodeName]
                .join(' ').toLowerCase().indexOf(keyword) >= 0;
        });
        var count = document.getElementById('podCount');
        if (count) { count.textContent = list.length + ' / ' + state.kube.pods.length + ' 个 Pod'; }
        var rows = list.map(function (p) {
            var meta = p.metadata || {};
            var ns = meta.namespace || 'default';
            var name = meta.name || '—';
            var containers = podContainers(p);
            var container = containers[0] || '';
            var phase = (p.status && p.status.phase) || 'Unknown';
            return '<tr>'
                + '<td>' + esc(ns) + '</td>'
                + '<td><b>' + esc(name) + '</b><span class="cell-sub">' + esc(containers.join(', ')) + '</span></td>'
                + '<td class="num">' + esc(podReady(p)) + '</td>'
                + '<td>' + stateBadge(phase) + '</td>'
                + '<td class="num">' + esc(podRestarts(p)) + '</td>'
                + '<td class="mono">' + esc((p.spec && p.spec.nodeName) || '—') + '</td>'
                + '<td class="mono">' + esc((p.status && p.status.podIP) || '—') + '</td>'
                + '<td class="num">' + esc(fmtAge(meta.creationTimestamp)) + '</td>'
                + '<td><div class="table-actions">'
                + '<button class="btn btn-ghost btn-xs" data-act="pod-logs" data-ns="' + esc(ns) + '" data-pod="' + esc(name) + '" data-container="' + esc(container) + '">日志</button>'
                + '<button class="btn btn-ghost btn-xs" data-act="pod-exec" data-ns="' + esc(ns) + '" data-pod="' + esc(name) + '" data-container="' + esc(container) + '">命令</button>'
                + '<button class="btn btn-ghost btn-xs" data-act="pod-describe" data-ns="' + esc(ns) + '" data-name="' + esc(name) + '">详情</button>'
                + '<button class="btn btn-ghost btn-xs danger-text" data-act="pod-delete" data-ns="' + esc(ns) + '" data-name="' + esc(name) + '">删除</button>'
                + '</div></td></tr>';
        });
        var target = document.getElementById('podTable');
        if (target) {
            target.innerHTML = table([
                { label: '命名空间' }, { label: 'Pod' }, { label: '就绪', right: true }, { label: '状态' },
                { label: '重启', right: true }, { label: '节点' }, { label: 'IP' }, { label: '创建', right: true },
                { label: '操作' }
            ], rows, '没有 Pod');
        }
    }

    function loadDeployments() {
        return api('kube/deployments', { connectionId: connId(), namespace: state.kube.namespace }).then(function (resp) {
            if (!currentView('deployments')) { return; }
            state.kube.deployments = parseJson(outputOf(resp), { items: [] }).items || [];
            renderDeployments();
            renderNav();
        });
    }

    function renderDeployments() {
        var rows = state.kube.deployments.map(function (d) {
            var meta = d.metadata || {};
            var spec = d.spec || {};
            var status = d.status || {};
            var ns = meta.namespace || 'default';
            var name = meta.name || '—';
            var images = ((spec.template && spec.template.spec && spec.template.spec.containers) || [])
                .map(function (c) { return c.image; }).join(', ');
            return '<tr>'
                + '<td>' + esc(ns) + '</td>'
                + '<td><b>' + esc(name) + '</b><span class="cell-sub mono">' + esc(images || '—') + '</span></td>'
                + '<td class="num">' + esc((status.readyReplicas || 0) + '/' + (spec.replicas || 0)) + '</td>'
                + '<td class="num">' + esc(status.updatedReplicas || 0) + '</td>'
                + '<td class="num">' + esc(status.availableReplicas || 0) + '</td>'
                + '<td class="num">' + esc(fmtAge(meta.creationTimestamp)) + '</td>'
                + '<td><div class="table-actions">'
                + '<button class="btn btn-ghost btn-xs" data-act="deploy-scale" data-ns="' + esc(ns) + '" data-name="' + esc(name) + '" data-replicas="' + esc(spec.replicas || 0) + '">缩放</button>'
                + '<button class="btn btn-ghost btn-xs" data-act="deploy-restart" data-ns="' + esc(ns) + '" data-name="' + esc(name) + '">重启</button>'
                + '<button class="btn btn-ghost btn-xs" data-act="deploy-describe" data-ns="' + esc(ns) + '" data-name="' + esc(name) + '">详情</button>'
                + '<button class="btn btn-ghost btn-xs danger-text" data-act="deploy-delete" data-ns="' + esc(ns) + '" data-name="' + esc(name) + '">删除</button>'
                + '</div></td></tr>';
        });
        dom.viewHost.innerHTML = '<section class="card"><div class="card-head"><b>Deployment</b><span class="muted">'
            + state.kube.deployments.length + ' 个</span></div>'
            + table([
                { label: '命名空间' }, { label: '名称' }, { label: '就绪', right: true },
                { label: '已更新', right: true }, { label: '可用', right: true },
                { label: '创建', right: true }, { label: '操作' }
            ], rows, '没有 Deployment') + '</section>';
    }

    function loadServices() {
        return api('kube/services', { connectionId: connId(), namespace: state.kube.namespace }).then(function (resp) {
            if (!currentView('services')) { return; }
            state.kube.services = parseJson(outputOf(resp), { items: [] }).items || [];
            renderServices();
            renderNav();
        });
    }

    function renderServices() {
        var rows = state.kube.services.map(function (s) {
            var meta = s.metadata || {};
            var spec = s.spec || {};
            var ns = meta.namespace || 'default';
            var name = meta.name || '—';
            var ports = (spec.ports || []).map(function (p) {
                return (p.port || '') + (p.nodePort ? ':' + p.nodePort : '') + '/' + (p.protocol || 'TCP');
            }).join(', ');
            return '<tr>'
                + '<td>' + esc(ns) + '</td>'
                + '<td><b>' + esc(name) + '</b></td>'
                + '<td>' + badge(spec.type || 'ClusterIP', spec.type === 'LoadBalancer' ? 'purple' : 'blue') + '</td>'
                + '<td class="mono">' + esc(spec.clusterIP || '—') + '</td>'
                + '<td class="mono">' + esc(ports || '—') + '</td>'
                + '<td class="num">' + esc(fmtAge(meta.creationTimestamp)) + '</td>'
                + '<td><div class="table-actions"><button class="btn btn-ghost btn-xs" data-act="service-describe" data-ns="' + esc(ns) + '" data-name="' + esc(name) + '">详情</button></div></td>'
                + '</tr>';
        });
        dom.viewHost.innerHTML = '<section class="card"><div class="card-head"><b>Service</b><span class="muted">'
            + state.kube.services.length + ' 个</span></div>'
            + table([
                { label: '命名空间' }, { label: '名称' }, { label: '类型' }, { label: 'ClusterIP' },
                { label: '端口' }, { label: '创建', right: true }, { label: '操作' }
            ], rows, '没有 Service') + '</section>';
    }

    function loadEvents() {
        return api('kube/events', { connectionId: connId(), namespace: state.kube.namespace }).then(function (resp) {
            if (!currentView('events')) { return; }
            var items = parseJson(outputOf(resp), { items: [] }).items || [];
            state.kube.events = items.sort(function (a, b) {
                return Date.parse(b.lastTimestamp || b.eventTime || 0) - Date.parse(a.lastTimestamp || a.eventTime || 0);
            }).slice(0, 500);
            renderEvents();
            renderNav();
        });
    }

    function renderEvents() {
        var rows = state.kube.events.map(function (e) {
            var warning = String(e.type).toLowerCase() === 'warning';
            var involved = e.involvedObject || {};
            return '<tr' + (warning ? ' class="warn-row"' : '') + '>'
                + '<td>' + esc((e.metadata && e.metadata.namespace) || involved.namespace || '—') + '</td>'
                + '<td>' + badge(e.type || 'Normal', warning ? 'red' : 'blue') + '</td>'
                + '<td>' + esc(e.reason || '—') + '</td>'
                + '<td>' + esc((involved.kind || '') + ' ' + (involved.name || '')) + '</td>'
                + '<td>' + esc(e.message || '') + '</td>'
                + '<td class="num">' + esc(e.count || 1) + '</td>'
                + '<td class="num">' + esc(fmtAge(e.lastTimestamp || e.eventTime)) + '</td>'
                + '</tr>';
        });
        dom.viewHost.innerHTML = '<section class="card"><div class="card-head"><b>事件</b><span class="muted">'
            + state.kube.events.length + ' 条（最近）</span></div>'
            + table([
                { label: '命名空间' }, { label: '类型' }, { label: '原因' }, { label: '对象' },
                { label: '消息' }, { label: '次数', right: true }, { label: '时间', right: true }
            ], rows, '没有事件') + '</section>';
    }

    /* ---------------- view events ---------------- */

    function onViewInput(e) {
        var id = e.target.id;
        if (id === 'ctFilter') {
            state.docker.filter = e.target.value;
            renderContainerRows();
        } else if (id === 'ctRunning') {
            state.docker.runningOnly = e.target.checked;
            renderContainerRows();
        } else if (id === 'imgFilter') {
            state.docker.imageFilter = e.target.value;
            renderImages();
            setTimeout(function () {
                var input = document.getElementById('imgFilter');
                if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
            }, 0);
        } else if (id === 'podFilter') {
            state.kube.podFilter = e.target.value;
            renderPodRows();
        }
    }

    function onViewClick(e) {
        var button = e.target.closest('[data-act]');
        if (!button) { return; }
        var act = button.getAttribute('data-act');
        var id = button.getAttribute('data-id');
        var name = button.getAttribute('data-name');
        var ns = button.getAttribute('data-ns') || '';
        var pod = button.getAttribute('data-pod') || '';
        var container = button.getAttribute('data-container') || '';
        var title = button.getAttribute('data-title') || name || '';
        if (act === 'go') {
            setView(button.getAttribute('data-view'));
        } else if (act === 'container-logs') {
            openLogs({ kind: 'docker', id: id, title: title });
        } else if (act === 'container-exec') {
            openExec({ kind: 'docker', id: id, title: title });
        } else if (act === 'container-inspect') {
            inspectContainer(id, title);
        } else if (act === 'container-action') {
            containerAction(id, button.getAttribute('data-action'), title);
        } else if (act === 'container-remove') {
            confirmAction('删除容器', '确定删除容器「' + title + '」吗？该操作不可恢复。', function () {
                containerAction(id, 'remove', title);
            });
        } else if (act === 'image-pull') {
            openModal('pullModal');
            dom.pullRef.value = '';
            dom.pullError.classList.add('hidden');
            setTimeout(function () { dom.pullRef.focus(); }, 50);
        } else if (act === 'image-remove') {
            confirmAction('删除镜像', '确定删除镜像「' + title + '」吗？', function () {
                api('docker/image/remove', { connectionId: connId(), id: id }, 60000).then(function () {
                    toast('镜像已删除', 'success');
                    loadView(state.view, true);
                }).catch(showError);
            });
        } else if (act === 'volume-remove' || act === 'network-remove') {
            var removeAction = act === 'volume-remove' ? 'docker/volume/remove' : 'docker/network/remove';
            confirmAction('删除' + (act === 'volume-remove' ? '卷' : '网络'),
                '确定删除「' + name + '」吗？', function () {
                    api(removeAction, { connectionId: connId(), name: name }, 60000).then(function () {
                        toast('已删除', 'success');
                        loadView(state.view, true);
                    }).catch(showError);
                });
        } else if (act === 'node-describe') {
            describeResource('node', name, '');
        } else if (act === 'pod-logs') {
            openLogs({ kind: 'kube', ns: ns, pod: pod, container: container, title: pod });
        } else if (act === 'pod-exec') {
            openExec({ kind: 'kube', ns: ns, pod: pod, container: container, title: pod });
        } else if (act === 'pod-describe') {
            describeResource('pod', name, ns);
        } else if (act === 'pod-delete') {
            confirmAction('删除 Pod', '确定删除 Pod「' + name + '」吗？控制器可能会自动重建。', function () {
                api('kube/pod/delete', { connectionId: connId(), namespace: ns, pod: name }, 60000)
                    .then(function () {
                        toast('Pod 已删除', 'success');
                        loadView(state.view, true);
                    }).catch(showError);
            });
        } else if (act === 'deploy-scale') {
            state.scale = { ns: ns, name: name };
            dom.scaleTitle.textContent = '缩放 ' + name;
            dom.scaleReplicas.value = button.getAttribute('data-replicas') || 0;
            dom.scaleError.classList.add('hidden');
            openModal('scaleModal');
        } else if (act === 'deploy-restart') {
            confirmAction('重启 Deployment', '确定对「' + name + '」执行滚动重启吗？', function () {
                api('kube/deployment/restart', { connectionId: connId(), namespace: ns, name: name }, 90000)
                    .then(function () {
                        toast('已触发滚动重启', 'success');
                        loadView(state.view, true);
                    }).catch(showError);
            });
        } else if (act === 'deploy-describe') {
            describeResource('deployment', name, ns);
        } else if (act === 'deploy-delete') {
            confirmAction('删除 Deployment', '确定删除「' + name + '」吗？相关 Pod 会被清理。', function () {
                api('kube/deployment/delete', { connectionId: connId(), namespace: ns, name: name }, 60000)
                    .then(function () {
                        toast('Deployment 已删除', 'success');
                        loadView(state.view, true);
                    }).catch(showError);
            });
        } else if (act === 'service-describe') {
            describeResource('service', name, ns);
        }
    }

    function showError(e) {
        toast(e && e.message ? e.message : String(e), 'error');
    }

    function confirmAction(title, message, action) {
        dom.confirmTitle.textContent = title;
        dom.confirmMessage.textContent = message;
        state.confirmAction = action;
        openModal('confirmModal');
    }

    function containerAction(id, action, title) {
        api('docker/container/action', { connectionId: connId(), id: id, action: action }, 60000)
            .then(function () {
                toast('已' + ({ start: '启动', stop: '停止', restart: '重启', pause: '暂停', unpause: '恢复', remove: '删除' }[action] || action) + '「' + title + '」', 'success');
                loadView(state.view, true);
            }).catch(showError);
    }

    function inspectContainer(id, title) {
        api('docker/container/inspect', { connectionId: connId(), id: id }, 60000).then(function (resp) {
            openView(title + ' · 详情', outputOf(resp));
        }).catch(showError);
    }

    function describeResource(kind, name, ns) {
        api('kube/describe', { connectionId: connId(), kind: kind, name: name, namespace: ns }, 60000)
            .then(function (resp) {
                openView(kind + ' / ' + name, outputOf(resp), true);
            }).catch(showError);
    }

    function openView(title, content, raw) {
        dom.viewModalTitle.textContent = title;
        var text = content == null ? '' : String(content);
        var parsed = raw ? null : parseJson(text, null);
        dom.viewModalBody.textContent = parsed ? JSON.stringify(parsed, null, 2) : text;
        openModal('viewModal');
    }

    /* ---------------- logs ---------------- */

    function openLogs(ctx) {
        state.logs = ctx;
        dom.logsTitle.textContent = '日志 · ' + (ctx.title || '');
        dom.logsContainerWrap.classList.toggle('hidden', ctx.kind !== 'kube');
        dom.logsContainer.value = ctx.container || '';
        dom.logsOutput.textContent = '正在读取…';
        openModal('logsModal');
        loadLogs();
    }

    function loadLogs() {
        var ctx = state.logs;
        if (!ctx) { return; }
        var tail = Number(dom.logsTail.value) || 200;
        dom.logsOutput.textContent = '正在读取…';
        var action;
        var payload;
        if (ctx.kind === 'docker') {
            action = 'docker/container/logs';
            payload = { connectionId: connId(), id: ctx.id, tail: tail };
        } else {
            action = 'kube/pod/logs';
            payload = {
                connectionId: connId(), namespace: ctx.ns, pod: ctx.pod,
                container: dom.logsContainer.value.trim(), tail: tail
            };
        }
        api(action, payload, 60000).then(function (resp) {
            dom.logsOutput.textContent = outputOf(resp) || '(无输出)';
        }).catch(function (e) {
            dom.logsOutput.textContent = '读取日志失败：' + (e.message || e);
        });
    }

    /* ---------------- exec ---------------- */

    function openExec(ctx) {
        state.exec = ctx;
        dom.execTitle.textContent = '执行命令 · ' + (ctx.title || '');
        dom.execContainerWrap.classList.toggle('hidden', ctx.kind !== 'kube');
        dom.execContainer.value = ctx.container || '';
        dom.execShell.value = '/bin/sh';
        dom.execCommand.value = ctx.kind === 'docker' ? 'ps aux' : 'ps aux';
        dom.execOutput.textContent = '命令输出会显示在这里';
        dom.execStatus.textContent = '';
        openModal('execModal');
    }

    function runExec() {
        var ctx = state.exec;
        if (!ctx) { return; }
        var command = dom.execCommand.value.trim();
        if (!command) {
            toast('请输入要执行的命令', 'error');
            return;
        }
        var action;
        var payload;
        if (ctx.kind === 'docker') {
            action = 'docker/container/exec';
            payload = {
                connectionId: connId(), id: ctx.id, command: command,
                shell: dom.execShell.value.trim() || '/bin/sh'
            };
        } else {
            action = 'kube/pod/exec';
            payload = {
                connectionId: connId(), namespace: ctx.ns, pod: ctx.pod,
                container: dom.execContainer.value.trim(), command: command,
                shell: dom.execShell.value.trim() || '/bin/sh'
            };
        }
        setBusy(dom.btnRunExec, true, '执行中…');
        dom.execOutput.textContent = '执行中…';
        dom.execStatus.textContent = '';
        api(action, payload, 180000).then(function (resp) {
            dom.execStatus.textContent = '退出码 ' + (resp.exitCode == null ? '?' : resp.exitCode)
                + (resp.durationMs ? ' · ' + resp.durationMs + 'ms' : '');
            dom.execOutput.textContent = outputOf(resp) || '(无输出)';
        }).catch(function (e) {
            dom.execStatus.textContent = '';
            dom.execOutput.textContent = '执行失败：' + (e.message || e);
        }).then(function () {
            setBusy(dom.btnRunExec, false, '执行');
        });
    }

    /* ---------------- pull / scale / delete profile ---------------- */

    function pullImage() {
        var ref = dom.pullRef.value.trim();
        if (!ref) {
            dom.pullError.textContent = '请填写镜像名称';
            dom.pullError.classList.remove('hidden');
            return;
        }
        dom.pullError.classList.add('hidden');
        setBusy(dom.btnPull, true, '拉取中…');
        api('docker/image/pull', { connectionId: connId(), ref: ref }, 600000).then(function (resp) {
            toast('镜像拉取完成', 'success');
            closeModal('pullModal');
            loadView('images', true);
        }).catch(function (e) {
            dom.pullError.textContent = e.message || String(e);
            dom.pullError.classList.remove('hidden');
        }).then(function () {
            setBusy(dom.btnPull, false, '开始拉取');
        });
    }

    function scaleDeployment() {
        var ctx = state.scale;
        if (!ctx) { return; }
        var replicas = Number(dom.scaleReplicas.value);
        if (!isFinite(replicas) || replicas < 0 || replicas > 1000) {
            dom.scaleError.textContent = '副本数需在 0-1000 之间';
            dom.scaleError.classList.remove('hidden');
            return;
        }
        dom.scaleError.classList.add('hidden');
        setBusy(dom.btnScale, true, '保存中…');
        api('kube/deployment/scale', {
            connectionId: connId(), namespace: ctx.ns, name: ctx.name, replicas: replicas
        }, 60000).then(function () {
            toast('副本数已调整为 ' + replicas, 'success');
            closeModal('scaleModal');
            loadView('deployments', true);
        }).catch(function (e) {
            dom.scaleError.textContent = e.message || String(e);
            dom.scaleError.classList.remove('hidden');
        }).then(function () {
            setBusy(dom.btnScale, false, '保存');
        });
    }

    function deleteEditingProfile() {
        var id = state.editingProfileId;
        if (!id) { return; }
        confirmAction('删除保存的连接', '确定删除这条连接配置吗？', function () {
            api('profiles/delete', { id: id }, 30000).then(function () {
                toast('连接已删除', 'success');
                closeModal('connectModal');
                state.editingProfileId = '';
                loadProfiles();
            }).catch(showError);
        });
    }

    /* ---------------- modal helpers ---------------- */

    window.addEventListener('message', function (ev) {
        // 兼容宿主在 iframe 尺寸变化时触发的重绘
        if (ev.data && ev.data.source === 'deepshell-host' && ev.data.type === 'plugin.resize') {
            document.documentElement.style.height = '100%';
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
