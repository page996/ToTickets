$ErrorActionPreference = 'Stop'
$tauriArguments = $args
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$rustupRoot = Join-Path $repoRoot '.tools/rustup'
$cargoRoot = Join-Path $repoRoot '.tools/cargo'
$cargoBin = Join-Path $cargoRoot 'bin'
$cargoExecutable = Join-Path $cargoBin 'cargo.exe'
$pnpmWrapper = Join-Path $PSScriptRoot 'pnpm.ps1'

if (-not (Test-Path -LiteralPath $cargoExecutable -PathType Leaf)) {
    throw 'Project Rust toolchain is missing. Run scripts/bootstrap-toolchain.ps1 first.'
}
if (-not (Test-Path -LiteralPath $pnpmWrapper -PathType Leaf)) {
    throw 'Project pnpm wrapper is missing.'
}

$env:RUSTUP_HOME = $rustupRoot
$env:CARGO_HOME = $cargoRoot
$env:Path = "$cargoBin$([System.IO.Path]::PathSeparator)$env:Path"

& $pnpmWrapper --filter '@ticketing-console/console' tauri @tauriArguments
exit $LASTEXITCODE
