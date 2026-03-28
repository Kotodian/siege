use axum::{extract::Query, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::utils::process::exec;

#[derive(Deserialize)]
pub struct ListParams {
    q: Option<String>,
    limit: Option<String>,
}

// GET /api/github — list repos via gh CLI
pub async fn list_repos(Query(params): Query<ListParams>) -> (StatusCode, Json<Value>) {
    let limit = params.limit.as_deref().unwrap_or("20");

    // Check if gh is authenticated
    if let Err(_) = exec("gh", &["auth", "status"], ".").await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "GitHub CLI not installed or not authenticated. Run 'gh auth login' first."})),
        );
    }

    let cmd_args = if let Some(ref q) = params.q {
        vec![
            "search".to_string(), "repos".to_string(), q.clone(),
            "--owner".to_string(), "@me".to_string(),
            "--limit".to_string(), limit.to_string(),
            "--json".to_string(), "name,fullName,description,url,isPrivate,language,updatedAt".to_string(),
        ]
    } else {
        vec![
            "repo".to_string(), "list".to_string(),
            "--limit".to_string(), limit.to_string(),
            "--json".to_string(), "name,description,url,isPrivate,language,updatedAt,nameWithOwner".to_string(),
        ]
    };

    let args_ref: Vec<&str> = cmd_args.iter().map(|s| s.as_str()).collect();
    match exec("gh", &args_ref, ".").await {
        Ok(output) => {
            let repos: Vec<Value> = serde_json::from_str(&output).unwrap_or_default();
            let result: Vec<Value> = repos.iter().map(|r| {
                json!({
                    "name": r.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                    "fullName": r.get("fullName").or_else(|| r.get("nameWithOwner")).and_then(|v| v.as_str()).unwrap_or(""),
                    "description": r.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                    "cloneUrl": r.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                    "isPrivate": r.get("isPrivate").and_then(|v| v.as_bool()).unwrap_or(false),
                    "language": r.get("language").and_then(|v| {
                        if v.is_string() { v.as_str().map(|s| s.to_string()) }
                        else { v.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()) }
                    }).unwrap_or_default(),
                    "updatedAt": r.get("updatedAt").and_then(|v| v.as_str()).unwrap_or(""),
                })
            }).collect();
            (StatusCode::OK, Json(json!(result)))
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("Failed to list repos: {}", e)})),
        ),
    }
}

#[derive(Deserialize)]
pub struct CloneBody {
    #[serde(rename = "repoUrl")]
    repo_url: String,
    #[serde(rename = "targetDir")]
    target_dir: Option<String>,
}

// POST /api/github — clone repo
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

    if let Some(parent) = std::path::Path::new(&clone_target).parent() {
        std::fs::create_dir_all(parent).ok();
    }

    match exec("gh", &["repo", "clone", &body.repo_url, &clone_target], ".").await {
        Ok(_) => (StatusCode::CREATED, Json(json!({"path": clone_target, "alreadyExists": false}))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Clone failed: {}", e)}))),
    }
}

// GET /api/github/auth — check auth status
pub async fn auth_status() -> Json<Value> {
    // Check if gh is installed
    if exec("gh", &["--version"], ".").await.is_err() {
        return Json(json!({"authenticated": false, "ghInstalled": false, "username": ""}));
    }

    match exec("gh", &["auth", "status"], ".").await {
        Ok(output) => {
            // Parse: "Logged in to github.com account USERNAME"
            if let Some(cap) = output.find("account ") {
                let rest = &output[cap + 8..];
                let username = rest.split_whitespace().next().unwrap_or("");
                Json(json!({"authenticated": true, "ghInstalled": true, "username": username}))
            } else {
                Json(json!({"authenticated": false, "ghInstalled": true, "username": ""}))
            }
        }
        Err(stderr) => {
            // gh auth status outputs to stderr when authenticated
            if let Some(cap) = stderr.find("account ") {
                let rest = &stderr[cap + 8..];
                let username = rest.split_whitespace().next().unwrap_or("");
                Json(json!({"authenticated": true, "ghInstalled": true, "username": username}))
            } else {
                Json(json!({"authenticated": false, "ghInstalled": true, "username": ""}))
            }
        }
    }
}

// POST /api/github/auth — start device flow login
pub async fn auth_login() -> (StatusCode, Json<Value>) {
    // Check if gh is installed
    if exec("gh", &["--version"], ".").await.is_err() {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "gh_not_installed"})));
    }

    // Already authenticated?
    let status_output = exec("gh", &["auth", "status"], ".").await
        .unwrap_or_else(|e| e);
    if status_output.contains("Logged in to github.com account") {
        let username = status_output
            .find("account ")
            .map(|i| {
                let rest = &status_output[i + 8..];
                rest.split_whitespace().next().unwrap_or("").to_string()
            })
            .unwrap_or_default();
        return (StatusCode::OK, Json(json!({"status": "already_authenticated", "username": username})));
    }

    // Start device flow — spawn gh auth login and capture code
    use tokio::process::Command;

    let mut proc = match Command::new("gh")
        .args(["auth", "login", "--web", "-p", "https", "-h", "github.com", "--skip-ssh-key"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(p) => p,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))),
    };

    let mut output = String::new();

    // Read from both stdout and stderr with timeout
    let deadline = tokio::time::sleep(std::time::Duration::from_secs(30));
    tokio::pin!(deadline);

    let stderr = proc.stderr.take();
    let stdout = proc.stdout.take();

    // Merge stdout + stderr into a single reader
    use tokio::io::AsyncBufReadExt;
    let mut lines = tokio::io::BufReader::new({
        // Prefer stderr (gh outputs device code there)
        if let Some(s) = stderr { s } else {
            proc.kill().await.ok();
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "no output stream"})));
        }
    }).lines();

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
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "login_process_ended"})))
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
