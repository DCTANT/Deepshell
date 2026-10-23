/* AI 配置向导：选厂商 → 教你去哪拿 Key → 选模型 → 一键测试 → 保存。 */
(function () {
    if (!document.getElementById('ai-wizard-style')) {
        var style = document.createElement('style');
        style.id = 'ai-wizard-style';
        style.textContent = [
            '.aiw{padding:2px 2px 0}',
            '.aiw-lead{margin:0 0 14px;color:#606a78;font-size:13px;line-height:1.8}',
            '.aiw-section-title{font-weight:700;color:#303133;font-size:13px;margin:6px 0 8px;display:flex;align-items:center;gap:6px}',
            '.aiw-provider-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}',
            '.aiw-provider{border:1px solid #dfe5ee;border-radius:10px;padding:10px 12px;cursor:pointer;background:#fff;transition:all .15s;position:relative;min-height:82px}',
            '.aiw-provider:hover{border-color:#9bbbf0;box-shadow:0 3px 10px rgba(47,111,214,.08)}',
            '.aiw-provider.active{border-color:#2f6fd6;background:#f2f7ff;box-shadow:0 0 0 2px rgba(47,111,214,.10)}',
            '.aiw-provider b{display:block;font-size:13px;color:#26364a;margin-bottom:3px;padding-right:30px}',
            '.aiw-provider span{display:block;font-size:11.5px;color:#8b96a5;line-height:1.5}',
            '.aiw-provider span.aiw-cost{display:inline-block;width:auto;margin-top:6px;padding:1px 7px}',
            '.aiw-tag{position:absolute;right:8px;top:8px;background:#e8f3e9;color:#2f8a4c;border-radius:8px;font-size:10px;padding:1px 6px}',
            '.aiw-cost{display:inline-block;margin-top:6px;font-size:11px;border-radius:8px;padding:1px 7px;background:#f0f4fa;color:#5b708c}',
            '.aiw-cost.low{background:#eaf7ee;color:#2f8a4c}.aiw-cost.mid{background:#fff5e6;color:#ad7020}.aiw-cost.high{background:#fdecec;color:#b4453f}',
            '.aiw-note{font-size:12px;color:#8b96a5;line-height:1.8;background:#f8fafc;border:1px solid #edf0f5;border-radius:8px;padding:9px 11px;margin-top:10px}',
            '.aiw-steps{margin:8px 0 10px;padding-left:20px;color:#4f5b6b;font-size:13px;line-height:1.9}',
            '.aiw-steps li{margin:4px 0}',
            '.aiw-link{color:#2f6fd6;word-break:break-all;cursor:pointer}',
            '.aiw-keybox{border:1px solid #e3e8f0;border-radius:8px;padding:12px;background:#fafbfd;margin-top:8px}',
            '.aiw-summary{display:flex;flex-wrap:wrap;gap:8px 22px;background:#f7f9fc;border:1px solid #e7ecf3;border-radius:8px;padding:10px 12px;font-size:12.5px;color:#5b6b7f;margin-bottom:12px}',
            '.aiw-summary b{color:#2b3b50;font-weight:600}',
            '.aiw-test-ok{border:1px solid #cce8d3;background:#f2fbf4;border-radius:9px;padding:12px 14px;color:#276b3a;font-size:13px;line-height:1.8;margin-top:10px}',
            '.aiw-test-ok b{display:block;margin-bottom:2px}',
            '.aiw-test-ok code{background:#e3f4e8;border-radius:4px;padding:1px 5px;font-size:11.5px}',
            '.aiw-reply{margin-top:6px;color:#5f7a65;font-size:12px;word-break:break-all}',
            '.aiw-warn{color:#a5671d;background:#fff8ec;border:1px solid #f0dfc2;border-radius:6px;padding:7px 10px;font-size:12px;line-height:1.7;margin-top:8px}',
            '.aiw-actions{display:flex;gap:8px;align-items:center;margin-top:12px}',
            '.aiw-actions .spacer{flex:1}',
            '@media(max-width:720px){.aiw-provider-grid{grid-template-columns:1fr 1fr}}'
        ].join('\n');
        document.head.appendChild(style);
    }

    Vue.component('ai-setup-wizard', {
        template: `
<el-dialog title="AI 配置向导" :visible.sync="visible" width="720px" top="4vh" append-to-body
           custom-class="ai-setup-dialog" :close-on-click-modal="false" :close-on-press-escape="!testing">
    <div class="aiw" v-loading="loading">
        <el-steps :active="step" finish-status="success" simple style="margin-bottom:18px">
            <el-step title="选择厂商"></el-step>
            <el-step title="获取 API Key"></el-step>
            <el-step title="选模型并测试"></el-step>
        </el-steps>

        <template v-if="step === 0">
            <p class="aiw-lead">
                先选一家模型服务商。AI 终端和「AI 生成命令」都会用它；配置保存在本机，只有调用 AI 时才会发送到对应厂商。
                不确定选哪家？<b>DeepSeek</b> 价格低、中文好，适合先试。
            </p>
            <div class="aiw-provider-grid">
                <div v-for="p in providers" :key="p.id" class="aiw-provider"
                     :class="{ active: providerId === p.id }" @click="selectProvider(p)">
                    <span class="aiw-tag" v-if="p.id === 'deepseek'">推荐</span>
                    <b>{{ p.name }}</b>
                    <span>{{ p.recommendedModel ? ('推荐模型：' + p.recommendedModel) : '兼容 OpenAI 接口' }}</span>
                    <span class="aiw-cost" :class="costClass(p)">{{ p.costLevel || '未知' }}费用</span>
                </div>
            </div>
            <div class="aiw-note" v-if="current">
                <b>{{ current.name }}</b>：{{ current.costHint || '费用以厂商官网为准。' }}<br>
                <span v-if="current.pricingUrl">参考价格：<a class="aiw-link" :href="current.pricingUrl"
                    target="_blank" rel="noopener">{{ current.pricingUrl }}</a></span>
            </div>
        </template>

        <template v-else-if="step === 1">
            <div class="aiw-section-title">第 2 步：拿到 {{ current ? current.name : '' }} 的 API Key</div>
            <ol class="aiw-steps" v-if="current && current.keySteps && current.keySteps.length">
                <li v-for="(s, i) in current.keySteps" :key="i">{{ s }}</li>
            </ol>
            <div class="aiw-note" v-if="current && current.keyUrl">
                打开 Key 页面：<a class="aiw-link" :href="current.keyUrl" target="_blank"
                    rel="noopener">{{ current.keyUrl }}</a>
                <br>复制后直接粘贴到下面。Key 通常只完整显示一次；不要发给别人，也不要截图分享。
            </div>
            <div class="aiw-keybox">
                <el-form label-width="86px" size="small">
                    <el-form-item label="API Key" required>
                        <el-input v-model="apiKey" type="password" show-password
                                  :placeholder="keyPlaceholder"></el-input>
                        <div class="aiw-note" v-if="hasKey && !providerChanged">
                            你已经配置过 Key。这里留空表示继续使用原 Key；重新填写会覆盖它。
                        </div>
                    </el-form-item>
                    <el-form-item label="API 地址" v-if="!current || !current.baseUrl">
                        <el-input v-model="baseUrl" placeholder="https://your-api-host/v1"></el-input>
                    </el-form-item>
                </el-form>
            </div>
        </template>

        <template v-else>
            <div class="aiw-summary">
                <span>厂商：<b>{{ current ? current.name : '自定义' }}</b></span>
                <span>模型：<b>{{ model || '未选择' }}</b></span>
                <span>费用：<b>{{ current ? current.costLevel : '未知' }}</b></span>
            </div>
            <el-form label-width="86px" size="small">
                <el-form-item label="API 地址">
                    <el-input v-model="baseUrl" placeholder="https://your-api-host/v1"></el-input>
                </el-form-item>
                <el-form-item label="模型">
                    <el-select v-model="model" filterable allow-create default-first-option
                               style="width:100%" :loading="loadingModels"
                               placeholder="选择推荐模型，或直接填写模型 ID">
                        <el-option v-for="m in models" :key="m" :label="m" :value="m"></el-option>
                    </el-select>
                    <div class="aiw-actions">
                        <el-button size="mini" icon="el-icon-refresh" :loading="loadingModels"
                                   @click="loadModels(false)">刷新模型列表</el-button>
                        <span class="aiw-note" v-if="modelsNote" style="margin:0;padding:3px 8px">{{ modelsNote }}</span>
                    </div>
                </el-form-item>
            </el-form>

            <div class="aiw-actions">
                <el-button type="primary" plain :loading="testing" @click="test">一键测试连接</el-button>
                <span class="aiw-note" style="margin:0">
                    会发一条「只回复 OK」的小请求，费用可忽略；不会执行任何命令。
                </span>
            </div>

            <div class="aiw-test-ok" v-if="testState && testState.ok">
                <b>连接成功，可以用了</b>
                延迟 {{ testState.latencyMs }} ms · 模型 <code>{{ testState.model }}</code>
                <div class="aiw-reply" v-if="testState.reply">模型回复：{{ testState.reply }}</div>
            </div>
            <issue-help v-else-if="testState && testState.error" :error="testState.error"></issue-help>

            <div class="aiw-note" v-if="current">
                {{ current.costHint || '' }}
                <template v-if="current.pricingUrl"><br>价格以厂商官网为准：
                    <a class="aiw-link" :href="current.pricingUrl" target="_blank" rel="noopener">{{ current.pricingUrl }}</a>
                </template>
            </div>
        </template>
    </div>

    <div slot="footer">
        <el-button size="small" @click="visible = false">取消</el-button>
        <el-button size="small" v-if="step > 0" @click="step--">上一步</el-button>
        <el-button size="small" type="primary" v-if="step === 0" @click="nextFromProvider">下一步</el-button>
        <el-button size="small" type="primary" v-else-if="step === 1" @click="nextFromKey">下一步</el-button>
        <el-button size="small" type="primary" v-else :disabled="testing"
                   :loading="saving" @click="save">保存并启用</el-button>
    </div>
</el-dialog>`,
        data: function () {
            return {
                visible: false,
                loading: false,
                step: 0,
                providers: [],
                providerId: 'deepseek',
                baseUrl: '',
                apiKey: '',
                model: '',
                models: [],
                modelsNote: '',
                loadingModels: false,
                testing: false,
                saving: false,
                testState: null,
                hasKey: false,
                savedProvider: ''
            };
        },
        computed: {
            current: function () {
                for (var i = 0; i < this.providers.length; i++) {
                    if (this.providers[i].id === this.providerId) {
                        return this.providers[i];
                    }
                }
                return null;
            },
            providerChanged: function () {
                return this.providerId !== this.savedProvider;
            },
            keyPlaceholder: function () {
                if (this.hasKey && !this.providerChanged) {
                    return '已配置，留空表示不修改';
                }
                return this.current && this.current.id === 'custom' ? '你的 API Key' : 'sk-...';
            }
        },
        methods: {
            open: function () {
                var self = this;
                this.visible = true;
                this.loading = true;
                this.step = 0;
                this.testState = null;
                this.apiKey = '';
                this.models = [];
                this.modelsNote = '';
                Promise.all([
                    axios.get('/api/ai/providers').then(function (r) { return r.data.data || []; }),
                    axios.get('/api/ai/config').then(function (r) { return r.data.data || {}; })
                ]).then(function (arr) {
                    self.providers = arr[0] || [];
                    var cfg = arr[1] || {};
                    self.providerId = cfg.provider || 'deepseek';
                    self.savedProvider = cfg.provider || '';
                    self.baseUrl = cfg.baseUrl || '';
                    self.model = cfg.model || '';
                    self.hasKey = !!cfg.hasKey;
                    var p = self.current;
                    if (p) {
                        if (!self.baseUrl) {
                            self.baseUrl = p.baseUrl || '';
                        }
                        if (!self.model || !self.hasKey) {
                            self.model = p.recommendedModel
                                || (p.fallbackModels && p.fallbackModels[0]) || self.model || '';
                        }
                    }
                    self.resetModels();
                }).catch(function () {
                    ELEMENT.Message.error('读取 AI 配置失败');
                    self.visible = false;
                }).then(function () {
                    self.loading = false;
                });
            },
            costClass: function (p) {
                var c = String(p && p.costLevel || '');
                if (c.indexOf('低') >= 0) return 'low';
                if (c.indexOf('高') >= 0) return 'high';
                if (c.indexOf('中') >= 0) return 'mid';
                return '';
            },
            selectProvider: function (p) {
                if (!p) {
                    return;
                }
                this.providerId = p.id;
                this.baseUrl = p.baseUrl || '';
                this.model = p.recommendedModel || (p.fallbackModels && p.fallbackModels[0]) || '';
                this.testState = null;
                this.resetModels();
            },
            resetModels: function () {
                var p = this.current;
                var list = p && p.fallbackModels ? p.fallbackModels.slice() : [];
                if (p && p.recommendedModel && list.indexOf(p.recommendedModel) < 0) {
                    list.unshift(p.recommendedModel);
                }
                var cur = (this.model || '').trim();
                if (cur && list.indexOf(cur) < 0) {
                    list.unshift(cur);
                }
                this.models = list;
                this.modelsNote = '';
            },
            nextFromProvider: function () {
                if (!this.providerId) {
                    ELEMENT.Message.warning('请选择一个模型厂商');
                    return;
                }
                this.step = 1;
            },
            nextFromKey: function () {
                if (!this.apiKey.trim() && !(this.hasKey && !this.providerChanged)) {
                    ELEMENT.Message.warning('请先粘贴 API Key');
                    return;
                }
                if (!this.baseUrl.trim()) {
                    ELEMENT.Message.warning('请填写 API 地址');
                    return;
                }
                this.step = 2;
                this.loadModels(true);
            },
            loadModels: function (silent) {
                var self = this;
                if (this.loadingModels) {
                    return;
                }
                var key = this.apiKey.trim();
                if (!key && !(this.hasKey && !this.providerChanged)) {
                    this.resetModels();
                    this.modelsNote = '还没有 Key，先展示内置常用模型；粘贴 Key 后点「刷新模型列表」可实时获取';
                    return;
                }
                this.loadingModels = true;
                axios.post('/api/ai/models', {
                    provider: this.providerId,
                    baseUrl: this.baseUrl,
                    apiKey: key
                }).then(function (r) {
                    var d = r.data.data || {};
                    var list = Array.isArray(d.models) ? d.models : [];
                    var cur = (self.model || '').trim();
                    if (list.length && cur && list.indexOf(cur) < 0) {
                        list.unshift(cur);
                    }
                    if (list.length) {
                        self.models = list;
                        if (!cur) {
                            self.model = list[0];
                        }
                    }
                    self.modelsNote = d.note || '';
                }).catch(function () {
                    self.modelsNote = '获取模型列表失败，可直接输入模型 ID';
                }).then(function () {
                    self.loadingModels = false;
                });
            },
            test: function () {
                var self = this;
                var key = this.apiKey.trim();
                if (!key && !(this.hasKey && !this.providerChanged)) {
                    ELEMENT.Message.warning('请先回到上一步填写 API Key');
                    return;
                }
                if (!this.baseUrl.trim()) {
                    ELEMENT.Message.warning('请填写 API 地址');
                    return;
                }
                if (!this.model.trim()) {
                    ELEMENT.Message.warning('请选择或输入模型');
                    return;
                }
                if (this.testing) {
                    return;
                }
                this.testing = true;
                this.testState = null;
                axios.post('/api/ai/test', {
                    provider: this.providerId,
                    baseUrl: this.baseUrl,
                    apiKey: key,
                    model: this.model
                }).then(function (r) {
                    self.testState = r.data.data || { ok: false, error: { title: '测试失败' } };
                }).catch(function (e) {
                    self.testState = {
                        ok: false,
                        error: {
                            title: '测试请求失败',
                            summary: (e && e.message) || '无法连接 DeepShell 后端',
                            steps: ['确认 DeepShell 仍在运行，然后重新测试。']
                        }
                    };
                }).then(function () {
                    self.testing = false;
                });
            },
            save: function () {
                var self = this;
                var key = this.apiKey.trim();
                if (!key && !(this.hasKey && !this.providerChanged)) {
                    ELEMENT.Message.warning('请先填写 API Key');
                    return;
                }
                if (!this.baseUrl.trim() || !this.model.trim()) {
                    ELEMENT.Message.warning('请填写 API 地址和模型');
                    return;
                }
                if (!this.testState || !this.testState.ok) {
                    ELEMENT.Message.warning('建议先点「一键测试连接」，确认配置可用后再保存');
                    return;
                }
                this.saving = true;
                axios.post('/api/ai/config', {
                    provider: this.providerId,
                    baseUrl: this.baseUrl,
                    apiKey: key,
                    model: this.model
                }).then(function (r) {
                    ELEMENT.Message.success('AI 已配置好，可以开始用了');
                    self.visible = false;
                    self.$emit('saved', r.data.data || {});
                }).catch(function (e) {
                    var msg = e && e.response && e.response.data && e.response.data.msg;
                    ELEMENT.Message.error(msg || '保存 AI 配置失败');
                }).then(function () {
                    self.saving = false;
                });
            }
        }
    });
})();
