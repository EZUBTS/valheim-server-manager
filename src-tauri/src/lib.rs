//! Valheim Server Manager desktop application core.
//!
//! The Rust side is the only part of the application with filesystem and process
//! access: it installs/updates the dedicated server through SteamCMD, manages the
//! server process, streams logs, reads and writes player lists, creates backups
//! and diagnoses the network. The React frontend talks to it exclusively through
//! the typed commands in [`commands`] and the events described in
//! `docs/ARCHITECTURE.md` §5.
//!
//! Module map (see `docs/ARCHITECTURE.md` §6):
//! - [`error`] — serializable `AppError` with stable codes;
//! - [`paths`] — layout root and `ResolvedPaths`;
//! - [`config`] — `AppConfig`/`ServerSettings`, validation, atomic load/save;
//! - [`state`] — shared state, events and the log ring buffer pipeline;
//! - [`process`] — Valheim server and SteamCMD processes;
//! - [`logs`] — ring buffer, line classification and parsers;
//! - [`players`], [`worlds`], [`backups`], [`network`] — feature modules.

#![forbid(unsafe_code)]
// The documentation mixes Russian prose with product names such as SteamCMD,
// savedir and worlds_local; forcing backticks around every one of them would
// hurt readability more than it helps.
#![allow(clippy::doc_markdown)]

mod backups;
mod commands;
mod config;
mod error;
mod logs;
mod mods;
mod network;
mod paths;
mod players;
mod process;
mod state;
mod worlds;

pub use error::AppError;

#[cfg(desktop)]
use tauri::Manager;
#[cfg(desktop)]
use tauri_plugin_window_state::StateFlags;

/// Label of the main window, must match `tauri.conf.json`.
const MAIN_WINDOW_LABEL: &str = "main";

/// Safety net: reveal the main window after this delay even if the frontend
/// never calls `show()` (for example because the webview failed to load).
#[cfg(desktop)]
const REVEAL_FALLBACK_DELAY: std::time::Duration = std::time::Duration::from_secs(2);

/// Builds and runs the Valheim Server Manager application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // The single-instance plugin must be registered before every other plugin.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                focus_main_window(app);
            }))
            .plugin(
                tauri_plugin_window_state::Builder::default()
                    // Do not restore the `visible` and `decorations` flags: the window is
                    // revealed by the frontend after the first paint, and the custom
                    // title bar must never be turned into native decorations.
                    .with_state_flags(
                        StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                    )
                    .build(),
            );
    }

    builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();

            log::info!(
                target: "valheim-server",
                "Valheim Server Manager {} starting",
                app.package_info().version
            );

            // 1. Fixed directories (Tauri path API) and the layout root.
            let base = paths::base_paths_from_app(&handle)?;

            // 2. Configuration: load (never fail), persist the defaults on the
            //    first launch so the chosen layout root is stable.
            let mut config = config::AppConfig::load(&base);
            config.normalize(&base);
            save_initial_config_if_missing(&base, &config);

            // 3. Shared state, managed by Tauri, then a welcome log line.
            app.manage(state::AppState::new(base, config));
            let state = app.state::<state::AppState>();
            state.log_app(
                &handle,
                logs::LogLevel::Info,
                format!(
                    "Менеджер запущен. Базовый каталог: {}",
                    state.base().layout_root.display()
                ),
            );
            state.log_app(
                &handle,
                logs::LogLevel::Info,
                format!(
                    "Конфигурация: {}. Логи: {}",
                    state.base().config_file.display(),
                    state.base().logs_dir.display()
                ),
            );

            #[cfg(desktop)]
            reveal_main_window_fallback(&handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::app_info,
            commands::system::get_paths,
            commands::system::open_path,
            commands::config::get_config,
            commands::config::save_config,
            commands::config::reset_config,
            commands::install::get_install_status,
            commands::install::install_steamcmd,
            commands::install::update_server,
            commands::server::get_server_state,
            commands::server::start_server,
            commands::server::stop_server,
            commands::logs::get_logs,
            commands::logs::clear_logs,
            commands::worlds::list_worlds,
            commands::players::get_player_lists,
            commands::players::add_player,
            commands::players::remove_player,
            commands::admin::get_known_players,
            commands::backups::list_backups,
            commands::backups::create_backup,
            commands::backups::restore_backup,
            commands::backups::delete_backup,
            commands::network::diagnose_network,
            commands::network::open_firewall_ports,
            commands::network::is_port_available,
            commands::mods::get_mod_status,
            commands::mods::install_server_mods,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Valheim Server Manager")
        .run(|app_handle, event| {
            // The manager owns the server process: never leave an orphan behind
            // when the window (or the whole application) is closed with Alt+F4,
            // the task manager or a system shutdown.
            match event {
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                    process::server::shutdown_blocking(app_handle);
                }
                _ => {}
            }
        });
}

/// Persists the default configuration on the very first launch.
fn save_initial_config_if_missing(base: &paths::BasePaths, config: &config::AppConfig) {
    if base.config_file.exists() {
        return;
    }

    if let Err(error) = config.save(base) {
        log::warn!(
            target: "valheim-server",
            "Не удалось сохранить конфигурацию по умолчанию {}: {error}",
            base.config_file.display()
        );
    }
}

/// Focuses the already running main window when a second instance is launched.
#[cfg(desktop)]
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Reveals the main window after [`REVEAL_FALLBACK_DELAY`] if it is still hidden.
#[cfg(desktop)]
fn reveal_main_window_fallback(app: &tauri::AppHandle) {
    let app = app.clone();

    std::thread::spawn(move || {
        std::thread::sleep(REVEAL_FALLBACK_DELAY);

        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            if !window.is_visible().unwrap_or(false) {
                let _ = window.show();
            }
        }
    });
}
