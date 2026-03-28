use crate::ai::config::AiConfig;
use tokio::sync::mpsc;

/// Dispatch a streaming AI call to the appropriate provider.
/// Sends text chunks via `tx` and returns full accumulated text.
pub async fn stream_ai_call(
    config: &AiConfig,
    system: &str,
    prompt: &str,
    tx: mpsc::Sender<String>,
) -> Result<String, String> {
    match config.provider.as_str() {
        "anthropic" => {
            crate::ai::anthropic::stream_message(
                &config.api_key,
                &config.model,
                system,
                prompt,
                tx,
            )
            .await
        }
        "openai" | "glm" => {
            crate::ai::openai::stream_message(
                &config.api_key,
                &config.model,
                config.base_url.as_deref(),
                system,
                prompt,
                tx,
            )
            .await
        }
        other => Err(format!("Unsupported provider: {}", other)),
    }
}

/// Dispatch a non-streaming AI call to the appropriate provider.
/// Returns the full text response.
pub async fn generate_ai_call(
    config: &AiConfig,
    system: &str,
    prompt: &str,
) -> Result<String, String> {
    match config.provider.as_str() {
        "anthropic" => {
            crate::ai::anthropic::generate_message(
                &config.api_key,
                &config.model,
                system,
                prompt,
            )
            .await
        }
        "openai" | "glm" => {
            crate::ai::openai::generate_message(
                &config.api_key,
                &config.model,
                config.base_url.as_deref(),
                system,
                prompt,
            )
            .await
        }
        other => Err(format!("Unsupported provider: {}", other)),
    }
}
