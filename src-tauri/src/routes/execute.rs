use axum::{
    body::Body,
    extract::State,
    http::StatusCode,
    response::Response,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use tokio_stream::wrappers::ReceiverStream;

use crate::ai::acp::{AcpClient, AcpUpdate};
use crate::ai::config::resolve_step_config;
use crate::ai::streaming::stream_ai_call;
use crate::state::AppState;
use crate::utils::{git, process};

// ---------------------------------------------------------------------------
// POST /api/execute — Execute a schedule item (task)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ExecuteBody {
    #[serde(rename = "itemId")]
    item_id: Option<String>,
    skills: Option<Vec<String>>,
    provider: Option<String>,
    model: Option<String>,
    locale: Option<String>,
}

pub async fn execute_task(
    State(state): State<AppState>,
    Json(body): Json<ExecuteBody>,
) -> Response {
    let item_id = match body.item_id {
        Some(id) => id,
        None => {
            return error_response(400, "itemId is required");
        }
    };

    // === Phase 1: Load all data from DB synchronously ===
    let task_data = {
        let db = state.db.lock().unwrap();

        // Load schedule item
        let item = match db.query_row(
            "SELECT id, schedule_id, scheme_id, parent_id, title, description, \"order\", status, engine, skills
             FROM schedule_items WHERE id = ?1",
            rusqlite::params![item_id],
            |row| {
                Ok(TaskItem {
                    id: row.get(0)?,
                    schedule_id: row.get(1)?,
                    scheme_id: row.get(2)?,
                    _parent_id: row.get(3)?,
                    title: row.get(4)?,
                    description: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    order: row.get(6)?,
                    _status: row.get::<_, String>(7)?,
                    engine: row.get::<_, Option<String>>(8)?,
                    skills: row.get::<_, Option<String>>(9)?.unwrap_or_else(|| "[]".to_string()),
                })
            },
        ) {
            Ok(i) => i,
            Err(_) => return error_response(404, "Item not found"),
        };

        // Check for children (cannot execute parent tasks)
        let children_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM schedule_items WHERE parent_id = ?1",
                rusqlite::params![item_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if children_count > 0 {
            return error_response(
                400,
                "Cannot execute parent task directly. Execute subtasks instead.",
            );
        }

        // Load schedule
        let plan_id: String = match db.query_row(
            "SELECT plan_id FROM schedules WHERE id = ?1",
            rusqlite::params![item.schedule_id],
            |row| row.get(0),
        ) {
            Ok(id) => id,
            Err(_) => return error_response(404, "Schedule not found"),
        };

        // Load plan
        let (plan_status, project_id): (String, String) = match db.query_row(
            "SELECT status, project_id FROM plans WHERE id = ?1",
            rusqlite::params![plan_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ) {
            Ok(p) => p,
            Err(_) => return error_response(404, "Plan not found"),
        };

        // Load project
        let (target_repo_path, session_id): (String, Option<String>) = match db.query_row(
            "SELECT target_repo_path, session_id FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ) {
            Ok(p) => p,
            Err(_) => return error_response(404, "Project not found"),
        };

        // Previous tasks context
        let mut stmt = db
            .prepare(
                "SELECT id, title, \"order\", status FROM schedule_items
                 WHERE schedule_id = ?1 AND id != ?2 AND \"order\" < ?3
                 AND (status = 'completed' OR status = 'failed')
                 ORDER BY \"order\"",
            )
            .unwrap();
        let previous_tasks: Vec<String> = stmt
            .query_map(
                rusqlite::params![item.schedule_id, item_id, item.order],
                |row| {
                    let order: i64 = row.get(2)?;
                    let title: String = row.get(1)?;
                    let status: String = row.get(3)?;
                    Ok(format!("- #{} {} [{}]", order, title, status))
                },
            )
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        // Load scheme context
        let scheme_context = if let Some(ref sid) = item.scheme_id {
            db.query_row(
                "SELECT content FROM schemes WHERE id = ?1",
                rusqlite::params![sid],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
            .map(|content| {
                let truncated = if content.len() > 1500 {
                    format!("{}...(truncated)", &content[..1500])
                } else {
                    content
                };
                format!("Technical scheme context:\n{}", truncated)
            })
            .unwrap_or_default()
        } else {
            String::new()
        };

        // Load memory context
        let memory_context = load_memory_context(&db, &project_id);

        // Update status to in_progress
        db.execute(
            "UPDATE schedule_items SET status = 'in_progress', progress = 0 WHERE id = ?1",
            rusqlite::params![item_id],
        )
        .ok();

        // Update plan status if needed
        if plan_status == "scheduled" {
            db.execute(
                "UPDATE plans SET status = 'executing', updated_at = datetime('now') WHERE id = ?1",
                rusqlite::params![plan_id],
            )
            .ok();
        }

        TaskData {
            item,
            plan_id,
            project_id,
            target_repo_path,
            session_id,
            previous_tasks: previous_tasks.join("\n"),
            scheme_context,
            memory_context,
        }
    };

    // === Phase 2: Build the prompt ===
    let cwd = if Path::new(&task_data.target_repo_path).exists() {
        task_data.target_repo_path.clone()
    } else {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    };

    // Parse item skills
    let item_skills: Vec<String> =
        serde_json::from_str(&task_data.item.skills).unwrap_or_default();
    let request_skills = body.skills.unwrap_or_default();
    let all_skill_names: HashSet<String> = item_skills
        .into_iter()
        .chain(request_skills.into_iter())
        .collect();
    // Skills content loading is simplified in Rust — we just list the names
    let skills_content = if all_skill_names.is_empty() {
        String::new()
    } else {
        format!(
            "Skills: {}",
            all_skill_names
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        )
    };

    let mut prompt_parts: Vec<String> = Vec::new();
    if !task_data.memory_context.is_empty() {
        prompt_parts.push(format!("{}\n\n---", task_data.memory_context));
    }
    if !task_data.scheme_context.is_empty() {
        prompt_parts.push(format!("{}\n\n---", task_data.scheme_context));
    }
    if !task_data.previous_tasks.is_empty() {
        prompt_parts.push(format!(
            "Other tasks in this plan:\n{}\n\n---",
            task_data.previous_tasks
        ));
    }
    prompt_parts.push(format!(
        "Implement task #{}: {}\n\n{}\n\n{}\n\n\
         Implement the changes directly. Only read files you need to modify. \
         Do NOT scan the entire codebase — focus on the specific files relevant to this task.\n\n\
         After implementing, commit your changes with a descriptive commit message following the project's conventions. \
         Read the project's CLAUDE.md or CONTRIBUTING.md if available for commit message style. Stage only the files you changed.",
        task_data.item.order,
        task_data.item.title,
        task_data.item.description,
        skills_content
    ));
    let prompt = prompt_parts.join("\n");

    // Determine engine
    let req_provider = body.provider.as_deref();
    let req_model = body.model.as_deref();

    let engine = if req_provider == Some("acp") {
        "acp"
    } else if req_provider == Some("codex-acp") {
        "codex-acp"
    } else if req_provider == Some("copilot-acp") {
        "copilot-acp"
    } else if let Some(e) = task_data.item.engine.as_deref() {
        // Use item's configured engine if it's an ACP variant
        match e {
            "acp" | "codex-acp" | "copilot-acp" => e,
            _ => {
                // Check if the resolved provider is an ACP variant
                let db = state.db.lock().unwrap();
                let resolved = resolve_step_config(&db, "execute", req_provider, req_model);
                match resolved {
                    Ok(cfg) if cfg.provider == "acp" => "acp",
                    Ok(cfg) if cfg.provider == "codex-acp" => "codex-acp",
                    Ok(cfg) if cfg.provider == "copilot-acp" => "copilot-acp",
                    _ => "claude-code",
                }
            }
        }
    } else {
        "claude-code"
    };

    // Snapshot working tree before execution
    let before_hash = git::get_head_hash(&cwd).await.unwrap_or_default();
    let before_snapshot = snapshot_working_tree(&cwd).await;

    let locale = body.locale.clone();

    // === Phase 3: Execute ===
    if engine == "acp" || engine == "codex-acp" || engine == "copilot-acp" {
        // ACP engine path
        let agent_type = match engine {
            "codex-acp" => "codex",
            "copilot-acp" => "copilot",
            _ => "claude",
        };

        let model_to_set: Option<String> = {
            let db = state.db.lock().unwrap();
            resolve_step_config(&db, "execute", req_provider, req_model)
                .ok()
                .map(|c| c.model)
        };

        let existing_session_id = task_data.session_id.clone();
        let item_id_clone = item_id.clone();
        let cwd_clone = cwd.clone();
        let db_state = state.clone();
        let project_id = task_data.project_id.clone();

        let (tx, rx) =
            tokio::sync::mpsc::channel::<Result<String, std::convert::Infallible>>(100);

        tokio::spawn(async move {
            let mut full_log = String::new();

            let send = |tx: &tokio::sync::mpsc::Sender<Result<String, std::convert::Infallible>>,
                        msg: String| {
                let tx = tx.clone();
                async move {
                    let _ = tx.send(Ok(msg)).await;
                }
            };

            send(&tx, "Connecting to ACP agent...\n".to_string()).await;

            let mut acp_client = match AcpClient::start(&cwd_clone, agent_type).await {
                Ok(c) => c,
                Err(e) => {
                    full_log.push_str(&format!("\nError: {}", e));
                    send(&tx, format!("\nError: {}", e)).await;
                    update_item_status(&db_state, &item_id_clone, "failed", 0, &full_log);
                    return;
                }
            };

            // Resume or create session
            let session_id = if let Some(ref existing) = existing_session_id {
                send(
                    &tx,
                    format!("Resuming session {}...\n", &existing[..8.min(existing.len())]),
                )
                .await;
                match acp_client.resume_session(existing).await {
                    Ok(sid) => sid,
                    Err(e) => {
                        full_log.push_str(&format!("\nResume failed: {}", e));
                        match acp_client.create_session(model_to_set.as_deref()).await {
                            Ok(sid) => sid,
                            Err(e2) => {
                                full_log.push_str(&format!("\nCreate session failed: {}", e2));
                                send(&tx, format!("\nError: {}", e2)).await;
                                update_item_status(
                                    &db_state,
                                    &item_id_clone,
                                    "failed",
                                    0,
                                    &full_log,
                                );
                                acp_client.stop().await;
                                return;
                            }
                        }
                    }
                }
            } else {
                match acp_client.create_session(model_to_set.as_deref()).await {
                    Ok(sid) => sid,
                    Err(e) => {
                        full_log.push_str(&format!("\nError: {}", e));
                        send(&tx, format!("\nError: {}", e)).await;
                        update_item_status(&db_state, &item_id_clone, "failed", 0, &full_log);
                        acp_client.stop().await;
                        return;
                    }
                }
            };

            // Set model if specified
            if let Some(ref m) = model_to_set {
                let _ = acp_client.set_model(&session_id, m).await;
            }

            // Save session ID to project for reuse
            if Some(session_id.as_str()) != existing_session_id.as_deref() {
                let db = db_state.db.lock().unwrap();
                db.execute(
                    "UPDATE projects SET session_id = ?1 WHERE id = ?2",
                    rusqlite::params![session_id, project_id],
                )
                .ok();
            }

            send(&tx, format!("Session: {}\n\n", session_id)).await;
            full_log.push_str(&format!("[ACP] Session: {}\n", session_id));

            // Set up update channel
            let (update_tx, mut update_rx) = tokio::sync::mpsc::channel::<AcpUpdate>(256);

            // Forward updates to SSE stream
            let tx_fwd = tx.clone();
            let is_zh_locale = locale.as_deref() == Some("zh");
            let forward_task = tokio::spawn(async move {
                let mut full = String::new();
                let mut saw_content = false;
                while let Some(upd) = update_rx.recv().await {
                    full.push_str(&upd.text);
                    match upd.event_type.as_str() {
                        "tool" | "plan" => {
                            saw_content = true;
                            let msg = if upd.event_type == "plan" {
                                format!("\nPlan:\n{}\n\n", upd.text)
                            } else {
                                upd.text.clone()
                            };
                            let _ = tx_fwd.send(Ok(msg)).await;
                        }
                        "text" => {
                            // For zh locale, skip English-only thinking before first tool/Chinese text
                            if !is_zh_locale || saw_content || contains_chinese(&upd.text) {
                                saw_content = true;
                                let _ = tx_fwd.send(Ok(upd.text.clone())).await;
                            }
                        }
                        "thought" => {
                            // Don't send to stream, just log
                        }
                        _ => {}
                    }
                }
                full
            });

            // Execute prompt
            let result = acp_client
                .prompt(&session_id, &prompt, update_tx, None)
                .await;

            // Wait for forward task to finish
            let update_log = forward_task.await.unwrap_or_default();
            full_log.push_str(&update_log);

            match result {
                Ok(acp_result) => {
                    let total_tokens = acp_result
                        .usage
                        .as_ref()
                        .and_then(|u| u.get("totalTokens"))
                        .and_then(|v| v.as_i64())
                        .map(|t| t.to_string())
                        .unwrap_or_else(|| "?".to_string());
                    full_log.push_str(&format!(
                        "\n[ACP] Stop: {}, tokens: {}",
                        acp_result.stop_reason, total_tokens
                    ));
                    send(
                        &tx,
                        format!("\n\n---\nStop: {}", acp_result.stop_reason),
                    )
                    .await;

                    update_item_status(
                        &db_state,
                        &item_id_clone,
                        "completed",
                        100,
                        if full_log.is_empty() {
                            "No output"
                        } else {
                            &full_log
                        },
                    );
                }
                Err(e) => {
                    full_log.push_str(&format!("\nError: {}", e));
                    send(&tx, format!("\nError: {}", e)).await;
                    update_item_status(
                        &db_state,
                        &item_id_clone,
                        "failed",
                        0,
                        if full_log.is_empty() { "Error" } else { &full_log },
                    );
                }
            }

            // Capture file snapshots and resolve findings
            capture_file_snapshots(&db_state, &item_id_clone, &cwd_clone, &before_hash, &before_snapshot).await;
            resolve_related_findings(&db_state, &item_id_clone);

            acp_client.stop().await;
        });

        let stream = ReceiverStream::new(rx);
        let body = Body::from_stream(stream);
        return Response::builder()
            .header("content-type", "text/plain; charset=utf-8")
            .body(body)
            .unwrap();
    }

    // === SDK engine path ===
    let ai_config = {
        let db = state.db.lock().unwrap();
        match resolve_step_config(&db, "execute", req_provider, req_model) {
            Ok(c) => c,
            Err(e) => {
                update_item_status(&state, &item_id, "failed", 0, &format!("Error: {}", e));
                return error_response(503, &e);
            }
        }
    };

    let item_id_clone = item_id.clone();
    let cwd_clone = cwd.clone();
    let db_state = state.clone();

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<String, std::convert::Infallible>>(100);

    tokio::spawn(async move {
        let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel::<String>(100);

        let system = "You are an expert software engineer. Implement the requested changes precisely and efficiently.".to_string();

        let ai_handle = tokio::spawn(async move {
            stream_ai_call(&ai_config, &system, &prompt, chunk_tx).await
        });

        let mut full_log = String::new();
        while let Some(chunk) = chunk_rx.recv().await {
            full_log.push_str(&chunk);
            let _ = tx.send(Ok(chunk)).await;
        }

        let result = ai_handle.await;
        if let Ok(Err(e)) = result {
            full_log.push_str(&format!("\nError: {}", e));
            let _ = tx.send(Ok(format!("\nError: {}", e))).await;
        }

        // Determine final status
        let has_error = full_log.contains("\nError:");
        if has_error {
            update_item_status(
                &db_state,
                &item_id_clone,
                "failed",
                0,
                if full_log.is_empty() { "Error" } else { &full_log },
            );
        } else {
            update_item_status(
                &db_state,
                &item_id_clone,
                "completed",
                100,
                if full_log.is_empty() {
                    "No output"
                } else {
                    &full_log
                },
            );
        }

        capture_file_snapshots(&db_state, &item_id_clone, &cwd_clone, &before_hash, &before_snapshot).await;
        resolve_related_findings(&db_state, &item_id_clone);
    });

    let stream = ReceiverStream::new(rx);
    let body = Body::from_stream(stream);
    Response::builder()
        .header("content-type", "text/plain; charset=utf-8")
        .body(body)
        .unwrap()
}

// ---------------------------------------------------------------------------
// DELETE /api/execute/{taskId} — Cancel a running task
// ---------------------------------------------------------------------------

pub async fn cancel_task(
    State(state): State<AppState>,
    axum::extract::Path(task_id): axum::extract::Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let db = state.db.lock().unwrap();

    // Check item exists and is running
    let status: String = db
        .query_row(
            "SELECT status FROM schedule_items WHERE id = ?1",
            rusqlite::params![task_id],
            |row| row.get(0),
        )
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Item not found"})),
            )
        })?;

    if status != "in_progress" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Task is not running"})),
        ));
    }

    // Reset status to pending
    db.execute(
        "UPDATE schedule_items SET status = 'pending', progress = 0, execution_log = 'Cancelled' WHERE id = ?1",
        rusqlite::params![task_id],
    )
    .ok();

    Ok(Json(json!({"success": true})))
}

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

#[allow(dead_code)]
struct TaskItem {
    id: String,
    schedule_id: String,
    scheme_id: Option<String>,
    _parent_id: Option<String>,
    title: String,
    description: String,
    order: i64,
    _status: String,
    engine: Option<String>,
    skills: String,
}

struct TaskData {
    item: TaskItem,
    #[allow(dead_code)]
    plan_id: String,
    project_id: String,
    target_repo_path: String,
    session_id: Option<String>,
    previous_tasks: String,
    scheme_context: String,
    memory_context: String,
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

fn error_response(status: u16, message: &str) -> Response {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_string(&json!({"error": message})).unwrap(),
        ))
        .unwrap()
}

fn update_item_status(state: &AppState, item_id: &str, status: &str, progress: i64, log: &str) {
    let db = state.db.lock().unwrap();
    db.execute(
        "UPDATE schedule_items SET status = ?1, progress = ?2, execution_log = ?3 WHERE id = ?4",
        rusqlite::params![status, progress, log, item_id],
    )
    .ok();
}

/// Load memory context from the memories table for a project.
fn load_memory_context(db: &rusqlite::Connection, project_id: &str) -> String {
    let mut stmt = match db.prepare(
        "SELECT content FROM memories WHERE project_id = ?1 ORDER BY created_at DESC LIMIT 10",
    ) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };

    let memories: Vec<String> = match stmt.query_map(rusqlite::params![project_id], |row| row.get(0)) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    };

    if memories.is_empty() {
        String::new()
    } else {
        format!("Project memory:\n{}", memories.join("\n"))
    }
}

/// Snapshot working tree state (dirty + untracked files) before execution.
async fn snapshot_working_tree(cwd: &str) -> HashMap<String, String> {
    let mut snapshot = HashMap::new();

    // Tracked files with uncommitted changes
    if let Ok(output) = process::exec("git", &["diff", "HEAD", "--name-only"], cwd).await {
        for fp in output.trim().lines().filter(|l| !l.is_empty()) {
            let abs_path = Path::new(cwd).join(fp);
            if let Ok(content) = std::fs::read_to_string(&abs_path) {
                snapshot.insert(fp.to_string(), content);
            }
        }
    }

    // Untracked files
    if let Ok(output) =
        process::exec("git", &["ls-files", "--others", "--exclude-standard"], cwd).await
    {
        for fp in output.trim().lines().filter(|l| !l.is_empty()) {
            let abs_path = Path::new(cwd).join(fp);
            if let Ok(content) = std::fs::read_to_string(&abs_path) {
                snapshot.insert(fp.to_string(), content);
            }
        }
    }

    snapshot
}

/// Capture file snapshots after task execution.
async fn capture_file_snapshots(
    state: &AppState,
    item_id: &str,
    cwd: &str,
    before_hash: &str,
    before_snapshot: &HashMap<String, String>,
) {
    let after_hash = git::get_head_hash(cwd).await.unwrap_or_default();

    // Committed changes
    let mut committed_files: Vec<String> = Vec::new();
    if !before_hash.is_empty() && !after_hash.is_empty() && before_hash != after_hash {
        let range = format!("{}..{}", before_hash, after_hash);
        if let Ok(output) = process::exec("git", &["diff", "--name-only", &range], cwd).await {
            committed_files = output
                .trim()
                .lines()
                .filter(|l| !l.is_empty())
                .map(|s| s.to_string())
                .collect();
        }
    }

    // Uncommitted changes that differ from pre-task snapshot
    let mut uncommitted_files: Vec<String> = Vec::new();
    if let Ok(output) = process::exec("git", &["diff", "HEAD", "--name-only"], cwd).await {
        for fp in output.trim().lines().filter(|l| !l.is_empty()) {
            let abs_path = Path::new(cwd).join(fp);
            let current = std::fs::read_to_string(&abs_path).unwrap_or_default();
            let prev = before_snapshot.get(fp).cloned().unwrap_or_default();
            if current != prev {
                uncommitted_files.push(fp.to_string());
            }
        }
    }

    // New untracked files
    if let Ok(output) =
        process::exec("git", &["ls-files", "--others", "--exclude-standard"], cwd).await
    {
        for fp in output.trim().lines().filter(|l| !l.is_empty()) {
            if !before_snapshot.contains_key(fp) {
                uncommitted_files.push(fp.to_string());
            }
        }
    }

    let all_files: HashSet<String> = committed_files
        .iter()
        .chain(uncommitted_files.iter())
        .cloned()
        .collect();

    if all_files.is_empty() {
        return;
    }

    let db = state.db.lock().unwrap();
    for file_path in &all_files {
        // contentBefore
        let mut content_before = before_snapshot.get(file_path).cloned().unwrap_or_default();
        if content_before.is_empty() && !before_hash.is_empty() {
            let show_ref = format!("{}:{}", before_hash, file_path);
            // Use blocking exec for simplicity — we're already in an async context
            // but we hold db lock so we can't easily use async. Use std::process instead.
            if let Ok(output) = std::process::Command::new("git")
                .args(["show", &show_ref])
                .current_dir(cwd)
                .output()
            {
                if output.status.success() {
                    content_before = String::from_utf8_lossy(&output.stdout).to_string();
                }
            }
        }

        // contentAfter
        let content_after = if committed_files.contains(file_path) && !after_hash.is_empty() {
            let show_ref = format!("{}:{}", after_hash, file_path);
            if let Ok(output) = std::process::Command::new("git")
                .args(["show", &show_ref])
                .current_dir(cwd)
                .output()
            {
                if output.status.success() {
                    String::from_utf8_lossy(&output.stdout).to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        } else {
            let abs_path = Path::new(cwd).join(file_path);
            std::fs::read_to_string(&abs_path).unwrap_or_default()
        };

        if content_before == content_after {
            continue;
        }

        let snap_id = uuid::Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO file_snapshots (id, schedule_item_id, file_path, content_before, content_after) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![snap_id, item_id, file_path, content_before, content_after],
        )
        .ok();
    }
}

/// When a [fix] task completes, mark its related review findings as resolved.
fn resolve_related_findings(state: &AppState, item_id: &str) {
    let db = state.db.lock().unwrap();

    // Get item title
    let item_title: Option<String> = db
        .query_row(
            "SELECT title FROM schedule_items WHERE id = ?1",
            rusqlite::params![item_id],
            |row| row.get(0),
        )
        .ok();

    // Resolve findings targeted at this item
    let mut stmt = match db.prepare(
        "SELECT id FROM review_items WHERE target_id = ?1 AND (resolved IS NULL OR resolved = 0)",
    ) {
        Ok(s) => s,
        Err(_) => return,
    };
    let finding_ids: Vec<String> = match stmt.query_map(rusqlite::params![item_id], |row| row.get(0)) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    };

    for fid in &finding_ids {
        db.execute(
            "UPDATE review_items SET resolved = 1 WHERE id = ?1",
            rusqlite::params![fid],
        )
        .ok();
    }

    // Also resolve findings matching [fix] title pattern
    if let Some(title) = item_title {
        if let Some(finding_title) = title.strip_prefix("[fix] ") {
            let mut stmt2 = match db.prepare(
                "SELECT id FROM review_items WHERE title = ?1 AND (resolved IS NULL OR resolved = 0)",
            ) {
                Ok(s) => s,
                Err(_) => return,
            };
            let matching_ids: Vec<String> = match stmt2.query_map(rusqlite::params![finding_title], |row| row.get(0)) {
                Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
                Err(_) => vec![],
            };

            for fid in &matching_ids {
                db.execute(
                    "UPDATE review_items SET resolved = 1 WHERE id = ?1",
                    rusqlite::params![fid],
                )
                .ok();
            }
        }
    }
}

/// Check if a string contains Chinese characters.
fn contains_chinese(text: &str) -> bool {
    text.chars()
        .any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
}
