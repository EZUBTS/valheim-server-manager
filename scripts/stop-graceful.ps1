<#
.SYNOPSIS
    Корректная (graceful) остановка vanilla valheim_server.exe на Windows без GUI.

.DESCRIPTION
    Vanilla valheim_server.exe:
      * НЕ читает stdin (команды в консоль сервера бесполезны -> <https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/>);
      * штатно завершается по Ctrl+C (об этом пишет сам Iron Gate: "Starting server PRESS CTRL-C to exit");
      * при штатном завершении сохраняет мир (в лог пишется "World saved (...ms)").

    `taskkill /PID <pid>` без /F посылает WM_CLOSE окну процесса. У консольного
    процесса окно принадлежит conhost, поэтому результат зависит от того, есть ли
    у процесса консоль и как на WM_CLOSE среагирует conhost; на практике это
    ненадёжно и часто возвращает ошибку "The operation attempted is not supported".
    Поэтому корректная остановка делается через Win32 Console API:

        FreeConsole()  ->  AttachConsole(serverPid)  ->  SetConsoleCtrlHandler(NULL, TRUE)
        ->  GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)  ->  FreeConsole()

    ВАЖНО: helper обязан быть ОТДЕЛЬНЫМ процессом. FreeConsole/AttachConsole
    отрывают вызывающий процесс от его консоли, поэтому внутри долгоживущей
    родительской сессии (например, PowerShell-хоста Tauri-приложения или
    background-джобы агента) это делать нельзя — только в отдельном процессе.
    Этот скрипт как раз предназначен для запуска отдельным процессом:
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File stop-graceful.ps1 -ServerPid <pid>

    Ctrl-событие получает КАЖДЫЙ процесс, прикреплённый к консоли сервера, кроме
    самого helper'а, поэтому:
      * сервер должен быть запущен со СВОЕЙ консолью (Start-Process по умолчанию
        создаёт новую консоль; CREATE_NEW_CONSOLE для Rust-ядра);
      * если сервер запущен в общей консоли с другими процессами, Ctrl+C получат
        и они. Для менеджера это означает: запускать сервер с CREATE_NEW_CONSOLE.

.PARAMETER ServerPid
    PID процесса valheim_server.exe.

.PARAMETER CtrlEvent
    0 = CTRL_C_EVENT (по умолчанию), 1 = CTRL_BREAK_EVENT.

.PARAMETER WaitSec
    Сколько секунд ждать завершения серверного процесса после сигнала.

.PARAMETER LogFile
    Необязательно: лог сервера — чтобы после сигнала показать, была ли строка
    "World saved".

.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\stop-graceful.ps1 -ServerPid 12345 -LogFile D:\Servers\Valheim\logs\server.log

.NOTES
    Коды выхода:
      0 — сигнал отправлен, процесс завершился (graceful);
      1 — ошибка аргументов/доступа (например, нет прав на AttachConsole);
      2 — сигнал отправлен, но процесс не завершился за WaitSec;
      3 — процесса с таким PID нет.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [int]$ServerPid,

    [ValidateSet(0, 1)]
    [int]$CtrlEvent = 0,

    [int]$WaitSec = 60,

    [string]$LogFile
)

$ErrorActionPreference = 'Stop'

$proc = Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Output "PID $ServerPid not found -- process is already stopped."
    exit 3
}
if ($proc.ProcessName -notlike 'valheim_server*') {
    Write-Output "WARN: PID $ServerPid is '$($proc.ProcessName)', not valheim_server.exe. Continuing."
}

# Запоминаем момент времени, чтобы затем проверить, что лог дорос до "World saved".
$logSizeBefore = -1
if ($LogFile -and (Test-Path -LiteralPath $LogFile)) {
    $logSizeBefore = (Get-Item -LiteralPath $LogFile).Length
}

$signature = @'
using System;
using System.Runtime.InteropServices;

public static class ValheimConsoleCtl
{
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AttachConsole(uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetConsoleCtrlHandler(IntPtr handlerRoutine, bool add);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);
}
'@

if (-not ('ValheimConsoleCtl' -as [type])) {
    Add-Type -TypeDefinition $signature -ErrorAction Stop
}

# 1. Отцепляемся от собственной консоли (если она есть) — иначе AttachConsole
#    завершится ошибкой ERROR_ACCESS_DENIED, т.к. процесс уже привязан к консоли.
[void][ValheimConsoleCtl]::FreeConsole()

# 2. Присоединяемся к консоли сервера.
if (-not [ValheimConsoleCtl]::AttachConsole([uint32]$ServerPid)) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Output "FAIL: AttachConsole(pid=$ServerPid) failed, Win32 error=$err (5=ACCESS_DENIED: no own console or no rights; 6=INVALID_HANDLE: process has no console)."
    exit 1
}

try {
    # 3. Игнорируем Ctrl+C в самом helper'е: событие транслируется на все
    #    процессы консоли, включая нас.
    [void][ValheimConsoleCtl]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)

    # 4. Посылаем Ctrl+C всем процессам, прикреплённым к консоли сервера
    #    (dwProcessGroupId = 0).
    if (-not [ValheimConsoleCtl]::GenerateConsoleCtrlEvent([uint32]$CtrlEvent, 0)) {
        $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        Write-Output ("FAIL: GenerateConsoleCtrlEvent({0}) failed, Win32 error={1}" -f $CtrlEvent, $err)
        exit 1
    }
    Write-Output ("OK: GenerateConsoleCtrlEvent({0}) sent to pid {1}" -f $CtrlEvent, $ServerPid)
}
finally {
    Start-Sleep -Milliseconds 200
    [void][ValheimConsoleCtl]::FreeConsole()
}

# 5. Ждём завершения процесса.
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$deadline = [DateTime]::UtcNow.AddSeconds($WaitSec)
while ([DateTime]::UtcNow -lt $deadline) {
    if (-not (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 250
}
$sw.Stop()

$exited = -not (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)

# 6. Проверяем лог: появилась ли строка сохранения мира.
#    ВАЖНО (проверено на 1.0.21): строки "World saved" в логе нет. Реальные маркеры
#    сохранения — "World save (5/5) done. Total time [Nms]" и
#    "World save (1/5) Cloud & Backup checks done [Nms] => Save number N".
if ($LogFile -and (Test-Path -LiteralPath $LogFile)) {
    $tail = Get-Content -LiteralPath $LogFile -Tail 80 -ErrorAction SilentlyContinue
    $saved = @($tail | Where-Object { $_ -match 'World save \(5/5\) done|Save number \d+' })
    if ($saved.Count -gt 0) {
        Write-Output ("LOG: world save detected: {0}" -f $saved[-1].Trim())
    }
    else {
        Write-Output "LOG: no world save line ('World save (5/5) done') in recent log tail."
    }
}

if ($exited) {
    Write-Output ("DONE: process exited in {0:N1}s (graceful)." -f $sw.Elapsed.TotalSeconds)
    exit 0
}

Write-Output ("TIMEOUT: process still alive {0}s after ctrl event." -f $WaitSec)
exit 2
