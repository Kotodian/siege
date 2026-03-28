use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

pub async fn get_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let db = state.db.lock().unwrap();
    let item = db
        .query_row(
            "SELECT id, review_id, target_type, target_id, title, content, severity, resolved, resolution, file_path, line_number, options FROM review_items WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok(review_item_from_row(row)),
        )
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Review item not found"})),
            )
        })?;
    Ok(Json(item))
}

#[derive(Deserialize)]
pub struct UpdateReviewItem {
    resolved: Option<bool>,
    resolution: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateReviewItem>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(v) = body.resolved {
        sets.push(format!("resolved = ?{}", idx));
        params.push(Box::new(v));
        idx += 1;
    }
    if let Some(ref v) = body.resolution {
        sets.push(format!("resolution = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }

    if !sets.is_empty() {
        let sql = format!(
            "UPDATE review_items SET {} WHERE id = ?{}",
            sets.join(", "),
            idx
        );
        params.push(Box::new(id.clone()));
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        db.execute(&sql, param_refs.as_slice()).ok();
    }

    let item = db
        .query_row(
            "SELECT id, review_id, target_type, target_id, title, content, severity, resolved, resolution, file_path, line_number, options FROM review_items WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok(review_item_from_row(row)),
        )
        .unwrap_or(json!(null));

    Json(item)
}

fn review_item_from_row(row: &rusqlite::Row) -> Value {
    json!({
        "id": row.get::<_, String>(0).unwrap_or_default(),
        "reviewId": row.get::<_, String>(1).unwrap_or_default(),
        "targetType": row.get::<_, String>(2).unwrap_or_default(),
        "targetId": row.get::<_, String>(3).unwrap_or_default(),
        "title": row.get::<_, String>(4).unwrap_or_default(),
        "content": row.get::<_, Option<String>>(5).unwrap_or_default(),
        "severity": row.get::<_, String>(6).unwrap_or_default(),
        "resolved": row.get::<_, bool>(7).unwrap_or_default(),
        "resolution": row.get::<_, Option<String>>(8).unwrap_or_default(),
        "filePath": row.get::<_, Option<String>>(9).unwrap_or_default(),
        "lineNumber": row.get::<_, Option<i64>>(10).unwrap_or_default(),
        "options": row.get::<_, Option<String>>(11).unwrap_or_default(),
    })
}
