use git2::{BranchType, Repository};
use serde_json::{json, Value};
use std::path::Path;
use super::process::exec;

/// Execute a git command in the given repo directory (fallback for complex operations).
pub async fn exec_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    exec("git", args, repo_path).await
}

/// Check if a directory is a git repo and return branch info using git2.
pub async fn get_git_info(repo_path: &str) -> Value {
    let path = repo_path.to_string();
    match tokio::task::spawn_blocking(move || get_git_info_sync(&path)).await {
        Ok(val) => val,
        Err(e) => json!({"isGit": false, "error": e.to_string()}),
    }
}

fn get_git_info_sync(repo_path: &str) -> Value {
    let git_dir = Path::new(repo_path).join(".git");
    if !git_dir.exists() {
        return json!({ "isGit": false });
    }

    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        Err(_) => return json!({ "isGit": false }),
    };

    let head = repo.head().ok();
    let current_branch = head
        .as_ref()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string());

    let branches: Vec<String> = repo
        .branches(Some(BranchType::Local))
        .map(|iter| {
            iter.filter_map(|b| b.ok())
                .filter_map(|(b, _)| b.name().ok().flatten().map(|n| n.to_string()))
                .collect()
        })
        .unwrap_or_default();

    json!({
        "isGit": true,
        "currentBranch": current_branch,
        "branches": branches,
    })
}

/// Checkout a branch, optionally creating it, using git2.
pub async fn checkout_branch(
    repo_path: &str,
    branch: &str,
    base_branch: Option<&str>,
    create: bool,
) -> Result<String, String> {
    let path = repo_path.to_string();
    let branch_name = branch.to_string();
    let base = base_branch.map(|s| s.to_string());

    tokio::task::spawn_blocking(move || checkout_branch_sync(&path, &branch_name, base.as_deref(), create))
        .await
        .map_err(|e| e.to_string())?
}

fn checkout_branch_sync(
    repo_path: &str,
    branch: &str,
    base_branch: Option<&str>,
    create: bool,
) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    if create {
        // Find the commit to base the new branch on
        let base_commit = if let Some(base_name) = base_branch {
            let base_ref = repo
                .find_branch(base_name, BranchType::Local)
                .map_err(|e| format!("Failed to find base branch '{}': {}", base_name, e))?;
            base_ref
                .get()
                .peel_to_commit()
                .map_err(|e| format!("Failed to peel base branch to commit: {}", e))?
        } else {
            repo.head()
                .map_err(|e| format!("Failed to get HEAD: {}", e))?
                .peel_to_commit()
                .map_err(|e| format!("Failed to peel HEAD to commit: {}", e))?
        };

        // Create the new branch
        repo.branch(branch, &base_commit, false)
            .map_err(|e| format!("Failed to create branch '{}': {}", branch, e))?;
    }

    // Set HEAD to the target branch
    let refname = format!("refs/heads/{}", branch);
    repo.set_head(&refname)
        .map_err(|e| format!("Failed to set HEAD to '{}': {}", branch, e))?;

    // Update the working directory to match
    repo.checkout_head(Some(
        git2::build::CheckoutBuilder::new().force(),
    ))
    .map_err(|e| format!("Failed to checkout HEAD: {}", e))?;

    Ok(branch.to_string())
}

/// Clone a repository to the given path using git2.
pub async fn clone_repo(url: &str, target: &str) -> Result<(), String> {
    let url = url.to_string();
    let target = target.to_string();

    tokio::task::spawn_blocking(move || clone_repo_sync(&url, &target))
        .await
        .map_err(|e| e.to_string())?
}

fn clone_repo_sync(url: &str, target: &str) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(target).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    Repository::clone(url, target)
        .map_err(|e| format!("Clone failed: {}", e))?;
    Ok(())
}

/// Push current branch to remote.
/// Kept as shell exec because git2 push requires complex credential callbacks.
pub async fn push(repo_path: &str, remote: &str, branch: &str) -> Result<String, String> {
    exec_git(repo_path, &["push", "-u", remote, branch]).await
}

/// Get the HEAD commit hash using git2.
pub async fn get_head_hash(repo_path: &str) -> Result<String, String> {
    let path = repo_path.to_string();
    tokio::task::spawn_blocking(move || get_head_hash_sync(&path))
        .await
        .map_err(|e| e.to_string())?
}

fn get_head_hash_sync(repo_path: &str) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let oid = head.target().ok_or_else(|| "HEAD has no target".to_string())?;
    Ok(oid.to_string())
}

/// Get the current branch name using git2.
pub async fn get_current_branch(repo_path: &str) -> Result<String, String> {
    let path = repo_path.to_string();
    tokio::task::spawn_blocking(move || get_current_branch_sync(&path))
        .await
        .map_err(|e| e.to_string())?
}

fn get_current_branch_sync(repo_path: &str) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    head.shorthand()
        .map(|s| s.to_string())
        .ok_or_else(|| "HEAD is not a branch".to_string())
}
