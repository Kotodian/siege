use rusqlite::Connection;

pub struct AiConfig {
    pub provider: String,
    pub model: String,
    pub api_key: String,
    pub base_url: Option<String>,
}

/// Default models per provider.
fn default_model(provider: &str) -> &'static str {
    match provider {
        "anthropic" => "claude-sonnet-4-20250514",
        "openai" => "gpt-4o",
        "glm" => "glm-4-plus",
        _ => "claude-sonnet-4-20250514",
    }
}

/// Default base URLs per provider (only GLM needs one).
fn default_base_url(provider: &str) -> Option<&'static str> {
    match provider {
        "glm" => Some("https://open.bigmodel.cn/api/paas/v4"),
        _ => None,
    }
}

/// Read a single setting from `app_settings` table.
pub fn get_setting(db: &Connection, key: &str) -> Option<String> {
    db.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    )
    .ok()
}

/// Resolve AI config for a specific step.
///
/// Priority: override params > step-specific settings > global default.
pub fn resolve_step_config(
    db: &Connection,
    step: &str,
    provider_override: Option<&str>,
    model_override: Option<&str>,
) -> Result<AiConfig, String> {
    let provider = provider_override
        .map(|s| s.to_string())
        .or_else(|| get_setting(db, &format!("step_provider_{}", step)))
        .or_else(|| get_setting(db, "default_provider"))
        .unwrap_or_else(|| "anthropic".to_string());

    let model = model_override
        .map(|s| s.to_string())
        .or_else(|| get_setting(db, &format!("step_model_{}", step)))
        .unwrap_or_else(|| default_model(&provider).to_string());

    let api_key = get_setting(db, &format!("{}_api_key", provider)).ok_or_else(|| {
        format!(
            "No API key configured for {}. Please configure an API key in Settings.",
            provider
        )
    })?;

    let base_url = get_setting(db, &format!("{}_base_url", provider))
        .or_else(|| default_base_url(&provider).map(|s| s.to_string()));

    Ok(AiConfig {
        provider,
        model,
        api_key,
        base_url,
    })
}
