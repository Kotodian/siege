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
    let schedule = db.query_row(
        "SELECT id, plan_id, start_date, end_date, auto_execute FROM schedules WHERE plan_id = ?1",
        rusqlite::params![plan_id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "planId": row.get::<_, String>(1)?,
                "startDate": row.get::<_, String>(2)?,
                "endDate": row.get::<_, String>(3)?,
                "autoExecute": row.get::<_, bool>(4)?,
            }))
        },
    );

    let schedule = match schedule {
        Ok(s) => s,
        Err(_) => return Ok(Json(json!(null))),
    };

    let schedule_id = schedule["id"].as_str().unwrap_or_default().to_string();

    let mut stmt = db
        .prepare(
            "SELECT id, schedule_id, scheme_id, parent_id, title, description, start_date, end_date, \"order\", status, progress, execution_log, engine, skills
             FROM schedule_items WHERE schedule_id = ?1",
        )
        .unwrap();
    let mut items: Vec<Value> = stmt
        .query_map(rusqlite::params![schedule_id], |row| {
            Ok(schedule_item_from_row(row))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    // Aggregate parent task status/progress from children
    let items_clone = items.clone();
    for item in items.iter_mut() {
        let item_id = item["id"].as_str().unwrap_or_default();
        let children: Vec<&Value> = items_clone
            .iter()
            .filter(|c| c["parentId"].as_str() == Some(item_id))
            .collect();

        if !children.is_empty() {
            let avg_progress: f64 = children.iter().map(|c| c["progress"].as_f64().unwrap_or(0.0)).sum::<f64>()
                / children.len() as f64;
            item["progress"] = json!(avg_progress.round() as i64);

            let all_completed = children.iter().all(|c| c["status"].as_str() == Some("completed"));
            let any_failed = children.iter().any(|c| c["status"].as_str() == Some("failed"));
            let any_in_progress = children.iter().any(|c| c["status"].as_str() == Some("in_progress"));
            let any_rolled_back = children.iter().any(|c| c["status"].as_str() == Some("rolled_back"));

            if all_completed {
                item["status"] = json!("completed");
            } else if any_failed {
                item["status"] = json!("failed");
            } else if any_in_progress {
                item["status"] = json!("in_progress");
            } else if any_rolled_back {
                item["status"] = json!("rolled_back");
            } else {
                item["status"] = json!("pending");
            }
        }
    }

    let mut result = schedule.clone();
    result["items"] = json!(items);
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct CreateTask {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
    title: Option<String>,
    description: Option<String>,
    #[serde(rename = "startDate")]
    start_date: Option<String>,
    #[serde(rename = "endDate")]
    end_date: Option<String>,
    #[serde(rename = "estimatedHours")]
    estimated_hours: Option<f64>,
    #[serde(rename = "afterItemId")]
    after_item_id: Option<String>,
    #[serde(rename = "parentId")]
    parent_id: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateTask>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let plan_id = body.plan_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId and title are required"})),
        )
    })?;
    let title = body.title.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId and title are required"})),
        )
    })?;

    let db = state.db.lock().unwrap();

    // Find or create schedule
    let schedule_id = match db.query_row(
        "SELECT id FROM schedules WHERE plan_id = ?1",
        rusqlite::params![plan_id],
        |row| row.get::<_, String>(0),
    ) {
        Ok(id) => id,
        Err(_) => {
            let sid = uuid::Uuid::new_v4().to_string();
            let now = chrono_now();
            db.execute(
                "INSERT INTO schedules (id, plan_id, start_date, end_date, auto_execute) VALUES (?1, ?2, ?3, ?4, 0)",
                rusqlite::params![sid, plan_id, now, now],
            )
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": e.to_string()})),
                )
            })?;

            // Set plan to scheduled
            db.execute(
                "UPDATE plans SET status = 'scheduled', updated_at = datetime('now') WHERE id = ?1",
                rusqlite::params![plan_id],
            )
            .ok();
            sid
        }
    };

    // Get existing items sorted by order
    let mut stmt = db
        .prepare("SELECT id, \"order\", end_date, scheme_id FROM schedule_items WHERE schedule_id = ?1 ORDER BY \"order\"")
        .unwrap();
    let existing: Vec<(String, i64, String, Option<String>)> = stmt
        .query_map(rusqlite::params![schedule_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let new_order: i64;
    let mut after_item_end_date: Option<String> = None;
    let mut after_item_scheme_id: Option<String> = None;

    if let Some(ref after_id) = body.after_item_id {
        let after_item = existing.iter().find(|i| &i.0 == after_id);
        let parent_order = after_item.map(|i| i.1).unwrap_or(existing.len() as i64);
        new_order = parent_order + 1;
        after_item_end_date = after_item.map(|i| i.2.clone());
        after_item_scheme_id = after_item.and_then(|i| i.3.clone());

        // Shift subsequent items down
        for item in &existing {
            if item.1 >= new_order {
                db.execute(
                    "UPDATE schedule_items SET \"order\" = ?1 WHERE id = ?2",
                    rusqlite::params![item.1 + 1, item.0],
                )
                .ok();
            }
        }
    } else {
        new_order = existing.iter().map(|i| i.1).max().unwrap_or(0) + 1;
    }

    let is_fix = title.starts_with("[fix]");
    let hours = body.estimated_hours.unwrap_or(if is_fix { 0.5 } else { 2.0 });
    let now = chrono_now();
    let start = body
        .start_date
        .unwrap_or_else(|| after_item_end_date.unwrap_or_else(|| now.clone()));
    let end = body.end_date.unwrap_or_else(|| {
        // Add hours to start date
        let ms = (hours * 3600000.0) as i64;
        add_ms_to_iso(&start, ms)
    });

    let item_id = uuid::Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO schedule_items (id, schedule_id, scheme_id, parent_id, title, description, start_date, end_date, \"order\", status, progress, engine, skills)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', 0, 'claude-code', '[]')",
        rusqlite::params![
            item_id,
            schedule_id,
            after_item_scheme_id,
            body.parent_id,
            title,
            body.description.unwrap_or_default(),
            start,
            end,
            new_order
        ],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let item = query_schedule_item(&db, &item_id);
    Ok((StatusCode::CREATED, Json(item)))
}

#[derive(Deserialize)]
pub struct AutoExecuteBody {
    #[serde(rename = "scheduleId")]
    schedule_id: Option<String>,
    enabled: Option<bool>,
}

pub async fn auto_execute(
    State(state): State<AppState>,
    Json(body): Json<AutoExecuteBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let schedule_id = body.schedule_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "scheduleId and enabled are required"})),
        )
    })?;
    let enabled = body.enabled.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "scheduleId and enabled are required"})),
        )
    })?;

    let db = state.db.lock().unwrap();
    db.execute(
        "UPDATE schedules SET auto_execute = ?1 WHERE id = ?2",
        rusqlite::params![enabled, schedule_id],
    )
    .ok();

    Ok(Json(json!({"success": true, "autoExecute": enabled})))
}

pub async fn tick(State(state): State<AppState>) -> Json<Value> {
    let db = state.db.lock().unwrap();

    let mut stmt = db
        .prepare("SELECT id, plan_id FROM schedules WHERE auto_execute = 1")
        .unwrap();
    let auto_schedules: Vec<(String, String)> = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    if auto_schedules.is_empty() {
        return Json(json!({"executed": false}));
    }

    for (schedule_id, plan_id) in &auto_schedules {
        let mut stmt = db
            .prepare(
                "SELECT id, parent_id, title, \"order\", status, progress, execution_log, start_date
                 FROM schedule_items WHERE schedule_id = ?1 ORDER BY \"order\"",
            )
            .unwrap();
        let all_items: Vec<(String, Option<String>, String, i64, String, i64, Option<String>, String)> = stmt
            .query_map(rusqlite::params![schedule_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        // Check for running task
        let running = all_items.iter().find(|i| i.4 == "in_progress");
        if let Some(running_item) = running {
            // Skip this schedule (task still running)
            let _log = running_item.6.as_deref().unwrap_or("");
            continue;
        }

        // Build execution order: parents sorted by order, subtasks within each parent
        let mut execution_order: Vec<&(String, Option<String>, String, i64, String, i64, Option<String>, String)> = Vec::new();
        let top_level: Vec<_> = all_items.iter().filter(|i| i.1.is_none()).collect();
        for parent in &top_level {
            let children: Vec<_> = all_items
                .iter()
                .filter(|i| i.1.as_deref() == Some(&parent.0))
                .collect();
            if !children.is_empty() {
                execution_order.extend(children);
            } else {
                execution_order.push(parent);
            }
        }

        let next_pending = execution_order.iter().find(|i| i.4 == "pending");
        let next_pending = match next_pending {
            Some(p) => *p,
            None => continue,
        };

        // Update plan status if needed
        let plan_status: Option<String> = db
            .query_row(
                "SELECT status FROM plans WHERE id = ?1",
                rusqlite::params![plan_id],
                |row| row.get(0),
            )
            .ok();

        if plan_status.as_deref() == Some("scheduled") {
            db.execute(
                "UPDATE plans SET status = 'executing', updated_at = datetime('now') WHERE id = ?1",
                rusqlite::params![plan_id],
            )
            .ok();
        }

        let all_tasks: Vec<Value> = all_items
            .iter()
            .map(|i| {
                let status = if i.0 == next_pending.0 {
                    "running"
                } else if i.4 == "completed" {
                    "completed"
                } else if i.4 == "failed" {
                    "failed"
                } else {
                    "pending"
                };
                json!({
                    "id": i.0,
                    "order": i.3,
                    "title": i.2,
                    "status": status,
                })
            })
            .collect();

        return Json(json!({
            "executed": true,
            "nextTask": {
                "itemId": next_pending.0,
                "title": next_pending.2,
                "order": next_pending.3,
            },
            "allTasks": all_tasks,
        }));
    }

    Json(json!({"executed": false}))
}

fn schedule_item_from_row(row: &rusqlite::Row) -> Value {
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

fn query_schedule_item(db: &rusqlite::Connection, id: &str) -> Value {
    db.query_row(
        "SELECT id, schedule_id, scheme_id, parent_id, title, description, start_date, end_date, \"order\", status, progress, execution_log, engine, skills
         FROM schedule_items WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(schedule_item_from_row(row)),
    )
    .unwrap_or(json!(null))
}

fn chrono_now() -> String {
    // Simple ISO datetime string
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Convert to basic ISO format
    format_timestamp(now)
}

fn format_timestamp(secs: u64) -> String {
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    // Calculate date from days since epoch (1970-01-01)
    let (year, month, day) = days_to_date(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z",
        year, month, day, hours, minutes, seconds
    )
}

fn days_to_date(days: u64) -> (u64, u64, u64) {
    // Algorithm to convert days since epoch to (year, month, day)
    let mut y = 1970;
    let mut remaining = days;

    loop {
        let days_in_year = if is_leap_year(y) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }

    let days_in_months: [u64; 12] = if is_leap_year(y) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut m = 1;
    for &dim in &days_in_months {
        if remaining < dim {
            break;
        }
        remaining -= dim;
        m += 1;
    }

    (y, m, remaining + 1)
}

fn is_leap_year(y: u64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

fn add_ms_to_iso(_iso: &str, _ms: i64) -> String {
    // Simple fallback: just return current time
    // Full ISO date arithmetic not needed for basic CRUD
    chrono_now()
}

// ---------------------------------------------------------------------------
// POST /api/schedules/generate — Generate schedule via AI
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct GenerateScheduleBody {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    locale: Option<String>,
}

fn save_schedule_from_json(db: &rusqlite::Connection, plan_id: &str, json_text: &str) -> Result<(), String> {
    // Extract JSON array
    let json_str = if json_text.starts_with('[') {
        json_text.to_string()
    } else {
        let re_match = json_text.find('[').and_then(|start| {
            let mut depth = 0i32;
            let mut end = start;
            for (i, c) in json_text[start..].char_indices() {
                if c == '[' { depth += 1; }
                else if c == ']' { depth -= 1; if depth == 0 { end = start + i + 1; break; } }
            }
            Some(json_text[start..end].to_string())
        });
        re_match.ok_or("No JSON array found")?
    };

    let items: Vec<Value> = serde_json::from_str(&json_str)
        .map_err(|e| format!("JSON parse error: {}", e))?;

    // Delete existing schedule
    let existing_id: Option<String> = db.query_row(
        "SELECT id FROM schedules WHERE plan_id = ?1",
        rusqlite::params![plan_id],
        |row| row.get(0),
    ).ok();
    if let Some(sid) = &existing_id {
        db.execute("DELETE FROM schedule_items WHERE schedule_id = ?1", rusqlite::params![sid]).ok();
        db.execute("DELETE FROM schedules WHERE id = ?1", rusqlite::params![sid]).ok();
    }

    let now = chrono_now();
    let mut current_hour: f64 = 0.0;
    let schedule_id = uuid::Uuid::new_v4().to_string();

    // Calculate total hours
    let total_hours: f64 = items.iter().map(|item| {
        if let Some(subtasks) = item.get("subtasks").and_then(|v| v.as_array()) {
            if !subtasks.is_empty() {
                return subtasks.iter().map(|st| {
                    st.get("estimatedHours").and_then(|v| v.as_f64()).unwrap_or(1.0)
                }).sum::<f64>();
            }
        }
        item.get("estimatedHours").and_then(|v| v.as_f64()).unwrap_or(4.0)
    }).sum();

    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let end_secs = now_secs + (total_hours * 3600.0) as u64;

    db.execute(
        "INSERT INTO schedules (id, plan_id, start_date, end_date, auto_execute) VALUES (?1, ?2, ?3, ?4, 0)",
        rusqlite::params![schedule_id, plan_id, now, format_timestamp(end_secs)],
    ).map_err(|e| e.to_string())?;

    for item in &items {
        let has_subtasks = item.get("subtasks")
            .and_then(|v| v.as_array())
            .map(|a| !a.is_empty())
            .unwrap_or(false);

        let item_title = item.get("title").and_then(|v| v.as_str()).unwrap_or("Task");
        let item_desc = item.get("description").and_then(|v| v.as_str()).unwrap_or("");
        let item_order = item.get("order").and_then(|v| v.as_i64()).unwrap_or(0);
        let scheme_id = item.get("schemeId").and_then(|v| v.as_str());

        if has_subtasks {
            let subtasks = item.get("subtasks").unwrap().as_array().unwrap();
            let parent_hours: f64 = subtasks.iter().map(|st| {
                st.get("estimatedHours").and_then(|v| v.as_f64()).unwrap_or(1.0)
            }).sum();

            let parent_start_secs = now_secs + (current_hour * 3600.0) as u64;
            let parent_end_secs = now_secs + ((current_hour + parent_hours) * 3600.0) as u64;

            let parent_id = uuid::Uuid::new_v4().to_string();
            db.execute(
                "INSERT INTO schedule_items (id, schedule_id, scheme_id, parent_id, title, description, start_date, end_date, \"order\", status, progress, engine, skills) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, 'pending', 0, 'claude-code', '[]')",
                rusqlite::params![parent_id, schedule_id, scheme_id, item_title, item_desc, format_timestamp(parent_start_secs), format_timestamp(parent_end_secs), item_order],
            ).ok();

            let mut child_hour = current_hour;
            for (i, st) in subtasks.iter().enumerate() {
                let st_hours = st.get("estimatedHours").and_then(|v| v.as_f64()).unwrap_or(1.0);
                let st_start = now_secs + (child_hour * 3600.0) as u64;
                let st_end = now_secs + ((child_hour + st_hours) * 3600.0) as u64;
                child_hour += st_hours;

                let st_title = st.get("title").and_then(|v| v.as_str()).unwrap_or("Subtask");
                let st_desc = st.get("description").and_then(|v| v.as_str()).unwrap_or("");
                let st_id = uuid::Uuid::new_v4().to_string();
                let st_order = item_order * 100 + i as i64 + 1;

                db.execute(
                    "INSERT INTO schedule_items (id, schedule_id, scheme_id, parent_id, title, description, start_date, end_date, \"order\", status, progress, engine, skills) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', 0, 'claude-code', '[]')",
                    rusqlite::params![st_id, schedule_id, scheme_id, parent_id, st_title, st_desc, format_timestamp(st_start), format_timestamp(st_end), st_order],
                ).ok();
            }
            current_hour += parent_hours;
        } else {
            let hours = item.get("estimatedHours").and_then(|v| v.as_f64()).unwrap_or(4.0);
            let item_start_secs = now_secs + (current_hour * 3600.0) as u64;
            let item_end_secs = now_secs + ((current_hour + hours) * 3600.0) as u64;
            current_hour += hours;

            let item_id = uuid::Uuid::new_v4().to_string();
            db.execute(
                "INSERT INTO schedule_items (id, schedule_id, scheme_id, parent_id, title, description, start_date, end_date, \"order\", status, progress, engine, skills) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, 'pending', 0, 'claude-code', '[]')",
                rusqlite::params![item_id, schedule_id, scheme_id, item_title, item_desc, format_timestamp(item_start_secs), format_timestamp(item_end_secs), item_order],
            ).ok();
        }
    }

    // Update plan status
    db.execute(
        "UPDATE plans SET status = 'scheduled', updated_at = datetime('now') WHERE id = ?1",
        rusqlite::params![plan_id],
    ).ok();

    Ok(())
}

pub async fn generate(State(state): State<AppState>, Json(body): Json<GenerateScheduleBody>) -> Response {
    let plan_id = match body.plan_id {
        Some(id) => id,
        None => {
            return Response::builder()
                .status(400)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"error":"planId required"}"#))
                .unwrap();
        }
    };

    let (plan_name, scheme_summary) = {
        let db = state.db.lock().unwrap();
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

        // Check plan status
        let status: String = db.query_row(
            "SELECT status FROM plans WHERE id = ?1",
            rusqlite::params![plan_id],
            |row| row.get(0),
        ).unwrap_or_default();

        if status != "confirmed" && status != "scheduled" {
            return Response::builder()
                .status(400)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"error":"Plan must be confirmed or scheduled"}"#))
                .unwrap();
        }

        let mut stmt = db
            .prepare("SELECT id, title, content FROM schemes WHERE plan_id = ?1")
            .unwrap();
        let schemes: Vec<(String, String, Option<String>)> = stmt
            .query_map(rusqlite::params![plan_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let summary = schemes
            .iter()
            .enumerate()
            .map(|(i, (id, title, content))| {
                format!(
                    "### Scheme {}: {} (id: {})\n{}",
                    i + 1,
                    title,
                    id,
                    content.as_deref().unwrap_or("")
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");

        (plan_name, summary)
    };

    let is_zh = body.locale.as_deref().map(|l| l == "zh").unwrap_or(false);
    let lang_note = if is_zh {
        "\n\nIMPORTANT: Write task title and description in Chinese."
    } else {
        ""
    };

    let schedule_prompt = format!(
        r#"<IMPORTANT>
You are being called as an API. Do NOT use tools, read files, or ask questions.
Output ONLY a JSON array. No conversation, no markdown fences, no explanation.
Start directly with [ and end with ].
</IMPORTANT>

Break these confirmed schemes into executable IMPLEMENTATION tasks with subtasks.
These tasks will be executed by an AI coding agent (Claude Code / Codex), NOT a human developer.

CRITICAL task granularity rules:
- Each PARENT task = ONE COMPLETE FEATURE or functional module
- Each parent task MUST have 2-5 subtasks that break it into concrete steps
- Aim for 3-8 parent tasks total
- Each subtask should be a specific, actionable coding step (0.5-2 hours)

Estimation: each subtask 0.5-2 hours (realistic for AI agent execution).

IMPORTANT: Do NOT include testing tasks. Testing is handled in a separate phase.
Focus only on implementation: code changes, new files, refactoring, configuration.

JSON array format — each object has:
- schemeId: scheme ID string or null
- title: short PARENT task title describing the feature/module
- description: overall description of this task group
- order: execution order starting from 1
- subtasks: array of subtask objects (REQUIRED, 2-5 items):
  - title: concise subtask title
  - description: specific implementation details
  - estimatedHours: number (0.5-2)

Plan: {}

{}{}

Output the JSON array now:"#,
        plan_name, scheme_summary, lang_note
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
                    .body(Body::from(serde_json::to_string(&json!({"error": e})).unwrap()))
                    .unwrap();
            }
        }
    };

    let system = "You are an AI task planner.".to_string();
    let db_clone = Arc::clone(&state.db);
    let plan_id_clone = plan_id.clone();

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<String, std::convert::Infallible>>(100);

    tokio::spawn(async move {
        let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel::<String>(100);

        let ai_handle = tokio::spawn(async move {
            stream_ai_call(&ai_config, &system, &schedule_prompt, chunk_tx).await
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

        // Save schedule
        if !full_text.trim().is_empty() {
            let db = db_clone.lock().unwrap();
            if let Err(e) = save_schedule_from_json(&db, &plan_id_clone, full_text.trim()) {
                eprintln!("[schedule-generate] Save failed: {}", e);
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
