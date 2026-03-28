use axum::{
    extract::State,
    Json,
};
use serde_json::{json, Value};

use crate::state::AppState;

const ALLOWED_SETTINGS: &[&str] = &[
    "default_provider",
    "default_model",
    "default_model_anthropic",
    "default_model_openai",
    "default_model_glm",
    "archive_after_days",
    "cleanup_after_days",
    "step_provider_scheme",
    "step_model_scheme",
    "step_provider_review",
    "step_model_review",
    "step_provider_schedule",
    "step_model_schedule",
    "step_provider_execute",
    "step_model_execute",
    "step_provider_test",
    "step_model_test",
    "step_provider_skills",
    "step_model_skills",
];

pub async fn list(State(state): State<AppState>) -> Json<Value> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT key, value FROM app_settings").unwrap();
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
            ))
        })
        .unwrap();

    let mut result = serde_json::Map::new();
    for row in rows.flatten() {
        result.insert(row.0, json!(row.1));
    }
    Json(Value::Object(result))
}

pub async fn update(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();

    if let Value::Object(map) = body {
        for (key, value) in map {
            if !ALLOWED_SETTINGS.contains(&key.as_str()) {
                continue;
            }
            let value_str = match value {
                Value::String(s) => s,
                other => other.to_string(),
            };

            let existing: Option<String> = db
                .query_row(
                    "SELECT id FROM app_settings WHERE key = ?1",
                    rusqlite::params![key],
                    |row| row.get(0),
                )
                .ok();

            if existing.is_some() {
                db.execute(
                    "UPDATE app_settings SET value = ?1 WHERE key = ?2",
                    rusqlite::params![value_str, key],
                )
                .ok();
            } else {
                let id = uuid::Uuid::new_v4().to_string();
                db.execute(
                    "INSERT INTO app_settings (id, key, value) VALUES (?1, ?2, ?3)",
                    rusqlite::params![id, key, value_str],
                )
                .ok();
            }
        }
    }

    Json(json!({"ok": true}))
}
