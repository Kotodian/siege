use serde_json::Value;
use std::path::PathBuf;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn base64_encode(input: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 { result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char); } else { result.push('='); }
        if chunk.len() > 2 { result.push(CHARS[(triple & 0x3F) as usize] as char); } else { result.push('='); }
    }
    result
}

/// macOS Tailscale credentials: port + auth token.
/// Reads from /Library/Tailscale/ipnport (symlink → port number)
/// and /Library/Tailscale/sameuserproof-{port} (token).
/// For App Store version, searches ~/Library/Group Containers/ for sameuserproof files.
struct MacCreds {
    port: u16,
    token: String,
}

fn get_macos_creds() -> Option<MacCreds> {
    // Method 1: standalone/system install — /Library/Tailscale/
    let ipnport = PathBuf::from("/Library/Tailscale/ipnport");
    if let Ok(target) = std::fs::read_link(&ipnport) {
        if let Some(port_str) = target.to_str() {
            if let Ok(port) = port_str.parse::<u16>() {
                let proof_path = format!("/Library/Tailscale/sameuserproof-{}", port);
                if let Ok(token) = std::fs::read_to_string(&proof_path) {
                    return Some(MacCreds { port, token: token.trim().to_string() });
                }
                // Token file might not exist yet, try connecting without
                return Some(MacCreds { port, token: String::new() });
            }
        }
    }

    // Method 2: App Store version — search Group Containers
    if let Some(home) = dirs::home_dir() {
        for container in &["io.tailscale.ipn.macos", "group.io.tailscale.ipn.macos"] {
            let container_dir = home.join("Library/Group Containers").join(container);
            if let Ok(entries) = std::fs::read_dir(&container_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("sameuserproof-") {
                        if let Ok(port) = name.strip_prefix("sameuserproof-").unwrap_or("").parse::<u16>() {
                            if let Ok(token) = std::fs::read_to_string(entry.path()) {
                                return Some(MacCreds { port, token: token.trim().to_string() });
                            }
                        }
                    }
                }
            }
        }
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

struct TailscaleConn {
    stream: TailscaleStream,
    token: Option<String>,
}

/// Connect to tailscaled — tries Unix socket first, then macOS TCP with auth.
async fn connect_tailscale() -> Result<TailscaleConn, String> {
    // Try Unix socket first (Linux, Homebrew on macOS)
    if let Some(socket_path) = get_socket_path() {
        if let Ok(stream) = tokio::net::UnixStream::connect(&socket_path).await {
            return Ok(TailscaleConn { stream: TailscaleStream::Unix(stream), token: None });
        }
    }

    // macOS GUI: read port + token from filesystem
    if let Some(creds) = get_macos_creds() {
        if let Ok(stream) = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", creds.port)).await {
            let token = if creds.token.is_empty() { None } else { Some(creds.token) };
            return Ok(TailscaleConn { stream: TailscaleStream::Tcp(stream), token });
        }
    }

    Err("Cannot connect to Tailscale daemon (tried Unix sockets and macOS TCP)".to_string())
}

fn make_auth_header(token: &Option<String>) -> String {
    match token {
        Some(t) if !t.is_empty() => {
            let b64 = base64_encode(format!(":{}", t).as_bytes());
            format!("Authorization: Basic {}\r\n", b64)
        }
        _ => String::new(),
    }
}

/// Make an HTTP GET request to the Tailscale local API.
/// Falls back to `tailscale` CLI if socket/TCP connection fails (Mac App Store sandbox).
async fn tailscale_api(path: &str) -> Result<Value, String> {
    // Try socket/TCP first
    match connect_tailscale().await {
        Ok(conn) => return tailscale_api_via_stream(conn, "GET", path, "").await,
        Err(_) => {}
    }

    // Fallback: use tailscale CLI (required for Mac App Store version due to XPC sandbox)
    if path == "/localapi/v0/status" {
        return tailscale_cli_status().await;
    }

    Err("Cannot connect to Tailscale daemon".to_string())
}

/// Get status via `tailscale status --json` CLI fallback.
async fn tailscale_cli_status() -> Result<Value, String> {
    let output = tokio::process::Command::new("tailscale")
        .args(["status", "--json"])
        .output()
        .await
        .map_err(|e| format!("tailscale CLI not found: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tailscale status failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout).map_err(|e| format!("JSON parse error: {}", e))
}

async fn tailscale_api_via_stream(conn: TailscaleConn, method: &str, path: &str, body: &str) -> Result<Value, String> {
    let mut stream = conn.stream;
    let auth = make_auth_header(&conn.token);

    let request = if body.is_empty() {
        format!(
            "{} {} HTTP/1.1\r\nHost: local-tailscaled.sock\r\n{}Connection: close\r\n\r\n",
            method, path, auth
        )
    } else {
        format!(
            "{} {} HTTP/1.1\r\nHost: local-tailscaled.sock\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            method, path, auth, body.len(), body
        )
    };

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

    // Parse HTTP response: skip headers, handle chunked transfer encoding
    let raw_body = response
        .split("\r\n\r\n")
        .nth(1)
        .unwrap_or("")
        .trim();

    if raw_body.is_empty() {
        return Err("Empty response from tailscaled".to_string());
    }

    // Extract JSON object from response body.
    // The body may be: plain JSON, chunked encoded (size\r\ndata\r\n0), or mixed.
    // Strategy: find the first '{' and last '}' to extract the JSON object.
    let json_str = if let Some(start) = raw_body.find('{') {
        if let Some(end) = raw_body.rfind('}') {
            &raw_body[start..=end]
        } else {
            raw_body
        }
    } else {
        raw_body
    };

    serde_json::from_str(json_str)
        .map_err(|e| format!("JSON parse error: {} (first 200 chars: {})", e, &json_str[..json_str.len().min(200)]))
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
    match connect_tailscale().await {
        Ok(conn) => tailscale_api_via_stream(conn, "POST", path, body).await,
        Err(e) => Err(e),
    }
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

    // Try via local API first
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
        Err(_) => {
            // Fallback: use `tailscale login` CLI (Mac App Store needs this)
            let output = tokio::process::Command::new("tailscale")
                .args(["login"])
                .output()
                .await
                .map_err(|e| format!("tailscale CLI not found: {}", e))?;

            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );

            // Parse auth URL from output (usually contains https://login.tailscale.com/...)
            for line in combined.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("https://") {
                    return Ok(trimmed.to_string());
                }
            }

            // Check status for AuthURL as last resort
            if let Ok(status) = tailscale_api("/localapi/v0/status").await {
                if let Some(url) = status.get("AuthURL").and_then(|v| v.as_str()) {
                    if !url.is_empty() {
                        return Ok(url.to_string());
                    }
                }
            }

            Err("No auth URL obtained. Please run 'tailscale login' manually.".to_string())
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
    fn test_get_macos_creds() {
        // On non-macOS or without Tailscale GUI, returns None — that's fine
        let _creds = get_macos_creds();
    }

    #[test]
    fn test_base64_encode() {
        assert_eq!(base64_encode(b":mytoken"), "Om15dG9rZW4=");
        assert_eq!(base64_encode(b""), "");
    }
}
