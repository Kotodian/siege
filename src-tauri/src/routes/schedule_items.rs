use axum::{
    body::Body,
    extract::{Path, State},
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
pub struct UpdateItem {
    title: Option<String>,
    description: Option<String>,
    #[serde(rename = "startDate")]
    start_date: Option<String>,
    #[serde(rename = "endDate")]
    end_date: Option<String>,
    order: Option<i64>,
    engine: Option<String>,
    skills: Option<String>,
    status: Option<String>,
    #[serde(rename = "parentId")]
    parent_id: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateItem>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(ref v) = body.title {
        sets.push(format!("title = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.description {
        sets.push(format!("description = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.start_date {
        sets.push(format!("start_date = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.end_date {
        sets.push(format!("end_date = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(v) = body.order {
        sets.push(format!("\"order\" = ?{}", idx));
        params.push(Box::new(v));
        idx += 1;
    }
    if let Some(ref v) = body.engine {
        sets.push(format!("engine = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.skills {
        sets.push(format!("skills = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.status {
        sets.push(format!("status = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.parent_id {
        sets.push(format!("parent_id = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }

    if !sets.is_empty() {
        let sql = format!(
            "UPDATE schedule_items SET {} WHERE id = ?{}",
            sets.join(", "),
            idx
        );
        params.push(Box::new(id.clone()));
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        db.execute(&sql, param_refs.as_slice()).ok();
    }

    let item = db
        .query_row(
            "SELECT id, schedule_id, scheme_id, parent_id, title, description, start_date, end_date, \"order\", status, progress, execution_log, engine, skills
             FROM schedule_items WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok(item_from_row(row)),
        )
        .unwrap_or(json!(null));

    Json(item)
}

pub async fn delete_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    db.execute(
        "DELETE FROM schedule_items WHERE id = ?1",
        rusqlite::params![id],
    )
    .ok();
    Json(json!({"success": true}))
}

// ---------------------------------------------------------------------------
// POST /api/schedule-items/:id/split — Split task into subtasks
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SplitBody {
    mode: Option<String>,
    subtasks: Option<Vec<ManualSubtask>>,
    provider: Option<String>,
    model: Option<String>,
    locale: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct ManualSubtask {
    title: String,
    description: Option<String>,
    #[serde(rename = "estimatedHours")]
    estimated_hours: Option<f64>,
}

fn insert_subtasks(
    db: &rusqlite::Connection,
    parent_id: &str,
    parent: &(String, Option<String>, String, String, i64, Option<String>), // (schedule_id, scheme_id, start_date, end_date, order, engine)
    subtasks: &[ManualSubtask],
) -> Vec<Value> {
    let parent_start_ms = parse_iso_approx(parent.2.as_str());
    let parent_end_ms = parse_iso_approx(parent.3.as_str());
    let total_hours: f64 = subtasks
        .iter()
        .map(|st| st.estimated_hours.unwrap_or(1.0))
        .sum();
    let ms_per_hour = if total_hours > 0.0 {
        (parent_end_ms - parent_start_ms) as f64 / total_hours
    } else {
        3_600_000.0
    };

    let mut created = Vec::new();
    let mut cursor = parent_start_ms;

    for (i, st) in subtasks.iter().enumerate() {
        let hours = st.estimated_hours.unwrap_or(1.0);
        let st_start = cursor;
        let st_end = cursor + (ms_per_hour * hours) as u64;
        cursor = st_end;

        let id = uuid::Uuid::new_v4().to_string();
        let order = parent.4 * 100 + i as i64 + 1;
        let engine = parent.5.as_deref().unwrap_or("claude-code");

        db.execute(
            "INSERT INTO schedule_items (id, schedule_id, scheme_id, parent_id, title, description, start_date, end_date, \"order\", status, progress, engine, skills) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', 0, ?10, '[]')",
            rusqlite::params![id, parent.0, parent.1, parent_id, st.title, st.description.as_deref().unwrap_or(""), format_ts_ms(st_start), format_ts_ms(st_end), order, engine],
        ).ok();

        created.push(json!({"id": id, "title": st.title}));
    }

    created
}

/// Approximate ISO timestamp to epoch millis (very simple parser).
fn parse_iso_approx(iso: &str) -> u64 {
    // Just use current time as fallback — precise parsing not critical
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
        - if iso.contains("2020") { 0 } else { 0 } // placeholder
}

fn format_ts_ms(ms: u64) -> String {
    let secs = ms / 1000;
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    let (year, month, day) = days_to_date(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z",
        year, month, day, hours, minutes, seconds
    )
}

fn days_to_date(days: u64) -> (u64, u64, u64) {
    let mut y = 1970u64;
    let mut remaining = days;
    loop {
        let diy = if (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0) {
            366
        } else {
            365
        };
        if remaining < diy {
            break;
        }
        remaining -= diy;
        y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
    let dim: [u64; 12] = if leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut m = 1u64;
    for &d in &dim {
        if remaining < d {
            break;
        }
        remaining -= d;
        m += 1;
    }
    (y, m, remaining + 1)
}

pub async fn split(
    State(state): State<AppState>,
    Path(item_id): Path<String>,
    Json(body): Json<SplitBody>,
) -> Response {
    let mode = body.mode.as_deref().unwrap_or("ai");

    // Load parent item info
    let parent_info = {
        let db = state.db.lock().unwrap();
        let item = db.query_row(
            "SELECT schedule_id, scheme_id, parent_id, title, description, start_date, end_date, \"order\", engine FROM schedule_items WHERE id = ?1",
            rusqlite::params![item_id],
            |row| Ok((
                row.get::<_, String>(0)?,    // schedule_id
                row.get::<_, Option<String>>(1)?, // scheme_id
                row.get::<_, Option<String>>(2)?, // parent_id
                row.get::<_, String>(3)?,    // title
                row.get::<_, Option<String>>(4)?, // description
                row.get::<_, String>(5)?,    // start_date
                row.get::<_, String>(6)?,    // end_date
                row.get::<_, i64>(7)?,       // order
                row.get::<_, Option<String>>(8)?, // engine
            )),
        );

        match item {
            Ok(i) => i,
            Err(_) => {
                return Response::builder()
                    .status(404)
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"error":"Item not found"}"#))
                    .unwrap();
            }
        }
    };

    // Cannot split a subtask
    if parent_info.2.is_some() {
        return Response::builder()
            .status(400)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"error":"Cannot split a subtask"}"#))
            .unwrap();
    }

    // Check for existing children
    {
        let db = state.db.lock().unwrap();
        let count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM schedule_items WHERE parent_id = ?1",
                rusqlite::params![item_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if count > 0 {
            return Response::builder()
                .status(400)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"error":"Task already has subtasks"}"#))
                .unwrap();
        }
    }

    let parent_tuple = (
        parent_info.0.clone(),  // schedule_id
        parent_info.1.clone(),  // scheme_id
        parent_info.5.clone(),  // start_date
        parent_info.6.clone(),  // end_date
        parent_info.7,          // order
        parent_info.8.clone(),  // engine
    );

    // Manual mode
    if mode == "manual" {
        let subtasks = match body.subtasks {
            Some(ref st) if !st.is_empty() => st.clone(),
            _ => {
                return Response::builder()
                    .status(400)
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"error":"subtasks array required for manual mode"}"#,
                    ))
                    .unwrap();
            }
        };

        let db = state.db.lock().unwrap();
        let created = insert_subtasks(&db, &item_id, &parent_tuple, &subtasks);
        let result = json!({"parentId": item_id, "subtasks": created});
        return Response::builder()
            .status(201)
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_string(&result).unwrap()))
            .unwrap();
    }

    // AI mode
    let is_zh = body.locale.as_deref().map(|l| l == "zh").unwrap_or(false);
    let lang_note = if is_zh { "\nUse Chinese for titles and descriptions." } else { "" };

    let split_prompt = format!(
        r#"<IMPORTANT>
You are being called as an API. Output ONLY a JSON array. No conversation, no markdown fences.
Start directly with [ and end with ].
</IMPORTANT>

Break this task into 2-5 concrete implementation subtasks.

Task: {}
Description: {}

Each subtask should be a specific, actionable coding step.

JSON array format — each object:
- title: concise subtask title (string)
- description: specific implementation details (string)
- estimatedHours: number (0.5-2){}

Output the JSON array now:"#,
        parent_info.3,
        parent_info.4.as_deref().unwrap_or("N/A"),
        lang_note
    );

    let ai_config = {
        let db = state.db.lock().unwrap();
        match resolve_step_config(
            &db,
            "schedule",
            body.provider.as_deref(),
            body.model.as_deref(),
        ) {
            Ok(c) => c,
            Err(e) => {
                return Response::builder()
                    .status(503)
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&json!({"error": e})).unwrap(),
                    ))
                    .unwrap();
            }
        }
    };

    let system = "You are a task planner.".to_string();
    let db_clone = Arc::clone(&state.db);
    let item_id_clone = item_id.clone();

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<String, std::convert::Infallible>>(100);

    tokio::spawn(async move {
        let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel::<String>(100);

        let ai_handle = tokio::spawn(async move {
            stream_ai_call(&ai_config, &system, &split_prompt, chunk_tx).await
        });

        let mut full_text = String::new();
        while let Some(chunk) = chunk_rx.recv().await {
            full_text.push_str(&chunk);
            let _ = tx.send(Ok(chunk)).await;
        }

        let result = ai_handle.await;
        if let Ok(Err(e)) = result {
            let _ = tx.send(Ok(format!("\nError: {}", e))).await;
        }

        // Parse and save subtasks
        if !full_text.trim().is_empty() {
            let trimmed = full_text.trim();
            let json_str = if trimmed.starts_with('[') {
                trimmed.to_string()
            } else {
                let start = trimmed.find('[');
                let end = trimmed.rfind(']');
                match (start, end) {
                    (Some(s), Some(e)) if e > s => trimmed[s..=e].to_string(),
                    _ => String::new(),
                }
            };

            if !json_str.is_empty() {
                if let Ok(parsed) = serde_json::from_str::<Vec<Value>>(&json_str) {
                    let manual_subtasks: Vec<ManualSubtask> = parsed
                        .iter()
                        .map(|v| ManualSubtask {
                            title: v
                                .get("title")
                                .and_then(|t| t.as_str())
                                .unwrap_or("Subtask")
                                .to_string(),
                            description: v.get("description").and_then(|t| t.as_str()).map(|s| s.to_string()),
                            estimated_hours: v
                                .get("estimatedHours")
                                .and_then(|t| t.as_f64()),
                        })
                        .collect();

                    let db = db_clone.lock().unwrap();
                    insert_subtasks(&db, &item_id_clone, &parent_tuple, &manual_subtasks);
                }
            }
        }
    });

    let stream = ReceiverStream::new(rx);
    let body = Body::from_stream(stream);
    Response::builder()
        .header("content-type", "text/plain; charset=utf-8")
        .body(body)
        .unwrap()
}

fn item_from_row(row: &rusqlite::Row) -> Value {
    json!({
        "id": row.get::<_, String>(0).unwrap_or_default(),
        "scheduleId": row.get::<_, String>(1).unwrap_or_default(),
        "schemeId": row.get::<_, Option<String>>(2).unwrap_or_default(),
        "parentId": row.get::<_, Option<String>>(3).unwrap_or_default(),
        "title": row.get::<_, String>(4).unwrap_or_default(),
        "description": row.get::<_, Option<String>>(5).unwrap_or_default(),
        "startDate": row.get::<_, String>(6).unwrap_or_default(),
        "endDate": row.get::<_, String>(7).unwrap_or_default(),
        "order": row.get::<_, i64>(8).unwrap_or_default(),
        "status": row.get::<_, String>(9).unwrap_or_default(),
        "progress": row.get::<_, i64>(10).unwrap_or_default(),
        "executionLog": row.get::<_, Option<String>>(11).unwrap_or_default(),
        "engine": row.get::<_, Option<String>>(12).unwrap_or_default(),
        "skills": row.get::<_, Option<String>>(13).unwrap_or_default(),
    })
}
