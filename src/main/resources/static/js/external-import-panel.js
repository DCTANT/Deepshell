/* 连接导入：从 ~/.ssh/config 或 PuTTY 会话读取，勾选后导入。SSH / PuTTY 两个页签复用同一个组件。 */
(function () {
    if (!document.getElementById('external-import-style')) {
        var style = document.createElement('style');
        style.id = 'external-import-style';
        style.textContent = [
            '.eip{font-size:12.5px;color:#303133;line-height:1.65}',
            '.eip-top{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-bottom:8px}',
            '.eip-desc{flex:1;min-width:240px;color:#7b8798;font-size:12px;line-height:1.7}',
            '.eip-path{font-family:Consolas,"Courier New",monospace;font-size:11.5px;color:#52657d;background:#f4f7fb;border:1px solid #e6ebf2;border-radius:5px;padding:2px 7px;word-break:break-all;display:inline-block;margin-top:3px}',
            '.eip-loading{padding:24px;text-align:center;color:#8a96a6}',
            '.eip-empty{padding:16px;text-align:center;color:#8a96a6;background:#f8fafc;border:1px dashed #e1e7ef;border-radius:7px}',
            '.eip-list{max-height:320px;overflow:auto;border:1px solid #e8edf4;border-radius:8px;background:#fff}',
            '.eip-item{display:flex;gap:9px;align-items:flex-start;padding:8px 10px;border-bottom:1px solid #f1f4f8;cursor:pointer}',
            '.eip-item:last-child{border-bottom:0}',
            '.eip-item:hover{background:#f8fbff}',
            '.eip-item input[type=checkbox]{margin-top:3px;flex:0 0 auto}',
            '.eip-main{flex:1;min-width:0}',
            '.eip-main b{display:block;font-weight:600;color:#2c3d53;font-size:12.5px;word-break:break-all}',
            '.eip-main span{display:block;color:#7d8999;font-size:11.5px;word-break:break-all}',
            '.eip-meta{flex:0 0 auto;text-align:right;font-size:11px}',
            '.eip-tag{display:inline-block;border-radius:8px;background:#eef4fc;color:#4b73a8;padding:1px 7px}',
            '.eip-dup{display:block;color:#b06a1d;margin-top:2px}',
            '.eip-warn{margin-top:3px;color:#b06a1d;font-size:11.5px;line-height:1.55}',
            '.eip-warn div{display:flex;gap:4px;align-items:flex-start}',
            '.eip-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:9px}',
            '.eip-foot .spacer{flex:1}',
            '.eip-foot label{color:#7d8999;font-size:11.5px;display:flex;align-items:center;gap:5px;cursor:pointer}',
            '.eip-btn{border:1px solid #c9d7ea;background:#fff;color:#2f6fd6;border-radius:5px;font-size:11.5px;padding:3px 10px;cursor:pointer}',
            '.eip-btn.primary{background:#2f6fd6;color:#fff;border-color:#2f6fd6}',
            '.eip-btn:disabled{opacity:.5;cursor:not-allowed}',
            '.eip-link{color:#2f6fd6;cursor:pointer;font-size:11.5px;background:none;border:0;padding:0}'
        ].join('\n');
        document.head.appendChild(style);
    }

    Vue.component('external-import-panel', {
        props: {
            source: { type: String, required: true }
        },
        data: function () {
            return {
                loading: false,
                importing: false,
                info: null,
                checked: [],
                skipDuplicates: true
            };
        },
        computed: {
            entries: function () {
                return this.info && this.info.entries ? this.info.entries : [];
            },
            selectedCount: function () {
                return this.checked.length;
            },
            isSsh: function () {
                return this.source === 'ssh';
            }
        },
        mounted: function () {
            this.load();
        },
        methods: {
            load: function () {
                var self = this;
                this.loading = true;
                axios.get('/api/connections/import/sources').then(function (r) {
                    if (r.data && r.data.code !== 0) {
                        throw new Error(r.data.msg || '读取失败');
                    }
                    var d = (r.data && r.data.data) || {};
                    self.info = d[self.source] || {};
                    self.checked = (self.info.entries || []).filter(function (e) {
                        return !e.duplicate;
                    }).map(function (e) { return e.id; });
                }).catch(function (e) {
                    self.info = { entries: [], message: (e && e.message) || '读取本机配置失败' };
                }).then(function () {
                    self.loading = false;
                });
            },
            toggleAll: function (on) {
                this.checked = on ? this.entries.map(function (e) { return e.id; }) : [];
            },
            importSelected: function () {
                var self = this;
                if (!this.checked.length) {
                    ELEMENT.Message.warning('请先勾选要导入的连接');
                    return;
                }
                this.importing = true;
                axios.post('/api/connections/import/external', {
                    ids: this.checked,
                    skipDuplicates: this.skipDuplicates
                }).then(function (r) {
                    if (r.data && r.data.code !== 0) {
                        throw new Error(r.data.msg || '导入失败');
                    }
                    var d = (r.data && r.data.data) || {};
                    ELEMENT.Message.success(d.message || '导入完成');
                    self.$emit('imported', d);
                }).catch(function (e) {
                    ELEMENT.Message.error((e && e.message) || '导入失败');
                }).then(function () {
                    self.importing = false;
                });
            }
        },
        template: `
<div class="eip">
    <div class="eip-top">
        <div class="eip-desc">
            <template v-if="isSsh">
                读取运行 DeepShell 的这台电脑上的 OpenSSH 配置；每个 Host 会变成一条连接。
                只导入地址、用户、端口、私钥路径和代理，不读取密码。
            </template>
            <template v-else>
                读取 Windows 当前用户的 PuTTY 会话。PuTTY 不保存密码，导入后请编辑连接补全；
                .ppk 私钥需要先转成 OpenSSH 格式。
            </template>
            <div class="eip-path" v-if="info && info.path">{{ info.path }}</div>
        </div>
        <button type="button" class="eip-btn" :disabled="loading" @click="load">重新扫描</button>
    </div>

    <div class="eip-loading" v-if="loading">正在读取本机配置…</div>
    <template v-else>
        <div class="eip-empty" v-if="!entries.length">
            {{ info && info.message || '没有找到可导入的连接' }}
        </div>
        <template v-else>
            <div class="eip-list">
                <label class="eip-item" v-for="e in entries" :key="e.id">
                    <input type="checkbox" :value="e.id" v-model="checked">
                    <div class="eip-main">
                        <b>{{ e.name }}</b>
                        <span>{{ e.username }}@{{ e.host }}:{{ e.port }} · {{ e.authType === 'KEY' ? '私钥' : '密码' }}</span>
                        <div class="eip-warn" v-if="e.warnings && e.warnings.length">
                            <div v-for="(w, i) in e.warnings" :key="i">
                                <span>·</span><span>{{ w }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="eip-meta">
                        <span class="eip-tag">{{ e.source === 'ssh' ? 'SSH 配置' : 'PuTTY' }}</span>
                        <span class="eip-dup" v-if="e.duplicate">
                            {{ e.existingName ? '已存在：' + e.existingName : '与已有连接重复' }}
                        </span>
                    </div>
                </label>
            </div>
            <div class="eip-foot">
                <button type="button" class="eip-link" @click="toggleAll(true)">全选</button>
                <button type="button" class="eip-link" @click="toggleAll(false)">全不选</button>
                <label>
                    <input type="checkbox" v-model="skipDuplicates"> 跳过已有相同连接
                </label>
                <span class="spacer"></span>
                <span style="color:#8a96a6;font-size:11.5px">已选 {{ selectedCount }} 条</span>
                <button type="button" class="eip-btn primary" :disabled="importing || !selectedCount"
                        @click="importSelected">
                    {{ importing ? '导入中…' : '导入选中' }}
                </button>
            </div>
        </template>
    </template>
</div>`
    });
})();
