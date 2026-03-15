const STORAGE_KEY = "siege_recent_projects";
const MAX_RECENT = 5;

export function getRecentProjectIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addRecentProject(id: string) {
  if (typeof window === "undefined") return;
  const ids = getRecentProjectIds().filter((i) => i !== id);
  ids.unshift(id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
}
