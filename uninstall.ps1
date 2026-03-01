# Uninstall script for Ralph Wiggum CLI (Windows)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "Uninstalling Ralph Wiggum CLI..."
Write-Host ""

$removed = $false

# ── Remove bun-linked binaries from ~/.bun/bin ────────────────────────────────
# bun link drops ralph.exe + ralph.bunx here; bun unlink is not yet implemented
$bunBin = "$env:USERPROFILE\.bun\bin"
foreach ($file in @("ralph.exe", "ralph.bunx", "ralph")) {
  $target = Join-Path $bunBin $file
  if (Test-Path $target) {
    Remove-Item -Force $target
    Write-Host "  Removed $target"
    $removed = $true
  }
}

# ── Remove npm global install ─────────────────────────────────────────────────
if (Get-Command npm -ErrorAction SilentlyContinue) {
  $npmList = npm list -g --depth=0 2>$null
  if ($npmList -match "@flywalk4/ralph-wiggum") {
    Write-Host "  Removing npm global package..."
    npm uninstall -g @flywalk4/ralph-wiggum 2>$null
    $removed = $true
  }
}

# ── Remove any remaining ralph shim on PATH ───────────────────────────────────
$ralphPath = Get-Command ralph -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if ($ralphPath -and (Test-Path $ralphPath)) {
  Remove-Item -Force $ralphPath
  Write-Host "  Removed $ralphPath"
  $removed = $true
}

Write-Host ""
if ($removed) {
  Write-Host "Uninstall complete!"
} else {
  Write-Host "Nothing to uninstall (ralph was not found on this system)."
}
Write-Host "You may also delete the cloned repository folder."
