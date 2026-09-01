[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifestPath = Join-Path $repoRoot 'config/toolchain.lock.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$toolsRoot = Join-Path $repoRoot '.tools'
$cacheRoot = Join-Path $toolsRoot 'cache'
$nodeRoot = Join-Path $toolsRoot 'node'
$pnpmRoot = Join-Path $toolsRoot 'pnpm'
$rustupRoot = Join-Path $toolsRoot 'rustup'
$cargoRoot = Join-Path $toolsRoot 'cargo'

New-Item -ItemType Directory -Force -Path $toolsRoot, $cacheRoot | Out-Null

function Get-VerifiedFile {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256
    )

    if (Test-Path -LiteralPath $Destination) {
        $existing = (Get-FileHash -Algorithm SHA256 -LiteralPath $Destination).Hash.ToLowerInvariant()
        if ($existing -eq $ExpectedSha256.ToLowerInvariant()) {
            return
        }
        Remove-Item -LiteralPath $Destination -Force
    }

    $temporary = "$Destination.part"
    if (Test-Path -LiteralPath $temporary) {
        Remove-Item -LiteralPath $temporary -Force
    }
    & curl.exe --fail --location --retry 3 --output $temporary $Uri
    if ($LASTEXITCODE -ne 0) {
        throw "Download failed for $Uri with exit code $LASTEXITCODE."
    }

    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $temporary).Hash.ToLowerInvariant()
    if ($actual -ne $ExpectedSha256.ToLowerInvariant()) {
        Remove-Item -LiteralPath $temporary -Force
        throw "Checksum mismatch for $Uri. Expected $ExpectedSha256, got $actual."
    }
    Move-Item -LiteralPath $temporary -Destination $Destination
}

$nodeExecutable = Join-Path $nodeRoot 'node.exe'
if (-not (Test-Path -LiteralPath $nodeExecutable)) {
    $nodeArchive = Join-Path $cacheRoot $manifest.node.archive
    Get-VerifiedFile -Uri $manifest.node.download_url -Destination $nodeArchive -ExpectedSha256 $manifest.node.sha256
    $extractRoot = Join-Path $toolsRoot 'node-extract'
    if (Test-Path -LiteralPath $extractRoot) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
    Expand-Archive -LiteralPath $nodeArchive -DestinationPath $extractRoot -Force
    $expanded = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    if ($null -eq $expanded) {
        throw 'Node archive did not contain an expanded directory.'
    }
    Move-Item -LiteralPath $expanded.FullName -Destination $nodeRoot
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
}

$pnpmEntry = Join-Path $pnpmRoot 'node_modules/pnpm/bin/pnpm.cjs'
if (-not (Test-Path -LiteralPath $pnpmEntry)) {
    $npmCommand = Join-Path $nodeRoot 'npm.cmd'
    & $npmCommand install --global --prefix $pnpmRoot "$($manifest.pnpm.package)@$($manifest.pnpm.version)" --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm installation failed with exit code $LASTEXITCODE."
    }
}

$rustupInstaller = Join-Path $cacheRoot $manifest.rust.installer
Get-VerifiedFile -Uri $manifest.rust.download_url -Destination $rustupInstaller -ExpectedSha256 $manifest.rust.sha256

$cargoExecutable = Join-Path $cargoRoot 'bin/cargo.exe'
if (-not (Test-Path -LiteralPath $cargoExecutable)) {
    $env:RUSTUP_HOME = $rustupRoot
    $env:CARGO_HOME = $cargoRoot
    & $rustupInstaller -y --no-modify-path --profile minimal --default-toolchain $manifest.rust.version --default-host $manifest.rust.target
    if ($LASTEXITCODE -ne 0) {
        throw "Rust installation failed with exit code $LASTEXITCODE."
    }
    & (Join-Path $cargoRoot 'bin/rustup.exe') component add rustfmt clippy
    if ($LASTEXITCODE -ne 0) {
        throw "Rust component installation failed with exit code $LASTEXITCODE."
    }
}

& $nodeExecutable --version
& $nodeExecutable $pnpmEntry --version
$env:RUSTUP_HOME = $rustupRoot
$env:CARGO_HOME = $cargoRoot
& $cargoExecutable --version
