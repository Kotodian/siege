pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '📁',
    description TEXT DEFAULT '',
    guidelines TEXT DEFAULT '',
    session_id TEXT,
    target_repo_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_folders (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id TEXT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft','reviewing','confirmed','scheduled','executing','code_review','testing','completed')),
    tag TEXT DEFAULT 'feature',
    session_id TEXT,
    folder_id TEXT REFERENCES plan_folders(id) ON DELETE SET NULL,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schemes (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    structured_content TEXT,
    source_type TEXT NOT NULL DEFAULT 'manual'
        CHECK(source_type IN ('web_search','local_analysis','manual','notion','jira','confluence','mcp','feishu','github','gitlab')),
    search_results TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scheme_versions (
    id TEXT PRIMARY KEY,
    scheme_id TEXT NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    auto_execute INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schedule_items (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    scheme_id TEXT REFERENCES schemes(id) ON DELETE SET NULL,
    parent_id TEXT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','in_progress','completed','failed','rolled_back')),
    progress INTEGER NOT NULL DEFAULT 0,
    execution_log TEXT DEFAULT '',
    engine TEXT DEFAULT 'claude-code',
    skills TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS test_suites (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','generating','running','passed','failed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS test_cases (
    id TEXT PRIMARY KEY,
    test_suite_id TEXT NOT NULL REFERENCES test_suites(id) ON DELETE CASCADE,
    schedule_item_id TEXT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'unit'
        CHECK(type IN ('unit','integration','e2e')),
    generated_code TEXT DEFAULT '',
    file_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','passed','failed','skipped'))
);

CREATE TABLE IF NOT EXISTS test_results (
    id TEXT PRIMARY KEY,
    test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
    run_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL CHECK(status IN ('passed','failed','error','skipped')),
    output TEXT DEFAULT '',
    error_message TEXT,
    duration_ms INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cli_engines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    default_args TEXT DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS app_settings (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_configs (
    id TEXT PRIMARY KEY,
    backend TEXT NOT NULL CHECK(backend IN ('obsidian','notion','local')),
    config TEXT NOT NULL DEFAULT '{}',
    schedule_cron TEXT NOT NULL DEFAULT '0 2 * * *',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backup_history (
    id TEXT PRIMARY KEY,
    backup_config_id TEXT NOT NULL REFERENCES backup_configs(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK(status IN ('running','completed','failed')),
    items_count INTEGER DEFAULT 0,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('scheme','implementation')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','in_progress','approved','changes_requested')),
    content TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_items (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK(target_type IN ('scheme','schedule_item','code')),
    target_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'info'
        CHECK(severity IN ('info','warning','critical')),
    resolved INTEGER NOT NULL DEFAULT 0,
    resolution TEXT,
    file_path TEXT,
    line_number INTEGER,
    options TEXT
);

CREATE TABLE IF NOT EXISTS review_comments (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    line_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    ai_response TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','applied','rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS file_snapshots (
    id TEXT PRIMARY KEY,
    schedule_item_id TEXT NOT NULL REFERENCES schedule_items(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    content_before TEXT DEFAULT '',
    content_after TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_configs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL
        CHECK(source IN ('notion','jira','confluence','mcp','feishu','github','gitlab')),
    config TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','done','error')),
    result TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    type TEXT NOT NULL DEFAULT 'project'
        CHECK(type IN ('project','user','feedback')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual'
        CHECK(source IN ('auto','manual')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;
