use axum::{http::StatusCode, Json};
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

/// POST /api/tailscale/login — start Tailscale interactive login, return auth URL.
pub async fn login() -> (StatusCode, Json<Value>) {
    match crate::remote::tailscale::start_login().await {
        Ok(url) => (StatusCode::OK, Json(json!({
            "status": "pending",
            "authUrl": url,
        }))),
        Err(e) if e.contains("Already logged in") => {
            (StatusCode::OK, Json(json!({"status": "already_authenticated"})))
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
            "status": "error",
            "error": e,
        }))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_status_returns_json() {
        let result = status().await;
        let json = result.0;
        // Should always have "running" and "peers" keys
        assert!(json.get("running").is_some());
        assert!(json.get("peers").is_some());
    }
}
