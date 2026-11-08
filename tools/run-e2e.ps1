<#
.SYNOPSIS
    Запускает собранное приложение Valheim Server Manager и прогоняет e2e-проверку
    через Chrome DevTools Protocol (WebView2 remote debugging).

.DESCRIPTION
    1. Проверяет, что release-сборка существует.
    2. Останавливает оставшиеся тестовые процессы valheim_server (если есть).
    3. Запускает приложение с WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<порт>.
    4. Ждёт, пока WebView2 поднимет CDP.
    5. Запускает tools/e2e-cdp.mjs (опционально с реальным запуском сервера).
    6. Аккуратно закрывает приложение и прибирает процессы.

.PARAMETER WithServer
    Дополнительно запустить настоящий сервер, дождаться фазы running и корректно
    остановить его (полный e2e-цикл).

.PARAMETER CdpPort
    Порт CDP (по умолчанию 9333).

.PARAMETER KeepRunning
    Не закрывать приложение после проверки (для ручной инспекции).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\run-e2e.ps1
    powershell -ExecutionPolicy Bypass -File tools\run-e2e.ps1 -WithServer
#>
[CmdletBinding()]
param(
    [switch]$WithServer,
    [switch]$InstallMods,
    [int]$CdpPort = 9333,
    [switch]$KeepRunning
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'src-tauri\target\release\valheim-server-manager.exe'
$report = Join-Path $root 'docs\E2E-REPORT.md'

if (-not (Test-Path -LiteralPath $exe)) {
    throw "Не найдена release-сборка: $exe. Сначала выполните pnpm desktop:build."
}

$existingServer = Get-Process valheim_server -ErrorAction SilentlyContinue
if ($existingServer) {
    Write-Host "Останавливаю оставшийся тестовый valheim_server (PID $($existingServer.Id -join ', '))..."
    $existingServer | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

# Не даём приложению подхватить старый экземпляр single-instance.
$existingApp = Get-Process valheim-server-manager -ErrorAction SilentlyContinue
if ($existingApp) {
    Write-Host "Закрываю уже запущенный экземпляр приложения (PID $($existingApp.Id -join ', '))..."
    $existingApp | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$CdpPort"
$testStartedAt = Get-Date
$app = Start-Process -FilePath $exe -PassThru
Write-Host "Приложение запущено: PID $($app.Id), CDP-порт $CdpPort"

$cdpUrl = "http://127.0.0.1:$CdpPort/json"
$deadline = (Get-Date).AddSeconds(120)
$cdpReady = $false
while ((Get-Date) -lt $deadline) {
    try {
        $targets = Invoke-RestMethod -Uri $cdpUrl -TimeoutSec 2 -ErrorAction Stop
        if ($targets | Where-Object { $_.type -eq 'page' -and $_.webSocketDebuggerUrl }) {
            $cdpReady = $true
            break
        }
    }
    catch {
        Start-Sleep -Milliseconds 500
    }
}

if (-not $cdpReady) {
    Write-Host "CDP не поднялся. Проверяю, не упало ли приложение..."
    if ($app.HasExited) {
        Write-Warning "Приложение завершилось с кодом $($app.ExitCode). Смотрите логи: $env:LOCALAPPDATA\com.valheim.servermanager\logs"
        exit 1
    }
    Write-Warning "CDP недоступен, но приложение работает. E2E через CDP невозможен."
    if (-not $KeepRunning) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}

Write-Host "CDP доступен, запускаю e2e-проверку..."
$nodeArgs = @((Join-Path $PSScriptRoot 'e2e-cdp.mjs'), '--port', "$CdpPort", '--report', $report)
if ($WithServer) {
    $nodeArgs += '--with-server'
}
if ($InstallMods) {
    $nodeArgs += '--install-mods'
}

& node @nodeArgs
$exitCode = $LASTEXITCODE

if (-not $KeepRunning) {
    # Приложение должно само остановить сервер; проверяем только процессы,
    # которые появились во время этого прогона (чужие тестовые серверы не трогаем).
    $leftover = @(Get-Process valheim_server -ErrorAction SilentlyContinue |
        Where-Object { $_.StartTime -ge $testStartedAt.AddSeconds(-5) })
    if ($leftover.Count -gt 0) {
        Write-Warning "e2e: после проверки остался процесс valheim_server (PID $($leftover.Id -join ', ')) — приложение не остановило сервер. Завершаю принудительно."
        $leftover | Stop-Process -Force -ErrorAction SilentlyContinue
        if ($exitCode -eq 0) { $exitCode = 1 }
    }
    $runningApp = Get-Process -Id $app.Id -ErrorAction SilentlyContinue
    if ($runningApp) {
        Write-Host "Закрываю приложение (PID $($app.Id))..."
        Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "E2E завершён, exit code: $exitCode. Отчёт: $report"
exit $exitCode
