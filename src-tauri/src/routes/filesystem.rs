use axum::{
    extract::Query,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
pub struct ListDirParams {
    path: Option<String>,
}

pub async fn list_dir(
    Query(params): Query<ListDirParams>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let dir_path = params
        .path
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")));

    let resolved = match dir_path.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Directory not found"})),
            ));
        }
    };

    if !resolved.is_dir() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Not a directory"})),
        ));
    }

    let entries = match std::fs::read_dir(&resolved) {
        Ok(entries) => entries,
        Err(_) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Cannot read directory"})),
            ));
        }
    };

    let mut dirs: Vec<Value> = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden directories
        if name.starts_with('.') {
            continue;
        }

        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        if !file_type.is_dir() {
            continue;
        }

        let full_path = resolved.join(&name);
        let is_git_repo = full_path.join(".git").exists();

        dirs.push(json!({
            "name": name,
            "path": full_path.to_string_lossy(),
            "isGitRepo": is_git_repo,
        }));
    }

    // Sort: git repos first, then alphabetical
    dirs.sort_by(|a, b| {
        let a_git = a["isGitRepo"].as_bool().unwrap_or(false);
        let b_git = b["isGitRepo"].as_bool().unwrap_or(false);
        if a_git != b_git {
            return if a_git {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        let a_name = a["name"].as_str().unwrap_or("");
        let b_name = b["name"].as_str().unwrap_or("");
        a_name.cmp(b_name)
    });

    let parent = resolved
        .parent()
        .unwrap_or(Path::new("/"))
        .to_string_lossy()
        .to_string();

    Ok(Json(json!({
        "current": resolved.to_string_lossy(),
        "parent": parent,
        "dirs": dirs,
    })))
}
