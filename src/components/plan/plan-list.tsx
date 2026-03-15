"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PlanCard } from "./plan-card";
import { CreatePlanDialog } from "./create-plan-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface Plan {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: string;
  tag: string | null;
  folderId: string | null;
  updatedAt: string;
}

interface Folder {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
}

interface PlanListProps {
  projectId: string;
  locale: string;
}

export function PlanList({ projectId, locale }: PlanListProps) {
  const t = useTranslations();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<Folder[]>([]);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importPath, setImportPath] = useState("");

  const fetchContents = async (folderId: string | null) => {
    const params = new URLSearchParams({ projectId });
    if (folderId) params.set("parentId", folderId);

    const res = await fetch(`/api/plan-folders?${params}`);
    const data = await res.json();
    setFolders(data.folders);
    setPlans(data.plans);
  };

  useEffect(() => {
    fetchContents(currentFolderId);
  }, [projectId, currentFolderId]);

  const navigateToFolder = (folder: Folder) => {
    setFolderPath((prev) => [...prev, folder]);
    setCurrentFolderId(folder.id);
  };

  const navigateUp = () => {
    const newPath = folderPath.slice(0, -1);
    setFolderPath(newPath);
    setCurrentFolderId(newPath.length > 0 ? newPath[newPath.length - 1].id : null);
  };

  const navigateToRoot = () => {
    setFolderPath([]);
    setCurrentFolderId(null);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName) return;
    await fetch("/api/plan-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        name: newFolderName,
        parentId: currentFolderId,
      }),
    });
    setNewFolderName("");
    setFolderDialogOpen(false);
    fetchContents(currentFolderId);
  };

  const handleDeleteFolder = async (folderId: string) => {
    await fetch(`/api/plan-folders/${folderId}`, { method: "DELETE" });
    fetchContents(currentFolderId);
  };

  const handleCreatePlan = async (data: {
    name: string;
    description: string;
    tag: string;
  }) => {
    await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        projectId,
        folderId: currentFolderId,
      }),
    });
    fetchContents(currentFolderId);
  };

  const handleDeletePlan = async (id: string) => {
    await fetch(`/api/plans/${id}`, { method: "DELETE" });
    fetchContents(currentFolderId);
  };

  const handleImport = async () => {
    if (!importPath) return;
    await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, filePath: importPath }),
    });
    setImportPath("");
    setImportDialogOpen(false);
    fetchContents(currentFolderId);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold">{t("plan.title")}</h2>
          {/* Breadcrumb */}
          {folderPath.length > 0 && (
            <div className="flex items-center gap-1 text-sm text-gray-500 ml-2">
              <button
                onClick={navigateToRoot}
                className="hover:text-blue-600"
              >
                /
              </button>
              {folderPath.map((f, i) => (
                <span key={f.id} className="flex items-center gap-1">
                  <span>/</span>
                  <button
                    onClick={() => {
                      setFolderPath(folderPath.slice(0, i + 1));
                      setCurrentFolderId(f.id);
                    }}
                    className="hover:text-blue-600"
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setImportDialogOpen(true)}
          >
            {locale === "zh" ? "导入" : "Import"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setFolderDialogOpen(true)}
          >
            {locale === "zh" ? "+ 文件夹" : "+ Folder"}
          </Button>
          <Button onClick={() => setPlanDialogOpen(true)}>
            {t("plan.create")}
          </Button>
        </div>
      </div>

      {currentFolderId && (
        <button
          onClick={navigateUp}
          className="text-sm text-blue-600 hover:underline mb-3 block"
        >
          &larr; ..
        </button>
      )}

      {/* Folders */}
      {folders.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="rounded-lg border bg-white p-3 flex items-center justify-between hover:shadow-sm cursor-pointer"
              onClick={() => navigateToFolder(folder)}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">📁</span>
                <span className="font-medium text-sm">{folder.name}</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete folder "${folder.name}"?`)) {
                    handleDeleteFolder(folder.id);
                  }
                }}
                className="text-gray-400 hover:text-red-500 text-xs"
              >
                {t("common.delete")}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Plans */}
      {plans.length === 0 && folders.length === 0 ? (
        <p className="text-gray-500 text-center py-12">
          {t("common.noData")}
        </p>
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              locale={locale}
              onDelete={handleDeletePlan}
            />
          ))}
        </div>
      )}

      <CreatePlanDialog
        open={planDialogOpen}
        onClose={() => setPlanDialogOpen(false)}
        onSubmit={handleCreatePlan}
      />

      {/* Create Folder Dialog */}
      <Dialog
        open={folderDialogOpen}
        onClose={() => setFolderDialogOpen(false)}
        title={locale === "zh" ? "新建文件夹" : "New Folder"}
      >
        <div className="space-y-4">
          <Input
            label={locale === "zh" ? "文件夹名称" : "Folder Name"}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setFolderDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleCreateFolder} disabled={!newFolderName}>
              {t("common.create")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Import Dialog */}
      <Dialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        title={locale === "zh" ? "从 Markdown 导入计划" : "Import Plan from Markdown"}
      >
        <div className="space-y-4">
          <Input
            label="Markdown File Path"
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
            placeholder="/path/to/plan.md"
            required
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setImportDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleImport} disabled={!importPath}>
              {locale === "zh" ? "导入" : "Import"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
