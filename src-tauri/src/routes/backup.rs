use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

pub async fn list(State(state): State<AppState>) -> Json<Value> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, backend, config, schedule_cron, enabled, created_at FROM backup_configs")
        .unwrap();
    let configs: Vec<Value> = stmt
        .query_map([], |row| {
            let config_id: String = row.get(0)?;
            let config_str: String = row.get::<_, String>(2)?;

            // Mask secrets
            let masked = mask_config_secrets(&config_str);

            Ok((config_id, json!({
                "id": row.get::<_, String>(0)?,
                "backend": row.get::<_, String>(1)?,
                "config": masked,
                "scheduleCron": row.get::<_, String>(3)?,
                "enabled": row.get::<_, bool>(4)?,
                "createdAt": row.get::<_, String>(5)?,
            })))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .map(|(config_id, mut config)| {
            // Get recent history
            let mut hist_stmt = db
                .prepare(
                    "SELECT id, backup_config_id, started_at, completed_at, status, items_count, error_message FROM backup_history WHERE backup_config_id = ?1 ORDER BY started_at DESC LIMIT 5",
                )
                .unwrap();
            let history: Vec<Value> = hist_stmt
                .query_map(rusqlite::params![config_id], |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "backupConfigId": row.get::<_, String>(1)?,
                        "startedAt": row.get::<_, String>(2)?,
                        "completedAt": row.get::<_, Option<String>>(3)?,
                        "status": row.get::<_, String>(4)?,
                        "itemsCount": row.get::<_, Option<i64>>(5)?,
                        "errorMessage": row.get::<_, Option<String>>(6)?,
                    }))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();
            config["history"] = json!(history);
            config
        })
        .collect();

    Json(json!(configs))
}

#[derive(Deserialize)]
pub struct CreateBackup {
    backend: Option<String>,
    config: Option<Value>,
    #[serde(rename = "scheduleCron")]
    schedule_cron: Option<String>,
    enabled: Option<bool>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateBackup>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let backend = body.backend.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "backend is required"})),
        )
    })?;

    let id = uuid::Uuid::new_v4().to_string();
    let config_str = serde_json::to_string(&body.config.unwrap_or(json!({}))).unwrap_or_else(|_| "{}".to_string());
    let schedule_cron = body.schedule_cron.unwrap_or_else(|| "0 2 * * *".to_string());
    let enabled = body.enabled.unwrap_or(true);

    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO backup_configs (id, backend, config, schedule_cron, enabled) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, backend, config_str, schedule_cron, enabled],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let created = db
        .query_row(
            "SELECT id, backend, config, schedule_cron, enabled, created_at FROM backup_configs WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "backend": row.get::<_, String>(1)?,
                    "config": row.get::<_, String>(2)?,
                    "scheduleCron": row.get::<_, String>(3)?,
                    "enabled": row.get::<_, bool>(4)?,
                    "createdAt": row.get::<_, String>(5)?,
                }))
            },
        )
        .unwrap_or(json!(null));

    Ok((StatusCode::CREATED, Json(created)))
}

#[derive(Deserialize)]
pub struct TriggerBackup {
    #[serde(rename = "configId")]
    config_id: Option<String>,
}

pub async fn trigger(
    State(state): State<AppState>,
    Json(body): Json<TriggerBackup>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let config_id = body.config_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "configId is required"})),
        )
    })?;

    let db = state.db.lock().unwrap();
    // Verify config exists
    db.query_row(
        "SELECT id FROM backup_configs WHERE id = ?1",
        rusqlite::params![config_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Backup config not found"})),
        )
    })?;

    // In Tauri, actual backup execution would be handled differently
    // For now, return ok
    Ok(Json(json!({"ok": true})))
}

fn mask_config_secrets(config_str: &str) -> String {
    if let Ok(mut parsed) = serde_json::from_str::<Value>(config_str) {
        if let Some(obj) = parsed.as_object_mut() {
            if obj.contains_key("api_key") {
                obj.insert("api_key".to_string(), json!("***"));
            }
        }
        serde_json::to_string(&parsed).unwrap_or_else(|_| config_str.to_string())
    } else {
        config_str.to_string()
    }
}
