//! Tauri commands exposed to the frontend.
//!
//! Every command matches the table in `docs/ARCHITECTURE.md` §5.2 and the typed
//! wrappers in `src/lib/ipc.ts`. Heavy operations (downloads, SteamCMD updates,
//! zip archives) run on a blocking thread pool through [`run_blocking`], so the
//! UI thread is never blocked.

pub mod admin;
pub mod backups;
pub mod config;
pub mod install;
pub mod logs;
pub mod mods;
pub mod network;
pub mod players;
pub mod server;
pub mod system;
pub mod worlds;

/// Runs a blocking task on Tauri's blocking thread pool and flattens the result.
pub async fn run_blocking<T, F>(task: F) -> Result<T, crate::error::AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, crate::error::AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            crate::error::AppError::Unexpected(format!(
                "фоновая операция завершилась с ошибкой: {error}"
            ))
        })?
}
