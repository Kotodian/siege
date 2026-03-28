/**
 * Open a URL in the user's default browser.
 * In Tauri desktop mode, uses the shell plugin.
 * In web mode, falls back to window.open.
 */
export async function openExternal(url: string): Promise<void> {
  if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return;
    } catch {
      // Tauri plugin not available, fall through
    }
  }
  window.open(url, "_blank");
}
