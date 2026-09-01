[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$wrapper = Join-Path $repoRoot 'scripts/pnpm.ps1'
$engine = (Get-Process -Id $PID).Path
$expectedStore = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.pnpm-store'))
$expectedCache = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.runtime/pnpm-cache'))

function Assert-EqualPath {
    param(
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Actual,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $resolvedActual = [System.IO.Path]::GetFullPath($Actual.Trim())
    if (-not $Expected.Equals($resolvedActual, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label mismatch. Expected $Expected, got $resolvedActual."
    }
}

$version = ([string](& $wrapper --version)).Trim()
if ($LASTEXITCODE -ne 0 -or $version -cne '11.19.0') {
    throw "Unexpected project pnpm version: $version"
}

$store = ([string](& $wrapper config get store-dir)).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to read project pnpm store-dir.' }
Assert-EqualPath -Expected $expectedStore -Actual $store -Label 'store-dir'

$cache = ([string](& $wrapper config get cache-dir)).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to read project pnpm cache-dir.' }
Assert-EqualPath -Expected $expectedCache -Actual $cache -Label 'cache-dir'

$overrideOutput = & $engine -NoProfile -File $wrapper '--config.cache-dir=outside' --version 2>&1
if ($LASTEXITCODE -eq 0 -or [string]$overrideOutput -notmatch 'cannot be overridden') {
    throw 'pnpm wrapper did not reject a cache-dir override.'
}

$overrideOutput = & $engine -NoProfile -File $wrapper '--store-dir' 'outside' --version 2>&1
if ($LASTEXITCODE -eq 0 -or [string]$overrideOutput -notmatch 'cannot be overridden') {
    throw 'pnpm wrapper did not reject a store-dir override.'
}

Write-Host 'pnpm wrapper tests passed.'
