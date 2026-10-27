/* 可复用的连接编辑弹窗（全局组件 conn-form-dialog）
 * 新建连接默认走「首次连接向导」：云厂商 / 系统镜像 → 地址与登录方式 → 测试并保存；
 * 编辑或高级场景保留完整表单。依赖 issue-help.js / host-key-details.js。
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

    var CLOUD_PROVIDERS = [
        {
            id: 'aliyun', name: '阿里云', icon: 'el-icon-cloudy', desc: 'ECS / 轻量应用服务器',
            consoleUrl: 'https://ecs.console.aliyun.com/server',
            ipSteps: [
                '登录阿里云控制台 → 云服务器 ECS → 实例与镜像 → 实例。',
                '找到目标实例，复制「公网 IP」或「弹性公网 IP」；如果只有内网 IP，先绑定 EIP。',
                '进入实例的「安全组」，确认入方向放行 TCP 22（或你设置的 SSH 端口），来源建议填自己的 IP。',
                '不知道登录名 / 密码：实例详情 → 远程连接；忘记密码可在控制台「重置实例密码」。'
            ]
        },
        {
            id: 'tencent', name: '腾讯云', icon: 'el-icon-cloudy', desc: 'CVM / 轻量应用服务器',
            consoleUrl: 'https://console.cloud.tencent.com/cvm/instance',
            ipSteps: [
                '登录腾讯云控制台 → 云服务器 CVM → 实例列表。',
                '复制实例的「公网 IP」；轻量应用服务器在「轻量应用服务器」页面查看公网 IP。',
                '在「安全组」中放行入方向 TCP 22（或自定义 SSH 端口）。',
                '忘记密码：实例右侧「更多」→「密码/密钥」→「重置密码」，重启后生效。'
            ]
        },
        {
            id: 'huawei', name: '华为云', icon: 'el-icon-cloudy', desc: 'ECS 弹性云服务器',
            consoleUrl: 'https://console.huaweicloud.com/ecm/',
            ipSteps: [
                '登录华为云控制台 → 弹性云服务器 ECS → 实例列表。',
                '复制实例的「弹性公网 IP」；没有的话先绑定弹性公网 IP。',
                '在「安全组」中放行入方向 TCP 22（或你的 SSH 端口）。',
                '忘记密码：实例操作列「更多」→「重置密码」；也可以在控制台使用 VNC 登录。'
            ]
        },
        {
            id: 'other', name: '其他 / 本机虚拟机', icon: 'el-icon-monitor', desc: '公司服务器、VPS、VMware 等',
            consoleUrl: '',
            ipSteps: [
                '在服务商控制台 / 虚拟化平台找到实例的公网 IP 或内网 IP。',
                '同公司内网、家庭局域网或 NAT 后面的机器，需要确认这台电脑能访问该地址（必要时用 VPN / 跳板机）。',
                '确认服务器防火墙放行 SSH 端口；云服务器还要检查安全组。',
                '登录名和密码由服务器管理员提供；Ubuntu 镜像常见 ubuntu，其他 Linux 常见 root。'
            ]
        }
    ];

    var OS_PRESETS = [
        { id: 'ubuntu', label: 'Ubuntu', user: 'ubuntu', hint: 'Ubuntu 镜像通常使用 ubuntu 用户；部分云厂商也允许 root，以控制台为准。' },
        { id: 'debian', label: 'Debian', user: 'root', hint: 'Debian 云镜像的默认用户由厂商决定，常见 root / admin / debian，以控制台为准。' },
        { id: 'centos', label: 'CentOS / Rocky / Alma', user: 'root', hint: '这类系统通常直接使用 root 登录。' },
        { id: 'alibaba', label: 'Alibaba Cloud Linux / openEuler', user: 'root', hint: '默认通常是 root。' },
        { id: 'other', label: '其他 Linux', user: 'root', hint: '不确定时先试 root；Ubuntu 类镜像试 ubuntu。' }
    ];

    function emptyForm() {
        return {
            id: null, name: '', folderId: null, host: '', port: 22, username: '',
            authType: 'PASSWORD', password: '', keyPath: '', passphrase: '', remark: '',
            proxyType: 'NONE', proxyHost: '', proxyPort: null, proxyUsername: '', proxyPassword: '',
            jumpConnectionId: null, persistSession: true
        };
    }

    function emptyTestState() {
        return { status: 'idle', result: null, error: null, hostKey: null, ack: false, trusting: false };
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    Vue.component('conn-form-dialog', {
        template: `
<el-dialog :title="dialogTitle" :visible.sync="visible" width="680px" append-to-body
           custom-class="conn-form-dialog cw-dialog" top="3vh"
           :close-on-click-modal="false" :close-on-press-escape="false">
    <div class="cw-mode-switch" v-if="isNew">
        <el-radio-group v-model="mode" size="mini">
            <el-radio-button label="wizard">首次连接向导</el-radio-button>
            <el-radio-button label="advanced">高级设置</el-radio-button>
        </el-radio-group>
        <span class="cw-mode-hint">不确定怎么填？用向导；需要代理 / 跳板机 / 文件夹时用高级设置。</span>
    </div>

    <!-- ================= 向导 ================= -->
    <div v-if="mode === 'wizard' && isNew" class="cw-wizard">
        <el-steps :active="step" finish-status="success" simple class="cw-steps">
            <el-step title="选择服务器"></el-step>
            <el-step title="填写登录信息"></el-step>
            <el-step title="测试并保存"></el-step>
        </el-steps>

        <div v-if="step === 0" class="cw-step">
            <div class="cw-section-title">服务器是哪家云？</div>
            <div class="cw-provider-grid">
                <div v-for="p in providerPresets" :key="p.id" class="cw-provider"
                     :class="{ active: provider === p.id }" @click="chooseProvider(p.id)">
                    <i :class="p.icon"></i>
                    <b>{{ p.name }}</b>
                    <span>{{ p.desc }}</span>
                </div>
            </div>

            <div class="cw-section-title">安装的是什么系统？</div>
            <el-radio-group v-model="osType" size="small" class="cw-os-group" @change="applyOsPreset">
                <el-radio-button v-for="o in osPresets" :key="o.id" :label="o.id">{{ o.label }}</el-radio-button>
            </el-radio-group>
            <div class="cw-hint cw-os-hint">
                {{ osHint }} 建议登录名：<b>{{ suggestedUsername }}</b>（随时可以在下一步改成实际用户名）。
            </div>

            <div class="cw-ip-guide" v-if="currentProvider">
                <div class="cw-ip-head" @click="ipGuideOpen = !ipGuideOpen">
                    <i class="el-icon-location-outline"></i>
                    <b>去哪找服务器 IP 和登录密码？</b>
                    <span>{{ currentProvider.name }}操作步骤</span>
                    <i class="el-icon-arrow-down" :class="{ open: ipGuideOpen }"></i>
                </div>
                <ol v-show="ipGuideOpen">
                    <li v-for="(s, i) in currentProvider.ipSteps" :key="i">{{ s }}</li>
                </ol>
                <a v-if="currentProvider.consoleUrl" :href="currentProvider.consoleUrl"
                   target="_blank" rel="noopener" class="cw-console-link">
                    打开 {{ currentProvider.name }}控制台 <i class="el-icon-top-right"></i>
                </a>
            </div>
        </div>

        <div v-else-if="step === 1" class="cw-step">
            <el-form label-width="96px" size="small" class="cw-form">
                <el-form-item label="连接名称">
                    <el-input v-model="form.name" placeholder="不填则用服务器地址，例如 47.98.12.34"></el-input>
                </el-form-item>
                <el-form-item label="服务器地址" required>
                    <el-input v-model="form.host" @blur="normalizeHost"
                              placeholder="公网 IP 或域名，例如 47.98.12.34"></el-input>
                    <div class="cw-hint">不要带 http:// 或结尾斜杠；云服务器在实例列表里复制公网 / 弹性公网 IP。</div>
                </el-form-item>
                <div class="cw-two-col">
                    <el-form-item label="端口">
                        <el-input-number v-model="form.port" :min="1" :max="65535" :controls="false"
                                         style="width:120px"></el-input-number>
                        <span class="cw-hint" style="margin-left:8px">SSH 默认 22</span>
                    </el-form-item>
                    <el-form-item label="用户名" required>
                        <el-input v-model="form.username" placeholder="root / ubuntu"></el-input>
                    </el-form-item>
                </div>
                <div class="cw-hint" style="margin:-4px 0 10px 96px">{{ usernameHint }}</div>

                <el-form-item label="登录方式">
                    <el-radio-group v-model="form.authType">
                        <el-radio-button label="PASSWORD">密码</el-radio-button>
                        <el-radio-button label="KEY">私钥</el-radio-button>
                    </el-radio-group>
                </el-form-item>
                <el-form-item v-if="form.authType === 'PASSWORD'" label="密码">
                    <el-input v-model="form.password" type="password" show-password
                              placeholder="云控制台「重置实例密码」后填这里"></el-input>
                    <div class="cw-hint">如果服务器禁用了 root 密码登录，请改用创建实例时的普通用户，登录后再 sudo。</div>
                </el-form-item>
                <template v-else>
                    <el-form-item label="私钥路径">
                        <el-input v-model="form.keyPath"
                                  placeholder="运行 DeepShell 的这台电脑上的私钥绝对路径"></el-input>
                    </el-form-item>
                    <el-form-item label="私钥口令">
                        <el-input v-model="form.passphrase" type="password" show-password
                                  placeholder="私钥没有口令就留空"></el-input>
                        <div class="cw-hint">仅支持 OpenSSH / PEM 格式。PuTTY 的 .ppk 需要先用 PuTTYgen 转成 OpenSSH。</div>
                        <div class="cw-warn" v-if="isPpk">这是 PuTTY 的 .ppk 文件，JSch 不能直接读取；请先转换，或改用密码登录。</div>
                    </el-form-item>
                </template>
            </el-form>
        </div>

        <div v-else class="cw-step">
            <div class="cw-review">
                <div><span>服务器</span><b>{{ form.host || '未填写' }}:{{ form.port || 22 }}</b></div>
                <div><span>登录用户</span><b>{{ form.username || '未填写' }}</b></div>
                <div><span>认证方式</span><b>{{ form.authType === 'KEY' ? '私钥' : '密码' }}</b></div>
                <div><span>名称</span><b>{{ form.name || form.host || '将使用服务器地址' }}</b></div>
            </div>
            <div class="cw-test-head">
                <div>
                    <b>先测试一次，确认能连上再保存</b>
                    <p>测试会真正登录一次服务器，但不会执行任何命令，也不会保存密码到浏览器。</p>
                </div>
                <el-button size="small" type="primary" plain :loading="testState.status === 'testing'"
                           @click="runTest">重新测试</el-button>
            </div>
        </div>

        <div class="cw-test-area" v-if="step === 2 || (mode === 'advanced' && testState.status !== 'idle')">
            <div v-if="testState.status === 'testing'" class="cw-testing">
                <i class="el-icon-loading"></i> 正在连接服务器，请稍候…
            </div>
            <div v-else-if="testState.status === 'success'" class="cw-success">
                <i class="el-icon-circle-check"></i>
                <div>
                    <b>{{ testState.result && testState.result.message || '连接成功' }}</b>
                    <span v-if="testState.result && testState.result.serverVersion">
                        服务端：{{ testState.result.serverVersion }}
                    </span>
                </div>
            </div>
            <template v-else-if="testState.status === 'hostkey' && testState.hostKey">
                <host-key-details :info="testState.hostKey"></host-key-details>
                <div class="cw-trust-row">
                    <el-checkbox v-model="testState.ack">
                        {{ testState.hostKey.changed ? '我已通过云控制台 VNC 核对，确认这是重装 / 换密钥导致的' : '我已核对指纹，确认这是我要连接的服务器' }}
                    </el-checkbox>
                    <el-button size="small" type="primary" :disabled="!testState.ack"
                               :loading="testState.trusting" @click="trustHostKey">信任并继续测试</el-button>
                </div>
            </template>
            <issue-help v-else-if="testState.status === 'error' && testState.error"
                        :error="testState.error"></issue-help>
        </div>
    </div>

    <!-- ================= 高级 / 编辑 ================= -->
    <el-form v-else label-width="96px" size="small" class="cw-form">
        <el-form-item label="名称" required>
            <el-input v-model="form.name" placeholder="例如：生产环境-Web01"></el-input>
        </el-form-item>
        <el-form-item label="文件夹">
            <el-cascader v-model="form.folderId" :options="folderOptions"
                         :props="{ checkStrictly: true, emitPath: false }" clearable
                         placeholder="不选择则放在根目录" style="width: 100%"></el-cascader>
        </el-form-item>
        <el-form-item label="主机" required>
            <el-input v-model="form.host" @blur="normalizeHost" placeholder="公网 IP 或域名"></el-input>
        </el-form-item>
        <el-form-item label="端口">
            <el-input-number v-model="form.port" :min="1" :max="65535" :controls="false"
                             style="width: 120px"></el-input-number>
        </el-form-item>
        <el-form-item label="用户名" required>
            <el-input v-model="form.username" placeholder="root / ubuntu"></el-input>
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
        <issue-help v-if="testState.status === 'error' && testState.error"
                    :error="testState.error"></issue-help>
        <div v-else-if="testState.status === 'success'" class="cw-success" style="margin-top:6px">
            <i class="el-icon-circle-check"></i>
            <div><b>{{ testState.result && testState.result.message || '连接成功' }}</b></div>
        </div>
    </el-form>

    <div slot="footer">
        <template v-if="mode === 'wizard' && isNew">
            <el-button size="small" style="float:left" v-if="step === 0"
                       @click="mode = 'advanced'">直接填写全部参数</el-button>
            <el-button size="small" style="float:left" v-else-if="step === 1"
                       @click="mode = 'advanced'">代理 / 跳板机等高级设置</el-button>
            <el-button size="small" v-if="step > 0" @click="step--">上一步</el-button>
            <el-button size="small" type="primary" v-if="step === 0" @click="goStep1">下一步</el-button>
            <el-button size="small" type="primary" v-else-if="step === 1" @click="goTest">下一步：测试</el-button>
            <el-button size="small" type="primary" v-else :disabled="testing"
                       :loading="saving" @click="save">保存连接</el-button>
            <el-button size="small" v-if="step === 2" @click="visible = false">取消</el-button>
        </template>
        <template v-else>
            <el-button size="small" style="float: left" :loading="testing"
                       :disabled="saving" @click="runTest">测试连接</el-button>
            <el-button size="small" @click="visible = false">取消</el-button>
            <el-button size="small" type="primary" :loading="saving"
                       :disabled="testing" @click="save">保存</el-button>
        </template>
    </div>
</el-dialog>`,
        data: function () {
            return {
                visible: false,
                saving: false,
                testing: false,
                mode: 'wizard',
                step: 0,
                provider: 'aliyun',
                osType: 'ubuntu',
                ipGuideOpen: true,
                lastSuggested: '',
                folders: [],
                folderOptions: [],
                connections: [],
                providerPresets: CLOUD_PROVIDERS,
                osPresets: OS_PRESETS,
                form: emptyForm(),
                testState: emptyTestState()
            };
        },
        computed: {
            isNew: function () {
                return !this.form.id;
            },
            dialogTitle: function () {
                if (!this.isNew) {
                    return '编辑连接';
                }
                return this.mode === 'wizard' ? '新建连接 · 首次连接向导' : '新建连接 · 高级设置';
            },
            currentProvider: function () {
                for (var i = 0; i < this.providerPresets.length; i++) {
                    if (this.providerPresets[i].id === this.provider) {
                        return this.providerPresets[i];
                    }
                }
                return this.providerPresets[this.providerPresets.length - 1];
            },
            currentOs: function () {
                for (var i = 0; i < this.osPresets.length; i++) {
                    if (this.osPresets[i].id === this.osType) {
                        return this.osPresets[i];
                    }
                }
                return this.osPresets[this.osPresets.length - 1];
            },
            suggestedUsername: function () {
                return this.currentOs ? this.currentOs.user : 'root';
            },
            osHint: function () {
                return this.currentOs ? this.currentOs.hint : '';
            },
            usernameHint: function () {
                if (this.currentOs && this.currentOs.id === 'ubuntu') {
                    return 'Ubuntu 镜像常用 ubuntu；如果用 root 被拒绝，先换成 ubuntu 再试。';
                }
                return '云厂商创建实例时会显示默认登录名；不确定就先用 root 试一次。';
            },
            isPpk: function () {
                return /\.ppk$/i.test(String(this.form.keyPath || '').trim());
            },
            jumpOptions: function () {
                var selfId = this.form.id;
                return (this.connections || []).filter(function (c) {
                    return c.id !== selfId;
                });
            }
        },
        methods: {
            open: function (row, prefill) {
                var self = this;
                http.get('/api/folders').then(function (d) {
                    self.folders = d || [];
                    self.folderOptions = self.buildFolderOptions(null);
                }).catch(function () { /* 忽略 */ });
                http.get('/api/connections').then(function (d) {
                    self.connections = d || [];
                }).catch(function () { /* 忽略 */ });
                this.testState = emptyTestState();
                this.testing = false;
                this.saving = false;
                this.ipGuideOpen = true;
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
                    this.mode = 'advanced';
                } else if (prefill) {
                    // 从终端输出里的 IP:端口 打开：预填地址，其余交给用户确认
                    this.form = emptyForm();
                    this.form.host = prefill.host || '';
                    this.form.port = prefill.port || 22;
                    this.form.username = prefill.username || 'root';
                    this.form.name = prefill.name || this.form.host;
                    this.mode = 'advanced';
                    this.step = 0;
                    this.provider = 'custom';
                    this.lastSuggested = '';
                    this.ipGuideOpen = false;
                } else {
                    this.form = emptyForm();
                    this.mode = 'wizard';
                    this.step = 0;
                    this.provider = 'aliyun';
                    this.osType = 'ubuntu';
                    this.lastSuggested = '';
                    this.applyOsPreset();
                }
                this.visible = true;
            },
            chooseProvider: function (id) {
                this.provider = id;
                this.testState = emptyTestState();
            },
            applyOsPreset: function () {
                var user = this.suggestedUsername;
                if (!this.form.username || this.form.username === this.lastSuggested) {
                    this.form.username = user;
                }
                this.lastSuggested = user;
            },
            normalizeHost: function () {
                var h = String(this.form.host || '').trim();
                h = h.replace(/^[a-zA-Z]+:\/\//, '');
                h = h.replace(/\/.*$/, '');
                h = h.replace(/\s+/g, '');
                this.form.host = h;
            },
            goStep1: function () {
                if (this.form.username && this.form.username !== this.lastSuggested) {
                    // 用户已经手动改过用户名，保留
                } else {
                    this.applyOsPreset();
                }
                this.step = 1;
            },
            goTest: function () {
                if (!this.validateBasics()) {
                    return;
                }
                if (!this.form.name || !this.form.name.trim()) {
                    this.form.name = this.form.host.trim();
                }
                this.step = 2;
                this.runTest();
            },
            validateBasics: function () {
                if (!this.form.host || !this.form.host.trim()) {
                    ELEMENT.Message.warning('请填写服务器地址（公网 IP 或域名）');
                    return false;
                }
                if (!this.form.username || !this.form.username.trim()) {
                    ELEMENT.Message.warning('请填写登录用户名');
                    return false;
                }
                if (!this.form.port || this.form.port < 1 || this.form.port > 65535) {
                    ELEMENT.Message.warning('端口范围是 1 - 65535，SSH 默认 22');
                    return false;
                }
                if (!this.form.authType || this.form.authType !== 'KEY') {
                    if (!this.form.password && !this.form.id) {
                        ELEMENT.Message.warning('请填写登录密码；忘记密码可在云控制台重置');
                        return false;
                    }
                } else if (!this.form.keyPath || !this.form.keyPath.trim()) {
                    ELEMENT.Message.warning('请填写私钥文件的绝对路径');
                    return false;
                }
                return true;
            },
            runTest: function () {
                var f = this.form;
                if (!this.validateBasics() || this.testing) {
                    return;
                }
                var self = this;
                this.testing = true;
                this.testState = { status: 'testing', result: null, error: null, hostKey: null, ack: false, trusting: false };
                http.post('/api/connections/test', {
                    id: f.id, host: f.host, port: f.port || 22, username: f.username,
                    authType: f.authType, password: f.password, keyPath: f.keyPath,
                    passphrase: f.passphrase, proxyType: f.proxyType, proxyHost: f.proxyHost,
                    proxyPort: f.proxyPort, proxyUsername: f.proxyUsername,
                    proxyPassword: f.proxyPassword, jumpConnectionId: f.jumpConnectionId
                }).then(function (d) {
                    if (d && d.needTrust) {
                        self.testState = {
                            status: 'hostkey', result: null, error: null,
                            hostKey: d.hostKey, ack: false, trusting: false
                        };
                        return;
                    }
                    if (d && d.ok === false) {
                        self.testState = {
                            status: 'error', result: null,
                            error: d.error || { title: '连接失败', summary: d.message || '请检查连接参数' },
                            hostKey: null, ack: false, trusting: false
                        };
                        return;
                    }
                    self.testState = {
                        status: 'success', result: d || {}, error: null, hostKey: null,
                        ack: false, trusting: false
                    };
                }).catch(function (e) {
                    self.testState = {
                        status: 'error', result: null,
                        error: {
                            title: '测试请求失败',
                            summary: (e && e.message) || '无法连接 DeepShell 后端',
                            steps: ['确认 DeepShell 仍在运行，然后重新测试。']
                        },
                        hostKey: null, ack: false, trusting: false
                    };
                }).then(function () {
                    self.testing = false;
                });
            },
            trustHostKey: function () {
                var s = this.testState;
                if (!s.hostKey || !s.ack || s.trusting) {
                    return;
                }
                var info = s.hostKey;
                var self = this;
                s.trusting = true;
                http.post('/api/known-hosts/trust', {
                    host: info.host, port: info.port, keyType: info.keyType,
                    keyBase64: info.keyBase64, replace: !!info.changed,
                    role: info.role, roleLabel: info.roleLabel
                }).then(function () {
                    s.trusting = false;
                    self.runTest();
                }).catch(function () {
                    s.trusting = false;
                });
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
            save: function () {
                var self = this;
                if (!this.validateBasics()) {
                    return;
                }
                if (!this.form.name || !this.form.name.trim()) {
                    this.form.name = this.form.host.trim();
                }
                var doSave = function () {
                    var f = self.form;
                    var body = {
                        name: f.name, folderId: f.folderId, host: f.host, port: f.port,
                        username: f.username, authType: f.authType, password: f.password,
                        keyPath: f.keyPath, passphrase: f.passphrase, remark: f.remark,
                        proxyType: f.proxyType, proxyHost: f.proxyHost, proxyPort: f.proxyPort,
                        proxyUsername: f.proxyUsername, proxyPassword: f.proxyPassword,
                        jumpConnectionId: f.jumpConnectionId, persistSession: f.persistSession
                    };
                    self.saving = true;
                    var req = f.id ? http.put('/api/connections/' + f.id, body) : http.post('/api/connections', body);
                    req.then(function (saved) {
                        ELEMENT.Message.success('已保存');
                        self.visible = false;
                        self.$emit('saved', saved);
                    }).catch(function () { /* 已由拦截器提示 */ })
                        .then(function () {
                            self.saving = false;
                        });
                };
                if (this.isNew && this.testState.status !== 'success') {
                    ELEMENT.MessageBox.confirm(
                        '连接还没有测试成功，保存后可能无法直接登录。仍要保存吗？',
                        '保存未验证的连接',
                        { type: 'warning', confirmButtonText: '仍然保存', cancelButtonText: '返回测试' }
                    ).then(doSave).catch(function () { /* 取消 */ });
                } else {
                    doSave();
                }
            },
            onProxyTypeChange: function (v) {
                if (!this.form.proxyPort) {
                    this.form.proxyPort = v === 'SOCKS5' ? 1080 : 8080;
                }
            }
        }
    });
})();
