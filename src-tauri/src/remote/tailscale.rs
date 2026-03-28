use serde_json::Value;
use std::path::PathBuf;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// macOS GUI app (App Store) uses TCP port instead of Unix socket.
/// The port is read from /Library/Tailscale/ipnport symlink, default 41112.
fn get_macos_tcp_port() -> Option<u16> {
    // Check ipnport symlink
    let ipnport = PathBuf::from("/Library/Tailscale/ipnport");
    if let Ok(target) = std::fs::read_link(&ipnport) {
        if let Some(port_str) = target.to_str() {
            if let Ok(port) = port_str.parse::<u16>() {
                return Some(port);
            }
        }
    }
    // Also check sameuserproof file which indicates GUI is running
    let sameuserproof = PathBuf::from("/Library/Tailscale/sameuserproof");
    if sameuserproof.exists() {
        return Some(41112); // default port
    }
    None
}

/// Get the Tailscale daemon socket path for the current platform.
fn get_socket_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from("/var/run/tailscale/tailscaled.sock"),
        PathBuf::from("/usr/local/var/run/tailscale/tailscaled.sock"),
        PathBuf::from("/var/run/tailscaled.sock"),
        PathBuf::from("/var/run/tailscaled.socket"),
    ];

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Library/Group Containers/io.tailscale.ipn.macos/tailscaled.sock"));
        candidates.push(home.join("Library/Group Containers/group.io.tailscale.ipn.macos/tailscaled.sock"));
    }

    for path in &candidates {
        if path.exists() {
            return Some(path.clone());
        }
    }

    None
}

enum TailscaleStream {
    Unix(tokio::net::UnixStream),
    Tcp(tokio::net::TcpStream),
}

impl tokio::io::AsyncRead for TailscaleStream {
    fn poll_read(self: std::pin::Pin<&mut Self>, cx: &mut std::task::Context<'_>, buf: &mut tokio::io::ReadBuf<'_>) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            TailscaleStream::Unix(s) => std::pin::Pin::new(s).poll_read(cx, buf),
            TailscaleStream::Tcp(s) => std::pin::Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl tokio::io::AsyncWrite for TailscaleStream {
    fn poll_write(self: std::pin::Pin<&mut Self>, cx: &mut std::task::Context<'_>, buf: &[u8]) -> std::task::Poll<std::io::Result<usize>> {
        match self.get_mut() {
            TailscaleStream::Unix(s) => std::pin::Pin::new(s).poll_write(cx, buf),
            TailscaleStream::Tcp(s) => std::pin::Pin::new(s).poll_write(cx, buf),
        }
    }
    fn poll_flush(self: std::pin::Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            TailscaleStream::Unix(s) => std::pin::Pin::new(s).poll_flush(cx),
            TailscaleStream::Tcp(s) => std::pin::Pin::new(s).poll_flush(cx),
        }
    }
    fn poll_shutdown(self: std::pin::Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            TailscaleStream::Unix(s) => std::pin::Pin::new(s).poll_shutdown(cx),
            TailscaleStream::Tcp(s) => std::pin::Pin::new(s).poll_shutdown(cx),
        }
    }
}

/// Connect to tailscaled — tries Unix socket first, then macOS TCP fallback.
async fn connect_tailscale() -> Result<TailscaleStream, String> {
    // Try Unix socket first
    if let Some(socket_path) = get_socket_path() {
        if let Ok(stream) = tokio::net::UnixStream::connect(&socket_path).await {
            return Ok(TailscaleStream::Unix(stream));
        }
    }

    // macOS GUI app uses TCP via port from /Library/Tailscale/ipnport
    if let Some(port) = get_macos_tcp_port() {
        if let Ok(stream) = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await {
            return Ok(TailscaleStream::Tcp(stream));
        }
    }

    // Last resort: try default macOS GUI port
    if let Ok(stream) = tokio::net::TcpStream::connect("127.0.0.1:41112").await {
        return Ok(TailscaleStream::Tcp(stream));
    }

    Err("Cannot connect to Tailscale daemon (tried Unix sockets and TCP)".to_string())
}

/// Make an HTTP GET request to the Tailscale local API.
async fn tailscale_api(path: &str) -> Result<Value, String> {
    let mut stream = connect_tailscale().await?;

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


/// Call a POST endpoint on the Tailscale local API.
async fn tailscale_api_post(path: &str, body: &str) -> Result<Value, String> {
    let mut stream = connect_tailscale().await?;

    let request = format!(
        "POST {} HTTP/1.1\r\nHost: local-tailscaled.sock\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        path, body.len(), body
    );
    stream.write_all(request.as_bytes()).await.map_err(|e| e.to_string())?;
    stream.shutdown().await.map_err(|e| e.to_string())?;

    let mut response = String::new();
    stream.read_to_string(&mut response).await.map_err(|e| e.to_string())?;

    let body_str = response.split("\r\n\r\n").nth(1).unwrap_or("{}");
    serde_json::from_str(body_str).map_err(|e| format!("Parse error: {}", e))
}

/// Start interactive Tailscale login. Returns an auth URL for the user to open.
pub async fn start_login() -> Result<String, String> {
    // First check current status
    let status = get_status().await;
    if let Ok(ref s) = status {
        if s.running {
            return Err("Already logged in".to_string());
        }
    }

    // Call login-interactive to get auth URL
    let result = tailscale_api_post("/localapi/v0/login-interactive", "").await;
    match result {
        Ok(data) => {
            if let Some(url) = data.get("url").and_then(|v| v.as_str()) {
                Ok(url.to_string())
            } else {
                // Check if AuthURL is in status
                let status = tailscale_api("/localapi/v0/status").await?;
                if let Some(url) = status.get("AuthURL").and_then(|v| v.as_str()) {
                    if !url.is_empty() {
                        return Ok(url.to_string());
                    }
                }
                Err("No auth URL returned".to_string())
            }
        }
        Err(e) => {
            // login-interactive might not return JSON, check status for AuthURL
            let status = tailscale_api("/localapi/v0/status").await
                .map_err(|_| e.clone())?;
            if let Some(url) = status.get("AuthURL").and_then(|v| v.as_str()) {
                if !url.is_empty() {
                    return Ok(url.to_string());
                }
            }
            Err(e)
        }
    }
}

/// Parse a raw Tailscale status JSON into TailscaleStatus.
#[cfg(test)]
pub fn parse_status(data: &Value) -> TailscaleStatus {
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
    TailscaleStatus { running: is_running, backend_state, self_node, peers }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_node_full() {
        let data = json!({
            "ID": "node123",
            "HostName": "dev-server",
            "DNSName": "dev-server.tail1234.ts.net.",
            "OS": "linux",
            "Online": true,
            "TailscaleIPs": ["100.64.1.5", "fd7a:115c:a1e0::1"]
        });
        let node = parse_node(Some(&data)).unwrap();
        assert_eq!(node.id, "node123");
        assert_eq!(node.hostname, "dev-server");
        assert_eq!(node.dns_name, "dev-server.tail1234.ts.net.");
        assert_eq!(node.os, "linux");
        assert!(node.online);
        assert_eq!(node.tailscale_ips.len(), 2);
        assert_eq!(node.tailscale_ips[0], "100.64.1.5");
    }

    #[test]
    fn test_parse_node_minimal() {
        let data = json!({"HostName": "minimal"});
        let node = parse_node(Some(&data)).unwrap();
        assert_eq!(node.hostname, "minimal");
        assert_eq!(node.id, "");
        assert!(!node.online);
        assert!(node.tailscale_ips.is_empty());
    }

    #[test]
    fn test_parse_node_none() {
        assert!(parse_node(None).is_none());
    }

    #[test]
    fn test_parse_status_running_with_peers() {
        let data = json!({
            "BackendState": "Running",
            "Self": {
                "ID": "self1",
                "HostName": "my-mac",
                "DNSName": "my-mac.tail.ts.net.",
                "OS": "darwin",
                "Online": true,
                "TailscaleIPs": ["100.100.1.1"]
            },
            "Peer": {
                "abc123": {
                    "ID": "peer1",
                    "HostName": "server-1",
                    "DNSName": "server-1.tail.ts.net.",
                    "OS": "linux",
                    "Online": true,
                    "TailscaleIPs": ["100.64.2.1"]
                },
                "def456": {
                    "ID": "peer2",
                    "HostName": "server-2",
                    "DNSName": "server-2.tail.ts.net.",
                    "OS": "linux",
                    "Online": false,
                    "TailscaleIPs": ["100.64.2.2"]
                }
            }
        });
        let status = parse_status(&data);
        assert!(status.running);
        assert_eq!(status.backend_state, "Running");
        assert!(status.self_node.is_some());
        assert_eq!(status.self_node.unwrap().hostname, "my-mac");
        assert_eq!(status.peers.len(), 2);
    }

    #[test]
    fn test_parse_status_not_running() {
        let data = json!({
            "BackendState": "NeedsLogin",
            "Peer": {}
        });
        let status = parse_status(&data);
        assert!(!status.running);
        assert_eq!(status.backend_state, "NeedsLogin");
        assert!(status.self_node.is_none());
        assert!(status.peers.is_empty());
    }

    #[test]
    fn test_parse_status_no_peers() {
        let data = json!({
            "BackendState": "Running",
            "Self": {"HostName": "solo"},
        });
        let status = parse_status(&data);
        assert!(status.running);
        assert!(status.peers.is_empty());
    }

    #[test]
    fn test_get_macos_tcp_port() {
        // On non-macOS or without Tailscale GUI, returns None — that's fine
        let _port = get_macos_tcp_port();
    }
}
