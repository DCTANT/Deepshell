'use strict';

const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

app.setName('DeepShell');

const isWindows = process.platform === 'win32';
const gotLock = app.requestSingleInstanceLock();

let mainWindow = null;
let splashWindow = null;
let javaProcess = null;
let quitting = false;
let appUrl = '';
let logFile = '';

if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', focusWindow);
    app.whenReady().then(start).catch(fail);
}

function iconPath() {
    return path.join(__dirname, 'assets', isWindows ? 'icon.ico' : 'icon.png');
}

function resolveJar() {
    const candidates = [
        process.env.DEEPSHELL_JAR,
        app.isPackaged ? path.join(process.resourcesPath, 'deepshell.jar') : '',
        path.join(__dirname, '..', 'target', 'deepshell.jar'),
        path.join(__dirname, '..', 'dist', 'deepshell.jar')
    ].filter(Boolean);
    return candidates.find(file => fs.existsSync(file)) || '';
}

function resolveJava() {
    if (process.env.DEEPSHELL_JAVA && fs.existsSync(process.env.DEEPSHELL_JAVA)) {
        return process.env.DEEPSHELL_JAVA;
    }
    if (app.isPackaged) {
        const bundled = path.join(process.resourcesPath, 'runtime', 'bin', isWindows ? 'java.exe' : 'java');
        if (fs.existsSync(bundled)) {
            return bundled;
        }
    }
    if (process.env.JAVA_HOME) {
        const candidate = path.join(process.env.JAVA_HOME, 'bin', isWindows ? 'java.exe' : 'java');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return isWindows ? 'java.exe' : 'java';
}

function resolveDataDir() {
    if (process.env.DEEPSHELL_DATA_DIR) {
        return path.resolve(process.env.DEEPSHELL_DATA_DIR);
    }
    return path.join(app.getPath('userData'), 'data');
}

function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });
}

function waitForServer(url, timeoutMs) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const attempt = () => {
            let settled = false;
            const done = ok => {
                if (settled) { return; }
                settled = true;
                if (ok) {
                    resolve();
                } else if (Date.now() - started >= timeoutMs) {
                    reject(new Error('本地服务启动超时'));
                } else {
                    setTimeout(attempt, 350);
                }
            };
            const req = http.get(url, { timeout: 1500 }, res => {
                res.resume();
                done(res.statusCode < 500);
            });
            req.on('timeout', () => { req.destroy(); done(false); });
            req.on('error', () => done(false));
        };
        attempt();
    });
}

function createSplash() {
    splashWindow = new BrowserWindow({
        width: 420,
        height: 250,
        frame: false,
        resizable: false,
        movable: true,
        alwaysOnTop: true,
        show: false,
        backgroundColor: '#080d15',
        icon: iconPath(),
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        html,body{height:100%;margin:0}
        body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
            background:radial-gradient(500px 260px at 50% 0%,#16233a,#080d15 70%);
            color:#e7eef9;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif}
        .logo{font-size:30px;letter-spacing:2px;font-weight:600}
        .logo span{color:#65e6ff}
        .sub{font-size:12px;color:#8da1b9}
        .bar{width:150px;height:2px;overflow:hidden;border-radius:2px;background:rgba(148,178,214,.18)}
        .bar i{display:block;width:45%;height:100%;background:linear-gradient(90deg,#5aa2ff,#65e6ff);
            animation:run 1.15s ease-in-out infinite}
        @keyframes run{0%{transform:translateX(-110%)}100%{transform:translateX(340%)}}
    </style></head><body>
        <div class="logo">Deep<span>Shell</span></div>
        <div class="sub">正在启动本地服务，请稍候…</div>
        <div class="bar"><i></i></div>
    </body></html>`;
    splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    splashWindow.once('ready-to-show', () => splashWindow.show());
}

function closeSplash() {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
    }
    splashWindow = null;
}

function startJava(port, dataDir) {
    const jar = resolveJar();
    if (!jar) {
        throw new Error('未找到 deepshell.jar。请先执行 mvn package，或通过 DEEPSHELL_JAR 指定 jar 路径。');
    }
    const java = resolveJava();
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    logFile = path.join(logDir, 'shell-java.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    const args = [
        '-Ddeepshell.open-browser=false',
        '-Ddeepshell.protocol.enabled=false',
        '-Ddeepshell.update.enabled=false',
        '-Ddeepshell.tray.enabled=false',
        '-Dfile.encoding=UTF-8',
        '-Ddeepshell.data-dir=' + dataDir,
        '-jar', jar,
        '--server.port=' + port
    ];
    javaProcess = spawn(java, args, {
        cwd: path.dirname(jar),
        windowsHide: true,
        detached: !isWindows,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    javaProcess.stdout.pipe(logStream);
    javaProcess.stderr.pipe(logStream);
    javaProcess.on('error', err => {
        if (!quitting) {
            fail(new Error('无法启动 Java：' + err.message));
        }
    });
    javaProcess.on('exit', code => {
        javaProcess = null;
        if (!quitting) {
            fail(new Error('本地服务已退出（code ' + code + '）。\n日志：' + logFile));
        }
    });
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        show: false,
        backgroundColor: '#080d15',
        title: 'DeepShell',
        icon: iconPath(),
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });

    mainWindow.loadURL(appUrl);
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => {
        mainWindow = null;
        app.quit();
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isLocalUrl(url)) {
            return { action: 'allow' };
        }
        shell.openExternal(url).catch(() => {});
        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!isLocalUrl(url)) {
            event.preventDefault();
            shell.openExternal(url).catch(() => {});
        }
    });

    mainWindow.webContents.on('before-input-event', (event, input) => {
        const key = (input.key || '').toLowerCase();
        if (input.key === 'F12' || (input.control && input.shift && key === 'i')) {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });

    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
        const url = (contents && contents.getURL()) || '';
        callback(isLocalUrl(url));
    });
}

function isLocalUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    } catch (e) {
        return false;
    }
}

function focusWindow() {
    const win = mainWindow || splashWindow;
    if (!win) { return; }
    if (win.isMinimized()) { win.restore(); }
    win.show();
    win.focus();
}

async function start() {
    app.setAppUserModelId('com.deepshell.desktop');
    if (process.platform === 'darwin') {
        Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    } else {
        Menu.setApplicationMenu(null);
    }

    createSplash();
    const port = await findFreePort();
    const dataDir = resolveDataDir();
    appUrl = 'http://127.0.0.1:' + port + '/';
    startJava(port, dataDir);
    await waitForServer(appUrl, 90000);
    if (quitting) { return; }
    closeSplash();
    createMainWindow();
}

function fail(error) {
    if (quitting) { return; }
    quitting = true;
    closeSplash();
    stopJava();
    const message = (error && error.message) || String(error);
    dialog.showErrorBox('DeepShell 启动失败', message);
    app.quit();
}

function stopJava() {
    if (!javaProcess) { return; }
    const pid = javaProcess.pid;
    javaProcess = null;
    try {
        if (isWindows) {
            spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
        } else {
            process.kill(-pid, 'SIGTERM');
        }
    } catch (e) {
        try { process.kill(pid, 'SIGTERM'); } catch (ignore) { /* already gone */ }
    }
}

app.on('before-quit', () => {
    quitting = true;
    stopJava();
});

app.on('window-all-closed', () => {
    app.quit();
});

process.on('exit', stopJava);
