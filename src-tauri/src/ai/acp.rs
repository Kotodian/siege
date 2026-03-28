use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

/// Represents a streaming update from the ACP agent.
pub struct AcpUpdate {
    pub event_type: String, // "text", "thought", "tool", "plan"
    pub text: String,
}

/// Result of an ACP prompt call.
pub struct AcpResult {
    pub stop_reason: String,
    pub usage: Option<Value>,
}

/// Terminal state for handling terminal/* requests from the agent.
struct TerminalState {
    output: String,
    exit_code: i32,
}

/// ACP client that communicates with a CLI agent (Claude Code, Codex, Copilot)
/// via JSON-RPC over stdin/stdout using the Agent Client Protocol.
pub struct AcpClient {
    proc: Option<Child>,
    stdin: Arc<Mutex<tokio::process::ChildStdin>>,
    reader_task: Option<tokio::task::JoinHandle<()>>,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>>,
    next_id: Arc<Mutex<i64>>,
    update_tx: Arc<Mutex<Option<mpsc::Sender<AcpUpdate>>>>,
    write_tx: Arc<Mutex<Option<mpsc::Sender<(String, String)>>>>,
    stderr_buffer: Arc<Mutex<Vec<String>>>,
    repo_path: String,
    #[allow(dead_code)]
    agent_type: String,
    #[allow(dead_code)]
    terminals: Arc<Mutex<HashMap<String, TerminalState>>>,
}

impl AcpClient {
    /// Start the ACP agent process.
    ///
    /// - `cwd`: working directory for the agent subprocess.
    /// - `agent`: one of "claude", "codex", or "copilot".
    pub async fn start(cwd: &str, agent: &str) -> Result<Self, String> {
        let (cmd, args): (&str, Vec<&str>) = match agent {
            "copilot" => ("npx", vec!["-y", "@github/copilot", "--acp"]),
            "codex" => ("npx", vec!["-y", "@zed-industries/codex-acp@latest"]),
            _ => ("npx", vec!["-y", "@zed-industries/claude-agent-acp@latest"]),
        };

        let mut child = Command::new(cmd)
            .args(&args)
            .current_dir(cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to spawn ACP agent ({}): {}", agent, e))?;

        let stdin = child.stdin.take().ok_or("No stdin")?;
        let stdout = child.stdout.take().ok_or("No stdout")?;
        let stderr = child.stderr.take().ok_or("No stderr")?;

        let stdin = Arc::new(Mutex::new(stdin));
        let pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let update_tx: Arc<Mutex<Option<mpsc::Sender<AcpUpdate>>>> =
            Arc::new(Mutex::new(None));
        let write_tx: Arc<Mutex<Option<mpsc::Sender<(String, String)>>>> =
            Arc::new(Mutex::new(None));
        let stderr_buffer: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let terminals: Arc<Mutex<HashMap<String, TerminalState>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let next_id: Arc<Mutex<i64>> = Arc::new(Mutex::new(1));

        // Stderr reader task — captures stderr output for error reporting
        let stderr_buf_clone = stderr_buffer.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => {
                        let msg = line.trim().to_string();
                        if !msg.is_empty() {
                            eprintln!("[acp-agent] {}", msg);
                            let mut buf = stderr_buf_clone.lock().await;
                            buf.push(msg);
                            if buf.len() > 20 {
                                buf.remove(0);
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // Stdout reader task — dispatches responses, notifications, and agent requests
        let pending_r = pending.clone();
        let update_tx_r = update_tx.clone();
        let write_tx_r = write_tx.clone();
        let terminals_r = terminals.clone();
        let stdin_r = stdin.clone();
        let repo_path_owned = cwd.to_string();

        let reader_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break, // EOF — process exited
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        let msg: Value = match serde_json::from_str(trimmed) {
                            Ok(v) => v,
                            Err(_) => continue, // skip non-JSON lines
                        };

                        // Response to our request (has "id" but no "method")
                        if msg.get("id").is_some() && msg.get("method").is_none() {
                            let id = msg["id"].as_i64().unwrap_or(-1);
                            let mut pend = pending_r.lock().await;
                            if let Some(sender) = pend.remove(&id) {
                                if let Some(err) = msg.get("error") {
                                    let err_msg = err
                                        .get("message")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Unknown error");
                                    let _ = sender.send(Err(err_msg.to_string()));
                                } else {
                                    let result =
                                        msg.get("result").cloned().unwrap_or(json!(null));
                                    let _ = sender.send(Ok(result));
                                }
                            }
                            continue;
                        }

                        // Notification: session/update
                        if msg.get("method").and_then(|m| m.as_str())
                            == Some("session/update")
                        {
                            if let Some(params) = msg.get("params") {
                                handle_update(params, &update_tx_r).await;
                            }
                            continue;
                        }

                        // Request from agent (has both "id" and "method")
                        if msg.get("id").is_some() && msg.get("method").is_some() {
                            let req_id = msg["id"].as_i64().unwrap_or(0);
                            let method_str = msg["method"].as_str().unwrap_or("");
                            let params =
                                msg.get("params").cloned().unwrap_or(json!({}));

                            let result = handle_agent_request(
                                method_str,
                                &params,
                                &repo_path_owned,
                                &terminals_r,
                                &write_tx_r,
                            )
                            .await;

                            let response = json!({
                                "jsonrpc": "2.0",
                                "id": req_id,
                                "result": result
                            });
                            let msg_bytes = format!(
                                "{}\n",
                                serde_json::to_string(&response).unwrap()
                            );
                            let mut s = stdin_r.lock().await;
                            let _ = s.write_all(msg_bytes.as_bytes()).await;
                            let _ = s.flush().await;
                            continue;
                        }

                        // Other notifications without "id" — ignore silently
                    }
                    Err(_) => break,
                }
            }

            // Process exited — reject all pending requests
            let mut pend = pending_r.lock().await;
            for (_, sender) in pend.drain() {
                let _ = sender.send(Err("ACP agent process exited".to_string()));
            }
        });

        // Wait for process to be ready
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;

        let client = AcpClient {
            proc: Some(child),
            stdin,
            reader_task: Some(reader_task),
            pending,
            next_id,
            update_tx,
            write_tx,
            stderr_buffer,
            repo_path: cwd.to_string(),
            agent_type: agent.to_string(),
            terminals,
        };

        // Initialize — retry up to 3 times
        let mut init_error: Option<String> = None;
        for attempt in 0..3 {
            match client
                .request(
                    "initialize",
                    json!({
                        "protocolVersion": 1,
                        "clientInfo": { "name": "siege", "version": "0.1.0" },
                        "capabilities": {
                            "fs": { "readTextFile": true, "writeTextFile": true },
                            "terminal": true
                        }
                    }),
                )
                .await
            {
                Ok(_) => {
                    init_error = None;
                    break;
                }
                Err(e) => {
                    init_error = Some(e);
                    if attempt < 2 {
                        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    }
                }
            }
        }
        if let Some(e) = init_error {
            let stderr_msgs = client.stderr_buffer.lock().await.join("\n");
            return Err(format!(
                "ACP initialization failed: {}{}",
                e,
                if stderr_msgs.is_empty() {
                    String::new()
                } else {
                    format!(
                        "\nStderr: {}",
                        &stderr_msgs[stderr_msgs.len().saturating_sub(500)..]
                    )
                }
            ));
        }

        Ok(client)
    }

    /// Send a JSON-RPC request and wait for the response.
    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = {
            let mut nid = self.next_id.lock().await;
            let current = *nid;
            *nid += 1;
            current
        };

        let (tx, rx) = oneshot::channel();
        {
            let mut pend = self.pending.lock().await;
            pend.insert(id, tx);
        }

        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        let msg_str = format!("{}\n", serde_json::to_string(&msg).unwrap());
        {
            let mut s = self.stdin.lock().await;
            s.write_all(msg_str.as_bytes())
                .await
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            s.flush()
                .await
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
        }

        // Timeout based on method type
        let timeout_ms = if method == "session/prompt" {
            1_800_000u64 // 30 minutes for prompts
        } else if method.starts_with("session/") {
            60_000 // 60s for session ops
        } else {
            30_000 // 30s for others
        };

        match tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => {
                let mut pend = self.pending.lock().await;
                pend.remove(&id);
                Err(format!("ACP request \"{}\" channel closed", method))
            }
            Err(_) => {
                let mut pend = self.pending.lock().await;
                pend.remove(&id);
                Err(format!("ACP request \"{}\" timed out", method))
            }
        }
    }

    /// Send a JSON-RPC notification (no response expected).
    #[allow(dead_code)]
    async fn send_notification(&self, method: &str, params: Value) {
        let msg = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });
        let msg_str = format!("{}\n", serde_json::to_string(&msg).unwrap());
        let mut s = self.stdin.lock().await;
        let _ = s.write_all(msg_str.as_bytes()).await;
        let _ = s.flush().await;
    }

    /// Create a new ACP session, optionally setting the model.
    pub async fn create_session(&self, model: Option<&str>) -> Result<String, String> {
        let result = self
            .request(
                "session/new",
                json!({
                    "cwd": self.repo_path,
                    "mcpServers": []
                }),
            )
            .await?;

        let session_id = result
            .get("sessionId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if session_id.is_empty() {
            return Err("No sessionId in response".to_string());
        }

        if let Some(m) = model {
            // Try both param formats: "configId" (newer ACP) and "key" (older ACP)
            let r1 = self
                .request(
                    "session/set_config_option",
                    json!({
                        "sessionId": session_id,
                        "configId": "model",
                        "value": m
                    }),
                )
                .await;
            if r1.is_err() {
                let _ = self
                    .request(
                        "session/set_config_option",
                        json!({
                            "sessionId": session_id,
                            "key": "model",
                            "value": m
                        }),
                    )
                    .await;
            }
        }

        Ok(session_id)
    }

    /// Resume an existing session, falling back to creating a new one on failure.
    pub async fn resume_session(&self, session_id: &str) -> Result<String, String> {
        match self
            .request(
                "session/load",
                json!({
                    "sessionId": session_id,
                    "cwd": self.repo_path,
                    "mcpServers": []
                }),
            )
            .await
        {
            Ok(result) => {
                let sid = result
                    .get("sessionId")
                    .and_then(|v| v.as_str())
                    .unwrap_or(session_id)
                    .to_string();
                Ok(sid)
            }
            Err(_) => self.create_session(None).await,
        }
    }

    /// Set the model for a session.
    pub async fn set_model(&self, session_id: &str, model: &str) -> Result<(), String> {
        let r = self
            .request(
                "session/set_config_option",
                json!({
                    "sessionId": session_id,
                    "configId": "model",
                    "value": model
                }),
            )
            .await;
        if r.is_err() {
            let _ = self
                .request(
                    "session/set_config_option",
                    json!({
                        "sessionId": session_id,
                        "key": "model",
                        "value": model
                    }),
                )
                .await;
        }
        Ok(())
    }

    /// Send a prompt and stream updates via the callback channel.
    ///
    /// Sets up the update and write callbacks, sends the prompt request,
    /// and waits for the response. The reader task dispatches `session/update`
    /// notifications to the callback channel during execution.
    pub async fn prompt(
        &self,
        session_id: &str,
        text: &str,
        callback: mpsc::Sender<AcpUpdate>,
        write_callback: Option<mpsc::Sender<(String, String)>>,
    ) -> Result<AcpResult, String> {
        // Install callbacks
        {
            let mut tx = self.update_tx.lock().await;
            *tx = Some(callback);
        }
        {
            let mut wtx = self.write_tx.lock().await;
            *wtx = write_callback;
        }

        let result = self
            .request(
                "session/prompt",
                json!({
                    "sessionId": session_id,
                    "prompt": [{ "type": "text", "text": text }]
                }),
            )
            .await;

        // Clear callbacks
        {
            let mut tx = self.update_tx.lock().await;
            *tx = None;
        }
        {
            let mut wtx = self.write_tx.lock().await;
            *wtx = None;
        }

        match result {
            Ok(val) => {
                let stop_reason = val
                    .get("stopReason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let usage = val.get("usage").cloned();
                Ok(AcpResult { stop_reason, usage })
            }
            Err(e) => Err(e),
        }
    }

    /// Cancel an ongoing prompt (sends a notification, no response expected).
    #[allow(dead_code)]
    pub async fn cancel(&self, session_id: &str) {
        self.send_notification("session/cancel", json!({ "sessionId": session_id }))
            .await;
    }

    /// Stop the ACP agent process.
    pub async fn stop(&mut self) {
        if let Some(mut proc) = self.proc.take() {
            let _ = proc.kill().await;
        }
        if let Some(task) = self.reader_task.take() {
            task.abort();
        }
    }

    /// Get recent stderr output for error reporting.
    #[allow(dead_code)]
    pub async fn get_recent_errors(&self) -> String {
        self.stderr_buffer.lock().await.join("\n")
    }
}

impl Drop for AcpClient {
    fn drop(&mut self) {
        if let Some(task) = self.reader_task.take() {
            task.abort();
        }
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Handle a `session/update` notification from the agent.
async fn handle_update(
    params: &Value,
    update_tx: &Arc<Mutex<Option<mpsc::Sender<AcpUpdate>>>>,
) {
    let tx_guard = update_tx.lock().await;
    let tx = match tx_guard.as_ref() {
        Some(tx) => tx,
        None => return,
    };

    let update = match params.get("update") {
        Some(u) => u,
        None => return,
    };

    let session_update = update
        .get("sessionUpdate")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match session_update {
        "agent_message_chunk" => {
            if let Some(text) = update
                .get("content")
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
            {
                if !text.is_empty() {
                    let _ = tx
                        .send(AcpUpdate {
                            event_type: "text".to_string(),
                            text: text.to_string(),
                        })
                        .await;
                }
            }
        }
        "agent_thought_chunk" => {
            if let Some(text) = update
                .get("content")
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
            {
                if !text.is_empty() {
                    let _ = tx
                        .send(AcpUpdate {
                            event_type: "thought".to_string(),
                            text: text.to_string(),
                        })
                        .await;
                }
            }
        }
        "tool_call" | "tool_call_update" => {
            let meta = update.get("_meta").and_then(|m| m.get("claudeCode"));
            let tool_name = meta
                .and_then(|c| c.get("toolName"))
                .and_then(|v| v.as_str())
                .or_else(|| update.get("title").and_then(|v| v.as_str()))
                .unwrap_or("unknown");
            let title = update
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if session_update == "tool_call" {
                if !title.is_empty() {
                    let _ = tx
                        .send(AcpUpdate {
                            event_type: "tool".to_string(),
                            text: format!("> **{}**: {}\n", tool_name, title),
                        })
                        .await;
                }
            } else if let Some(raw_input) = update.get("rawInput") {
                if raw_input.is_object()
                    && raw_input
                        .as_object()
                        .map(|o| !o.is_empty())
                        .unwrap_or(false)
                {
                    let input_str = serde_json::to_string(raw_input).unwrap_or_default();
                    let truncated = if input_str.len() > 200 {
                        &input_str[..200]
                    } else {
                        &input_str
                    };
                    let display = if title.is_empty() {
                        truncated.to_string()
                    } else {
                        title.to_string()
                    };
                    let _ = tx
                        .send(AcpUpdate {
                            event_type: "tool".to_string(),
                            text: format!("> **{}**: {}\n", tool_name, display),
                        })
                        .await;
                }
            }
        }
        "plan_update" => {
            if let Some(plan) = update.get("plan") {
                if let Some(entries) = plan.get("entries").and_then(|e| e.as_array()) {
                    let plan_text: String = entries
                        .iter()
                        .filter_map(|e| {
                            let content = e.get("content").and_then(|c| c.as_str())?;
                            let status = e.get("status").and_then(|s| s.as_str())?;
                            Some(format!("- [{}] {}", status, content))
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    if !plan_text.is_empty() {
                        let _ = tx
                            .send(AcpUpdate {
                                event_type: "plan".to_string(),
                                text: plan_text,
                            })
                            .await;
                    }
                }
            }
        }
        "agent_message_start" | "agent_message_end" | "usage_update"
        | "available_commands_update" => {
            // Known non-content events — ignore
        }
        _ => {
            // Unknown events — ignore silently
        }
    }
}

/// Handle requests from the ACP agent (fs operations, terminal, permissions).
async fn handle_agent_request(
    method: &str,
    params: &Value,
    repo_path: &str,
    terminals: &Arc<Mutex<HashMap<String, TerminalState>>>,
    write_tx: &Arc<Mutex<Option<mpsc::Sender<(String, String)>>>>,
) -> Value {
    match method {
        "session/request_permission" => {
            // Auto-approve all permissions
            let options = params
                .get("options")
                .and_then(|v| v.as_array())
                .or_else(|| {
                    params
                        .get("permission")
                        .and_then(|p| p.get("options"))
                        .and_then(|v| v.as_array())
                });

            let selected_id = if let Some(opts) = options {
                opts.iter()
                    .find(|o| {
                        o.get("optionId").and_then(|v| v.as_str()) == Some("allow_always")
                    })
                    .or_else(|| {
                        opts.iter().find(|o| {
                            o.get("optionId").and_then(|v| v.as_str()) == Some("allow")
                        })
                    })
                    .or_else(|| opts.first())
                    .and_then(|o| o.get("optionId").and_then(|v| v.as_str()))
                    .unwrap_or("allow_always")
            } else {
                "allow_always"
            };

            json!({
                "outcome": {
                    "outcome": "selected",
                    "optionId": selected_id
                }
            })
        }
        "fs/read_text_file" => {
            let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
            let file_path = resolve_file_path(uri, repo_path);
            match std::fs::read_to_string(&file_path) {
                Ok(text) => json!({ "text": text }),
                Err(_) => json!({ "text": "" }),
            }
        }
        "fs/write_text_file" => {
            let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
            let file_path = resolve_file_path(uri, repo_path);
            let text = params.get("text").and_then(|v| v.as_str()).unwrap_or("");

            if let Some(parent) = Path::new(&file_path).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match std::fs::write(&file_path, text) {
                Ok(_) => {
                    let tx_guard = write_tx.lock().await;
                    if let Some(tx) = tx_guard.as_ref() {
                        let _ = tx.send((file_path, text.to_string())).await;
                    }
                    json!({})
                }
                Err(e) => json!({ "error": e.to_string() }),
            }
        }
        "edit/apply" | "fs/edit_text_file" => {
            let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
            let file_path = resolve_file_path(uri, repo_path);
            let text = params
                .get("newText")
                .or_else(|| params.get("text"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if !file_path.is_empty() && !text.is_empty() {
                if let Some(parent) = Path::new(&file_path).parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match std::fs::write(&file_path, text) {
                    Ok(_) => {
                        let tx_guard = write_tx.lock().await;
                        if let Some(tx) = tx_guard.as_ref() {
                            let _ = tx.send((file_path, text.to_string())).await;
                        }
                        json!({})
                    }
                    Err(e) => json!({ "error": e.to_string() }),
                }
            } else {
                json!({})
            }
        }
        "terminal/create" => {
            let command = params
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let args: Vec<String> = params
                .get("args")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let cwd = params
                .get("cwd")
                .and_then(|v| v.as_str())
                .unwrap_or(repo_path);

            let term_id = format!(
                "term-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
            );

            let full_cmd = if args.is_empty() {
                command.to_string()
            } else {
                format!("{} {}", command, args.join(" "))
            };

            let result = tokio::process::Command::new("sh")
                .args(["-c", &full_cmd])
                .current_dir(cwd)
                .output()
                .await;

            let (output, exit_code) = match result {
                Ok(output) => {
                    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                    let stderr_out = String::from_utf8_lossy(&output.stderr).to_string();
                    let combined = format!("{}{}", stdout, stderr_out);
                    let code = output.status.code().unwrap_or(1);
                    (combined, code)
                }
                Err(e) => (format!("Error: {}", e), 1),
            };

            let mut terms = terminals.lock().await;
            terms.insert(term_id.clone(), TerminalState { output, exit_code });

            json!({ "terminalId": term_id })
        }
        "terminal/output" => {
            let term_id = params
                .get("terminalId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let terms = terminals.lock().await;
            let term = terms.get(term_id);
            json!({
                "output": term.map(|t| t.output.as_str()).unwrap_or(""),
                "truncated": false,
                "exitStatus": {
                    "exitCode": term.map(|t| t.exit_code).unwrap_or(0)
                }
            })
        }
        "terminal/wait_for_exit" => {
            let term_id = params
                .get("terminalId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let terms = terminals.lock().await;
            let exit_code = terms.get(term_id).map(|t| t.exit_code).unwrap_or(0);
            json!({ "exitCode": exit_code })
        }
        "terminal/kill" | "terminal/release" => {
            json!({})
        }
        "fs/list_directory" | "fs/search" | "fs/list_text_file" => {
            json!({ "entries": [] })
        }
        _ => {
            eprintln!("[acp] unhandled request method: {}", method);
            json!({})
        }
    }
}

/// Resolve a file:// URI to an absolute path.
fn resolve_file_path(uri: &str, repo_path: &str) -> String {
    let path_str = uri.replace("file://", "");
    if path_str.is_empty() {
        return String::new();
    }
    if path_str.starts_with('/') {
        path_str
    } else {
        Path::new(repo_path)
            .join(&path_str)
            .to_string_lossy()
            .to_string()
    }
}
