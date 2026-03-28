use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

#[derive(Deserialize)]
pub struct ListParams {
    #[serde(rename = "projectId")]
    project_id: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let project_id = params.project_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "projectId is required"})),
        )
    })?;

    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, project_id, name, description, status, tag, session_id, folder_id, archived_at, created_at, updated_at
             FROM plans WHERE project_id = ?1 ORDER BY created_at DESC",
        )
        .unwrap();
    let rows = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(plan_from_row(row))
        })
        .unwrap();
    let items: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(Json(json!(items)))
}

#[derive(Deserialize)]
pub struct CreatePlan {
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    name: Option<String>,
    description: Option<String>,
    tag: Option<String>,
    #[serde(rename = "folderId")]
    folder_id: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreatePlan>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let project_id = body.project_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "projectId and name are required"})),
        )
    })?;
    let name = body.name.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "projectId and name are required"})),
        )
    })?;

    let id = uuid::Uuid::new_v4().to_string();
    let description = body.description.unwrap_or_default();
    let tag = body.tag.unwrap_or_else(|| "feature".to_string());
    let folder_id = body.folder_id;

    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO plans (id, project_id, name, description, status, tag, folder_id) VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?6)",
        rusqlite::params![id, project_id, name, description, tag, folder_id],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let plan = query_plan(&db, &id);
    Ok((StatusCode::CREATED, Json(plan)))
}

pub async fn get_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let db = state.db.lock().unwrap();
    let plan = db
        .query_row(
            "SELECT id, project_id, name, description, status, tag, session_id, folder_id, archived_at, created_at, updated_at FROM plans WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok(plan_from_row(row)),
        )
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Plan not found"})),
            )
        })?;
    Ok(Json(plan))
}

#[derive(Deserialize)]
pub struct UpdatePlan {
    name: Option<String>,
    description: Option<String>,
    status: Option<String>,
    tag: Option<String>,
    #[serde(rename = "folderId")]
    folder_id: Option<String>,
    #[serde(rename = "archivedAt")]
    archived_at: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdatePlan>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    let mut sets = vec!["updated_at = datetime('now')".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(ref v) = body.name {
        sets.push(format!("name = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.description {
        sets.push(format!("description = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.status {
        sets.push(format!("status = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.tag {
        sets.push(format!("tag = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.folder_id {
        sets.push(format!("folder_id = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.archived_at {
        sets.push(format!("archived_at = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }

    let sql = format!("UPDATE plans SET {} WHERE id = ?{}", sets.join(", "), idx);
    params.push(Box::new(id.clone()));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    db.execute(&sql, param_refs.as_slice()).ok();

    let plan = query_plan(&db, &id);
    Json(plan)
}

pub async fn delete_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM plans WHERE id = ?1", rusqlite::params![id])
        .ok();
    Json(json!({"ok": true}))
}

#[derive(Deserialize)]
pub struct ConfirmBody {
    action: Option<String>,
}

pub async fn confirm(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ConfirmBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let action = body.action.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "action must be 'confirm' or 'revoke'"})),
        )
    })?;

    let db = state.db.lock().unwrap();
    let plan = db
        .query_row(
            "SELECT id, status FROM plans WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                ))
            },
        )
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Plan not found"})),
            )
        })?;

    let status = plan.1;

    match action.as_str() {
        "confirm" => {
            if status != "reviewing" {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "Plan must be in reviewing status to confirm"})),
                ));
            }

            let scheme_count: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM schemes WHERE plan_id = ?1",
                    rusqlite::params![id],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            if scheme_count == 0 {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "Plan must have at least one scheme to confirm"})),
                ));
            }

            db.execute(
                "UPDATE plans SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?1",
                rusqlite::params![id],
            )
            .ok();

            // Mark all unresolved scheme review findings as resolved
            let mut stmt = db
                .prepare("SELECT id, status FROM reviews WHERE plan_id = ?1 AND type = 'scheme'")
                .unwrap();
            let reviews: Vec<(String, String)> = stmt
                .query_map(rusqlite::params![id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            for (review_id, review_status) in &reviews {
                db.execute(
                    "UPDATE review_items SET resolved = 1 WHERE review_id = ?1 AND resolved = 0",
                    rusqlite::params![review_id],
                )
                .ok();
                if review_status != "approved" {
                    db.execute(
                        "UPDATE reviews SET status = 'approved', updated_at = datetime('now') WHERE id = ?1",
                        rusqlite::params![review_id],
                    )
                    .ok();
                }
            }
        }
        "revoke" => {
            if status != "confirmed" {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "Plan must be in confirmed status to revoke"})),
                ));
            }
            db.execute(
                "UPDATE plans SET status = 'reviewing', updated_at = datetime('now') WHERE id = ?1",
                rusqlite::params![id],
            )
            .ok();
        }
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "action must be 'confirm' or 'revoke'"})),
            ));
        }
    }

    let updated = query_plan(&db, &id);
    Ok(Json(updated))
}

#[derive(Deserialize)]
pub struct ReviewActionBody {
    action: Option<String>,
}

pub async fn review_action(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ReviewActionBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let action = body.action.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "action must be 'accept' or 'rework'"})),
        )
    })?;

    if action != "accept" && action != "rework" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "action must be 'accept' or 'rework'"})),
        ));
    }

    let db = state.db.lock().unwrap();
    let _plan = db
        .query_row(
            "SELECT id FROM plans WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Plan not found"})),
            )
        })?;

    if action == "accept" {
        db.execute(
            "UPDATE plans SET status = 'testing', updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![id],
        )
        .ok();
        return Ok(Json(json!({"status": "testing"})));
    }

    // rework
    db.execute(
        "UPDATE plans SET status = 'executing', updated_at = datetime('now') WHERE id = ?1",
        rusqlite::params![id],
    )
    .ok();
    Ok(Json(json!({"status": "executing"})))
}

fn plan_from_row(row: &rusqlite::Row) -> Value {
    json!({
        "id": row.get::<_, String>(0).unwrap_or_default(),
        "projectId": row.get::<_, String>(1).unwrap_or_default(),
        "name": row.get::<_, String>(2).unwrap_or_default(),
        "description": row.get::<_, Option<String>>(3).unwrap_or_default(),
        "status": row.get::<_, String>(4).unwrap_or_default(),
        "tag": row.get::<_, Option<String>>(5).unwrap_or_default(),
        "sessionId": row.get::<_, Option<String>>(6).unwrap_or_default(),
        "folderId": row.get::<_, Option<String>>(7).unwrap_or_default(),
        "archivedAt": row.get::<_, Option<String>>(8).unwrap_or_default(),
        "createdAt": row.get::<_, String>(9).unwrap_or_default(),
        "updatedAt": row.get::<_, String>(10).unwrap_or_default(),
    })
}

fn query_plan(db: &rusqlite::Connection, id: &str) -> Value {
    db.query_row(
        "SELECT id, project_id, name, description, status, tag, session_id, folder_id, archived_at, created_at, updated_at FROM plans WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(plan_from_row(row)),
    )
    .unwrap_or(json!(null))
}
