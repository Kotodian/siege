pub mod schema;
pub mod migrations;

use rusqlite::Connection;
use std::path::PathBuf;

pub fn get_data_dir() -> PathBuf {
    let base = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("siege");
    std::fs::create_dir_all(&dir).ok();
    dir
}

pub fn init_db() -> Result<Connection, rusqlite::Error> {
    let db_path = get_data_dir().join("siege.db");
    let conn = Connection::open(&db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    migrations::run(&conn)?;
    Ok(conn)
}
