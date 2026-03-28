use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::remote::ssh::{SshConfig, check_connection};
use crate::state::AppState;

pub async fn list(State(state): State<AppState>) -> Json<Value> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, name, icon, description, guidelines, session_id, target_repo_path, created_at, updated_at,
                    remote_host, remote_user, remote_repo_path, remote_enabled
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
                "remoteHost": row.get::<_, Option<String>>(9)?,
                "remoteUser": row.get::<_, Option<String>>(10)?,
                "remoteRepoPath": row.get::<_, Option<String>>(11)?,
                "remoteEnabled": row.get::<_, bool>(12)?,
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
    #[serde(rename = "remoteHost")]
    remote_host: Option<String>,
    #[serde(rename = "remoteUser")]
    remote_user: Option<String>,
    #[serde(rename = "remoteRepoPath")]
    remote_repo_path: Option<String>,
    #[serde(rename = "remoteEnabled")]
    remote_enabled: Option<bool>,
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
    let icon = body.icon.unwrap_or_else(|| "\u{1F4C1}".to_string());
    let description = body.description.unwrap_or_default();
    let guidelines = body.guidelines.unwrap_or_default();
    let remote_host = body.remote_host;
    let remote_user = body.remote_user;
    let remote_repo_path = body.remote_repo_path;
    let remote_enabled = body.remote_enabled.unwrap_or(false);

    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO projects (id, name, icon, description, guidelines, target_repo_path, remote_host, remote_user, remote_repo_path, remote_enabled) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![id, name, icon, description, guidelines, target_repo_path, remote_host, remote_user, remote_repo_path, remote_enabled],
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
            "SELECT id, name, icon, description, guidelines, session_id, target_repo_path, created_at, updated_at,
                    remote_host, remote_user, remote_repo_path, remote_enabled
             FROM projects WHERE id = ?1",
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
                    "remoteHost": row.get::<_, Option<String>>(9)?,
                    "remoteUser": row.get::<_, Option<String>>(10)?,
                    "remoteRepoPath": row.get::<_, Option<String>>(11)?,
                    "remoteEnabled": row.get::<_, bool>(12)?,
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
    #[serde(rename = "remoteHost")]
    remote_host: Option<String>,
    #[serde(rename = "remoteUser")]
    remote_user: Option<String>,
    #[serde(rename = "remoteRepoPath")]
    remote_repo_path: Option<String>,
    #[serde(rename = "remoteEnabled")]
    remote_enabled: Option<bool>,
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
    if let Some(ref v) = body.remote_host {
        sets.push(format!("remote_host = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.remote_user {
        sets.push(format!("remote_user = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.remote_repo_path {
        sets.push(format!("remote_repo_path = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(v) = body.remote_enabled {
        sets.push(format!("remote_enabled = ?{}", idx));
        params.push(Box::new(v));
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

pub async fn test_connection(
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let host = body.get("remoteHost").and_then(|v| v.as_str()).unwrap_or("");
    let user = body.get("remoteUser").and_then(|v| v.as_str()).unwrap_or("root");

    if host.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "remoteHost is required"})),
        );
    }

    let config = SshConfig {
        host: host.to_string(),
        user: user.to_string(),
        repo_path: "/tmp".to_string(),
    };

    match check_connection(&config).await {
        Ok(output) => (
            StatusCode::OK,
            Json(json!({
                "status": "connected",
                "hostname": output.trim()
            })),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(json!({
                "status": "failed",
                "error": e
            })),
        ),
    }
}

fn query_project(db: &rusqlite::Connection, id: &str) -> Value {
    db.query_row(
        "SELECT id, name, icon, description, guidelines, session_id, target_repo_path, created_at, updated_at,
                remote_host, remote_user, remote_repo_path, remote_enabled
         FROM projects WHERE id = ?1",
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
                "remoteHost": row.get::<_, Option<String>>(9)?,
                "remoteUser": row.get::<_, Option<String>>(10)?,
                "remoteRepoPath": row.get::<_, Option<String>>(11)?,
                "remoteEnabled": row.get::<_, bool>(12)?,
            }))
        },
    )
    .unwrap_or(json!(null))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_connection_empty_host_returns_400() {
        let body = json!({});
        let (status, json) = test_connection(Json(body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json.0["error"], "remoteHost is required");
    }

    #[tokio::test]
    async fn test_connection_blank_host_returns_400() {
        let body = json!({"remoteHost": ""});
        let (status, json) = test_connection(Json(body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json.0["error"], "remoteHost is required");
    }

    #[tokio::test]
    async fn test_connection_unreachable_host_returns_failed() {
        let body = json!({"remoteHost": "192.0.2.1", "remoteUser": "nobody"});
        let (status, json) = test_connection(Json(body)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json.0["status"], "failed");
        assert!(json.0["error"].is_string());
    }

    #[test]
    fn test_create_project_struct_deserialize() {
        let json_str = r#"{
            "name": "test",
            "targetRepoPath": "/tmp",
            "remoteHost": "my-host",
            "remoteUser": "deploy",
            "remoteRepoPath": "/opt/app",
            "remoteEnabled": true
        }"#;
        let project: CreateProject = serde_json::from_str(json_str).unwrap();
        assert_eq!(project.name.unwrap(), "test");
        assert_eq!(project.remote_host.unwrap(), "my-host");
        assert_eq!(project.remote_user.unwrap(), "deploy");
        assert_eq!(project.remote_repo_path.unwrap(), "/opt/app");
        assert_eq!(project.remote_enabled.unwrap(), true);
    }

    #[test]
    fn test_update_project_struct_deserialize() {
        let json_str = r#"{
            "remoteHost": "new-host",
            "remoteEnabled": false
        }"#;
        let project: UpdateProject = serde_json::from_str(json_str).unwrap();
        assert_eq!(project.remote_host.unwrap(), "new-host");
        assert_eq!(project.remote_enabled.unwrap(), false);
        assert!(project.name.is_none());
        assert!(project.remote_user.is_none());
    }
}
