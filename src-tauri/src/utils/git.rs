use serde_json::{json, Value};
use std::path::Path;
use super::process::exec;

/// Execute a git command in the given repo directory.
pub async fn exec_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    exec("git", args, repo_path).await
}

/// Check if a directory is a git repo and return branch info.
pub async fn get_git_info(repo_path: &str) -> Value {
    let git_dir = Path::new(repo_path).join(".git");
    if !git_dir.exists() {
        return json!({ "isGit": false });
    }

    let current_branch = match exec_git(repo_path, &["branch", "--show-current"]).await {
        Ok(b) => b.trim().to_string(),
        Err(_) => "unknown".to_string(),
    };

    let branches = match exec_git(repo_path, &["branch", "--list"]).await {
        Ok(output) => output
            .lines()
            .map(|line| line.trim_start_matches('*').trim().to_string())
            .filter(|b| !b.is_empty())
            .collect::<Vec<String>>(),
        Err(_) => vec![],
    };

    json!({
        "isGit": true,
        "currentBranch": current_branch,
        "branches": branches,
    })
}

/// Checkout a branch, optionally creating it.
pub async fn checkout_branch(
    repo_path: &str,
    branch: &str,
    base_branch: Option<&str>,
    create: bool,
) -> Result<String, String> {
    let mut args: Vec<&str> = vec!["checkout"];
    if create {
        args.push("-b");
    }
    args.push(branch);
    if let Some(base) = base_branch {
        if create {
            args.push(base);
        }
    }
    exec_git(repo_path, &args).await?;

    // Return current branch name
    let current = exec_git(repo_path, &["branch", "--show-current"]).await?;
    Ok(current.trim().to_string())
}

/// Clone a repository to the given path.
pub async fn clone_repo(url: &str, target: &str) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(target).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    exec("git", &["clone", url, target], ".").await?;
    Ok(())
}

/// Push current branch to remote.
pub async fn push(repo_path: &str, remote: &str, branch: &str) -> Result<String, String> {
    exec_git(repo_path, &["push", "-u", remote, branch]).await
}

/// Get the HEAD commit hash.
pub async fn get_head_hash(repo_path: &str) -> Result<String, String> {
    let output = exec_git(repo_path, &["rev-parse", "HEAD"]).await?;
    Ok(output.trim().to_string())
}

/// Get the unified diff of the working tree.
pub async fn get_unified_diff(repo_path: &str) -> Result<String, String> {
    exec_git(repo_path, &["diff"]).await
}
