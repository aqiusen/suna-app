# 在 Windows 上构建便携桌面包：suna-app.exe + runtime\suna.exe
# 用法:
#   $env:SUNA_RUNTIME = "H:\liang-workspace-suna\suna\suna.exe"
#   .\scripts\build-desktop.ps1 -Version v0.1.0 -Goarch amd64
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Goarch = "amd64"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RuntimeSrc = $env:SUNA_RUNTIME
if (-not $RuntimeSrc) {
  throw "Set SUNA_RUNTIME to the prebuilt suna.exe path"
}
if (-not (Test-Path $RuntimeSrc)) {
  throw "SUNA_RUNTIME is not a file: $RuntimeSrc"
}

if (-not (Test-Path (Join-Path $Root "frontend\node_modules"))) {
  throw "frontend dependencies missing: run 'cd frontend; pnpm install' first"
}

Push-Location (Join-Path $Root "frontend")
try {
  pnpm build
} finally {
  Pop-Location
}

$stage = Join-Path $Root "scripts\stage-frontend.sh"
if (Get-Command bash -ErrorAction SilentlyContinue) {
  bash $stage
} else {
  $webDist = Join-Path $Root "gateway\internal\webassets\dist"
  $frontDist = Join-Path $Root "frontend\dist"
  if (-not (Test-Path (Join-Path $frontDist "index.html"))) {
    throw "frontend/dist/index.html missing after pnpm build"
  }
  New-Item -ItemType Directory -Force -Path $webDist | Out-Null
  Copy-Item -Recurse -Force (Join-Path $frontDist "*") $webDist
}

$DistDir = Join-Path $Root "dist\desktop\windows-$Goarch"
Remove-Item -Recurse -Force $DistDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $DistDir "runtime") | Out-Null

$ldflags = "-s -w -X main.buildVersion=$Version -H=windowsgui"
Push-Location (Join-Path $Root "gateway")
try {
  $env:CGO_ENABLED = "0"
  $env:GOOS = "windows"
  $env:GOARCH = $Goarch
  go build -trimpath -ldflags $ldflags -o (Join-Path $DistDir "suna-app.exe") .\cmd\suna-app
} finally {
  Pop-Location
  Remove-Item Env:CGO_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:GOOS -ErrorAction SilentlyContinue
  Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
}

Copy-Item $RuntimeSrc (Join-Path $DistDir "runtime\suna.exe")
$Archive = Join-Path $Root "dist\$Version-suna-desktop-windows-$Goarch.zip"
New-Item -ItemType Directory -Force -Path (Join-Path $Root "dist") | Out-Null
if (Test-Path $Archive) { Remove-Item $Archive }
Compress-Archive -Path (Join-Path $DistDir "*") -DestinationPath $Archive -Force
Write-Host "wrote $Archive"
