use axum::{extract::Query, http::StatusCode, Json};
use octocrab::Octocrab;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::utils::git as git_utils;
use crate::utils::process::exec;

/// Try to read a GitHub token from environment variables or gh CLI config.
fn get_github_token() -> Option<String> {
    // 1. Check environment variables
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        if !token.is_empty() {
            return Some(token);
        }
    }
    if let Ok(token) = std::env::var("GH_TOKEN") {
        if !token.is_empty() {
            return Some(token);
        }
    }

    // 2. Try to read from gh CLI config (~/.config/gh/hosts.yml)
    if let Some(config_dir) = dirs::config_dir() {
        let hosts_path = config_dir.join("gh").join("hosts.yml");
        if let Ok(contents) = std::fs::read_to_string(&hosts_path) {
            // Simple YAML parsing: look for "oauth_token: <token>"
            for line in contents.lines() {
                let trimmed = line.trim();
                if let Some(token) = trimmed.strip_prefix("oauth_token:") {
                    let token = token.trim().to_string();
                    if !token.is_empty() {
                        return Some(token);
                    }
                }
            }
        }
    }

    None
}

/// Build an authenticated Octocrab instance, if a token is available.
fn build_octocrab() -> Option<Octocrab> {
    let token = get_github_token()?;
    Octocrab::builder()
        .personal_token(token)
        .build()
        .ok()
}

#[derive(Deserialize)]
pub struct ListParams {
    q: Option<String>,
    limit: Option<String>,
}

// GET /api/github -- list repos via octocrab (GitHub API)
pub async fn list_repos(Query(params): Query<ListParams>) -> (StatusCode, Json<Value>) {
    let limit: u8 = params
        .limit
        .as_deref()
        .and_then(|s| s.parse().ok())
        .unwrap_or(20);

    let octo = match build_octocrab() {
        Some(o) => o,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error": "GitHub not authenticated. Set GITHUB_TOKEN or run 'gh auth login' first."})),
            );
        }
    };

    if let Some(ref q) = params.q {
        // Search repos owned by current user matching query
        match octo
            .search()
            .repositories(&format!("{} user:@me", q))
            .per_page(limit)
            .send()
            .await
        {
            Ok(results) => {
                let repos: Vec<Value> = results
                    .items
                    .iter()
                    .map(|r| {
                        json!({
                            "name": r.name,
                            "fullName": r.full_name.as_deref().unwrap_or(""),
                            "description": r.description.as_deref().unwrap_or(""),
                            "cloneUrl": r.html_url.as_ref().map(|u| u.as_str()).unwrap_or(""),
                            "isPrivate": r.private.unwrap_or(false),
                            "language": r.language.as_ref().and_then(|v| v.as_str()).unwrap_or(""),
                            "updatedAt": r.updated_at.map(|d| d.to_rfc3339()).unwrap_or_default(),
                        })
                    })
                    .collect();
                (StatusCode::OK, Json(json!(repos)))
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("Failed to search repos: {}", e)})),
            ),
        }
    } else {
        // List repos for authenticated user
        match octo
            .current()
            .list_repos_for_authenticated_user()
            .sort("updated")
            .direction("desc")
            .per_page(limit)
            .send()
            .await
        {
            Ok(repos) => {
                let result: Vec<Value> = repos
                    .items
                    .iter()
                    .map(|r| {
                        json!({
                            "name": r.name,
                            "fullName": r.full_name.as_deref().unwrap_or(""),
                            "description": r.description.as_deref().unwrap_or(""),
                            "cloneUrl": r.html_url.as_ref().map(|u| u.as_str()).unwrap_or(""),
                            "isPrivate": r.private.unwrap_or(false),
                            "language": r.language.as_ref().and_then(|v| v.as_str()).unwrap_or(""),
                            "updatedAt": r.updated_at.map(|d| d.to_rfc3339()).unwrap_or_default(),
                        })
                    })
                    .collect();
                (StatusCode::OK, Json(json!(result)))
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("Failed to list repos: {}", e)})),
            ),
        }
    }
}

#[derive(Deserialize)]
pub struct CloneBody {
    #[serde(rename = "repoUrl")]
    repo_url: String,
    #[serde(rename = "targetDir")]
    target_dir: Option<String>,
}

// POST /api/github -- clone repo using git2
pub async fn clone_repo(Json(body): Json<CloneBody>) -> (StatusCode, Json<Value>) {
    if body.repo_url.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "repoUrl is required"})),
        );
    }

    let repo_name = body
        .repo_url
        .split('/')
        .last()
        .unwrap_or("repo")
        .replace(".git", "");
    let home = dirs::home_dir().unwrap_or_default();
    let clone_target = body.target_dir.unwrap_or_else(|| {
        home.join("projects")
            .join(&repo_name)
            .to_string_lossy()
            .to_string()
    });

    if std::path::Path::new(&clone_target).exists() {
        return (
            StatusCode::OK,
            Json(json!({"path": clone_target, "alreadyExists": true})),
        );
    }

    // Use git2 for cloning
    match git_utils::clone_repo(&body.repo_url, &clone_target).await {
        Ok(()) => (
            StatusCode::CREATED,
            Json(json!({"path": clone_target, "alreadyExists": false})),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("Clone failed: {}", e)})),
        ),
    }
}

// GET /api/github/auth -- check auth status via octocrab
pub async fn auth_status() -> Json<Value> {
    // Try octocrab with token first
    if let Some(octo) = build_octocrab() {
        if let Ok(user) = octo.current().user().await {
            return Json(json!({
                "authenticated": true,
                "ghInstalled": true,
                "username": user.login,
            }));
        }
    }

    // Fallback: try gh CLI (handles browser-based auth that doesn't set env vars)
    if exec("gh", &["--version"], ".").await.is_err() {
        return Json(json!({"authenticated": false, "ghInstalled": false, "username": ""}));
    }

    match exec("gh", &["auth", "status"], ".").await {
        Ok(output) => parse_gh_auth_output(&output),
        Err(stderr) => parse_gh_auth_output(&stderr),
    }
}

fn parse_gh_auth_output(output: &str) -> Json<Value> {
    if let Some(cap) = output.find("account ") {
        let rest = &output[cap + 8..];
        let username = rest.split_whitespace().next().unwrap_or("");
        Json(json!({"authenticated": true, "ghInstalled": true, "username": username}))
    } else {
        Json(json!({"authenticated": false, "ghInstalled": true, "username": ""}))
    }
}

// POST /api/github/auth -- start device flow login
// Kept as shell exec: device flow requires interactive process that gh CLI handles well.
pub async fn auth_login() -> (StatusCode, Json<Value>) {
    // Check if gh is installed
    if exec("gh", &["--version"], ".").await.is_err() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "gh_not_installed"})),
        );
    }

    // Already authenticated? Try octocrab first.
    if let Some(octo) = build_octocrab() {
        if let Ok(user) = octo.current().user().await {
            return (
                StatusCode::OK,
                Json(json!({"status": "already_authenticated", "username": user.login})),
            );
        }
    }

    // Fallback: check via gh CLI
    let status_output = exec("gh", &["auth", "status"], ".")
        .await
        .unwrap_or_else(|e| e);
    if status_output.contains("Logged in to github.com account") {
        let username = status_output
            .find("account ")
            .map(|i| {
                let rest = &status_output[i + 8..];
                rest.split_whitespace().next().unwrap_or("").to_string()
            })
            .unwrap_or_default();
        return (
            StatusCode::OK,
            Json(json!({"status": "already_authenticated", "username": username})),
        );
    }

    // Start device flow -- spawn gh auth login and capture code
    use tokio::process::Command;

    let mut proc = match Command::new("gh")
        .args([
            "auth", "login", "--web", "-p", "https", "-h", "github.com", "--skip-ssh-key",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        }
    };

    let mut output = String::new();

    // Read from stderr with timeout (gh outputs device code there)
    let deadline = tokio::time::sleep(std::time::Duration::from_secs(30));
    tokio::pin!(deadline);

    let stderr = proc.stderr.take();
    let stdout = proc.stdout.take();

    use tokio::io::AsyncBufReadExt;
    let mut lines = tokio::io::BufReader::new(match stderr {
        Some(s) => s,
        None => {
            proc.kill().await.ok();
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "no output stream"})),
            );
        }
    })
    .lines();

    // Drop stdout to avoid holding it
    drop(stdout);

    loop {
        tokio::select! {
            _ = &mut deadline => {
                proc.kill().await.ok();
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "timeout"})));
            }
            line = lines.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        output.push_str(&line);
                        output.push('\n');
                        if let Some(code) = extract_device_code(&output) {
                            return (StatusCode::OK, Json(json!({
                                "status": "pending",
                                "code": code,
                                "verificationUrl": "https://github.com/login/device"
                            })));
                        }
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        }
    }

    proc.kill().await.ok();
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": "login_process_ended"})),
    )
}

fn extract_device_code(output: &str) -> Option<String> {
    // Parse: "! First copy your one-time code: XXXX-XXXX"
    if let Some(idx) = output.find("one-time code:") {
        let rest = &output[idx + 14..];
        let code = rest.trim().split_whitespace().next()?;
        Some(code.to_string())
    } else {
        None
    }
}
