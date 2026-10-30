<#
  一键打包：传统分发包 + Windows 绿色版 + SHA256 校验文件。

  双击仓库根目录的 build-release.cmd 即可；也可命令行执行：
    powershell -ExecutionPolicy Bypass -File tools/build-release.ps1
    powershell -ExecutionPolicy Bypass -File tools/build-release.ps1 -SkipMaven   # 复用已构建的 jar

  依赖：JDK 17+（需带 jlink / jpackage）与 Maven（PATH 里没有时自动找 IDEA 自带的）。
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
$Host.UI.RawUI.WindowTitle = 'DeepShell 一键打包'

function Fail($message) {
    Write-Host "[错误] $message" -ForegroundColor Red
    exit 1
}

function Info($message) {
    Write-Host "==> $message" -ForegroundColor Cyan
}

[xml]$pom = Get-Content (Join-Path $repo 'pom.xml') -Raw
$version = [string]$pom.project.version
if (-not $version) { Fail '无法从 pom.xml 读取版本号' }
Info "DeepShell $version"

# ---------- Maven 构建 + Windows 绿色版 ----------
$portableScript = Join-Path $PSScriptRoot 'build-portable.ps1'
if (-not (Test-Path $portableScript)) { Fail "缺少 $portableScript" }

$classicZip = Join-Path $repo "target\deepshell-$version.zip"
if ($SkipMaven -and -not (Test-Path $classicZip)) {
    Fail "未找到 $classicZip。使用 -SkipMaven 时请先执行 mvn -DskipTests clean package"
}

$psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $portableScript)
if ($MavenCmd) { $psArgs += @('-MavenCmd', $MavenCmd) }
if ($JdkHome) { $psArgs += @('-JdkHome', $JdkHome) }
if ($SkipMaven) { $psArgs += '-SkipMaven' }

& powershell.exe @psArgs
if ($LASTEXITCODE -ne 0) { Fail "绿色版构建失败（退出码 $LASTEXITCODE）" }

# ---------- 传统分发包的 SHA256 ----------
if (-not (Test-Path $classicZip)) {
    Fail "Maven 未生成传统分发包 $classicZip"
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$classicHash = (Get-FileHash $classicZip -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText("$classicZip.sha256", "$classicHash  $(Split-Path $classicZip -Leaf)`r`n", $utf8NoBom)

# ---------- 汇总 ----------
$portableZip = Join-Path $repo "target\deepshell-$version-windows-x64-portable.zip"
Info '全部完成，发布产物：'
foreach ($file in @($classicZip, "$classicZip.sha256", $portableZip, "$portableZip.sha256")) {
    if (Test-Path $file) {
        $size = [math]::Round((Get-Item $file).Length / 1MB, 1)
        Write-Host ("  {0}  ({1} MB)" -f (Split-Path $file -Leaf), $size)
    }
}
Write-Host ''
Write-Host '上传到 Gitee Releases 时请把 ZIP 与同名 .sha256 一起上传（自动更新依赖校验文件）。' -ForegroundColor Yellow

Start-Process explorer.exe -ArgumentList ('"{0}"' -f (Join-Path $repo 'target'))
