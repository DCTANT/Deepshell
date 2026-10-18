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
            authType: 'PASSWORD', password: '', keyPath: '', passphrase: '', remark: ''
        };
    }

    Vue.component('conn-form-dialog', {
        template: `
<el-dialog :title="form.id ? '编辑连接' : '新建连接'" :visible.sync="visible" width="580px" append-to-body
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
                form: emptyForm()
            };
        },
        methods: {
            /** 打开弹窗：row 为 null 时新建，否则为编辑（密码留空表示不修改） */
            open: function (row) {
                var self = this;
                http.get('/api/folders').then(function (d) {
                    self.folders = d || [];
                    self.folderOptions = self.buildFolderOptions(null);
                }).catch(function () { /* 忽略 */ });
                if (row) {
                    this.form = {
                        id: row.id, name: row.name, folderId: row.folderId, host: row.host,
                        port: row.port, username: row.username, authType: row.authType,
                        password: '', keyPath: row.keyPath, passphrase: '', remark: row.remark
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
                http.post('/api/connections/test', {
                    id: f.id, host: f.host, port: f.port || 22, username: f.username,
                    authType: f.authType, password: f.password, keyPath: f.keyPath,
                    passphrase: f.passphrase
                }).then(function (d) {
                    ELEMENT.Message.success((d && d.message) || '连接成功');
                }).catch(function () { /* 已由拦截器提示 */ })
                    .then(function () {
                        self.testing = false;
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
                    keyPath: f.keyPath, passphrase: f.passphrase, remark: f.remark
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
