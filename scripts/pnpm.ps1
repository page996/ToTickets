$ErrorActionPreference = 'Stop'
$pnpmArguments = $args
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodeExecutable = Join-Path $repoRoot '.tools/node/node.exe'
$pnpmEntry = Join-Path $repoRoot '.tools/pnpm/node_modules/pnpm/bin/pnpm.cjs'
$storeRoot = Join-Path $repoRoot '.pnpm-store'
$cacheRoot = Join-Path $repoRoot '.runtime/pnpm-cache'
$nodeRoot = Split-Path -Parent $nodeExecutable
$pnpmRoot = Join-Path $repoRoot '.tools/pnpm'

if (-not (Test-Path -LiteralPath $nodeExecutable) -or -not (Test-Path -LiteralPath $pnpmEntry)) {
    throw 'Project toolchain is missing. Run scripts/bootstrap-toolchain.ps1 first.'
}

foreach ($argument in $pnpmArguments) {
    if ($argument -match '^--(?:config\.)?(?:store-dir|cache-dir)(?:=|$)') {
        throw 'The project pnpm store and cache locations cannot be overridden.'
    }
}

$env:Path = "$nodeRoot$([System.IO.Path]::PathSeparator)$pnpmRoot$([System.IO.Path]::PathSeparator)$env:Path"
& $nodeExecutable $pnpmEntry "--config.store-dir=$storeRoot" "--config.cache-dir=$cacheRoot" @pnpmArguments
exit $LASTEXITCODE
