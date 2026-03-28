use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

#[derive(Deserialize)]
pub struct ListParams {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let plan_id = params.plan_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId is required"})),
        )
    })?;

    let db = state.db.lock().unwrap();

    // Check plan exists
    db.query_row(
        "SELECT id FROM plans WHERE id = ?1",
        rusqlite::params![plan_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Plan not found"})),
        )
    })?;

    // Get schedule
    let schedule_id: Option<String> = db
        .query_row(
            "SELECT id FROM schedules WHERE plan_id = ?1",
            rusqlite::params![plan_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(schedule_id) = schedule_id {
        // Get items sorted by order
        let mut items_stmt = db
            .prepare(
                "SELECT id, title, \"order\" FROM schedule_items WHERE schedule_id = ?1 ORDER BY \"order\"",
            )
            .unwrap();
        let items: Vec<(String, String, i64)> = items_stmt
            .query_map(rusqlite::params![schedule_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let mut db_snapshots: Vec<Value> = Vec::new();
        for (item_id, item_title, item_order) in &items {
            let mut snap_stmt = db
                .prepare(
                    "SELECT file_path, content_before, content_after FROM file_snapshots WHERE schedule_item_id = ?1",
                )
                .unwrap();
            let snaps: Vec<Value> = snap_stmt
                .query_map(rusqlite::params![item_id], |row| {
                    Ok(json!({
                        "filePath": row.get::<_, String>(0)?,
                        "contentBefore": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        "contentAfter": row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        "scheduleItemId": item_id,
                        "taskTitle": item_title,
                        "taskOrder": item_order,
                    }))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();
            db_snapshots.extend(snaps);
        }

        if !db_snapshots.is_empty() {
            return Ok(Json(json!(db_snapshots)));
        }
    }

    // Fallback: return empty (git diff not implemented in Rust backend)
    Ok(Json(json!([])))
}

pub async fn tasks(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Json<Value> {
    let plan_id = match params.plan_id {
        Some(id) => id,
        None => return Json(json!([])),
    };

    let db = state.db.lock().unwrap();

    let schedule_id: Option<String> = db
        .query_row(
            "SELECT id FROM schedules WHERE plan_id = ?1",
            rusqlite::params![plan_id],
            |row| row.get(0),
        )
        .ok();

    let schedule_id = match schedule_id {
        Some(id) => id,
        None => return Json(json!([])),
    };

    let mut stmt = db
        .prepare(
            "SELECT id, title, \"order\", status FROM schedule_items WHERE schedule_id = ?1 AND status = 'completed' ORDER BY \"order\"",
        )
        .unwrap();
    let items: Vec<(String, String, i64, String)> = stmt
        .query_map(rusqlite::params![schedule_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let result: Vec<Value> = items
        .iter()
        .map(|(item_id, title, order, status)| {
            let file_count: i64 = db
                .query_row(
                    "SELECT COUNT(DISTINCT file_path) FROM file_snapshots WHERE schedule_item_id = ?1",
                    rusqlite::params![item_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            json!({
                "id": item_id,
                "title": title,
                "order": order,
                "status": status,
                "fileCount": file_count,
            })
        })
        .collect();

    Json(json!(result))
}
