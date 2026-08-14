import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { newId } from "./contracts.ts";

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  knowledgeSources?: ProjectKnowledgeSource[];
}

export interface ProjectKnowledgeSource {
  id: string;
  title: string;
  kind: "url" | "file" | "note";
  location: string;
  note?: string;
  addedAt: number;
  lastVerifiedAt?: number;
}

interface ProjectData { version: 1; projects: ProjectRecord[] }
const FILE = join(DATA_DIR, "projects.json");

export class ProjectStore {
  data: ProjectData;

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });
    try {
      const value = JSON.parse(readFileSync(FILE, "utf8"));
      this.data = { version: 1, projects: Array.isArray(value.projects) ? value.projects.map((project: ProjectRecord) => ({ ...project, knowledgeSources: Array.isArray(project.knowledgeSources) ? project.knowledgeSources : [] })) : [] };
    } catch {
      this.data = { version: 1, projects: [] };
    }
    if (!this.data.projects.some((item) => item.id === "default")) {
      const now = Date.now();
      this.data.projects.unshift({ id: "default", name: "General", createdAt: now, updatedAt: now });
      this.save();
    }
  }

  private save() {
    const temp = `${FILE}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(temp, FILE);
    try { chmodSync(FILE, 0o600); } catch {}
  }

  list() { return this.data.projects.filter((item) => !item.archived); }
  get(id: string) { return this.data.projects.find((item) => item.id === id) ?? null; }
  create(name: string, description?: string) {
    const now = Date.now();
    const project: ProjectRecord = { id: newId(), name, description, createdAt: now, updatedAt: now };
    this.data.projects.unshift(project); this.save(); return project;
  }
  patch(id: string, patch: Pick<Partial<ProjectRecord>, "name" | "description" | "archived">) {
    const project = this.get(id); if (!project || id === "default" && patch.archived) return null;
    Object.assign(project, patch, { updatedAt: Date.now() }); this.save(); return project;
  }
  addKnowledge(projectId: string, input: Pick<ProjectKnowledgeSource, "title" | "kind" | "location"> & { note?: string }) {
    const project = this.get(projectId); if (!project) return null;
    const source: ProjectKnowledgeSource = {
      id: newId(), title: input.title.trim().slice(0, 200), kind: input.kind,
      location: input.location.trim().slice(0, 2000), note: input.note?.trim().slice(0, 2000), addedAt: Date.now(),
    };
    project.knowledgeSources ??= []; project.knowledgeSources.unshift(source); project.updatedAt = Date.now(); this.save(); return source;
  }
  verifyKnowledge(projectId: string, sourceId: string) {
    const project = this.get(projectId); const source = project?.knowledgeSources?.find((item) => item.id === sourceId); if (!source) return null;
    source.lastVerifiedAt = Date.now(); project!.updatedAt = Date.now(); this.save(); return source;
  }
  deleteKnowledge(projectId: string, sourceId: string) {
    const project = this.get(projectId); if (!project) return false;
    const before = project.knowledgeSources?.length ?? 0; project.knowledgeSources = (project.knowledgeSources ?? []).filter((item) => item.id !== sourceId);
    if (project.knowledgeSources.length === before) return false; project.updatedAt = Date.now(); this.save(); return true;
  }
}
