<#
.SYNOPSIS
    Бэкап и восстановление мира Valheim (savedir: worlds_local + списки игроков).

.DESCRIPTION
    Бэкап = zip-архив каталога сохранений <savedir>\worlds_local (мир в 1.0 — это
    ПАПКА с именем мира; копировать нужно её целиком, не отдельные файлы) плюс
    adminlist.txt / bannedlist.txt / permittedlist.txt из корня savedir.

    Рекомендуемый порядок:
      1. остановить сервер (stop-server.ps1) — тогда архив гарантированно
         консистентен;
      2. создать бэкап:  pwsh -File .\backup-server.ps1
      3. при необходимости восстановить: pwsh -File .\backup-server.ps1 -Restore -Zip <архив>
         (пока сервер остановлен; текущие файлы будут переименованы в *.pre-restore-<timestamp>).

    ВНИМАНИЕ: если сервер работает, файлы мира могут быть недописаны; скрипт
    предупредит и потребует -Force. Перед восстановлением автоматически делается
    страховочный бэкап текущего состояния.

.PARAMETER Keep
    Сколько последних архивов хранить (по умолчанию 10). 0 — не удалять ничего.

.EXAMPLE
    pwsh -File .\backup-server.ps1

.EXAMPLE
    pwsh -File .\backup-server.ps1 -Label before-update -Keep 20

.EXAMPLE
    pwsh -File .\backup-server.ps1 -Restore -Zip .\backups\valheim-backup-20261108-200000.zip

.NOTES
    Коды выхода:
      0 — успех;
      1 — ошибка (не удалось создать/распаковать архив);
      2 — каталог сохранений или worlds_local не найден;
      3 — сервер запущен (без -Force) — операция отклонена;
      4 — не найден архив для восстановления.
#>
[CmdletBinding(DefaultParameterSetName = 'Backup')]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$Savedir,
    [string]$BackupsDir,
    [string]$Label = '',
    [int]$Keep = 10,
    [switch]$Force,

    [Parameter(ParameterSetName = 'Restore', Mandatory = $true)]
    [switch]$Restore,
    [Parameter(ParameterSetName = 'Restore', Mandatory = $true)]
    [string]$Zip
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host "  OK: $text" -ForegroundColor Green }
function Write-Warn([string]$text) { Write-Host "  WARN: $text" -ForegroundColor Yellow }
function Write-Err([string]$text) { Write-Host "  ERROR: $text" -ForegroundColor Red }

$serverDir = Join-Path $Root 'server'
if (-not $Savedir) { $Savedir = Join-Path $serverDir 'savedir' }
if (-not $BackupsDir) { $BackupsDir = Join-Path $Root 'backups' }
$runtimeDir = Join-Path $Root 'runtime'
$listNames = @('adminlist.txt', 'bannedlist.txt', 'permittedlist.txt', 'allowedlist.txt')

function Test-ServerRunning {
    $stateFile = Join-Path $runtimeDir 'server.json'
    if (Test-Path -LiteralPath $stateFile) {
        try {
            $st = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
            if ($st.pid -and (Get-Process -Id ([int]$st.pid) -ErrorAction SilentlyContinue)) { return $true }
        }
        catch { }
    }
    return [bool](Get-Process -Name 'valheim_server' -ErrorAction SilentlyContinue)
}

if (-not (Test-Path -LiteralPath $Savedir)) {
    Write-Err "каталог сохранений не найден: $Savedir (запускался ли сервер?)"
    exit 2
}
$worldsDir = Join-Path $Savedir 'worlds_local'
$running = Test-ServerRunning

# ============================ RESTORE ============================
if ($Restore) {
    Write-Step "Восстановление мира из архива"
    $zipPath = (Resolve-Path -LiteralPath $Zip -ErrorAction SilentlyContinue)
    if (-not $zipPath -or -not (Test-Path -LiteralPath $zipPath)) {
        Write-Err "архив не найден: $Zip"
        exit 4
    }
    if ($running -and -not $Force) {
        Write-Err "сервер запущен — восстановление запрещено. Остановите его: .\stop-server.ps1"
        exit 3
    }
    if ($running) { Write-Warn "сервер запущен, но указан -Force: файлы могут быть перезаписаны под работающим сервером!" }

    # Страховочный бэкап текущего состояния.
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    if (Test-Path -LiteralPath $worldsDir) {
        $pre = Join-Path $BackupsDir ("pre-restore-{0}.zip" -f $stamp)
        New-Item -ItemType Directory -Force -Path $BackupsDir | Out-Null
        Write-Host "  страховочный бэкап текущего состояния: $pre"
        Compress-Archive -Path $worldsDir -DestinationPath $pre -CompressionLevel Optimal -Force
    }

    # Переименовываем текущие данные, а не удаляем: восстановление отменяемо.
    if (Test-Path -LiteralPath $worldsDir) {
        Rename-Item -LiteralPath $worldsDir -NewName ("worlds_local.pre-restore-{0}" -f $stamp)
    }
    foreach ($n in $listNames) {
        $p = Join-Path $Savedir $n
        if (Test-Path -LiteralPath $p) { Rename-Item -LiteralPath $p -NewName ("{0}.pre-restore-{1}" -f $n, $stamp) }
    }
    try {
        Expand-Archive -LiteralPath $zipPath -DestinationPath $Savedir -Force
    }
    catch {
        Write-Err "не удалось распаковать архив: $($_.Exception.Message)"
        exit 1
    }
    Write-Ok "архив распакован в $Savedir"
    if (-not (Test-Path -LiteralPath $worldsDir)) {
        Write-Warn "в архиве не было worlds_local — проверьте содержимое: $zipPath"
    }
    Write-Host ""
    Write-Host "  Дальше: запустите сервер (.\start-server.ps1) — он поднимет восстановленный мир."
    exit 0
}

# ============================ BACKUP ============================
Write-Step "Бэкап сохранений Valheim"
if (-not (Test-Path -LiteralPath $worldsDir)) {
    Write-Err "worlds_local не найден: $worldsDir (мир ещё не создан? запустите сервер)"
    exit 2
}
if ($running -and -not $Force) {
    Write-Err "сервер запущен: файлы мира могут быть недописаны. Остановите сервер (.\stop-server.ps1) или добавьте -Force."
    exit 3
}
if ($running) { Write-Warn "сервер запущен, указан -Force — бэкап может быть неконсистентным." }

$items = @($worldsDir)
$missingLists = @()
foreach ($n in $listNames) {
    $p = Join-Path $Savedir $n
    if (Test-Path -LiteralPath $p) { $items += $p }
    else { $missingLists += $n }
}
if ($missingLists.Count -eq 3) {
    Write-Warn ("в savedir нет списков игроков ({0}) — они появятся после первого запуска сервера." -f ($missingLists -join ', '))
}

New-Item -ItemType Directory -Force -Path $BackupsDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$suffix = if ($Label) { "-" + ($Label -replace '[^\w\.-]', '_') } else { '' }
$dest = Join-Path $BackupsDir ("valheim-backup-{0}{1}.zip" -f $stamp, $suffix)

$sw = [System.Diagnostics.Stopwatch]::StartNew()
Write-Host "  источник : $Savedir"
Write-Host "  архив    : $dest"
try {
    Compress-Archive -Path $items -DestinationPath $dest -CompressionLevel Optimal -Force
}
catch {
    Write-Err "не удалось создать архив: $($_.Exception.Message)"
    exit 1
}
$sw.Stop()

# Проверка архива: размер и число записей.
$zipItem = Get-Item -LiteralPath $dest
Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
$entryCount = -1
try {
    $za = [System.IO.Compression.ZipFile]::OpenRead($dest)
    $entryCount = $za.Entries.Count
    $za.Dispose()
}
catch { }
Write-Ok ("архив создан: {0:N0} байт ({1:N1} МБ), записей: {2}, время {3:N2} с" -f $zipItem.Length, ($zipItem.Length / 1MB), $entryCount, $sw.Elapsed.TotalSeconds)

# Ротация.
if ($Keep -gt 0) {
    $old = Get-ChildItem -LiteralPath $BackupsDir -Filter 'valheim-backup-*.zip' -File |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep
    if ($old) {
        Write-Host ("  ротация: удаляю {0} старых архивов (Keep={1})" -f $old.Count, $Keep)
        $old | Remove-Item -Force
    }
    $left = @(Get-ChildItem -LiteralPath $BackupsDir -Filter 'valheim-backup-*.zip' -File).Count
    Write-Host ("  архивов в каталоге: {0}" -f $left)
}
Write-Host ""
Write-Ok "Готово. Восстановление: .\backup-server.ps1 -Restore -Zip `"$dest`""
exit 0
