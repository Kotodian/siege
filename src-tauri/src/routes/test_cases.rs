use axum::{
    body::Body,
    extract::{Path, Query, State},
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

// ---------------------------------------------------------------------------
// POST /api/test-cases/:id/run — Run test via AI, stream output
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct RunParams {
    provider: Option<String>,
    model: Option<String>,
    locale: Option<String>,
}

pub async fn run(
    State(state): State<AppState>,
    Path(case_id): Path<String>,
    Query(params): Query<RunParams>,
) -> Response {
    let (test_name, test_desc, test_code, test_file_path) = {
        let db = state.db.lock().unwrap();
        match db.query_row(
            "SELECT name, description, generated_code, file_path FROM test_cases WHERE id = ?1",
            rusqlite::params![case_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        ) {
            Ok(tc) => tc,
            Err(_) => {
                return Response::builder()
                    .status(404)
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"error":"Test case not found"}"#))
                    .unwrap();
            }
        }
    };

    // Set test case to running
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "UPDATE test_cases SET status = 'running' WHERE id = ?1",
            rusqlite::params![case_id],
        )
        .ok();
    }

    let ai_config = {
        let db = state.db.lock().unwrap();
        match resolve_step_config(
            &db,
            "test",
            params.provider.as_deref(),
            params.model.as_deref(),
        ) {
            Ok(c) => c,
            Err(e) => {
                let db2 = state.db.lock().unwrap();
                db2.execute(
                    "UPDATE test_cases SET status = 'failed' WHERE id = ?1",
                    rusqlite::params![case_id],
                )
                .ok();
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

    let is_zh = params.locale.as_deref().map(|l| l == "zh").unwrap_or(false);

    let prompt = if is_zh {
        format!(
            r#"你是一个测试工程师。

运行以下测试并报告结果。

测试文件: {}
测试名称: {}
{}

测试代码:
```
{}
```

如果测试文件不存在，先创建它，然后运行。

重要：运行完测试后，你必须在回复的最后一行输出以下标记之一：
- <!--TEST:PASSED--> 如果测试通过
- <!--TEST:FAILED--> 如果测试失败或无法运行"#,
            test_file_path.as_deref().unwrap_or("auto-detect"),
            test_name,
            test_desc
                .as_ref()
                .map(|d| format!("测试描述: {}", d))
                .unwrap_or_default(),
            test_code.as_deref().unwrap_or(""),
        )
    } else {
        format!(
            r#"Run the following test and report the results.

Test file: {}
Test name: {}
{}

Test code:
```
{}
```

If the test file doesn't exist, create it first, then run it.

IMPORTANT: After running the test, you MUST end your response with exactly one of these markers on its own line:
- <!--TEST:PASSED--> if the test passed
- <!--TEST:FAILED--> if the test failed or could not run"#,
            test_file_path.as_deref().unwrap_or("auto-detect"),
            test_name,
            test_desc
                .as_ref()
                .map(|d| format!("Description: {}", d))
                .unwrap_or_default(),
            test_code.as_deref().unwrap_or(""),
        )
    };

    let system = "You are a test engineer.".to_string();
    let db_clone = Arc::clone(&state.db);
    let case_id_clone = case_id.clone();
    let start_time = std::time::Instant::now();

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<String, std::convert::Infallible>>(100);

    tokio::spawn(async move {
        let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel::<String>(100);

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
            let msg = format!("\nError: {}", e);
            full_log.push_str(&msg);
            let _ = tx.send(Ok(msg)).await;
        }

        // Determine pass/fail
        let status = if full_log.contains("<!--TEST:PASSED-->") {
            "passed"
        } else {
            "failed"
        };

        let duration_ms = start_time.elapsed().as_millis() as i64;

        // Save result
        let db = db_clone.lock().unwrap();
        let result_id = uuid::Uuid::new_v4().to_string();
        let clean_output = full_log
            .replace("<!--TEST:PASSED-->", "")
            .replace("<!--TEST:FAILED-->", "");
        let error_msg = if status == "failed" {
            Some(clean_output.trim())
        } else {
            None
        };

        db.execute(
            "INSERT INTO test_results (id, test_case_id, status, output, error_message, duration_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![result_id, case_id_clone, status, clean_output.trim(), error_msg, duration_ms],
        ).ok();

        db.execute(
            "UPDATE test_cases SET status = ?1 WHERE id = ?2",
            rusqlite::params![status, case_id_clone],
        )
        .ok();
    });

    let stream = ReceiverStream::new(rx);
    let body = Body::from_stream(stream);
    Response::builder()
        .header("content-type", "text/plain; charset=utf-8")
        .body(body)
        .unwrap()
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
