use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

#[derive(Deserialize)]
pub struct ListParams {
    #[serde(rename = "testSuiteId")]
    test_suite_id: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let test_suite_id = params.test_suite_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "testSuiteId is required"})),
        )
    })?;

    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, test_suite_id, schedule_item_id, name, description, type, generated_code, file_path, status FROM test_cases WHERE test_suite_id = ?1",
        )
        .unwrap();
    let cases: Vec<Value> = stmt
        .query_map(rusqlite::params![test_suite_id], |row| {
            let case_id: String = row.get(0)?;
            Ok((case_id, test_case_from_row(row)))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .map(|(case_id, mut case)| {
            // Get recent results
            let mut results_stmt = db
                .prepare(
                    "SELECT id, test_case_id, run_at, status, output, error_message, duration_ms FROM test_results WHERE test_case_id = ?1 ORDER BY run_at DESC",
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

    Ok(Json(json!(cases)))
}

#[derive(Deserialize)]
pub struct CreateTestCase {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
    name: Option<String>,
    description: Option<String>,
    #[serde(rename = "type")]
    case_type: Option<String>,
    #[serde(rename = "generatedCode")]
    generated_code: Option<String>,
    #[serde(rename = "filePath")]
    file_path: Option<String>,
    #[serde(rename = "scheduleItemId")]
    schedule_item_id: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateTestCase>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let plan_id = body.plan_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId and name are required"})),
        )
    })?;
    let name = body.name.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "planId and name are required"})),
        )
    })?;

    let db = state.db.lock().unwrap();

    // Get or create suite
    let suite_id = match db.query_row(
        "SELECT id FROM test_suites WHERE plan_id = ?1",
        rusqlite::params![plan_id],
        |row| row.get::<_, String>(0),
    ) {
        Ok(id) => id,
        Err(_) => {
            let sid = uuid::Uuid::new_v4().to_string();
            db.execute(
                "INSERT INTO test_suites (id, plan_id, status) VALUES (?1, ?2, 'pending')",
                rusqlite::params![sid, plan_id],
            )
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": e.to_string()})),
                )
            })?;
            sid
        }
    };

    let case_id = uuid::Uuid::new_v4().to_string();
    let case_type = body.case_type.unwrap_or_else(|| "unit".to_string());
    let description = body.description.unwrap_or_default();
    let generated_code = body.generated_code.unwrap_or_default();

    db.execute(
        "INSERT INTO test_cases (id, test_suite_id, schedule_item_id, name, description, type, generated_code, file_path, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending')",
        rusqlite::params![
            case_id,
            suite_id,
            body.schedule_item_id,
            name,
            description,
            case_type,
            generated_code,
            body.file_path
        ],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    Ok((StatusCode::CREATED, Json(json!({"id": case_id}))))
}

pub async fn get_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let db = state.db.lock().unwrap();
    let mut case = db
        .query_row(
            "SELECT id, test_suite_id, schedule_item_id, name, description, type, generated_code, file_path, status FROM test_cases WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok(test_case_from_row(row)),
        )
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Test case not found"})),
            )
        })?;

    // Get results
    let mut results_stmt = db
        .prepare(
            "SELECT id, test_case_id, run_at, status, output, error_message, duration_ms FROM test_results WHERE test_case_id = ?1 ORDER BY run_at DESC",
        )
        .unwrap();
    let results: Vec<Value> = results_stmt
        .query_map(rusqlite::params![id], |row| {
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
    Ok(Json(case))
}

#[derive(Deserialize)]
pub struct UpdateTestCase {
    name: Option<String>,
    description: Option<String>,
    #[serde(rename = "type")]
    case_type: Option<String>,
    #[serde(rename = "generatedCode")]
    generated_code: Option<String>,
    #[serde(rename = "filePath")]
    file_path: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateTestCase>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let db = state.db.lock().unwrap();

    // Check exists
    db.query_row(
        "SELECT id FROM test_cases WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Not found"})),
        )
    })?;

    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(ref v) = body.name {
        sets.push(format!("name = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.description {
        sets.push(format!("description = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.case_type {
        sets.push(format!("type = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.generated_code {
        sets.push(format!("generated_code = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.file_path {
        sets.push(format!("file_path = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }

    if !sets.is_empty() {
        let sql = format!(
            "UPDATE test_cases SET {} WHERE id = ?{}",
            sets.join(", "),
            idx
        );
        params.push(Box::new(id.clone()));
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        db.execute(&sql, param_refs.as_slice()).ok();
    }

    Ok(Json(json!({"ok": true})))
}

pub async fn delete_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    db.execute(
        "DELETE FROM test_cases WHERE id = ?1",
        rusqlite::params![id],
    )
    .ok();
    Json(json!({"ok": true}))
}

fn test_case_from_row(row: &rusqlite::Row) -> Value {
    json!({
        "id": row.get::<_, String>(0).unwrap_or_default(),
        "testSuiteId": row.get::<_, String>(1).unwrap_or_default(),
        "scheduleItemId": row.get::<_, Option<String>>(2).unwrap_or_default(),
        "name": row.get::<_, String>(3).unwrap_or_default(),
        "description": row.get::<_, Option<String>>(4).unwrap_or_default(),
        "type": row.get::<_, String>(5).unwrap_or_default(),
        "generatedCode": row.get::<_, Option<String>>(6).unwrap_or_default(),
        "filePath": row.get::<_, Option<String>>(7).unwrap_or_default(),
        "status": row.get::<_, String>(8).unwrap_or_default(),
    })
}
