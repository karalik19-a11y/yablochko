//! YABLOKO INTELLIGENCE — desktop-профиль (Этап 15).
//! Tauri 2 + Rust-ядро (core-rs): IPC-команда `api` обслуживает тот же
//! контракт /api/v1, что и Fastify-адаптер dev-профиля. Данные — SQLite
//! (rusqlite, read-only), собранный на этапе сборки Node-контуром.
//!
//! Без Node/Python/Docker на чистой Windows; сборка — GitHub Actions
//! (ADR-0002/0004), локально Rust-тулчейн недоступен.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod compute;
mod router;
mod search;

use rusqlite::{Connection, OpenFlags};
use std::sync::Mutex;

pub struct AppState {
    conn: Mutex<Connection>,
}

fn open_db() -> Result<Connection, String> {
    let path = match std::env::var("YABLOKO_DB") {
        Ok(p) => std::path::PathBuf::from(p),
        Err(_) => router::resource_path("yabloko.db"),
    };
    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Не удалось открыть БД ({}): {e}", path.display()))
}

/// Единая IPC-команда: (method, path, query, body) → конверт {data, meta} | {error}.
#[tauri::command]
fn api(
    state: tauri::State<'_, AppState>,
    path: String,
    query: Option<String>,
    method: Option<String>,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    router::handle(&conn, &path, query.as_deref(), method.as_deref(), body.as_deref())
}

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    if argv.iter().any(|a| a == "--smoke") {
        std::process::exit(router::smoke());
    }

    let conn = open_db().expect("desktop db");
    let state = AppState {
        conn: Mutex::new(conn),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![api])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
