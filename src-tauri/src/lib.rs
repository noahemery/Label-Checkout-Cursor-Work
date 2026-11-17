mod drop_folder;
mod scanner;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // SQLite lives in the app data directory; the TypeScript side opens
    // `sqlite:label-verification.db` and owns the schema.
    .plugin(tauri_plugin_sql::Builder::default().build())
    .manage(scanner::ScannerState::default())
    // The only filesystem access the frontend has: read D365 exports out of
    // the shared drop folder. See drop_folder.rs for why this is not the fs
    // plugin. Scanner CDC is the same idea: two commands plus an event, not
    // a serial plugin with a broad port scope.
    .invoke_handler(tauri::generate_handler![
      drop_folder::list_drop_folder,
      drop_folder::read_drop_file,
      drop_folder::write_inbox_status,
      drop_folder::list_inbox_requests,
      drop_folder::delete_inbox_request,
      drop_folder::station_host_name,
      scanner::list_scanner_ports,
      scanner::start_scanner,
      scanner::stop_scanner
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
