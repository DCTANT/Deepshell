(function () {
    'use strict';

    var IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'jpe', 'jfif', 'gif', 'bmp', 'webp', 'svg', 'ico',
        'tif', 'tiff', 'avif', 'heic', 'heif'];

    function extOf(name) {
        var s = String(name || '');
        var i = s.lastIndexOf('.');
        if (i <= 0 || i === s.length - 1) {
            return '';
        }
        return s.substring(i + 1).toLowerCase();
    }

    function isImageName(name) {
        return IMAGE_EXTS.indexOf(extOf(name)) >= 0;
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

    var params = new URLSearchParams(window.location.search || '');
    var sessionId = params.get('sessionId') || '';
    var localMode = params.get('local') === '1';
    var apiBase = localMode ? '/api/local/fs' : '/api/sftp';
    var sortBy = params.get('sortBy') || 'name';
    var sortDir = params.get('sortDir') === 'desc' ? 'desc' : 'asc';
    var showHidden = params.get('hidden') !== '0';
    var initialPath = params.get('path') || '';

    new Vue({
        el: '#imageViewer',
        data: {
            path: initialPath,
            name: baseName(initialPath),
            images: [],
            index: -1,
            loading: true,
            error: '',
            zoom: 1,
            rotate: 0,
            panX: 0,
            panY: 0,
            naturalW: 0,
            naturalH: 0,
            stamp: Date.now(),
            closeHint: ''
        },
        computed: {
            imageUrl: function () {
                if ((!localMode && !sessionId) || !this.path) {
                    return '';
                }
                return apiBase + '/preview?path=' + encodeURIComponent(this.path)
                    + (localMode ? '' : '&sessionId=' + encodeURIComponent(sessionId))
                    + '&v=' + this.stamp;
            }
        },
        mounted: function () {
            document.title = (this.name || '图片预览') + ' · DeepShell';
            window.addEventListener('keydown', this.onKeydown);
            if ((!localMode && !sessionId) || !this.path) {
                this.loading = false;
                this.error = '缺少会话或文件参数，请从可视化桌面重新打开图片';
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
                fetch(apiBase + '/list?path=' + encodeURIComponent(parentPath(this.path))
                        + (localMode ? '' : '&sessionId=' + encodeURIComponent(sessionId)),
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
                        // 目录列表只影响上一张 / 下一张，单张图片仍然可以预览
                        self.images = [];
                        self.index = -1;
                    });
            },
            applySiblings: function (rows) {
                var dirSign = sortDir === 'desc' ? -1 : 1;
                var list = rows.filter(function (row) {
                    return row && !row.dir
                        && (showHidden || String(row.name).charAt(0) !== '.')
                        && isImageName(row.name);
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
                this.images = list;
                this.syncIndex();
            },
            syncIndex: function () {
                this.index = -1;
                for (var i = 0; i < this.images.length; i++) {
                    if (this.images[i].name === this.name) {
                        this.index = i;
                        break;
                    }
                }
            },
            step: function (delta) {
                if (this.images.length < 2) {
                    return;
                }
                var idx = this.index < 0 ? 0 : this.index;
                var next = (idx + delta + this.images.length) % this.images.length;
                this.openPath(joinPath(parentPath(this.path), this.images[next].name));
            },
            openPath: function (path) {
                this.path = path;
                this.name = baseName(path);
                this.syncIndex();
                this.stamp = Date.now();
                this.loading = true;
                this.error = '';
                this.naturalW = 0;
                this.naturalH = 0;
                this.closeHint = '';
                this.resetView();
                document.title = (this.name || '图片预览') + ' · DeepShell';
                try {
                    var query = '?sessionId=' + encodeURIComponent(sessionId)
                        + '&path=' + encodeURIComponent(path)
                        + '&sortBy=' + encodeURIComponent(sortBy)
                        + '&sortDir=' + sortDir
                        + '&hidden=' + (showHidden ? '1' : '0');
                    window.history.replaceState(null, '', window.location.pathname + query);
                } catch (e) { /* 部分浏览器禁止改写地址栏时忽略 */ }
            },
            resetView: function () {
                this.zoom = 1;
                this.rotate = 0;
                this.panX = 0;
                this.panY = 0;
            },
            onLoad: function (ev) {
                this.loading = false;
                this.error = '';
                if (ev && ev.target) {
                    this.naturalW = ev.target.naturalWidth || 0;
                    this.naturalH = ev.target.naturalHeight || 0;
                }
            },
            onError: function () {
                this.loading = false;
                this.error = '图片加载失败：格式可能不受浏览器支持，或文件无读取权限';
            },
            zoomBy: function (factor) {
                var z = Math.max(0.2, Math.min(8, this.zoom * factor));
                this.zoom = Math.round(z * 100) / 100;
                if (this.zoom <= 1) {
                    this.panX = 0;
                    this.panY = 0;
                }
            },
            fit: function () {
                this.resetView();
            },
            rotate90: function () {
                this.rotate = (this.rotate + 90) % 360;
                this.panX = 0;
                this.panY = 0;
            },
            onWheel: function (ev) {
                this.zoomBy(ev.deltaY < 0 ? 1.15 : 1 / 1.15);
            },
            startDrag: function (ev) {
                if (this.zoom <= 1) {
                    return;
                }
                ev.preventDefault();
                var self = this;
                var startX = ev.clientX;
                var startY = ev.clientY;
                var panX = this.panX;
                var panY = this.panY;
                var move = function (e) {
                    self.panX = panX + (e.clientX - startX);
                    self.panY = panY + (e.clientY - startY);
                };
                var up = function () {
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', up);
                };
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            },
            download: function () {
                if ((!localMode && !sessionId) || !this.path) {
                    return;
                }
                var url = apiBase + '/download?path=' + encodeURIComponent(this.path)
                    + (localMode ? '' : '&sessionId=' + encodeURIComponent(sessionId));
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
                } else if (ev.key === 'ArrowLeft') {
                    this.step(-1);
                    ev.preventDefault();
                } else if (ev.key === 'ArrowRight') {
                    this.step(1);
                    ev.preventDefault();
                } else if (ev.key === '+' || ev.key === '=') {
                    this.zoomBy(1.25);
                    ev.preventDefault();
                } else if (ev.key === '-') {
                    this.zoomBy(0.8);
                    ev.preventDefault();
                } else if (ev.key === '0') {
                    this.fit();
                    ev.preventDefault();
                } else if (ev.key === 'r' || ev.key === 'R') {
                    this.rotate90();
                    ev.preventDefault();
                }
            }
        }
    });
})();
