(function () {
    'use strict';

    var AUDIO_EXTS = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'];
    var RISKY_EXTS = ['wma'];
    var RATES = [1, 1.25, 1.5, 2];
    var VOLUME_KEY = 'deepshell.audio.volume';

    function extOf(name) {
        var s = String(name || '');
        var i = s.lastIndexOf('.');
        if (i <= 0 || i === s.length - 1) {
            return '';
        }
        return s.substring(i + 1).toLowerCase();
    }

    function isAudioName(name) {
        return AUDIO_EXTS.indexOf(extOf(name)) >= 0;
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

    function splitTrackName(name) {
        var base = String(name || '').replace(/\.[^.]+$/, '');
        var parts = base.split(/\s+[-–—]\s+/);
        if (parts.length > 1) {
            var artist = parts.shift().trim();
            return { artist: artist, title: parts.join(' - ').trim() || base };
        }
        return { artist: '', title: base };
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

    function fmtSize(n) {
        if (n == null || !isFinite(n)) {
            return '';
        }
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var value = Number(n);
        var i = 0;
        while (value >= 1024 && i < units.length - 1) {
            value /= 1024;
            i++;
        }
        return (i === 0 ? String(value) : value.toFixed(value >= 100 ? 0 : 1)) + ' ' + units[i];
    }

    function savedVolume() {
        try {
            var raw = localStorage.getItem(VOLUME_KEY);
            var v = raw == null ? 80 : Number(raw);
            return isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 80;
        } catch (e) {
            return 80;
        }
    }

    var params = new URLSearchParams(window.location.search || '');
    var sessionId = params.get('sessionId') || '';
    var sortBy = params.get('sortBy') || 'name';
    var sortDir = params.get('sortDir') === 'desc' ? 'desc' : 'asc';
    var showHidden = params.get('hidden') !== '0';
    var initialPath = params.get('path') || '';

    new Vue({
        el: '#audioViewer',
        data: {
            path: initialPath,
            name: baseName(initialPath),
            tracks: [],
            index: -1,
            loading: true,
            error: '',
            notice: '',
            duration: 0,
            currentTime: 0,
            progress: 0,
            paused: true,
            muted: false,
            volume: savedVolume(),
            rate: 1,
            loop: false,
            stamp: Date.now(),
            autoPlayPending: true,
            closeHint: '',
            noticeTimer: null
        },
        computed: {
            ext: function () {
                return extOf(this.name);
            },
            audioUrl: function () {
                if (!sessionId || !this.path) {
                    return '';
                }
                return '/api/sftp/audio?sessionId=' + encodeURIComponent(sessionId)
                    + '&path=' + encodeURIComponent(this.path)
                    + '&v=' + this.stamp;
            },
            displayTitle: function () {
                return splitTrackName(this.name).title;
            },
            displayArtist: function () {
                return splitTrackName(this.name).artist;
            },
            currentTrack: function () {
                for (var i = 0; i < this.tracks.length; i++) {
                    if (this.tracks[i].name === this.name) {
                        return this.tracks[i];
                    }
                }
                return null;
            },
            sizeText: function () {
                return this.currentTrack ? fmtSize(this.currentTrack.size) : '';
            },
            durationText: function () {
                return fmtDuration(this.duration);
            },
            currentText: function () {
                return fmtDuration(this.currentTime);
            },
            formatHint: function () {
                if (RISKY_EXTS.indexOf(this.ext) < 0) {
                    return '';
                }
                return this.ext.toUpperCase()
                    + ' 通常无法被浏览器直接播放，可下载后用本地播放器试听';
            }
        },
        mounted: function () {
            document.title = (this.name || '音频播放') + ' · DeepShell';
            window.addEventListener('keydown', this.onKeydown);
            this.applyVolume();
            this.updateMediaSession();
            if (!sessionId || !this.path) {
                this.loading = false;
                this.error = '缺少会话或文件参数，请从 AI 可视化桌面重新打开音频';
                return;
            }
            this.loadSiblings();
        },
        beforeDestroy: function () {
            window.removeEventListener('keydown', this.onKeydown);
            if (this.noticeTimer) {
                clearTimeout(this.noticeTimer);
            }
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
                        // 目录列表只影响播放列表与上一首 / 下一首，单个音频仍然可以播放
                        self.tracks = [];
                        self.index = -1;
                    });
            },
            applySiblings: function (rows) {
                var dirSign = sortDir === 'desc' ? -1 : 1;
                var list = rows.filter(function (row) {
                    return row && !row.dir
                        && (showHidden || String(row.name).charAt(0) !== '.')
                        && isAudioName(row.name);
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
                this.tracks = list;
                this.syncIndex();
            },
            syncIndex: function () {
                this.index = -1;
                for (var i = 0; i < this.tracks.length; i++) {
                    if (this.tracks[i].name === this.name) {
                        this.index = i;
                        break;
                    }
                }
            },
            trackTitle: function (name) {
                return splitTrackName(name).title;
            },
            trackArtist: function (name) {
                return splitTrackName(name).artist;
            },
            fmtSize: fmtSize,
            step: function (delta) {
                if (this.tracks.length < 2) {
                    return;
                }
                var idx = this.index < 0 ? 0 : this.index;
                var next = (idx + delta + this.tracks.length) % this.tracks.length;
                this.openPath(joinPath(parentPath(this.path), this.tracks[next].name), true);
            },
            openTrack: function (i) {
                if (i < 0 || i >= this.tracks.length) {
                    return;
                }
                var path = joinPath(parentPath(this.path), this.tracks[i].name);
                if (path === this.path) {
                    this.togglePlay();
                    return;
                }
                this.openPath(path, true);
            },
            openPath: function (path, autoplay) {
                this.path = path;
                this.name = baseName(path);
                this.syncIndex();
                this.stamp = Date.now();
                this.loading = true;
                this.error = '';
                this.notice = '';
                this.duration = 0;
                this.currentTime = 0;
                this.progress = 0;
                this.paused = true;
                this.autoPlayPending = autoplay !== false;
                this.closeHint = '';
                document.title = (this.name || '音频播放') + ' · DeepShell';
                this.updateMediaSession();
                this.updateUrl();
                var self = this;
                this.$nextTick(function () {
                    var a = self.$refs.audio;
                    if (a) {
                        try {
                            a.load();
                        } catch (e) { /* 由 error 事件兜底 */ }
                    }
                });
            },
            updateUrl: function () {
                try {
                    var query = '?sessionId=' + encodeURIComponent(sessionId)
                        + '&path=' + encodeURIComponent(this.path)
                        + '&sortBy=' + encodeURIComponent(sortBy)
                        + '&sortDir=' + sortDir
                        + '&hidden=' + (showHidden ? '1' : '0');
                    window.history.replaceState(null, '', window.location.pathname + query);
                } catch (e) { /* 部分浏览器禁止改写地址栏时忽略 */ }
            },
            applyVolume: function () {
                var a = this.$refs.audio;
                if (a) {
                    a.volume = this.volume / 100;
                    a.muted = false;
                }
            },
            tryAutoplay: function () {
                if (!this.autoPlayPending) {
                    return;
                }
                var a = this.$refs.audio;
                if (!a) {
                    return;
                }
                this.autoPlayPending = false;
                var self = this;
                var p = a.play();
                if (p && typeof p.catch === 'function') {
                    p.catch(function () {
                        self.paused = true;
                        self.showNotice('浏览器拦截了自动播放，点击播放按钮或按空格开始');
                    });
                }
            },
            showNotice: function (text) {
                var self = this;
                this.notice = text;
                if (this.noticeTimer) {
                    clearTimeout(this.noticeTimer);
                }
                this.noticeTimer = setTimeout(function () {
                    self.notice = '';
                    self.noticeTimer = null;
                }, 6000);
            },
            onLoadedMetadata: function (ev) {
                var a = ev && ev.target;
                this.loading = false;
                this.error = '';
                if (a) {
                    this.duration = isFinite(a.duration) ? a.duration : 0;
                    this.paused = !!a.paused;
                    this.muted = !!a.muted;
                    if (a.volume != null && !a.muted) {
                        this.volume = Math.round(a.volume * 100);
                    }
                    a.playbackRate = this.rate;
                    a.loop = this.loop;
                }
                this.tryAutoplay();
            },
            onCanPlay: function () {
                this.loading = false;
                this.tryAutoplay();
            },
            onTimeUpdate: function (ev) {
                var a = ev && ev.target;
                if (!a) {
                    return;
                }
                this.currentTime = a.currentTime || 0;
                if (isFinite(a.duration) && a.duration > 0) {
                    this.duration = a.duration;
                }
                this.progress = this.duration
                    ? Math.max(0, Math.min(1000, Math.round(this.currentTime / this.duration * 1000)))
                    : 0;
            },
            onSeekInput: function (ev) {
                var a = this.$refs.audio;
                var value = Number(ev && ev.target && ev.target.value) || 0;
                this.progress = Math.max(0, Math.min(1000, value));
                if (a && this.duration > 0) {
                    a.currentTime = this.progress / 1000 * this.duration;
                    this.currentTime = a.currentTime;
                }
            },
            onVolumeInput: function (ev) {
                var a = this.$refs.audio;
                this.volume = Math.max(0, Math.min(100, Number(ev && ev.target && ev.target.value) || 0));
                if (a) {
                    a.volume = this.volume / 100;
                    if (this.volume > 0 && a.muted) {
                        a.muted = false;
                    }
                }
                try {
                    localStorage.setItem(VOLUME_KEY, String(this.volume));
                } catch (e) { /* 隐私模式下忽略 */ }
            },
            onPlay: function () {
                this.paused = false;
                this.loading = false;
                this.notice = '';
                this.setPlaybackState('playing');
            },
            onPause: function () {
                this.paused = true;
                this.setPlaybackState('paused');
            },
            onEnded: function () {
                this.paused = true;
                this.progress = 1000;
                if (this.loop) {
                    return;
                }
                if (this.tracks.length > 1) {
                    this.step(1);
                }
            },
            onVolumeChange: function (ev) {
                var a = ev && ev.target;
                if (!a) {
                    return;
                }
                this.muted = !!a.muted;
                if (!a.muted && a.volume != null) {
                    this.volume = Math.round(a.volume * 100);
                }
            },
            onError: function () {
                this.loading = false;
                this.autoPlayPending = false;
                this.paused = true;
                this.error = '音频加载失败：浏览器可能不支持该音频的编码 / 容器格式，'
                    + '或文件没有读取权限。可下载后用本地播放器试听。';
            },
            togglePlay: function () {
                var a = this.$refs.audio;
                if (!a) {
                    return;
                }
                var self = this;
                if (a.paused) {
                    var p = a.play();
                    if (p && typeof p.catch === 'function') {
                        p.catch(function () {
                            self.paused = true;
                        });
                    }
                } else {
                    a.pause();
                }
            },
            toggleMute: function () {
                var a = this.$refs.audio;
                if (!a) {
                    return;
                }
                a.muted = !a.muted;
            },
            toggleLoop: function () {
                this.loop = !this.loop;
                var a = this.$refs.audio;
                if (a) {
                    a.loop = this.loop;
                }
            },
            cycleRate: function () {
                var i = RATES.indexOf(this.rate);
                this.rate = RATES[(i + 1) % RATES.length];
                var a = this.$refs.audio;
                if (a) {
                    a.playbackRate = this.rate;
                }
            },
            seekBy: function (delta) {
                var a = this.$refs.audio;
                if (!a || !this.duration) {
                    return;
                }
                a.currentTime = Math.max(0, Math.min(this.duration, (a.currentTime || 0) + delta));
            },
            setPlaybackState: function (state) {
                if (!('mediaSession' in navigator)) {
                    return;
                }
                try {
                    navigator.mediaSession.playbackState = state;
                } catch (e) { /* 忽略 */ }
            },
            updateMediaSession: function () {
                if (!('mediaSession' in navigator)) {
                    return;
                }
                var self = this;
                try {
                    if (typeof window.MediaMetadata === 'function') {
                        navigator.mediaSession.metadata = new window.MediaMetadata({
                            title: this.displayTitle || this.name,
                            artist: this.displayArtist || 'DeepShell 远程音频',
                            album: parentPath(this.path)
                        });
                    }
                } catch (e) { /* 元数据不是必需 */ }
                try {
                    navigator.mediaSession.setActionHandler('play', function () {
                        if (self.paused) {
                            self.togglePlay();
                        }
                    });
                    navigator.mediaSession.setActionHandler('pause', function () {
                        if (!self.paused) {
                            self.togglePlay();
                        }
                    });
                    navigator.mediaSession.setActionHandler('previoustrack', function () { self.step(-1); });
                    navigator.mediaSession.setActionHandler('nexttrack', function () { self.step(1); });
                    navigator.mediaSession.setActionHandler('seekbackward', function (d) {
                        self.seekBy(-((d && d.seekOffset) || 5));
                    });
                    navigator.mediaSession.setActionHandler('seekforward', function (d) {
                        self.seekBy((d && d.seekOffset) || 5);
                    });
                } catch (e) { /* 部分浏览器不支持全部动作 */ }
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
                if (ev.ctrlKey || ev.metaKey || ev.altKey) {
                    return;
                }
                var tag = ev.target && ev.target.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
                        || tag === 'BUTTON' || tag === 'A') {
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
                } else if (ev.key === 'ArrowUp') {
                    this.adjustVolume(5);
                    ev.preventDefault();
                } else if (ev.key === 'ArrowDown') {
                    this.adjustVolume(-5);
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
                } else if (ev.key === 'l' || ev.key === 'L') {
                    this.toggleLoop();
                    ev.preventDefault();
                }
            },
            adjustVolume: function (delta) {
                var a = this.$refs.audio;
                this.volume = Math.max(0, Math.min(100, this.volume + delta));
                if (a) {
                    a.volume = this.volume / 100;
                    a.muted = false;
                }
                try {
                    localStorage.setItem(VOLUME_KEY, String(this.volume));
                } catch (e) { /* 隐私模式下忽略 */ }
            }
        }
    });
})();
