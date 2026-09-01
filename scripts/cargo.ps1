$ErrorActionPreference = 'Stop'
$cargoArguments = $args
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$env:RUSTUP_HOME = Join-Path $repoRoot '.tools/rustup'
$env:CARGO_HOME = Join-Path $repoRoot '.tools/cargo'
$cargoExecutable = Join-Path $env:CARGO_HOME 'bin/cargo.exe'

if (-not (Test-Path -LiteralPath $cargoExecutable)) {
    throw 'Project Rust toolchain is missing. Run scripts/bootstrap-toolchain.ps1 first.'
}

& $cargoExecutable @cargoArguments
exit $LASTEXITCODE
