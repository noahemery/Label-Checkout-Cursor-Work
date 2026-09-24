mod drop_folder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // SQLite lives in the app data directory; the TypeScript side opens
    // `sqlite:label-verification.db` and owns the schema.
    .plugin(tauri_plugin_sql::Builder::default().build())
    // The only filesystem access the frontend has: read D365 exports out of
    // the shared drop folder. See drop_folder.rs for why this is not the fs
    // plugin.
    .invoke_handler(tauri::generate_handler![
      drop_folder::list_drop_folder,
      drop_folder::read_drop_file
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
