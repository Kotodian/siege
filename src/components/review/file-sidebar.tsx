"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";

interface FileEntry {
  filePath: string;
  additions: number;
  deletions: number;
  findingCount: number;
  taskTitle?: string;
  taskOrder?: number;
}

interface FileSidebarProps {
  files: FileEntry[];
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}

interface TreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  file: FileEntry | null;
}

function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { name: "", fullPath: "", children: new Map(), file: null };

  for (const file of files) {
    const parts = file.filePath.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath: parts.slice(0, i + 1).join("/"),
          children: new Map(),
          file: null,
        });
      }
      current = current.children.get(part)!;
    }
    current.file = file;
  }

  return root;
}

// Collapse single-child directories: a/b/c → a/b/c
function collapseTree(node: TreeNode): TreeNode {
  if (node.children.size === 1 && !node.file) {
    const child = [...node.children.values()][0];
    if (!child.file) {
      const collapsed = collapseTree(child);
      return {
        ...collapsed,
        name: node.name ? `${node.name}/${collapsed.name}` : collapsed.name,
      };
    }
  }
  const newChildren = new Map<string, TreeNode>();
  for (const [key, child] of node.children) {
    newChildren.set(key, collapseTree(child));
  }
  return { ...node, children: newChildren };
}

function DirNode({
  node,
  selectedFile,
  onSelectFile,
  depth,
}: {
  node: TreeNode;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);

  // Sort: directories first, then files, alphabetically
  const entries = [...node.children.values()].sort((a, b) => {
    const aIsDir = a.children.size > 0 && !a.file;
    const bIsDir = b.children.size > 0 && !b.file;
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div>
      {/* Directory header (skip for root) */}
      {node.name && !node.file && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-1 px-2 py-1 text-xs hover:opacity-80 transition-colors"
          style={{ color: "var(--outline)", paddingLeft: `${depth * 12 + 8}px` }}
        >
          <svg
            className={`w-3 h-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-mono truncate">{node.name}</span>
        </button>
      )}

      {/* File leaf */}
      {node.file && (
        <FileLeaf
          file={node.file}
          name={node.name}
          depth={depth}
          isActive={selectedFile === node.file.filePath}
          onSelect={() => onSelectFile(node.file!.filePath)}
        />
      )}

      {/* Children */}
      {expanded &&
        entries.map((child) => (
          <DirNode
            key={child.fullPath}
            node={child}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            depth={node.name && !node.file ? depth + 1 : depth}
          />
        ))}
    </div>
  );
}

function FileLeaf({
  file,
  name,
  depth,
  isActive,
  onSelect,
}: {
  file: FileEntry;
  name: string;
  depth: number;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-1.5 px-2 py-1 text-xs transition-colors hover:opacity-80"
      style={{
        paddingLeft: `${depth * 12 + 8}px`,
        ...(isActive
          ? { background: "var(--outline-variant)", color: "var(--on-surface)" }
          : { color: "var(--outline)" }),
      }}
      title={file.filePath}
    >
      <FileIcon name={name} />
      <span className="font-mono truncate flex-1">{name}</span>
      <span className="flex items-center gap-1 shrink-0">
        {file.findingCount > 0 && (
          <span className="px-1 py-0.5 rounded-full bg-[rgba(255,183,131,0.12)] text-[var(--tertiary)] text-[10px] leading-none">
            {file.findingCount}
          </span>
        )}
        {file.additions > 0 && (
          <span className="text-[var(--success)] text-[10px]">+{file.additions}</span>
        )}
        {file.deletions > 0 && (
          <span className="text-[var(--error)] text-[10px]">-{file.deletions}</span>
        )}
      </span>
    </button>
  );
}

const FILE_ICONS: Record<string, { label: string; color: string }> = {
  ".ts": { label: "TS", color: "#3178c6" },
  ".tsx": { label: "TX", color: "#3178c6" },
  ".js": { label: "JS", color: "#f7df1e" },
  ".jsx": { label: "JX", color: "#f7df1e" },
  ".mjs": { label: "MJ", color: "#f7df1e" },
  ".rs": { label: "RS", color: "#dea584" },
  ".go": { label: "GO", color: "#00add8" },
  ".py": { label: "PY", color: "#3572a5" },
  ".rb": { label: "RB", color: "#cc342d" },
  ".java": { label: "JA", color: "#b07219" },
  ".kt": { label: "KT", color: "#a97bff" },
  ".swift": { label: "SW", color: "#f05138" },
  ".c": { label: "C", color: "#555555" },
  ".h": { label: "H", color: "#555555" },
  ".cpp": { label: "C+", color: "#f34b7d" },
  ".cc": { label: "C+", color: "#f34b7d" },
  ".cs": { label: "C#", color: "#178600" },
  ".php": { label: "PH", color: "#4f5d95" },
  ".lua": { label: "LU", color: "#000080" },
  ".zig": { label: "ZG", color: "#ec915c" },
  ".vue": { label: "VU", color: "#41b883" },
  ".svelte": { label: "SV", color: "#ff3e00" },
  ".html": { label: "HT", color: "#e34c26" },
  ".css": { label: "CS", color: "#563d7c" },
  ".scss": { label: "SC", color: "#c6538c" },
  ".json": { label: "{ }", color: "#a97bff" },
  ".yaml": { label: "YM", color: "#cb171e" },
  ".yml": { label: "YM", color: "#cb171e" },
  ".toml": { label: "TM", color: "#9c4221" },
  ".xml": { label: "XM", color: "#0060ac" },
  ".md": { label: "MD", color: "#888888" },
  ".txt": { label: "TX", color: "#888888" },
  ".sh": { label: "SH", color: "#89e051" },
  ".bash": { label: "SH", color: "#89e051" },
  ".zsh": { label: "SH", color: "#89e051" },
  ".fish": { label: "SH", color: "#89e051" },
  ".ps1": { label: "PS", color: "#012456" },
  ".sql": { label: "SQ", color: "#e38c00" },
  ".graphql": { label: "GQ", color: "#e10098" },
  ".proto": { label: "PB", color: "#888888" },
  ".dockerfile": { label: "DK", color: "#384d54" },
  ".dockerignore": { label: "DK", color: "#384d54" },
  ".env": { label: "EN", color: "#ecd53f" },
  ".gitignore": { label: "GI", color: "#f05032" },
  ".lock": { label: "LK", color: "#888888" },
  ".wasm": { label: "WA", color: "#654ff0" },
  ".sol": { label: "SO", color: "#aa6746" },
  ".r": { label: "R", color: "#198ce7" },
  ".dart": { label: "DA", color: "#00b4ab" },
  ".ex": { label: "EX", color: "#6e4a7e" },
  ".exs": { label: "EX", color: "#6e4a7e" },
  ".erl": { label: "ER", color: "#b83998" },
  ".hs": { label: "HS", color: "#5e5086" },
  ".ml": { label: "ML", color: "#3be133" },
  ".clj": { label: "CJ", color: "#db5855" },
  ".scala": { label: "SC", color: "#c22d40" },
};

function getFileIcon(name: string): { label: string; color: string } {
  const lower = name.toLowerCase();
  // Special filenames
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return FILE_ICONS[".dockerfile"]!;
  if (lower === ".gitignore") return FILE_ICONS[".gitignore"]!;
  if (lower === ".env" || lower.startsWith(".env.")) return FILE_ICONS[".env"]!;
  const ext = lower.slice(lower.lastIndexOf("."));
  return FILE_ICONS[ext] || { label: "··", color: "#888888" };
}

function FileIcon({ name }: { name: string }) {
  const { label, color } = getFileIcon(name);

  return (
    <span
      className="inline-flex items-center justify-center w-5 h-3.5 shrink-0 rounded text-[8px] font-bold leading-none"
      style={{ background: color, color: "#fff", opacity: 0.9 }}
    >
      {label}
    </span>
  );
}

function FileIconLegacy({ name }: { name: string }) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  let color = "text-[var(--on-surface-variant)]";
  if ([".ts", ".tsx"].includes(ext)) color = "text-[var(--primary)]";

  return (
    <svg className={`w-3.5 h-3.5 shrink-0 ${color}`} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function FileSidebar({ files, selectedFile, onSelectFile }: FileSidebarProps) {
  const t = useTranslations();

  const tree = useMemo(() => {
    const raw = buildTree(files);
    return collapseTree(raw);
  }, [files]);

  if (files.length === 0) {
    return (
      <div className="w-64 p-4" style={{ borderRight: "1px solid var(--outline-variant)" }}>
        <p className="text-sm" style={{ color: "var(--outline)" }}>{t("review.noChanges")}</p>
      </div>
    );
  }

  // Group by task if task info is available
  const hasTaskInfo = files.some(f => f.taskTitle);

  if (hasTaskInfo) {
    const taskGroups = new Map<string, { title: string; order: number; files: FileEntry[] }>();
    for (const file of files) {
      const key = file.taskTitle || "Other";
      if (!taskGroups.has(key)) {
        taskGroups.set(key, { title: key, order: file.taskOrder || 999, files: [] });
      }
      taskGroups.get(key)!.files.push(file);
    }
    const sorted = [...taskGroups.values()].sort((a, b) => a.order - b.order);

    return (
      <div className="w-64 overflow-y-auto" style={{ background: "var(--surface-container-high)", borderRight: "1px solid var(--outline-variant)" }}>
        <div className="p-3" style={{ background: "var(--background)", borderBottom: "1px solid var(--outline-variant)" }}>
          <h5 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--outline)" }}>
            {t("review.changedFiles")}
          </h5>
          <span className="text-[10px]" style={{ color: "var(--outline)" }}>{files.length} files · {sorted.length} tasks</span>
        </div>
        {sorted.map((group) => (
          <div key={group.title}>
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--outline)", background: "var(--background)", borderBottom: "1px solid var(--outline-variant)" }}>
              #{group.order} {group.title}
              <span className="ml-1 font-normal">({group.files.length})</span>
            </div>
            {group.files.map((file) => (
              <FileLeaf
                key={file.filePath}
                file={file}
                name={file.filePath.split("/").pop() || file.filePath}
                isActive={selectedFile === file.filePath}
                onSelect={() => onSelectFile(file.filePath)}
                depth={0}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="w-64 overflow-y-auto" style={{ background: "var(--surface-container-high)", borderRight: "1px solid var(--outline-variant)" }}>
      <div className="p-3" style={{ background: "var(--background)", borderBottom: "1px solid var(--outline-variant)" }}>
        <h5 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--outline)" }}>
          {t("review.changedFiles")}
        </h5>
        <span className="text-[10px]" style={{ color: "var(--outline)" }}>{files.length} files</span>
      </div>
      <div className="py-1">
        <DirNode
          node={tree}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          depth={0}
        />
      </div>
    </div>
  );
}
