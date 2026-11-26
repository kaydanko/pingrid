//! Keeps the display on while the dashboard is up.
//!
//! WKWebView (macOS) and WebKitGTK (Linux) do not implement the Screen Wake
//! Lock API, so desktop builds ask the OS directly. The assertion lives on a
//! dedicated thread: on Windows `SetThreadExecutionState` belongs to the
//! calling thread, so a tokio worker could not reliably release it.

use std::sync::{mpsc, Mutex};
use tauri::State;

/// Dropping the sender ends the holder thread, which releases the assertion.
#[derive(Default)]
pub struct AwakeState(Mutex<Option<mpsc::Sender<()>>>);

#[cfg(desktop)]
fn acquire() -> Result<mpsc::Sender<()>, String> {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);
    std::thread::Builder::new()
        .name("pingrid-keep-awake".into())
        .spawn(move || {
            let guard = keepawake::Builder::default()
                .display(true)
                .idle(true)
                .reason("Pingrid wallboard is monitoring resources")
                .app_name("Pingrid")
                .app_reverse_domain("app.syntrope.pingrid")
                .create();
            match guard {
                Ok(guard) => {
                    let _ = ready_tx.send(Ok(()));
                    // Blocks until the sender is dropped (release or app exit).
                    let _ = stop_rx.recv();
                    drop(guard);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e.to_string()));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    ready_rx
        .recv()
        .map_err(|_| "keep-awake thread exited".to_string())??;
    Ok(stop_tx)
}

#[cfg(mobile)]
fn acquire() -> Result<mpsc::Sender<()>, String> {
    Err("unsupported".into())
}

/// `enable: true` acquires (idempotent), `false` releases. Returns whether it is held.
#[tauri::command]
pub fn keep_awake(state: State<'_, AwakeState>, enable: bool) -> Result<bool, String> {
    let mut slot = state.0.lock().map_err(|_| "keep-awake state poisoned".to_string())?;
    if !enable {
        slot.take();
        return Ok(false);
    }
    if slot.is_none() {
        *slot = Some(acquire()?);
    }
    Ok(true)
}
