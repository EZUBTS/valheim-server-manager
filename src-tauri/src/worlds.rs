//! World discovery.
//!
//! Valheim 1.0 stores every world as a directory in `<savedir>\worlds_local`:
//!
//! ```text
//! worlds_local/
//! └─ Midgard/
//!    ├─ _main.1.fwl2      metadata
//!    ├─ _main.1.db2       data
//!    ├─ _main.1.chunks    chunk index
//!    ├─ _main.1.ok        "save complete" marker
//!    └─ 00_00__0_1.chunk  terrain chunks
//! ```
//!
//! Pre-1.0 worlds were a pair of `<World>.fwl` and `<World>.db` files; both
//! layouts are still found on disk, so both are reported.
//!
//! See `docs/valheim-server-reference.md` §5.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// One world found in `worlds_local`.
///
/// Matches `WorldInfo` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldInfo {
    /// World name (directory name in 1.0, `.fwl` file stem for legacy worlds).
    pub name: String,
    /// Total size of all world files in bytes.
    pub size_bytes: u64,
    /// Modification time of the newest file, epoch milliseconds.
    pub modified_at: i64,
    /// `true` when the world is selected in the configuration.
    pub is_active: bool,
}

/// File extensions that mark a file as part of a world.
const WORLD_EXTENSIONS: [&str; 6] = ["fwl", "fwl2", "db", "db2", "chunks", "ok"];

/// Returns `true` when the configured world already exists in `worlds_local`.
///
/// A Valheim 1.0 world exists as soon as `<world>/_main.N.fwl2` is present
/// (the folder is created before the first save, only `.fwl2` exists then; the
/// `.db2`/`.chunks` files appear after the first save). Legacy worlds are
/// `<world>.fwl` / `<world>.fwl2` files next to the directories.
///
/// The check is used for readiness detection: a fresh world must wait for
/// world generation to finish, a pre-existing one does not generate anything.
#[must_use]
pub fn world_exists(worlds_dir: &Path, world: &str) -> bool {
    let directory = worlds_dir.join(world);
    if directory.is_dir() && directory_contains_world_files(&directory) {
        return true;
    }

    worlds_dir.join(format!("{world}.fwl")).is_file()
        || worlds_dir.join(format!("{world}.fwl2")).is_file()
}

/// Scans `worlds_local` and returns all worlds sorted by name.
///
/// `active_world` is the value of `-world`: the world with the same name is
/// reported as active.
#[must_use]
pub fn scan_worlds(worlds_dir: &Path, active_world: &str) -> Vec<WorldInfo> {
    let Ok(entries) = std::fs::read_dir(worlds_dir) else {
        return Vec::new();
    };

    let mut worlds: BTreeMap<String, (u64, i64)> = BTreeMap::new();

    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            if is_skipped_directory(&name) {
                continue;
            }
            if !directory_contains_world_files(&path) {
                continue;
            }

            let (size, modified) = directory_world_stats(&path);
            worlds
                .entry(name)
                .and_modify(|(known_size, known_modified)| {
                    *known_size = known_size.saturating_add(size);
                    *known_modified = (*known_modified).max(modified);
                })
                .or_insert((size, modified));
        } else if metadata.is_file() {
            let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
                continue;
            };
            if extension != "fwl" && extension != "fwl2" {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            if stem.starts_with("_main.") {
                continue;
            }

            let (size, modified) = legacy_world_stats(worlds_dir, stem);
            worlds
                .entry(stem.to_string())
                .and_modify(|(known_size, known_modified)| {
                    *known_size = known_size.saturating_add(size);
                    *known_modified = (*known_modified).max(modified);
                })
                .or_insert((size, modified));
        }
    }

    worlds
        .into_iter()
        .map(|(name, (size_bytes, modified_at))| WorldInfo {
            is_active: name == active_world,
            name,
            size_bytes,
            modified_at,
        })
        .collect()
}

/// Returns `true` for directories that must not be reported as worlds
/// (Valheim's own automatic backups and hidden directories).
fn is_skipped_directory(name: &str) -> bool {
    name.starts_with('.') || name.contains("_backup") || name.eq_ignore_ascii_case("backups")
}

/// Returns `true` when a directory contains at least one world file.
fn directory_contains_world_files(directory: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return false;
    };

    entries.filter_map(Result::ok).any(|entry| {
        let path = entry.path();
        if !path.is_file() {
            return false;
        }
        path.extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| WORLD_EXTENSIONS.contains(&extension))
    })
}

/// Sums file sizes and finds the newest modification time in a world folder.
fn directory_world_stats(directory: &Path) -> (u64, i64) {
    walkdir::WalkDir::new(directory)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .fold((0u64, 0i64), |(size, modified), entry| {
            let metadata = entry.metadata().ok();
            let file_size = metadata.as_ref().map_or(0, std::fs::Metadata::len);
            let file_modified = metadata.as_ref().map_or(0, modified_ms);
            (size.saturating_add(file_size), modified.max(file_modified))
        })
}

/// Sums sizes and finds the newest modification time of legacy world files.
fn legacy_world_stats(worlds_dir: &Path, world_name: &str) -> (u64, i64) {
    let mut size = 0u64;
    let mut modified = 0i64;

    for extension in WORLD_EXTENSIONS {
        let path = worlds_dir.join(format!("{world_name}.{extension}"));
        if let Ok(metadata) = std::fs::metadata(&path) {
            if metadata.is_file() {
                size = size.saturating_add(metadata.len());
                modified = modified.max(modified_ms(&metadata));
            }
        }
    }

    (size, modified)
}

/// Converts a file modification time into epoch milliseconds.
fn modified_ms(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| {
            i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
        })
}

/// Returns all `.fwl2`/`.fwl` metadata files of a world directory (for tests and
/// future UI details).
#[must_use]
#[allow(dead_code)] // used by tests; useful for a future world details view
pub fn world_metadata_files(world_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(world_dir) else {
        return Vec::new();
    };

    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension == "fwl" || extension == "fwl2")
        })
        .collect();
    files.sort();
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, contents: &[u8]) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(path, contents).expect("write");
    }

    #[test]
    fn scans_directories_legacy_files_and_skips_backups() {
        let temp = tempfile::tempdir().expect("temp dir");
        let worlds_dir = temp.path().join("worlds_local");

        write(&worlds_dir.join("Midgard").join("_main.1.fwl2"), b"meta");
        write(
            &worlds_dir.join("Midgard").join("_main.1.db2"),
            b"data data",
        );
        write(
            &worlds_dir.join("Midgard").join("00_00__0_1.chunk"),
            b"chunk",
        );

        write(&worlds_dir.join("OldWorld.fwl"), b"12345");
        write(&worlds_dir.join("OldWorld.db"), b"1234567890");

        write(
            &worlds_dir
                .join("Midgard_backup_auto-20260101-000000")
                .join("_main.1.fwl2"),
            b"backup",
        );
        std::fs::create_dir_all(worlds_dir.join("EmptyDir")).expect("mkdir");

        let worlds = scan_worlds(&worlds_dir, "OldWorld");

        assert_eq!(worlds.len(), 2);
        assert_eq!(worlds[0].name, "Midgard");
        assert_eq!(worlds[0].size_bytes, 4 + 9 + 5);
        assert!(!worlds[0].is_active);
        assert_eq!(worlds[1].name, "OldWorld");
        assert_eq!(worlds[1].size_bytes, 5 + 10);
        assert!(worlds[1].is_active);
        assert!(worlds[0].modified_at > 0);
    }

    #[test]
    fn world_with_only_metadata_file_is_listed() {
        // Valheim 1.0 creates `_main.0.fwl2` first; `.db2`/`.chunks` appear
        // only after the first save, so a metadata file alone is a real world.
        let temp = tempfile::tempdir().expect("temp dir");
        let worlds_dir = temp.path().join("worlds_local");
        write(&worlds_dir.join("Fresh").join("_main.0.fwl2"), b"meta");

        let worlds = scan_worlds(&worlds_dir, "Fresh");
        assert_eq!(worlds.len(), 1);
        assert_eq!(worlds[0].name, "Fresh");
        assert_eq!(worlds[0].size_bytes, 4);
        assert!(worlds[0].is_active);
    }

    #[test]
    fn automatic_backup_directories_are_not_worlds() {
        let temp = tempfile::tempdir().expect("temp dir");
        let worlds_dir = temp.path().join("worlds_local");
        write(&worlds_dir.join("Midgard").join("_main.1.fwl2"), b"meta");
        write(
            &worlds_dir
                .join("Midgard_backup_auto-20260101-000000")
                .join("_main.1.fwl2"),
            b"meta",
        );
        // Legacy backup files (`<World>_backup_<date>.db`) are not worlds either.
        write(
            &worlds_dir.join("Midgard_backup_auto-20260101-000000.db"),
            b"legacy backup",
        );

        let worlds = scan_worlds(&worlds_dir, "Midgard");
        assert_eq!(worlds.len(), 1);
        assert_eq!(worlds[0].name, "Midgard");
    }

    #[test]
    fn world_exists_detects_directories_and_legacy_files() {
        let temp = tempfile::tempdir().expect("temp dir");
        let worlds_dir = temp.path().join("worlds_local");
        write(&worlds_dir.join("Fresh").join("_main.0.fwl2"), b"meta");
        write(&worlds_dir.join("Legacy.fwl"), b"meta");
        std::fs::create_dir_all(worlds_dir.join("EmptyDir")).expect("mkdir");

        assert!(world_exists(&worlds_dir, "Fresh"));
        assert!(world_exists(&worlds_dir, "Legacy"));
        assert!(!world_exists(&worlds_dir, "Missing"));
        assert!(!world_exists(&worlds_dir, "EmptyDir"));
        assert!(!world_exists(&temp.path().join("nope"), "Fresh"));
    }

    #[test]
    fn missing_worlds_directory_yields_no_worlds() {
        let temp = tempfile::tempdir().expect("temp dir");
        assert_eq!(scan_worlds(&temp.path().join("missing"), "any").len(), 0);
    }

    #[test]
    fn catalogs_world_metadata_files() {
        let temp = tempfile::tempdir().expect("temp dir");
        let world = temp.path().join("Midgard");
        write(&world.join("_main.1.fwl2"), b"x");
        write(&world.join("_main.2.fwl2"), b"x");
        write(&world.join("_main.1.db2"), b"x");

        let files = world_metadata_files(&world);
        assert_eq!(files.len(), 2);
        assert!(files[0].ends_with("_main.1.fwl2"));
    }
}
