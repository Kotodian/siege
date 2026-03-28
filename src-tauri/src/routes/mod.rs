pub mod projects;
pub mod plans;
pub mod plan_folders;
pub mod schemes;
pub mod schedules;
pub mod schedule_items;
pub mod reviews;
pub mod review_items;
pub mod review_comments;
pub mod test_suites;
pub mod test_cases;
pub mod settings;
pub mod memories;
pub mod snapshots;
pub mod backup;
pub mod import;
pub mod ai_config;
pub mod archive;
pub mod git;
pub mod filesystem;
pub mod rollback;

use axum::{routing::{get, post, put}, Router};
use tower_http::cors::{CorsLayer, Any};
use crate::state::AppState;

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Projects
        .route("/api/projects", get(projects::list).post(projects::create))
        .route("/api/projects/{id}", get(projects::get_one).put(projects::update).delete(projects::delete_one))
        // Plans
        .route("/api/plans", get(plans::list).post(plans::create))
        .route("/api/plans/{id}", get(plans::get_one).put(plans::update).delete(plans::delete_one))
        .route("/api/plans/{id}/confirm", post(plans::confirm))
        .route("/api/plans/{id}/review-action", post(plans::review_action))
        // Plan folders
        .route("/api/plan-folders", get(plan_folders::list).post(plan_folders::create))
        .route("/api/plan-folders/{id}", put(plan_folders::update).delete(plan_folders::delete_one))
        // Schemes
        .route("/api/schemes", get(schemes::list).post(schemes::create))
        .route("/api/schemes/{id}", get(schemes::get_one).put(schemes::update).delete(schemes::delete_one))
        .route("/api/schemes/{id}/versions", get(schemes::list_versions))
        // Schedules
        .route("/api/schedules", get(schedules::list).post(schedules::create))
        .route("/api/schedules/auto-execute", post(schedules::auto_execute))
        .route("/api/schedules/tick", post(schedules::tick))
        // Schedule items
        .route("/api/schedule-items/{id}", put(schedule_items::update).delete(schedule_items::delete_one))
        // Reviews
        .route("/api/reviews", get(reviews::list).post(reviews::create))
        .route("/api/reviews/cancel", post(reviews::cancel))
        // Review items
        .route("/api/review-items/{id}", get(review_items::get_one).put(review_items::update))
        // Review comments
        .route("/api/review-comments", get(review_comments::list).post(review_comments::create))
        // Test suites
        .route("/api/test-suites", get(test_suites::list).post(test_suites::create))
        // Test cases
        .route("/api/test-cases", get(test_cases::list).post(test_cases::create))
        .route("/api/test-cases/{id}", get(test_cases::get_one).put(test_cases::update).delete(test_cases::delete_one))
        // Settings
        .route("/api/settings", get(settings::list).put(settings::update))
        // Memories
        .route("/api/memories", get(memories::list).post(memories::create))
        .route("/api/memories/{id}", get(memories::get_one).put(memories::update).delete(memories::delete_one))
        // Snapshots
        .route("/api/snapshots", get(snapshots::list))
        .route("/api/snapshots/tasks", get(snapshots::tasks))
        // Backup
        .route("/api/backup", get(backup::list).post(backup::create).put(backup::trigger))
        // Import sources
        .route("/api/import-sources", get(import::list).post(import::create).delete(import::delete_one))
        // AI config
        .route("/api/ai-config", get(ai_config::get_config).put(ai_config::update_config))
        // Archive
        .route("/api/archive", post(archive::archive))
        // Git
        .route("/api/git", get(git::info).post(git::checkout))
        .route("/api/git/clone", post(git::clone_repo))
        .route("/api/git/push", post(git::push))
        .route("/api/git/pr", get(git::list_prs).post(git::create_pr))
        // Filesystem
        .route("/api/filesystem", get(filesystem::list_dir))
        // Snapshots backfill
        .route("/api/snapshots/backfill", post(snapshots::backfill))
        // Rollback
        .route("/api/rollback", post(rollback::handle))
        .with_state(state)
        .layer(cors)
}
