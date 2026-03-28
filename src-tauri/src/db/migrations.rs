use rusqlite::Connection;

pub fn run(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(super::schema::SCHEMA)?;

    let remote_cols = [
        ("remote_host", "TEXT"),
        ("remote_user", "TEXT DEFAULT 'root'"),
        ("remote_repo_path", "TEXT"),
        ("remote_enabled", "INTEGER NOT NULL DEFAULT 0"),
    ];
    for (col, col_type) in remote_cols {
        let sql = format!("ALTER TABLE projects ADD COLUMN {} {}", col, col_type);
        match conn.execute(&sql, []) {
            Ok(_) => {},
            Err(e) if e.to_string().contains("duplicate column") => {},
            Err(e) => return Err(e),
        }
    }

    Ok(())
}
