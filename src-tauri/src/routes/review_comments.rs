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
    #[serde(rename = "reviewId")]
    review_id: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let review_id = params.review_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "reviewId is required"})),
        )
    })?;

    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, review_id, file_path, line_number, content, ai_response, status, created_at FROM review_comments WHERE review_id = ?1",
        )
        .unwrap();
    let rows = stmt
        .query_map(rusqlite::params![review_id], |row| {
            Ok(comment_from_row(row))
        })
        .unwrap();
    let items: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(Json(json!(items)))
}

#[derive(Deserialize)]
pub struct CreateComment {
    #[serde(rename = "reviewId")]
    review_id: Option<String>,
    #[serde(rename = "filePath")]
    file_path: Option<String>,
    #[serde(rename = "lineNumber")]
    line_number: Option<i64>,
    content: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateComment>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let review_id = body.review_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "reviewId, filePath, lineNumber, and content are required"})),
        )
    })?;
    let file_path = body.file_path.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "reviewId, filePath, lineNumber, and content are required"})),
        )
    })?;
    let line_number = body.line_number.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "reviewId, filePath, lineNumber, and content are required"})),
        )
    })?;
    let content = body.content.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "reviewId, filePath, lineNumber, and content are required"})),
        )
    })?;

    let id = uuid::Uuid::new_v4().to_string();
    let db = state.db.lock().unwrap();

    db.execute(
        "INSERT INTO review_comments (id, review_id, file_path, line_number, content, status) VALUES (?1, ?2, ?3, ?4, ?5, 'pending')",
        rusqlite::params![id, review_id, file_path, line_number, content],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let comment = db
        .query_row(
            "SELECT id, review_id, file_path, line_number, content, ai_response, status, created_at FROM review_comments WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok(comment_from_row(row)),
        )
        .unwrap_or(json!(null));

    Ok((StatusCode::CREATED, Json(comment)))
}

fn comment_from_row(row: &rusqlite::Row) -> Value {
    json!({
        "id": row.get::<_, String>(0).unwrap_or_default(),
        "reviewId": row.get::<_, String>(1).unwrap_or_default(),
        "filePath": row.get::<_, String>(2).unwrap_or_default(),
        "lineNumber": row.get::<_, i64>(3).unwrap_or_default(),
        "content": row.get::<_, String>(4).unwrap_or_default(),
        "aiResponse": row.get::<_, Option<String>>(5).unwrap_or_default(),
        "status": row.get::<_, String>(6).unwrap_or_default(),
        "createdAt": row.get::<_, String>(7).unwrap_or_default(),
    })
}
