[CmdletBinding()]
param(
    [string]$OutputPath,
    [switch]$Check
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pnpmLockPath = Join-Path $repoRoot 'pnpm-lock.yaml'
$cargoLockPath = Join-Path $repoRoot 'apps/console/src-tauri/Cargo.lock'
$catalogPath = Join-Path $repoRoot 'docs/dependency-catalog.md'
$rootManifestPath = Join-Path $repoRoot 'package.json'
$applicationManifestPaths = @(
    (Join-Path $repoRoot 'apps/api/package.json'),
    (Join-Path $repoRoot 'apps/console/package.json')
)
$schema = 'https://cyclonedx.org/schema/bom-1.6.schema.json'

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $repoRoot 'sbom/human-ticketing-console.cdx.json'
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath = Join-Path $repoRoot $OutputPath
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if (-not $OutputPath.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'SBOM output must remain inside the project root.'
}

function Get-OrdinalSortedStrings {
    param([AllowEmptyCollection()][string[]]$Values)

    $copy = [string[]]@($Values)
    [Array]::Sort($copy, [StringComparer]::Ordinal)
    return $copy
}

function ConvertFrom-YamlScalar {
    param([Parameter(Mandatory = $true)][string]$Value)

    $trimmed = $Value.Trim()
    if ($trimmed.Length -ge 2 -and $trimmed.StartsWith("'") -and $trimmed.EndsWith("'")) {
        return $trimmed.Substring(1, $trimmed.Length - 2).Replace("''", "'")
    }
    if ($trimmed.Length -ge 2 -and $trimmed.StartsWith('"') -and $trimmed.EndsWith('"')) {
        return [string]($trimmed | ConvertFrom-Json)
    }
    return $trimmed
}

function Get-NpmIdentity {
    param([Parameter(Mandatory = $true)][string]$PackageKey)

    $delimiter = $PackageKey.LastIndexOf('@')
    if ($delimiter -le 0 -or $delimiter -eq $PackageKey.Length - 1) {
        throw "Unsupported pnpm package key: $PackageKey"
    }
    $name = $PackageKey.Substring(0, $delimiter)
    $version = $PackageKey.Substring($delimiter + 1)
    if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
        throw "Unsupported pnpm package version in key: $PackageKey"
    }
    return [pscustomobject]@{ Name = $name; Version = $version }
}

function Get-NpmPurl {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Version
    )

    if ($Name.StartsWith('@')) {
        $slash = $Name.IndexOf('/')
        if ($slash -le 1 -or $slash -eq $Name.Length - 1) {
            throw "Invalid scoped npm package name: $Name"
        }
        $group = [Uri]::EscapeDataString($Name.Substring(0, $slash))
        $packageName = [Uri]::EscapeDataString($Name.Substring($slash + 1))
        return "pkg:npm/$group/$packageName@$([Uri]::EscapeDataString($Version))"
    }
    return "pkg:npm/$([Uri]::EscapeDataString($Name))@$([Uri]::EscapeDataString($Version))"
}

function Get-CargoPurl {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Version
    )

    return "pkg:cargo/$([Uri]::EscapeDataString($Name))@$([Uri]::EscapeDataString($Version))"
}

function Add-DependencyEdge {
    param(
        [Parameter(Mandatory = $true)]$Edges,
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Target
    )

    if (-not $Edges.ContainsKey($Source)) {
        $Edges[$Source] = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    }
    [void]$Edges[$Source].Add($Target)
}

function Read-DirectMetadata {
    param([Parameter(Mandatory = $true)][string]$Path)

    $metadata = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        if ($line -notmatch '^\|\s*`(?<spec>[^`]+@\d+\.\d+\.\d+(?:-[^`]*)?)`\s*\|') {
            continue
        }
        $cells = @($line.Trim().Trim('|') -split '\s+\|\s+')
        if ($cells.Count -lt 3) {
            throw "Malformed dependency catalog row: $line"
        }
        $spec = $cells[0].Trim().Trim('`')
        $licenseMatches = [regex]::Matches(
            $cells[2],
            '(?:Apache-2\.0\s+(?:OR|AND)\s+MIT|MIT\s+(?:OR|AND)\s+Apache-2\.0|Artistic-2\.0|Apache-2\.0|MIT|ISC)'
        )
        if ($licenseMatches.Count -eq 0) {
            throw "Dependency catalog row has no supported SPDX expression: $spec"
        }
        $purpose = $cells[1].Trim()
        $license = $licenseMatches[$licenseMatches.Count - 1].Value
        if ($metadata.ContainsKey($spec)) {
            if ($metadata[$spec].License -cne $license) {
                throw "Dependency catalog has conflicting licenses for $spec."
            }
            $purposes = Get-OrdinalSortedStrings -Values @($metadata[$spec].Purpose, $purpose) | Select-Object -Unique
            $metadata[$spec] = [pscustomobject]@{ Purpose = $purposes -join '; '; License = $license }
        } else {
            $metadata[$spec] = [pscustomobject]@{ Purpose = $purpose; License = $license }
        }
    }
    return $metadata
}

function Read-PnpmLock {
    param([Parameter(Mandatory = $true)][string]$Path)

    $lines = [System.IO.File]::ReadAllLines($Path)
    if ($lines -notcontains "lockfileVersion: '9.0'") {
        throw 'Only pnpm lockfile version 9.0 is supported.'
    }
    $packagesIndex = [Array]::IndexOf($lines, 'packages:')
    $snapshotsIndex = [Array]::IndexOf($lines, 'snapshots:')
    if ($packagesIndex -lt 0 -or $snapshotsIndex -le $packagesIndex) {
        throw 'pnpm-lock.yaml has no ordered packages/snapshots sections.'
    }

    $packages = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
    $current = $null
    for ($index = $packagesIndex + 1; $index -lt $snapshotsIndex; $index++) {
        $line = $lines[$index]
        if ($line -match '^\s{2}(?<key>\S.*):\s*$' -and -not $line.StartsWith('    ')) {
            $key = ConvertFrom-YamlScalar -Value $Matches['key']
            $identity = Get-NpmIdentity -PackageKey $key
            $current = [pscustomobject]@{
                Key = $key
                Name = $identity.Name
                Version = $identity.Version
                Ref = Get-NpmPurl -Name $identity.Name -Version $identity.Version
                Integrity = $null
                Cpu = $null
                Os = $null
                Libc = $null
            }
            if ($packages.ContainsKey($key)) {
                throw "Duplicate pnpm package key: $key"
            }
            $packages.Add($key, $current)
            continue
        }
        if ($null -eq $current) {
            continue
        }
        if ($line -match '\bintegrity:\s*(?<integrity>sha(?:1|256|384|512)-[A-Za-z0-9+/=]+)') {
            $current.Integrity = $Matches['integrity']
        }
        foreach ($propertyName in @('cpu', 'os', 'libc')) {
            if ($line -match "^\s{4}$propertyName\s*:\s*\[(?<values>[^]]+)\]\s*$") {
                $values = @($Matches['values'].Split(',') | ForEach-Object { ConvertFrom-YamlScalar -Value $_ })
                $current.$propertyName = (Get-OrdinalSortedStrings -Values $values) -join ','
            }
        }
    }
    if ($packages.Count -eq 0) {
        throw 'pnpm package section is empty.'
    }

    $edges = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
    foreach ($package in $packages.Values) {
        $edges[$package.Ref] = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    }
    $keysByLength = @($packages.Keys | Sort-Object -Property @{ Expression = { $_.Length }; Descending = $true }, @{ Expression = { $_ }; Descending = $false })
    $currentRef = $null
    $dependencySection = ''
    $unresolved = [System.Collections.Generic.List[string]]::new()
    for ($index = $snapshotsIndex + 1; $index -lt $lines.Length; $index++) {
        $line = $lines[$index]
        if ($line -match '^\s{2}(?<key>\S.*):\s*$' -and -not $line.StartsWith('    ')) {
            $snapshotKey = ConvertFrom-YamlScalar -Value $Matches['key']
            $packageKey = $null
            foreach ($candidate in $keysByLength) {
                if ($snapshotKey -eq $candidate -or $snapshotKey.StartsWith("$candidate(", [StringComparison]::Ordinal)) {
                    $packageKey = $candidate
                    break
                }
            }
            if ($null -eq $packageKey) {
                throw "Snapshot has no matching package record: $snapshotKey"
            }
            $currentRef = $packages[$packageKey].Ref
            $dependencySection = ''
            continue
        }
        if ($null -eq $currentRef) {
            continue
        }
        if ($line -match '^\s{4}(?<section>dependencies|optionalDependencies):\s*$') {
            $dependencySection = $Matches['section']
            continue
        }
        if ($line -match '^\s{4}\S' -and $line -notmatch '^\s{6}') {
            $dependencySection = ''
            continue
        }
        if ($dependencySection -and $line -match '^\s{6}(?<name>.+?):\s+(?<value>\S.*?)\s*$') {
            $dependencyName = ConvertFrom-YamlScalar -Value $Matches['name']
            $resolvedValue = ConvertFrom-YamlScalar -Value $Matches['value']
            $paren = $resolvedValue.IndexOf('(')
            $dependencyVersion = if ($paren -ge 0) { $resolvedValue.Substring(0, $paren) } else { $resolvedValue }
            if ($dependencyVersion -match '^(?:file|link|workspace):') {
                continue
            }
            $dependencyKey = "$dependencyName@$dependencyVersion"
            if (-not $packages.ContainsKey($dependencyKey)) {
                $unresolved.Add("$currentRef -> $dependencyKey")
                continue
            }
            Add-DependencyEdge -Edges $edges -Source $currentRef -Target $packages[$dependencyKey].Ref
        }
    }
    if ($unresolved.Count -gt 0) {
        throw "Unresolved pnpm snapshot dependencies:`n$($unresolved -join "`n")"
    }

    return [pscustomobject]@{ Packages = $packages; Edges = $edges }
}

function Read-CargoLock {
    param([Parameter(Mandatory = $true)][string]$Path)

    $lines = [System.IO.File]::ReadAllLines($Path)
    if ($lines -notcontains 'version = 4') {
        throw 'Only Cargo lockfile version 4 is supported.'
    }

    $packages = [System.Collections.Generic.List[object]]::new()
    $current = $null
    $inDependencies = $false
    foreach ($line in $lines) {
        if ($line -eq '[[package]]') {
            if ($null -ne $current) {
                $packages.Add($current)
            }
            $current = [pscustomobject]@{
                Name = $null
                Version = $null
                Source = $null
                Checksum = $null
                Dependencies = [System.Collections.Generic.List[string]]::new()
                Ref = $null
            }
            $inDependencies = $false
            continue
        }
        if ($null -eq $current) {
            continue
        }
        if ($inDependencies) {
            if ($line.Trim() -eq ']') {
                $inDependencies = $false
                continue
            }
            $dependencyLine = $line.Trim().TrimEnd(',')
            if ($dependencyLine) {
                $current.Dependencies.Add([string]($dependencyLine | ConvertFrom-Json))
            }
            continue
        }
        if ($line -eq 'dependencies = [') {
            $inDependencies = $true
            continue
        }
        if ($line -match '^(?<field>name|version|source|checksum) = (?<value>".*")$') {
            $value = [string]($Matches['value'] | ConvertFrom-Json)
            switch ($Matches['field']) {
                'name' { $current.Name = $value }
                'version' { $current.Version = $value }
                'source' { $current.Source = $value }
                'checksum' { $current.Checksum = $value }
            }
        }
    }
    if ($null -ne $current) {
        $packages.Add($current)
    }
    if ($packages.Count -eq 0) {
        throw 'Cargo package list is empty.'
    }

    $byRef = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
    $byName = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
    foreach ($package in $packages) {
        if (-not $package.Name -or -not $package.Version) {
            throw 'Cargo package record has no name or version.'
        }
        $package.Ref = Get-CargoPurl -Name $package.Name -Version $package.Version
        if ($byRef.ContainsKey($package.Ref)) {
            throw "Cargo packages have a duplicate Package URL: $($package.Ref)"
        }
        $byRef[$package.Ref] = $package
        if (-not $byName.ContainsKey($package.Name)) {
            $byName[$package.Name] = [System.Collections.Generic.List[object]]::new()
        }
        $byName[$package.Name].Add($package)
    }

    $edges = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
    foreach ($package in $packages) {
        $edges[$package.Ref] = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($dependency in $package.Dependencies) {
            $name = $dependency
            $version = $null
            if ($dependency -match '^(?<name>.+?) (?<version>\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?: \(.+\))?$') {
                $name = $Matches['name']
                $version = $Matches['version']
            }
            if (-not $byName.ContainsKey($name)) {
                throw "Cargo dependency has no package record: $($package.Ref) -> $dependency"
            }
            $candidates = @($byName[$name])
            if ($version) {
                $candidates = @($candidates | Where-Object { $_.Version -eq $version })
            }
            if ($candidates.Count -ne 1) {
                throw "Cargo dependency is ambiguous: $($package.Ref) -> $dependency"
            }
            Add-DependencyEdge -Edges $edges -Source $package.Ref -Target $candidates[0].Ref
        }
    }

    return [pscustomobject]@{ Packages = $packages; ByRef = $byRef; Edges = $edges }
}

function Convert-SriToHash {
    param([Parameter(Mandatory = $true)][string]$Integrity)

    if ($Integrity -notmatch '^(?<algorithm>sha(?:1|256|384|512))-(?<content>[A-Za-z0-9+/=]+)$') {
        throw "Unsupported SRI value: $Integrity"
    }
    $algorithm = switch ($Matches['algorithm']) {
        'sha1' { 'SHA-1' }
        'sha256' { 'SHA-256' }
        'sha384' { 'SHA-384' }
        'sha512' { 'SHA-512' }
    }
    $bytes = [Convert]::FromBase64String($Matches['content'])
    $content = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    return [ordered]@{ alg = $algorithm; content = $content }
}

function New-ComponentProperties {
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Values)

    $result = [System.Collections.Generic.List[object]]::new()
    foreach ($name in (Get-OrdinalSortedStrings -Values @($Values.Keys))) {
        if ($null -ne $Values[$name] -and -not [string]::IsNullOrWhiteSpace([string]$Values[$name])) {
            $result.Add([ordered]@{ name = $name; value = [string]$Values[$name] })
        }
    }
    return ,$result.ToArray()
}

function New-ApplicationComponent {
    param(
        [Parameter(Mandatory = $true)][object]$Manifest,
        [Parameter(Mandatory = $true)][string]$ManifestPath
    )

    $ref = Get-NpmPurl -Name $Manifest.name -Version $Manifest.version
    $component = [ordered]@{
        type = 'application'
        'bom-ref' = $ref
    }
    if ($Manifest.name.StartsWith('@')) {
        $slash = $Manifest.name.IndexOf('/')
        $component.group = $Manifest.name.Substring(0, $slash)
        $component.name = $Manifest.name.Substring($slash + 1)
    } else {
        $component.name = $Manifest.name
    }
    $component.version = $Manifest.version
    $component.purl = $ref
    if ($Manifest.description) {
        $component.description = $Manifest.description
    }
    if ($Manifest.license) {
        $component.licenses = @([ordered]@{ license = [ordered]@{ name = [string]$Manifest.license } })
    }
    $component.properties = New-ComponentProperties -Values ([ordered]@{
        'ticketing-console:manifest' = $ManifestPath
        'ticketing-console:workspace' = 'true'
    })
    return $component
}

$directMetadata = Read-DirectMetadata -Path $catalogPath
$pnpm = Read-PnpmLock -Path $pnpmLockPath
$cargo = Read-CargoLock -Path $cargoLockPath
$rootManifest = Get-Content -Raw -LiteralPath $rootManifestPath | ConvertFrom-Json

$componentByRef = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
$allEdges = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
$directScopes = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)

foreach ($entry in $pnpm.Edges.GetEnumerator()) {
    $allEdges[$entry.Key] = $entry.Value
}
foreach ($entry in $cargo.Edges.GetEnumerator()) {
    $allEdges[$entry.Key] = $entry.Value
}

$applicationRefs = [System.Collections.Generic.List[string]]::new()
foreach ($manifestFile in $applicationManifestPaths) {
    $manifest = Get-Content -Raw -LiteralPath $manifestFile | ConvertFrom-Json
    $relativeManifest = [System.IO.Path]::GetRelativePath($repoRoot, $manifestFile).Replace('\', '/')
    $applicationComponent = New-ApplicationComponent -Manifest $manifest -ManifestPath $relativeManifest
    $applicationRef = $applicationComponent['bom-ref']
    $componentByRef[$applicationRef] = $applicationComponent
    $applicationRefs.Add($applicationRef)
    if (-not $allEdges.ContainsKey($applicationRef)) {
        $allEdges[$applicationRef] = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    }
    foreach ($sectionName in @('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies')) {
        $sectionProperty = $manifest.PSObject.Properties[$sectionName]
        if ($null -eq $sectionProperty -or $null -eq $sectionProperty.Value) {
            continue
        }
        foreach ($dependency in $sectionProperty.Value.PSObject.Properties) {
            $packageKey = "$($dependency.Name)@$($dependency.Value)"
            if (-not $pnpm.Packages.ContainsKey($packageKey)) {
                throw "Direct dependency is absent from pnpm package records: $relativeManifest -> $packageKey"
            }
            $dependencyRef = $pnpm.Packages[$packageKey].Ref
            Add-DependencyEdge -Edges $allEdges -Source $applicationRef -Target $dependencyRef
            if (-not $directScopes.ContainsKey($dependencyRef)) {
                $directScopes[$dependencyRef] = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            }
            [void]$directScopes[$dependencyRef].Add("${relativeManifest}:$sectionName")
            if (-not $directMetadata.ContainsKey($packageKey)) {
                throw "Direct dependency metadata is absent from docs/dependency-catalog.md: $packageKey"
            }
        }
    }
}

$cargoWorkspacePackages = @($cargo.Packages | Where-Object { -not $_.Source })
if ($cargoWorkspacePackages.Count -ne 1) {
    throw "Expected one Cargo workspace package, found $($cargoWorkspacePackages.Count)."
}
$cargoApplication = $cargoWorkspacePackages[0]
$consoleManifest = Get-Content -Raw -LiteralPath $applicationManifestPaths[1] | ConvertFrom-Json
$consoleRef = Get-NpmPurl -Name $consoleManifest.name -Version $consoleManifest.version
Add-DependencyEdge -Edges $allEdges -Source $consoleRef -Target $cargoApplication.Ref

foreach ($package in $pnpm.Packages.Values) {
    $component = [ordered]@{
        type = 'library'
        'bom-ref' = $package.Ref
    }
    if ($package.Name.StartsWith('@')) {
        $slash = $package.Name.IndexOf('/')
        $component.group = $package.Name.Substring(0, $slash)
        $component.name = $package.Name.Substring($slash + 1)
    } else {
        $component.name = $package.Name
    }
    $component.version = $package.Version
    $component.purl = $package.Ref
    if ($package.Integrity) {
        $component.hashes = @(Convert-SriToHash -Integrity $package.Integrity)
    }
    $spec = "$($package.Name)@$($package.Version)"
    $propertyValues = [ordered]@{
        'ticketing-console:ecosystem' = 'pnpm'
        'ticketing-console:source-lockfile' = 'pnpm-lock.yaml'
        'ticketing-console:resolution-integrity' = $package.Integrity
        'ticketing-console:target-cpu' = $package.Cpu
        'ticketing-console:target-os' = $package.Os
        'ticketing-console:target-libc' = $package.Libc
    }
    if ($directScopes.ContainsKey($package.Ref)) {
        $propertyValues['ticketing-console:direct-scopes'] = (Get-OrdinalSortedStrings -Values @($directScopes[$package.Ref])) -join ','
        $propertyValues['ticketing-console:purpose'] = $directMetadata[$spec].Purpose
        $component.licenses = @([ordered]@{ expression = $directMetadata[$spec].License })
    } else {
        $propertyValues['ticketing-console:license-status'] = 'unresolved-transitive'
    }
    $component.properties = New-ComponentProperties -Values $propertyValues
    $componentByRef[$package.Ref] = $component
}

foreach ($package in $cargo.Packages) {
    $isWorkspace = -not $package.Source
    $component = [ordered]@{
        type = if ($isWorkspace) { 'application' } else { 'library' }
        'bom-ref' = $package.Ref
        name = $package.Name
        version = $package.Version
        purl = $package.Ref
    }
    if ($package.Checksum) {
        $component.hashes = @([ordered]@{ alg = 'SHA-256'; content = $package.Checksum.ToLowerInvariant() })
    }
    $propertyValues = [ordered]@{
        'ticketing-console:ecosystem' = 'cargo'
        'ticketing-console:source-lockfile' = 'apps/console/src-tauri/Cargo.lock'
        'ticketing-console:cargo-source' = if ($isWorkspace) { 'workspace' } else { 'crates.io-registry' }
    }
    $spec = "$($package.Name)@$($package.Version)"
    if ($directMetadata.ContainsKey($spec)) {
        $propertyValues['ticketing-console:direct-scopes'] = 'apps/console/src-tauri/Cargo.toml'
        $propertyValues['ticketing-console:purpose'] = $directMetadata[$spec].Purpose
        $component.licenses = @([ordered]@{ expression = $directMetadata[$spec].License })
    } elseif ($isWorkspace) {
        $component.licenses = @([ordered]@{ license = [ordered]@{ name = 'UNLICENSED' } })
    } else {
        $propertyValues['ticketing-console:license-status'] = 'unresolved-transitive'
    }
    $component.properties = New-ComponentProperties -Values $propertyValues
    $componentByRef[$package.Ref] = $component
}

$rootRef = Get-NpmPurl -Name $rootManifest.name -Version $rootManifest.version
$rootComponent = [ordered]@{
    type = 'application'
    'bom-ref' = $rootRef
    name = $rootManifest.name
    version = $rootManifest.version
    purl = $rootRef
    description = $rootManifest.description
    properties = New-ComponentProperties -Values ([ordered]@{
        'ticketing-console:manifest' = 'package.json'
        'ticketing-console:workspace-root' = 'true'
    })
}
$allEdges[$rootRef] = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($applicationRef in $applicationRefs) {
    Add-DependencyEdge -Edges $allEdges -Source $rootRef -Target $applicationRef
}

$allRefs = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
[void]$allRefs.Add($rootRef)
foreach ($ref in $componentByRef.Keys) {
    [void]$allRefs.Add($ref)
    if (-not $allEdges.ContainsKey($ref)) {
        $allEdges[$ref] = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    }
}
foreach ($entry in $allEdges.GetEnumerator()) {
    if (-not $allRefs.Contains($entry.Key)) {
        throw "Dependency graph source is absent from components: $($entry.Key)"
    }
    foreach ($target in $entry.Value) {
        if (-not $allRefs.Contains($target)) {
            throw "Dependency graph target is absent from components: $($entry.Key) -> $target"
        }
    }
}

$components = [System.Collections.Generic.List[object]]::new()
foreach ($ref in (Get-OrdinalSortedStrings -Values @($componentByRef.Keys))) {
    $components.Add($componentByRef[$ref])
}
$dependencies = [System.Collections.Generic.List[object]]::new()
foreach ($ref in (Get-OrdinalSortedStrings -Values @($allEdges.Keys))) {
    $dependencies.Add([ordered]@{
        ref = $ref
        dependsOn = @(Get-OrdinalSortedStrings -Values @($allEdges[$ref]))
    })
}

$pnpmLockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $pnpmLockPath).Hash.ToLowerInvariant()
$cargoLockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $cargoLockPath).Hash.ToLowerInvariant()
$bom = [ordered]@{
    '$schema' = $schema
    bomFormat = 'CycloneDX'
    specVersion = '1.6'
    version = 1
    metadata = [ordered]@{
        component = $rootComponent
        properties = New-ComponentProperties -Values ([ordered]@{
            'ticketing-console:bom-kind' = 'development-and-build'
            'ticketing-console:cargo-lock-sha256' = $cargoLockHash
            'ticketing-console:generator' = 'scripts/generate-sbom.ps1@1'
            'ticketing-console:pnpm-lock-sha256' = $pnpmLockHash
            'ticketing-console:timestamp-policy' = 'omitted-for-determinism'
            'ticketing-console:transitive-license-status' = 'unresolved'
        })
    }
    components = $components.ToArray()
    dependencies = $dependencies.ToArray()
}

$json = ($bom | ConvertTo-Json -Depth 100).Replace("`r`n", "`n") + "`n"
if ($Check) {
    if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) {
        throw "SBOM does not exist: $OutputPath"
    }
    $existing = [System.IO.File]::ReadAllText($OutputPath).Replace("`r`n", "`n")
    if ($existing -cne $json) {
        throw "SBOM is stale: $OutputPath"
    }
    Write-Host "SBOM is current: $OutputPath"
    exit 0
}

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}
[System.IO.File]::WriteAllText($OutputPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "Generated CycloneDX SBOM: $OutputPath"
Write-Host "Components: $($components.Count); dependency nodes: $($dependencies.Count)"
