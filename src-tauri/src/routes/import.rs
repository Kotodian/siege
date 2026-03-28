use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

pub async fn list(State(state): State<AppState>) -> Json<Value> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, source, config, enabled, created_at FROM import_configs")
        .unwrap();
    let configs: Vec<Value> = stmt
        .query_map([], |row| {
            let config_str: String = row.get(2)?;
            let masked = mask_import_config(&config_str);
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "source": row.get::<_, String>(1)?,
                "config": masked,
                "enabled": row.get::<_, bool>(3)?,
                "createdAt": row.get::<_, String>(4)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    Json(json!(configs))
}

#[derive(Deserialize)]
pub struct CreateImport {
    source: Option<String>,
    config: Option<Value>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateImport>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let source = body.source.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "source and config are required"})),
        )
    })?;
    let config = body.config.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "source and config are required"})),
        )
    })?;

    let valid_sources = [
        "notion", "jira", "confluence", "mcp", "feishu", "github", "gitlab",
    ];
    if !valid_sources.contains(&source.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Invalid source: {}", source)})),
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let config_str = serde_json::to_string(&config).unwrap_or_else(|_| "{}".to_string());

    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO import_configs (id, source, config) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, source, config_str],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let created = db
        .query_row(
            "SELECT id, source, config, enabled, created_at FROM import_configs WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "source": row.get::<_, String>(1)?,
                    "config": row.get::<_, String>(2)?,
                    "enabled": row.get::<_, bool>(3)?,
                    "createdAt": row.get::<_, String>(4)?,
                }))
            },
        )
        .unwrap_or(json!(null));

    Ok((StatusCode::CREATED, Json(created)))
}

#[derive(Deserialize)]
pub struct DeleteParams {
    id: Option<String>,
}

pub async fn delete_one(
    State(state): State<AppState>,
    Query(params): Query<DeleteParams>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let id = params.id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "id is required"})),
        )
    })?;

    let db = state.db.lock().unwrap();
    db.execute(
        "DELETE FROM import_configs WHERE id = ?1",
        rusqlite::params![id],
    )
    .ok();

    Ok(Json(json!({"success": true})))
}

fn mask_import_config(config_str: &str) -> Value {
    if let Ok(parsed) = serde_json::from_str::<Value>(config_str) {
        if let Some(obj) = parsed.as_object() {
            let mut masked = serde_json::Map::new();
            for (key, value) in obj {
                if key.contains("key") || key.contains("token") || key.contains("password") {
                    if let Some(s) = value.as_str() {
                        if s.len() > 8 {
                            masked.insert(
                                key.clone(),
                                json!(format!("{}****{}", &s[..4], &s[s.len() - 4..])),
                            );
                        } else {
                            masked.insert(key.clone(), json!("****"));
                        }
                    } else {
                        masked.insert(key.clone(), json!("****"));
                    }
                } else {
                    masked.insert(key.clone(), value.clone());
                }
            }
            return Value::Object(masked);
        }
        parsed
    } else {
        json!({})
    }
}
