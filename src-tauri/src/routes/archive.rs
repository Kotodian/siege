use axum::{
    extract::State,
    Json,
};
use serde_json::{json, Value};

use crate::state::AppState;

pub async fn archive(State(state): State<AppState>) -> Json<Value> {
    let db = state.db.lock().unwrap();

    let archived = archive_completed_plans(&db);
    let cleaned = cleanup_archived_plans(&db);

    Json(json!({"archived": archived, "cleaned": cleaned}))
}

fn get_setting(db: &rusqlite::Connection, key: &str, default: &str) -> String {
    db.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| default.to_string())
}

fn archive_completed_plans(db: &rusqlite::Connection) -> i64 {
    let archive_days: i64 = get_setting(db, "archive_after_days", "30")
        .parse()
        .unwrap_or(30);

    let cutoff_sql = format!("datetime('now', '-{} days')", archive_days);
    let sql = format!(
        "UPDATE plans SET archived_at = datetime('now') WHERE status = 'completed' AND archived_at IS NULL AND updated_at <= {}",
        cutoff_sql
    );

    db.execute(&sql, []).unwrap_or(0) as i64
}

fn cleanup_archived_plans(db: &rusqlite::Connection) -> i64 {
    let cleanup_days: i64 = get_setting(db, "cleanup_after_days", "90")
        .parse()
        .unwrap_or(90);

    let cutoff_sql = format!("datetime('now', '-{} days')", cleanup_days);

    // Get plans to delete
    let sql = format!(
        "SELECT id FROM plans WHERE archived_at IS NOT NULL AND archived_at <= {}",
        cutoff_sql
    );
    let mut stmt = db.prepare(&sql).unwrap();
    let ids: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    for id in &ids {
        db.execute("DELETE FROM plans WHERE id = ?1", rusqlite::params![id])
            .ok();
    }

    ids.len() as i64
}
