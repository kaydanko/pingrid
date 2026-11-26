mod awake;
mod checker;
mod legacy;
mod tls;

use tauri_plugin_sql::{Migration, MigrationKind};

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_core_tables",
        sql: "CREATE TABLE IF NOT EXISTS resources (
                  id TEXT PRIMARY KEY,
                  position INTEGER NOT NULL DEFAULT 0,
                  data TEXT NOT NULL
              );
              CREATE TABLE IF NOT EXISTS kv (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL
              );",
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pingrid.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(awake::AwakeState::default())
        .setup(|app| {
            legacy::migrate(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            checker::check_http,
            checker::post_json,
            checker::post_form,
            tls::inspect_tls,
            awake::keep_awake,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pingrid");
}
