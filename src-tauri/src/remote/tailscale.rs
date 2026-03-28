use serde_json::Value;
use std::path::PathBuf;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;

/// Get the Tailscale daemon socket path for the current platform.
fn get_socket_path() -> PathBuf {
    // Linux
    let linux_path = PathBuf::from("/var/run/tailscale/tailscaled.sock");
    if linux_path.exists() {
        return linux_path;
    }

    // macOS App Store / standalone app
    if let Some(home) = dirs::home_dir() {
        let macos_app_store =
            home.join("Library/Group Containers/io.tailscale.ipn.macos/tailscaled.sock");
        if macos_app_store.exists() {
            return macos_app_store;
        }
    }

    // Fallback to standard Linux path
    linux_path
}

/// Make an HTTP GET request to the Tailscale local API via Unix socket.
async fn tailscale_api(path: &str) -> Result<Value, String> {
    let socket = get_socket_path();
    if !socket.exists() {
        return Err("Tailscale daemon not running (socket not found)".to_string());
    }

    let mut stream = UnixStream::connect(&socket)
        .await
        .map_err(|e| format!("Cannot connect to tailscaled: {}", e))?;

    let request = format!(
        "GET {} HTTP/1.1\r\nHost: local-tailscaled.sock\r\nConnection: close\r\n\r\n",
        path
    );
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("Write to tailscaled failed: {}", e))?;

    // Shut down the write half so the server knows the request is complete
    stream
        .shutdown()
        .await
        .map_err(|e| format!("Socket shutdown failed: {}", e))?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .await
        .map_err(|e| format!("Read from tailscaled failed: {}", e))?;

    // Parse HTTP response: skip status line and headers, extract JSON body after \r\n\r\n
    let body = response
        .split("\r\n\r\n")
        .nth(1)
        .unwrap_or("")
        .trim();

    if body.is_empty() {
        return Err("Empty response from tailscaled".to_string());
    }

    serde_json::from_str(body).map_err(|e| format!("JSON parse error: {} (body: {})", e, body))
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct TailscaleNode {
    pub id: String,
    pub hostname: String,
    pub dns_name: String,
    pub os: String,
    pub online: bool,
    pub tailscale_ips: Vec<String>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct TailscaleStatus {
    pub running: bool,
    pub backend_state: String,
    pub self_node: Option<TailscaleNode>,
    pub peers: Vec<TailscaleNode>,
}

fn parse_node(data: Option<&Value>) -> Option<TailscaleNode> {
    let d = data?;
    Some(TailscaleNode {
        id: d
            .get("ID")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        hostname: d
            .get("HostName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        dns_name: d
            .get("DNSName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        os: d
            .get("OS")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        online: d
            .get("Online")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        tailscale_ips: d
            .get("TailscaleIPs")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
    })
}

/// Get Tailscale status including all peers (nodes).
pub async fn get_status() -> Result<TailscaleStatus, String> {
    let data = tailscale_api("/localapi/v0/status").await?;

    let backend_state = data
        .get("BackendState")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let is_running = backend_state == "Running";

    let self_node = parse_node(data.get("Self"));

    let mut peers = Vec::new();
    if let Some(peer_map) = data.get("Peer").and_then(|v| v.as_object()) {
        for (_key, peer_data) in peer_map {
            if let Some(node) = parse_node(Some(peer_data)) {
                peers.push(node);
            }
        }
    }

    Ok(TailscaleStatus {
        running: is_running,
        backend_state,
        self_node,
        peers,
    })
}

/// Check if Tailscale is running and authenticated.
pub async fn is_authenticated() -> bool {
    match get_status().await {
        Ok(status) => status.running,
        Err(_) => false,
    }
}
