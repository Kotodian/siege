use axum::{
    extract::Query,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::remote::ssh::{SshConfig, remote_git};
use crate::utils::git as git_utils;
use crate::utils::process;

// ---------------------------------------------------------------------------
// GET /api/git?path=X -- get git info
// Supports remote via remoteHost/remoteUser query params.
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct GitInfoParams {
    path: Option<String>,
    #[serde(rename = "remoteHost")]
    remote_host: Option<String>,
    #[serde(rename = "remoteUser")]
    remote_user: Option<String>,
}

pub async fn info(
    Query(params): Query<GitInfoParams>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_path = params.path.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "path required"})),
        )
    })?;

    // Remote path: use SSH for git info
    if let Some(ref host) = params.remote_host {
        if !host.is_empty() {
            let config = SshConfig {
                host: host.clone(),
                user: params.remote_user.clone().unwrap_or_else(|| "root".to_string()),
                repo_path: repo_path.clone(),
            };

            let branch = remote_git(&config, "rev-parse --abbrev-ref HEAD")
                .await
                .unwrap_or_default()
                .trim()
                .to_string();

            let branches_raw = remote_git(&config, "branch --list")
                .await
                .unwrap_or_default();

            let branches: Vec<String> = branches_raw
                .lines()
                .map(|l| l.trim().trim_start_matches("* ").to_string())
                .filter(|b| !b.is_empty())
                .collect();

            return Ok(Json(json!({
                "isGit": !branch.is_empty(),
                "currentBranch": branch,
                "branches": branches,
                "remote": true,
            })));
        }
    }

    let result = git_utils::get_git_info(&repo_path).await;
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// POST /api/git -- checkout branch { repoPath, branchName, baseBranch? }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CheckoutBody {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
    #[serde(rename = "branchName")]
    branch_name: Option<String>,
    #[serde(rename = "baseBranch")]
    base_branch: Option<String>,
}

pub async fn checkout(
    Json(body): Json<CheckoutBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_path = body.repo_path.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "repoPath and branchName required"})),
        )
    })?;
    let branch_name = body.branch_name.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "repoPath and branchName required"})),
        )
    })?;

    match git_utils::checkout_branch(
        &repo_path,
        &branch_name,
        body.base_branch.as_deref(),
        true,
    )
    .await
    {
        Ok(current) => Ok(Json(json!({ "success": true, "branch": current }))),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("Failed: {}", e)})),
        )),
    }
}

// ---------------------------------------------------------------------------
// POST /api/git/clone -- clone repo { url, targetDir? }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CloneBody {
    url: Option<String>,
    #[serde(rename = "targetDir")]
    target_dir: Option<String>,
}

pub async fn clone_repo(
    Json(body): Json<CloneBody>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let url = body.url.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "url is required"})),
        )
    })?;

    // Extract repo name from URL
    let repo_name = url
        .split('/')
        .last()
        .unwrap_or("repo")
        .trim_end_matches(".git");

    let target = body.target_dir.unwrap_or_else(|| {
        let home = dirs::home_dir().unwrap_or_default();
        home.join("projects")
            .join(repo_name)
            .to_string_lossy()
            .to_string()
    });

    // Check if already exists
    if std::path::Path::new(&target).exists() {
        return Ok((
            StatusCode::OK,
            Json(json!({"path": target, "alreadyExists": true})),
        ));
    }

    match git_utils::clone_repo(&url, &target).await {
        Ok(()) => Ok((
            StatusCode::CREATED,
            Json(json!({"path": target, "alreadyExists": false})),
        )),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e})),
        )),
    }
}

// ---------------------------------------------------------------------------
// POST /api/git/push -- push { repoPath }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PushBody {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
}

pub async fn push(
    Json(body): Json<PushBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_path = body.repo_path.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid repo path"})),
        )
    })?;

    if !std::path::Path::new(&repo_path).exists() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid repo path"})),
        ));
    }

    // Get current branch using git2
    let branch = git_utils::get_current_branch(&repo_path)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e})),
            )
        })?;

    // Push still uses shell exec (git2 push requires complex credential callbacks)
    match git_utils::push(&repo_path, "origin", &branch).await {
        Ok(output) => Ok(Json(json!({
            "success": true,
            "branch": branch,
            "output": output.trim(),
        }))),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.trim().to_string()})),
        )),
    }
}

// ---------------------------------------------------------------------------
// GET /api/git/pr?repoPath=X -- list PRs / check current branch PR
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PrParams {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
}

pub async fn list_prs(
    Query(params): Query<PrParams>,
) -> Json<Value> {
    let repo_path = match params.repo_path {
        Some(p) if std::path::Path::new(&p).exists() => p,
        _ => return Json(json!({"hasPR": false})),
    };

    // PR operations require GitHub API context tied to the repo remote.
    // Use gh CLI as it handles repo detection from the local checkout.
    match process::exec(
        "gh",
        &["pr", "view", "--json", "number,title,url,state,baseRefName,headRefName"],
        &repo_path,
    )
    .await
    {
        Ok(output) => {
            if let Ok(pr) = serde_json::from_str::<Value>(&output) {
                Json(json!({"hasPR": true, "pr": pr}))
            } else {
                Json(json!({"hasPR": false}))
            }
        }
        Err(_) => Json(json!({"hasPR": false})),
    }
}

// ---------------------------------------------------------------------------
// POST /api/git/pr -- create PR { repoPath, title, body?, baseBranch? }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreatePrBody {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
    title: Option<String>,
    body: Option<String>,
    #[serde(rename = "baseBranch")]
    base_branch: Option<String>,
}

pub async fn create_pr(
    Json(body): Json<CreatePrBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_path = body.repo_path.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "repoPath and title are required"})),
        )
    })?;
    let title = body.title.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "repoPath and title are required"})),
        )
    })?;

    if !std::path::Path::new(&repo_path).exists() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Repo not found"})),
        ));
    }

    // PR creation requires GitHub API context tied to the repo remote.
    // Use gh CLI as it handles repo detection from the local checkout.
    let mut args: Vec<String> = vec![
        "pr".to_string(),
        "create".to_string(),
        "--title".to_string(),
        title,
    ];

    if let Some(pr_body) = body.body {
        args.push("--body".to_string());
        args.push(pr_body);
    } else {
        args.push("--body".to_string());
        args.push(String::new());
    }

    if let Some(base) = body.base_branch {
        args.push("--base".to_string());
        args.push(base);
    }

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    match process::exec("gh", &arg_refs, &repo_path).await {
        Ok(output) => {
            let url = output.trim().lines().last().unwrap_or("").to_string();
            let number = url
                .split("/pull/")
                .nth(1)
                .and_then(|s| s.parse::<i64>().ok());

            Ok(Json(json!({
                "success": true,
                "url": url,
                "number": number,
            })))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.trim().to_string()})),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_git_info_params_deserialize_basic() {
        let params: GitInfoParams = serde_json::from_str(r#"{"path": "/tmp/repo"}"#).unwrap();
        assert_eq!(params.path.unwrap(), "/tmp/repo");
        assert!(params.remote_host.is_none());
        assert!(params.remote_user.is_none());
    }

    #[test]
    fn test_git_info_params_deserialize_with_remote() {
        let params: GitInfoParams = serde_json::from_str(
            r#"{"path": "/tmp/repo", "remoteHost": "my-host", "remoteUser": "deploy"}"#,
        )
        .unwrap();
        assert_eq!(params.path.unwrap(), "/tmp/repo");
        assert_eq!(params.remote_host.unwrap(), "my-host");
        assert_eq!(params.remote_user.unwrap(), "deploy");
    }

    fn parse_branch_list(raw: &str) -> Vec<String> {
        raw.lines()
            .map(|l| l.trim().trim_start_matches("* ").to_string())
            .filter(|b| !b.is_empty())
            .collect()
    }

    #[test]
    fn test_parse_branch_list() {
        let raw = "  main\n* develop\n  feature/foo\n";
        let branches = parse_branch_list(raw);
        assert_eq!(branches, vec!["main", "develop", "feature/foo"]);
    }

    #[test]
    fn test_parse_branch_list_empty() {
        let branches = parse_branch_list("");
        assert!(branches.is_empty());
    }
}
