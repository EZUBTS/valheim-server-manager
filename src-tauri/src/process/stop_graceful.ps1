<#
.SYNOPSIS
    Gracefully stop valheim_server.exe on Windows with a console control event.

.DESCRIPTION
    The vanilla Valheim dedicated server never reads stdin, so it can only be
    stopped the way Iron Gate recommends: Ctrl+C in its console. A GUI process
    cannot send Ctrl+C to another process directly, but a helper process can:

        FreeConsole() -> AttachConsole(serverPid) -> SetConsoleCtrlHandler(NULL, TRUE)
        -> GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0) -> FreeConsole()

    The helper must be a separate process: FreeConsole/AttachConsole detach the
    caller from its own console, which must not happen inside the manager.
    This file is embedded into the Rust binary and written to
    <app data>/helpers/stop-graceful.ps1 before the first graceful stop.

    The signal is sent to every process attached to the server console
    (dwProcessGroupId = 0), so the server must own its console. The manager
    starts valheim_server.exe with CREATE_NO_WINDOW, which still creates a
    (hidden) console for a console application.

.PARAMETER ServerPid
    PID of the running valheim_server.exe process.

.PARAMETER WaitSec
    How many seconds to wait for the process to exit after the Ctrl+C event.

.PARAMETER LogFile
    Optional server log path; when given, the helper reports whether the save
    markers appeared in the log tail.

.EXAMPLE
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File stop-graceful.ps1 -ServerPid 12345 -WaitSec 45 -LogFile D:\logs\server.log

.NOTES
    Exit codes:
      0 - Ctrl+C sent, the process exited (graceful);
      1 - setup/API error (for example AttachConsole failed);
      2 - Ctrl+C sent, but the process is still running after WaitSec;
      3 - there is no process with this PID.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [int]$ServerPid,

    [int]$WaitSec = 45,

    [string]$LogFile = ''
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)) {
    Write-Output "NO_PROCESS: PID $ServerPid not found (already stopped)"
    exit 3
}

$signature = @'
using System;
using System.Runtime.InteropServices;

public static class ValheimConsoleControl
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

try {
    Add-Type -TypeDefinition $signature -ErrorAction Stop
}
catch {
    Write-Output ("FAIL: Add-Type failed: " + $_.Exception.Message)
    exit 1
}

# 1. Detach from our own console, otherwise AttachConsole fails with
#    ERROR_ACCESS_DENIED because this process is already attached.
[void][ValheimConsoleControl]::FreeConsole()

# 2. Attach to the server console.
if (-not [ValheimConsoleControl]::AttachConsole([uint32]$ServerPid)) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Output ("FAIL: AttachConsole(PID=" + $ServerPid + ") failed, Win32 error=" + $err)
    exit 1
}

try {
    # 3. Ignore Ctrl+C in the helper itself: the event is broadcast to every
    #    process attached to the console, including us.
    [void][ValheimConsoleControl]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)

    # 4. Send CTRL_C_EVENT to the whole console process group.
    if (-not [ValheimConsoleControl]::GenerateConsoleCtrlEvent(0, 0)) {
        $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        Write-Output ("FAIL: GenerateConsoleCtrlEvent failed, Win32 error=" + $err)
        exit 1
    }
    Write-Output "OK: CTRL_C_EVENT sent"
}
finally {
    Start-Sleep -Milliseconds 200
    [void][ValheimConsoleControl]::FreeConsole()
}

# 5. Wait for the server process to exit.
$deadline = [DateTime]::UtcNow.AddSeconds($WaitSec)
while ([DateTime]::UtcNow -lt $deadline) {
    if (-not (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 250
}

if (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue) {
    Write-Output "TIMEOUT: process still running after $WaitSec s"
    exit 2
}

# 6. Report whether the world save markers are present in the log tail.
if ($LogFile -and (Test-Path -LiteralPath $LogFile)) {
    $tail = Get-Content -LiteralPath $LogFile -Tail 40 -ErrorAction SilentlyContinue
    $saved = @($tail | Where-Object { $_ -match 'World save \(5/5\) done|World saved \(' })
    if ($saved.Count -gt 0) {
        Write-Output ("LOG: save confirmed: " + $saved[-1].Trim())
    }
    else {
        Write-Output "LOG: no save marker found in the log tail"
    }
}

Write-Output "DONE: process exited after Ctrl+C"
exit 0
