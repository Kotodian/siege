use axum::Router;
use tower_http::cors::{CorsLayer, Any};
use crate::state::AppState;

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .with_state(state)
        .layer(cors)
}
