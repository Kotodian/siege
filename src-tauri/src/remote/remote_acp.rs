use super::ssh::{SshConfig, spawn_ssh_process};
use crate::ai::acp::AcpClient;

pub async fn start_remote_acp(
    config: &SshConfig,
    agent: &str,
) -> Result<AcpClient, String> {
    let remote_cmd = match agent {
        "copilot" => "npx -y @github/copilot --acp",
        "codex" => "npx -y @zed-industries/codex-acp@latest",
        _ => "npx -y @zed-industries/claude-agent-acp@latest",
    };

    let child = spawn_ssh_process(config, remote_cmd).await?;
    AcpClient::start_with_child(child, &config.repo_path, agent).await
}
