$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
$lavalinkDir = Join-Path $root "lavalink"
$jarPath = Join-Path $lavalinkDir "Lavalink.jar"

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match "^\s*#" -or $_ -match "^\s*$" -or $_ -notmatch "=") {
      return
    }

    $parts = $_ -split "=", 2
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()

    if ($value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($key, $value, "Process")
  }
}

if (!(Test-Path $jarPath)) {
  throw "Lavalink.jar not found. Please run npm run setup:lavalink first."
}

Push-Location $lavalinkDir
try {
  java -jar "Lavalink.jar"
} finally {
  Pop-Location
}
