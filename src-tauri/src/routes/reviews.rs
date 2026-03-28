use axum::{
    body::Body,
    extract::{Query, State},
    http::StatusCode,
    response::Response,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio_stream::wrappers::ReceiverStream;

use crate::ai::config::resolve_step_config;
use crate::ai::streaming::stream_ai_call;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ListParams {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
    #[serde(rename = "type")]
    review_type: Option<String>,
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

    // Get reviews for plan
    let mut stmt = db
        .prepare(
            "SELECT id, plan_id, type, status, content, created_at, updated_at FROM reviews WHERE plan_id = ?1",
        )
        .unwrap();
    let all_reviews: Vec<Value> = stmt
        .query_map(rusqlite::params![plan_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "planId": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "status": row.get::<_, String>(3)?,
                "content": row.get::<_, Option<String>>(4)?,
                "createdAt": row.get::<_, String>(5)?,
                "updatedAt": row.get::<_, String>(6)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    // Filter by type if provided
    let filtered: Vec<&Value> = if let Some(ref rt) = params.review_type {
        all_reviews
            .iter()
            .filter(|r| r["type"].as_str() == Some(rt.as_str()))
            .collect()
    } else {
        all_reviews.iter().collect()
    };

    // Build schedule item lookup
    let mut si_stmt = db
        .prepare("SELECT id, title, \"order\" FROM schedule_items")
        .unwrap();
    let schedule_items: Vec<(String, String, i64)> = si_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let result: Vec<Value> = filtered
        .iter()
        .map(|review| {
            let review_id = review["id"].as_str().unwrap_or_default();

            // Get review items
            let mut items_stmt = db
                .prepare(
                    "SELECT id, review_id, target_type, target_id, title, content, severity, resolved, resolution, file_path, line_number, options FROM review_items WHERE review_id = ?1",
                )
                .unwrap();
            let items: Vec<Value> = items_stmt
                .query_map(rusqlite::params![review_id], |row| {
                    let target_type: String = row.get(2)?;
                    let target_id: String = row.get(3)?;
                    let (task_title, task_order) = if target_type == "schedule_item" {
                        schedule_items
                            .iter()
                            .find(|si| si.0 == target_id)
                            .map(|si| (Some(si.1.clone()), Some(si.2)))
                            .unwrap_or((None, None))
                    } else {
                        (None, None)
                    };
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "reviewId": row.get::<_, String>(1)?,
                        "targetType": target_type,
                        "targetId": target_id,
                        "title": row.get::<_, String>(4)?,
                        "content": row.get::<_, Option<String>>(5)?,
                        "severity": row.get::<_, String>(6)?,
                        "resolved": row.get::<_, bool>(7)?,
                        "resolution": row.get::<_, Option<String>>(8)?,
                        "filePath": row.get::<_, Option<String>>(9)?,
                        "lineNumber": row.get::<_, Option<i64>>(10)?,
                        "options": row.get::<_, Option<String>>(11)?,
                        "taskTitle": task_title,
                        "taskOrder": task_order,
                    }))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            // Get review comments
            let mut comments_stmt = db
                .prepare(
                    "SELECT id, review_id, file_path, line_number, content, ai_response, status, created_at FROM review_comments WHERE review_id = ?1",
                )
                .unwrap();
            let comments: Vec<Value> = comments_stmt
                .query_map(rusqlite::params![review_id], |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "reviewId": row.get::<_, String>(1)?,
                        "filePath": row.get::<_, String>(2)?,
                        "lineNumber": row.get::<_, i64>(3)?,
                        "content": row.get::<_, String>(4)?,
                        "aiResponse": row.get::<_, Option<String>>(5)?,
                        "status": row.get::<_, String>(6)?,
                        "createdAt": row.get::<_, String>(7)?,
                    }))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            let mut r = (*review).clone();
            r["items"] = json!(items);
            r["comments"] = json!(comments);
            r
        })
        .collect();

    Ok(Json(json!(result)))
}

#[derive(Deserialize)]
pub struct CreateReview {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
    #[serde(rename = "type")]
    review_type: Option<String>,
    status: Option<String>,
    content: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateReview>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let plan_id = body.plan_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId and type are required"})),
        )
    })?;
    let review_type = body.review_type.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId and type are required"})),
        )
    })?;

    let id = uuid::Uuid::new_v4().to_string();
    let status = body.status.unwrap_or_else(|| "pending".to_string());
    let content = body.content.unwrap_or_default();

    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO reviews (id, plan_id, type, status, content) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, plan_id, review_type, status, content],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let review = db
        .query_row(
            "SELECT id, plan_id, type, status, content, created_at, updated_at FROM reviews WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "planId": row.get::<_, String>(1)?,
                    "type": row.get::<_, String>(2)?,
                    "status": row.get::<_, String>(3)?,
                    "content": row.get::<_, Option<String>>(4)?,
                    "createdAt": row.get::<_, String>(5)?,
                    "updatedAt": row.get::<_, String>(6)?,
                }))
            },
        )
        .unwrap_or(json!(null));

    Ok((StatusCode::CREATED, Json(review)))
}

#[derive(Deserialize)]
pub struct CancelBody {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
}

pub async fn cancel(
    State(state): State<AppState>,
    Json(body): Json<CancelBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let plan_id = body.plan_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId required"})),
        )
    })?;

    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id FROM reviews WHERE plan_id = ?1 AND status = 'in_progress'")
        .unwrap();
    let in_progress: Vec<String> = stmt
        .query_map(rusqlite::params![plan_id], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    for rid in &in_progress {
        db.execute(
            "UPDATE reviews SET status = 'changes_requested', content = '已取消 / Cancelled', updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![rid],
        )
        .ok();
    }

    Ok(Json(json!({"cancelled": in_progress.len()})))
}

// ---------------------------------------------------------------------------
// POST /api/reviews/generate — Generate review via AI
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct GenerateReviewBody {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
    #[serde(rename = "type")]
    review_type: Option<String>,
    #[serde(rename = "scheduleItemId")]
    schedule_item_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    locale: Option<String>,
}

fn build_review_prompt(
    review_type: &str,
    plan_name: &str,
    items: &[(String, String, String)], // (id, title, content)
    is_zh: bool,
) -> (String, String) {
    let items_summary: String = items
        .iter()
        .map(|(id, title, content)| format!("### {} (id: {})\n{}", title, id, content))
        .collect::<Vec<_>>()
        .join("\n\n");

    let items_schema = if review_type == "implementation" {
        r#"- items: array of findings, each with targetId (string), title (string), content (string describing the issue), severity ("info"|"warning"|"critical"), filePath (string), lineNumber (number), options (array of 1-3 short solution suggestions)"#
    } else {
        r#"- items: array of findings, each with targetId (string — MUST be the exact "id" from the section header), title (string), content (string), severity ("info"|"warning"|"critical"), options (array of 1-3 short solution suggestions)

IMPORTANT: Each finding's targetId MUST exactly match the "(id: ...)" from the section it refers to."#
    };

    let lang_instruction = if is_zh {
        "\n\nIMPORTANT: Write all summary and finding content in Chinese."
    } else {
        ""
    };

    let system = format!(
        r#"You are a code review engine. Output JSON only. No conversation.

CRITICAL: Do NOT ask questions, request access, or use tools. Review based solely on the content provided.

Review for: correctness, security vulnerabilities, logic bugs, runtime errors.

Severity guidelines:
- "critical": ONLY for real bugs that will cause crashes, data loss, or security vulnerabilities
- "warning": potential issues, missing error handling, performance concerns
- "info": style suggestions, naming improvements, minor refactoring opportunities

Be practical — approve if the code works correctly even if it could be cleaner.

Output a JSON object with:
- summary: overall review summary as markdown (string)
{}
- approved: boolean (true if no critical bugs or security issues)

Output ONLY the JSON object. No other text before or after.{}"#,
        items_schema, lang_instruction
    );

    let prompt = format!("Plan: {}\n\n{}", plan_name, items_summary);
    (system, prompt)
}

fn save_review_result(
    db: &rusqlite::Connection,
    full_text: &str,
    review_id: &str,
    plan_id: &str,
    review_type: &str,
) -> bool {
    let trimmed = full_text.trim();
    let mut parsed: Option<Value> = serde_json::from_str(trimmed).ok();
    if parsed.is_none() {
        let fenced = trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_start()
            .trim_end_matches("```")
            .trim();
        parsed = serde_json::from_str(fenced).ok();
    }
    if parsed.is_none() {
        if let Some(start) = trimmed.find('{') {
            let mut depth = 0i32;
            let mut end = start;
            for (i, c) in trimmed[start..].char_indices() {
                if c == '{' {
                    depth += 1;
                } else if c == '}' {
                    depth -= 1;
                    if depth == 0 {
                        end = start + i + 1;
                        break;
                    }
                }
            }
            parsed = serde_json::from_str(&trimmed[start..end]).ok();
        }
    }

    if let Some(ref obj) = parsed {
        if obj.get("summary").is_some() {
            let approved = obj.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);
            let status = if approved {
                "approved"
            } else {
                "changes_requested"
            };
            let summary = obj
                .get("summary")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            db.execute(
                "UPDATE reviews SET status = ?1, content = ?2, updated_at = datetime('now') WHERE id = ?3",
                rusqlite::params![status, summary, review_id],
            ).ok();

            if let Some(items) = obj.get("items").and_then(|v| v.as_array()) {
                for item in items {
                    let target_id = item
                        .get("targetId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let title = item
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Finding");
                    let content = item
                        .get("content")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let severity = item
                        .get("severity")
                        .and_then(|v| v.as_str())
                        .unwrap_or("info");
                    let file_path = item.get("filePath").and_then(|v| v.as_str());
                    let line_number = item.get("lineNumber").and_then(|v| v.as_i64());
                    let options = item
                        .get("options")
                        .and_then(|v| v.as_array())
                        .map(|arr| serde_json::to_string(arr).unwrap_or_default());

                    let id = uuid::Uuid::new_v4().to_string();
                    let target_type = if review_type == "scheme" {
                        "scheme"
                    } else {
                        "schedule_item"
                    };

                    db.execute(
                        "INSERT INTO review_items (id, review_id, target_type, target_id, title, content, severity, resolved, file_path, line_number, options) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10)",
                        rusqlite::params![id, review_id, target_type, target_id, title, content, severity, file_path, line_number, options],
                    ).ok();
                }
            }

            // If implementation review approved, transition plan to testing
            if review_type == "implementation" && approved {
                db.execute(
                    "UPDATE plans SET status = 'testing', updated_at = datetime('now') WHERE id = ?1",
                    rusqlite::params![plan_id],
                )
                .ok();
            }

            return true;
        }
    }

    // Fallback: mark as changes_requested with raw content
    db.execute(
        "UPDATE reviews SET status = 'changes_requested', content = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![trimmed, review_id],
    ).ok();
    false
}

pub async fn generate(State(state): State<AppState>, Json(body): Json<GenerateReviewBody>) -> Response {
    let plan_id = match body.plan_id {
        Some(id) => id,
        None => {
            return Response::builder()
                .status(400)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"error":"planId and type are required"}"#))
                .unwrap();
        }
    };
    let review_type = match body.review_type {
        Some(t) => t,
        None => {
            return Response::builder()
                .status(400)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"error":"planId and type are required"}"#))
                .unwrap();
        }
    };

    let db = state.db.lock().unwrap();

    // Get plan
    let plan_name: String = match db.query_row(
        "SELECT name FROM plans WHERE id = ?1",
        rusqlite::params![plan_id],
        |row| row.get(0),
    ) {
        Ok(n) => n,
        Err(_) => {
            return Response::builder()
                .status(404)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"error":"Plan not found"}"#))
                .unwrap();
        }
    };

    // Collect items to review
    let mut items_to_review: Vec<(String, String, String)> = Vec::new();

    if review_type == "scheme" {
        let mut stmt = db
            .prepare("SELECT id, title, content, structured_content FROM schemes WHERE plan_id = ?1")
            .unwrap();
        let schemes: Vec<(String, String, Option<String>, Option<String>)> = stmt
            .query_map(rusqlite::params![plan_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        for (sid, _title, content, structured) in &schemes {
            if let Some(ref sc) = structured {
                if let Ok(data) = serde_json::from_str::<Value>(sc) {
                    if let Some(ov) = data.get("overview").and_then(|v| v.as_str()) {
                        items_to_review.push((
                            format!("{}:overview", sid),
                            "Overview".to_string(),
                            ov.to_string(),
                        ));
                    }
                    if let Some(arch) = data.get("architecture") {
                        items_to_review.push((
                            format!("{}:architecture", sid),
                            "Architecture".to_string(),
                            serde_json::to_string_pretty(arch).unwrap_or_default(),
                        ));
                    }
                    continue;
                }
            }
            // Fallback: use full content
            items_to_review.push((
                format!("{}:full", sid),
                _title.clone(),
                content.clone().unwrap_or_default(),
            ));
        }
    } else {
        // Implementation review — use schedule items execution logs
        let schedule_id: Option<String> = db
            .query_row(
                "SELECT id FROM schedules WHERE plan_id = ?1",
                rusqlite::params![plan_id],
                |row| row.get(0),
            )
            .ok();

        if let Some(sid) = schedule_id {
            let filter_item = body.schedule_item_id.as_deref();
            let mut stmt = db
                .prepare(
                    "SELECT id, title, description, execution_log, \"order\" FROM schedule_items WHERE schedule_id = ?1 ORDER BY \"order\"",
                )
                .unwrap();
            let all_items: Vec<(String, String, Option<String>, Option<String>, i64)> = stmt
                .query_map(rusqlite::params![sid], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            for (item_id, title, desc, log, order) in &all_items {
                if let Some(filter) = filter_item {
                    if item_id != filter {
                        continue;
                    }
                }
                let content = format!(
                    "{}\n\n### Execution Log\n```\n{}\n```",
                    desc.as_deref().unwrap_or(""),
                    log.as_deref().unwrap_or("No output")
                );
                items_to_review.push((
                    item_id.clone(),
                    format!("#{} {}", order, title),
                    content,
                ));
            }
        }
    }

    if items_to_review.is_empty() {
        return Response::builder()
            .status(400)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"error":"Nothing to review"}"#))
            .unwrap();
    }

    // Create review record
    let review_id = uuid::Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO reviews (id, plan_id, type, status) VALUES (?1, ?2, ?3, 'in_progress')",
        rusqlite::params![review_id, plan_id, review_type],
    )
    .ok();

    let is_zh = body.locale.as_deref().map(|l| l == "zh").unwrap_or(false);
    let (system, prompt) = build_review_prompt(&review_type, &plan_name, &items_to_review, is_zh);

    let ai_config = match resolve_step_config(
        &db,
        "review",
        body.provider.as_deref(),
        body.model.as_deref(),
    ) {
        Ok(c) => c,
        Err(e) => {
            db.execute(
                "UPDATE reviews SET status = 'changes_requested', content = ?1, updated_at = datetime('now') WHERE id = ?2",
                rusqlite::params![e, review_id],
            ).ok();
            return Response::builder()
                .status(503)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_string(&json!({"error": e})).unwrap(),
                ))
                .unwrap();
        }
    };

    drop(db); // release lock before spawning

    let db_clone = Arc::clone(&state.db);
    let plan_id_clone = plan_id.clone();
    let review_id_clone = review_id.clone();
    let review_type_clone = review_type.clone();

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<String, std::convert::Infallible>>(100);

    tokio::spawn(async move {
        let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel::<String>(100);

        let ai_handle = tokio::spawn(async move {
            stream_ai_call(&ai_config, &system, &prompt, chunk_tx).await
        });

        let status_msg = if is_zh {
            format!("AI reviewing {} sections...\n", items_to_review.len())
        } else {
            format!("AI reviewing {} sections...\n", items_to_review.len())
        };
        let _ = tx.send(Ok(status_msg)).await;

        let mut full_text = String::new();
        while let Some(chunk) = chunk_rx.recv().await {
            full_text.push_str(&chunk);
            // Show progress dots for review (JSON output not useful to display)
            if full_text.len() % 500 < 20 {
                let _ = tx.send(Ok(".".to_string())).await;
            }
        }

        let result = ai_handle.await;
        if let Ok(Err(e)) = result {
            let _ = tx.send(Ok(format!("\nError: {}", e))).await;
        }

        // Parse and save review result (scope the lock so it drops before await)
        let done_msg = {
            let db = db_clone.lock().unwrap();
            let saved = save_review_result(
                &db,
                &full_text,
                &review_id_clone,
                &plan_id_clone,
                &review_type_clone,
            );
            if saved {
                if is_zh {
                    "\nReview complete\n"
                } else {
                    "\nReview complete\n"
                }
            } else {
                "\nFailed to parse review result\n"
            }
        };
        let _ = tx.send(Ok(done_msg.to_string())).await;
    });

    let stream = ReceiverStream::new(rx);
    let body = Body::from_stream(stream);
    Response::builder()
        .header("content-type", "text/plain; charset=utf-8")
        .body(body)
        .unwrap()
}
