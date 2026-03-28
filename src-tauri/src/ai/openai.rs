use reqwest::Client;
use tokio::sync::mpsc;

/// Stream a message via the OpenAI Chat Completions API (also works for GLM
/// and other OpenAI-compatible providers via custom `base_url`).
///
/// Sends text delta chunks via `tx` and returns the full accumulated text.
pub async fn stream_message(
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    system: &str,
    prompt: &str,
    tx: mpsc::Sender<String>,
) -> Result<String, String> {
    let url = format!(
        "{}/chat/completions",
        base_url.unwrap_or("https://api.openai.com/v1")
    );

    let client = Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": model,
            "max_tokens": 8192,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "stream": true,
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error {}: {}", status, body));
    }

    let mut full_text = String::new();
    let mut stream = resp.bytes_stream();

    use futures_util::StreamExt;

    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Stream read error: {}", e))?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // Process complete lines from the buffer
        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    break;
                }

                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                    // choices[0].delta.content
                    if let Some(text) = parsed
                        .get("choices")
                        .and_then(|c| c.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|choice| choice.get("delta"))
                        .and_then(|delta| delta.get("content"))
                        .and_then(|t| t.as_str())
                    {
                        full_text.push_str(text);
                        let _ = tx.send(text.to_string()).await;
                    }
                }
            }
        }
    }

    Ok(full_text)
}

/// Non-streaming message call. Returns the full text response.
pub async fn generate_message(
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    system: &str,
    prompt: &str,
) -> Result<String, String> {
    let url = format!(
        "{}/chat/completions",
        base_url.unwrap_or("https://api.openai.com/v1")
    );

    let client = Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": model,
            "max_tokens": 8192,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error {}: {}", status, body));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("JSON parse error: {}", e))?;

    let text = body
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|msg| msg.get("content"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();

    Ok(text)
}
