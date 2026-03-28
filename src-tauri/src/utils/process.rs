use tokio::process::Command;

/// Get PATH with common macOS tool directories included.
/// GUI apps on macOS don't inherit shell PATH, so Homebrew/nix paths are missing.
fn enriched_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let extra = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/usr/sbin",
        "/bin",
        "/sbin",
    ];
    let mut parts: Vec<&str> = current.split(':').collect();
    for p in extra {
        if !parts.contains(&p) {
            parts.push(p);
        }
    }
    parts.join(":")
}

pub async fn exec(cmd: &str, args: &[&str], cwd: &str) -> Result<String, String> {
    let output = Command::new(cmd)
        .args(args)
        .current_dir(cwd)
        .env("PATH", enriched_path())
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        // Return stdout + stderr combined (gh auth status outputs to stderr even on success)
        let combined = if stderr.is_empty() { stdout } else { format!("{}{}", stdout, stderr) };
        Ok(combined)
    } else {
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

