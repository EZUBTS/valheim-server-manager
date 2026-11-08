#requires -Version 5.1
<#
.SYNOPSIS
    Builds the drag-and-drop client mods ZIP for friends (thin wrapper).

.DESCRIPTION
    Calls scripts/install-client-mods.ps1 in -BuildZip mode. The resulting ZIP
    contains BepInEx, Server Devcommands, Jotunn, AdminHammer and ValheimCheats
    plus the Russian installation instructions, and its contents are extracted
    directly into the Valheim game folder.

.PARAMETER OutputPath
    Target ZIP path. Default: client-mods/Valheim-Client-Mods-DragAndDrop.zip.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\build-client-mods-zip.ps1
#>
[CmdletBinding()]
param(
    [string]$OutputPath,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputPath) {
    $OutputPath = Join-Path $repoRoot 'client-mods\Valheim-Client-Mods-DragAndDrop.zip'
}

$installer = Join-Path $PSScriptRoot 'install-client-mods.ps1'
$parameters = @{ BuildZip = $OutputPath }
if ($Force) {
    $parameters['Force'] = $true
}

& $installer @parameters
