use rusqlite::Connection;

pub fn run(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(super::schema::SCHEMA)?;
    Ok(())
}
