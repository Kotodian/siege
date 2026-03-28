/**
 * API base URL. In Tauri desktop mode, Rust injects window.__SIEGE_API_BASE__.
 * In web/dev mode, defaults to empty string (same-origin).
 */
function getApiBase(): string {
  if (typeof window !== "undefined" && (window as any).__SIEGE_API_BASE__) {
    return (window as any).__SIEGE_API_BASE__;
  }
  return "";
}

/**
 * Wrapper around fetch() that prepends API_BASE to relative URLs.
 * Drop-in replacement for fetch("/api/...").
 */
export function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (typeof input === "string" && input.startsWith("/api/")) {
    return fetch(`${getApiBase()}${input}`, init);
  }
  return fetch(input, init);
}
