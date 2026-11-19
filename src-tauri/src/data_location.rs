//! Where the station database lives.
//!
//! The database is shared by every Windows account on the machine, so a trial
//! run under one login carries straight over to the Label Room login. It sits
//! in `%ProgramData%\LabelVerification`, which the installer opens up to the
//! local Users group (see windows/hooks.nsh).
//!
//! Releases up to 0.4.3 kept it in each account's own app config directory.
//! That path is reported as `legacy` so the frontend can copy it across once.

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SHARED_DIR_NAME: &str = "LabelVerification";
const DB_NAME: &str = "label-verification.db";
const MIGRATING_NAME: &str = "label-verification.db.migrating";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataLocation {
    pub dir: String,
    pub db_path: String,
    pub db_exists: bool,
    /// Where a one-time copy of the legacy database is written before it is
    /// promoted to `db_path`, so a copy that dies part way never looks real.
    pub migrating_path: String,
    pub legacy_db_path: String,
    pub legacy_exists: bool,
}

fn program_data() -> PathBuf {
    std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
}

#[tauri::command]
pub fn shared_data_dir(app: AppHandle) -> Result<DataLocation, String> {
    let legacy_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Could not find this account's app folder — {e}"))?;
    resolve(&program_data(), &legacy_dir)
}

/// Rename a finished migration copy into place. Refuses if a database is
/// already there, so it can never replace live data.
#[tauri::command]
pub fn promote_migrated_db() -> Result<(), String> {
    promote(&program_data())
}

fn promote(program_data: &Path) -> Result<(), String> {
    let dir = program_data.join(SHARED_DIR_NAME);
    let from = dir.join(MIGRATING_NAME);
    let to = dir.join(DB_NAME);
    if to.exists() {
        let _ = fs::remove_file(&from);
        return Err(format!("{} already exists; the copy was discarded.", to.display()));
    }
    fs::rename(&from, &to).map_err(|e| format!("Could not move the copied database into place — {e}"))
}

fn resolve(program_data: &Path, legacy_dir: &Path) -> Result<DataLocation, String> {
    let dir = program_data.join(SHARED_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| not_writable(&dir, &e.to_string()))?;

    let migrating = dir.join(MIGRATING_NAME);
    let _ = fs::remove_file(&migrating);

    let probe = dir.join(format!(".write-test-{}", std::process::id()));
    fs::write(&probe, b"").map_err(|e| not_writable(&dir, &e.to_string()))?;
    let _ = fs::remove_file(&probe);

    let db = dir.join(DB_NAME);
    let db_exists = db.is_file();
    if db_exists {
        OpenOptions::new()
            .write(true)
            .open(&db)
            .map_err(|e| not_writable(&db, &e.to_string()))?;
    }

    let legacy = legacy_dir.join(DB_NAME);
    Ok(DataLocation {
        dir: display(&dir),
        db_path: display(&db),
        db_exists,
        migrating_path: display(&migrating),
        legacy_exists: legacy.is_file(),
        legacy_db_path: display(&legacy),
    })
}

fn not_writable(path: &Path, cause: &str) -> String {
    format!(
        "This Windows account cannot write to {}. Reinstall Label Verification (the installer \
         gives every account access to that folder), or ask IT to grant the Users group modify \
         rights on it. ({cause})",
        path.display()
    )
}

fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::UNIX_EPOCH;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let mut p = std::env::temp_dir();
            p.push(format!(
                "lvs-location-test-{tag}-{}",
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&p).unwrap();
            TempDir(p)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn creates_the_shared_folder_on_first_use() {
        let root = TempDir::new("create");
        let program_data = root.0.join("ProgramData");
        let legacy = root.0.join("legacy");

        let loc = resolve(&program_data, &legacy).unwrap();

        assert!(program_data.join(SHARED_DIR_NAME).is_dir());
        assert!(loc.db_path.ends_with(DB_NAME));
        assert!(!loc.db_exists);
        assert!(!loc.legacy_exists);
        let leftovers: Vec<_> = fs::read_dir(program_data.join(SHARED_DIR_NAME))
            .unwrap()
            .collect();
        assert!(leftovers.is_empty(), "write probe was not cleaned up");
    }

    #[test]
    fn reports_an_old_per_account_database() {
        let root = TempDir::new("legacy");
        let legacy = root.0.join("legacy");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join(DB_NAME), b"old").unwrap();

        let loc = resolve(&root.0.join("ProgramData"), &legacy).unwrap();

        assert!(loc.legacy_exists);
        assert_eq!(PathBuf::from(&loc.legacy_db_path), legacy.join(DB_NAME));
    }

    #[test]
    fn reports_an_existing_shared_database_without_touching_it() {
        let root = TempDir::new("existing");
        let shared = root.0.join("ProgramData").join(SHARED_DIR_NAME);
        fs::create_dir_all(&shared).unwrap();
        fs::write(shared.join(DB_NAME), b"keep").unwrap();

        let loc = resolve(&root.0.join("ProgramData"), &root.0.join("legacy")).unwrap();

        assert!(loc.db_exists);
        assert_eq!(fs::read(shared.join(DB_NAME)).unwrap(), b"keep");
    }

    #[test]
    fn a_leftover_partial_copy_is_cleared_and_never_reported_as_the_database() {
        let root = TempDir::new("partial");
        let shared = root.0.join("ProgramData").join(SHARED_DIR_NAME);
        fs::create_dir_all(&shared).unwrap();
        fs::write(shared.join(MIGRATING_NAME), b"half").unwrap();

        let loc = resolve(&root.0.join("ProgramData"), &root.0.join("legacy")).unwrap();

        assert!(!loc.db_exists);
        assert!(!shared.join(MIGRATING_NAME).exists());
    }

    #[test]
    fn promote_moves_the_copy_into_place() {
        let root = TempDir::new("promote");
        let shared = root.0.join("ProgramData").join(SHARED_DIR_NAME);
        fs::create_dir_all(&shared).unwrap();
        fs::write(shared.join(MIGRATING_NAME), b"copied").unwrap();

        promote(&root.0.join("ProgramData")).unwrap();

        assert_eq!(fs::read(shared.join(DB_NAME)).unwrap(), b"copied");
        assert!(!shared.join(MIGRATING_NAME).exists());
    }

    #[test]
    fn promote_never_replaces_an_existing_database() {
        let root = TempDir::new("promote-existing");
        let shared = root.0.join("ProgramData").join(SHARED_DIR_NAME);
        fs::create_dir_all(&shared).unwrap();
        fs::write(shared.join(DB_NAME), b"live").unwrap();
        fs::write(shared.join(MIGRATING_NAME), b"copied").unwrap();

        assert!(promote(&root.0.join("ProgramData")).is_err());
        assert_eq!(fs::read(shared.join(DB_NAME)).unwrap(), b"live");
    }

    #[test]
    fn a_folder_that_cannot_be_created_is_a_readable_error() {
        let root = TempDir::new("blocked");
        let blocker = root.0.join("ProgramData");
        fs::write(&blocker, b"a file where the folder should be").unwrap();

        let err = resolve(&blocker, &root.0.join("legacy")).unwrap_err();

        assert!(err.contains("cannot write"), "got {err}");
        assert!(err.contains(SHARED_DIR_NAME), "got {err}");
    }
}
