pub mod schema;
pub mod migrations;

use rusqlite::Connection;
use std::path::PathBuf;

pub fn get_data_dir() -> PathBuf {
    // Check environment variable first (for custom data dir)
    if let Ok(dir) = std::env::var("SIEGE_DATA_DIR") {
        let p = PathBuf::from(dir);
        std::fs::create_dir_all(&p).ok();
        return p;
    }

    // If ./data/siege.db exists (web version co-located), use it for compatibility
    let local = PathBuf::from("data");
    if local.join("siege.db").exists() {
        std::fs::create_dir_all(&local).ok();
        return local;
    }

    // Platform-specific app data directory
    let base = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("siege");
    std::fs::create_dir_all(&dir).ok();
    dir
}

pub fn init_db() -> Result<Connection, rusqlite::Error> {
    let db_path = get_data_dir().join("siege.db");
    println!("[siege] Database: {}", db_path.display());
    let conn = Connection::open(&db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    migrations::run(&conn)?;
    Ok(conn)
}
