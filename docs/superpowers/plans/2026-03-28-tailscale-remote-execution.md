# Tailscale Remote Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow Siege desktop to execute AI tasks (Claude Code/Codex/Copilot) on remote machines via Tailscale SSH, operating on remote target repositories instead of local ones.

**Architecture:** Projects gain an optional `remote` configuration (Tailscale IP/hostname + SSH user + remote repo path). When a project is configured as remote, the ACP client spawns the agent process over SSH (`ssh user@tailscale-ip npx ...`) instead of locally. Git operations, file snapshots, and filesystem browsing also route through SSH. The Tailscale network handles connectivity — Siege doesn't embed Tailscale, just uses the existing Tailscale daemon.

**Tech Stack:** Rust (tokio::process for SSH), SSH protocol (via Tailscale), existing ACP JSON-RPC protocol unchanged

---

## File Structure

### New files

```
src-tauri/src/remote/
├── mod.rs              # Remote execution module
├── ssh.rs              # SSH command execution via Tailscale
└── remote_acp.rs       # ACP client that spawns agent over SSH
```

### Modified files

```
src-tauri/src/db/schema.rs          # Add remote columns to projects table
src-tauri/src/db/migrations.rs      # Migration for new columns
src-tauri/src/routes/projects.rs    # Handle remote fields in CRUD
src-tauri/src/routes/execute.rs     # Route to remote ACP when project is remote
src-tauri/src/routes/git.rs         # SSH git operations for remote projects
src-tauri/src/routes/filesystem.rs  # SSH ls for remote projects
src-tauri/src/main.rs               # Add mod remote
src/lib/db/schema.ts                # Add remote columns (TypeScript side)
src/components/project/create-project-dialog.tsx  # Remote config UI
src/components/ui/icons.tsx          # Tailscale icon
src/messages/zh.json                 # i18n
src/messages/en.json                 # i18n
```

---

## Task 1: Database schema — add remote fields to projects

**Files:**
- Modify: `src-tauri/src/db/schema.rs`
- Modify: `src-tauri/src/db/migrations.rs`
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Add remote columns to Rust schema**

In `src-tauri/src/db/schema.rs`, add these columns to the `projects` CREATE TABLE:

```sql
remote_host TEXT,
remote_user TEXT DEFAULT 'root',
remote_repo_path TEXT,
remote_enabled INTEGER NOT NULL DEFAULT 0
```

`remote_host` stores the Tailscale IP or hostname (e.g. `100.64.1.5` or `dev-server`).
`remote_user` is the SSH user.
`remote_repo_path` is the absolute path on the remote machine (e.g. `/home/user/projects/my-app`).
`remote_enabled` toggles remote execution on/off.

- [ ] **Step 2: Add migration for existing databases**

In `src-tauri/src/db/migrations.rs`, after the schema creation, add:

```rust
// Add remote columns if they don't exist (idempotent)
let columns = ["remote_host", "remote_user", "remote_repo_path", "remote_enabled"];
for col in columns {
    let sql = match col {
        "remote_enabled" => format!("ALTER TABLE projects ADD COLUMN {} INTEGER NOT NULL DEFAULT 0", col),
        "remote_user" => format!("ALTER TABLE projects ADD COLUMN {} TEXT DEFAULT 'root'", col),
        _ => format!("ALTER TABLE projects ADD COLUMN {} TEXT", col),
    };
    match conn.execute(&sql, []) {
        Ok(_) => {},
        Err(e) if e.to_string().contains("duplicate column") => {},
        Err(e) => return Err(e),
    }
}
```

- [ ] **Step 3: Add remote columns to TypeScript schema**

In `src/lib/db/schema.ts`, add to the `projects` table:

```typescript
remoteHost: text("remote_host"),
remoteUser: text("remote_user").default("root"),
remoteRepoPath: text("remote_repo_path"),
remoteEnabled: integer("remote_enabled", { mode: "boolean" }).notNull().default(false),
```

- [ ] **Step 4: Generate Drizzle migration**

```bash
npx drizzle-kit generate
```

- [ ] **Step 5: Verify both compile**

```bash
cd src-tauri && cargo check && cd .. && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/ src/lib/db/
git commit -m "feat: add remote execution fields to projects schema"
```

---

## Task 2: SSH execution module

**Files:**
- Create: `src-tauri/src/remote/mod.rs`
- Create: `src-tauri/src/remote/ssh.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Create `src-tauri/src/remote/mod.rs`**

```rust
pub mod ssh;
pub mod remote_acp;
```

- [ ] **Step 2: Create `src-tauri/src/remote/ssh.rs`**

```rust
use tokio::process::Command;

/// Configuration for a remote SSH connection via Tailscale.
#[derive(Clone, Debug)]
pub struct SshConfig {
    pub host: String,      // Tailscale IP or hostname
    pub user: String,      // SSH user
    pub repo_path: String, // Absolute path on remote machine
}

/// Execute a command on the remote machine via SSH.
/// Returns stdout on success, stderr on failure.
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
        .map_err(|e| format!("SSH connection failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(if stderr.is_empty() { stdout } else { format!("{}{}", stdout, stderr) })
    } else {
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

/// Check if SSH connection to the remote host works.
pub async fn check_connection(config: &SshConfig) -> Result<String, String> {
    ssh_exec(config, "echo ok && hostname").await
}

/// Read a file from the remote machine.
pub async fn read_remote_file(config: &SshConfig, path: &str) -> Result<String, String> {
    ssh_exec(config, &format!("cat '{}'", path)).await
}

/// Write content to a file on the remote machine.
pub async fn write_remote_file(config: &SshConfig, path: &str, content: &str) -> Result<(), String> {
    // Use heredoc to avoid quoting issues
    let cmd = format!("cat > '{}' << 'SIEGE_EOF'\n{}\nSIEGE_EOF", path, content);
    ssh_exec(config, &cmd).await?;
    Ok(())
}

/// List directory on the remote machine.
pub async fn list_remote_dir(config: &SshConfig, path: &str) -> Result<String, String> {
    ssh_exec(config, &format!(
        "ls -la --time-style=long-iso '{}' 2>/dev/null || ls -la '{}'",
        path, path
    )).await
}

/// Execute a git command on the remote repo.
pub async fn remote_git(config: &SshConfig, args: &str) -> Result<String, String> {
    ssh_exec(config, &format!("cd '{}' && git {}", config.repo_path, args)).await
}

/// Spawn a long-running process over SSH (for ACP agent).
/// Returns the Child process with stdin/stdout piped.
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
            "-tt",
            &format!("{}@{}", config.user, config.host),
            &format!("cd '{}' && {}", config.repo_path, remote_cmd),
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn SSH process: {}", e))
}
```

- [ ] **Step 3: Add `mod remote;` to `main.rs`**

```rust
mod remote;
```

- [ ] **Step 4: Verify compiles**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/remote/ src-tauri/src/main.rs
git commit -m "feat: add SSH execution module for Tailscale remote access"
```

---

## Task 3: Remote ACP client

**Files:**
- Create: `src-tauri/src/remote/remote_acp.rs`

- [ ] **Step 1: Create `src-tauri/src/remote/remote_acp.rs`**

This is a thin wrapper that uses `spawn_ssh_process` to start the ACP agent over SSH instead of locally. The JSON-RPC protocol is identical — stdin/stdout still carry the same messages, just tunneled through SSH.

```rust
use super::ssh::{SshConfig, spawn_ssh_process};
use crate::ai::acp::AcpClient;

/// Start an ACP agent on a remote machine via SSH.
///
/// The remote machine must have `npx` available and network access to
/// download the ACP agent package.
pub async fn start_remote_acp(
    config: &SshConfig,
    agent: &str,
) -> Result<AcpClient, String> {
    let remote_cmd = match agent {
        "copilot" => "npx -y @github/copilot --acp",
        "codex" => "npx -y @zed-industries/codex-acp@latest",
        _ => "npx -y @zed-industries/claude-agent-acp@latest",
    };

    // AcpClient::start_with_process takes an existing Child process
    // instead of spawning one locally.
    AcpClient::start_with_child(
        spawn_ssh_process(config, remote_cmd).await?,
        &config.repo_path,
        agent,
    ).await
}
```

- [ ] **Step 2: Add `start_with_child` to AcpClient**

In `src-tauri/src/ai/acp.rs`, add a new constructor that accepts an existing `Child` process instead of spawning one:

```rust
/// Start ACP client with an existing child process (used for SSH remote).
pub async fn start_with_child(
    mut child: tokio::process::Child,
    repo_path: &str,
    agent: &str,
) -> Result<Self, String> {
    let stdin = child.stdin.take().ok_or("No stdin")?;
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let stderr = child.stderr.take();

    // ... same initialization as start(), but skip spawning the process
    // Reuse the same reader task, pending map, etc.
```

Extract the common init logic from `start()` into a shared `init_from_streams()` method, then call it from both `start()` and `start_with_child()`.

- [ ] **Step 3: Verify compiles**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/remote/remote_acp.rs src-tauri/src/ai/acp.rs
git commit -m "feat: remote ACP client — spawn agent over SSH"
```

---

## Task 4: Update projects CRUD for remote fields

**Files:**
- Modify: `src-tauri/src/routes/projects.rs`

- [ ] **Step 1: Update project struct and queries**

In `projects.rs`, add the remote fields to:
- The `list` handler SELECT query — include `remote_host`, `remote_user`, `remote_repo_path`, `remote_enabled`
- The `create` handler INSERT — accept and store remote fields
- The `update` handler — allow updating remote fields
- The `get_one` handler — include remote fields in response

JSON response format:
```json
{
  "id": "...",
  "name": "...",
  "targetRepoPath": "/local/path",
  "remoteHost": "100.64.1.5",
  "remoteUser": "root",
  "remoteRepoPath": "/home/user/project",
  "remoteEnabled": true
}
```

- [ ] **Step 2: Add SSH connection test endpoint**

Add `POST /api/projects/test-connection`:

```rust
pub async fn test_connection(Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
    let host = body.get("remoteHost").and_then(|v| v.as_str()).unwrap_or("");
    let user = body.get("remoteUser").and_then(|v| v.as_str()).unwrap_or("root");

    if host.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "remoteHost is required"})));
    }

    let config = SshConfig { host: host.into(), user: user.into(), repo_path: "/tmp".into() };
    match check_connection(&config).await {
        Ok(output) => (StatusCode::OK, Json(json!({"status": "connected", "hostname": output.trim()}))),
        Err(e) => (StatusCode::OK, Json(json!({"status": "failed", "error": e}))),
    }
}
```

Register in `routes/mod.rs`:
```rust
.route("/api/projects/test-connection", post(projects::test_connection))
```

- [ ] **Step 3: Verify compiles**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/routes/projects.rs src-tauri/src/routes/mod.rs
git commit -m "feat: projects CRUD supports remote fields + SSH connection test"
```

---

## Task 5: Route execute to remote ACP

**Files:**
- Modify: `src-tauri/src/routes/execute.rs`

- [ ] **Step 1: Check if project is remote and route accordingly**

In `execute_task()`, after loading project data, check `remote_enabled`:

```rust
// In the data loading phase, also load:
let remote_config = if remote_enabled {
    Some(SshConfig {
        host: remote_host.unwrap_or_default(),
        user: remote_user.unwrap_or("root".to_string()),
        repo_path: remote_repo_path.unwrap_or(cwd.clone()),
    })
} else {
    None
};

// When creating ACP client:
let mut acp_client = if let Some(ref remote) = remote_config {
    match start_remote_acp(remote, agent_type).await {
        Ok(c) => c,
        Err(e) => { /* error handling */ }
    }
} else {
    match AcpClient::start(&cwd_clone, agent_type).await {
        Ok(c) => c,
        Err(e) => { /* error handling */ }
    }
};

// For remote projects, also use SSH for:
// - snapshot_working_tree → remote_git "diff HEAD --name-only"
// - capture_file_snapshots → remote_git "diff", remote read file
// - get_head_hash → remote_git "rev-parse HEAD"
```

- [ ] **Step 2: Update git/snapshot helpers for remote**

Pass `Option<SshConfig>` to `snapshot_working_tree`, `capture_file_snapshots`, and `get_head_hash`. When `Some`, use `ssh_exec` / `remote_git` instead of local commands.

- [ ] **Step 3: Verify compiles**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/routes/execute.rs
git commit -m "feat: execute route supports remote ACP via Tailscale SSH"
```

---

## Task 6: Remote git and filesystem routes

**Files:**
- Modify: `src-tauri/src/routes/git.rs`
- Modify: `src-tauri/src/routes/filesystem.rs`

- [ ] **Step 1: Update git info route for remote projects**

In `git.rs` `info` handler, if the path corresponds to a remote project, use `remote_git` instead of local `git2`:

```rust
// Look up project by targetRepoPath to check if it's remote
// If remote: ssh_exec(config, "cd repo && git branch --show-current") etc.
// If local: existing git2 logic
```

- [ ] **Step 2: Update filesystem route for remote browsing**

In `filesystem.rs`, if the path is on a remote project, use `list_remote_dir`:

```rust
// If path starts with a known remote project's remoteRepoPath, use SSH
// Otherwise use local fs
```

- [ ] **Step 3: Verify compiles and commit**

```bash
cd src-tauri && cargo check
git add src-tauri/src/routes/git.rs src-tauri/src/routes/filesystem.rs
git commit -m "feat: git and filesystem routes support remote via SSH"
```

---

## Task 7: Frontend — remote project configuration UI

**Files:**
- Modify: `src/components/project/create-project-dialog.tsx`
- Modify: `src/messages/zh.json`
- Modify: `src/messages/en.json`

- [ ] **Step 1: Add remote toggle and fields to create project dialog**

Add a "远程执行" / "Remote Execution" toggle. When enabled, show:
- Remote Host (Tailscale IP/hostname)
- Remote User (default: root)
- Remote Repo Path (absolute path on remote machine)
- "测试连接" / "Test Connection" button

```tsx
const [remoteEnabled, setRemoteEnabled] = useState(false);
const [remoteHost, setRemoteHost] = useState("");
const [remoteUser, setRemoteUser] = useState("root");
const [remoteRepoPath, setRemoteRepoPath] = useState("");
const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "connected" | "failed">("idle");

const testConnection = async () => {
  setConnectionStatus("testing");
  const res = await apiFetch("/api/projects/test-connection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remoteHost, remoteUser }),
  });
  const data = await res.json();
  setConnectionStatus(data.status === "connected" ? "connected" : "failed");
};
```

UI section (after repo path picker):

```tsx
{/* Remote Execution */}
<div className="flex items-center gap-2 mt-4">
  <input type="checkbox" checked={remoteEnabled} onChange={e => setRemoteEnabled(e.target.checked)} />
  <label className="text-sm">{isZh ? "远程执行 (Tailscale)" : "Remote Execution (Tailscale)"}</label>
</div>
{remoteEnabled && (
  <div className="space-y-3 mt-2 p-3 rounded-lg" style={{ background: "var(--surface-container)" }}>
    <Input label={isZh ? "远程主机" : "Remote Host"} placeholder="100.64.1.5" value={remoteHost} onChange={e => setRemoteHost(e.target.value)} />
    <Input label={isZh ? "SSH 用户" : "SSH User"} value={remoteUser} onChange={e => setRemoteUser(e.target.value)} />
    <Input label={isZh ? "远程仓库路径" : "Remote Repo Path"} placeholder="/home/user/projects/my-app" value={remoteRepoPath} onChange={e => setRemoteRepoPath(e.target.value)} />
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={testConnection} disabled={!remoteHost || connectionStatus === "testing"}>
        {connectionStatus === "testing" ? "..." : isZh ? "测试连接" : "Test Connection"}
      </Button>
      {connectionStatus === "connected" && <span className="text-xs text-[var(--success)]">✓ {isZh ? "连接成功" : "Connected"}</span>}
      {connectionStatus === "failed" && <span className="text-xs text-[var(--error)]">✗ {isZh ? "连接失败" : "Failed"}</span>}
    </div>
  </div>
)}
```

Pass remote fields in `onSubmit`:
```tsx
onSubmit({
  name, icon, description, guidelines, targetRepoPath,
  ...(remoteEnabled && { remoteHost, remoteUser, remoteRepoPath, remoteEnabled: true }),
});
```

- [ ] **Step 2: Add i18n keys**

`zh.json`:
```json
"remote": {
  "enabled": "远程执行 (Tailscale)",
  "host": "远程主机",
  "user": "SSH 用户",
  "repoPath": "远程仓库路径",
  "testConnection": "测试连接",
  "connected": "连接成功",
  "failed": "连接失败",
  "indicator": "远程"
}
```

`en.json`:
```json
"remote": {
  "enabled": "Remote Execution (Tailscale)",
  "host": "Remote Host",
  "user": "SSH User",
  "repoPath": "Remote Repo Path",
  "testConnection": "Test Connection",
  "connected": "Connected",
  "failed": "Connection Failed",
  "indicator": "Remote"
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/project/ src/messages/
git commit -m "feat: remote project configuration UI with Tailscale SSH"
```

---

## Task 8: Remote indicator in project list and execution

**Files:**
- Modify: `src/components/project/project-card.tsx`
- Modify: `src/components/schedule/schedule-view.tsx`

- [ ] **Step 1: Show remote badge on project card**

In `project-card.tsx`, if `project.remoteEnabled`:

```tsx
{project.remoteEnabled && (
  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
    style={{ background: "rgba(192,193,255,0.12)", color: "var(--primary)" }}>
    🌐 {isZh ? "远程" : "Remote"}: {project.remoteHost}
  </span>
)}
```

- [ ] **Step 2: Show remote indicator during task execution**

In `schedule-view.tsx`, when executing a remote project's task, show the remote host in the progress:

```tsx
// In the execution start message:
const isRemote = project?.remoteEnabled;
const progressLabel = isRemote
  ? `${isZh ? "远程执行中" : "Remote executing"} (${project.remoteHost})...`
  : (isZh ? "AI 正在执行任务..." : "AI executing task...");
```

- [ ] **Step 3: Commit**

```bash
git add src/components/project/ src/components/schedule/
git commit -m "feat: remote execution indicator in project card and schedule"
```

---

## Task 9: Verify end-to-end and commit

- [ ] **Step 1: Run full compilation checks**

```bash
cd src-tauri && cargo check && cd .. && npx tsc --noEmit && npm test
```

- [ ] **Step 2: Final commit and push**

```bash
git add -A
git commit -m "feat: Tailscale remote execution support

- Projects can be configured with remote host/user/repo path
- AI tasks execute on remote machine via SSH over Tailscale
- ACP agent spawned on remote via SSH tunnel
- Git operations and filesystem browsing work remotely
- Connection test in project settings
- Remote indicator on project cards and during execution"

git push origin master
```

---

## How It Works (End-to-End Flow)

1. User creates project, enables "远程执行", enters Tailscale IP + SSH user + remote repo path
2. "测试连接" verifies SSH connectivity
3. User creates plan → scheme → schedule as normal
4. When executing a task:
   - Siege detects `remoteEnabled = true`
   - `ssh user@tailscale-ip npx claude-agent-acp` spawns ACP on remote
   - JSON-RPC flows through SSH tunnel (stdin/stdout)
   - ACP agent reads/writes files on the remote machine
   - File snapshots captured via `ssh git diff` / `ssh cat`
   - All streamed back to local Siege UI

**Prerequisite:** Tailscale must be installed and connected on both machines. SSH must be enabled on the remote (Tailscale SSH or standard OpenSSH).
