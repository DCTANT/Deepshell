/* 绿色版应用集成面板：快捷方式、开机启动、托盘、自动更新。
   关于弹窗、桌面设置、首次运行引导共用，避免各写一套。 */
(function () {
    if (!document.getElementById('app-runtime-style')) {
        var style = document.createElement('style');
        style.id = 'app-runtime-style';
        style.textContent = [
            '.arp{font-size:13px;color:#303133;line-height:1.7}',
            '.arp-lead{margin:0 0 12px;color:#606a78;font-size:13px;line-height:1.8}',
            '.arp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-bottom:10px}',
            '.arp-card{border:1px solid #e6ebf2;border-radius:8px;padding:9px 11px;background:#fafbfd;display:flex;flex-direction:column;gap:4px}',
            '.arp-card b{font-size:12.5px;color:#34445a}',
            '.arp-card span{font-size:11.5px;color:#8a96a6;line-height:1.5;word-break:break-all}',
            '.arp-card button{align-self:flex-start;margin-top:2px;border:1px solid #c9d7ea;background:#fff;color:#2f6fd6;border-radius:5px;font-size:11.5px;padding:2px 9px;cursor:pointer}',
            '.arp-card button:disabled{opacity:.5;cursor:not-allowed}',
            '.arp-ok{color:#2f8a4c !important}',
            '.arp-warn{color:#b06a1d !important}',
            '.arp-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid #f0f2f6}',
            '.arp-row:first-of-type{border-top:0}',
            '.arp-row-info{flex:1;min-width:0}',
            '.arp-row-info b{display:block;font-size:12.5px;color:#34445a}',
            '.arp-row-info span{font-size:11.5px;color:#8a96a6}',
            '.arp-toggle{position:relative;width:38px;height:20px;border:0;border-radius:10px;background:#d6dde7;cursor:pointer;padding:0;transition:background .15s;flex:0 0 auto}',
            '.arp-toggle:after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:left .15s}',
            '.arp-toggle.on{background:#2f6fd6}',
            '.arp-toggle.on:after{left:20px}',
            '.arp-toggle:disabled{opacity:.5;cursor:not-allowed}',
            '.arp-update{margin-top:12px;border-top:1px solid #f0f2f6;padding-top:10px}',
            '.arp-update-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
            '.arp-update-head b{font-size:12.5px;color:#34445a}',
            '.arp-update-head .spacer{flex:1}',
            '.arp-update-head button{border:1px solid #c9d7ea;background:#fff;color:#2f6fd6;border-radius:5px;font-size:11.5px;padding:3px 9px;cursor:pointer}',
            '.arp-update-head button:disabled{opacity:.5;cursor:not-allowed}',
            '.arp-msg{font-size:11.5px;color:#8a96a6;margin-top:5px;line-height:1.6}',
            '.arp-new{border:1px solid #d9e6fb;background:#f4f8ff;border-radius:8px;padding:10px 12px;margin-top:8px}',
            '.arp-new b{color:#22549e}',
            '.arp-notes{white-space:pre-wrap;word-break:break-word;max-height:130px;overflow:auto;font-size:11.5px;line-height:1.7;background:#fff;border:1px solid #e6edf8;border-radius:6px;padding:7px 9px;margin:6px 0;color:#52657d;font-family:inherit}',
            '.arp-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:7px}',
            '.arp-actions button{border:1px solid #c9d7ea;background:#fff;color:#2f6fd6;border-radius:5px;font-size:11.5px;padding:3px 10px;cursor:pointer}',
            '.arp-actions button.primary{background:#2f6fd6;color:#fff;border-color:#2f6fd6}',
            '.arp-actions button.danger{background:#d9534f;color:#fff;border-color:#d9534f}',
            '.arp-actions button:disabled{opacity:.5;cursor:not-allowed}',
            '.arp-progress{height:6px;background:#e9eef6;border-radius:4px;overflow:hidden;margin-top:7px}',
            '.arp-progress i{display:block;height:100%;background:#2f6fd6;transition:width .3s}',
            '.arp-error{border:1px solid #f4cfc8;background:#fff6f4;color:#9c3d37;border-radius:7px;padding:8px 10px;font-size:12px;margin-top:8px}',
            '.arp-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}',
            '.arp-foot button{border:1px solid #c9d7ea;background:#fff;color:#52657d;border-radius:5px;font-size:12px;padding:4px 12px;cursor:pointer}',
            '.arp-foot button.primary{background:#2f6fd6;color:#fff;border-color:#2f6fd6}',
            '.arp.dark{color:#d7e2f1}',
            '.arp.dark .arp-card{background:#111a26;border-color:#2a3749}',
            '.arp.dark .arp-card b,.arp.dark .arp-row-info b,.arp.dark .arp-update-head b{color:#e4edf9}',
            '.arp.dark .arp-card span,.arp.dark .arp-row-info span,.arp.dark .arp-msg{color:#9fb0c6}',
            '.arp.dark .arp-card button,.arp.dark .arp-update-head button,.arp.dark .arp-actions button,.arp.dark .arp-foot button{background:#16202e;border-color:#34455c;color:#9dc0ff}',
            '.arp.dark .arp-row{border-top-color:#253244}',
            '.arp.dark .arp-new{background:#16202e;border-color:#2d466e}',
            '.arp.dark .arp-new b{color:#a9cbff}',
            '.arp.dark .arp-notes{background:#0d141e;border-color:#2a3749;color:#b5c3d6}',
            '.arp.dark .arp-error{background:#2a1b1b;border-color:#553232;color:#ffb4ad}'
        ].join('\n');
        document.head.appendChild(style);
    }

    Vue.component('app-runtime-panel', {
        props: {
            onboarding: { type: Boolean, default: false },
            dark: { type: Boolean, default: false }
        },
        data: function () {
            return {
                loading: true,
                status: null,
                error: '',
                busy: '',
                updateInfo: null,
                checking: false,
                updateError: '',
                download: { status: 'idle' },
                pollTimer: null
            };
        },
        computed: {
            packaged: function () {
                return !!(this.status && this.status.packaged);
            },
            shortcuts: function () {
                return (this.status && this.status.shortcuts) || {};
            },
            downloadPercent: function () {
                var v = this.download || {};
                if (v.percent != null && v.percent >= 0) {
                    return Math.max(0, Math.min(100, v.percent));
                }
                return 0;
            }
        },
        mounted: function () {
            this.load();
        },
        beforeDestroy: function () {
            this.stopPoll();
        },
        methods: {
            apiGet: function (url) {
                return axios.get(url).then(function (r) {
                    if (r.data && r.data.code !== 0) {
                        throw new Error(r.data.msg || '请求失败');
                    }
                    return r.data.data;
                });
            },
            apiPost: function (url, body) {
                return axios.post(url, body || {}).then(function (r) {
                    if (r.data && r.data.code !== 0) {
                        throw new Error(r.data.msg || '请求失败');
                    }
                    return r.data.data;
                });
            },
            load: function () {
                var self = this;
                this.loading = true;
                this.error = '';
                this.apiGet('/api/app-integration/status').then(function (d) {
                    self.status = d || {};
                    if (!self.status.local) {
                        self.error = '请在运行 DeepShell 的这台电脑上打开页面，才能创建快捷方式或更新应用。';
                    }
                }).catch(function (e) {
                    self.error = e.message || '读取应用信息失败';
                }).then(function () {
                    self.loading = false;
                });
            },
            createShortcut: function (kind) {
                var self = this;
                if (this.busy) {
                    return;
                }
                this.busy = kind;
                this.apiPost('/api/app-integration/shortcuts', {
                    desktop: kind === 'desktop',
                    startMenu: kind === 'startMenu',
                    action: 'create'
                }).then(function () {
                    ELEMENT.Message.success(kind === 'desktop' ? '桌面快捷方式已创建' : '开始菜单快捷方式已创建');
                    self.load();
                }).catch(function (e) {
                    ELEMENT.Message.error(e.message);
                }).then(function () {
                    self.busy = '';
                });
            },
            setStartup: function () {
                var self = this;
                if (!this.status || this.busy) {
                    return;
                }
                this.busy = 'startup';
                this.apiPost('/api/app-integration/startup', {
                    enabled: !this.status.startupEnabled
                }).then(function (d) {
                    self.status.startupEnabled = !!d.enabled;
                    ELEMENT.Message.success(d.enabled ? '已开启开机启动' : '已关闭开机启动');
                }).catch(function (e) {
                    ELEMENT.Message.error(e.message);
                }).then(function () {
                    self.busy = '';
                });
            },
            setTray: function () {
                var self = this;
                if (!this.status || this.busy) {
                    return;
                }
                this.busy = 'tray';
                this.apiPost('/api/app-integration/tray', {
                    enabled: !this.status.trayEnabled
                }).then(function (d) {
                    self.status.trayEnabled = !!d.enabled;
                    self.status.trayVisible = !!d.visible;
                    ELEMENT.Message.success(d.enabled ? '托盘图标已开启' : '托盘图标已关闭');
                }).catch(function (e) {
                    ELEMENT.Message.error(e.message);
                }).then(function () {
                    self.busy = '';
                });
            },
            setAutoUpdate: function () {
                var self = this;
                if (!this.status || this.busy) {
                    return;
                }
                this.busy = 'auto';
                this.apiPost('/api/app-integration/auto-update', {
                    enabled: !this.status.autoUpdateCheck
                }).then(function (d) {
                    self.status.autoUpdateCheck = !!d.enabled;
                    ELEMENT.Message.success(d.enabled ? '已开启自动检查更新' : '已关闭自动检查更新');
                }).catch(function (e) {
                    ELEMENT.Message.error(e.message);
                }).then(function () {
                    self.busy = '';
                });
            },
            checkUpdate: function () {
                var self = this;
                if (this.checking) {
                    return;
                }
                this.checking = true;
                this.updateError = '';
                this.download = { status: 'idle' };
                this.apiGet('/api/update/check').then(function (d) {
                    self.updateInfo = d || {};
                    if (d && d.message && !d.ok) {
                        self.updateError = d.message;
                    }
                }).catch(function (e) {
                    self.updateError = e.message || '检查更新失败';
                }).then(function () {
                    self.checking = false;
                });
            },
            startDownload: function () {
                var self = this;
                if (this.busy) {
                    return;
                }
                this.busy = 'download';
                this.updateError = '';
                this.apiPost('/api/update/download', {}).then(function (d) {
                    self.download = d || { status: 'downloading' };
                    self.startPoll();
                }).catch(function (e) {
                    self.updateError = e.message;
                }).then(function () {
                    self.busy = '';
                });
            },
            startPoll: function () {
                var self = this;
                this.stopPoll();
                this.pollTimer = setInterval(function () {
                    self.apiGet('/api/update/download/status').then(function (d) {
                        self.download = d || {};
                        if (d && (d.status === 'done' || d.status === 'failed')) {
                            self.stopPoll();
                        }
                    }).catch(function () {
                        self.stopPoll();
                    });
                }, 900);
            },
            stopPoll: function () {
                if (this.pollTimer) {
                    clearInterval(this.pollTimer);
                    this.pollTimer = null;
                }
            },
            install: function () {
                var self = this;
                ELEMENT.MessageBox.confirm(
                    'DeepShell 会退出，替换程序文件后自动重启；连接、密码、AI 配置和 data 目录都会保留。现在更新吗？',
                    '立即更新', { type: 'warning', confirmButtonText: '退出并更新', cancelButtonText: '取消' }
                ).then(function () {
                    self.busy = 'install';
                    return self.apiPost('/api/update/install', {});
                }).then(function (d) {
                    ELEMENT.Message.success((d && d.message) || '更新程序已启动，DeepShell 即将重启');
                }).catch(function (e) {
                    if (e && e !== 'cancel') {
                        ELEMENT.Message.error(e.message || String(e));
                    }
                }).then(function () {
                    self.busy = '';
                });
            },
            openManual: function () {
                var url = this.updateInfo && this.updateInfo.manualUrl;
                if (!url || !/^https:\/\//i.test(url)) {
                    ELEMENT.Message.warning('没有可打开的下载地址');
                    return;
                }
                window.open(url, '_blank', 'noopener');
            },
            finishOnboarding: function () {
                var self = this;
                this.apiPost('/api/app-integration/onboarding', {}).then(function () {
                    self.$emit('done');
                }).catch(function (e) {
                    ELEMENT.Message.error(e.message);
                });
            },
            fmtSize: function (bytes) {
                var n = Number(bytes || 0);
                if (n >= 1024 * 1024) {
                    return (n / 1024 / 1024).toFixed(1) + ' MB';
                }
                if (n >= 1024) {
                    return (n / 1024).toFixed(0) + ' KB';
                }
                return n + ' B';
            }
        },
        template: `
<div class="arp" :class="{ dark: dark }">
    <div v-if="loading" class="arp-msg">正在读取应用信息…</div>
    <div v-else-if="error" class="arp-error">{{ error }}</div>
    <template v-else-if="status">
        <p class="arp-lead" v-if="onboarding">
            绿色版不用安装，解压就能运行。建议把常用入口放好，下次更顺手：
        </p>

        <div class="arp-grid">
            <div class="arp-card">
                <b>桌面快捷方式</b>
                <span :class="shortcuts.desktopExists ? 'arp-ok' : ''">
                    {{ shortcuts.desktopExists ? '已创建：' + shortcuts.desktopPath : '还没有创建' }}
                </span>
                <button type="button" :disabled="!packaged || !!busy"
                        @click="createShortcut('desktop')">
                    {{ shortcuts.desktopExists ? '重新创建' : '创建到桌面' }}
                </button>
            </div>
            <div class="arp-card">
                <b>开始菜单快捷方式</b>
                <span :class="shortcuts.startMenuExists ? 'arp-ok' : ''">
                    {{ shortcuts.startMenuExists ? '已创建' : '还没有创建' }}
                </span>
                <button type="button" :disabled="!packaged || !!busy"
                        @click="createShortcut('startMenu')">
                    {{ shortcuts.startMenuExists ? '重新创建' : '添加到开始菜单' }}
                </button>
            </div>
        </div>
        <div class="arp-msg" v-if="!packaged">
            当前以 jar / 开发模式运行；用绿色版启动后才能创建桌面与开始菜单快捷方式。
        </div>

        <div class="arp-row">
            <div class="arp-row-info">
                <b>开机启动</b>
                <span>登录系统后在后台启动 DeepShell，不自动弹浏览器</span>
            </div>
            <button type="button" class="arp-toggle" :class="{ on: status.startupEnabled }"
                    :disabled="!status.startupSupported || !!busy" @click="setStartup"></button>
        </div>
        <div class="arp-row">
            <div class="arp-row-info">
                <b>托盘图标</b>
                <span>在系统托盘显示入口；关掉后只能通过浏览器访问</span>
            </div>
            <button type="button" class="arp-toggle" :class="{ on: status.trayEnabled }"
                    :disabled="!status.traySupported || !!busy" @click="setTray"></button>
        </div>
        <div class="arp-row">
            <div class="arp-row-info">
                <b>自动检查更新</b>
                <span>每天启动时检查一次 Gitee 发布页；只安装带 SHA256 校验的绿色版</span>
            </div>
            <button type="button" class="arp-toggle" :class="{ on: status.autoUpdateCheck }"
                    :disabled="!!busy" @click="setAutoUpdate"></button>
        </div>

        <div class="arp-update" v-if="!onboarding">
            <div class="arp-update-head">
                <b>版本更新</b>
                <span class="arp-msg" style="margin:0">当前 v{{ status.version }}</span>
                <span class="spacer"></span>
                <button type="button" :disabled="checking" @click="checkUpdate">
                    {{ checking ? '检查中…' : '检查更新' }}
                </button>
            </div>

            <div class="arp-msg" v-if="updateInfo && updateInfo.ok && !updateInfo.updateAvailable">
                {{ updateInfo.message || '当前已是最新版本' }}
            </div>
            <div class="arp-error" v-if="updateError">{{ updateError }}</div>

            <div class="arp-new" v-if="updateInfo && updateInfo.updateAvailable">
                <b>发现新版本 {{ updateInfo.latestVersion }}</b>
                <span class="arp-msg" v-if="updateInfo.releaseName"> · {{ updateInfo.releaseName }}</span>
                <pre class="arp-notes" v-if="updateInfo.notes">{{ updateInfo.notes }}</pre>
                <div class="arp-msg" v-if="updateInfo.asset">
                    安装包：{{ updateInfo.asset.name }}（{{ fmtSize(updateInfo.asset.size) }}）
                    <span v-if="!updateInfo.checksumAvailable"> · 发布方未提供 SHA256，自动安装已禁用</span>
                </div>
                <div class="arp-msg" v-if="updateInfo.updateAvailable && !updateInfo.autoInstallable">
                    这个发布包不是绿色版，不能自动替换。请打开下载页手动更新。
                </div>
                <div class="arp-actions">
                    <button type="button" class="primary" v-if="updateInfo.autoInstallable"
                            :disabled="!!busy" @click="startDownload">下载绿色版</button>
                    <button type="button" :class="{ primary: !updateInfo.autoInstallable }"
                            @click="openManual">打开下载页</button>
                    <span class="arp-msg" v-if="updateInfo.releasePage">
                        发布页：{{ updateInfo.releasePage }}
                    </span>
                </div>

                <div v-if="download && download.status !== 'idle'" style="margin-top:9px">
                    <div class="arp-msg">
                        {{ download.message || '' }}
                        <template v-if="download.status === 'downloading'">
                            · {{ fmtSize(download.downloaded) }}
                            <template v-if="download.total"> / {{ fmtSize(download.total) }}</template>
                        </template>
                    </div>
                    <div class="arp-progress" v-if="download.status === 'downloading'">
                        <i :style="{ width: downloadPercent + '%' }"></i>
                    </div>
                    <div class="arp-actions" v-if="download.status === 'done'">
                        <button type="button" class="primary" v-if="download.verified"
                                :disabled="!!busy" @click="install">立即重启并更新</button>
                        <button type="button" v-else @click="openManual">手动下载</button>
                        <span class="arp-msg" v-if="!download.verified" style="color:#b06a1d">
                            未通过校验，不会自动安装。
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <div class="arp-foot" v-if="onboarding">
            <button type="button" @click="finishOnboarding">以后再说</button>
            <button type="button" class="primary" @click="finishOnboarding">完成，开始使用</button>
        </div>
    </template>
</div>`
    });
})();
