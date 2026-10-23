/* 主机指纹“身份证”说明：工作台、连接向导、手机版共用同一份文案与样式。 */
(function () {
    if (!document.getElementById('host-key-details-style')) {
        var style = document.createElement('style');
        style.id = 'host-key-details-style';
        style.textContent = [
            '.hkd{line-height:1.75;font-size:13px;color:#303133}',
            '.hkd-idcard{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:10px;background:linear-gradient(135deg,#eef5ff,#f7fbff);border:1px solid #d7e6fb;margin-bottom:12px}',
            '.hkd-idcard.warn{background:linear-gradient(135deg,#fff3f1,#fff9f6);border-color:#f4cfc8}',
            '.hkd-idcard-icon{flex:0 0 38px;height:38px;border-radius:9px;background:#2f6fd6;color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;letter-spacing:.5px;box-shadow:0 3px 8px rgba(47,111,214,.25)}',
            '.hkd-idcard.warn .hkd-idcard-icon{background:#d9534f;box-shadow:0 3px 8px rgba(217,83,79,.25)}',
            '.hkd-idcard b{font-size:14px;color:#1f3d6b;display:block;margin-bottom:2px}',
            '.hkd-idcard.warn b{color:#8f2f2b}',
            '.hkd-idcard p{margin:0;color:#5b6b7f;font-size:12px}',
            '.hkd-idcard.warn p{color:#8a5a55}',
            '.hkd-card{border:1px solid #e4e8ef;border-radius:8px;background:#fafbfc;padding:8px 14px;margin-bottom:12px}',
            '.hkd-row{display:flex;gap:12px;padding:4px 0;font-size:12.5px}',
            '.hkd-row>span{flex:0 0 62px;color:#909399}',
            '.hkd-row>b{flex:1;font-weight:500;word-break:break-all;color:#303133}',
            '.hkd-fp{font-family:Consolas,"Courier New",monospace;font-size:12px}',
            '.hkd-fp.old{color:#d64545;text-decoration:line-through}',
            '.hkd-copy{margin-left:6px;border:1px solid #c9d5e5;background:#fff;color:#2f6fd6;border-radius:5px;font-size:11px;padding:1px 7px;cursor:pointer}',
            '.hkd-verify{border-top:1px dashed #e0e5ee;padding-top:10px}',
            '.hkd-title{font-weight:700;color:#303133;margin-bottom:4px;font-size:13px}',
            '.hkd-verify ol{margin:4px 0 0;padding-left:20px;color:#5b6472}',
            '.hkd-verify li{margin:6px 0}',
            '.hkd-cmd{display:flex;gap:6px;align-items:center;margin-top:5px;background:#0f1724;color:#d7e5ff;border-radius:6px;padding:6px 8px}',
            '.hkd-cmd code{flex:1;font-family:Consolas,"Courier New",monospace;font-size:11.5px;word-break:break-all;color:#d7e5ff}',
            '.hkd-cmd button{border:0;border-radius:4px;background:#2f6fd6;color:#fff;font-size:11px;padding:3px 8px;cursor:pointer;flex:0 0 auto}',
            '.hkd-warn{margin:10px 0 0;padding:8px 10px;border-radius:6px;background:#fff1ef;color:#a13d37;border:1px solid #f4cfc8;font-size:12px}',
            '.hkd-note{margin:10px 0 0;color:#8a6d4a;background:#fff8ec;border:1px solid #f0dfc2;border-radius:6px;padding:8px 10px;font-size:12px}',
            '.hkd.dark{color:#d7e2f1}',
            '.hkd.dark .hkd-idcard{background:#16202e;border-color:#2b3a4f}',
            '.hkd.dark .hkd-idcard b{color:#e7f0ff}',
            '.hkd.dark .hkd-idcard p{color:#aebdd2}',
            '.hkd.dark .hkd-idcard.warn{background:#2a1b1b;border-color:#553232}',
            '.hkd.dark .hkd-idcard.warn b{color:#ffb4ad}',
            '.hkd.dark .hkd-card{background:#111a26;border-color:#2a3749}',
            '.hkd.dark .hkd-row>b,.hkd.dark .hkd-title{color:#e4edf9}',
            '.hkd.dark .hkd-verify ol{color:#b5c3d6}',
            '.hkd.dark .hkd-verify{border-top-color:#2a3749}',
            '.hkd.dark .hkd-note{background:#1c2330;border-color:#394454;color:#cbb58f}',
            '.hkd.dark .hkd-warn{background:#2a1b1b;border-color:#553232;color:#ffb4ad}',
            '.hkd-compact{font-size:12px}',
            '.hkd-compact .hkd-idcard{padding:10px 12px}',
            '.hkd-compact .hkd-verify li{margin:4px 0}'
        ].join('\n');
        document.head.appendChild(style);
    }

    Vue.component('host-key-details', {
        props: {
            info: { type: Object, required: true },
            dark: { type: Boolean, default: false },
            compact: { type: Boolean, default: false }
        },
        data: function () {
            return { copied: '' };
        },
        computed: {
            changed: function () {
                return !!(this.info && this.info.changed);
            },
            roleLabel: function () {
                if (!this.info) {
                    return '服务器';
                }
                return this.info.roleLabel || (this.info.role === 'jump' ? '跳板机' : '目标主机');
            },
            verifyCommand: function () {
                if (this.info && this.info.verifyCommand) {
                    return this.info.verifyCommand;
                }
                var type = String(this.info && this.info.keyType || '').toLowerCase();
                var file = '/etc/ssh/ssh_host_*_key.pub';
                if (type.indexOf('ed25519') >= 0) {
                    file = '/etc/ssh/ssh_host_ed25519_key.pub';
                } else if (type.indexOf('ecdsa') >= 0) {
                    file = '/etc/ssh/ssh_host_ecdsa_key.pub';
                } else if (type.indexOf('rsa') >= 0) {
                    file = '/etc/ssh/ssh_host_rsa_key.pub';
                }
                return 'sudo ssh-keygen -lf ' + file;
            }
        },
        methods: {
            copy: function (text, key) {
                var self = this;
                copyText(text, function () {
                    self.copied = key;
                    setTimeout(function () {
                        if (self.copied === key) {
                            self.copied = '';
                        }
                    }, 1600);
                });
            }
        },
        template: `
<div class="hkd" :class="{ dark: dark, 'hkd-compact': compact }">
    <div class="hkd-idcard" :class="{ warn: changed }">
        <div class="hkd-idcard-icon">ID</div>
        <div>
            <b>{{ changed ? '这次的“身份证”和上次不一样' : '这是服务器的“身份证”' }}</b>
            <p v-if="!changed">SSH 主机指纹就像服务器的身份证号。第一次连接先核对，确认是你买的那台机器；记住后，以后每次连接都会自动检查它有没有变。</p>
            <p v-else>如果这是你刚重装系统、重置实例或更换了 SSH 密钥，可以更新。若不是你做的，先别连：可能有人在中间冒充这台服务器。</p>
        </div>
    </div>

    <div class="hkd-card">
        <div class="hkd-row"><span>服务器</span><b>{{ roleLabel }} · {{ info.host }}:{{ info.port }}</b></div>
        <div class="hkd-row"><span>密钥类型</span><b>{{ info.keyType || '未知' }}</b></div>
        <div class="hkd-row">
            <span>本次指纹</span>
            <b class="hkd-fp">{{ info.fingerprint }}
                <button type="button" class="hkd-copy" @click="copy(info.fingerprint, 'fp')">
                    {{ copied === 'fp' ? '已复制' : '复制' }}
                </button>
            </b>
        </div>
        <div class="hkd-row" v-if="info.knownFingerprint">
            <span>上次指纹</span><b class="hkd-fp old">{{ info.knownFingerprint }}</b>
        </div>
    </div>

    <div class="hkd-verify">
        <div class="hkd-title">怎么核对（有服务器权限时，大约 30 秒）</div>
        <ol>
            <li>用云控制台的「远程连接 / VNC」登录服务器，或者用另一台已经能登录的电脑。</li>
            <li>执行下面的命令：
                <div class="hkd-cmd">
                    <code>{{ verifyCommand }}</code>
                    <button type="button" @click="copy(verifyCommand, 'cmd')">
                        {{ copied === 'cmd' ? '已复制' : '复制' }}
                    </button>
                </div>
            </li>
            <li>输出中会有 <code>SHA256:...</code>。把它和上面的「本次指纹」逐字对比，密钥类型也要一致（本次是 {{ info.keyType || '未知' }}）。</li>
        </ol>
        <p v-if="changed" class="hkd-warn">
            先别点信任：断开连接，改用云控制台 VNC 登录核对。只有确认是重装 / 换密钥导致的，才更新指纹；否则可能是有人冒充服务器。
        </p>
        <p v-else class="hkd-note">
            以后连接时如果提示“指纹变了”，不要直接信任。先确认是不是重装系统或换了密钥；不是的话，立即停止并检查服务器和网络。
        </p>
    </div>
</div>`
    });

    function copyText(text, done) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
                return;
            }
        } catch (e) { /* 继续回退 */ }
        fallback(text, done);
    }

    function fallback(text, done) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            if (done) {
                done();
            }
        } catch (e) {
            if (window.ELEMENT && ELEMENT.Message) {
                ELEMENT.Message.info(text);
            }
        }
    }
})();
