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
    #[serde(rename = "type")]
    review_type: Option<String>,
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

    // Get reviews for plan
    let mut stmt = db
        .prepare(
            "SELECT id, plan_id, type, status, content, created_at, updated_at FROM reviews WHERE plan_id = ?1",
        )
        .unwrap();
    let all_reviews: Vec<Value> = stmt
        .query_map(rusqlite::params![plan_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "planId": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "status": row.get::<_, String>(3)?,
                "content": row.get::<_, Option<String>>(4)?,
                "createdAt": row.get::<_, String>(5)?,
                "updatedAt": row.get::<_, String>(6)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    // Filter by type if provided
    let filtered: Vec<&Value> = if let Some(ref rt) = params.review_type {
        all_reviews
            .iter()
            .filter(|r| r["type"].as_str() == Some(rt.as_str()))
            .collect()
    } else {
        all_reviews.iter().collect()
    };

    // Build schedule item lookup
    let mut si_stmt = db
        .prepare("SELECT id, title, \"order\" FROM schedule_items")
        .unwrap();
    let schedule_items: Vec<(String, String, i64)> = si_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let result: Vec<Value> = filtered
        .iter()
        .map(|review| {
            let review_id = review["id"].as_str().unwrap_or_default();

            // Get review items
            let mut items_stmt = db
                .prepare(
                    "SELECT id, review_id, target_type, target_id, title, content, severity, resolved, resolution, file_path, line_number, options FROM review_items WHERE review_id = ?1",
                )
                .unwrap();
            let items: Vec<Value> = items_stmt
                .query_map(rusqlite::params![review_id], |row| {
                    let target_type: String = row.get(2)?;
                    let target_id: String = row.get(3)?;
                    let (task_title, task_order) = if target_type == "schedule_item" {
                        schedule_items
                            .iter()
                            .find(|si| si.0 == target_id)
                            .map(|si| (Some(si.1.clone()), Some(si.2)))
                            .unwrap_or((None, None))
                    } else {
                        (None, None)
                    };
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "reviewId": row.get::<_, String>(1)?,
                        "targetType": target_type,
                        "targetId": target_id,
                        "title": row.get::<_, String>(4)?,
                        "content": row.get::<_, Option<String>>(5)?,
                        "severity": row.get::<_, String>(6)?,
                        "resolved": row.get::<_, bool>(7)?,
                        "resolution": row.get::<_, Option<String>>(8)?,
                        "filePath": row.get::<_, Option<String>>(9)?,
                        "lineNumber": row.get::<_, Option<i64>>(10)?,
                        "options": row.get::<_, Option<String>>(11)?,
                        "taskTitle": task_title,
                        "taskOrder": task_order,
                    }))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            // Get review comments
            let mut comments_stmt = db
                .prepare(
                    "SELECT id, review_id, file_path, line_number, content, ai_response, status, created_at FROM review_comments WHERE review_id = ?1",
                )
                .unwrap();
            let comments: Vec<Value> = comments_stmt
                .query_map(rusqlite::params![review_id], |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "reviewId": row.get::<_, String>(1)?,
                        "filePath": row.get::<_, String>(2)?,
                        "lineNumber": row.get::<_, i64>(3)?,
                        "content": row.get::<_, String>(4)?,
                        "aiResponse": row.get::<_, Option<String>>(5)?,
                        "status": row.get::<_, String>(6)?,
                        "createdAt": row.get::<_, String>(7)?,
                    }))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            let mut r = (*review).clone();
            r["items"] = json!(items);
            r["comments"] = json!(comments);
            r
        })
        .collect();

    Ok(Json(json!(result)))
}

#[derive(Deserialize)]
pub struct CreateReview {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
    #[serde(rename = "type")]
    review_type: Option<String>,
    status: Option<String>,
    content: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateReview>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let plan_id = body.plan_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId and type are required"})),
        )
    })?;
    let review_type = body.review_type.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId and type are required"})),
        )
    })?;

    let id = uuid::Uuid::new_v4().to_string();
    let status = body.status.unwrap_or_else(|| "pending".to_string());
    let content = body.content.unwrap_or_default();

    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO reviews (id, plan_id, type, status, content) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, plan_id, review_type, status, content],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let review = db
        .query_row(
            "SELECT id, plan_id, type, status, content, created_at, updated_at FROM reviews WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "planId": row.get::<_, String>(1)?,
                    "type": row.get::<_, String>(2)?,
                    "status": row.get::<_, String>(3)?,
                    "content": row.get::<_, Option<String>>(4)?,
                    "createdAt": row.get::<_, String>(5)?,
                    "updatedAt": row.get::<_, String>(6)?,
                }))
            },
        )
        .unwrap_or(json!(null));

    Ok((StatusCode::CREATED, Json(review)))
}

#[derive(Deserialize)]
pub struct CancelBody {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
}

pub async fn cancel(
    State(state): State<AppState>,
    Json(body): Json<CancelBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let plan_id = body.plan_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId required"})),
        )
    })?;

    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id FROM reviews WHERE plan_id = ?1 AND status = 'in_progress'")
        .unwrap();
    let in_progress: Vec<String> = stmt
        .query_map(rusqlite::params![plan_id], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    for rid in &in_progress {
        db.execute(
            "UPDATE reviews SET status = 'changes_requested', content = '已取消 / Cancelled', updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![rid],
        )
        .ok();
    }

    Ok(Json(json!({"cancelled": in_progress.len()})))
}
