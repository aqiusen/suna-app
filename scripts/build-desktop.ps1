# 在 Windows 上构建便携桌面包：suna-app.exe + runtime\suna.exe
# 用法:
#   $env:SUNA_RUNTIME = "H:\liang-workspace-suna\suna\suna.exe"
#   .\scripts\build-desktop.ps1 -AppVersion v0.1.0 -Goarch amd64
param(
  [Parameter(Mandatory = $true)][string]$AppVersion,
  [string]$Goarch = "amd64"
)

$ErrorActionPreference = "Stop"
# 变量名避开 $Root / $webDist：pnpm.ps1 会污染这些名字。
$scriptPath = $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($scriptPath)) {
  $SunaAppRepo = (Get-Location).Path
} else {
  $SunaAppRepo = Split-Path -Parent (Split-Path -Parent $scriptPath)
}
$SunaRuntimeSrc = $env:SUNA_RUNTIME
if (-not $SunaRuntimeSrc) {
  throw "Set SUNA_RUNTIME to the prebuilt suna.exe path"
}
if (-not (Test-Path -LiteralPath $SunaRuntimeSrc)) {
  throw "SUNA_RUNTIME is not a file: $SunaRuntimeSrc"
}

$SunaFrontendDir = Join-Path $SunaAppRepo "frontend"
if (-not (Test-Path -LiteralPath (Join-Path $SunaFrontendDir "node_modules"))) {
  throw "frontend dependencies missing: run 'cd frontend; pnpm install' first"
}

Push-Location $SunaFrontendDir
try {
  pnpm build
} finally {
  Pop-Location
}

$SunaFrontOut = Join-Path $SunaFrontendDir "dist"
$SunaEmbedOut = Join-Path $SunaAppRepo "gateway\internal\webassets\dist"
if (-not (Test-Path -LiteralPath (Join-Path $SunaFrontOut "index.html"))) {
  throw "frontend/dist/index.html missing after pnpm build"
}
New-Item -ItemType Directory -Force -Path $SunaEmbedOut | Out-Null
Get-ChildItem -LiteralPath $SunaEmbedOut -Force | Where-Object { $_.Name -ne ".gitkeep" } | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Recurse -Force
}
Get-ChildItem -LiteralPath $SunaFrontOut -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $SunaEmbedOut -Recurse -Force
}
if (-not (Test-Path -LiteralPath (Join-Path $SunaEmbedOut "index.html"))) {
  throw "staging failed: gateway/internal/webassets/dist/index.html is missing"
}

$SunaOutDir = Join-Path $SunaAppRepo "dist\desktop\windows-$Goarch"
Remove-Item -LiteralPath $SunaOutDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $SunaOutDir "runtime") | Out-Null

$SunaLdflags = "-s -w -X main.buildVersion=$AppVersion -H=windowsgui"
Push-Location (Join-Path $SunaAppRepo "gateway")
try {
  $env:CGO_ENABLED = "0"
  $env:GOOS = "windows"
  $env:GOARCH = $Goarch
  go build -trimpath -ldflags $SunaLdflags -o (Join-Path $SunaOutDir "suna-app.exe") .\cmd\suna-app
} finally {
  Pop-Location
  Remove-Item Env:CGO_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:GOOS -ErrorAction SilentlyContinue
  Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
}

Copy-Item -LiteralPath $SunaRuntimeSrc -Destination (Join-Path $SunaOutDir "runtime\suna.exe")
$SunaZip = Join-Path $SunaAppRepo "dist\$AppVersion-suna-desktop-windows-$Goarch.zip"
New-Item -ItemType Directory -Force -Path (Join-Path $SunaAppRepo "dist") | Out-Null
if (Test-Path -LiteralPath $SunaZip) { Remove-Item -LiteralPath $SunaZip }
Compress-Archive -Path (Join-Path $SunaOutDir "*") -DestinationPath $SunaZip -Force
Write-Host "wrote $SunaZip"

# 把 zip 嵌进安装器：用户双击一个 exe 即可，不用先解压。
$SunaPayloadDir = Join-Path $SunaAppRepo "gateway\cmd\suna-setup\payload"
New-Item -ItemType Directory -Force -Path $SunaPayloadDir | Out-Null
Copy-Item -LiteralPath $SunaZip -Destination (Join-Path $SunaPayloadDir "app.zip") -Force
$SunaSetup = Join-Path $SunaAppRepo "dist\SunaSetup-$AppVersion-windows-$Goarch.exe"
Push-Location (Join-Path $SunaAppRepo "gateway")
try {
  $env:CGO_ENABLED = "0"
  $env:GOOS = "windows"
  $env:GOARCH = $Goarch
  go build -trimpath -ldflags "-s -w -H=windowsgui" -o $SunaSetup .\cmd\suna-setup
} finally {
  Pop-Location
  Remove-Item Env:CGO_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:GOOS -ErrorAction SilentlyContinue
  Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
}
Write-Host "wrote $SunaSetup"
