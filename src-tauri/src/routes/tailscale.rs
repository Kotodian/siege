use axum::Json;
use serde_json::{json, Value};

/// GET /api/tailscale/status — list all Tailscale nodes via local API socket.
pub async fn status() -> Json<Value> {
    match crate::remote::tailscale::get_status().await {
        Ok(status) => Json(json!({
            "running": status.running,
            "backendState": status.backend_state,
            "self": status.self_node,
            "peers": status.peers,
        })),
        Err(e) => Json(json!({
            "running": false,
            "error": e,
            "peers": [],
        })),
    }
}
