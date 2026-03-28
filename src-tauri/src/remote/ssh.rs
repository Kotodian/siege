use tokio::process::Command;

#[derive(Clone, Debug)]
pub struct SshConfig {
    pub host: String,
    pub user: String,
    pub repo_path: String,
}

pub async fn ssh_exec(config: &SshConfig, cmd: &str) -> Result<String, String> {
    let output = Command::new("ssh")
        .args([
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", "ConnectTimeout=10",
            &format!("{}@{}", config.user, config.host),
            cmd,
        ])
        .output()
        .await
        .map_err(|e| format!("SSH failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(if stderr.is_empty() { stdout } else { format!("{}{}", stdout, stderr) })
    } else {
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

pub async fn check_connection(config: &SshConfig) -> Result<String, String> {
    ssh_exec(config, "echo ok && hostname").await
}

pub async fn read_remote_file(config: &SshConfig, path: &str) -> Result<String, String> {
    ssh_exec(config, &format!("cat '{}'", path)).await
}

pub async fn write_remote_file(config: &SshConfig, path: &str, content: &str) -> Result<(), String> {
    let escaped = content.replace('\'', "'\\''");
    ssh_exec(config, &format!("printf '%s' '{}' > '{}'", escaped, path)).await?;
    Ok(())
}

pub async fn list_remote_dir(config: &SshConfig, path: &str) -> Result<String, String> {
    ssh_exec(config, &format!("ls -la '{}'", path)).await
}

pub async fn remote_git(config: &SshConfig, args: &str) -> Result<String, String> {
    ssh_exec(config, &format!("cd '{}' && git {}", config.repo_path, args)).await
}

/// Spawn a long-running SSH process with stdin/stdout piped (for ACP agent).
pub async fn spawn_ssh_process(
    config: &SshConfig,
    remote_cmd: &str,
) -> Result<tokio::process::Child, String> {
    Command::new("ssh")
        .args([
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", "ConnectTimeout=10",
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=3",
            &format!("{}@{}", config.user, config.host),
            &format!("cd '{}' && {}", config.repo_path, remote_cmd),
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("SSH spawn failed: {}", e))
}
