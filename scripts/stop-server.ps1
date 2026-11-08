<#
.SYNOPSIS
    Останавливает выделенный сервер Valheim с сохранением мира (graceful) или принудительно.

.DESCRIPTION
    Vanilla valheim_server.exe не читает stdin, поэтому «напечатать quit в консоль»
    нельзя. Безопасная остановка — послать процессу Ctrl+C (как советует Iron Gate:
    "Starting server PRESS CTRL-C to exit"). Windows не умеет «отправить Ctrl+C по
    PID» штатными средствами, поэтому используется helper
    scripts\stop-graceful.ps1: он ОТДЕЛЬНЫМ процессом делает
    FreeConsole -> AttachConsole(serverPid) -> GenerateConsoleCtrlEvent(CTRL_C, 0).

    ВАЖНО: чтобы это работало, сервер должен быть запущен со СВОЕЙ консолью.
    start-server.ps1 запускает его именно так (Start-Process без -NoNewWindow,
    окно скрыто через -WindowStyle Hidden). Процесс без консоли корректно
    остановить нельзя — только убить /F (последние сохранения могут потеряться).

    Порядок методов (по умолчанию -Method Auto):
      1. CtrlC  — helper stop-graceful.ps1 (graceful, мир сохраняется);
      2. Taskkill — `taskkill /PID <pid>` без /F (WM_CLOSE; для консольного
         процесса обычно НЕ работает, оставлен как fallback);
      3. Force  — `taskkill /F /PID <pid>` (жёстко; только с -AllowForceFallback
         или явным -Method Force).

    После остановки скрипт смотрит в лог и сообщает, была ли строка "World saved".

.PARAMETER ServerPid
    PID сервера. Если не указан — берётся из <root>\runtime\server.json / server.pid.

.EXAMPLE
    pwsh -File .\stop-server.ps1

.EXAMPLE
    pwsh -File .\stop-server.ps1 -Method Force

.NOTES
    Коды выхода:
      0 — процесс корректно завершён (мир сохранён либо сервер уже не работал);
      1 — ошибка запуска helper'а / внутренняя ошибка;
      2 — процесса нет (уже остановлен);
      3 — graceful не удался, процесс ещё жив (используйте -Method Force);
      4 — процесс убит принудительно (/F).
#>
[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [int]$ServerPid = 0,
    [ValidateSet('Auto', 'CtrlC', 'Taskkill', 'Force')]
    [string]$Method = 'Auto',
    [int]$TimeoutSec = 60,
    [switch]$AllowForceFallback
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host "  OK: $text" -ForegroundColor Green }
function Write-Warn([string]$text) { Write-Host "  WARN: $text" -ForegroundColor Yellow }
function Write-Err([string]$text) { Write-Host "  ERROR: $text" -ForegroundColor Red }

$runtimeDir = Join-Path $Root 'runtime'
$stateFile = Join-Path $runtimeDir 'server.json'
$pidFile = Join-Path $runtimeDir 'server.pid'
$helper = Join-Path $PSScriptRoot 'stop-graceful.ps1'

# ---------- 1. Определяем PID и лог ----------
$logFile = $null
$world = $null
if (Test-Path -LiteralPath $stateFile) {
    try {
        $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        if (-not $ServerPid -and $state.pid) { $ServerPid = [int]$state.pid }
        $logFile = $state.logFile
        $world = $state.world
    }
    catch { Write-Warn "не удалось прочитать $stateFile : $($_.Exception.Message)" }
}
if (-not $ServerPid -and (Test-Path -LiteralPath $pidFile)) {
    $ServerPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
}
if (-not $ServerPid) {
    $p = Get-Process -Name 'valheim_server' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($p) { $ServerPid = $p.Id }
}

if (-not $ServerPid) {
    Write-Host "Сервер не запущен (PID не найден) — останавливать нечего."
    Remove-Item -LiteralPath $stateFile, $pidFile -Force -ErrorAction SilentlyContinue
    exit 2
}

$proc = Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Host "Процесс PID $ServerPid уже не работает."
    Remove-Item -LiteralPath $stateFile, $pidFile -Force -ErrorAction SilentlyContinue
    exit 2
}

Write-Step "Остановка сервера"
Write-Host ("  PID   : {0}" -f $ServerPid)
if ($logFile) { Write-Host ("  лог   : {0}" -f $logFile) }
if ($world) { Write-Host ("  мир   : {0}" -f $world) }

# Запоминаем размер лога, чтобы понять, дописалось ли сохранение.
$logSizeBefore = -1
if ($logFile -and (Test-Path -LiteralPath $logFile)) { $logSizeBefore = (Get-Item -LiteralPath $logFile).Length }

function Wait-Exit([int]$waitSec) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $deadline = [DateTime]::UtcNow.AddSeconds($waitSec)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 250
    }
    $sw.Stop()
    return [pscustomobject]@{
        Exited   = -not (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)
        Seconds  = $sw.Elapsed.TotalSeconds
    }
}

function Show-SaveEvidence {
    if (-not ($logFile -and (Test-Path -LiteralPath $logFile))) { return }
    $tail = @(Get-Content -LiteralPath $logFile -Tail 80 -ErrorAction SilentlyContinue)
    # Реальный маркер сохранения в 1.0.21 — "World save (5/5) done. Total time [Nms]".
    $saved = @($tail | Where-Object { $_ -match 'World save \(5/5\) done|Save number \d+' })
    if ($saved.Count -gt 0) {
        Write-Ok ("в логе есть сохранение мира: {0}" -f $saved[-1].Trim())
    }
    else {
        Write-Warn "строк сохранения ('World save (5/5) done') в хвосте лога нет — проверьте файлы мира перед перезапуском."
    }
}

# Windows PowerShell 5.1 читает .ps1 в кодировке системы (CP1251) и ломается на
# UTF-8 без BOM. Поэтому helper запускаем через pwsh (PowerShell 7), если он есть.
function Get-HelperHost {
    $pwshExe = Get-Command pwsh.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
    if ($pwshExe) { return $pwshExe }
    return 'powershell.exe'
}

# ---------- 2. Ctrl+C (graceful) ----------
if ($Method -eq 'Auto' -or $Method -eq 'CtrlC') {
    if (-not (Test-Path -LiteralPath $helper)) {
        Write-Warn "helper не найден: $helper — пропускаю Ctrl+C."
    }
    else {
        Write-Host "  метод: Ctrl+C через stop-graceful.ps1 (в отдельном процессе)"
        $helperArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $helper, '-ServerPid', "$ServerPid", '-CtrlEvent', '0', '-WaitSec', "$([Math]::Min($TimeoutSec, 30))")
        if ($logFile) { $helperArgs += @('-LogFile', $logFile) }
        $helperHost = Get-HelperHost
        Write-Host ("    helper host: {0}" -f $helperHost)
        $h = Start-Process -FilePath $helperHost -ArgumentList $helperArgs -Wait -PassThru -NoNewWindow `
            -RedirectStandardOutput (Join-Path $runtimeDir 'stop-graceful.out.log') `
            -RedirectStandardError (Join-Path $runtimeDir 'stop-graceful.err.log')
        Get-Content -LiteralPath (Join-Path $runtimeDir 'stop-graceful.out.log') -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
        Write-Host ("    helper exit={0}" -f $h.ExitCode)
        if (-not (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)) {
            Write-Ok "сервер завершился штатно по Ctrl+C"
            Show-SaveEvidence
            Remove-Item -LiteralPath $stateFile, $pidFile -Force -ErrorAction SilentlyContinue
            exit 0
        }
        Write-Warn "после Ctrl+C процесс ещё жив"
    }
}

# ---------- 3. taskkill без /F ----------
if ($Method -eq 'Auto' -or $Method -eq 'Taskkill') {
    Write-Host "  метод: taskkill /PID $ServerPid (без /F, WM_CLOSE)"
    $out = & taskkill.exe /PID $ServerPid 2>&1
    Write-Host ("    $out")
    $w = Wait-Exit -waitSec 10
    if ($w.Exited) {
        Write-Ok ("процесс завершился за {0:N1} с после taskkill" -f $w.Seconds)
        Show-SaveEvidence
        Remove-Item -LiteralPath $stateFile, $pidFile -Force -ErrorAction SilentlyContinue
        exit 0
    }
    Write-Warn "taskkill без /F не завершил процесс (ожидаемо для консольного процесса)"
}

# ---------- 4. /F ----------
$canForce = ($Method -eq 'Force') -or $AllowForceFallback
if (-not $canForce) {
    Write-Err "graceful-остановка не удалась, процесс PID $ServerPid ещё жив."
    Write-Err "Принудительная остановка: .\stop-server.ps1 -Method Force  (мир может потерять последние изменения)"
    exit 3
}

Write-Host "  метод: taskkill /F /PID $ServerPid (жёстко)"
$out = & taskkill.exe /F /PID $ServerPid 2>&1
Write-Host ("    $out")
$w = Wait-Exit -waitSec 15
if (-not $w.Exited) {
    Write-Err "не удалось завершить процесс PID $ServerPid даже через /F"
    exit 1
}
Write-Warn ("процесс убит принудительно за {0:N1} с — последние сохранения могли не записаться" -f $w.Seconds)
Show-SaveEvidence
Remove-Item -LiteralPath $stateFile, $pidFile -Force -ErrorAction SilentlyContinue
exit 4
