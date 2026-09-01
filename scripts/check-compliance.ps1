<#
.SYNOPSIS
Runs repository-local static compliance checks without installing dependencies.

.DESCRIPTION
The checker inspects project source, runtime configuration templates, and dependency
manifests. It deliberately excludes documentation content, tool caches, installed
dependencies, test/build output, and generated artifacts.

Checks:
  1. Production source/config contains no fixed HTTP/WS deployment host, IP address,
     loopback host, Windows/UNC absolute path, or common Unix absolute runtime path.
     The versioned bind-address schema and its runtime validator have a narrow,
     explicitly marked exemption for loopback policy constants.
  2. Production source exposes no forbidden click/tap/input/purchase/captcha/pay/
     order/broadcast route, command path, message handler, method, or ADB input call.
  3. Node and Rust manifests have repository lockfiles, exact direct versions, and
     direct dependency entries in docs/dependency-catalog.md.
  4. JSON and .env runtime configuration templates use ${ENV_NAME} placeholders
     for every value except schema_version.

Schema identifiers and toolchain download provenance are protocol/build metadata,
not runtime deployment addresses, and are exempt from the host check. Negative
tests are exempt from production route/method checks.
#>
[CmdletBinding()]
param(
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedRoot = Resolve-Path -LiteralPath $ProjectRoot -ErrorAction Stop
$repoRoot = [System.IO.Path]::GetFullPath($resolvedRoot.Path).TrimEnd([char[]]@('\', '/'))
$selfPath = [System.IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)
$placeholderPattern = '^\$\{[A-Z][A-Z0-9_]*\}$'
$forbiddenTermPattern = '(?:click|tap|input|purchase|captcha|pay(?:ment)?|order|broadcast)'
$forbiddenMethodTokens = @('click', 'tap', 'input', 'purchase', 'captcha', 'pay', 'payment', 'order', 'broadcast')
$excludedDirectories = @(
    '.git', '.tools', '.runtime', '.turbo', '.next',
    'node_modules', 'dist', 'build', 'out', 'target', 'coverage'
)
$sourceExtensions = @(
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs',
    '.ps1', '.psm1', '.sh', '.cmd', '.bat', '.json', '.jsonc',
    '.toml', '.yaml', '.yml', '.env'
)

$violations = New-Object 'System.Collections.Generic.List[object]'
$violationKeys = New-Object 'System.Collections.Generic.HashSet[string]'
$counts = [ordered]@{
    'runtime-address-path-files' = 0
    'production-command-files' = 0
    'node-manifests' = 0
    'rust-manifests' = 0
    'config-templates' = 0
}

function Get-ProjectRelativePath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if ($fullPath.Equals($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return '.'
    }
    if (-not $fullPath.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside project root: $fullPath"
    }
    return $fullPath.Substring($repoRoot.Length + 1).Replace('\', '/')
}

function Add-Violation {
    param(
        [Parameter(Mandatory = $true)][string]$Category,
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$Line = 0,
        [Parameter(Mandatory = $true)][string]$Message,
        [string]$Evidence = ''
    )

    $relativePath = if ([System.IO.Path]::IsPathRooted($Path)) { Get-ProjectRelativePath -Path $Path } else { $Path.Replace('\', '/') }
    $key = "$Category|$relativePath|$Line|$Message"
    if ($violationKeys.Add($key)) {
        $violations.Add([pscustomobject]@{
            Category = $Category
            Path = $relativePath
            Line = $Line
            Message = $Message
            Evidence = $Evidence.Trim()
        })
    }
}

function Test-IsExcludedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $relative = Get-ProjectRelativePath -Path $Path
    if ($relative -match '(?i)^apps/console/src-tauri/gen/') {
        return $true
    }
    $parts = $relative -split '[/\\]'
    foreach ($part in $parts) {
        if ($excludedDirectories -contains $part) {
            return $true
        }
    }
    return $false
}

function Test-IsNonProductionPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $relative = Get-ProjectRelativePath -Path $Path
    return (
        $relative -match '(?i)(^|/)(test|tests|__tests__|fixtures?)(/|$)' -or
        $relative -match '(?i)\.(spec|test)\.[^.]+$' -or
        $relative -match '(?i)(^|/)apps/mock-app(/|$)'
    )
}

function Test-IsSchemaIdentifierLine {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Line)

    if ($Line -match '^\s*"\$(?:schema|id)"\s*:') {
        return $true
    }
    if ($Line -match '^\s*"jsonSchemaDialect"\s*:\s*"https://json-schema\.org/draft/2020-12/schema"\s*,?\s*$') {
        return $true
    }
    return ($Line -match '(?i)\bschema\s*[:=]' -and $Line -match '(?i)https?://[^/]+/schemas?[/]')
}

function Test-IsLoopbackBindPolicyConstantLine {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Line
    )

    if ($Line -notmatch 'compliance:\s*loopback-bind-policy-constant') {
        return $false
    }
    $relative = Get-ProjectRelativePath -Path $Path
    return (
        (
            $relative -eq 'apps/api/src/config/runtime-config.ts' -and
            $Line -match "\bIPV6_LOOPBACK_BIND_HOST\s*=\s*'::1'"
        ) -or
        ($relative -eq 'config/config.schema.json' -and $Line -match '"const"\s*:\s*"::1"')
    )
}

function Get-TextLines {
    param([Parameter(Mandatory = $true)][string]$Path)

    $content = Get-Content -Raw -LiteralPath $Path
    return ,($content -split "`r?`n")
}

function Test-HardcodedRuntimeValues {
    param([Parameter(Mandatory = $true)][System.IO.FileInfo]$File)

    if (Test-IsNonProductionPath -Path $File.FullName) {
        return
    }

    $counts['runtime-address-path-files']++
    $relative = Get-ProjectRelativePath -Path $File.FullName
    $isGeneratedLock = $File.Name -in @('pnpm-lock.yaml', 'Cargo.lock')
    $isDependencyProvenance = $relative -eq 'config/toolchain.lock.json'
    $isPackageManifest = $File.Name -in @('package.json', 'Cargo.toml')
    $lines = Get-TextLines -Path $File.FullName

    for ($index = 0; $index -lt $lines.Count; $index++) {
        $line = $lines[$index]
        $lineNumber = $index + 1

        if (-not $isGeneratedLock -and $line -match '(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/]') {
            Add-Violation -Category 'runtime-address-path' -Path $File.FullName -Line $lineNumber -Message 'Hardcoded Windows absolute path.' -Evidence $line
        }
        $hasRawUncPath = $line -match '(?<![\\])\\\\[A-Za-z0-9][A-Za-z0-9._-]*\\[A-Za-z0-9$._-]+'
        $hasEscapedUncPath = $line -match '(?<![\\])\\\\\\\\[A-Za-z0-9][A-Za-z0-9._-]*\\\\[A-Za-z0-9$._-]+'
        if (-not $isGeneratedLock -and ($hasRawUncPath -or $hasEscapedUncPath)) {
            Add-Violation -Category 'runtime-address-path' -Path $File.FullName -Line $lineNumber -Message 'Hardcoded UNC absolute path.' -Evidence $line
        }
        if (-not $isGeneratedLock -and $line -match '(?<![A-Za-z0-9_.-])/(?:home|Users|var|tmp|opt|usr|etc|srv|data|mnt|Volumes)(?:/|\\)') {
            Add-Violation -Category 'runtime-address-path' -Path $File.FullName -Line $lineNumber -Message 'Hardcoded Unix absolute runtime path.' -Evidence $line
        }

        if (
            $isGeneratedLock -or
            $isDependencyProvenance -or
            $isPackageManifest -or
            (Test-IsSchemaIdentifierLine -Line $line) -or
            (Test-IsLoopbackBindPolicyConstantLine -Path $File.FullName -Line $line)
        ) {
            continue
        }

        $urlMatches = [regex]::Matches($line, '(?i)\b(?:https?|wss?)://(?:\[[^\]]+\]|[A-Za-z0-9.-]+)(?::(?:\d+|\*))?')
        if ($urlMatches.Count -gt 0) {
            $urls = ($urlMatches | ForEach-Object { $_.Value } | Select-Object -Unique) -join ', '
            Add-Violation -Category 'runtime-address-path' -Path $File.FullName -Line $lineNumber -Message "Hardcoded HTTP/WS runtime host: $urls" -Evidence $line
            continue
        }

        if ($line -match '(?i)(?<![A-Za-z0-9.-])(?:localhost|0\.0\.0\.0|127\.0\.0\.1|\[?::1\]?)(?![A-Za-z0-9.-])') {
            Add-Violation -Category 'runtime-address-path' -Path $File.FullName -Line $lineNumber -Message 'Hardcoded loopback or wildcard host.' -Evidence $line
            continue
        }

        $hostAssignment = [regex]::Match($line, '(?i)\b(?:bind[_-]?host|host(?:name)?|origin|endpoint|base[_-]?url|api[_-]?url|ws[_-]?url)\b\s*(?::|(?<![=!<>])=(?!=))\s*[''"](?<value>[^''"]+)[''"]')
        if ($hostAssignment.Success -and $hostAssignment.Groups['value'].Value -notmatch $placeholderPattern) {
            Add-Violation -Category 'runtime-address-path' -Path $File.FullName -Line $lineNumber -Message "Hardcoded runtime host/origin value: $($hostAssignment.Groups['value'].Value)" -Evidence $line
            continue
        }

        $ipv4Matches = [regex]::Matches($line, '(?<![A-Za-z0-9.])(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(?:\.(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})){3}(?![A-Za-z0-9.])')
        if ($ipv4Matches.Count -gt 0) {
            Add-Violation -Category 'runtime-address-path' -Path $File.FullName -Line $lineNumber -Message "Hardcoded IPv4 address: $($ipv4Matches[0].Value)" -Evidence $line
        }
    }
}

function Test-ForbiddenProductionCommands {
    param([Parameter(Mandatory = $true)][System.IO.FileInfo]$File)

    if (Test-IsNonProductionPath -Path $File.FullName) {
        return
    }

    $counts['production-command-files']++
    $lines = Get-TextLines -Path $File.FullName
    $routeDecoratorPattern = '(?i)@(?:Controller|Get|Post|Put|Patch|Delete|Options|Head|All|SubscribeMessage)\s*\(\s*[''"](?<route>[^''"]+)[''"]'
    $forbiddenRouteSegmentPattern = "(?i)(?:^|[/_.:-])$forbiddenTermPattern(?:$|[/_.:-])"
    $commandPathPattern = "(?i)[/\\](?:commands?|actions?|intents?|operations?)[/\\]$forbiddenTermPattern\b"
    $typescriptMethodPattern = '(?i)^\s*(?:(?:export|default|public|private|protected|static|async|readonly|override|abstract|declare)\s+)*(?:function\s+)?(?<method>[A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>\r\n]+>)?\s*\('
    $rustMethodPattern = '(?i)^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(?<method>[A-Za-z_][A-Za-z0-9_]*)\s*\('
    $powerShellMethodPattern = '(?i)^\s*function\s+(?<method>[A-Za-z_][A-Za-z0-9_-]*)\b'
    $adbInputPattern = '(?i)\b(?:adb(?:\.exe)?\s+[^\r\n]{0,160}\bshell\s+)?input\s+(?:tap|text|keyevent|swipe)\b'

    for ($index = 0; $index -lt $lines.Count; $index++) {
        $line = $lines[$index]
        $lineNumber = $index + 1

        $decorator = [regex]::Match($line, $routeDecoratorPattern)
        if ($decorator.Success -and $decorator.Groups['route'].Value -match $forbiddenRouteSegmentPattern) {
            Add-Violation -Category 'forbidden-production-command' -Path $File.FullName -Line $lineNumber -Message "Forbidden production route/message: $($decorator.Groups['route'].Value)" -Evidence $line
        }
        if ($line -match $commandPathPattern) {
            Add-Violation -Category 'forbidden-production-command' -Path $File.FullName -Line $lineNumber -Message 'Forbidden production command/action path.' -Evidence $line
        }

        $method = [regex]::Match($line, $typescriptMethodPattern)
        if (-not $method.Success) {
            $method = [regex]::Match($line, $rustMethodPattern)
        }
        if (-not $method.Success) {
            $method = [regex]::Match($line, $powerShellMethodPattern)
        }
        if ($method.Success -and (Test-IsForbiddenMethodName -Name $method.Groups['method'].Value)) {
            Add-Violation -Category 'forbidden-production-command' -Path $File.FullName -Line $lineNumber -Message "Forbidden production command method: $($method.Groups['method'].Value)" -Evidence $line
        }

        if ($line -match $adbInputPattern) {
            Add-Violation -Category 'forbidden-production-command' -Path $File.FullName -Line $lineNumber -Message 'Forbidden device input command.' -Evidence $line
        }
    }
}

function Test-IsForbiddenMethodName {
    param([Parameter(Mandatory = $true)][string]$Name)

    $tokenized = $Name -creplace '([a-z0-9])([A-Z])', '$1_$2'
    $tokens = $tokenized.ToLowerInvariant() -split '[^a-z0-9]+'
    foreach ($token in $tokens) {
        if ($forbiddenMethodTokens -contains $token) {
            return $true
        }
    }
    return $false
}

function Test-ExactNodeVersion {
    param([Parameter(Mandatory = $true)][string]$Version)

    return (
        $Version -match '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or
        $Version -match '^workspace:(?:\d+\.\d+\.\d+|[~^])$' -or
        $Version -match '^(?:file|link):\.\.?[/\\][^*]+$'
    )
}

function Test-NodeDependencies {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.IO.FileInfo[]]$PackageFiles,
        [string]$CatalogContent
    )

    if ($PackageFiles.Count -eq 0) {
        return
    }

    $workspacePath = Join-Path $repoRoot 'pnpm-workspace.yaml'
    $lockPath = Join-Path $repoRoot 'pnpm-lock.yaml'
    if (-not (Test-Path -LiteralPath $workspacePath -PathType Leaf)) {
        Add-Violation -Category 'dependency-integrity' -Path 'pnpm-workspace.yaml' -Message 'Node manifests exist but pnpm-workspace.yaml is missing.'
    }
    if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
        Add-Violation -Category 'dependency-integrity' -Path 'pnpm-lock.yaml' -Message 'Node manifests exist but pnpm-lock.yaml is missing.'
    }
    $lockContent = if (Test-Path -LiteralPath $lockPath -PathType Leaf) { Get-Content -Raw -LiteralPath $lockPath } else { '' }

    foreach ($packageFile in $PackageFiles) {
        $counts['node-manifests']++
        try {
            $manifest = Get-Content -Raw -LiteralPath $packageFile.FullName | ConvertFrom-Json
        } catch {
            Add-Violation -Category 'dependency-integrity' -Path $packageFile.FullName -Message "Invalid package.json: $($_.Exception.Message)"
            continue
        }

        $scriptsProperty = $manifest.PSObject.Properties['scripts']
        if ($null -ne $scriptsProperty -and $null -ne $scriptsProperty.Value) {
            foreach ($scriptProperty in $scriptsProperty.Value.PSObject.Properties) {
                $scriptCommand = [string]$scriptProperty.Value
                $hasFixedUrl = $scriptCommand -match '(?i)\b(?:https?|wss?)://(?:\[[^\]]+\]|[A-Za-z0-9.-]+)(?::(?:\d+|\*))?'
                $hasFixedLoopback = $scriptCommand -match '(?i)(?<![A-Za-z0-9.-])(?:localhost|0\.0\.0\.0|127\.0\.0\.1|\[?::1\]?)(?![A-Za-z0-9.-])'
                $hasFixedIpv4 = $scriptCommand -match '(?<![A-Za-z0-9.])(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(?:\.(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})){3}(?![A-Za-z0-9.])'
                if ($hasFixedUrl -or $hasFixedLoopback -or $hasFixedIpv4) {
                    Add-Violation -Category 'runtime-address-path' -Path $packageFile.FullName -Message "Package script '$($scriptProperty.Name)' contains a hardcoded runtime host or IP." -Evidence $scriptCommand
                }
            }
        }

        foreach ($sectionName in @('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies')) {
            $section = $manifest.PSObject.Properties[$sectionName]
            if ($null -eq $section -or $null -eq $section.Value) {
                continue
            }
            foreach ($dependency in $section.Value.PSObject.Properties) {
                $name = $dependency.Name
                $version = [string]$dependency.Value
                if (-not (Test-ExactNodeVersion -Version $version)) {
                    Add-Violation -Category 'dependency-integrity' -Path $packageFile.FullName -Message "Dependency '$name' is not pinned to an exact or project-local version: $version"
                }
                if ($lockContent -and $lockContent -notmatch [regex]::Escape($name)) {
                    Add-Violation -Category 'dependency-integrity' -Path $packageFile.FullName -Message "Dependency '$name' is absent from pnpm-lock.yaml."
                }
                $exactVersion = $version -replace '^workspace:', ''
                if ($lockContent -and $version -match '^\d+\.\d+\.\d+' -and $lockContent -notmatch [regex]::Escape($exactVersion)) {
                    Add-Violation -Category 'dependency-integrity' -Path $packageFile.FullName -Message "Dependency '$name@$version' version is absent from pnpm-lock.yaml."
                }
                if (-not $CatalogContent -or $CatalogContent -notmatch [regex]::Escape($name)) {
                    Add-Violation -Category 'dependency-integrity' -Path $packageFile.FullName -Message "Dependency '$name' is absent from docs/dependency-catalog.md."
                }
                if ($version -match '^\d+\.\d+\.\d+' -and $CatalogContent -and $CatalogContent -notmatch [regex]::Escape($version)) {
                    Add-Violation -Category 'dependency-integrity' -Path $packageFile.FullName -Message "Dependency '$name@$version' version is absent from docs/dependency-catalog.md."
                }
            }
        }
    }
}

function Get-CargoDirectDependencies {
    param([Parameter(Mandatory = $true)][string]$ManifestPath)

    $dependencies = New-Object 'System.Collections.Generic.List[object]'
    $section = ''
    $lines = Get-TextLines -Path $ManifestPath
    for ($index = 0; $index -lt $lines.Count; $index++) {
        $line = $lines[$index]
        if ($line -match '^\s*\[(?<section>[^]]+)\]\s*$') {
            $section = $Matches['section']
            continue
        }
        if ($section -notmatch '(?:^|\.)(?:build-)?dependencies$' -or $line -match '^\s*#') {
            continue
        }
        if ($line -match '^\s*(?<name>[A-Za-z0-9_-]+)\s*=\s*(?<value>.+?)\s*$') {
            $name = $Matches['name']
            $value = $Matches['value']
            $version = $null
            if ($value -match '^"(?<version>[^"]+)"') {
                $version = $Matches['version']
            } elseif ($value -match '\bversion\s*=\s*"(?<version>[^"]+)"') {
                $version = $Matches['version']
            }
            $dependencies.Add([pscustomobject]@{
                Name = $name
                Version = $version
                Line = $index + 1
                Value = $value
            })
        }
    }
    return ,$dependencies.ToArray()
}

function Find-CargoLock {
    param([Parameter(Mandatory = $true)][string]$ManifestPath)

    $directory = [System.IO.DirectoryInfo](Split-Path -Parent $ManifestPath)
    while ($null -ne $directory) {
        $candidate = Join-Path $directory.FullName 'Cargo.lock'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
        if ($directory.FullName.Equals($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            break
        }
        $directory = $directory.Parent
    }
    return $null
}

function Test-RustDependencies {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.IO.FileInfo[]]$CargoFiles,
        [string]$CatalogContent
    )

    foreach ($cargoFile in $CargoFiles) {
        $counts['rust-manifests']++
        $lockPath = Find-CargoLock -ManifestPath $cargoFile.FullName
        $lockContent = ''
        if ($null -eq $lockPath) {
            Add-Violation -Category 'dependency-integrity' -Path $cargoFile.FullName -Message 'Cargo.toml has no Cargo.lock in its directory or a project ancestor.'
        } else {
            $lockContent = Get-Content -Raw -LiteralPath $lockPath
        }

        foreach ($dependency in (Get-CargoDirectDependencies -ManifestPath $cargoFile.FullName)) {
            if ($null -ne $dependency.Version -and $dependency.Version -notmatch '^=\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
                Add-Violation -Category 'dependency-integrity' -Path $cargoFile.FullName -Line $dependency.Line -Message "Crate '$($dependency.Name)' is not pinned with an exact '=x.y.z' version: $($dependency.Version)"
            }
            if ($null -eq $dependency.Version -and $dependency.Value -notmatch '\b(?:path|workspace)\s*=') {
                Add-Violation -Category 'dependency-integrity' -Path $cargoFile.FullName -Line $dependency.Line -Message "Crate '$($dependency.Name)' has no exact version or project-local path/workspace source."
            }
            $crateNamePattern = '(?m)^name\s*=\s*"{0}"\s*$' -f [regex]::Escape($dependency.Name)
            if ($lockContent -and $lockContent -notmatch $crateNamePattern) {
                Add-Violation -Category 'dependency-integrity' -Path $cargoFile.FullName -Line $dependency.Line -Message "Crate '$($dependency.Name)' is absent from Cargo.lock."
            }
            if ($null -ne $dependency.Version) {
                $bareVersion = $dependency.Version.TrimStart('=')
                $crateVersionPattern = '(?m)^version\s*=\s*"{0}"\s*$' -f [regex]::Escape($bareVersion)
                if ($lockContent -and $lockContent -notmatch $crateVersionPattern) {
                    Add-Violation -Category 'dependency-integrity' -Path $cargoFile.FullName -Line $dependency.Line -Message "Crate '$($dependency.Name)@$bareVersion' version is absent from Cargo.lock."
                }
            }
            if (-not $CatalogContent -or $CatalogContent -notmatch [regex]::Escape($dependency.Name)) {
                Add-Violation -Category 'dependency-integrity' -Path $cargoFile.FullName -Line $dependency.Line -Message "Crate '$($dependency.Name)' is absent from docs/dependency-catalog.md."
            }
            if ($null -ne $dependency.Version) {
                $bareVersion = $dependency.Version.TrimStart('=')
                if ($CatalogContent -and $CatalogContent -notmatch [regex]::Escape($bareVersion)) {
                    Add-Violation -Category 'dependency-integrity' -Path $cargoFile.FullName -Line $dependency.Line -Message "Crate '$($dependency.Name)@$bareVersion' version is absent from docs/dependency-catalog.md."
                }
            }
        }
    }
}

function Test-ToolchainCatalog {
    param([string]$CatalogContent)

    $toolchainPath = Join-Path $repoRoot 'config/toolchain.lock.json'
    if (-not (Test-Path -LiteralPath $toolchainPath -PathType Leaf)) {
        return
    }
    try {
        $toolchain = Get-Content -Raw -LiteralPath $toolchainPath | ConvertFrom-Json
    } catch {
        Add-Violation -Category 'dependency-integrity' -Path $toolchainPath -Message "Invalid toolchain lock: $($_.Exception.Message)"
        return
    }
    foreach ($toolName in @('node', 'pnpm', 'rust')) {
        $property = $toolchain.PSObject.Properties[$toolName]
        if ($null -eq $property -or $null -eq $property.Value.version) {
            Add-Violation -Category 'dependency-integrity' -Path $toolchainPath -Message "Toolchain '$toolName' has no locked version."
            continue
        }
        $version = [string]$property.Value.version
        if (-not $CatalogContent -or $CatalogContent -notmatch "(?i)\b$([regex]::Escape($toolName))\b") {
            Add-Violation -Category 'dependency-integrity' -Path $toolchainPath -Message "Toolchain '$toolName' is absent from docs/dependency-catalog.md."
        }
        if (-not $CatalogContent -or $CatalogContent -notmatch [regex]::Escape($version)) {
            Add-Violation -Category 'dependency-integrity' -Path $toolchainPath -Message "Toolchain '$toolName@$version' version is absent from docs/dependency-catalog.md."
        }
    }
}

function Test-TemplateLeaf {
    param(
        [AllowNull()][object]$Value,
        [Parameter(Mandatory = $true)][string]$JsonPath,
        [Parameter(Mandatory = $true)][string]$FilePath
    )

    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        foreach ($property in $Value.PSObject.Properties) {
            $childPath = if ($JsonPath -eq '$') { "`$.$($property.Name)" } else { "$JsonPath.$($property.Name)" }
            if ($property.Name -eq 'schema_version') {
                if ($property.Value -isnot [string] -or $property.Value -notmatch '^[a-z][a-z0-9-]*\.v[1-9][0-9]*$') {
                    Add-Violation -Category 'config-template' -Path $FilePath -Message "Template $childPath must contain a versioned schema identifier."
                }
                continue
            }
            Test-TemplateLeaf -Value $property.Value -JsonPath $childPath -FilePath $FilePath
        }
        return
    }

    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        $itemIndex = 0
        foreach ($item in $Value) {
            Test-TemplateLeaf -Value $item -JsonPath "$JsonPath[$itemIndex]" -FilePath $FilePath
            $itemIndex++
        }
        return
    }

    if ($Value -isnot [string] -or $Value -notmatch $placeholderPattern) {
        $display = if ($null -eq $Value) { '<null>' } else { [string]$Value }
        Add-Violation -Category 'config-template' -Path $FilePath -Message "Template value $JsonPath must be an environment placeholder; found '$display'."
    }
}

function Test-ConfigTemplates {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][System.IO.FileInfo[]]$TemplateFiles)

    if ($TemplateFiles.Count -eq 0) {
        Add-Violation -Category 'config-template' -Path 'config' -Message 'No runtime configuration template was found.'
        return
    }

    foreach ($templateFile in $TemplateFiles) {
        $counts['config-templates']++
        if ($templateFile.Extension -eq '.json') {
            try {
                $template = Get-Content -Raw -LiteralPath $templateFile.FullName | ConvertFrom-Json
                Test-TemplateLeaf -Value $template -JsonPath '$' -FilePath $templateFile.FullName
            } catch {
                Add-Violation -Category 'config-template' -Path $templateFile.FullName -Message "Invalid JSON configuration template: $($_.Exception.Message)"
            }
            continue
        }

        if ($templateFile.Name -match '(?i)(?:^|\.)env(?:\.|$)' -or $templateFile.Extension -eq '.env') {
            $lines = Get-TextLines -Path $templateFile.FullName
            for ($index = 0; $index -lt $lines.Count; $index++) {
                $line = $lines[$index].Trim()
                if (-not $line -or $line.StartsWith('#')) {
                    continue
                }
                if ($line -notmatch '^[A-Z][A-Z0-9_]*\s*=\s*(?<value>.*)$') {
                    Add-Violation -Category 'config-template' -Path $templateFile.FullName -Line ($index + 1) -Message 'Invalid .env template assignment.' -Evidence $line
                    continue
                }
                if ($Matches['value'].Trim() -notmatch $placeholderPattern) {
                    Add-Violation -Category 'config-template' -Path $templateFile.FullName -Line ($index + 1) -Message '.env template value must be an environment placeholder.' -Evidence $line
                }
            }
            continue
        }

        Add-Violation -Category 'config-template' -Path $templateFile.FullName -Message 'Unsupported configuration template format; use JSON or .env for deterministic validation.'
    }
}

$allFiles = @(
    Get-ChildItem -LiteralPath $repoRoot -File -Recurse -Force |
        Where-Object { -not (Test-IsExcludedPath -Path $_.FullName) }
)

$contentFiles = @(
    $allFiles | Where-Object {
        $_.FullName -ne $selfPath -and
        ($sourceExtensions -contains $_.Extension -or $_.Name -in @('package.json', 'Cargo.toml'))
    }
)

foreach ($file in $contentFiles) {
    Test-HardcodedRuntimeValues -File $file
    Test-ForbiddenProductionCommands -File $file
}

$catalogPath = Join-Path $repoRoot 'docs/dependency-catalog.md'
$packageFiles = @($allFiles | Where-Object { $_.Name -eq 'package.json' })
$cargoFiles = @($allFiles | Where-Object { $_.Name -eq 'Cargo.toml' })
$hasDependencyManifests = $packageFiles.Count -gt 0 -or $cargoFiles.Count -gt 0 -or (Test-Path -LiteralPath (Join-Path $repoRoot 'config/toolchain.lock.json') -PathType Leaf)
$catalogContent = ''
if ($hasDependencyManifests) {
    if (-not (Test-Path -LiteralPath $catalogPath -PathType Leaf)) {
        Add-Violation -Category 'dependency-integrity' -Path 'docs/dependency-catalog.md' -Message 'Dependency manifests exist but the dependency catalog is missing.'
    } else {
        $catalogContent = Get-Content -Raw -LiteralPath $catalogPath
    }
}

Test-NodeDependencies -PackageFiles $packageFiles -CatalogContent $catalogContent
Test-RustDependencies -CargoFiles $cargoFiles -CatalogContent $catalogContent
Test-ToolchainCatalog -CatalogContent $catalogContent

$templateFiles = @(
    $allFiles | Where-Object {
        (Get-ProjectRelativePath -Path $_.FullName) -match '(?i)^config/' -and
        $_.Name -match '(?i)(?:^|[._-])(?:example|template)(?:[._-]|$)'
    }
)
Test-ConfigTemplates -TemplateFiles $templateFiles

Write-Host 'Static compliance checks:'
Write-Host "  runtime address/path files : $($counts['runtime-address-path-files'])"
Write-Host "  production command files  : $($counts['production-command-files'])"
Write-Host "  Node manifests            : $($counts['node-manifests'])"
Write-Host "  Rust manifests            : $($counts['rust-manifests'])"
Write-Host "  configuration templates   : $($counts['config-templates'])"

if ($violations.Count -gt 0) {
    Write-Host ''
    Write-Host "FAILED: $($violations.Count) compliance violation(s)." -ForegroundColor Red
    foreach ($violation in ($violations | Sort-Object Category, Path, Line, Message)) {
        $location = if ($violation.Line -gt 0) { "$($violation.Path):$($violation.Line)" } else { $violation.Path }
        Write-Host "[$($violation.Category)] $location - $($violation.Message)" -ForegroundColor Red
        if ($violation.Evidence) {
            Write-Host "  $($violation.Evidence)"
        }
    }
    exit 1
}

Write-Host ''
Write-Host 'PASSED: no static compliance violations found.' -ForegroundColor Green
exit 0
