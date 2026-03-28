use axum::{
    extract::Query,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::remote::ssh::{SshConfig, list_remote_dir};

#[derive(Deserialize)]
pub struct ListDirParams {
    path: Option<String>,
    #[serde(rename = "remoteHost")]
    remote_host: Option<String>,
    #[serde(rename = "remoteUser")]
    remote_user: Option<String>,
}

pub async fn list_dir(
    Query(params): Query<ListDirParams>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Remote path: use SSH to list directory
    if let Some(ref host) = params.remote_host {
        if !host.is_empty() {
            let path = params.path.clone().unwrap_or_else(|| "/home".to_string());
            let config = SshConfig {
                host: host.clone(),
                user: params.remote_user.clone().unwrap_or_else(|| "root".to_string()),
                repo_path: path.clone(),
            };

            let output = list_remote_dir(&config, &path).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": e})),
                )
            })?;

            let dirs = parse_ls_output(&output, &path);

            // Determine parent
            let parent = Path::new(&path)
                .parent()
                .unwrap_or(Path::new("/"))
                .to_string_lossy()
                .to_string();

            return Ok(Json(json!({
                "current": path,
                "parent": parent,
                "dirs": dirs,
                "remote": true,
            })));
        }
    }

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

/// Parse `ls -la` output into JSON directory entries.
fn parse_ls_output(output: &str, base_path: &str) -> Vec<Value> {
    let mut dirs: Vec<Value> = Vec::new();
    for line in output.lines() {
        // ls -la lines: drwxr-xr-x 2 user group 4096 Jan 1 00:00 dirname
        // Skip "total" line, . and .. entries
        if line.starts_with("total") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 {
            continue;
        }
        let name = parts[8..].join(" ");
        if name == "." || name == ".." || name.starts_with('.') {
            continue;
        }
        // Check if it's a directory (first char is 'd')
        let is_dir = line.starts_with('d');
        if !is_dir {
            continue;
        }
        let full_path = format!("{}/{}", base_path.trim_end_matches('/'), name);
        dirs.push(json!({
            "name": name,
            "path": full_path,
            "isGitRepo": false, // Cannot cheaply check remotely
        }));
    }
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ls_output_directories() {
        let output = "total 16\ndrwxr-xr-x 2 root root 4096 Jan  1 00:00 projects\ndrwxr-xr-x 3 root root 4096 Jan  1 00:00 configs\n-rw-r--r-- 1 root root  123 Jan  1 00:00 file.txt\n";
        let dirs = parse_ls_output(output, "/home/user");
        assert_eq!(dirs.len(), 2);
        assert_eq!(dirs[0]["name"], "projects");
        assert_eq!(dirs[0]["path"], "/home/user/projects");
        assert_eq!(dirs[1]["name"], "configs");
    }

    #[test]
    fn test_parse_ls_output_skips_hidden() {
        let output = "total 8\ndrwxr-xr-x 2 root root 4096 Jan  1 00:00 .hidden\ndrwxr-xr-x 2 root root 4096 Jan  1 00:00 visible\n";
        let dirs = parse_ls_output(output, "/tmp");
        assert_eq!(dirs.len(), 1);
        assert_eq!(dirs[0]["name"], "visible");
    }

    #[test]
    fn test_parse_ls_output_skips_dot_entries() {
        let output = "total 8\ndrwxr-xr-x 2 root root 4096 Jan  1 00:00 .\ndrwxr-xr-x 2 root root 4096 Jan  1 00:00 ..\ndrwxr-xr-x 2 root root 4096 Jan  1 00:00 mydir\n";
        let dirs = parse_ls_output(output, "/tmp");
        assert_eq!(dirs.len(), 1);
        assert_eq!(dirs[0]["name"], "mydir");
    }

    #[test]
    fn test_parse_ls_output_empty() {
        let dirs = parse_ls_output("total 0\n", "/tmp");
        assert!(dirs.is_empty());
    }

    #[test]
    fn test_list_dir_params_deserialize() {
        let params: ListDirParams = serde_json::from_str(
            r#"{"path": "/tmp", "remoteHost": "server", "remoteUser": "deploy"}"#,
        )
        .unwrap();
        assert_eq!(params.path.unwrap(), "/tmp");
        assert_eq!(params.remote_host.unwrap(), "server");
        assert_eq!(params.remote_user.unwrap(), "deploy");
    }

    #[test]
    fn test_list_dir_params_deserialize_minimal() {
        let params: ListDirParams = serde_json::from_str(r#"{"path": "/tmp"}"#).unwrap();
        assert_eq!(params.path.unwrap(), "/tmp");
        assert!(params.remote_host.is_none());
    }

    #[test]
    fn test_parse_ls_output_trailing_slash() {
        let output = "total 4\ndrwxr-xr-x 2 root root 4096 Jan  1 00:00 mydir\n";
        let dirs = parse_ls_output(output, "/home/user/");
        assert_eq!(dirs[0]["path"], "/home/user/mydir");
    }
}
