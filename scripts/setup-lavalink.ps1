param(
  [string]$LavalinkVersion = "4.2.2",
  [string]$InstallDir = "lavalink"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $root $InstallDir
$targetJar = Join-Path $targetDir "Lavalink.jar"
$downloadUrl = "https://github.com/lavalink-devs/Lavalink/releases/download/$LavalinkVersion/Lavalink.jar"

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

Write-Host "[Lavalink] Downloading $downloadUrl"
Invoke-WebRequest -Uri $downloadUrl -OutFile $targetJar

Write-Host "[Lavalink] Installed to $targetJar"
Write-Host "[Lavalink] Run with: npm run start:lavalink"
