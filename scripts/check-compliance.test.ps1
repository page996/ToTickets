[CmdletBinding()]
param(
    [string]$CheckerPath = (Join-Path $PSScriptRoot 'check-compliance.ps1')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$checker = (Resolve-Path -LiteralPath $CheckerPath -ErrorAction Stop).Path
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
)
$fixtureRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $temporaryRoot "ticketing-console-compliance-$([guid]::NewGuid().ToString('N'))")
)
$expectedPrefix = $temporaryRoot + [System.IO.Path]::DirectorySeparatorChar
if (-not $fixtureRoot.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to create a compliance fixture outside the system temporary directory: $fixtureRoot"
}

try {
    $sourceDirectory = New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'apps/api/src/other') -Force
    $configDirectory = New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'config') -Force
    $docsDirectory = New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'docs') -Force
    Set-Content -LiteralPath (Join-Path $sourceDirectory.FullName 'other.ts') -Encoding utf8 -Value @(
        "const OUT_OF_SCOPE_LOOPBACK = '::1'; // compliance: loopback-bind-policy-constant"
    )
    Set-Content -LiteralPath (Join-Path $configDirectory.FullName 'config.example.json') -Encoding utf8 -Value @(
        '{',
        '  "schema_version": "runtime-config.v1",',
        '  "api": {"bind_host": "${CONTROL_BIND_HOST}"}',
        '}'
    )
    Set-Content -LiteralPath (Join-Path $docsDirectory.FullName 'openapi.v1.json') -Encoding utf8 -Value @(
        '{',
        '  "openapi": "3.1.0",',
        '  "jsonSchemaDialect": "https://json-schema.org/draft/2020-12/schema",',
        '  "paths": {}',
        '}'
    )

    $output = @(& $checker -ProjectRoot $fixtureRoot *>&1) | Out-String
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
        throw "Expected the out-of-scope loopback policy marker to fail compliance.`n$output"
    }
    if (
        $output -notmatch 'apps/api/src/other/other\.ts' -or
        $output -notmatch 'Hardcoded loopback or wildcard host'
    ) {
        throw "Compliance failed without reporting the out-of-scope loopback constant.`n$output"
    }
    if ($output -match 'docs/openapi\.v1\.json') {
        throw "Compliance treated the exact OpenAPI JSON Schema dialect identifier as a runtime address.`n$output"
    }
    Write-Host 'Compliance checker self-test passed: out-of-scope policy markers remain violations.'
} finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        $resolvedFixture = [System.IO.Path]::GetFullPath(
            (Resolve-Path -LiteralPath $fixtureRoot -ErrorAction Stop).Path
        )
        if (-not $resolvedFixture.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove a compliance fixture outside the system temporary directory: $resolvedFixture"
        }
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
}
