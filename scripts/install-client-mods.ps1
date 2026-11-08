#requires -Version 5.1
<#
.SYNOPSIS
    Installs the in-game admin panel for Valheim (client) and optionally its
    server part, or builds a single drag-and-drop ZIP for other players.

.DESCRIPTION
    Pinned mods:
      - BepInExPack_Valheim 5.4.2360        (mod loader)
      - Server_devcommands 1.116.0          (admin console commands on servers)
      - Valheim_Admin_Tool 0.5.8            (F7 in-game admin panel: cheats, skills,
                                             items, creatures, time/weather, speeds,
                                             inventory, world & player tools, ESP)

    Default mode installs the client mods into the local Valheim folder. With
    -ServerPath the server part (Valheim Admin Tool + Server Devcommands) is
    copied into the dedicated server's BepInEx\\plugins as well, which unlocks
    the full "Tools" section (kick/ban, teleports, global time, world resets).

    With -BuildZip the mods are staged and packed into one ZIP whose contents
    are extracted directly into the Valheim game folder (friend pack).

.PARAMETER ValheimPath
    Path to the Valheim game folder (install mode). If omitted, it is found via
    the Steam registry/library folders.

.PARAMETER ServerPath
    Path to the Valheim dedicated server folder (optional). Installs the server
    part of Valheim Admin Tool + Server Devcommands into it.

.PARAMETER BuildZip
    Output ZIP path. When set, the script does not touch the local game folder:
    it builds a drag-and-drop ZIP for friends instead.

.PARAMETER DownloadDir
    Cache directory (default: %TEMP%\valheim-client-mods).

.PARAMETER Force
    Re-download all archives even if cached.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\install-client-mods.ps1 -ServerPath D:\Servers\Valheim\server
    powershell -ExecutionPolicy Bypass -File .\scripts\install-client-mods.ps1 -BuildZip .\client-mods\Valheim-Client-Mods-DragAndDrop.zip
#>
[CmdletBinding()]
param(
    [string]$ValheimPath,
    [string]$ServerPath,
    [string]$BuildZip,
    [string]$DownloadDir = (Join-Path $env:TEMP 'valheim-client-mods'),
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent $PSScriptRoot

$packages = @(
    @{
        Name = 'BepInExPack_Valheim'
        Version = '5.4.2360'
        Kind = 'bepinex'
        Url = 'https://thunderstore.io/package/download/denikson/BepInExPack_Valheim/5.4.2360/'
    },
    @{
        Name = 'Server_devcommands'
        Version = '1.116.0'
        Kind = 'plugin'
        Target = 'ServerDevcommands'
        Url = 'https://thunderstore.io/package/download/JereKuusela/Server_devcommands/1.116.0/'
    },
    @{
        Name = 'Valheim_Admin_Tool'
        Version = '0.5.8'
        Kind = 'plugin'
        Target = 'ValheimAdminTool'
        # The package also ships AntiValheimAdminTool.zip (a server-only blocker
        # for non-admins); it is not needed for the standard setup.
        Skip = @('AntiValheimAdminTool.zip')
        Url = 'https://thunderstore.io/package/download/QoLTeam/Valheim_Admin_Tool/0.5.8/'
    },
    @{
        Name = 'ValheimRuVatTranslation'
        Version = '1.0.0'
        Kind = 'local-file'
        Target = 'ValheimRuVatTranslation'
        File = 'mods\vat-russian\dist\ValheimRuVatTranslation.dll'
    }
)

$instructions = @'
КАК УСТАНОВИТЬ ВНУТРИИГРОВУЮ АДМИНКУ (Valheim, PC)
====================================================

Этот архив ставится простым копированием в папку игры — без скриптов и мод-менеджеров.
Внутри: BepInEx, Server Devcommands и Valheim Admin Tool (панель админки F7).

1. Полностью закрой Valheim.
2. Открой папку игры:
   Steam -> библиотека -> Valheim (правый клик) -> Управление -> Просмотреть локальные файлы.
   Обычно это ...\Steam\steamapps\common\Valheim
3. Распакуй СОДЕРЖИМОЕ этого архива прямо в эту папку
   (в Проводнике: "Извлечь всё..." -> выбрать папку Valheim -> "Заменить файлы: Да").
4. Запусти Valheim через Steam. Появится чёрное окно BepInEx — это нормально.
5. Зайди на сервер (нужно быть в adminlist сервера) и нажми F7 — откроется
   панель админки прямо в игре, без консоли:

   CHEATS: God Mode, Unlimited Stamina/Eitr, Fly/NoClip/FreeCam, No Build Cost,
   Build Everywhere, No Structural Damage, No Carry Limit, Infinite Jumps,
   Instant Crafting, Unrestricted Portals, Map Teleport (Shift+ЛКМ по карте),
   отключение потери вещей/еды/скиллов при смерти, корабельные читы, fun-читы.
   SKILLS: ползунки уровней всех навыков 0-100.
   TIME / WEATHER: время суток, рассвет/полдень/закат, заморозка, погода.
   SPEEDS: скорость ходьбы/бега/плавания/полёта/езды 10-300%.
   WORKBENCHES: виртуальные верстаки (открыть крафт без постройки).
   INVENTORY: размер инвентаря 1-9 рядов, максимальный вес.
   ITEMS: каталог всех предметов с поиском — выдать в инвентарь или спавнить в мире (с качеством).
   CREATURES: существа по биомам — спавн рядом с уровнем и приручением.
   TOOLS: сброс данжей/ресурсов/природы, удаление дропа, сброс террейна,
   радиус подбора, телепорт к игроку / игрока к себе (нужна серверная часть),
   кик/бан игроков (нужна серверная часть), обход вардов.
   ESP: подсветка игроков, существ, предметов, ресурсов и данжей.
   ABOUT: версия, лог игры, перезагрузка конфига.

   Интерфейс панели переведён на русский отдельным модом-переводчиком
   «Русский перевод Valheim Admin Tool» (лежит в BepInEx\plugins\ValheimRuVatTranslation).

   Горячую клавишу панели (по умолчанию F7) можно поменять в
   BepInEx\config\com.icecub.valheimadmintool.cfg (About -> Reload configuration).

ВАЖНО
-----
- Панель открывается в игре по F7. Твой SteamID должен быть в adminlist сервера:
      76561198000000000
      Steam_76561198000000000
      V_76561198000000000
  После добавления сервер нужно перезапустить.
- Часть TOOLS (кик/бан, телепорт, глобальное время, сброс дальних зон) работает
  только если Valheim Admin Tool установлен ещё и на сервер (это делает владелец).
  Без серверной части доступны читы, предметы, существа, ESP и локальные действия.
- Обычным игрокам этот архив не нужен — можно играть без модов.
- Только PC (Windows/Steam). На Xbox/PlayStation моды установить нельзя.
- Читы могут отключить достижения в вашем профиле.
- Если Steam/антивирус спросит про winhttp.dll — разреши (это загрузчик BepInEx).
- Удаление: удалить из папки игры winhttp.dll, doorstop_config.ini, .doorstop_version и папку BepInEx.
- Лог загрузки модов: <папка игры>\BepInEx\LogOutput.log

Альтернатива: r2modman -> Valheim -> установить BepInExPack_Valheim,
Server_devcommands, Valheim_Admin_Tool -> Start modded.
'@

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Find-ValheimPath {
    $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
    $libs = @()
    if ($steam) {
        $steam = $steam -replace '/', '\'
        $libs += $steam
        $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
        if (Test-Path -LiteralPath $vdf) {
            foreach ($line in Get-Content -LiteralPath $vdf) {
                if ($line -match '"path"\s+"([^"]+)"') {
                    $libs += ($matches[1] -replace '\\\\', '\')
                }
            }
        }
    }
    $libs += 'C:\Program Files (x86)\Steam'
    $libs += 'D:\Steam'
    $libs += 'D:\Games\Steam'
    foreach ($lib in ($libs | Select-Object -Unique)) {
        $candidate = Join-Path $lib 'steamapps\common\Valheim'
        if (Test-Path -LiteralPath (Join-Path $candidate 'valheim.exe')) {
            return $candidate
        }
    }
    return $null
}

function Get-ModArchive {
    param([hashtable]$Package)
    $fileName = "$($Package.Name)-$($Package.Version).zip"
    $cached = Join-Path $DownloadDir $fileName
    if ((Test-Path -LiteralPath $cached) -and (-not $Force) -and ((Get-Item -LiteralPath $cached).Length -gt 5000)) {
        Write-Step "Использую кэш: $fileName"
        return $cached
    }
    New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
    Write-Step "Скачиваю $fileName"
    Invoke-WebRequest -Uri $Package.Url -OutFile $cached -TimeoutSec 180 -MaximumRedirection 5
    if ((Get-Item -LiteralPath $cached).Length -lt 5000) {
        throw "Скачанный архив пуст: $cached"
    }
    return $cached
}

function Install-PackageArchive {
    param([hashtable]$Package, [string]$Archive, [string]$GameRoot)

    if ($Package.Kind -eq 'local-file') {
        $localPluginsRoot = Join-Path $GameRoot 'BepInEx\plugins'
        $localTarget = Join-Path $localPluginsRoot $Package.Target
        New-Item -ItemType Directory -Force -Path $localTarget | Out-Null
        $localSource = Join-Path $repoRoot $Package.File
        if (-not (Test-Path -LiteralPath $localSource)) {
            throw "Не найден файл перевода: $localSource — соберите мод mods/vat-russian (dotnet build)."
        }
        Write-Step "Устанавливаю $($Package.Name)"
        Copy-Item -LiteralPath $localSource -Destination $localTarget -Force
        return
    }

    $pluginsRoot = Join-Path $GameRoot 'BepInEx\plugins'
    $extractDir = Join-Path $DownloadDir ('extract-' + $Package.Name)
    if (Test-Path -LiteralPath $extractDir) {
        Remove-Item -LiteralPath $extractDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    [System.IO.Compression.ZipFile]::ExtractToDirectory($Archive, $extractDir)

    switch ($Package.Kind) {
        'bepinex' {
            $packRoot = Get-ChildItem -LiteralPath $extractDir -Directory |
                Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'winhttp.dll') } |
                Select-Object -First 1
            if (-not $packRoot) {
                throw 'Неожиданная структура BepInExPack_Valheim: winhttp.dll не найден.'
            }
            Write-Step 'Устанавливаю BepInEx'
            Copy-Item -Path (Join-Path $packRoot.FullName '*') -Destination $GameRoot -Recurse -Force
        }
        'plugin' {
            $target = Join-Path $pluginsRoot $Package.Target
            New-Item -ItemType Directory -Force -Path $target | Out-Null
            Write-Step "Устанавливаю $($Package.Name)"
            $skip = @()
            if ($Package.Skip) {
                $skip = $Package.Skip
            }
            Get-ChildItem -LiteralPath $extractDir | Where-Object { $skip -notcontains $_.Name } |
                ForEach-Object {
                    Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
                }
        }
        'local-file' {
            $target = Join-Path $pluginsRoot $Package.Target
            New-Item -ItemType Directory -Force -Path $target | Out-Null
            $source = Join-Path $repoRoot $Package.File
            if (-not (Test-Path -LiteralPath $source)) {
                throw "Не найден файл перевода: $source — соберите мод mods/vat-russian (dotnet build)."
            }
            Write-Step "Устанавливаю $($Package.Name)"
            Copy-Item -LiteralPath $source -Destination $target -Force
        }
        default {
            throw "Неизвестный тип пакета: $($Package.Kind)"
        }
    }
}

function Install-ServerPart {
    param([string]$ServerRoot)

    $resolved = (Resolve-Path -LiteralPath $ServerRoot).Path
    if (-not (Test-Path -LiteralPath (Join-Path $resolved 'valheim_server.exe'))) {
        throw "Это не папка выделенного сервера (нет valheim_server.exe): $resolved"
    }
    $serverPlugins = Join-Path $resolved 'BepInEx\plugins'
    foreach ($entry in @(
        @{ Package = 'Server_devcommands'; Target = 'ServerDevcommands' },
        @{ Package = 'Valheim_Admin_Tool'; Target = 'ValheimAdminTool' }
    )) {
        $package = $packages | Where-Object { $_.Name -eq $entry.Package } | Select-Object -First 1
        $extractDir = Join-Path $DownloadDir ('extract-' + $package.Name)
        if (-not (Test-Path -LiteralPath $extractDir)) {
            continue
        }
        $target = Join-Path $serverPlugins $entry.Target
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        Write-Step "Серверная часть: $($package.Name)"
        Get-ChildItem -LiteralPath $extractDir | Where-Object { $_.Name -ne 'AntiValheimAdminTool.zip' } |
            ForEach-Object {
                Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
            }
    }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

$buildMode = [bool]$BuildZip
$stageRoot = $null

if ($buildMode) {
    $stageRoot = Join-Path $env:TEMP ('valheim-client-mods-stage-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $gameRoot = Join-Path $stageRoot 'root'
    New-Item -ItemType Directory -Force -Path $gameRoot | Out-Null
    Write-Host "Режим сборки ZIP: $BuildZip"
} else {
    if (-not $ValheimPath) {
        Write-Step 'Ищу папку Valheim в Steam...'
        $ValheimPath = Find-ValheimPath
    }
    if (-not $ValheimPath) {
        throw 'Папка Valheim не найдена. Укажи её: -ValheimPath "D:\Games\Steam\steamapps\common\Valheim"'
    }
    $ValheimPath = (Resolve-Path -LiteralPath $ValheimPath).Path
    if (-not (Test-Path -LiteralPath (Join-Path $ValheimPath 'valheim.exe'))) {
        throw "Это не папка Valheim (нет valheim.exe): $ValheimPath"
    }
    if (Get-Process -Name 'valheim' -ErrorAction SilentlyContinue) {
        throw 'Valheim запущен. Закрой игру перед установкой модов.'
    }
    $gameRoot = $ValheimPath
    Write-Host "Valheim: $gameRoot"
}

try {
    foreach ($package in $packages) {
        if ($package.Kind -eq 'local-file') {
            Install-PackageArchive -Package $package -Archive $null -GameRoot $gameRoot
            continue
        }

        $archive = Get-ModArchive -Package $package
        Install-PackageArchive -Package $package -Archive $archive -GameRoot $gameRoot
    }

    Write-Step 'Проверяю установку'
    $required = @(
        'winhttp.dll',
        'doorstop_config.ini',
        'BepInEx\core\BepInEx.Preloader.dll',
        'BepInEx\plugins\ServerDevcommands\ServerDevcommands.dll',
        'BepInEx\plugins\ValheimAdminTool\ValheimAdminTool.dll',
        'BepInEx\plugins\ValheimRuVatTranslation\ValheimRuVatTranslation.dll'
    )
    $missing = @()
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $gameRoot $relative))) {
            $missing += $relative
        }
    }
    if ($missing.Count -gt 0) {
        throw "Установка неполная, нет файлов: $($missing -join ', ')"
    }

    if ($buildMode) {
        [System.IO.File]::WriteAllText(
            (Join-Path $gameRoot 'ПРОЧТИ-МЕНЯ-КАК-УСТАНОВИТЬ.txt'),
            $instructions,
            (New-Object System.Text.UTF8Encoding($true))
        )
        $outputDir = Split-Path -Parent $BuildZip
        if (-not $outputDir) {
            $outputDir = '.'
        }
        New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
        $outputDir = (Resolve-Path -LiteralPath $outputDir).Path
        $outputPath = [System.IO.Path]::Combine($outputDir, (Split-Path -Leaf $BuildZip))
        if ([System.IO.File]::Exists($outputPath)) {
            [System.IO.File]::Delete($outputPath)
        }
        Write-Step 'Создаю ZIP'
        [System.IO.Compression.ZipFile]::CreateFromDirectory(
            $gameRoot,
            $outputPath,
            [System.IO.Compression.CompressionLevel]::Optimal,
            $false
        )
        $zip = Get-Item -LiteralPath $outputPath
        Write-Host ''
        Write-Host ("ГОТОВО: {0} ({1:N2} МБ)" -f $zip.FullName, ($zip.Length / 1MB)) -ForegroundColor Green
        Write-Host 'Содержимое распаковывается прямо в папку Valheim (инструкция внутри архива).'
    } else {
        if ($ServerPath) {
            Install-ServerPart -ServerRoot $ServerPath
        }
        Write-Host ''
        Write-Host 'ГОТОВО: внутриигровая админка установлена.' -ForegroundColor Green
        Write-Host '  F7 — панель Valheim Admin Tool на русском (читы, предметы, существа, время, погода,'
        Write-Host '       навыки, скорости, инвентарь, world/player tools, ESP).'
        Write-Host '  Клавишу можно поменять: BepInEx\config\com.icecub.valheimadmintool.cfg'
        if ($ServerPath) {
            Write-Host '  Серверная часть установлена — полный раздел TOOLS доступен.'
        } else {
            Write-Host '  Без серверной части доступны читы/предметы/существа/ESP и локальные действия;'
            Write-Host '  для кик/бан, телепортов и глобального времени добавь -ServerPath <папка сервера>.'
        }
        Write-Host "Лог загрузки модов: $gameRoot\BepInEx\LogOutput.log"
    }
}
finally {
    if ($stageRoot -and (Test-Path -LiteralPath $stageRoot)) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
