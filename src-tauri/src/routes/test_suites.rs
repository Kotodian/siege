use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

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
