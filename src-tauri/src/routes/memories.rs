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
) -> Json<Value> {
    let db = state.db.lock().unwrap();

    let items: Vec<Value> = if let Some(ref project_id) = params.project_id {
        let mut stmt = db
            .prepare(
                "SELECT id, project_id, type, title, content, source, created_at, updated_at FROM memories WHERE project_id = ?1 OR project_id IS NULL",
            )
            .unwrap();
        stmt.query_map(rusqlite::params![project_id], |row| {
            Ok(memory_from_row(row))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    } else {
        let mut stmt = db
            .prepare(
                "SELECT id, project_id, type, title, content, source, created_at, updated_at FROM memories WHERE project_id IS NULL",
            )
            .unwrap();
        stmt.query_map([], |row| Ok(memory_from_row(row)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    };

    Json(json!(items))
}

#[derive(Deserialize)]
pub struct CreateMemory {
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    #[serde(rename = "type")]
    memory_type: Option<String>,
    title: Option<String>,
    content: Option<String>,
    source: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateMemory>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let title = body.title.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "title and content required"})),
        )
    })?;
    let content = body.content.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "title and content required"})),
        )
    })?;

    let id = uuid::Uuid::new_v4().to_string();
    let memory_type = body.memory_type.unwrap_or_else(|| "project".to_string());
    let source = body.source.unwrap_or_else(|| "manual".to_string());

    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO memories (id, project_id, type, title, content, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, body.project_id, memory_type, title, content, source],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    Ok((StatusCode::CREATED, Json(json!({"id": id}))))
}

pub async fn get_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let db = state.db.lock().unwrap();
    let memory = db
        .query_row(
            "SELECT id, project_id, type, title, content, source, created_at, updated_at FROM memories WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok(memory_from_row(row)),
        )
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Memory not found"})),
            )
        })?;
    Ok(Json(memory))
}

#[derive(Deserialize)]
pub struct UpdateMemory {
    title: Option<String>,
    content: Option<String>,
    #[serde(rename = "type")]
    memory_type: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateMemory>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
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
    if let Some(ref v) = body.memory_type {
        sets.push(format!("type = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }

    let sql = format!(
        "UPDATE memories SET {} WHERE id = ?{}",
        sets.join(", "),
        idx
    );
    params.push(Box::new(id.clone()));
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    db.execute(&sql, param_refs.as_slice()).ok();

    Json(json!({"ok": true}))
}

pub async fn delete_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM memories WHERE id = ?1", rusqlite::params![id])
        .ok();
    Json(json!({"ok": true}))
}

fn memory_from_row(row: &rusqlite::Row) -> Value {
    json!({
        "id": row.get::<_, String>(0).unwrap_or_default(),
        "projectId": row.get::<_, Option<String>>(1).unwrap_or_default(),
        "type": row.get::<_, String>(2).unwrap_or_default(),
        "title": row.get::<_, String>(3).unwrap_or_default(),
        "content": row.get::<_, String>(4).unwrap_or_default(),
        "source": row.get::<_, String>(5).unwrap_or_default(),
        "createdAt": row.get::<_, String>(6).unwrap_or_default(),
        "updatedAt": row.get::<_, String>(7).unwrap_or_default(),
    })
}
