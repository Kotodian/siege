use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

use crate::state::AppState;
use crate::utils::process;

#[derive(Deserialize)]
pub struct RollbackBody {
    #[serde(rename = "itemId")]
    item_id: Option<String>,
    #[serde(rename = "dryRun")]
    dry_run: Option<bool>,
    confirm: Option<bool>,
}

/// All data gathered from the database in a synchronous block.
struct PreflightData {
    item_title: String,
    item_order: i64,
    cwd: String,
    snapshots: Vec<(String, String, String, String)>, // (id, file_path, content_before, content_after)
    dependent_tasks: Vec<Value>,
    conflicts: Vec<Value>,
    files: Vec<Value>,
}

pub async fn handle(
    State(state): State<AppState>,
    Json(body): Json<RollbackBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let item_id = body.item_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "itemId is required"})),
        )
    })?;

    let is_dry_run = body.dry_run.unwrap_or(false);
    let is_confirm = body.confirm.unwrap_or(false);

    // === Phase 1: Synchronous DB reads (no .await while lock is held) ===
    let preflight = {
        let db = state.db.lock().unwrap();

        // Load schedule item
        let item = db
            .query_row(
                "SELECT id, schedule_id, title, \"order\", status FROM schedule_items WHERE id = ?1",
                rusqlite::params![item_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .map_err(|_| {
                (
                    StatusCode::NOT_FOUND,
                    Json(json!({"error": "Item not found"})),
                )
            })?;

        let (_item_id_val, schedule_id, item_title, item_order, item_status) = item;

        if item_status != "completed" {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Can only rollback completed tasks"})),
            ));
        }

        // Traverse: schedule -> plan -> project
        let plan_id: String = db
            .query_row(
                "SELECT plan_id FROM schedules WHERE id = ?1",
                rusqlite::params![schedule_id],
                |row| row.get(0),
            )
            .map_err(|_| {
                (
                    StatusCode::NOT_FOUND,
                    Json(json!({"error": "Schedule not found"})),
                )
            })?;

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
                Json(json!({"error": "Target repo not found"})),
            ));
        }

        let cwd = target_repo_path;

        // Load snapshots for this task
        let mut snap_stmt = db
            .prepare(
                "SELECT id, file_path, content_before, content_after FROM file_snapshots WHERE schedule_item_id = ?1",
            )
            .unwrap();

        let snapshots: Vec<(String, String, String, String)> = snap_stmt
            .query_map(rusqlite::params![item_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                ))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        if snapshots.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "No file snapshots found for this task"})),
            ));
        }

        // Safety check 1: later completed tasks touching same files
        let mut later_stmt = db
            .prepare(
                "SELECT id, title, \"order\" FROM schedule_items WHERE schedule_id = ?1 AND id != ?2 AND status = 'completed' AND \"order\" > ?3",
            )
            .unwrap();

        let later_items: Vec<(String, String, i64)> = later_stmt
            .query_map(
                rusqlite::params![schedule_id, item_id, item_order],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let mut dependent_tasks: Vec<Value> = Vec::new();
        for (later_id, later_title, later_order) in &later_items {
            let mut later_snap_stmt = db
                .prepare(
                    "SELECT file_path FROM file_snapshots WHERE schedule_item_id = ?1",
                )
                .unwrap();
            let later_files: Vec<String> = later_snap_stmt
                .query_map(rusqlite::params![later_id], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            let overlapping: Vec<String> = later_files
                .iter()
                .filter(|fp| snapshots.iter().any(|(_, sfp, _, _)| sfp == *fp))
                .cloned()
                .collect();

            if !overlapping.is_empty() {
                dependent_tasks.push(json!({
                    "taskId": later_id,
                    "title": later_title,
                    "order": later_order,
                    "overlappingFiles": overlapping,
                }));
            }
        }

        // Safety check 2: file conflicts (modified since task)
        let mut conflicts: Vec<Value> = Vec::new();
        for (_snap_id, file_path, _content_before, content_after) in &snapshots {
            let abs_path = Path::new(&cwd).join(file_path);
            let current_content = std::fs::read_to_string(&abs_path).unwrap_or_default();
            if current_content != *content_after {
                conflicts.push(json!({"filePath": file_path}));
            }
        }

        // Build file list
        let files: Vec<Value> = snapshots
            .iter()
            .map(|(_id, fp, before, after)| {
                let action = if before.is_empty() && !after.is_empty() {
                    "delete"
                } else if !before.is_empty() && after.is_empty() {
                    "recreate"
                } else {
                    "restore"
                };
                let has_conflict = conflicts.iter().any(|c| c["filePath"].as_str() == Some(fp.as_str()));
                json!({
                    "filePath": fp,
                    "action": action,
                    "hasConflict": has_conflict,
                })
            })
            .collect();

        PreflightData {
            item_title,
            item_order,
            cwd,
            snapshots,
            dependent_tasks,
            conflicts,
            files,
        }
        // db lock is dropped here
    };

    // === Phase 2: DRY RUN response (no DB needed) ===
    if is_dry_run {
        return Ok(Json(json!({
            "item": {
                "id": item_id,
                "title": preflight.item_title,
                "order": preflight.item_order,
            },
            "files": preflight.files,
            "dependentTasks": preflight.dependent_tasks,
            "conflicts": preflight.conflicts,
        })));
    }

    // EXECUTE: require explicit confirm
    if !is_confirm {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Must pass confirm: true to execute rollback"})),
        ));
    }

    // === Phase 3: Perform the rollback (filesystem + async git) ===
    let mut rolled_back_files: Vec<String> = Vec::new();
    for (_snap_id, file_path, content_before, content_after) in &preflight.snapshots {
        let abs_path = Path::new(&preflight.cwd).join(file_path);

        if content_before.is_empty() && !content_after.is_empty() {
            // File was created by the task -> delete it
            let _ = std::fs::remove_file(&abs_path);
        } else if !content_before.is_empty() {
            // Restore original content
            if let Some(parent) = abs_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&abs_path, content_before);
        }
        rolled_back_files.push(file_path.clone());
    }

    // Git commit (async)
    let mut commit_message = String::new();
    if !rolled_back_files.is_empty() {
        let mut git_add_args: Vec<String> = vec!["add".to_string()];
        git_add_args.extend(rolled_back_files.iter().cloned());
        let arg_refs: Vec<&str> = git_add_args.iter().map(|s| s.as_str()).collect();

        let _ = process::exec("git", &arg_refs, &preflight.cwd).await;
        commit_message = format!(
            "rollback: revert task #{} - {}",
            preflight.item_order, preflight.item_title
        );
        let _ = process::exec("git", &["commit", "-m", &commit_message], &preflight.cwd).await;
    }

    // === Phase 4: Update status in DB ===
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "UPDATE schedule_items SET status = 'rolled_back', progress = 0 WHERE id = ?1",
            rusqlite::params![item_id],
        )
        .ok();
    }

    Ok(Json(json!({
        "success": true,
        "rolledBackFiles": rolled_back_files,
        "commitMessage": commit_message,
    })))
}
