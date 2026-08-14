import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Clock3, FolderPlus, Loader2, RefreshCw, RotateCcw, ShieldCheck, X } from "./icons";
import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { presentSystemFields, systemLabel, systemText } from "@/lib/presentation";

interface Task { id: string; botId: string; projectId: string; title: string; source: string; displaySource?: string; groupId?: string; status: string; displayStatus?: string; updatedAt: number; currentRunId?: string }
interface ToolOutcome { id: string; name: string; status: string; summary: string; mutated?: boolean; checkpointId?: string }
interface Run { id: string; taskId: string; status: string; attempt: number; output?: string; error?: string; startedAt?: number; finishedAt?: number; inputTokens: number; outputTokens: number; toolCalls?: ToolOutcome[]; checkpointIds?: string[]; interrupted?: boolean; resumable?: boolean }
interface Approval { id: string; botId: string; type: "permission" | "question"; tool: string; summary: string; choices?: string[]; status: string; openedAt: number }
interface Project { id: string; name: string; description?: string; botCount: number; taskCount: number }

const statusIcon = (status: string) => status === "succeeded" ? <Check size={14} className="text-success" /> : status === "failed" || status === "cancelled" ? <AlertCircle size={14} className="text-danger" /> : status === "waiting" ? <ShieldCheck size={14} className="text-warning" /> : status === "running" ? <Loader2 size={14} className="animate-spin text-accent" /> : <Clock3 size={14} className="text-ink-secondary" />;

export function WorkPanel() {
  const { state, dispatch } = useStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState("all");
  const [newProject, setNewProject] = useState("");
  const [tab, setTab] = useState<"tasks" | "approvals">("tasks");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => Promise.all([api("/api/work"), api("/api/projects")]).then(([value, scoped]) => {
    setTasks((value.tasks ?? []).map((task: Task) => presentSystemFields(task)));
    setRuns((value.runs ?? []).map((run: Run) => ({
      ...run,
      error: run.error ? systemText(run.error) : undefined,
      toolCalls: run.toolCalls?.map((tool) => ({ ...tool, summary: systemLabel(tool.summary, "Activity") })),
    })));
    setApprovals((value.approvals ?? []).map((approval: Approval) => ({
      ...approval,
      tool: systemLabel(approval.tool, "Action"),
      summary: systemText(approval.summary),
    })));
    setProjects(scoped.projects ?? []);
  }), []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 4000); return () => clearInterval(timer); }, [load]);
  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const pending = approvals.filter((item) => item.status === "pending");
  const visibleTasks = projectFilter === "all" ? tasks : tasks.filter((task) => task.projectId === projectFilter);
  const createProject = async () => {
    const name = newProject.trim(); if (!name) return;
    setBusy("new-project"); setError("");
    try { await api("/api/projects", { method: "POST", body: JSON.stringify({ name }) }); setNewProject(""); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };
  const respond = async (approval: Approval, behavior: "allow" | "deny" | "answer", message?: string) => {
    setBusy(approval.id); setError("");
    try { await api(`/api/work/approvals/${approval.id}/respond`, { method: "POST", body: JSON.stringify({ behavior, message }) }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };
  return <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45" onClick={() => dispatch({ type: "toggleWork", open: false })}>
    <div className="flex max-h-[84%] w-[760px] flex-col overflow-hidden rounded-2xl border border-hairline/50 bg-panel shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between px-5 pt-5"><div><div className="text-[18px] font-semibold text-ink">Work</div><div className="text-[13px] text-ink-secondary">Tasks, completed runs, failures, and decisions that need you.</div></div><div className="flex gap-1"><button onClick={() => void load()} className="p-2 text-ink-secondary hover:text-ink"><RefreshCw size={16} /></button><button onClick={() => dispatch({ type: "toggleWork", open: false })} className="p-2 text-ink-secondary hover:text-ink"><X size={18} /></button></div></div>
      <div className="mt-4 flex gap-1 border-b border-hairline/40 px-5">{(["tasks", "approvals"] as const).map((value) => <button key={value} onClick={() => setTab(value)} className={cn("border-b-2 px-3 py-2 text-[13px] capitalize", tab === value ? "border-accent text-ink" : "border-transparent text-ink-secondary")}>{value}{value === "approvals" && pending.length ? ` (${pending.length})` : ""}</button>)}</div>
      {error && <div className="mx-5 mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{systemText(error)}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tab === "tasks" ? <div className="flex flex-col gap-3"><div className="flex gap-2"><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="min-w-0 flex-1 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink"><option value="all">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.taskCount} tasks</option>)}</select><input value={newProject} onChange={(event) => setNewProject(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void createProject()} placeholder="New project" className="w-44 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink outline-none"/><button disabled={!newProject.trim() || busy === "new-project"} onClick={() => void createProject()} title="Create project" className="rounded-lg bg-raised px-2.5 text-ink disabled:opacity-40"><FolderPlus size={15}/></button></div>{visibleTasks.map((task) => { const run = task.currentRunId ? runById.get(task.currentRunId) : undefined; const bot = state.bots.find((item) => item.id === task.botId); const project = projects.find((item) => item.id === task.projectId); return <div key={task.id} className="rounded-xl border border-hairline/40 bg-card p-4"><div className="flex items-start gap-3">{statusIcon(task.status)}<div className="min-w-0 flex-1"><div className="text-[14px] font-medium text-ink">{task.title}</div><div className="mt-0.5 text-[12px] text-ink-secondary">{project?.name ?? "General"} · {bot?.name ?? "Deleted bot"} · {task.source} · {task.status}{run ? ` · attempt ${run.attempt}` : ""}</div>{run?.interrupted && <div className="mt-2 rounded-md bg-warning/10 px-2 py-1.5 text-[11px] text-warning">Interrupted by restart. Retry will re-observe external state before continuing.</div>}{run?.toolCalls?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{run.toolCalls.slice(-8).map((tool) => <span key={tool.id} className={cn("rounded-md bg-inset px-2 py-1 text-[11px]", tool.status === "failed" ? "text-danger" : tool.status === "completed" ? "text-success" : "text-ink-secondary")}>{tool.summary}{tool.checkpointId ? " · checkpoint" : ""}</span>)}</div> : null}{run?.checkpointIds?.length ? <div className="mt-2 text-[11px] text-ink-secondary">{run.checkpointIds.length} recovery checkpoint{run.checkpointIds.length === 1 ? "" : "s"} recorded</div> : null}{run?.output && <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-[12px] text-ink-secondary">{run.output}</div>}{run?.error && <div className="mt-2 text-[12px] text-danger">{run.error}</div>}</div>{["failed", "cancelled"].includes(task.status) && <button disabled={busy === task.id} onClick={() => { setBusy(task.id); api(`/api/work/tasks/${task.id}/retry`, { method: "POST" }).then(load).catch((reason) => setError(reason.message)).finally(() => setBusy(null)); }} className="flex items-center gap-1 rounded-lg bg-raised px-2.5 py-1.5 text-[12px] text-ink"><RotateCcw size={13} /> Retry</button>}</div></div>; })}{!visibleTasks.length && <div className="py-12 text-center text-[13px] text-ink-secondary">No work has run in this project yet.</div>}</div>
        : <div className="flex flex-col gap-2">{pending.map((approval) => { const bot = state.bots.find((item) => item.id === approval.botId); return <div key={approval.id} className="rounded-xl border border-warning/30 bg-card p-4"><div className="text-[14px] font-medium text-ink">{bot?.name ?? "Bot"} · {approval.tool}</div><div className="mt-1 text-[13px] text-ink-secondary">{approval.summary}</div><div className="mt-3 flex flex-wrap gap-2">{approval.type === "permission" ? <><button disabled={busy === approval.id} onClick={() => void respond(approval, "allow")} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] text-white">Allow</button><button disabled={busy === approval.id} onClick={() => void respond(approval, "deny")} className="rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink">Deny</button></> : (approval.choices ?? []).map((choice) => <button key={choice} disabled={busy === approval.id} onClick={() => void respond(approval, "answer", choice)} className="rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink">{choice}</button>)}</div></div>; })}{!pending.length && <div className="py-12 text-center text-[13px] text-ink-secondary">Nothing needs your approval.</div>}</div>}
      </div>
    </div>
  </div>;
}
