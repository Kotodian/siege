use async_trait::async_trait;
use russh::client;
use russh::{ChannelMsg, Disconnect};
use russh_keys::load_secret_key;
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct SshConfig {
    pub host: String,
    pub user: String,
    pub repo_path: String,
}

struct SshHandler;

#[async_trait]
impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Accept all host keys — Tailscale network is trusted
        Ok(true)
    }
}

/// Establish an SSH connection and authenticate using local key files.
async fn connect_and_auth(config: &SshConfig) -> Result<client::Handle<SshHandler>, String> {
    let ssh_config = client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(60)),
        ..Default::default()
    };

    let mut session = client::connect(
        Arc::new(ssh_config),
        (config.host.as_str(), 22),
        SshHandler,
    )
    .await
    .map_err(|e| format!("SSH connect failed: {}", e))?;

    if authenticate(&mut session, &config.user).await? {
        Ok(session)
    } else {
        Err("SSH authentication failed: no valid key found".to_string())
    }
}

/// Try authenticating with SSH agent first, then fall back to key files in ~/.ssh/.
async fn authenticate(
    session: &mut client::Handle<SshHandler>,
    user: &str,
) -> Result<bool, String> {
    // Try SSH agent first
    if let Ok(mut agent) = russh_keys::agent::client::AgentClient::connect_env().await {
        let identities = agent.request_identities().await.unwrap_or_default();
        for identity in identities {
            match session
                .authenticate_publickey_with(user, identity, &mut agent)
                .await
            {
                Ok(true) => return Ok(true),
                _ => continue,
            }
        }
    }

    // Fall back to key files
    let home = dirs::home_dir().unwrap_or_default();

    for key_name in &["id_ed25519", "id_rsa", "id_ecdsa"] {
        let key_path = home.join(".ssh").join(key_name);
        if key_path.exists() {
            if let Ok(key) = load_secret_key(&key_path, None) {
                match session
                    .authenticate_publickey(user, Arc::new(key))
                    .await
                {
                    Ok(true) => return Ok(true),
                    Ok(false) => continue,
                    Err(_) => continue,
                }
            }
        }
    }

    Ok(false)
}

/// Connect to a remote machine via SSH and execute a command, returning its output.
pub async fn ssh_exec(config: &SshConfig, cmd: &str) -> Result<String, String> {
    let session = connect_and_auth(config).await?;

    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Channel open failed: {}", e))?;

    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("Exec failed: {}", e))?;

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut exit_code: Option<u32> = None;

    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { ref data }) => {
                stdout.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExtendedData { ref data, ext }) if ext == 1 => {
                stderr.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = Some(exit_status);
            }
            None => break,
            _ => {}
        }
    }

    let _ = session
        .disconnect(Disconnect::ByApplication, "", "")
        .await;

    match exit_code {
        Some(0) | None => Ok(if stderr.is_empty() {
            stdout
        } else {
            format!("{}{}", stdout, stderr)
        }),
        Some(_) => Err(if stderr.is_empty() { stdout } else { stderr }),
    }
}

pub async fn check_connection(config: &SshConfig) -> Result<String, String> {
    ssh_exec(config, "echo ok && hostname").await
}

pub async fn read_remote_file(config: &SshConfig, path: &str) -> Result<String, String> {
    ssh_exec(config, &format!("cat '{}'", path)).await
}

pub async fn write_remote_file(
    config: &SshConfig,
    path: &str,
    content: &str,
) -> Result<(), String> {
    let escaped = content.replace('\'', "'\\''");
    ssh_exec(
        config,
        &format!("printf '%s' '{}' > '{}'", escaped, path),
    )
    .await?;
    Ok(())
}

pub async fn list_remote_dir(config: &SshConfig, path: &str) -> Result<String, String> {
    ssh_exec(config, &format!("ls -la '{}'", path)).await
}

pub async fn remote_git(config: &SshConfig, args: &str) -> Result<String, String> {
    ssh_exec(
        config,
        &format!("cd '{}' && git {}", config.repo_path, args),
    )
    .await
}

/// Spawn a long-running SSH process with stdin/stdout piped (for ACP agent).
///
/// NOTE: This function intentionally uses `tokio::process::Command::new("ssh")` as a
/// pragmatic fallback. The ACP agent protocol requires piping stdin/stdout on a
/// long-lived process, which maps naturally to an OS child process. While russh channels
/// do implement AsyncRead/AsyncWrite, the AcpClient API expects a `tokio::process::Child`
/// with separately owned stdin/stdout handles. Wrapping a russh channel to emulate that
/// would add significant complexity with no practical benefit, since this is the only
/// remaining shell SSH call and runs over a trusted Tailscale network.
pub async fn spawn_ssh_process(
    config: &SshConfig,
    remote_cmd: &str,
) -> Result<tokio::process::Child, String> {
    tokio::process::Command::new("ssh")
        .args([
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ServerAliveInterval=30",
            "-o",
            "ServerAliveCountMax=3",
            &format!("{}@{}", config.user, config.host),
            &format!("cd '{}' && {}", config.repo_path, remote_cmd),
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("SSH spawn failed: {}", e))
}
