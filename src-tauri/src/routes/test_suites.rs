use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::ai::config::resolve_step_config;
use crate::ai::streaming::generate_ai_call;
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
    let suite = db.query_row(
        "SELECT id, plan_id, status, created_at, updated_at FROM test_suites WHERE plan_id = ?1",
        rusqlite::params![plan_id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "planId": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "createdAt": row.get::<_, String>(3)?,
                "updatedAt": row.get::<_, String>(4)?,
            }))
        },
    );

    let suite = match suite {
        Ok(s) => s,
        Err(_) => return Ok(Json(json!(null))),
    };

    let suite_id = suite["id"].as_str().unwrap_or_default();

    // Get test cases with results
    let mut stmt = db
        .prepare(
            "SELECT id, test_suite_id, schedule_item_id, name, description, type, generated_code, file_path, status FROM test_cases WHERE test_suite_id = ?1",
        )
        .unwrap();
    let cases: Vec<Value> = stmt
        .query_map(rusqlite::params![suite_id], |row| {
            let case_id: String = row.get(0)?;
            Ok((case_id, json!({
                "id": row.get::<_, String>(0)?,
                "testSuiteId": row.get::<_, String>(1)?,
                "scheduleItemId": row.get::<_, Option<String>>(2)?,
                "name": row.get::<_, String>(3)?,
                "description": row.get::<_, Option<String>>(4)?,
                "type": row.get::<_, String>(5)?,
                "generatedCode": row.get::<_, Option<String>>(6)?,
                "filePath": row.get::<_, Option<String>>(7)?,
                "status": row.get::<_, String>(8)?,
            })))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .map(|(case_id, mut case)| {
            let mut results_stmt = db
                .prepare(
                    "SELECT id, test_case_id, run_at, status, output, error_message, duration_ms FROM test_results WHERE test_case_id = ?1",
                )
                .unwrap();
            let results: Vec<Value> = results_stmt
                .query_map(rusqlite::params![case_id], |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "testCaseId": row.get::<_, String>(1)?,
                        "runAt": row.get::<_, String>(2)?,
                        "status": row.get::<_, String>(3)?,
                        "output": row.get::<_, Option<String>>(4)?,
                        "errorMessage": row.get::<_, Option<String>>(5)?,
                        "durationMs": row.get::<_, Option<i64>>(6)?,
                    }))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();
            case["results"] = json!(results);
            case
        })
        .collect();

    let mut result = suite;
    result["cases"] = json!(cases);
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct CreateSuite {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
    status: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateSuite>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let plan_id = body.plan_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId is required"})),
        )
    })?;

    let id = uuid::Uuid::new_v4().to_string();
    let status = body.status.unwrap_or_else(|| "pending".to_string());

    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO test_suites (id, plan_id, status) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, plan_id, status],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let suite = db
        .query_row(
            "SELECT id, plan_id, status, created_at, updated_at FROM test_suites WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "planId": row.get::<_, String>(1)?,
                    "status": row.get::<_, String>(2)?,
                    "createdAt": row.get::<_, String>(3)?,
                    "updatedAt": row.get::<_, String>(4)?,
                }))
            },
        )
        .unwrap_or(json!(null));

    Ok((StatusCode::CREATED, Json(suite)))
}

// ---------------------------------------------------------------------------
// POST /api/test-suites/generate — Generate test cases via AI
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct GenerateBody {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    #[serde(rename = "scheduleItemIds")]
    schedule_item_ids: Option<Vec<String>>,
    locale: Option<String>,
}

pub async fn generate(
    State(state): State<AppState>,
    Json(body): Json<GenerateBody>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let plan_id = body.plan_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId is required"})),
        )
    })?;

    let (plan_name, completed, suite_id, ai_config, is_zh) = {
        let db = state.db.lock().unwrap();

        let plan_name: String = db
            .query_row(
                "SELECT name FROM plans WHERE id = ?1",
                rusqlite::params![plan_id],
                |row| row.get(0),
            )
            .map_err(|_| {
                (
                    StatusCode::NOT_FOUND,
                    Json(json!({"error": "Plan not found"})),
                )
            })?;

        let schedule_id: String = db
            .query_row(
                "SELECT id FROM schedules WHERE plan_id = ?1",
                rusqlite::params![plan_id],
                |row| row.get(0),
            )
            .map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "No schedule found"})),
                )
            })?;

        // Get completed schedule items
        let mut completed: Vec<(String, String, Option<String>, i64)> = {
            let mut stmt = db
                .prepare(
                    "SELECT id, title, description, \"order\" FROM schedule_items WHERE schedule_id = ?1 AND status = 'completed' ORDER BY \"order\"",
                )
                .unwrap();
            stmt
                .query_map(rusqlite::params![schedule_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };

        // Filter to selected items if provided
        if let Some(ref ids) = body.schedule_item_ids {
            if !ids.is_empty() {
                completed.retain(|item| ids.contains(&item.0));
            }
        }

        if completed.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "No completed tasks to test"})),
            ));
        }

        // Create or update test suite
        let suite_id = match db.query_row(
            "SELECT id FROM test_suites WHERE plan_id = ?1",
            rusqlite::params![plan_id],
            |row| row.get::<_, String>(0),
        ) {
            Ok(id) => {
                db.execute(
                    "UPDATE test_suites SET status = 'generating', updated_at = datetime('now') WHERE id = ?1",
                    rusqlite::params![id],
                ).ok();
                id
            }
            Err(_) => {
                let sid = uuid::Uuid::new_v4().to_string();
                db.execute(
                    "INSERT INTO test_suites (id, plan_id, status) VALUES (?1, ?2, 'generating')",
                    rusqlite::params![sid, plan_id],
                ).ok();
                sid
            }
        };

        let ai_config = resolve_step_config(
            &db,
            "test",
            body.provider.as_deref(),
            body.model.as_deref(),
        )
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e}))))?;

        let is_zh = body.locale.as_deref().map(|l| l == "zh").unwrap_or(false);

        (plan_name, completed, suite_id, ai_config, is_zh)
    }; // DB lock released here

    let task_list = completed
        .iter()
        .map(|(id, title, _desc, order)| format!("- #{} {} (id: \"{}\")", order, title, id))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        r#"You are a test engineer. Generate test cases for recently implemented code changes.

Plan: {}
Tasks:
{}

Generate 2-4 test cases per task.

Output a JSON array. Each object: scheduleItemId (must match task id), name, description, type ("unit"|"integration"|"e2e"), generatedCode (full test code), filePath.
Output ONLY the JSON array.{}"#,
        plan_name,
        task_list,
        if is_zh { " Write descriptions in Chinese." } else { "" }
    );

    let system = "You are a test engineer. Output ONLY a JSON array.".to_string();
    let text = generate_ai_call(&ai_config, &system, &prompt)
        .await
        .map_err(|e| {
            let db = state.db.lock().unwrap();
            db.execute(
                "UPDATE test_suites SET status = 'failed', updated_at = datetime('now') WHERE id = ?1",
                rusqlite::params![suite_id],
            ).ok();
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("AI call failed: {}", e)})),
            )
        })?;

    // Parse JSON array from response
    let trimmed = text.trim();
    let json_str = if trimmed.starts_with('[') {
        trimmed.to_string()
    } else {
        let start = trimmed.find('[');
        let end_bracket = trimmed.rfind(']');
        match (start, end_bracket) {
            (Some(s), Some(e)) if e > s => trimmed[s..=e].to_string(),
            _ => {
                let db = state.db.lock().unwrap();
                db.execute(
                    "UPDATE test_suites SET status = 'failed', updated_at = datetime('now') WHERE id = ?1",
                    rusqlite::params![suite_id],
                ).ok();
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "AI did not return valid JSON array"})),
                ));
            }
        }
    };

    let cases: Vec<Value> = serde_json::from_str(&json_str).map_err(|e| {
        let db = state.db.lock().unwrap();
        db.execute(
            "UPDATE test_suites SET status = 'failed', updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![suite_id],
        ).ok();
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("JSON parse error: {}", e)})),
        )
    })?;

    let db = state.db.lock().unwrap();

    // Delete old cases
    if let Some(ref ids) = body.schedule_item_ids {
        if !ids.is_empty() {
            for item_id in ids {
                db.execute(
                    "DELETE FROM test_cases WHERE test_suite_id = ?1 AND schedule_item_id = ?2",
                    rusqlite::params![suite_id, item_id],
                ).ok();
            }
        }
    } else {
        db.execute(
            "DELETE FROM test_cases WHERE test_suite_id = ?1",
            rusqlite::params![suite_id],
        ).ok();
    }

    // Insert generated cases
    for tc in &cases {
        let case_id = uuid::Uuid::new_v4().to_string();
        let schedule_item_id = tc.get("scheduleItemId").and_then(|v| v.as_str());
        let name = tc.get("name").and_then(|v| v.as_str()).unwrap_or("Test");
        let description = tc.get("description").and_then(|v| v.as_str()).unwrap_or("");
        let tc_type = tc.get("type").and_then(|v| v.as_str()).unwrap_or("unit");
        let generated_code = tc.get("generatedCode").and_then(|v| v.as_str()).unwrap_or("");
        let file_path = tc.get("filePath").and_then(|v| v.as_str());

        db.execute(
            "INSERT INTO test_cases (id, test_suite_id, schedule_item_id, name, description, type, generated_code, file_path, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending')",
            rusqlite::params![case_id, suite_id, schedule_item_id, name, description, tc_type, generated_code, file_path],
        ).ok();
    }

    db.execute(
        "UPDATE test_suites SET status = 'pending', updated_at = datetime('now') WHERE id = ?1",
        rusqlite::params![suite_id],
    ).ok();

    // Transition plan if needed
    let plan_status: Option<String> = db.query_row(
        "SELECT status FROM plans WHERE id = ?1",
        rusqlite::params![plan_id],
        |row| row.get(0),
    ).ok();
    if matches!(plan_status.as_deref(), Some("executing") | Some("code_review")) {
        db.execute(
            "UPDATE plans SET status = 'testing', updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![plan_id],
        ).ok();
    }

    // Return suite with cases
    let mut result = json!({"id": suite_id, "planId": plan_id, "status": "pending"});
    let mut case_results = Vec::new();
    let mut case_stmt = db
        .prepare("SELECT id, test_suite_id, schedule_item_id, name, description, type, generated_code, file_path, status FROM test_cases WHERE test_suite_id = ?1")
        .unwrap();
    let case_rows: Vec<Value> = case_stmt
        .query_map(rusqlite::params![suite_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "testSuiteId": row.get::<_, String>(1)?,
                "scheduleItemId": row.get::<_, Option<String>>(2)?,
                "name": row.get::<_, String>(3)?,
                "description": row.get::<_, Option<String>>(4)?,
                "type": row.get::<_, String>(5)?,
                "generatedCode": row.get::<_, Option<String>>(6)?,
                "filePath": row.get::<_, Option<String>>(7)?,
                "status": row.get::<_, String>(8)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    case_results.extend(case_rows);
    result["cases"] = json!(case_results);

    Ok((StatusCode::CREATED, Json(result)))
}
