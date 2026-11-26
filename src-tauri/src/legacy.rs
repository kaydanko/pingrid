//! One-time carry-over of data from the app's previous name.
//!
//! The project was called Varta (identifier `app.syntrope.varta`, database
//! `varta.db`). Changing the identifier moves the app config folder, so on
//! the first start of Pingrid we copy the old database next to the new one.
//! The old folder is left untouched as a backup.

use std::path::Path;
use tauri::{AppHandle, Manager};

const OLD_IDENTIFIER: &str = "app.syntrope.varta";
const OLD_DB: &str = "varta.db";
const NEW_DB: &str = "pingrid.db";

pub fn migrate(app: &AppHandle) {
    // Same folder tauri-plugin-sql uses for `sqlite:pingrid.db`.
    let Ok(new_dir) = app.path().app_config_dir() else { return };
    if new_dir.join(NEW_DB).exists() {
        return;
    }
    let Some(old_dir) = new_dir.parent().map(|p| p.join(OLD_IDENTIFIER)) else { return };
    if !old_dir.join(OLD_DB).exists() {
        return;
    }
    if let Err(e) = copy_db(&old_dir, &new_dir) {
        eprintln!("[pingrid] could not carry over data from {}: {e}", old_dir.display());
    }
}

fn copy_db(old_dir: &Path, new_dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(new_dir)?;
    // The WAL holds recent commits that may not be in the main file yet; it
    // pairs with the database by file name, so both are renamed together.
    for suffix in ["-wal", "-shm"] {
        let src = old_dir.join(format!("{OLD_DB}{suffix}"));
        if src.exists() {
            std::fs::copy(&src, new_dir.join(format!("{NEW_DB}{suffix}")))?;
        }
    }
    // Main file last: its presence is what marks the migration as done.
    std::fs::copy(old_dir.join(OLD_DB), new_dir.join(NEW_DB))?;
    Ok(())
}
