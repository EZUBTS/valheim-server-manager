use serde::{Serialize, Serializer};

/// Application-level error returned by Tauri commands.
///
/// It serializes into a stable payload the frontend can rely on:
/// `{ "code": "VALIDATION", "message": "..." }` (see `docs/ARCHITECTURE.md` §5.4).
///
/// Messages are user-facing, therefore they are written in Russian; the code
/// itself, comments and log messages emitted by the app are English.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AppError {
    /// The caller provided invalid input.
    #[error("{0}")]
    Validation(String),

    /// Something went wrong that the user cannot fix by changing input.
    #[error("Непредвиденная ошибка: {0}")]
    Unexpected(String),

    /// A filesystem operation failed.
    #[error("Ошибка ввода-вывода: {0}")]
    Io(String),

    /// A file, directory or resource does not exist.
    #[error("Не найдено: {0}")]
    NotFound(String),

    /// The configuration file is unreadable, corrupt or has invalid values.
    #[error("Ошибка конфигурации: {0}")]
    Config(String),

    /// The Valheim server is already running.
    #[error("Сервер Valheim уже запущен")]
    AlreadyRunning,

    /// The Valheim server is not running.
    #[error("Сервер Valheim не запущен")]
    NotRunning,

    /// `valheim_server.exe` is missing or the install directory is broken.
    #[error("Сервер Valheim не установлен: {0}")]
    ServerNotInstalled(String),

    /// `steamcmd.exe` is missing.
    #[error("SteamCMD не установлен: {0}")]
    SteamcmdNotInstalled(String),

    /// A required UDP port is already in use.
    #[error("Порт занят: {0}")]
    PortInUse(String),

    /// Spawning or controlling a child process failed.
    #[error("Ошибка процесса: {0}")]
    Process(String),

    /// Creating, restoring or deleting a backup failed.
    #[error("Ошибка резервной копии: {0}")]
    BackupFailed(String),

    /// The operation needs administrator privileges.
    #[error("Требуются права администратора: {0}")]
    ElevationRequired(String),

    /// A network or firewall query/command failed.
    #[error("Ошибка сети: {0}")]
    Network(String),

    /// The platform or the installed server does not support the operation.
    #[error("Не поддерживается: {0}")]
    Unsupported(String),
}

impl AppError {
    /// Creates a [`AppError::Validation`] from any string-like value.
    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }

    /// Creates a [`AppError::Unexpected`] from any string-like value.
    pub fn unexpected(message: impl Into<String>) -> Self {
        Self::Unexpected(message.into())
    }

    /// Creates a [`AppError::Io`] from an [`std::io::Error`] and a context.
    pub fn io(context: impl std::fmt::Display, error: &std::io::Error) -> Self {
        Self::Io(format!("{context}: {error}"))
    }

    /// A stable, machine-readable error code shared with the frontend.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Validation(_) => "VALIDATION",
            Self::Unexpected(_) => "UNEXPECTED",
            Self::Io(_) => "IO",
            Self::NotFound(_) => "NOT_FOUND",
            Self::Config(_) => "CONFIG",
            Self::AlreadyRunning => "ALREADY_RUNNING",
            Self::NotRunning => "NOT_RUNNING",
            Self::ServerNotInstalled(_) => "SERVER_NOT_INSTALLED",
            Self::SteamcmdNotInstalled(_) => "STEAMCMD_NOT_INSTALLED",
            Self::PortInUse(_) => "PORT_IN_USE",
            Self::Process(_) => "PROCESS",
            Self::BackupFailed(_) => "BACKUP_FAILED",
            Self::ElevationRequired(_) => "ELEVATION_REQUIRED",
            Self::Network(_) => "NETWORK",
            Self::Unsupported(_) => "UNSUPPORTED",
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::io("filesystem operation failed", &error)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::Config(format!("не удалось разобрать JSON: {error}"))
    }
}

impl From<zip::result::ZipError> for AppError {
    fn from(error: zip::result::ZipError) -> Self {
        Self::BackupFailed(format!("ошибка ZIP-архива: {error}"))
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Payload<'a> {
            code: &'a str,
            message: String,
        }

        Payload {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_error_serializes_to_stable_payload() {
        let error = AppError::validation("message cannot be empty");
        let payload = serde_json::to_value(&error).expect("error serializes");

        assert_eq!(payload["code"], "VALIDATION");
        assert_eq!(payload["message"], "message cannot be empty");
        assert!(payload.get("code").is_some());
    }

    #[test]
    fn every_error_code_is_stable() {
        let cases = [
            (AppError::validation("x"), "VALIDATION"),
            (AppError::unexpected("x"), "UNEXPECTED"),
            (AppError::Io("x".into()), "IO"),
            (AppError::NotFound("x".into()), "NOT_FOUND"),
            (AppError::Config("x".into()), "CONFIG"),
            (AppError::AlreadyRunning, "ALREADY_RUNNING"),
            (AppError::NotRunning, "NOT_RUNNING"),
            (
                AppError::ServerNotInstalled("x".into()),
                "SERVER_NOT_INSTALLED",
            ),
            (
                AppError::SteamcmdNotInstalled("x".into()),
                "STEAMCMD_NOT_INSTALLED",
            ),
            (AppError::PortInUse("x".into()), "PORT_IN_USE"),
            (AppError::Process("x".into()), "PROCESS"),
            (AppError::BackupFailed("x".into()), "BACKUP_FAILED"),
            (
                AppError::ElevationRequired("x".into()),
                "ELEVATION_REQUIRED",
            ),
            (AppError::Network("x".into()), "NETWORK"),
            (AppError::Unsupported("x".into()), "UNSUPPORTED"),
        ];

        for (error, expected) in cases {
            assert_eq!(error.code(), expected);
            assert_ne!(error.to_string(), "");
        }
    }

    #[test]
    fn io_errors_are_wrapped_with_context() {
        let io_error = std::io::Error::new(std::io::ErrorKind::NotFound, "missing file");
        let error = AppError::io("reading config", &io_error);

        assert_eq!(error.code(), "IO");
        assert!(error.to_string().contains("reading config"));
        assert!(error.to_string().contains("missing file"));
    }

    #[test]
    fn serialized_error_is_json_object_with_code_and_message() {
        let error = AppError::AlreadyRunning;
        let payload = serde_json::to_string(&error).expect("serializes");
        let parsed: serde_json::Value = serde_json::from_str(&payload).expect("valid JSON");

        assert_eq!(parsed["code"], "ALREADY_RUNNING");
        assert_ne!(parsed["message"].as_str(), Some(""));
    }
}
