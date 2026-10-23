/* 通用排错卡片：SSH 连接失败、AI 测试失败共用。纯 HTML + 独立样式，工作台与手机版都能用。 */
(function () {
    if (!document.getElementById('issue-help-style')) {
        var style = document.createElement('style');
        style.id = 'issue-help-style';
        style.textContent = [
            '.issue-help{border:1px solid #f3d7b2;border-radius:10px;background:#fffaf2;padding:14px 16px;line-height:1.7;color:#4b3a24}',
            '.issue-help-head{display:flex;gap:10px;align-items:flex-start}',
            '.issue-help-badge{flex:0 0 26px;height:26px;border-radius:50%;background:#e8a33d;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:15px}',
            '.issue-help-title{font-size:14px;font-weight:700;color:#6b4310;margin:0 0 2px}',
            '.issue-help-summary{margin:0;color:#7a6448;font-size:13px}',
            '.issue-help-steps{margin:10px 0 0 0;padding-left:20px;font-size:13px}',
            '.issue-help-steps li{margin:5px 0}',
            '.issue-help-code{display:inline-block;margin-top:8px;font-size:12px;color:#8a6d4a}',
            '.issue-help details{margin-top:10px;font-size:12px;color:#8a6d4a}',
            '.issue-help pre{margin:6px 0 0;padding:8px 10px;background:#fff;border:1px solid #eedcc6;border-radius:6px;white-space:pre-wrap;word-break:break-all;max-height:150px;overflow:auto}',
            '.issue-help.dark{background:#151d2a;border-color:#3a2f22;color:#d8c9b4}',
            '.issue-help.dark .issue-help-title{color:#ffd28a}',
            '.issue-help.dark .issue-help-summary,.issue-help.dark .issue-help-steps{color:#c9b9a3}',
            '.issue-help.dark pre{background:#0d141e;border-color:#2c3545;color:#c9d6e6}'
        ].join('\n');
        document.head.appendChild(style);
    }

    Vue.component('issue-help', {
        props: {
            error: { type: Object, default: null },
            dark: { type: Boolean, default: false }
        },
        template: `
<div class="issue-help" :class="{ dark: dark }" v-if="error">
    <div class="issue-help-head">
        <div class="issue-help-badge">!</div>
        <div>
            <div class="issue-help-title">{{ error.title || '连接失败' }}</div>
            <p class="issue-help-summary">{{ error.summary || '' }}</p>
        </div>
    </div>
    <ol class="issue-help-steps" v-if="steps.length">
        <li v-for="(s, i) in steps" :key="i">{{ s }}</li>
    </ol>
    <div class="issue-help-code" v-if="error.code">错误类型：{{ error.code }}</div>
    <details v-if="error.detail">
        <summary>技术详情（复制给管理员时使用）</summary>
        <pre>{{ error.detail }}</pre>
    </details>
</div>`,
        computed: {
            steps: function () {
                return this.error && this.error.steps ? this.error.steps : [];
            }
        }
    });
})();
