//! Reading CSV exports out of a folder the app does not own.
//!
//! The D365 export is produced by a person and lands in a shared folder — a
//! synced OneDrive/SharePoint directory today, something Graph-backed later.
//! The frontend has no filesystem access at all, so these two commands are the
//! entire surface: list what is there, read one file.
//!
//! Deliberately not the `fs` plugin. That plugin wants its allowed paths
//! declared in a capability file at build time, and the folder here is typed in
//! by a supervisor at runtime. Two narrow commands are less machinery and a
//! smaller hole than a broad static scope.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Refuse anything larger than this rather than pull it into memory. A print
/// run is a few hundred rows; a file this size is a mistake or a wrong folder.
const MAX_CSV_BYTES: u64 = 64 * 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderFile {
    pub name: String,
    pub size: u64,
    /// Last-modified in epoch milliseconds, so the caller can ignore a file
    /// that is still being copied in.
    pub modified_ms: Option<u64>,
    /// OneDrive "Files On-Demand" placeholder — the name is on disk but the
    /// contents are not. Reading it blocks on a download that fails outright
    /// when the station is offline, so the caller is told instead of hanging.
    pub placeholder: bool,
}

/// A name from the frontend is never allowed to escape the configured folder.
fn safe_child(folder: &str, name: &str) -> Result<PathBuf, String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains(':')
    {
        return Err(format!("{name} is not a plain file name."));
    }
    Ok(Path::new(folder).join(name))
}

#[cfg(windows)]
fn is_placeholder(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    // OFFLINE, RECALL_ON_OPEN, RECALL_ON_DATA_ACCESS — any of the three means
    // the bytes are not local yet.
    const MASK: u32 = 0x0000_1000 | 0x0004_0000 | 0x0040_0000;
    meta.file_attributes() & MASK != 0
}

#[cfg(not(windows))]
fn is_placeholder(_meta: &fs::Metadata) -> bool {
    false
}

fn modified_ms(meta: &fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

/// List the CSV files sitting in `folder`. Not recursive: the drop folder is a
/// flat inbox, and descending into it would pick up archive subfolders.
#[tauri::command]
pub fn list_drop_folder(folder: String) -> Result<Vec<FolderFile>, String> {
    if folder.trim().is_empty() {
        return Ok(Vec::new());
    }
    let dir = Path::new(&folder);
    if !dir.is_dir() {
        return Err(format!("{folder} is not a folder this station can reach."));
    }

    let entries = fs::read_dir(dir).map_err(|e| format!("Could not read {folder} — {e}"))?;
    let mut files = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let is_csv = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("csv"));
        if !is_csv {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        files.push(FolderFile {
            name: name.to_string(),
            size: meta.len(),
            modified_ms: modified_ms(&meta),
            placeholder: is_placeholder(&meta),
        });
    }

    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

/// Read one CSV out of the folder as text.
///
/// Takes folder and name separately so the frontend cannot ask for a path
/// outside the folder a supervisor configured.
#[tauri::command]
pub fn read_drop_file(folder: String, name: String) -> Result<String, String> {
    let path = safe_child(&folder, &name)?;

    let meta = fs::metadata(&path).map_err(|e| format!("Could not open {name} — {e}"))?;
    if !meta.is_file() {
        return Err(format!("{name} is not a file."));
    }
    if meta.len() > MAX_CSV_BYTES {
        return Err(format!(
            "{name} is {:.0} MB — too large to be a D365 export.",
            meta.len() as f64 / (1024.0 * 1024.0)
        ));
    }
    if is_placeholder(&meta) {
        return Err(format!(
            "{name} has not downloaded to this station yet. Open the OneDrive folder and let it sync, or mark it \"Always keep on this device\"."
        ));
    }

    let bytes = fs::read(&path).map_err(|e| format!("Could not read {name} — {e}"))?;
    // Excel writes a UTF-8 BOM; strip it so it cannot end up inside the first
    // column header and break mapping.
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    Ok(String::from_utf8_lossy(bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_names_that_escape_the_folder() {
        for bad in ["..", "../x.csv", "a/b.csv", "a\\b.csv", "C:evil.csv", ""] {
            assert!(safe_child("C:\\drop", bad).is_err(), "should reject {bad}");
        }
    }

    #[test]
    fn accepts_a_plain_name() {
        let p = safe_child("C:\\drop", "export.csv").unwrap();
        assert!(p.ends_with("export.csv"));
    }

    #[test]
    fn missing_folder_is_an_error_not_an_empty_list() {
        assert!(list_drop_folder("C:\\definitely\\not\\here".into()).is_err());
    }

    #[test]
    fn blank_folder_means_not_configured() {
        assert_eq!(list_drop_folder("   ".into()).unwrap().len(), 0);
    }

    /// A scratch directory under the OS temp dir, removed on drop.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let mut p = std::env::temp_dir();
            p.push(format!(
                "lvs-drop-test-{tag}-{}",
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&p).unwrap();
            TempDir(p)
        }
        fn write(&self, name: &str, bytes: &[u8]) {
            fs::write(self.0.join(name), bytes).unwrap();
        }
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn lists_only_csv_files_sorted() {
        let dir = TempDir::new("list");
        dir.write("b.csv", b"x");
        dir.write("a.CSV", b"x");
        dir.write("notes.txt", b"x");
        dir.write("archive.xlsx", b"x");
        fs::create_dir(dir.0.join("subfolder.csv")).unwrap();

        let files = list_drop_folder(dir.path()).unwrap();
        let names: Vec<_> = files.iter().map(|f| f.name.as_str()).collect();
        // Extension match is case-insensitive; a directory named *.csv is not a file.
        assert_eq!(names, vec!["a.CSV", "b.csv"]);
        assert!(files.iter().all(|f| f.modified_ms.is_some()));
    }

    #[test]
    fn reads_a_file_and_reports_its_size() {
        let dir = TempDir::new("read");
        dir.write("export.csv", b"Production,Label\nBO1,US0\n");

        let listed = list_drop_folder(dir.path()).unwrap();
        assert_eq!(listed[0].size, 25);
        assert!(!listed[0].placeholder);

        let text = read_drop_file(dir.path(), "export.csv".into()).unwrap();
        assert_eq!(text, "Production,Label\nBO1,US0\n");
    }

    #[test]
    fn strips_the_excel_byte_order_mark() {
        let dir = TempDir::new("bom");
        dir.write("export.csv", b"\xEF\xBB\xBFProduction,Label\n");

        let text = read_drop_file(dir.path(), "export.csv".into()).unwrap();
        // A surviving BOM would glue itself to the first header and break mapping.
        assert!(text.starts_with("Production"), "got {text:?}");
    }

    #[test]
    fn non_utf8_bytes_do_not_fail_the_read() {
        let dir = TempDir::new("cp1252");
        // 0xA9 is a lone high byte — invalid UTF-8, common in Windows exports.
        dir.write("export.csv", b"Label\nCaf\xA9\n");

        let text = read_drop_file(dir.path(), "export.csv".into()).unwrap();
        assert!(text.starts_with("Label"));
        assert!(text.contains('\u{FFFD}'), "expected lossy replacement, got {text:?}");
    }

    #[test]
    fn reading_outside_the_folder_is_refused() {
        let dir = TempDir::new("escape");
        dir.write("export.csv", b"x");
        assert!(read_drop_file(dir.path(), "../export.csv".into()).is_err());
        assert!(read_drop_file(dir.path(), "..\\export.csv".into()).is_err());
    }

    #[test]
    fn missing_file_is_a_readable_error() {
        let dir = TempDir::new("missing");
        let err = read_drop_file(dir.path(), "nope.csv".into()).unwrap_err();
        assert!(err.contains("nope.csv"), "got {err}");
    }
}
