use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

pub async fn list(State(state): State<AppState>) -> Json<Value> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, name, icon, description, guidelines, session_id, target_repo_path, created_at, updated_at
             FROM projects ORDER BY created_at DESC",
        )
        .unwrap();
    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "icon": row.get::<_, Option<String>>(2)?,
                "description": row.get::<_, Option<String>>(3)?,
                "guidelines": row.get::<_, Option<String>>(4)?,
                "sessionId": row.get::<_, Option<String>>(5)?,
                "targetRepoPath": row.get::<_, String>(6)?,
                "createdAt": row.get::<_, String>(7)?,
                "updatedAt": row.get::<_, String>(8)?,
            }))
        })
        .unwrap();
    let items: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Json(json!(items))
}

#[derive(Deserialize)]
pub struct CreateProject {
    name: Option<String>,
    icon: Option<String>,
    description: Option<String>,
    guidelines: Option<String>,
    #[serde(rename = "targetRepoPath")]
    target_repo_path: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateProject>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let name = body.name.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "name and targetRepoPath are required"})),
        )
    })?;
    let target_repo_path = body.target_repo_path.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "name and targetRepoPath are required"})),
        )
    })?;

    let id = uuid::Uuid::new_v4().to_string();
    let icon = body.icon.unwrap_or_else(|| "📁".to_string());
    let description = body.description.unwrap_or_default();
    let guidelines = body.guidelines.unwrap_or_default();

    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO projects (id, name, icon, description, guidelines, target_repo_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, name, icon, description, guidelines, target_repo_path],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let project = query_project(&db, &id);
    Ok((StatusCode::CREATED, Json(project)))
}

pub async fn get_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let db = state.db.lock().unwrap();
    let project = db
        .query_row(
            "SELECT id, name, icon, description, guidelines, session_id, target_repo_path, created_at, updated_at FROM projects WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "icon": row.get::<_, Option<String>>(2)?,
                    "description": row.get::<_, Option<String>>(3)?,
                    "guidelines": row.get::<_, Option<String>>(4)?,
                    "sessionId": row.get::<_, Option<String>>(5)?,
                    "targetRepoPath": row.get::<_, String>(6)?,
                    "createdAt": row.get::<_, String>(7)?,
                    "updatedAt": row.get::<_, String>(8)?,
                }))
            },
        )
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Project not found"})),
            )
        })?;
    Ok(Json(project))
}

#[derive(Deserialize)]
pub struct UpdateProject {
    name: Option<String>,
    icon: Option<String>,
    description: Option<String>,
    guidelines: Option<String>,
    #[serde(rename = "targetRepoPath")]
    target_repo_path: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateProject>,
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
    if let Some(ref v) = body.icon {
        sets.push(format!("icon = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.description {
        sets.push(format!("description = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.guidelines {
        sets.push(format!("guidelines = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.target_repo_path {
        sets.push(format!("target_repo_path = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }

    let sql = format!(
        "UPDATE projects SET {} WHERE id = ?{}",
        sets.join(", "),
        idx
    );
    params.push(Box::new(id.clone()));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    db.execute(&sql, param_refs.as_slice()).ok();

    let project = query_project(&db, &id);
    Json(project)
}

pub async fn delete_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])
        .ok();
    Json(json!({"ok": true}))
}

fn query_project(db: &rusqlite::Connection, id: &str) -> Value {
    db.query_row(
        "SELECT id, name, icon, description, guidelines, session_id, target_repo_path, created_at, updated_at FROM projects WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "icon": row.get::<_, Option<String>>(2)?,
                "description": row.get::<_, Option<String>>(3)?,
                "guidelines": row.get::<_, Option<String>>(4)?,
                "sessionId": row.get::<_, Option<String>>(5)?,
                "targetRepoPath": row.get::<_, String>(6)?,
                "createdAt": row.get::<_, String>(7)?,
                "updatedAt": row.get::<_, String>(8)?,
            }))
        },
    )
    .unwrap_or(json!(null))
}
