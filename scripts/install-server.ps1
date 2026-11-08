<#
.SYNOPSIS
    Устанавливает/обновляет SteamCMD и Valheim Dedicated Server (appid 896660).

.DESCRIPTION
    Шаги:
      1. Проверяет раскладку каталогов (по умолчанию: <root>\steamcmd, <root>\server).
      2. Если steamcmd.exe нет — скачивает официальный zip, распаковывает, удаляет zip.
      3. Self-update SteamCMD (`steamcmd.exe +quit`).
      4. `+force_install_dir <server> +login anonymous +app_update 896660 validate +quit`.
      5. Проверяет наличие valheim_server.exe, печатает размер установки и время.

    Эмпирические нюансы SteamCMD (проверено на этой машине, 2026-11-08):
      * Первый `+quit` на свежераспакованном SteamCMD завершается с exit code 7,
        хотя обновление проходит успешно. Поэтому код 7 трактуется как успех.
      * SteamCMD выводит прогресс ЛОКАЛИЗОВАННО (на этой машине — по-русски:
        "Загрузка обновления", "Проверка установки"), поэтому парсить прогресс
        нужно по числовым строкам вида "[ 55%]" / "progress: 55.00 (…/…)".
      * Ошибка `ERROR! Failed to install app '896660' (Missing configuration)`
        (exit code 8) бывает ТРАНЗИЕНТНОЙ: повторный запуск той же команды
        обычно проходит (первая попытка прогревает appcache/токены).
        Скрипт делает до -MaxAttempts попыток.
      * `app_update` возвращает 0 при успехе; ненулевой код — ошибка.

.PARAMETER Root
    База раскладки. По умолчанию — родительский каталог папки scripts.

.PARAMETER SkipSelfUpdate
    Не запускать self-update SteamCMD.

.PARAMETER MaxAttempts
    Число попыток app_update (по умолчанию 3).

.EXAMPLE
    pwsh -File .\install-server.ps1
    pwsh -File .\install-server.ps1 -MaxAttempts 5

.NOTES
    Коды выхода:
      0 — сервер установлен/обновлён и valheim_server.exe на месте;
      1 — не удалось скачать/распаковать SteamCMD;
      2 — app_update не удался после всех попыток;
      3 — app_update вернул успех, но valheim_server.exe отсутствует.
#>
[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),

    [string]$SteamCmdDir,
    [string]$ServerDir,
    [int]$AppId = 896660,
    [switch]$SkipSelfUpdate,
    [int]$MaxAttempts = 3,
    [string]$SteamCmdUrl = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step([string]$text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host "  OK: $text" -ForegroundColor Green }
function Write-Warn([string]$text) { Write-Host "  WARN: $text" -ForegroundColor Yellow }
function Write-Err([string]$text) { Write-Host "  ERROR: $text" -ForegroundColor Red }

if (-not $SteamCmdDir) { $SteamCmdDir = Join-Path $Root 'steamcmd' }
if (-not $ServerDir) { $ServerDir = Join-Path $Root 'server' }
$runtimeDir = Join-Path $Root 'runtime'
$steamcmdExe = Join-Path $SteamCmdDir 'steamcmd.exe'
$serverExe = Join-Path $ServerDir 'valheim_server.exe'
$totalSw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Step "Раскладка"
Write-Host "  root        : $Root"
Write-Host "  steamcmd    : $SteamCmdDir"
Write-Host "  server      : $ServerDir"
New-Item -ItemType Directory -Force -Path $SteamCmdDir, $ServerDir, $runtimeDir | Out-Null

# ---------- 1. SteamCMD присутствует? ----------
Write-Step "SteamCMD"
if (-not (Test-Path -LiteralPath $steamcmdExe)) {
    Write-Host "  steamcmd.exe не найден — скачиваю $SteamCmdUrl"
    $zip = Join-Path $SteamCmdDir 'steamcmd.zip'
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Invoke-WebRequest -Uri $SteamCmdUrl -OutFile $zip -UseBasicParsing
    }
    catch {
        Write-Err "не удалось скачать SteamCMD: $($_.Exception.Message)"
        exit 1
    }
    $sw.Stop()
    $zipItem = Get-Item -LiteralPath $zip
    Write-Ok ("скачано {0:N0} байт ({1:N2} МБ) за {2:N1} с" -f $zipItem.Length, ($zipItem.Length / 1MB), $sw.Elapsed.TotalSeconds)
    try {
        Expand-Archive -LiteralPath $zip -DestinationPath $SteamCmdDir -Force
    }
    catch {
        Write-Err "не удалось распаковать $zip : $($_.Exception.Message)"
        exit 1
    }
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    Write-Ok "распаковано в $SteamCmdDir"
}
else {
    $v = (Get-Item -LiteralPath $steamcmdExe).VersionInfo.FileVersion
    Write-Ok "steamcmd.exe уже есть (FileVersion: $v)"
}

function Invoke-SteamCmd {
    param(
        [string[]]$Arguments,
        [string]$LogName
    )
    $logPath = Join-Path $runtimeDir $LogName
    $errPath = "$logPath.err.txt"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process -FilePath $steamcmdExe -ArgumentList $Arguments `
        -WorkingDirectory $SteamCmdDir -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput $logPath -RedirectStandardError $errPath
    $sw.Stop()
    [pscustomobject]@{
        ExitCode = $p.ExitCode
        Seconds  = $sw.Elapsed.TotalSeconds
        LogPath  = $logPath
        Output   = @(Get-Content -LiteralPath $logPath -ErrorAction SilentlyContinue)
    }
}

# ---------- 2. Self-update ----------
if (-not $SkipSelfUpdate) {
    Write-Step "Self-update SteamCMD (+quit)"
    $r = Invoke-SteamCmd -Arguments @('+quit') -LogName 'steamcmd-selfupdate.log'
    # Наблюдение: первый +quit на свежем SteamCMD отдаёт 7, при этом всё скачано/обновлено.
    if ($r.ExitCode -eq 0 -or $r.ExitCode -eq 7) {
        Write-Ok ("self-update завершён за {0:N1} с (exit={1}; 7 = норма для свежего SteamCMD)" -f $r.Seconds, $r.ExitCode)
    }
    else {
        Write-Warn ("self-update завершился с кодом {0}; лог: {1}" -f $r.ExitCode, $r.LogPath)
    }
}

# ---------- 3. app_update ----------
Write-Step "Установка Valheim Dedicated Server (appid $AppId)"
$installed = $false
$lastResult = $null
for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    Write-Host "  попытка $attempt из $MaxAttempts ..."
    $steamArgs = @(
        '+force_install_dir', $ServerDir,
        '+login', 'anonymous',
        '+app_update', $AppId, 'validate',
        '+quit'
    )
    $r = Invoke-SteamCmd -Arguments $steamArgs -LogName "steamcmd-app_update-$AppId.log"
    $lastResult = $r
    $hasError = @($r.Output | Where-Object { $_ -match 'ERROR!|Failed to install app' }).Count -gt 0

    if ($r.ExitCode -eq 0 -and -not $hasError) {
        Write-Ok ("app_update завершён за {0:N1} с (exit=0)" -f $r.Seconds)
        $installed = $true
        break
    }

    $errLines = @($r.Output | Where-Object { $_ -match 'ERROR!|Failed' } | Select-Object -First 3)
    Write-Warn ("exit={0} за {1:N1} с; {2}" -f $r.ExitCode, $r.Seconds, ($errLines -join ' | '))
    if ($attempt -lt $MaxAttempts) {
        Write-Host "  повтор через 3 с (транзиентная ошибка Steam: Missing configuration) ..."
        Start-Sleep -Seconds 3
    }
}

if (-not $installed) {
    # Иногда steamcmd отдаёт ненулевой код, но файлы уже на месте (например, validate на выпущенном билде).
    if (Test-Path -LiteralPath $serverExe) {
        Write-Warn "app_update вернул ошибку, но valheim_server.exe уже на месте — считаю установку состоявшейся."
        $installed = $true
    }
    else {
        Write-Err "не удалось установить appid $AppId. Смотрите лог: $($lastResult.LogPath)"
        Write-Err "Подсказка: повторите запуск скрипта — 'Missing configuration' транзиентна; проверьте доступ в Steam (порт 443)."
        exit 2
    }
}

# ---------- 4. Проверка результата ----------
Write-Step "Проверка установки"
if (-not (Test-Path -LiteralPath $serverExe)) {
    Write-Err "valheim_server.exe не найден в $ServerDir"
    exit 3
}
$exe = Get-Item -LiteralPath $serverExe
$files = Get-ChildItem -LiteralPath $ServerDir -Recurse -File -ErrorAction SilentlyContinue
$totalBytes = ($files | Measure-Object Length -Sum).Sum
Write-Host ("  valheim_server.exe : {0} байт ({1:N1} МБ), FileVersion {2}" -f $exe.Length, ($exe.Length / 1MB), $exe.VersionInfo.FileVersion)
Write-Host ("  всего файлов       : {0}, объём установки {1:N0} МБ" -f $files.Count, ($totalBytes / 1MB))
$totalSw.Stop()
Write-Host ("  общее время        : {0:N0} с" -f $totalSw.Elapsed.TotalSeconds)

Write-Host ""
Write-Ok "Готово. Дальше: .\start-server.ps1 -Password 'ваш пароль' (или см. docs\SERVER-SETUP.md)"
exit 0
