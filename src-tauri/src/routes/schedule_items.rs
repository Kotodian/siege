use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

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
