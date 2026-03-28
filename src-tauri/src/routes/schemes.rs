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
    let mut stmt = db
        .prepare(
            "SELECT id, plan_id, title, content, structured_content, source_type, search_results, created_at, updated_at
             FROM schemes WHERE plan_id = ?1 ORDER BY created_at DESC",
        )
        .unwrap();
    let rows = stmt
        .query_map(rusqlite::params![plan_id], |row| Ok(scheme_from_row(row)))
        .unwrap();
    let items: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(Json(json!(items)))
}

#[derive(Deserialize)]
pub struct CreateScheme {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
    title: Option<String>,
    content: Option<String>,
    #[serde(rename = "sourceType")]
    source_type: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateScheme>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let plan_id = body.plan_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId and title are required"})),
        )
    })?;
    let title = body.title.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId and title are required"})),
        )
    })?;

    let db = state.db.lock().unwrap();

    // Check plan status
    let plan_status: String = db
        .query_row(
            "SELECT status FROM plans WHERE id = ?1",
            rusqlite::params![plan_id],
            |row| row.get(0),
        )
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Plan not found"})),
            )
        })?;

    if ["confirmed", "scheduled", "executing"].contains(&plan_status.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Cannot add schemes to a confirmed/scheduled/executing plan"})),
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let content = body.content.unwrap_or_default();
    let source_type = body.source_type.unwrap_or_else(|| "manual".to_string());

    db.execute(
        "INSERT INTO schemes (id, plan_id, title, content, source_type) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, plan_id, title, content, source_type],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    // Transition plan from draft to reviewing
    if plan_status == "draft" {
        db.execute(
            "UPDATE plans SET status = 'reviewing', updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![plan_id],
        )
        .ok();
    }

    let scheme = query_scheme(&db, &id);
    Ok((StatusCode::CREATED, Json(scheme)))
}

pub async fn get_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let db = state.db.lock().unwrap();
    let scheme = db
        .query_row(
            "SELECT id, plan_id, title, content, structured_content, source_type, search_results, created_at, updated_at FROM schemes WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok(scheme_from_row(row)),
        )
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Scheme not found"})),
            )
        })?;
    Ok(Json(scheme))
}

#[derive(Deserialize)]
pub struct UpdateScheme {
    title: Option<String>,
    content: Option<String>,
    #[serde(rename = "structuredContent")]
    structured_content: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateScheme>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();

    // Save current version before update
    if body.title.is_some() || body.content.is_some() || body.structured_content.is_some() {
        save_scheme_version(&db, &id);
    }

    let mut sets = vec!["updated_at = datetime('now')".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(ref v) = body.title {
        sets.push(format!("title = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.content {
        sets.push(format!("content = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.structured_content {
        sets.push(format!("structured_content = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }

    let sql = format!("UPDATE schemes SET {} WHERE id = ?{}", sets.join(", "), idx);
    params.push(Box::new(id.clone()));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    db.execute(&sql, param_refs.as_slice()).ok();

    let scheme = query_scheme(&db, &id);
    Json(scheme)
}

pub async fn delete_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM schemes WHERE id = ?1", rusqlite::params![id])
        .ok();
    Json(json!({"ok": true}))
}

pub async fn list_versions(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, scheme_id, version, title, content, created_at FROM scheme_versions WHERE scheme_id = ?1 ORDER BY version DESC",
        )
        .unwrap();
    let rows = stmt
        .query_map(rusqlite::params![id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "schemeId": row.get::<_, String>(1)?,
                "version": row.get::<_, i64>(2)?,
                "title": row.get::<_, String>(3)?,
                "content": row.get::<_, Option<String>>(4)?,
                "createdAt": row.get::<_, String>(5)?,
            }))
        })
        .unwrap();
    let items: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Json(json!(items))
}

fn save_scheme_version(db: &rusqlite::Connection, scheme_id: &str) {
    let scheme = db.query_row(
        "SELECT title, content FROM schemes WHERE id = ?1",
        rusqlite::params![scheme_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        },
    );

    if let Ok((title, content)) = scheme {
        let latest_version: i64 = db
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM scheme_versions WHERE scheme_id = ?1",
                rusqlite::params![scheme_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let vid = uuid::Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO scheme_versions (id, scheme_id, version, title, content) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![vid, scheme_id, latest_version + 1, title, content.unwrap_or_default()],
        )
        .ok();
    }
}

fn scheme_from_row(row: &rusqlite::Row) -> Value {
    json!({
        "id": row.get::<_, String>(0).unwrap_or_default(),
        "planId": row.get::<_, String>(1).unwrap_or_default(),
        "title": row.get::<_, String>(2).unwrap_or_default(),
        "content": row.get::<_, Option<String>>(3).unwrap_or_default(),
        "structuredContent": row.get::<_, Option<String>>(4).unwrap_or_default(),
        "sourceType": row.get::<_, String>(5).unwrap_or_default(),
        "searchResults": row.get::<_, Option<String>>(6).unwrap_or_default(),
        "createdAt": row.get::<_, String>(7).unwrap_or_default(),
        "updatedAt": row.get::<_, String>(8).unwrap_or_default(),
    })
}

fn query_scheme(db: &rusqlite::Connection, id: &str) -> Value {
    db.query_row(
        "SELECT id, plan_id, title, content, structured_content, source_type, search_results, created_at, updated_at FROM schemes WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(scheme_from_row(row)),
    )
    .unwrap_or(json!(null))
}
