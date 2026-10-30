<#
  构建 DeepShell Electron 桌面版（Electron 壳 + 精简 JRE + 主程序 jar）。

  产物：
    electron/out/deepshell-<版本>-windows-x64-electron/       可直接运行的目录
    electron/out/deepshell-<版本>-windows-x64-electron.zip    分发包
    electron/out/deepshell-<版本>-windows-x64-electron.zip.sha256  发布用校验文件

  前置：JDK 17+（需带 jlink）、Maven；electron 目录已执行 npm install。
  示例：
    powershell -ExecutionPolicy Bypass -File tools/build-electron.ps1
    powershell -ExecutionPolicy Bypass -File tools/build-electron.ps1 -SkipMaven   # 复用已构建的 jar
#>
param(
    [string]$MavenCmd = "",
    [string]$JdkHome = "",
    [switch]$SkipMaven
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repo

function Fail($message) {
    Write-Host "[错误] $message" -ForegroundColor Red
    exit 1
}

function Info($message) {
    Write-Host "==> $message" -ForegroundColor Cyan
}

# ---------- 版本 ----------
[xml]$pom = Get-Content (Join-Path $repo 'pom.xml') -Raw
$version = [string]$pom.project.version
if (-not $version) { Fail '无法从 pom.xml 读取版本号' }
Info "DeepShell $version"

# ---------- JDK ----------
if (-not $JdkHome) {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\jlink.exe'))) {
        $JdkHome = $env:JAVA_HOME
    } elseif (Test-Path 'C:\Program Files\Java\jdk-21\bin\jlink.exe') {
        $JdkHome = 'C:\Program Files\Java\jdk-21'
    } elseif (Test-Path 'C:\Program Files\Java\jdk-17\bin\jlink.exe') {
        $JdkHome = 'C:\Program Files\Java\jdk-17'
    }
}
if (-not $JdkHome) {
    Fail '未找到 JDK 17+。请设置 JAVA_HOME，或传 -JdkHome "C:\Program Files\Java\jdk-21"'
}
$jlink = Join-Path $JdkHome 'bin\jlink.exe'
if (-not (Test-Path $jlink)) {
    Fail "JDK 目录缺少 jlink：$JdkHome"
}
Info "JDK: $JdkHome"
$env:JAVA_HOME = $JdkHome

# ---------- Maven 构建 ----------
if (-not $SkipMaven) {
    if (-not $MavenCmd) {
        $mvn = Get-Command mvn -ErrorAction SilentlyContinue
        if ($mvn) {
            $MavenCmd = $mvn.Source
        }
    }
    if (-not $MavenCmd) {
        $mvnPatterns = @(
            'C:\Program Files\JetBrains\IntelliJ IDEA *\plugins\maven\lib\maven3\bin\mvn.cmd',
            "$env:LOCALAPPDATA\JetBrains\Toolbox\apps\IDEA-*\*\plugins\maven\lib\maven3\bin\mvn.cmd",
            'C:\Software\JetBrains\IntelliJ IDEA *\plugins\maven\lib\maven3\bin\mvn.cmd'
        )
        $ideaMvn = Get-ChildItem -Path $mvnPatterns -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($ideaMvn) {
            $MavenCmd = $ideaMvn.FullName
        }
    }
    if (-not $MavenCmd) {
        Fail '未找到 mvn。请把 Maven 加入 PATH，或用 -MavenCmd 指定 mvn.cmd 路径；已构建过可加 -SkipMaven。'
    }
    Info "Maven: $MavenCmd"
    & $MavenCmd -B -DskipTests clean package
    if ($LASTEXITCODE -ne 0) { Fail "Maven 构建失败（退出码 $LASTEXITCODE）" }
}

$jar = Join-Path $repo 'target\deepshell.jar'
if (-not (Test-Path $jar)) { Fail "未找到 $jar，请先执行 mvn -DskipTests package" }

# ---------- Electron 运行时 ----------
$electronDir = Join-Path $repo 'electron'
$electronDist = Join-Path $electronDir 'node_modules\electron\dist'
if (-not (Test-Path (Join-Path $electronDist 'electron.exe'))) {
    Fail @'
未找到 Electron 运行时。请先在 electron 目录安装依赖：
  cd electron
  npm install --registry=https://registry.npmmirror.com
若 Electron 二进制下载失败，可先设置 $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/' 再重试。
'@
}
$electronVersion = (Get-Content (Join-Path $electronDir 'node_modules\electron\dist\version') -Raw).Trim()
Info "Electron: $electronVersion"

# ---------- 输出目录 ----------
$outRoot = Join-Path $electronDir 'out'
$staging = Join-Path $outRoot "deepshell-$version-windows-x64-electron"
$zip = "$staging.zip"

foreach ($path in @($staging, $zip, "$zip.sha256")) {
    if (Test-Path $path) { Remove-Item $path -Recurse -Force }
}
New-Item -ItemType Directory -Force -Path $staging | Out-Null

# ---------- Electron 壳 ----------
Info '复制 Electron 运行时…'
Copy-Item -Path (Join-Path $electronDist '*') -Destination $staging -Recurse -Force
# 默认应用只是没带 asar 时的兜底，发布包里用不到
Remove-Item (Join-Path $staging 'resources\default_app.asar') -Force -ErrorAction SilentlyContinue
Rename-Item (Join-Path $staging 'electron.exe') 'DeepShell.exe'

$appDir = Join-Path $staging 'resources\app'
New-Item -ItemType Directory -Force -Path (Join-Path $appDir 'assets') | Out-Null
Copy-Item (Join-Path $electronDir 'main.js') $appDir -Force
Copy-Item (Join-Path $electronDir 'preload.js') $appDir -Force
Copy-Item (Join-Path $electronDir 'assets\*') (Join-Path $appDir 'assets') -Force

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$appPkg = [ordered]@{
    name        = 'deepshell'
    productName = 'DeepShell'
    version     = $version
    private     = $true
    description = 'DeepShell desktop shell built with Electron'
    main        = 'main.js'
    license     = 'AGPL-3.0-only'
}
[System.IO.File]::WriteAllText(
    (Join-Path $appDir 'package.json'),
    ($appPkg | ConvertTo-Json),
    $utf8NoBom
)

# ---------- 精简 JRE ----------
# 与 build-portable.ps1 保持一致：Spring Boot / JSch / SQLite / AWT / TLS 需要的模块
$modules = @(
    'java.base',
    'java.compiler',
    'java.desktop',
    'java.instrument',
    'java.logging',
    'java.management',
    'java.naming',
    'java.prefs',
    'java.rmi',
    'java.scripting',
    'java.security.jgss',
    'java.security.sasl',
    'java.sql',
    'java.transaction.xa',
    'java.xml',
    'jdk.charsets',
    'jdk.crypto.ec',
    'jdk.crypto.cryptoki',
    'jdk.localedata',
    'jdk.management',
    'jdk.naming.dns',
    'jdk.unsupported',
    'jdk.zipfs'
) -join ','

Info '生成精简 JRE（jlink）…'
& $jlink --module-path (Join-Path $JdkHome 'jmods') --add-modules $modules `
    --output (Join-Path $staging 'resources\runtime') --strip-debug --no-header-files --no-man-pages --compress=2
if ($LASTEXITCODE -ne 0) { Fail "jlink 失败（退出码 $LASTEXITCODE）" }

# ---------- 主程序与配置 ----------
Info '复制 deepshell.jar 与外置配置…'
Copy-Item $jar (Join-Path $staging 'resources\deepshell.jar') -Force

$configText = Get-Content (Join-Path $repo 'dist\application.yml') -Raw -Encoding UTF8
$configText = [regex]::Replace($configText, '(?m)^(\s*version:\s*).*$', "`${1}$version")
[System.IO.File]::WriteAllText((Join-Path $staging 'resources\application.yml'), $configText, $utf8NoBom)

$readme = @"
DeepShell $version Electron 桌面版

双击 DeepShell.exe 启动。程序会拉起内置 Java 服务并打开桌面窗口，关闭窗口即退出。
数据目录：%APPDATA%\DeepShell\data（可用 DEEPSHELL_DATA_DIR 覆盖）
运行日志：%APPDATA%\DeepShell\logs
"@
[System.IO.File]::WriteAllText((Join-Path $staging 'README.txt'), $readme, $utf8NoBom)

if (-not (Test-Path (Join-Path $staging 'DeepShell.exe'))) { Fail '打包结果缺少 DeepShell.exe' }
if (-not (Test-Path (Join-Path $staging 'resources\deepshell.jar'))) { Fail '打包结果缺少 resources\deepshell.jar' }

# ---------- ZIP + SHA256 ----------
Info '生成 ZIP 与 SHA256…'
# 用 JDK 自带 jar 打包：ZIP 内路径统一用 /，跨平台解压不会出现反斜杠
$stageParent = Split-Path $staging -Parent
$stageLeaf = Split-Path $staging -Leaf
& (Join-Path $JdkHome 'bin\jar.exe') cMf $zip -C $stageParent $stageLeaf
if ($LASTEXITCODE -ne 0) { Fail "生成 ZIP 失败（退出码 $LASTEXITCODE）" }
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$zipName = Split-Path $zip -Leaf
[System.IO.File]::WriteAllText("$zip.sha256", "$hash  $zipName`r`n", $utf8NoBom)

$sizeMb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Info "完成：$zip（$sizeMb MB）"
Info "校验文件：$zip.sha256"
Info '发布时请把 ZIP 和 .sha256 一起上传。'
