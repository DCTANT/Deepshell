/* 可复用的连接编辑弹窗（全局组件 conn-form-dialog）
 * 用法：页面引入本文件后放置 <conn-form-dialog ref="connForm" @saved="onSaved"></conn-form-dialog>
 *       this.$refs.connForm.open(null) 弹窗新建；open(row) 编辑；
 *       @saved 事件回传保存后的连接对象，可反复复用
 */
(function () {
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
        if (err && err.response && err.response.status === 401) {
            if (location.pathname !== '/login') {
                var back = location.pathname + location.search;
                location.href = '/login?redirect=' + encodeURIComponent(back);
            }
            return Promise.reject(err);
        }
        ELEMENT.Message.error('网络错误: ' + (err.message || err));
        return Promise.reject(err);
    });

    function emptyForm() {
        return {
            id: null, name: '', folderId: null, host: '', port: 22, username: '',
            authType: 'PASSWORD', password: '', keyPath: '', passphrase: '', remark: '',
            proxyType: 'NONE', proxyHost: '', proxyPort: null, proxyUsername: '', proxyPassword: '',
            jumpConnectionId: null, persistSession: true
        };
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    Vue.component('conn-form-dialog', {
        template: `
<el-dialog :title="form.id ? '编辑连接' : '新建连接'" :visible.sync="visible" width="580px" append-to-body
           custom-class="conn-form-dialog" top="3vh"
           :close-on-click-modal="false" :close-on-press-escape="false">
    <el-form label-width="90px" size="small">
        <el-form-item label="名称" required>
            <el-input v-model="form.name" placeholder="例如：生产环境-Web01"></el-input>
        </el-form-item>
        <el-form-item label="文件夹">
            <el-cascader v-model="form.folderId" :options="folderOptions"
                         :props="{ checkStrictly: true, emitPath: false }" clearable
                         placeholder="不选择则放在根目录" style="width: 100%"></el-cascader>
        </el-form-item>
        <el-form-item label="主机" required>
            <el-input v-model="form.host" placeholder="IP 或域名"></el-input>
        </el-form-item>
        <el-form-item label="端口">
            <el-input-number v-model="form.port" :min="1" :max="65535" :controls="false"
                             style="width: 120px"></el-input-number>
        </el-form-item>
        <el-form-item label="用户名" required>
            <el-input v-model="form.username" placeholder="root"></el-input>
        </el-form-item>
        <el-form-item label="认证方式">
            <el-radio-group v-model="form.authType">
                <el-radio-button label="PASSWORD">密码</el-radio-button>
                <el-radio-button label="KEY">密钥</el-radio-button>
            </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.authType === 'PASSWORD'" label="密码">
            <el-input v-model="form.password" type="password" show-password
                      :placeholder="form.id ? '留空表示不修改' : '请输入密码'"></el-input>
        </el-form-item>
        <template v-else>
            <el-form-item label="私钥路径">
                <el-input v-model="form.keyPath"
                          placeholder="运行本工具机器上的私钥文件绝对路径（OpenSSH 格式）"></el-input>
            </el-form-item>
            <el-form-item label="私钥口令">
                <el-input v-model="form.passphrase" type="password" show-password
                          :placeholder="form.id ? '留空表示不修改' : '如无私钥口令则留空'"></el-input>
            </el-form-item>
        </template>
        <el-divider content-position="left">网络与持久化</el-divider>
        <el-form-item label="跳板机">
            <el-select v-model="form.jumpConnectionId" clearable filterable
                       placeholder="直连（不使用跳板机）" style="width: 100%">
                <el-option v-for="c in jumpOptions" :key="c.id"
                           :label="c.name + '（' + (c.username || '') + '@' + c.host + '）'"
                           :value="c.id"></el-option>
            </el-select>
            <div class="conn-form-hint">目标连接将通过所选连接建立隧道，可多级串联；代理只作用于链路最外层。</div>
        </el-form-item>
        <el-form-item label="代理">
            <el-select v-model="form.proxyType" style="width: 130px" @change="onProxyTypeChange">
                <el-option label="不使用" value="NONE"></el-option>
                <el-option label="HTTP" value="HTTP"></el-option>
                <el-option label="SOCKS5" value="SOCKS5"></el-option>
            </el-select>
        </el-form-item>
        <template v-if="form.proxyType !== 'NONE'">
            <el-form-item label="代理地址">
                <div style="display: flex; gap: 8px">
                    <el-input v-model="form.proxyHost" placeholder="127.0.0.1" style="flex: 1"></el-input>
                    <el-input-number v-model="form.proxyPort" :min="1" :max="65535" :controls="false"
                                     placeholder="端口" style="width: 100px"></el-input-number>
                </div>
            </el-form-item>
            <el-form-item label="代理账号">
                <el-input v-model="form.proxyUsername" placeholder="无认证可留空"></el-input>
            </el-form-item>
            <el-form-item label="代理密码">
                <el-input v-model="form.proxyPassword" type="password" show-password
                          :placeholder="form.id ? '留空表示不修改' : '无认证可留空'"></el-input>
            </el-form-item>
        </template>
        <el-form-item label="持久会话">
            <el-switch v-model="form.persistSession"></el-switch>
            <span class="conn-form-hint" style="margin-left: 8px">
                使用 tmux 保持会话；程序重启后，已打开的浏览器标签会自动重连恢复；服务器未安装 tmux 时回退为普通会话
            </span>
        </el-form-item>
        <el-form-item label="备注">
            <el-input v-model="form.remark" placeholder="可选"></el-input>
        </el-form-item>
    </el-form>
    <div slot="footer">
        <el-button size="small" style="float: left" :loading="testing"
                   :disabled="saving" @click="test">测试连接</el-button>
        <el-button size="small" @click="visible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="saving"
                   :disabled="testing" @click="save">保存</el-button>
    </div>
</el-dialog>`,
        data: function () {
            return {
                visible: false,
                saving: false,
                testing: false,
                folders: [],
                folderOptions: [],
                connections: [],
                form: emptyForm()
            };
        },
        computed: {
            jumpOptions: function () {
                var selfId = this.form.id;
                return (this.connections || []).filter(function (c) {
                    return c.id !== selfId;
                });
            }
        },
        methods: {
            onProxyTypeChange: function (v) {
                if (!this.form.proxyPort) {
                    this.form.proxyPort = v === 'SOCKS5' ? 1080 : 8080;
                }
            },
            /** 打开弹窗：row 为 null 时新建，否则为编辑（密码留空表示不修改） */
            open: function (row) {
                var self = this;
                http.get('/api/folders').then(function (d) {
                    self.folders = d || [];
                    self.folderOptions = self.buildFolderOptions(null);
                }).catch(function () { /* 忽略 */ });
                http.get('/api/connections').then(function (d) {
                    self.connections = d || [];
                }).catch(function () { /* 忽略 */ });
                if (row) {
                    this.form = {
                        id: row.id, name: row.name, folderId: row.folderId, host: row.host,
                        port: row.port, username: row.username, authType: row.authType,
                        password: '', keyPath: row.keyPath, passphrase: '', remark: row.remark,
                        proxyType: row.proxyType || 'NONE', proxyHost: row.proxyHost || '',
                        proxyPort: row.proxyPort || null, proxyUsername: row.proxyUsername || '',
                        proxyPassword: '', jumpConnectionId: row.jumpConnectionId || null,
                        persistSession: row.persistSession !== false
                    };
                } else {
                    this.form = emptyForm();
                }
                this.visible = true;
            },
            buildFolderOptions: function (parentId) {
                var self = this;
                return this.folders
                    .filter(function (f) { return (parentId == null ? !f.parentId : f.parentId === parentId); })
                    .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0) || a.id - b.id; })
                    .map(function (f) {
                        var node = { value: f.id, label: f.name };
                        var children = self.buildFolderOptions(f.id);
                        if (children.length) {
                            node.children = children;
                        }
                        return node;
                    });
            },
            /** 按当前表单参数试连一次；编辑态留空的密码 / 口令由服务端沿用已保存值 */
            test: function () {
                var f = this.form;
                if (!f.host || !f.host.trim()) {
                    ELEMENT.Message.warning('请输入主机地址');
                    return;
                }
                if (!f.username || !f.username.trim()) {
                    ELEMENT.Message.warning('请输入用户名');
                    return;
                }
                var self = this;
                this.testing = true;
                this.doTest().catch(function () { /* 已提示 */ })
                    .then(function () {
                        self.testing = false;
                    });
            },
            doTest: function () {
                var f = this.form;
                var self = this;
                return http.post('/api/connections/test', {
                    id: f.id, host: f.host, port: f.port || 22, username: f.username,
                    authType: f.authType, password: f.password, keyPath: f.keyPath,
                    passphrase: f.passphrase, proxyType: f.proxyType, proxyHost: f.proxyHost,
                    proxyPort: f.proxyPort, proxyUsername: f.proxyUsername,
                    proxyPassword: f.proxyPassword, jumpConnectionId: f.jumpConnectionId
                }).then(function (d) {
                    if (d && d.needTrust) {
                        return self.confirmTrust(d.hostKey);
                    }
                    ELEMENT.Message.success((d && d.message) || '连接成功');
                });
            },
            confirmTrust: function (info) {
                var self = this;
                if (!info) {
                    return Promise.reject(new Error('missing host key'));
                }
                var isChanged = !!info.changed;
                var title = isChanged ? '主机密钥已变更' : '首次连接，确认主机指纹';
                var html = '<div style="line-height:1.9;font-size:13px">'
                    + '<div><b>' + esc(info.roleLabel || (info.role === 'jump' ? '跳板机' : '目标主机')) + '</b>：'
                    + esc(info.host) + ':' + esc(info.port) + '</div>'
                    + '<div>密钥类型：' + esc(info.keyType) + '</div>'
                    + '<div>指纹：<code style="word-break:break-all">' + esc(info.fingerprint) + '</code></div>'
                    + (isChanged && info.knownFingerprint
                        ? '<div style="color:#f56c6c">原指纹：<code style="word-break:break-all">'
                            + esc(info.knownFingerprint) + '</code></div>'
                        : '')
                    + '<div style="margin-top:6px;color:' + (isChanged ? '#f56c6c' : '#909399') + '">'
                    + (isChanged
                        ? '主机密钥与之前保存的不一致，可能存在中间人攻击。请先在服务器上核对指纹。'
                        : '请与服务器管理员核对指纹后再信任。')
                    + '</div></div>';
                return ELEMENT.MessageBox.confirm(html, title, {
                    dangerouslyUseHTMLString: true,
                    confirmButtonText: isChanged ? '更新并信任' : '信任并连接',
                    cancelButtonText: '取消',
                    type: isChanged ? 'error' : 'warning'
                }).then(function () {
                    return http.post('/api/known-hosts/trust', {
                        host: info.host, port: info.port, keyType: info.keyType,
                        keyBase64: info.keyBase64, replace: isChanged,
                        role: info.role, roleLabel: info.roleLabel
                    });
                }).then(function () {
                    return self.doTest();
                });
            },
            save: function () {
                var f = this.form;
                if (!f.name || !f.name.trim()) {
                    ELEMENT.Message.warning('请输入名称');
                    return;
                }
                if (!f.host || !f.host.trim()) {
                    ELEMENT.Message.warning('请输入主机地址');
                    return;
                }
                if (!f.username || !f.username.trim()) {
                    ELEMENT.Message.warning('请输入用户名');
                    return;
                }
                var self = this;
                var body = {
                    name: f.name, folderId: f.folderId, host: f.host, port: f.port,
                    username: f.username, authType: f.authType, password: f.password,
                    keyPath: f.keyPath, passphrase: f.passphrase, remark: f.remark,
                    proxyType: f.proxyType, proxyHost: f.proxyHost, proxyPort: f.proxyPort,
                    proxyUsername: f.proxyUsername, proxyPassword: f.proxyPassword,
                    jumpConnectionId: f.jumpConnectionId, persistSession: f.persistSession
                };
                this.saving = true;
                var req = f.id ? http.put('/api/connections/' + f.id, body) : http.post('/api/connections', body);
                req.then(function (saved) {
                    ELEMENT.Message.success('已保存');
                    self.visible = false;
                    self.$emit('saved', saved);
                }).catch(function () { /* 已由拦截器提示 */ })
                    .then(function () {
                        self.saving = false;
                    });
            }
        }
    });
})();
