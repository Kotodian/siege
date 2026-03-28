#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use tauri::Manager;

mod ai;
mod state;
mod db;
mod routes;
mod utils;

fn find_available_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind");
    listener.local_addr().unwrap().port()
}

#[tokio::main]
async fn main() {
    let port = find_available_port();
    let db_pool = db::init_db().expect("Failed to initialize database");
    let app_state = state::AppState::new(db_pool);

    let state_clone = app_state.clone();
    tokio::spawn(async move {
        let app = routes::create_router(state_clone);
        let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port))
            .await
            .expect("Failed to bind axum");
        println!("[siege] API server listening on http://127.0.0.1:{}", port);
        axum::serve(listener, app).await.expect("Axum server error");
    });

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();
            let script = format!(
                "window.__SIEGE_API_BASE__ = 'http://127.0.0.1:{}';",
                port
            );
            window.eval(&script).ok();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
