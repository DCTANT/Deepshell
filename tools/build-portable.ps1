<#
  构建 DeepShell Windows 绿色版（jpackage app-image + 精简 JRE）。
  产物：
    target/deepshell-<版本>-windows-x64-portable/      可直接运行的目录
    target/deepshell-<版本>-windows-x64-portable.zip   分发包
    target/deepshell-<版本>-windows-x64-portable.zip.sha256  发布用校验文件

  前置：JDK 17+（需带 jlink / jpackage）、Maven。默认使用 JAVA_HOME 与 PATH 里的 mvn。
  示例：
    powershell -ExecutionPolicy Bypass -File tools/build-portable.ps1
    powershell -ExecutionPolicy Bypass -File tools/build-portable.ps1 -SkipMaven
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

# ---------- JDK ----------
if (-not $JdkHome) {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\jpackage.exe'))) {
        $JdkHome = $env:JAVA_HOME
    } elseif (Test-Path 'C:\Program Files\Java\jdk-21\bin\jpackage.exe') {
        $JdkHome = 'C:\Program Files\Java\jdk-21'
    } elseif (Test-Path 'C:\Program Files\Java\jdk-17\bin\jpackage.exe') {
        $JdkHome = 'C:\Program Files\Java\jdk-17'
    }
}
if (-not $JdkHome) {
    Fail '未找到 JDK 17+。请设置 JAVA_HOME，或传 -JdkHome "C:\Program Files\Java\jdk-21"'
}
$jlink = Join-Path $JdkHome 'bin\jlink.exe'
$jpackage = Join-Path $JdkHome 'bin\jpackage.exe'
if (-not (Test-Path $jlink) -or -not (Test-Path $jpackage)) {
    Fail "JDK 目录缺少 jlink / jpackage：$JdkHome"
}
Info "JDK: $JdkHome"
# 双击运行时进程环境里不一定有 JAVA_HOME，显式设置后 Maven 才会用同一个 JDK
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
        # 未安装独立 Maven 时，使用 IntelliJ IDEA 自带的 Maven
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
    & $MavenCmd -B -DskipTests package
    if ($LASTEXITCODE -ne 0) { Fail "Maven 构建失败（退出码 $LASTEXITCODE）" }
}

$jar = Join-Path $repo 'target\deepshell.jar'
if (-not (Test-Path $jar)) { Fail "未找到 $jar，请先执行 mvn -DskipTests package" }

# ---------- 输出目录 ----------
$outRoot = Join-Path $repo 'target\portable'
$runtime = Join-Path $outRoot 'runtime'
$inputDir = Join-Path $outRoot 'input'
$imageDest = Join-Path $outRoot 'image'
$staging = Join-Path $repo "target\deepshell-$version-windows-x64-portable"
$zip = Join-Path $repo "target\deepshell-$version-windows-x64-portable.zip"

foreach ($dir in @($outRoot, $runtime, $inputDir, $imageDest, $staging)) {
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
}
New-Item -ItemType Directory -Force -Path $inputDir, $imageDest | Out-Null

# ---------- 精简 JRE ----------
# Spring Boot / JSch / SQLite / AWT 托盘 / TLS 需要的模块；不裁剪到只剩个别模块，避免运行期缺类。
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
    --output $runtime --strip-debug --no-header-files --no-man-pages --compress=2
if ($LASTEXITCODE -ne 0) { Fail "jlink 失败（退出码 $LASTEXITCODE）" }

# ---------- jpackage app-image ----------
Copy-Item $jar (Join-Path $inputDir 'deepshell.jar') -Force
$icon = Join-Path $repo 'src\main\resources\static\favicon.ico'
Info '生成绿色版应用目录（jpackage）…'
& $jpackage --type app-image --name DeepShell --app-version $version `
    --input $inputDir --main-jar deepshell.jar --runtime-image $runtime `
    --icon $icon --dest $imageDest --vendor 'DeepShell' `
    --description 'DeepShell SSH 终端与 AI 运维助手' `
    --copyright 'DeepShell' `
    --java-options '-Dfile.encoding=UTF-8'
if ($LASTEXITCODE -ne 0) { Fail "jpackage 失败（退出码 $LASTEXITCODE）" }

$appImage = Join-Path $imageDest 'DeepShell'
if (-not (Test-Path (Join-Path $appImage 'DeepShell.exe'))) {
    Fail 'jpackage 没有生成 DeepShell.exe'
}

# ---------- 外置配置 / 数据目录 / 说明 ----------
Info '组装 application.yml、data 与说明文件…'
$configText = Get-Content (Join-Path $repo 'dist\application.yml') -Raw -Encoding UTF8
$configText = [regex]::Replace($configText, '(?m)^(\s*version:\s*).*$', "`${1}$version")
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $appImage 'application.yml'), $configText, $utf8NoBom)

$dataSrc = Join-Path $repo 'dist\data'
$dataDst = Join-Path $appImage 'data'
if (Test-Path $dataSrc) {
    Copy-Item $dataSrc $dataDst -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $dataDst 'db'), (Join-Path $dataDst 'logs') | Out-Null

$readme = Get-Content (Join-Path $repo 'dist\PORTABLE-README.txt') -Raw -Encoding UTF8
$readme = $readme.Replace('@VERSION@', $version)
[System.IO.File]::WriteAllText((Join-Path $appImage 'README.txt'), $readme, $utf8NoBom)

# 文件名固定为 DeepShell，便于升级助手按启动器找到程序目录
Copy-Item $appImage $staging -Recurse -Force

# ---------- ZIP + SHA256 ----------
Info '生成 ZIP 与 SHA256…'
if (Test-Path $zip) { Remove-Item $zip -Force }
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
Info '发布时请把 ZIP 和 .sha256 一起上传到 Gitee Releases，自动更新才能通过校验。'
