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
use crate::ai::streaming::{generate_ai_call, stream_ai_call};
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
    let mut stmt = db
        .prepare(
            "SELECT id, plan_id, title, content, structured_content, source_type, search_results, created_at, updated_at
             FROM schemes WHERE plan_id = ?1 ORDER BY created_at DESC",
        )
        .unwrap();
    let rows = stmt
        .query_map(rusqlite::params![plan_id], |row| Ok(scheme_from_row(row)))
        .unwrap();
    let items: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(Json(json!(items)))
}

#[derive(Deserialize)]
pub struct CreateScheme {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
    title: Option<String>,
    content: Option<String>,
    #[serde(rename = "sourceType")]
    source_type: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateScheme>,
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

    // Check plan status
    let plan_status: String = db
        .query_row(
            "SELECT status FROM plans WHERE id = ?1",
            rusqlite::params![plan_id],
            |row| row.get(0),
        )
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Plan not found"})),
            )
        })?;

    if ["confirmed", "scheduled", "executing"].contains(&plan_status.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Cannot add schemes to a confirmed/scheduled/executing plan"})),
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let content = body.content.unwrap_or_default();
    let source_type = body.source_type.unwrap_or_else(|| "manual".to_string());

    db.execute(
        "INSERT INTO schemes (id, plan_id, title, content, source_type) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, plan_id, title, content, source_type],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    // Transition plan from draft to reviewing
    if plan_status == "draft" {
        db.execute(
            "UPDATE plans SET status = 'reviewing', updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![plan_id],
        )
        .ok();
    }

    let scheme = query_scheme(&db, &id);
    Ok((StatusCode::CREATED, Json(scheme)))
}

pub async fn get_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let db = state.db.lock().unwrap();
    let scheme = db
        .query_row(
            "SELECT id, plan_id, title, content, structured_content, source_type, search_results, created_at, updated_at FROM schemes WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok(scheme_from_row(row)),
        )
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Scheme not found"})),
            )
        })?;
    Ok(Json(scheme))
}

#[derive(Deserialize)]
pub struct UpdateScheme {
    title: Option<String>,
    content: Option<String>,
    #[serde(rename = "structuredContent")]
    structured_content: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateScheme>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();

    // Save current version before update
    if body.title.is_some() || body.content.is_some() || body.structured_content.is_some() {
        save_scheme_version(&db, &id);
    }

    let mut sets = vec!["updated_at = datetime('now')".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(ref v) = body.title {
        sets.push(format!("title = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.content {
        sets.push(format!("content = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = body.structured_content {
        sets.push(format!("structured_content = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }

    let sql = format!("UPDATE schemes SET {} WHERE id = ?{}", sets.join(", "), idx);
    params.push(Box::new(id.clone()));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    db.execute(&sql, param_refs.as_slice()).ok();

    let scheme = query_scheme(&db, &id);
    Json(scheme)
}

pub async fn delete_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM schemes WHERE id = ?1", rusqlite::params![id])
        .ok();
    Json(json!({"ok": true}))
}

pub async fn list_versions(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, scheme_id, version, title, content, created_at FROM scheme_versions WHERE scheme_id = ?1 ORDER BY version DESC",
        )
        .unwrap();
    let rows = stmt
        .query_map(rusqlite::params![id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "schemeId": row.get::<_, String>(1)?,
                "version": row.get::<_, i64>(2)?,
                "title": row.get::<_, String>(3)?,
                "content": row.get::<_, Option<String>>(4)?,
                "createdAt": row.get::<_, String>(5)?,
            }))
        })
        .unwrap();
    let items: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Json(json!(items))
}

fn save_scheme_version(db: &rusqlite::Connection, scheme_id: &str) {
    let scheme = db.query_row(
        "SELECT title, content FROM schemes WHERE id = ?1",
        rusqlite::params![scheme_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        },
    );

    if let Ok((title, content)) = scheme {
        let latest_version: i64 = db
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM scheme_versions WHERE scheme_id = ?1",
                rusqlite::params![scheme_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let vid = uuid::Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO scheme_versions (id, scheme_id, version, title, content) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![vid, scheme_id, latest_version + 1, title, content.unwrap_or_default()],
        )
        .ok();
    }
}

fn scheme_from_row(row: &rusqlite::Row) -> Value {
    json!({
        "id": row.get::<_, String>(0).unwrap_or_default(),
        "planId": row.get::<_, String>(1).unwrap_or_default(),
        "title": row.get::<_, String>(2).unwrap_or_default(),
        "content": row.get::<_, Option<String>>(3).unwrap_or_default(),
        "structuredContent": row.get::<_, Option<String>>(4).unwrap_or_default(),
        "sourceType": row.get::<_, String>(5).unwrap_or_default(),
        "searchResults": row.get::<_, Option<String>>(6).unwrap_or_default(),
        "createdAt": row.get::<_, String>(7).unwrap_or_default(),
        "updatedAt": row.get::<_, String>(8).unwrap_or_default(),
    })
}

fn query_scheme(db: &rusqlite::Connection, id: &str) -> Value {
    db.query_row(
        "SELECT id, plan_id, title, content, structured_content, source_type, search_results, created_at, updated_at FROM schemes WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(scheme_from_row(row)),
    )
    .unwrap_or(json!(null))
}

// ---------------------------------------------------------------------------
// POST /api/schemes/generate — Generate scheme via AI, stream output, save to DB
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct GenerateBody {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    idea: Option<String>,
    locale: Option<String>,
}

fn build_scheme_prompt(
    project_name: &str,
    project_desc: Option<&str>,
    project_guidelines: Option<&str>,
    plan_name: &str,
    plan_desc: Option<&str>,
    idea: Option<&str>,
    is_zh: bool,
) -> String {
    let project_context = [
        project_desc
            .filter(|s| !s.is_empty())
            .map(|s| format!("Project description: {}", s)),
        project_guidelines
            .filter(|s| !s.is_empty())
            .map(|s| format!("Project guidelines:\n{}", s)),
    ]
    .iter()
    .filter_map(|x| x.clone())
    .collect::<Vec<_>>()
    .join("\n\n");

    let lang = if is_zh {
        "Output all content in Chinese."
    } else {
        "Output all content in English."
    };

    let idea_block = idea
        .filter(|s| !s.is_empty())
        .map(|s| format!("\nUser's approach / initial ideas:\n{}\n", s))
        .unwrap_or_default();

    format!(
        r#"You are a senior software architect. Generate a structured technical scheme as a JSON object.

{lang}

Project: {project_name}
Plan: {plan_name}

Description:
{desc}
{idea_block}
{project_context}

Steps:
1. Use the provided tools to briefly explore the project structure
2. Read only the most relevant source files (max 5 files)
3. Generate the scheme JSON

Output a JSON object with EXACTLY this structure:
{{
  "overview": "2-3 sentence summary of what this scheme achieves and why",
  "architecture": {{
    "components": [
      {{"name": "ComponentName", "responsibility": "What it does", "dependencies": ["OtherComponent"]}}
    ],
    "dataFlow": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
    "diagram": "mermaid diagram source code showing component relationships and data flow (REQUIRED, use graph TD or flowchart TD syntax)"
  }},
  "interfaces": [
    {{"name": "TypeName", "language": "c|typescript|go|etc", "definition": "actual code definition", "description": "what this type represents"}}
  ],
  "decisions": [
    {{"question": "What design choice was made?", "options": ["Option A", "Option B"], "chosen": "Option A", "rationale": "Why this was chosen"}}
  ],
  "risks": [
    {{"risk": "Description of risk", "severity": "low|medium|high", "mitigation": "How to mitigate"}}
  ]
}}

RULES:
- Output ONLY the JSON object, no other text before or after
- "architecture.diagram" is REQUIRED
- "interfaces" should contain REAL code definitions (structs, types, function signatures) — not prose
- "decisions" should have 2-4 concrete options each
- "risks" severity must be "low", "medium", or "high"
- Keep "overview" to 2-3 sentences max
- "architecture.components" should list 3-8 key components
- "architecture.dataFlow" should be 3-8 ordered steps
- Do NOT include "effort" or time estimates"#,
        lang = lang,
        project_name = project_name,
        plan_name = plan_name,
        desc = plan_desc.unwrap_or("No description provided."),
        idea_block = idea_block,
        project_context = project_context,
    )
}

/// Save a scheme from AI-generated text (markdown or structured JSON).
fn save_scheme_from_ai(
    db: &rusqlite::Connection,
    plan_id: &str,
    raw_content: &str,
    plan_status: &str,
    plan_name: &str,
) -> bool {
    let trimmed = raw_content.trim();
    if trimmed.is_empty() {
        return false;
    }

    // Try parsing as structured JSON
    let mut parsed: Option<Value> = serde_json::from_str(trimmed).ok();
    if parsed.is_none() {
        // Try stripping fenced code block
        let fenced = trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_start()
            .trim_end_matches("```")
            .trim();
        parsed = serde_json::from_str(fenced).ok();
    }
    if parsed.is_none() {
        // Try extracting first JSON object
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

    let (title, markdown_content, structured_json) =
        if let Some(ref obj) = parsed {
            if obj.get("overview").is_some() && obj.get("architecture").is_some() {
                let overview = obj
                    .get("overview")
                    .and_then(|v| v.as_str())
                    .unwrap_or(plan_name);
                let title = if overview.len() > 80 {
                    &overview[..80]
                } else {
                    overview
                };
                let md = structured_to_markdown(obj);
                (
                    title.to_string(),
                    md,
                    Some(serde_json::to_string(obj).unwrap_or_default()),
                )
            } else {
                (plan_name.to_string(), trimmed.to_string(), None)
            }
        } else {
            // Treat as markdown
            let title = trimmed
                .lines()
                .find(|l| l.starts_with("# "))
                .map(|l| l.trim_start_matches('#').trim().to_string())
                .unwrap_or_else(|| plan_name.to_string());
            (title, trimmed.to_string(), None)
        };

    // Delete old scheme reviews
    let review_ids: Vec<String> = {
        let mut stmt = db
            .prepare("SELECT id FROM reviews WHERE plan_id = ?1 AND type = 'scheme'")
            .unwrap();
        stmt.query_map(rusqlite::params![plan_id], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    };
    for rid in &review_ids {
        db.execute(
            "DELETE FROM review_items WHERE review_id = ?1",
            rusqlite::params![rid],
        )
        .ok();
        db.execute("DELETE FROM reviews WHERE id = ?1", rusqlite::params![rid])
            .ok();
    }

    // Update or create scheme
    let existing: Vec<(String, String, Option<String>)> = {
        let mut stmt = db
            .prepare("SELECT id, title, content FROM schemes WHERE plan_id = ?1")
            .unwrap();
        stmt.query_map(rusqlite::params![plan_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    };

    if let Some(old) = existing.first() {
        // Save version
        let max_ver: i64 = db
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM scheme_versions WHERE scheme_id = ?1",
                rusqlite::params![old.0],
                |row| row.get(0),
            )
            .unwrap_or(0);
        let vid = uuid::Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO scheme_versions (id, scheme_id, version, title, content) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![vid, old.0, max_ver + 1, old.1, old.2.clone().unwrap_or_default()],
        ).ok();

        db.execute(
            "UPDATE schemes SET title = ?1, content = ?2, structured_content = ?3, updated_at = datetime('now') WHERE id = ?4",
            rusqlite::params![title, markdown_content, structured_json, old.0],
        ).ok();

        // Remove duplicates
        for extra in existing.iter().skip(1) {
            db.execute(
                "DELETE FROM schemes WHERE id = ?1",
                rusqlite::params![extra.0],
            )
            .ok();
        }
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO schemes (id, plan_id, title, content, structured_content, source_type) VALUES (?1, ?2, ?3, ?4, ?5, 'local_analysis')",
            rusqlite::params![id, plan_id, title, markdown_content, structured_json],
        ).ok();
    }

    // Transition plan from draft to reviewing
    if plan_status == "draft" {
        db.execute(
            "UPDATE plans SET status = 'reviewing', updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![plan_id],
        )
        .ok();
    }

    true
}

fn structured_to_markdown(s: &Value) -> String {
    let mut lines = Vec::new();

    if let Some(overview) = s.get("overview").and_then(|v| v.as_str()) {
        lines.push(format!("## Overview\n\n{}\n", overview));
    }

    if let Some(arch) = s.get("architecture") {
        lines.push("## Architecture\n".to_string());
        if let Some(comps) = arch.get("components").and_then(|v| v.as_array()) {
            lines.push("| Component | Responsibility | Dependencies |".to_string());
            lines.push("|-----------|---------------|--------------|".to_string());
            for c in comps {
                let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("-");
                let resp = c.get("responsibility").and_then(|v| v.as_str()).unwrap_or("-");
                let deps = c
                    .get("dependencies")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|d| d.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .unwrap_or_else(|| "-".to_string());
                lines.push(format!("| {} | {} | {} |", name, resp, deps));
            }
            lines.push(String::new());
        }
        if let Some(flow) = arch.get("dataFlow").and_then(|v| v.as_array()) {
            lines.push("### Data Flow\n".to_string());
            for (i, step) in flow.iter().enumerate() {
                if let Some(s) = step.as_str() {
                    lines.push(format!("{}. {}", i + 1, s));
                }
            }
            lines.push(String::new());
        }
        if let Some(diagram) = arch.get("diagram").and_then(|v| v.as_str()) {
            lines.push(format!("```\n{}\n```\n", diagram));
        }
    }

    if let Some(ifaces) = s.get("interfaces").and_then(|v| v.as_array()) {
        lines.push("## Interfaces\n".to_string());
        for iface in ifaces {
            let name = iface.get("name").and_then(|v| v.as_str()).unwrap_or("?");
            let desc = iface.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let lang = iface.get("language").and_then(|v| v.as_str()).unwrap_or("");
            let def = iface.get("definition").and_then(|v| v.as_str()).unwrap_or("");
            lines.push(format!("### {}\n\n{}\n", name, desc));
            lines.push(format!("```{}\n{}\n```\n", lang, def));
        }
    }

    if let Some(decisions) = s.get("decisions").and_then(|v| v.as_array()) {
        lines.push("## Decisions\n".to_string());
        lines.push("| Decision | Options | Chosen | Rationale |".to_string());
        lines.push("|----------|---------|--------|-----------|".to_string());
        for d in decisions {
            let q = d.get("question").and_then(|v| v.as_str()).unwrap_or("-");
            let opts = d
                .get("options")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|o| o.as_str())
                        .collect::<Vec<_>>()
                        .join("; ")
                })
                .unwrap_or_else(|| "-".to_string());
            let chosen = d.get("chosen").and_then(|v| v.as_str()).unwrap_or("-");
            let rationale = d.get("rationale").and_then(|v| v.as_str()).unwrap_or("-");
            lines.push(format!(
                "| {} | {} | **{}** | {} |",
                q, opts, chosen, rationale
            ));
        }
        lines.push(String::new());
    }

    if let Some(risks) = s.get("risks").and_then(|v| v.as_array()) {
        lines.push("## Risks\n".to_string());
        for r in risks {
            let risk = r.get("risk").and_then(|v| v.as_str()).unwrap_or("-");
            let sev = r.get("severity").and_then(|v| v.as_str()).unwrap_or("low");
            let mit = r.get("mitigation").and_then(|v| v.as_str()).unwrap_or("-");
            lines.push(format!("- **{}**: {} -> {}", sev.to_uppercase(), risk, mit));
        }
        lines.push(String::new());
    }

    lines.join("\n")
}

pub async fn generate(
    State(state): State<AppState>,
    Json(body): Json<GenerateBody>,
) -> Response {
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

    // Read plan, project info from DB
    let (plan_name, plan_desc, plan_status, project_name, project_desc, project_guidelines) = {
        let db = state.db.lock().unwrap();
        let plan = db.query_row(
            "SELECT name, description, status, project_id FROM plans WHERE id = ?1",
            rusqlite::params![plan_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        );
        let (pname, pdesc, pstatus, proj_id) = match plan {
            Ok(p) => p,
            Err(_) => {
                return Response::builder()
                    .status(404)
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"error":"Plan not found"}"#))
                    .unwrap();
            }
        };

        let project = db.query_row(
            "SELECT name, description, guidelines FROM projects WHERE id = ?1",
            rusqlite::params![proj_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        );
        let (prj_name, prj_desc, prj_guide) = match project {
            Ok(p) => p,
            Err(_) => {
                return Response::builder()
                    .status(404)
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"error":"Project not found"}"#))
                    .unwrap();
            }
        };

        (pname, pdesc, pstatus, prj_name, prj_desc, prj_guide)
    };

    // Resolve AI config
    let ai_config = {
        let db = state.db.lock().unwrap();
        match resolve_step_config(
            &db,
            "scheme",
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

    let is_zh = body
        .locale
        .as_deref()
        .map(|l| l == "zh")
        .unwrap_or(false);

    let prompt = build_scheme_prompt(
        &project_name,
        project_desc.as_deref(),
        project_guidelines.as_deref(),
        &plan_name,
        plan_desc.as_deref(),
        body.idea.as_deref(),
        is_zh,
    );

    let system = "You are a senior software architect.".to_string();
    let db_clone = Arc::clone(&state.db);
    let plan_id_clone = plan_id.clone();
    let plan_name_clone = plan_name.clone();
    let plan_status_clone = plan_status.clone();

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<String, std::convert::Infallible>>(100);

    tokio::spawn(async move {
        let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel::<String>(100);

        let ai_handle = tokio::spawn(async move {
            stream_ai_call(&ai_config, &system, &prompt, chunk_tx).await
        });

        let mut full_text = String::new();
        while let Some(chunk) = chunk_rx.recv().await {
            full_text.push_str(&chunk);
            let _ = tx.send(Ok(chunk)).await;
        }

        // Wait for completion
        let result = ai_handle.await;
        if let Ok(Err(e)) = result {
            let _ = tx.send(Ok(format!("\nError: {}", e))).await;
        }

        // Save scheme to DB
        if !full_text.trim().is_empty() {
            let db = db_clone.lock().unwrap();
            save_scheme_from_ai(
                &db,
                &plan_id_clone,
                full_text.trim(),
                &plan_status_clone,
                &plan_name_clone,
            );
        }
    });

    let stream = ReceiverStream::new(rx);
    let body = Body::from_stream(stream);
    Response::builder()
        .header("content-type", "text/plain; charset=utf-8")
        .body(body)
        .unwrap()
}

// ---------------------------------------------------------------------------
// POST /api/schemes/chat — Chat-based scheme modification
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ChatBody {
    #[serde(rename = "schemeId")]
    scheme_id: Option<String>,
    message: Option<String>,
    #[serde(rename = "sectionOnly")]
    section_only: Option<bool>,
    provider: Option<String>,
    model: Option<String>,
}

pub async fn chat(State(state): State<AppState>, Json(body): Json<ChatBody>) -> Response {
    let scheme_id = match body.scheme_id {
        Some(id) => id,
        None => {
            return Response::builder()
                .status(400)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"error":"schemeId and message are required"}"#))
                .unwrap();
        }
    };
    let message = match body.message {
        Some(m) if !m.is_empty() => m,
        _ => {
            return Response::builder()
                .status(400)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"error":"schemeId and message are required"}"#))
                .unwrap();
        }
    };

    let section_only = body.section_only.unwrap_or(false);

    // Read scheme content from DB
    let scheme_content = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT content FROM schemes WHERE id = ?1",
            rusqlite::params![scheme_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
        .unwrap_or_default()
    };

    if scheme_content.is_empty() && !section_only {
        return Response::builder()
            .status(404)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"error":"Scheme not found"}"#))
            .unwrap();
    }

    let ai_config = {
        let db = state.db.lock().unwrap();
        match resolve_step_config(
            &db,
            "scheme",
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

    let system = if section_only {
        "You are a scheme section editor. Output Markdown only. No conversation.\n\nCRITICAL: You are editing ONE SECTION of a larger scheme. Output ONLY the modified section content (without the heading). Do NOT output the full scheme. Do NOT repeat other sections. Do NOT add explanations or preamble.".to_string()
    } else {
        "You are a scheme editor. Output Markdown only. No conversation.\n\nCRITICAL: Do NOT ask questions, request access, or use tools. Just modify the scheme as requested.\n\nApply the requested changes and return the COMPLETE updated scheme in Markdown.\nDo NOT add explanations or comments about what you changed — just output the full updated scheme.".to_string()
    };

    let prompt = if section_only {
        message.clone()
    } else {
        format!(
            "## Current Scheme\n\n{}\n\n## Modification Request\n\n{}",
            scheme_content, message
        )
    };

    let db_clone = Arc::clone(&state.db);
    let scheme_id_clone = scheme_id.clone();

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<String, std::convert::Infallible>>(100);

    tokio::spawn(async move {
        let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel::<String>(100);

        let ai_handle =
            tokio::spawn(
                async move { stream_ai_call(&ai_config, &system, &prompt, chunk_tx).await },
            );

        let mut full_text = String::new();
        while let Some(chunk) = chunk_rx.recv().await {
            full_text.push_str(&chunk);
            let _ = tx.send(Ok(chunk)).await;
        }

        let result = ai_handle.await;
        if let Ok(Err(e)) = result {
            let _ = tx.send(Ok(format!("\nError: {}", e))).await;
        }

        // Save updated scheme (only full edits, not section-only)
        if !full_text.trim().is_empty() && !section_only {
            let db = db_clone.lock().unwrap();
            save_scheme_version(&db, &scheme_id_clone);
            db.execute(
                "UPDATE schemes SET content = ?1, updated_at = datetime('now') WHERE id = ?2",
                rusqlite::params![full_text.trim(), scheme_id_clone],
            )
            .ok();
        }
    });

    let stream = ReceiverStream::new(rx);
    let body = Body::from_stream(stream);
    Response::builder()
        .header("content-type", "text/plain; charset=utf-8")
        .body(body)
        .unwrap()
}

// ---------------------------------------------------------------------------
// POST /api/schemes/convert — Convert markdown scheme to structured JSON
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ConvertBody {
    #[serde(rename = "schemeId")]
    scheme_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    locale: Option<String>,
}

pub async fn convert(
    State(state): State<AppState>,
    Json(body): Json<ConvertBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let scheme_id = body.scheme_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "schemeId required"})),
        )
    })?;

    let (content, has_structured) = {
        let db = state.db.lock().unwrap();
        let row = db
            .query_row(
                "SELECT content, structured_content FROM schemes WHERE id = ?1",
                rusqlite::params![scheme_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )
            .map_err(|_| {
                (
                    StatusCode::NOT_FOUND,
                    Json(json!({"error": "Scheme not found"})),
                )
            })?;
        (row.0.unwrap_or_default(), row.1.is_some())
    };

    if has_structured {
        return Ok(Json(json!({"message": "Already structured"})));
    }

    let ai_config = {
        let db = state.db.lock().unwrap();
        resolve_step_config(
            &db,
            "scheme",
            body.provider.as_deref(),
            body.model.as_deref(),
        )
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e}))))?
    };

    let is_zh = body
        .locale
        .as_deref()
        .map(|l| l == "zh")
        .unwrap_or(false);

    let system = format!(
        "Convert the given markdown scheme into a structured JSON object. Output ONLY the JSON.{}",
        if is_zh { " Keep Chinese content." } else { "" }
    );

    let prompt = format!(
        r#"Convert this scheme to JSON with this structure:
{{
  "overview": "2-3 sentence summary",
  "architecture": {{
    "components": [{{"name": "...", "responsibility": "...", "dependencies": ["..."]}}],
    "dataFlow": ["Step 1", "Step 2"],
    "diagram": "optional"
  }},
  "interfaces": [{{"name": "TypeName", "language": "c|ts|go", "definition": "code", "description": "what it is"}}],
  "decisions": [{{"question": "...", "options": ["A","B"], "chosen": "A", "rationale": "why"}}],
  "risks": [{{"risk": "...", "severity": "low|medium|high", "mitigation": "..."}}],
  "effort": [{{"phase": "...", "tasks": ["..."], "hours": 4}}]
}}

Markdown scheme:
{}"#,
        content
    );

    let text = generate_ai_call(&ai_config, &system, &prompt)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))))?;

    // Parse JSON from response
    let trimmed = text.trim();
    let json_str = if trimmed.starts_with('{') {
        trimmed.to_string()
    } else {
        trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_start()
            .trim_end_matches("```")
            .trim()
            .to_string()
    };

    let parsed: Value = serde_json::from_str(&json_str).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to parse AI response as JSON"})),
        )
    })?;

    if parsed.get("overview").is_none() || parsed.get("architecture").is_none() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Invalid structured scheme format"})),
        ));
    }

    let structured_str = serde_json::to_string(&parsed).unwrap_or_default();
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "UPDATE schemes SET structured_content = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![structured_str, scheme_id],
        ).ok();
    }

    Ok(Json(json!({"success": true})))
}
