<#
.SYNOPSIS
    Запускает выделенный сервер Valheim (valheim_server.exe) по раскладке D:\Servers\Valheim.

.DESCRIPTION
    Скрипт — рабочая обёртка над vanilla valheim_server.exe для ops-задач и
    ручного администрирования. Приложение (Rust-ядро) запускает сервер само, но
    использует те же аргументы/пути, что и этот скрипт.

    Что делает:
      1. Проверяет наличие valheim_server.exe и корректность параметров.
      2. Проверяет, что порт (UDP port..port+2) не занят.
      3. Запускает сервер отдельным процессом с СВОЕЙ консолью (это обязательно:
         корректная остановка делается через Ctrl+C в консоль сервера — см.
         stop-server.ps1/stop-graceful.ps1; процесс без консоли можно только
         убить /F, потеряв последние сохранения).
      4. Пишет состояние в <root>\runtime\server.json и <root>\runtime\server.pid.
      5. Ждёт в логе строку готовности ("Game server connected"), по умолчанию до
         180 с, и печатает итог: PID, лог, порты, join code (если crossplay).

    Аргументы сервера (проверены на версии 1.0.x):
      -name <string>        имя сервера (≤ 53 символов)
      -port <int>           игровой порт (занимает также port+1, port+2)
      -world <string>       имя мира (≤ 20 символов); нет мира — создаётся новый
      -password <string>    5..20 символов; не должен входить в name/world
      -public <0|1>         видимость в server browser
      -savedir <path>       каталог сохранений (worlds_local, adminlist.txt, …)
      -logfile <path>       файл лога; без него — только stdout
      -crossplay            флаг: PlayFab-backend, нужен join code
      -preset <name>        normal|casual|easy|hard|hardcore|immersive|hammer
      -modifier <k> <v>     например: -modifier combat hard
      -setkey <key>         nobuildcost|playermobs|passivemobs|nomap|fire|noportals
      -saveinterval <sec>   период автосохранения (по умолчанию 1800)
      -instanceid <id>      уникальный id для crossplay-инстансов
      -nographics -batchmode  штатные Unity-флаги headless-режима (добавляются всегда)

.PARAMETER Password
    Обязательный пароль сервера (5–20 символов).

.EXAMPLE
    pwsh -File .\start-server.ps1 -Password 'SuperSecret1'

.EXAMPLE
    pwsh -File .\start-server.ps1 -Name 'Valheim RU' -Port 2458 -World Midgard `
        -Password 'SuperSecret1' -Public -SaveInterval 900 -Preset hard

.NOTES
    Коды выхода:
      0 — сервер запущен и готов принимать игроков;
      1 — ошибка параметров;
      2 — нет установки/занят порт/ошибка запуска процесса;
      3 — процесс завершился до готовности (см. хвост лога);
      4 — процесс жив, но готовность не подтверждена за ReadyTimeoutSec.
#>
[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$ServerDir,

    [string]$Name = 'Valheim Server',
    [ValidateRange(1, 65535)]
    [int]$Port = 2456,
    [string]$World = 'Dedicated',
    [Parameter(Mandatory = $true)]
    [string]$Password,
    [switch]$Public,

    [string]$Savedir,
    [string]$LogFile,

    [switch]$Crossplay,
    [string]$InstanceId,
    [string]$Preset,
    [string[]]$Modifier,
    [string[]]$SetKey,
    [int]$SaveInterval = 0,
    [string[]]$ExtraArgs,

    [int]$ReadyTimeoutSec = 180,
    [switch]$NoWait,
    [switch]$VisibleConsole
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host "  OK: $text" -ForegroundColor Green }
function Write-Warn([string]$text) { Write-Host "  WARN: $text" -ForegroundColor Yellow }
function Write-Err([string]$text) { Write-Host "  ERROR: $text" -ForegroundColor Red }

if (-not $ServerDir) { $ServerDir = Join-Path $Root 'server' }
if (-not $Savedir) { $Savedir = Join-Path $ServerDir 'savedir' }
$logsDir = Join-Path $Root 'logs'
$runtimeDir = Join-Path $Root 'runtime'
$serverExe = Join-Path $ServerDir 'valheim_server.exe'
$stateFile = Join-Path $runtimeDir 'server.json'
$pidFile = Join-Path $runtimeDir 'server.pid'

# ---------- 1. Проверки ----------
Write-Step "Проверка окружения"
if (-not (Test-Path -LiteralPath $serverExe)) {
    Write-Err "valheim_server.exe не найден: $serverExe"
    Write-Err "Сначала выполните .\install-server.ps1"
    exit 2
}
if ($Password.Length -lt 5 -or $Password.Length -gt 20) {
    Write-Err "Пароль должен быть длиной 5..20 символов (сейчас $($Password.Length))."
    Write-Err "Короткий пароль сервер отвергает: 'Error bad password:' и процесс завершается."
    exit 1
}
if ($Name.Length -gt 53) {
    Write-Warn "Имя сервера длиннее 53 символов — панель/UI может отвергнуть."
}
if ($World.Length -gt 20) {
    Write-Warn "Имя мира длиннее 20 символов — панель/UI может отвергнуть."
}
if ($Password -eq $Name -or $Name.Contains($Password) -or $World.Contains($Password)) {
    Write-Err "Пароль не должен входить в имя сервера или мир (ограничение Iron Gate)."
    exit 1
}
if ($SaveInterval -gt 0 -and $SaveInterval -lt 60) {
    Write-Warn "Значения -saveinterval < 60 не рекомендуются (минимум по документации — 60)."
}
if ($SaveInterval -gt 0 -and -not $PSBoundParameters.ContainsKey('SaveInterval')) { }

$running = Get-Process -Name 'valheim_server' -ErrorAction SilentlyContinue
if ($running) {
    Write-Err "уже запущен valheim_server.exe (PID $(($running | Select-Object -ExpandProperty Id) -join ', ')). Сначала остановите: .\stop-server.ps1"
    exit 2
}

# Порт и два следующих должны быть свободны (UDP).
$busy = @()
for ($p = $Port; $p -le $Port + 2; $p++) {
    $ep = Get-NetUDPEndpoint -LocalPort $p -ErrorAction SilentlyContinue
    if ($ep) { $busy += $p }
}
if ($busy.Count -gt 0) {
    Write-Err ("UDP-порты заняты: {0}. Выберите другой -Port или остановите занявший процесс." -f ($busy -join ', '))
    exit 2
}
Write-Ok "exe на месте, порты UDP $Port-$($Port + 2) свободны"

New-Item -ItemType Directory -Force -Path $Savedir, $logsDir, $runtimeDir | Out-Null
if (-not $LogFile) {
    $LogFile = Join-Path $logsDir ("server-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null

# ---------- 2. Аргументы ----------
$opt = [System.Collections.Generic.List[string]]::new()
$opt.AddRange([string[]]@(
        '-nographics', '-batchmode',
        '-name', $Name,
        '-port', "$Port",
        '-world', $World,
        '-password', $Password,
        '-public', $(if ($Public) { '1' } else { '0' }),
        '-savedir', $Savedir,
        '-logfile', $LogFile
    ))
if ($Crossplay) { $opt.Add('-crossplay') }
if ($InstanceId) { $opt.AddRange([string[]]@('-instanceid', $InstanceId)) }
if ($Preset) { $opt.AddRange([string[]]@('-preset', $Preset)) }
if ($Modifier) {
    foreach ($m in $Modifier) {
        # Поддерживаем и "combat hard" (два элемента), и "combat:hard"/"combat=hard" (один).
        if ($m -match '^([^:=]+)[:=](.+)$') {
            $opt.AddRange([string[]]@('-modifier', $Matches[1], $Matches[2]))
        }
        else {
            $opt.AddRange([string[]]@('-modifier', $m))
        }
    }
}
if ($SetKey) { foreach ($k in $SetKey) { $opt.AddRange([string[]]@('-setkey', $k)) } }
if ($SaveInterval -gt 0) { $opt.AddRange([string[]]@('-saveinterval', "$SaveInterval")) }
if ($ExtraArgs) { foreach ($a in $ExtraArgs) { $opt.Add($a) } }

Write-Step "Запуск сервера"
Write-Host ("  exe      : {0}" -f $serverExe)
Write-Host ("  working  : {0}" -f $ServerDir)
Write-Host ("  args     : {0}" -f ($opt -join ' '))
Write-Host ("  logfile  : {0}" -f $LogFile)
Write-Host ("  savedir  : {0}" -f $Savedir)
$startedAt = Get-Date

# Своя консоль (не -NoNewWindow): нужна для Ctrl+C-остановки.
# -WindowStyle Hidden: окно консоли создаётся, но скрыто; AttachConsole к PID работает.
$startParams = @{
    FilePath               = $serverExe
    ArgumentList           = $opt
    WorkingDirectory       = $ServerDir
    PassThru               = $true
    RedirectStandardOutput = (Join-Path $runtimeDir 'server.stdout.log')
    RedirectStandardError  = (Join-Path $runtimeDir 'server.stderr.log')
}
if (-not $VisibleConsole) { $startParams['WindowStyle'] = 'Hidden' }

try {
    $proc = Start-Process @startParams
}
catch {
    Write-Err "не удалось запустить процесс: $($_.Exception.Message)"
    exit 2
}

$state = [pscustomobject]@{
    pid        = $proc.Id
    startedAt  = $startedAt.ToString('o')
    name       = $Name
    port       = $Port
    world      = $World
    savedir    = $Savedir
    logFile    = $LogFile
    crossplay  = [bool]$Crossplay
    preset     = $Preset
    args       = @($opt)
}
$state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8
Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ASCII
Write-Ok ("процесс запущен, PID {0}" -f $proc.Id)

if ($NoWait) {
    Write-Host "  -NoWait: ждать готовности не буду."
    exit 0
}

# ---------- 3. Ожидание готовности ----------
Write-Step "Ожидание готовности (маркер 'Game server connected' в логе, до $ReadyTimeoutSec с)"
$ready = $false
$dead = $false
$deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSec)
$lastSize = 0
while ([DateTime]::UtcNow -lt $deadline) {
    if ($proc.HasExited) { $dead = $true; break }
    if (Test-Path -LiteralPath $LogFile) {
        $item = Get-Item -LiteralPath $LogFile -ErrorAction SilentlyContinue
        if ($item -and $item.Length -ne $lastSize) {
            $lastSize = $item.Length
            $content = Get-Content -LiteralPath $LogFile -Raw -ErrorAction SilentlyContinue
            if ($content -match 'Game server connected') { $ready = $true; break }
            if ($content -match 'Error bad password') { $dead = $true; break }
        }
    }
    Start-Sleep -Milliseconds 500
}

if ($dead) {
    Write-Err "сервер завершился до готовности. Хвост лога:"
    if (Test-Path -LiteralPath $LogFile) { Get-Content -LiteralPath $LogFile -Tail 25 | ForEach-Object { Write-Host "    $_" } }
    Remove-Item -LiteralPath $stateFile, $pidFile -Force -ErrorAction SilentlyContinue
    exit 3
}

$logTail = @()
if (Test-Path -LiteralPath $LogFile) { $logTail = @(Get-Content -LiteralPath $LogFile -Tail 15) }
$joinCodeLine = $logTail | Where-Object { $_ -match 'join code' } | Select-Object -Last 1

if (-not $ready) {
    Write-Warn "процесс жив (PID $($proc.Id)), но строка 'Game server connected' за $ReadyTimeoutSec с не появилась."
    Write-Host "  Хвост лога:"
    $logTail | ForEach-Object { Write-Host "    $_" }
    exit 4
}

Write-Ok ("сервер готов принимать игроков за {0:N1} с" -f ((Get-Date) - $startedAt).TotalSeconds)
Write-Host ""
Write-Host "  PID       : $($proc.Id)"
Write-Host "  лог       : $LogFile"
Write-Host "  порты UDP : $Port, $($Port + 1), $($Port + 2)"
Write-Host "  мир       : $World  (savedir: $Savedir)"
if ($Public) { Write-Host "  видимость : виден в списке серверов (-public 1)" } else { Write-Host "  видимость : скрыт из списка (-public 0), подключаться по IP/join code" }
if ($joinCodeLine) { Write-Host ("  join code : {0}" -f $joinCodeLine.Trim()) }
Write-Host ""
Write-Host "  Остановка : .\stop-server.ps1        (graceful, мир сохраняется)"
exit 0
