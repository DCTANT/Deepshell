(function () {
    'use strict';

    var VIDEO_EXTS = ['mp4', 'm4v', 'f4v', 'webm', 'ogv', 'mov', 'mkv', 'avi',
        'wmv', 'asf', 'flv', 'ts', 'm2ts', 'mts', 'mpg', 'mpeg', '3gp', 'rm', 'rmvb'];
    var RISKY_EXTS = ['mkv', 'avi', 'wmv', 'asf', 'flv', 'rm', 'rmvb',
        'ts', 'm2ts', 'mts', 'mpg', 'mpeg', '3gp'];

    function extOf(name) {
        var s = String(name || '');
        var i = s.lastIndexOf('.');
        if (i <= 0 || i === s.length - 1) {
            return '';
        }
        return s.substring(i + 1).toLowerCase();
    }

    function isVideoName(name) {
        return VIDEO_EXTS.indexOf(extOf(name)) >= 0;
    }

    function baseName(path) {
        var s = String(path || '');
        var i = s.lastIndexOf('/');
        return i >= 0 ? s.substring(i + 1) : s;
    }

    function parentPath(path) {
        var s = String(path || '');
        var i = s.lastIndexOf('/');
        return i <= 0 ? '/' : s.substring(0, i);
    }

    function joinPath(dir, name) {
        return (!dir || dir === '/' ? '' : dir.replace(/\/+$/, '')) + '/' + name;
    }

    function fmtDuration(sec) {
        if (!isFinite(sec) || sec <= 0) {
            return '';
        }
        var total = Math.round(sec);
        var h = Math.floor(total / 3600);
        var m = Math.floor(total / 60) % 60;
        var s = total % 60;
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
    }

    var params = new URLSearchParams(window.location.search || '');
    var sessionId = params.get('sessionId') || '';
    var sortBy = params.get('sortBy') || 'name';
    var sortDir = params.get('sortDir') === 'desc' ? 'desc' : 'asc';
    var showHidden = params.get('hidden') !== '0';
    var initialPath = params.get('path') || '';

    new Vue({
        el: '#videoViewer',
        data: {
            path: initialPath,
            name: baseName(initialPath),
            videos: [],
            index: -1,
            loading: true,
            error: '',
            duration: 0,
            naturalW: 0,
            naturalH: 0,
            stamp: Date.now(),
            paused: true,
            muted: false,
            closeHint: ''
        },
        computed: {
            ext: function () {
                return extOf(this.name);
            },
            videoKey: function () {
                return this.path + ':' + this.stamp;
            },
            videoUrl: function () {
                if (!sessionId || !this.path) {
                    return '';
                }
                return '/api/sftp/video?sessionId=' + encodeURIComponent(sessionId)
                    + '&path=' + encodeURIComponent(this.path)
                    + '&v=' + this.stamp;
            },
            durationText: function () {
                return fmtDuration(this.duration);
            },
            resolution: function () {
                return this.naturalW && this.naturalH
                    ? this.naturalW + ' × ' + this.naturalH
                    : '';
            },
            formatHint: function () {
                if (RISKY_EXTS.indexOf(this.ext) < 0) {
                    return '';
                }
                return this.ext.toUpperCase()
                    + ' 容器通常无法被浏览器直接播放，可下载后用本地播放器观看';
            }
        },
        mounted: function () {
            document.title = (this.name || '视频预览') + ' · DeepShell';
            window.addEventListener('keydown', this.onKeydown);
            if (!sessionId || !this.path) {
                this.loading = false;
                this.error = '缺少会话或文件参数，请从 AI 可视化桌面重新打开视频';
                return;
            }
            this.loadSiblings();
        },
        beforeDestroy: function () {
            window.removeEventListener('keydown', this.onKeydown);
        },
        methods: {
            loadSiblings: function () {
                var self = this;
                fetch('/api/sftp/list?sessionId=' + encodeURIComponent(sessionId)
                        + '&path=' + encodeURIComponent(parentPath(this.path)),
                    { credentials: 'same-origin' })
                    .then(function (resp) {
                        if (!resp.ok) {
                            throw new Error('HTTP ' + resp.status);
                        }
                        return resp.json();
                    })
                    .then(function (body) {
                        if (!body || body.code !== 0) {
                            throw new Error((body && body.msg) || '目录读取失败');
                        }
                        self.applySiblings(body.data || []);
                    })
                    .catch(function () {
                        // 目录列表只影响上一个 / 下一个，单个视频仍然可以预览
                        self.videos = [];
                        self.index = -1;
                    });
            },
            applySiblings: function (rows) {
                var dirSign = sortDir === 'desc' ? -1 : 1;
                var list = rows.filter(function (row) {
                    return row && !row.dir
                        && (showHidden || String(row.name).charAt(0) !== '.')
                        && isVideoName(row.name);
                });
                list.sort(function (a, b) {
                    var v;
                    if (sortBy === 'size') {
                        v = (a.size || 0) - (b.size || 0);
                    } else if (sortBy === 'mtime') {
                        v = (a.mtime || 0) - (b.mtime || 0);
                    } else {
                        v = String(a.name).localeCompare(String(b.name), 'zh-CN', {
                            numeric: true,
                            sensitivity: 'base'
                        });
                    }
                    return v * dirSign;
                });
                this.videos = list;
                this.syncIndex();
            },
            syncIndex: function () {
                this.index = -1;
                for (var i = 0; i < this.videos.length; i++) {
                    if (this.videos[i].name === this.name) {
                        this.index = i;
                        break;
                    }
                }
            },
            step: function (delta) {
                if (this.videos.length < 2) {
                    return;
                }
                var idx = this.index < 0 ? 0 : this.index;
                var next = (idx + delta + this.videos.length) % this.videos.length;
                this.openPath(joinPath(parentPath(this.path), this.videos[next].name));
            },
            openPath: function (path) {
                this.path = path;
                this.name = baseName(path);
                this.syncIndex();
                this.stamp = Date.now();
                this.loading = true;
                this.error = '';
                this.duration = 0;
                this.naturalW = 0;
                this.naturalH = 0;
                this.paused = true;
                this.muted = false;
                this.closeHint = '';
                document.title = (this.name || '视频预览') + ' · DeepShell';
                try {
                    var query = '?sessionId=' + encodeURIComponent(sessionId)
                        + '&path=' + encodeURIComponent(path)
                        + '&sortBy=' + encodeURIComponent(sortBy)
                        + '&sortDir=' + sortDir
                        + '&hidden=' + (showHidden ? '1' : '0');
                    window.history.replaceState(null, '', window.location.pathname + query);
                } catch (e) { /* 部分浏览器禁止改写地址栏时忽略 */ }
            },
            onLoadedMetadata: function (ev) {
                var v = ev && ev.target;
                this.loading = false;
                this.error = '';
                if (v) {
                    this.duration = v.duration || 0;
                    this.naturalW = v.videoWidth || 0;
                    this.naturalH = v.videoHeight || 0;
                    this.paused = !!v.paused;
                    this.muted = !!v.muted;
                }
            },
            onCanPlay: function () {
                this.loading = false;
            },
            onError: function () {
                this.loading = false;
                this.paused = true;
                this.error = '视频加载失败：浏览器可能不支持该视频的编码 / 容器格式，'
                    + '或文件没有读取权限。可下载后用本地播放器观看。';
            },
            onPlay: function () {
                this.paused = false;
            },
            onPause: function () {
                this.paused = true;
            },
            onVolumeChange: function (ev) {
                this.muted = !!(ev && ev.target && ev.target.muted);
            },
            togglePlay: function () {
                var v = this.$refs.video;
                if (!v) {
                    return;
                }
                if (v.paused) {
                    var p = v.play();
                    if (p && typeof p.catch === 'function') {
                        p.catch(function () { /* 浏览器可能要求用户先与页面交互 */ });
                    }
                } else {
                    v.pause();
                }
            },
            toggleMute: function () {
                var v = this.$refs.video;
                if (!v) {
                    return;
                }
                v.muted = !v.muted;
            },
            seekBy: function (delta) {
                var v = this.$refs.video;
                if (!v) {
                    return;
                }
                var max = isFinite(v.duration) && v.duration > 0 ? v.duration : Infinity;
                v.currentTime = Math.max(0, Math.min(max, (v.currentTime || 0) + delta));
            },
            download: function () {
                if (!sessionId || !this.path) {
                    return;
                }
                var url = '/api/sftp/download?sessionId=' + encodeURIComponent(sessionId)
                    + '&path=' + encodeURIComponent(this.path);
                var a = document.createElement('a');
                a.href = url;
                document.body.appendChild(a);
                a.click();
                a.remove();
            },
            closeTab: function () {
                window.close();
                var self = this;
                setTimeout(function () {
                    if (!window.closed) {
                        self.closeHint = '浏览器阻止了自动关闭，请直接关闭当前标签页';
                    }
                }, 300);
            },
            onKeydown: function (ev) {
                if (ev.key === 'Escape') {
                    this.closeTab();
                    ev.preventDefault();
                    return;
                }
                var tag = ev.target && ev.target.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
                        || tag === 'BUTTON' || tag === 'A') {
                    return;
                }
                // 视频获得焦点时交给浏览器原生控件处理空格与方向键
                if (tag === 'VIDEO' && (ev.code === 'Space' || ev.key.indexOf('Arrow') === 0)) {
                    return;
                }
                if (ev.code === 'Space' || ev.key === ' ') {
                    this.togglePlay();
                    ev.preventDefault();
                } else if (ev.key === 'ArrowLeft') {
                    this.seekBy(-5);
                    ev.preventDefault();
                } else if (ev.key === 'ArrowRight') {
                    this.seekBy(5);
                    ev.preventDefault();
                } else if (ev.key === '[') {
                    this.step(-1);
                    ev.preventDefault();
                } else if (ev.key === ']') {
                    this.step(1);
                    ev.preventDefault();
                } else if (ev.key === 'm' || ev.key === 'M') {
                    this.toggleMute();
                    ev.preventDefault();
                }
            }
        }
    });
})();
