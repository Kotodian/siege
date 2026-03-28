use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

use crate::state::AppState;
use crate::utils::process;

#[derive(Deserialize)]
pub struct ListParams {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let plan_id = params.plan_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId is required"})),
        )
    })?;

    let db = state.db.lock().unwrap();

    // Check plan exists
    db.query_row(
        "SELECT id FROM plans WHERE id = ?1",
        rusqlite::params![plan_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Plan not found"})),
        )
    })?;

    // Get schedule
    let schedule_id: Option<String> = db
        .query_row(
            "SELECT id FROM schedules WHERE plan_id = ?1",
            rusqlite::params![plan_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(schedule_id) = schedule_id {
        // Get items sorted by order
        let mut items_stmt = db
            .prepare(
                "SELECT id, title, \"order\" FROM schedule_items WHERE schedule_id = ?1 ORDER BY \"order\"",
            )
            .unwrap();
        let items: Vec<(String, String, i64)> = items_stmt
            .query_map(rusqlite::params![schedule_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let mut db_snapshots: Vec<Value> = Vec::new();
        for (item_id, item_title, item_order) in &items {
            let mut snap_stmt = db
                .prepare(
                    "SELECT file_path, content_before, content_after FROM file_snapshots WHERE schedule_item_id = ?1",
                )
                .unwrap();
            let snaps: Vec<Value> = snap_stmt
                .query_map(rusqlite::params![item_id], |row| {
                    Ok(json!({
                        "filePath": row.get::<_, String>(0)?,
                        "contentBefore": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        "contentAfter": row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        "scheduleItemId": item_id,
                        "taskTitle": item_title,
                        "taskOrder": item_order,
                    }))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();
            db_snapshots.extend(snaps);
        }

        if !db_snapshots.is_empty() {
            return Ok(Json(json!(db_snapshots)));
        }
    }

    // Fallback: return empty (git diff not implemented in Rust backend)
    Ok(Json(json!([])))
}

pub async fn tasks(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Json<Value> {
    let plan_id = match params.plan_id {
        Some(id) => id,
        None => return Json(json!([])),
    };

    let db = state.db.lock().unwrap();

    let schedule_id: Option<String> = db
        .query_row(
            "SELECT id FROM schedules WHERE plan_id = ?1",
            rusqlite::params![plan_id],
            |row| row.get(0),
        )
        .ok();

    let schedule_id = match schedule_id {
        Some(id) => id,
        None => return Json(json!([])),
    };

    let mut stmt = db
        .prepare(
            "SELECT id, title, \"order\", status FROM schedule_items WHERE schedule_id = ?1 AND status = 'completed' ORDER BY \"order\"",
        )
        .unwrap();
    let items: Vec<(String, String, i64, String)> = stmt
        .query_map(rusqlite::params![schedule_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let result: Vec<Value> = items
        .iter()
        .map(|(item_id, title, order, status)| {
            let file_count: i64 = db
                .query_row(
                    "SELECT COUNT(DISTINCT file_path) FROM file_snapshots WHERE schedule_item_id = ?1",
                    rusqlite::params![item_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            json!({
                "id": item_id,
                "title": title,
                "order": order,
                "status": status,
                "fileCount": file_count,
            })
        })
        .collect();

    Json(json!(result))
}

// ---------------------------------------------------------------------------
// POST /api/snapshots/backfill?planId=X — regenerate snapshots from git history
// ---------------------------------------------------------------------------

pub async fn backfill(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let plan_id = params.plan_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId is required"})),
        )
    })?;

    // === Phase 1: All synchronous DB reads in a block (no .await while lock held) ===
    let (cwd, tasks_need_backfill) = {
        let db = state.db.lock().unwrap();

        // Get plan
        let project_id: String = db
            .query_row(
                "SELECT project_id FROM plans WHERE id = ?1",
                rusqlite::params![plan_id],
                |row| row.get(0),
            )
            .map_err(|_| {
                (
                    StatusCode::NOT_FOUND,
                    Json(json!({"error": "Plan not found"})),
                )
            })?;

        // Get project repo path
        let target_repo_path: String = db
            .query_row(
                "SELECT target_repo_path FROM projects WHERE id = ?1",
                rusqlite::params![project_id],
                |row| row.get(0),
            )
            .map_err(|_| {
                (
                    StatusCode::NOT_FOUND,
                    Json(json!({"error": "Project not found"})),
                )
            })?;

        if !Path::new(&target_repo_path).exists() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Repo not found"})),
            ));
        }

        // Get schedule
        let schedule_id: String = db
            .query_row(
                "SELECT id FROM schedules WHERE plan_id = ?1",
                rusqlite::params![plan_id],
                |row| row.get(0),
            )
            .map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "No schedule"})),
                )
            })?;

        // Get completed items sorted by order
        let mut items_stmt = db
            .prepare(
                "SELECT id, title, \"order\" FROM schedule_items WHERE schedule_id = ?1 AND status = 'completed' ORDER BY \"order\"",
            )
            .unwrap();

        let completed_items: Vec<(String, String, i64)> = items_stmt
            .query_map(rusqlite::params![schedule_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        // Find tasks with no snapshots
        let tasks_need_backfill: Vec<(String, String, i64)> = completed_items
            .into_iter()
            .filter(|(item_id, _, _)| {
                let count: i64 = db
                    .query_row(
                        "SELECT COUNT(*) FROM file_snapshots WHERE schedule_item_id = ?1",
                        rusqlite::params![item_id],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);
                count == 0
            })
            .collect();

        if tasks_need_backfill.is_empty() {
            return Ok(Json(
                json!({"message": "All tasks already have snapshots", "backfilled": 0}),
            ));
        }

        (target_repo_path, tasks_need_backfill)
        // db lock is dropped here
    };

    // === Phase 2: Async git operations (no lock held) ===

    // Get commits oldest-first
    let commits_output =
        process::exec("git", &["log", "--reverse", "--format=%H|%P|%s"], &cwd)
            .await
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "Failed to read git log"})),
                )
            })?;

    let commits: Vec<(String, String, String)> = commits_output
        .trim()
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let mut parts = line.splitn(3, '|');
            let hash = parts.next().unwrap_or("").to_string();
            let parent = parts.next().unwrap_or("").to_string();
            let message = parts.next().unwrap_or("").to_string();
            (hash, parent, message)
        })
        .collect();

    if commits.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "No commits found"})),
        ));
    }

    let mut backfilled: i64 = 0;

    for (i, (item_id, _title, _order)) in tasks_need_backfill.iter().enumerate() {
        let (commit_hash, parent_hash) = if i < commits.len() {
            (commits[i].0.clone(), commits[i].1.clone())
        } else {
            (commits[commits.len() - 1].0.clone(), String::new())
        };

        let count = capture_commit_diff(&state, item_id, &cwd, &commit_hash, &parent_hash).await;
        backfilled += count;
    }

    Ok(Json(
        json!({"message": format!("Backfilled {} file snapshots", backfilled), "backfilled": backfilled}),
    ))
}

/// Binary file extensions to skip during backfill.
fn is_binary_path(file_path: &str) -> bool {
    let binary_exts = [
        ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp",
        ".woff", ".woff2", ".ttf", ".eot",
        ".zip", ".tar", ".gz", ".bz2", ".lock",
        ".pdf", ".exe", ".dll", ".so", ".dylib",
        ".db", ".sqlite",
    ];
    let lower = file_path.to_lowercase();
    binary_exts.iter().any(|ext| lower.ends_with(ext))
}

/// Capture file diffs for a single commit and insert them as file_snapshots.
async fn capture_commit_diff(
    state: &AppState,
    item_id: &str,
    cwd: &str,
    commit_hash: &str,
    parent_hash: &str,
) -> i64 {
    let mut count: i64 = 0;

    // Get changed files
    let files_output = if !parent_hash.is_empty() {
        let range = format!("{}..{}", parent_hash, commit_hash);
        process::exec("git", &["diff", "--name-only", &range], cwd).await
    } else {
        process::exec(
            "git",
            &["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", commit_hash],
            cwd,
        )
        .await
    };

    let files: Vec<String> = match files_output {
        Ok(output) => output
            .trim()
            .lines()
            .filter(|l| !l.is_empty())
            .map(|s| s.to_string())
            .collect(),
        Err(_) => return 0,
    };

    for file_path in &files {
        if is_binary_path(file_path) {
            continue;
        }

        let content_before = if !parent_hash.is_empty() {
            let show_ref = format!("{}:{}", parent_hash, file_path);
            process::exec("git", &["show", &show_ref], cwd)
                .await
                .unwrap_or_default()
        } else {
            String::new()
        };

        let show_ref = format!("{}:{}", commit_hash, file_path);
        let content_after = process::exec("git", &["show", &show_ref], cwd)
            .await
            .unwrap_or_default();

        if content_before == content_after {
            continue;
        }

        let snap_id = uuid::Uuid::new_v4().to_string();
        let db = state.db.lock().unwrap();
        let inserted = db.execute(
            "INSERT INTO file_snapshots (id, schedule_item_id, file_path, content_before, content_after) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![snap_id, item_id, file_path, content_before, content_after],
        );
        if inserted.is_ok() {
            count += 1;
        }
    }

    count
}
