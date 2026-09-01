[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$generator = Join-Path $repoRoot 'scripts/generate-sbom.ps1'
$engine = (Get-Process -Id $PID).Path
$runtimeRoot = Join-Path $repoRoot '.runtime'
$testRoot = Join-Path $runtimeRoot ("sbom-test-{0}" -f [guid]::NewGuid().ToString('N'))

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Get-PropertyValue {
    param(
        [Parameter(Mandatory = $true)][object[]]$Properties,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $matches = @($Properties | Where-Object { $_.name -eq $Name })
    Assert-True -Condition ($matches.Count -eq 1) -Message "Expected one property named $Name."
    return [string]$matches[0].value
}

try {
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    $first = Join-Path $testRoot 'first.cdx.json'
    $second = Join-Path $testRoot 'second.cdx.json'

    & $engine -NoProfile -File $generator -OutputPath $first
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'First SBOM generation failed.'
    & $engine -NoProfile -File $generator -OutputPath $second
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'Second SBOM generation failed.'

    $firstHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $first).Hash
    $secondHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $second).Hash
    Assert-True -Condition ($firstHash -ceq $secondHash) -Message 'SBOM output is not byte deterministic.'

    & $engine -NoProfile -File $generator -OutputPath $first -Check
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'SBOM check mode rejected current output.'

    $outsidePath = Join-Path ([System.IO.Path]::GetTempPath()) 'ticketing-console-forbidden-sbom.json'
    $outsideOutput = & $engine -NoProfile -File $generator -OutputPath $outsidePath 2>&1
    Assert-True -Condition ($LASTEXITCODE -ne 0 -and [string]$outsideOutput -match 'inside the project root') -Message 'SBOM generator did not reject an output path outside the project.'

    $bom = Get-Content -Raw -LiteralPath $first | ConvertFrom-Json
    Assert-True -Condition ($bom.'$schema' -eq 'https://cyclonedx.org/schema/bom-1.6.schema.json') -Message 'Unexpected CycloneDX schema.'
    Assert-True -Condition ($bom.bomFormat -eq 'CycloneDX' -and $bom.specVersion -eq '1.6' -and $bom.version -eq 1) -Message 'Unexpected CycloneDX envelope.'
    Assert-True -Condition ($null -eq $bom.metadata.PSObject.Properties['timestamp']) -Message 'Deterministic SBOM must omit metadata.timestamp.'
    Assert-True -Condition ($null -eq $bom.PSObject.Properties['serialNumber']) -Message 'Deterministic SBOM must omit serialNumber.'

    $pnpmLines = [System.IO.File]::ReadAllLines((Join-Path $repoRoot 'pnpm-lock.yaml'))
    $packageStart = [Array]::IndexOf($pnpmLines, 'packages:')
    $snapshotStart = [Array]::IndexOf($pnpmLines, 'snapshots:')
    $expectedNpm = @($pnpmLines[($packageStart + 1)..($snapshotStart - 1)] | Where-Object {
        $_ -match '^\s{2}\S.*:\s*$' -and -not $_.StartsWith('    ')
    }).Count
    $expectedCargo = @(Select-String -LiteralPath (Join-Path $repoRoot 'apps/console/src-tauri/Cargo.lock') -Pattern '^\[\[package\]\]$').Count
    $npmComponents = @($bom.components | Where-Object {
        @($_.properties | Where-Object {
            $_.name -eq 'ticketing-console:ecosystem' -and $_.value -eq 'pnpm'
        }).Count -eq 1
    })
    $cargoComponents = @($bom.components | Where-Object {
        @($_.properties | Where-Object {
            $_.name -eq 'ticketing-console:ecosystem' -and $_.value -eq 'cargo'
        }).Count -eq 1
    })
    Assert-True -Condition ($npmComponents.Count -eq $expectedNpm) -Message "Expected $expectedNpm pnpm components, found $($npmComponents.Count)."
    Assert-True -Condition ($cargoComponents.Count -eq $expectedCargo) -Message "Expected $expectedCargo Cargo components, found $($cargoComponents.Count)."
    Assert-True -Condition ($bom.components.Count -eq ($expectedNpm + $expectedCargo + 2)) -Message 'Workspace application component count is incorrect.'

    $refs = @($bom.components | ForEach-Object { [string]$_.'bom-ref' })
    $uniqueRefs = @($refs | Sort-Object -Unique)
    Assert-True -Condition ($refs.Count -eq $uniqueRefs.Count) -Message 'SBOM has duplicate component bom-ref values.'
    $knownRefs = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    [void]$knownRefs.Add([string]$bom.metadata.component.'bom-ref')
    foreach ($ref in $refs) { [void]$knownRefs.Add($ref) }
    foreach ($node in $bom.dependencies) {
        Assert-True -Condition $knownRefs.Contains([string]$node.ref) -Message "Unknown dependency source: $($node.ref)"
        foreach ($target in $node.dependsOn) {
            Assert-True -Condition $knownRefs.Contains([string]$target) -Message "Unknown dependency target: $target"
        }
    }

    $pnpmHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repoRoot 'pnpm-lock.yaml')).Hash.ToLowerInvariant()
    $cargoHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repoRoot 'apps/console/src-tauri/Cargo.lock')).Hash.ToLowerInvariant()
    Assert-True -Condition ((Get-PropertyValue -Properties $bom.metadata.properties -Name 'ticketing-console:pnpm-lock-sha256') -ceq $pnpmHash) -Message 'pnpm lock hash mismatch.'
    Assert-True -Condition ((Get-PropertyValue -Properties $bom.metadata.properties -Name 'ticketing-console:cargo-lock-sha256') -ceq $cargoHash) -Message 'Cargo lock hash mismatch.'

    $tauriBinary = @($bom.components | Where-Object { $_.'bom-ref' -eq 'pkg:npm/%40tauri-apps/cli-win32-x64-msvc@2.8.4' })
    Assert-True -Condition ($tauriBinary.Count -eq 1) -Message 'Windows x64 Tauri optional binary is absent.'
    Assert-True -Condition ($tauriBinary[0].hashes[0].alg -eq 'SHA-512') -Message 'Tauri optional binary has no SHA-512.'
    Assert-True -Condition ((Get-PropertyValue -Properties $tauriBinary[0].properties -Name 'ticketing-console:target-os') -eq 'win32') -Message 'Tauri optional binary OS restriction is absent.'
    Assert-True -Condition ((Get-PropertyValue -Properties $tauriBinary[0].properties -Name 'ticketing-console:target-cpu') -eq 'x64') -Message 'Tauri optional binary CPU restriction is absent.'

    foreach ($requiredRef in @(
        'pkg:cargo/tauri@2.8.5',
        'pkg:cargo/tauri-runtime@2.9.2',
        'pkg:cargo/tauri-runtime-wry@2.9.3',
        'pkg:cargo/wry@0.53.4'
    )) {
        Assert-True -Condition $knownRefs.Contains($requiredRef) -Message "Locked Tauri transitive component is absent: $requiredRef"
    }

    $directWithoutLicense = @($bom.components | Where-Object {
        $direct = @($_.properties | Where-Object { $_.name -eq 'ticketing-console:direct-scopes' })
        $licenseProperty = $_.PSObject.Properties['licenses']
        $direct.Count -gt 0 -and ($null -eq $licenseProperty -or @($licenseProperty.Value).Count -eq 0)
    })
    Assert-True -Condition ($directWithoutLicense.Count -eq 0) -Message 'A direct dependency has no catalog-derived license.'

    $unclassifiedLicense = @($bom.components | Where-Object {
        $hasLicense = $null -ne $_.PSObject.Properties['licenses'] -and @($_.licenses).Count -gt 0
        $isUnresolved = @($_.properties | Where-Object {
            $_.name -eq 'ticketing-console:license-status' -and $_.value -eq 'unresolved-transitive'
        }).Count -eq 1
        -not $hasLicense -and -not $isUnresolved
    })
    Assert-True -Condition ($unclassifiedLicense.Count -eq 0) -Message 'A component has neither a license nor an explicit unresolved status.'

    Write-Host "SBOM tests passed: $($bom.components.Count) components, $($bom.dependencies.Count) dependency nodes."
} finally {
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    $expectedPrefix = [System.IO.Path]::GetFullPath($runtimeRoot).TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    if ($resolvedTestRoot.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTestRoot)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
