[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$checker = (Resolve-Path (Join-Path $PSScriptRoot '../check-compliance.ps1')).Path
$engine = (Get-Process -Id $PID).Path
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([char[]]@('\', '/'))
$fixtureRoot = Join-Path $temporaryRoot ("static-compliance-test-{0}" -f [guid]::NewGuid().ToString('N'))

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Write-FixtureFile {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$Content
    )

    $path = Join-Path $fixtureRoot $RelativePath
    $directory = Split-Path -Parent $path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    [System.IO.File]::WriteAllText($path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Invoke-FixtureCheck {
    $output = (& $engine -NoProfile -NonInteractive -File $checker -ProjectRoot $fixtureRoot 2>&1 | Out-String)
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = $output
    }
}

try {
    New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
    Write-FixtureFile -RelativePath 'config/config.example.json' -Content @'
{
  "schema_version": "runtime-config.v1",
  "api": { "bind_host": "${CONTROL_BIND_HOST}" }
}
'@
    Write-FixtureFile -RelativePath 'src/safe.ts' -Content @'
export function loadHost(): string {
  const configuredHost = process.env.CONTROL_BIND_HOST;
  if (!configuredHost) throw new Error('Missing CONTROL_BIND_HOST');
  return configuredHost;
}
'@
    Write-FixtureFile -RelativePath 'config/system-helper-manifest.v1.json' -Content @'
{
  "schema_version": "system-helper-manifest.v1",
  "manifest_id": "fixture",
  "entries": [
    {
      "helper_id": "fixture-helper",
      "state": "proposed",
      "purpose": "static provenance fixture",
      "artifact": {
        "path_ref": "env:FIXTURE_HELPER_PATH",
        "version": "1",
        "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "source_url": "https://docs.example.invalid/provenance",
        "license": "MIT",
        "maintenance": "unknown"
      },
      "approval": { "approved_by": null, "approved_at_utc": null },
      "capabilities": {
        "allow": ["version_read"],
        "deny": ["device_input", "ui_automation", "credential_access", "transaction_automation", "private_api", "network_external", "risk_control_evasion", "apk_install", "data_export"]
      },
      "invocation": {
        "allowed_operations": ["version"],
        "allowed_environment_keys": ["FIXTURE_HELPER_PATH"],
        "working_directory": "none",
        "network_access": "none",
        "max_runtime_ms": 1000,
        "max_output_bytes": 1024,
        "max_child_processes": 0
      },
      "data_policy": { "read_scopes": [], "write_scopes": [], "sensitive_data": "deny" },
      "resource_limits": { "cpu_seconds": 1, "memory_mib": 16, "disk_mib": 0 },
      "lifecycle": { "start": "manual_approval", "health": "bounded_probe", "stop": "graceful_then_force", "crash_recovery": "disabled_until_review" },
      "audit": { "event_type": "system-helper.invocation.v1", "checkpoint_id": "CP-20260902-fixture" },
      "revocation": { "action": "mark_revoked", "owner": "fixture" }
    }
  ]
}
'@

    $clean = Invoke-FixtureCheck
    Assert-True -Condition ($clean.ExitCode -eq 0) -Message "Expected clean fixture to pass.`n$($clean.Output)"
    Assert-True -Condition ($clean.Output -match 'PASSED:') -Message 'Clean fixture did not print a pass result.'

    Write-FixtureFile -RelativePath 'src/unsafe.ts' -Content @'
const endpoint = "http://127.0.0.1:3000";
@Post("commands/click")
click(): void {}
'@
    $unsafe = Invoke-FixtureCheck
    Assert-True -Condition ($unsafe.ExitCode -eq 1) -Message 'Expected unsafe production fixture to fail.'
    Assert-True -Condition ($unsafe.Output -match '\[runtime-address-path\]') -Message 'Unsafe fixture did not report a runtime address violation.'
    Assert-True -Condition ($unsafe.Output -match '\[forbidden-production-command\]') -Message 'Unsafe fixture did not report a forbidden command violation.'

    Remove-Item -LiteralPath (Join-Path $fixtureRoot 'src/unsafe.ts') -Force
    Write-FixtureFile -RelativePath 'package.json' -Content @'
{
  "name": "compliance-fixture",
  "private": true,
  "scripts": { "start": "service --endpoint http://192.0.2.10:4000" },
  "dependencies": { "sample-dependency": "1.2.3" }
}
'@
    $unlocked = Invoke-FixtureCheck
    Assert-True -Condition ($unlocked.ExitCode -eq 1) -Message 'Expected unlocked dependency fixture to fail.'
    Assert-True -Condition ($unlocked.Output -match '\[dependency-integrity\]') -Message 'Unlocked dependency fixture did not report dependency integrity violations.'
    Assert-True -Condition ($unlocked.Output -match "Package script 'start'") -Message 'Package script host did not report a runtime address violation.'

    Write-Host 'PASSED: static compliance checker self-tests.' -ForegroundColor Green
} finally {
    $resolvedFixture = [System.IO.Path]::GetFullPath($fixtureRoot)
    $expectedPrefix = $temporaryRoot + [System.IO.Path]::DirectorySeparatorChar
    if ($resolvedFixture.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedFixture)) {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
}

exit 0
