use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::ai::config::resolve_step_config;
use crate::ai::streaming::generate_ai_call;
use crate::state::AppState;

pub async fn get_config(State(state): State<AppState>) -> Json<Value> {
    let (anthropic, openai, glm) = {
        let db = state.db.lock().unwrap();
        (
            get_provider_status(&db, "anthropic"),
            get_provider_status(&db, "openai"),
            get_provider_status(&db, "glm"),
        )
    };

    let claude = check_cli_status("claude").await;
    let codex = check_cli_status("codex").await;

    Json(json!({
        "anthropic": anthropic,
        "openai": openai,
        "glm": glm,
        "claude": claude,
        "codex": codex,
    }))
}

#[derive(Deserialize)]
pub struct UpdateConfig {
    provider: Option<String>,
    #[serde(rename = "apiKey")]
    api_key: Option<String>,
    #[serde(rename = "baseURL")]
    base_url: Option<String>,
}

pub async fn update_config(
    State(state): State<AppState>,
    Json(body): Json<UpdateConfig>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let provider = body.provider.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "provider is required"})),
        )
    })?;

    if body.api_key.is_none() && body.base_url.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "apiKey or baseURL is required"})),
        ));
    }

    let db = state.db.lock().unwrap();

    if let Some(ref api_key) = body.api_key {
        upsert_setting(&db, &format!("{}_api_key", provider), api_key);
    }

    if let Some(ref base_url) = body.base_url {
        if base_url.is_empty() {
            db.execute(
                "DELETE FROM app_settings WHERE key = ?1",
                rusqlite::params![format!("{}_base_url", provider)],
            )
            .ok();
        } else {
            upsert_setting(&db, &format!("{}_base_url", provider), base_url);
        }
    }

    let status = get_provider_status(&db, &provider);
    Ok(Json(status))
}

fn get_provider_status(db: &rusqlite::Connection, provider: &str) -> Value {
    let api_key = get_setting(db, &format!("{}_api_key", provider));
    let base_url = get_setting(db, &format!("{}_base_url", provider)).unwrap_or_default();

    let configured = api_key.is_some() || !base_url.is_empty();
    let masked = mask_key(api_key.as_deref());
    let mode = if !base_url.is_empty() && api_key.is_some() {
        "proxy"
    } else if api_key.is_some() {
        "apikey"
    } else if !base_url.is_empty() {
        "proxy"
    } else {
        "none"
    };

    json!({
        "configured": configured,
        "masked": masked,
        "baseURL": base_url,
        "mode": mode,
    })
}

fn get_setting(db: &rusqlite::Connection, key: &str) -> Option<String> {
    db.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    )
    .ok()
}

fn upsert_setting(db: &rusqlite::Connection, key: &str, value: &str) {
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
            rusqlite::params![value, key],
        )
        .ok();
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO app_settings (id, key, value) VALUES (?1, ?2, ?3)",
            rusqlite::params![id, key, value],
        )
        .ok();
    }
}

/// Find a command by trying absolute paths, then PATH lookup.
fn find_cmd(name: &str) -> String {
    let candidates = [
        format!("/opt/homebrew/bin/{}", name),
        format!("/usr/local/bin/{}", name),
        format!("/usr/bin/{}", name),
        format!("/bin/{}", name),
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return path.clone();
        }
    }
    // Also check nvm/volta/fnm paths
    if let Some(home) = dirs::home_dir() {
        for dir in &[".nvm/versions/node", ".volta/bin", ".fnm/aliases/default/bin", ".local/bin"] {
            let p = home.join(dir).join(name);
            if p.exists() {
                return p.to_string_lossy().to_string();
            }
        }
        // nvm: find latest node version
        let nvm_dir = home.join(".nvm/versions/node");
        if nvm_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
                let mut versions: Vec<_> = entries.flatten().collect();
                versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
                if let Some(latest) = versions.first() {
                    let p = latest.path().join("bin").join(name);
                    if p.exists() {
                        return p.to_string_lossy().to_string();
                    }
                }
            }
        }
    }
    name.to_string() // fallback to bare name
}

/// Check if a CLI tool (claude/codex) is available for ACP mode.
async fn check_cli_status(tool: &str) -> Value {
    let tool_path = find_cmd(tool);
    let npx_path = find_cmd("npx");

    let direct = tokio::process::Command::new(&tool_path)
        .args(["--version"])
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    let npx_available = tokio::process::Command::new(&npx_path)
        .args(["--version"])
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    let installed = direct || npx_available;

    let direct_err = if !direct {
        tokio::process::Command::new(&tool_path).args(["--version"]).output().await
            .map(|o| String::from_utf8_lossy(&o.stderr).to_string())
            .unwrap_or_else(|e| e.to_string())
    } else { String::new() };

    json!({
        "installed": installed,
        "loggedIn": direct,
        "debug": format!("tool_path={} npx_path={} direct={} npx={} err={}", tool_path, npx_path, direct, npx_available, direct_err)
    })
}

fn mask_key(key: Option<&str>) -> String {
    match key {
        None => String::new(),
        Some(k) => {
            if k.len() <= 8 {
                "***".to_string()
            } else {
                format!("{}***{}", &k[..4], &k[k.len() - 4..])
            }
        }
    }
}

// ---------------------------------------------------------------------------
// POST /api/ai-config/test — Test AI provider connection
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct TestConfigBody {
    provider: Option<String>,
}

pub async fn test_config(
    State(state): State<AppState>,
    Json(body): Json<TestConfigBody>,
) -> Json<Value> {
    let ai_config = {
        let db = state.db.lock().unwrap();
        match resolve_step_config(
            &db,
            "scheme",
            body.provider.as_deref(),
            None,
        ) {
            Ok(c) => c,
            Err(e) => {
                return Json(json!({"success": false, "error": e}));
            }
        }
    };

    let system = "You are a test assistant.".to_string();
    let prompt = "Respond with exactly: OK".to_string();

    match generate_ai_call(&ai_config, &system, &prompt).await {
        Ok(text) => {
            if text.trim().is_empty() {
                Json(json!({"success": false, "error": "Empty response"}))
            } else {
                Json(json!({"success": true}))
            }
        }
        Err(e) => Json(json!({"success": false, "error": e})),
    }
}
