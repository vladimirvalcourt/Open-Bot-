import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { newId } from "./contracts.ts";

export type TaskStatus = "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
export type TaskSource = "chat" | "routine" | "group" | "manual" | "trigger";

export interface WorkTask {
  id: string;
  botId: string;
  title: string;
  prompt: string;
  source: TaskSource;
  sourceId?: string;
  groupId?: string;
  projectId: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  currentRunId?: string;
  idempotencyKey?: string;
}

export interface WorkRun {
  id: string;
  taskId: string;
  botId: string;
  threadId: string;
  status: TaskStatus;
  attempt: number;
  startedAt?: number;
  finishedAt?: number;
  output?: string;
  error?: string;
  inputTokens: number;
  outputTokens: number;
  cost?: number;
  toolCalls: ToolOutcome[];
  checkpointIds: string[];
  interrupted?: boolean;
  resumable?: boolean;
}

export interface ToolOutcome {
  id: string;
  name: string;
  status: "running" | "completed" | "failed" | "cancelled";
  summary: string;
  startedAt: number;
  finishedAt?: number;
  mutated?: boolean;
  evidence?: { urls?: string[]; files?: string[]; screenshots?: string[] };
  checkpointId?: string;
}

export interface RunCheckpoint {
  id: string;
  runId: string;
  projectId: string;
  kind: "browser" | "computer" | "files" | "config";
  createdAt: number;
  label: string;
  reversible: boolean;
  stateBefore?: unknown;
}

export interface ApprovalRecord {
  id: string;
  requestId: string;
  botId: string;
  threadId: string;
  runId?: string;
  type: "permission" | "question";
  tool: string;
  summary: string;
  choices?: string[];
  status: "pending" | "resolved";
  resolution?: string;
  openedAt: number;
  resolvedAt?: number;
}

export interface AuditRecord {
  id: string;
  at: number;
  actor: "user" | "bot" | "system";
  action: string;
  botId?: string;
  taskId?: string;
  runId?: string;
  detail?: string;
  ok?: boolean;
}

interface WorkData {
  version: 2;
  tasks: WorkTask[];
  runs: WorkRun[];
  approvals: ApprovalRecord[];
  audit: AuditRecord[];
  checkpoints: RunCheckpoint[];
}

const FILE = join(DATA_DIR, "work.json");
const EMPTY: WorkData = { version: 2, tasks: [], runs: [], approvals: [], audit: [], checkpoints: [] };

function load(): WorkData {
  try {
    const value = JSON.parse(readFileSync(FILE, "utf8"));
    return {
      version: 2,
      tasks: Array.isArray(value.tasks) ? value.tasks.map((item: WorkTask) => ({ ...item, projectId: item.projectId ?? "default" })) : [],
      runs: Array.isArray(value.runs) ? value.runs.map((item: WorkRun) => ({
        ...item, checkpointIds: Array.isArray(item.checkpointIds) ? item.checkpointIds : [],
        toolCalls: Array.isArray(item.toolCalls) ? item.toolCalls.map((tool: any) => tool.id ? tool : ({ id: newId(), name: tool.name ?? "tool", status: tool.ok === false ? "failed" : tool.ok === true ? "completed" : "running", summary: tool.name ?? "tool", startedAt: tool.at ?? Date.now(), ...(tool.ok !== undefined ? { finishedAt: tool.at ?? Date.now() } : {}) })) : [],
      })) : [],
      approvals: Array.isArray(value.approvals) ? value.approvals : [],
      audit: Array.isArray(value.audit) ? value.audit : [],
      checkpoints: Array.isArray(value.checkpoints) ? value.checkpoints : [],
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

export class WorkStore {
  data = load();

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });
    // A process restart cannot leave work pretending to be live. Preserve the
    // record and make the interruption explicit so it can be retried.
    const now = Date.now();
    let changed = false;
    for (const run of this.data.runs) {
      if (["queued", "running", "waiting"].includes(run.status)) {
        run.status = "failed";
        run.error = "OpenMausBot stopped before this run finished; retry resumes from durable task context but will re-observe external state first";
        run.interrupted = true;
        run.resumable = true;
        run.finishedAt = now;
        const task = this.data.tasks.find((item) => item.id === run.taskId);
        if (task) { task.status = "failed"; task.updatedAt = now; }
        changed = true;
      }
    }
    if (changed) this.save();
  }

  private save() {
    const temp = `${FILE}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(temp, FILE);
    try { chmodSync(FILE, 0o600); } catch {}
  }

  createTask(input: Pick<WorkTask, "botId" | "title" | "prompt" | "source"> & Partial<Pick<WorkTask, "sourceId" | "groupId" | "projectId" | "idempotencyKey">>) {
    const now = Date.now();
    const task: WorkTask = { id: newId(), status: "queued", projectId: input.projectId ?? "default", createdAt: now, updatedAt: now, ...input };
    this.data.tasks.unshift(task);
    this.audit("system", "task.created", { botId: task.botId, taskId: task.id, detail: task.title }, false);
    this.save();
    return task;
  }

  startRun(taskId: string, threadId: string) {
    const task = this.data.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("no such task");
    const attempt = this.data.runs.filter((item) => item.taskId === taskId).length + 1;
    const run: WorkRun = {
      id: newId(), taskId, botId: task.botId, threadId, status: "running", attempt,
      startedAt: Date.now(), inputTokens: 0, outputTokens: 0, toolCalls: [], checkpointIds: [],
    };
    task.status = "running"; task.currentRunId = run.id; task.updatedAt = Date.now();
    this.data.runs.unshift(run);
    this.audit("system", "run.started", { botId: task.botId, taskId, runId: run.id }, false);
    this.save();
    return run;
  }

  appendOutput(runId: string, text: string) {
    const run = this.run(runId);
    if (!run || !text) return;
    run.output = `${run.output ?? ""}${run.output ? "\n" : ""}${text}`;
    this.save();
  }

  usage(runId: string, input: number, output: number) {
    const run = this.run(runId); if (!run) return;
    run.inputTokens = Math.max(run.inputTokens, input); run.outputTokens = Math.max(run.outputTokens, output); this.save();
  }

  tool(runId: string, name: string, ok?: boolean, detail?: Partial<Pick<ToolOutcome, "summary" | "mutated" | "evidence" | "checkpointId">>) {
    const run = this.run(runId); if (!run) return;
    if (ok === undefined) run.toolCalls.push({ id: newId(), name, status: "running", summary: detail?.summary ?? name, startedAt: Date.now(), ...detail });
    else {
      const pending = [...run.toolCalls].reverse().find((item) => item.status === "running" && (item.name === name || name === "tool"));
      if (pending) Object.assign(pending, detail, { status: ok ? "completed" : "failed", finishedAt: Date.now() });
      else run.toolCalls.push({ id: newId(), name, status: ok ? "completed" : "failed", summary: detail?.summary ?? name, startedAt: Date.now(), finishedAt: Date.now(), ...detail });
    }
    this.save();
  }

  checkpoint(runId: string, input: Omit<RunCheckpoint, "id" | "runId" | "projectId" | "createdAt">) {
    const run = this.run(runId); if (!run) return null;
    const task = this.task(run.taskId); if (!task) return null;
    const checkpoint: RunCheckpoint = { id: newId(), runId, projectId: task.projectId, createdAt: Date.now(), ...input };
    this.data.checkpoints.unshift(checkpoint); run.checkpointIds.push(checkpoint.id);
    if (this.data.checkpoints.length > 1000) this.data.checkpoints.length = 1000;
    this.save(); return checkpoint;
  }

  waiting(runId: string) {
    const run = this.run(runId); if (!run) return;
    run.status = "waiting";
    const task = this.task(run.taskId); if (task) { task.status = "waiting"; task.updatedAt = Date.now(); }
    this.save();
  }
  resume(runId: string) { const run = this.run(runId); if (!run || run.status !== "waiting") return; run.status = "running"; const task = this.task(run.taskId); if (task) { task.status = "running"; task.updatedAt = Date.now(); } this.save(); }

  finish(runId: string, ok: boolean, error?: string, cost?: number | null) {
    const run = this.run(runId); if (!run || ["succeeded", "failed", "cancelled"].includes(run.status)) return run;
    run.status = ok ? "succeeded" : error === "interrupted" ? "cancelled" : "failed";
    run.error = ok ? undefined : error || "The provider reported a failed turn";
    run.finishedAt = Date.now();
    if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) run.cost = cost;
    const task = this.task(run.taskId);
    if (task) { task.status = run.status; task.updatedAt = Date.now(); }
    this.audit("system", `run.${run.status}`, { botId: run.botId, taskId: run.taskId, runId, detail: run.error, ok }, false);
    this.save();
    return run;
  }

  openApproval(input: Omit<ApprovalRecord, "id" | "status" | "openedAt">) {
    const existing = this.data.approvals.find((item) => item.requestId === input.requestId);
    if (existing) return existing;
    const record: ApprovalRecord = { id: newId(), status: "pending", openedAt: Date.now(), ...input };
    this.data.approvals.unshift(record); this.save(); return record;
  }

  resolveApproval(requestId: string, resolution: string) {
    const record = this.data.approvals.find((item) => item.requestId === requestId);
    if (!record) return null;
    record.status = "resolved"; record.resolution = resolution; record.resolvedAt = Date.now(); this.save(); return record;
  }

  audit(actor: AuditRecord["actor"], action: string, fields: Partial<Omit<AuditRecord, "id" | "at" | "actor" | "action">> = {}, save = true) {
    const item: AuditRecord = { id: newId(), at: Date.now(), actor, action, ...fields };
    this.data.audit.unshift(item);
    if (this.data.audit.length > 5000) this.data.audit.length = 5000;
    if (save) this.save();
    return item;
  }

  task(id: string) { return this.data.tasks.find((item) => item.id === id) ?? null; }
  taskByIdempotency(botId: string, key: string) { return this.data.tasks.find((item) => item.botId === botId && item.idempotencyKey === key) ?? null; }
  run(id: string) { return this.data.runs.find((item) => item.id === id) ?? null; }
  checkpointById(id: string) { return this.data.checkpoints.find((item) => item.id === id) ?? null; }
  runForThread(threadId: string) { return this.data.runs.find((item) => item.threadId === threadId && ["running", "waiting"].includes(item.status)) ?? null; }
  retryTask(id: string) {
    const task = this.task(id); if (!task) return null;
    task.status = "queued"; task.updatedAt = Date.now(); this.save(); return task;
  }
}
