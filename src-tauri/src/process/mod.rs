//! Child process management: the Valheim dedicated server and SteamCMD.

pub mod server;
pub mod steamcmd;

use std::io::Read;
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

use crate::error::AppError;

/// Windows flag that starts a console process without a console window.
///
/// `CREATE_NO_WINDOW` is applied through
/// [`std::os::windows::process::CommandExt::creation_flags`], which is safe.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// How often the timeout helper polls the child process.
const COMMAND_POLL_INTERVAL: Duration = Duration::from_millis(20);

/// How much of a child's stdout/stderr is kept in memory (the rest is drained).
const MAX_CAPTURED_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

/// Builds a [`Command`] that never shows a console window on Windows.
///
/// All child processes of the manager (Valheim server, SteamCMD, `taskkill`,
/// `netsh`) must use this helper: otherwise a black console window flashes on
/// every action of the GUI.
#[must_use]
pub fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}

/// Result of [`run_command_with_timeout`].
#[derive(Debug)]
pub struct CommandOutput {
    /// Exit status; `None` when the process was killed by the timeout.
    pub status: Option<ExitStatus>,
    /// Captured stdout (lossy UTF-8, capped).
    pub stdout: String,
    /// Captured stderr (lossy UTF-8, capped).
    pub stderr: String,
    /// `true` when the process was killed because it exceeded the timeout.
    pub timed_out: bool,
}

impl CommandOutput {
    /// Returns `true` when the process exited successfully.
    #[must_use]
    pub fn success(&self) -> bool {
        self.status.is_some_and(|status| status.success())
    }

    /// stdout and stderr combined (netsh prints errors there).
    #[must_use]
    pub fn combined_output(&self) -> String {
        format!("{}{}", self.stdout, self.stderr)
    }
}

/// Runs a hidden child process with a hard timeout and captured output.
///
/// The stdout/stderr pipes are drained by reader threads, so a chatty process
/// (for example `netsh` listing all firewall rules) cannot deadlock on a full
/// pipe. If the process does not finish before `timeout`, it is killed and the
/// returned [`CommandOutput::timed_out`] is `true`.
pub fn run_command_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<CommandOutput, AppError> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        AppError::Process(format!("не удалось запустить внешний процесс: {error}"))
    })?;

    let stdout_reader = child
        .stdout
        .take()
        .map(|stdout| std::thread::spawn(move || read_capped(stdout)));
    let stderr_reader = child
        .stderr
        .take()
        .map(|stderr| std::thread::spawn(move || read_capped(stderr)));

    let deadline = Instant::now() + timeout;
    let mut timed_out = false;

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    let _ = child.kill();
                    break child.wait().ok();
                }
                std::thread::sleep(COMMAND_POLL_INTERVAL);
            }
            Err(_) => {
                let _ = child.kill();
                break child.wait().ok();
            }
        }
    };

    let stdout = stdout_reader
        .map(|reader| reader.join().unwrap_or_default())
        .unwrap_or_default();
    let stderr = stderr_reader
        .map(|reader| reader.join().unwrap_or_default())
        .unwrap_or_default();

    Ok(CommandOutput {
        status,
        stdout: String::from_utf8_lossy(&stdout).to_string(),
        stderr: String::from_utf8_lossy(&stderr).to_string(),
        timed_out,
    })
}

/// Reads a stream into memory, keeping at most [`MAX_CAPTURED_OUTPUT_BYTES`]
/// but draining the pipe until EOF so the child never blocks.
fn read_capped(mut reader: impl Read) -> Vec<u8> {
    let mut data = Vec::new();
    let mut buffer = [0u8; 16 * 1024];

    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                if data.len() < MAX_CAPTURED_OUTPUT_BYTES {
                    let take = (MAX_CAPTURED_OUTPUT_BYTES - data.len()).min(read);
                    data.extend_from_slice(&buffer[..take]);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => break,
        }
    }

    data
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_command_runs_a_program_and_keeps_arguments_separate() {
        // `cmd /?` writes help text to stdout and is harmless; the point is that
        // the command builder works and no window is requested on Windows.
        let output = hidden_command("cmd")
            .args(["/C", "echo", "hello"])
            .output()
            .expect("command runs");

        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "hello");
    }

    #[test]
    fn run_command_with_timeout_returns_output() {
        let started = Instant::now();
        let mut command = hidden_command("cmd");
        command.args(["/C", "echo", "hello"]);
        let output =
            run_command_with_timeout(command, Duration::from_secs(10)).expect("command runs");

        assert!(!output.timed_out);
        assert!(output.success());
        assert!(output.stdout.contains("hello"));
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn run_command_with_timeout_kills_a_hung_process() {
        // `ping -n 5` runs for ~4 seconds: it must be killed by a 250 ms timeout.
        let started = Instant::now();
        let mut command = hidden_command("cmd");
        command.args(["/C", "ping", "-n", "5", "127.0.0.1"]);
        let output =
            run_command_with_timeout(command, Duration::from_millis(250)).expect("command spawns");

        assert!(output.timed_out);
        assert!(!output.success());
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "timeout helper must not wait for the hung process"
        );
    }
}
