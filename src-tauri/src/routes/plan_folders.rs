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
    #[serde(rename = "parentId")]
    parent_id: Option<String>,
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

    let folders: Vec<Value> = if let Some(ref parent_id) = params.parent_id {
        let mut stmt = db
            .prepare("SELECT id, project_id, parent_id, name, created_at FROM plan_folders WHERE project_id = ?1 AND parent_id = ?2")
            .unwrap();
        stmt.query_map(rusqlite::params![project_id, parent_id], |row| {
            Ok(folder_from_row(row))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    } else {
        let mut stmt = db
            .prepare("SELECT id, project_id, parent_id, name, created_at FROM plan_folders WHERE project_id = ?1 AND parent_id IS NULL")
            .unwrap();
        stmt.query_map(rusqlite::params![project_id], |row| {
            Ok(folder_from_row(row))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    };

    let plans: Vec<Value> = if let Some(ref parent_id) = params.parent_id {
        let mut stmt = db
            .prepare(
                "SELECT id, project_id, name, description, status, tag, session_id, folder_id, archived_at, created_at, updated_at
                 FROM plans WHERE project_id = ?1 AND folder_id = ?2 ORDER BY updated_at DESC",
            )
            .unwrap();
        stmt.query_map(rusqlite::params![project_id, parent_id], |row| {
            Ok(plan_from_row(row))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    } else {
        let mut stmt = db
            .prepare(
                "SELECT id, project_id, name, description, status, tag, session_id, folder_id, archived_at, created_at, updated_at
                 FROM plans WHERE project_id = ?1 AND folder_id IS NULL ORDER BY updated_at DESC",
            )
            .unwrap();
        stmt.query_map(rusqlite::params![project_id], |row| {
            Ok(plan_from_row(row))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    };

    Ok(Json(json!({"folders": folders, "plans": plans})))
}

#[derive(Deserialize)]
pub struct CreateFolder {
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    name: Option<String>,
    #[serde(rename = "parentId")]
    parent_id: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateFolder>,
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

    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO plan_folders (id, project_id, name, parent_id) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, project_id, name, body.parent_id],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let folder = query_folder(&db, &id);
    Ok((StatusCode::CREATED, Json(folder)))
}

#[derive(Deserialize)]
pub struct UpdateFolder {
    name: Option<String>,
    #[serde(rename = "parentId")]
    parent_id: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateFolder>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(ref v) = body.name {
        sets.push(format!("name = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.parent_id {
        sets.push(format!("parent_id = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }

    if !sets.is_empty() {
        let sql = format!(
            "UPDATE plan_folders SET {} WHERE id = ?{}",
            sets.join(", "),
            idx
        );
        params.push(Box::new(id.clone()));
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        db.execute(&sql, param_refs.as_slice()).ok();
    }

    let folder = query_folder(&db, &id);
    Json(folder)
}

pub async fn delete_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    db.execute(
        "DELETE FROM plan_folders WHERE id = ?1",
        rusqlite::params![id],
    )
    .ok();
    Json(json!({"ok": true}))
}

fn folder_from_row(row: &rusqlite::Row) -> Value {
    json!({
        "id": row.get::<_, String>(0).unwrap_or_default(),
        "projectId": row.get::<_, String>(1).unwrap_or_default(),
        "parentId": row.get::<_, Option<String>>(2).unwrap_or_default(),
        "name": row.get::<_, String>(3).unwrap_or_default(),
        "createdAt": row.get::<_, String>(4).unwrap_or_default(),
    })
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

fn query_folder(db: &rusqlite::Connection, id: &str) -> Value {
    db.query_row(
        "SELECT id, project_id, parent_id, name, created_at FROM plan_folders WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(folder_from_row(row)),
    )
    .unwrap_or(json!(null))
}
