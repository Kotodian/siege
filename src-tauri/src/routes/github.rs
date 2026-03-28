use axum::{extract::Query, http::StatusCode, Json};
use octocrab::Octocrab;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::utils::git as git_utils;

/// Try to read a GitHub token from environment variables or gh CLI config.
fn get_github_token() -> Option<String> {
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        if !token.is_empty() { return Some(token); }
    }
    if let Ok(token) = std::env::var("GH_TOKEN") {
        if !token.is_empty() { return Some(token); }
    }
    // Read from gh CLI config (~/.config/gh/hosts.yml)
    if let Some(config_dir) = dirs::config_dir() {
        let hosts_path = config_dir.join("gh").join("hosts.yml");
        if let Ok(contents) = std::fs::read_to_string(&hosts_path) {
            for line in contents.lines() {
                let trimmed = line.trim();
                if let Some(token) = trimmed.strip_prefix("oauth_token:") {
                    let token = token.trim().to_string();
                    if !token.is_empty() { return Some(token); }
                }
            }
        }
    }
    None
}

fn build_octocrab() -> Option<Octocrab> {
    let token = get_github_token()?;
    Octocrab::builder().personal_token(token).build().ok()
}

#[derive(Deserialize)]
pub struct ListParams {
    q: Option<String>,
    limit: Option<String>,
}

// GET /api/github — list repos via octocrab
pub async fn list_repos(Query(params): Query<ListParams>) -> (StatusCode, Json<Value>) {
    let limit: u8 = params.limit.as_deref().and_then(|s| s.parse().ok()).unwrap_or(20);

    let octo = match build_octocrab() {
        Some(o) => o,
        None => return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "GitHub not authenticated. Set GITHUB_TOKEN or configure token in Settings."})),
        ),
    };

    if let Some(ref q) = params.q {
        match octo.search().repositories(&format!("{} user:@me", q)).per_page(limit).send().await {
            Ok(results) => {
                let repos: Vec<Value> = results.items.iter().map(|r| repo_to_json(r)).collect();
                (StatusCode::OK, Json(json!(repos)))
            }
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Search failed: {}", e)}))),
        }
    } else {
        match octo.current().list_repos_for_authenticated_user().sort("updated").direction("desc").per_page(limit).send().await {
            Ok(repos) => {
                let result: Vec<Value> = repos.items.iter().map(|r| repo_to_json(r)).collect();
                (StatusCode::OK, Json(json!(result)))
            }
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("List failed: {}", e)}))),
        }
    }
}

fn repo_to_json(r: &octocrab::models::Repository) -> Value {
    json!({
        "name": r.name,
        "fullName": r.full_name.as_deref().unwrap_or(""),
        "description": r.description.as_deref().unwrap_or(""),
        "cloneUrl": r.html_url.as_ref().map(|u| u.as_str()).unwrap_or(""),
        "isPrivate": r.private.unwrap_or(false),
        "language": r.language.as_ref().and_then(|v| v.as_str()).unwrap_or(""),
        "updatedAt": r.updated_at.map(|d| d.to_rfc3339()).unwrap_or_default(),
    })
}

#[derive(Deserialize)]
pub struct CloneBody {
    #[serde(rename = "repoUrl")]
    repo_url: String,
    #[serde(rename = "targetDir")]
    target_dir: Option<String>,
}

// POST /api/github — clone repo using git2
pub async fn clone_repo(Json(body): Json<CloneBody>) -> (StatusCode, Json<Value>) {
    if body.repo_url.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "repoUrl is required"})));
    }

    let repo_name = body.repo_url.split('/').last().unwrap_or("repo").replace(".git", "");
    let home = dirs::home_dir().unwrap_or_default();
    let clone_target = body.target_dir.unwrap_or_else(|| {
        home.join("projects").join(&repo_name).to_string_lossy().to_string()
    });

    if std::path::Path::new(&clone_target).exists() {
        return (StatusCode::OK, Json(json!({"path": clone_target, "alreadyExists": true})));
    }

    match git_utils::clone_repo(&body.repo_url, &clone_target).await {
        Ok(()) => (StatusCode::CREATED, Json(json!({"path": clone_target, "alreadyExists": false}))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Clone failed: {}", e)}))),
    }
}

// GET /api/github/auth — check auth status via octocrab
pub async fn auth_status() -> Json<Value> {
    if let Some(octo) = build_octocrab() {
        if let Ok(user) = octo.current().user().await {
            return Json(json!({
                "authenticated": true,
                "ghInstalled": true,
                "username": user.login,
            }));
        }
    }
    Json(json!({"authenticated": false, "ghInstalled": true, "username": ""}))
}

// Siege's GitHub OAuth App client ID (public, safe to embed)
const GITHUB_CLIENT_ID: &str = "Ov23liYVlMYCMfmpQ1dM";

// POST /api/github/auth — start GitHub device flow or verify token
pub async fn auth_login() -> (StatusCode, Json<Value>) {
    // Already authenticated?
    if let Some(octo) = build_octocrab() {
        if let Ok(user) = octo.current().user().await {
            return (StatusCode::OK, Json(json!({"status": "already_authenticated", "username": user.login})));
        }
    }

    // Start device flow via GitHub API
    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", GITHUB_CLIENT_ID),
            ("scope", "repo,read:org"),
        ])
        .send()
        .await;

    match resp {
        Ok(r) => {
            if let Ok(data) = r.json::<Value>().await {
                let user_code = data.get("user_code").and_then(|v| v.as_str()).unwrap_or("");
                let device_code = data.get("device_code").and_then(|v| v.as_str()).unwrap_or("");
                let verification_uri = data.get("verification_uri").and_then(|v| v.as_str()).unwrap_or("https://github.com/login/device");
                let interval = data.get("interval").and_then(|v| v.as_u64()).unwrap_or(5);

                // Spawn background task to poll for token
                let dc = device_code.to_string();
                tokio::spawn(async move {
                    poll_device_flow(dc, interval).await;
                });

                (StatusCode::OK, Json(json!({
                    "status": "pending",
                    "code": user_code,
                    "verificationUrl": verification_uri,
                })))
            } else {
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to parse device code response"})))
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))),
    }
}

/// Poll GitHub for device flow completion, save token when authorized.
async fn poll_device_flow(device_code: String, interval: u64) {
    let client = reqwest::Client::new();
    let max_attempts = 60; // 5 minutes at 5s intervals

    for _ in 0..max_attempts {
        tokio::time::sleep(std::time::Duration::from_secs(interval)).await;

        let resp = client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", GITHUB_CLIENT_ID),
                ("device_code", device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await;

        if let Ok(r) = resp {
            if let Ok(data) = r.json::<Value>().await {
                if let Some(token) = data.get("access_token").and_then(|v| v.as_str()) {
                    // Save token to gh config
                    save_github_token(token);
                    return;
                }
                let error = data.get("error").and_then(|v| v.as_str()).unwrap_or("");
                if error == "expired_token" || error == "access_denied" {
                    return;
                }
                // "authorization_pending" or "slow_down" — keep polling
            }
        }
    }
}

fn save_github_token(token: &str) {
    if let Some(config_dir) = dirs::config_dir() {
        let gh_dir = config_dir.join("gh");
        std::fs::create_dir_all(&gh_dir).ok();
        let hosts_content = format!(
            "github.com:\n    oauth_token: {}\n    git_protocol: https\n",
            token
        );
        std::fs::write(gh_dir.join("hosts.yml"), hosts_content).ok();
    }
}
