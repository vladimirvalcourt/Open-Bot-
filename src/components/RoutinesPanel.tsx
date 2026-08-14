import { useCallback, useEffect, useState } from "react";
import { Clock3, Loader2, Play, Plus, Trash2, X } from "./icons";
import { api, useStore } from "@/state/store";
import { systemText } from "@/lib/presentation";

interface Routine {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  cadence: "once" | "hourly" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
  timezone?: string;
  at?: string;
  enabled: boolean;
  nextRunAt: number;
  lastStatus?: "started" | "succeeded" | "failed";
  lastError?: string;
}

export function RoutinesPanel() {
  const { state, dispatch } = useStore();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [botId, setBotId] = useState(state.selectedId || state.bots[0]?.id || "");
  const [cadence, setCadence] = useState<Routine["cadence"]>("daily");
  const [at, setAt] = useState("09:00");
  const [triggerType, setTriggerType] = useState<"schedule" | "email" | "webhook">("schedule");
  const [triggerFilter, setTriggerFilter] = useState("");
  const [triggerUrl, setTriggerUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api("/api/routines").then((result) => setRoutines(result.routines ?? [])), []);
  useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);

  const create = () => {
    setBusy(true); setError(null);
    api("/api/routines", { method: "POST", body: JSON.stringify({ botId, name, prompt, cadence, at, triggerType, triggerFilter, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) })
      .then((result) => { setName(""); setPrompt(""); setTriggerFilter(""); setTriggerUrl(result.triggerUrl ?? ""); return load(); })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40" onClick={() => dispatch({ type: "toggleRoutines", open: false })}>
      <div className="flex max-h-[82%] w-[620px] flex-col rounded-2xl border border-hairline/50 bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div><div className="text-[17px] font-semibold text-ink">Routines</div><div className="text-[13px] text-ink-secondary">Send a prompt to a bot on a recurring schedule.</div></div>
          <button onClick={() => dispatch({ type: "toggleRoutines", open: false })} className="p-1 text-ink-secondary"><X size={18} /></button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-hairline/40 bg-card p-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Routine name" className="rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none" />
          <select value={botId} onChange={(e) => setBotId(e.target.value)} className="rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none">{state.bots.filter((b) => !b.hidden).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should the bot do?" className="col-span-2 min-h-20 resize-none rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none" />
          <select value={triggerType} onChange={(event) => setTriggerType(event.target.value as typeof triggerType)} className="rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none"><option value="schedule">Schedule</option><option value="email">Email trigger</option><option value="webhook">Webhook</option></select>
          {triggerType === "schedule" ? <div /> : <input value={triggerFilter} onChange={(event) => setTriggerFilter(event.target.value)} placeholder={triggerType === "email" ? "Optional sender/subject filter" : "Optional event description"} className="rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none" />}
          <select value={cadence} onChange={(e) => setCadence(e.target.value as Routine["cadence"])} className="rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none"><option value="once">Run once</option><option value="hourly">Every hour</option><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Every week</option><option value="monthly">Every month</option><option value="yearly">Every year</option></select>
          <input type="time" value={at} onChange={(event) => setAt(event.target.value)} disabled={cadence === "hourly"} className="rounded-lg bg-inset px-3 py-2 text-[13px] text-ink outline-none disabled:opacity-40" />
          <button disabled={busy || !name.trim() || !prompt.trim() || !botId} onClick={create} className="col-span-2 flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add routine</button>
        </div>
        {error && <div className="mt-2 text-[12px] text-danger">{systemText(error)}</div>}
        {triggerUrl && <button onClick={() => void navigator.clipboard.writeText(`${location.origin}${triggerUrl}`)} className="mt-2 w-full truncate rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-left font-mono text-[11px] text-warning" title="Copy trigger URL">Copy trigger URL: {triggerUrl}</button>}
        <div className="mt-3 min-h-0 overflow-y-auto rounded-xl border border-hairline/40">
          {routines.map((routine) => {
            const bot = state.bots.find((b) => b.id === routine.botId);
            const lastError = routine.lastError ? systemText(routine.lastError) : undefined;
            return <div key={routine.id} className="flex items-center gap-3 border-b border-hairline/30 bg-card px-4 py-3 last:border-b-0">
              <Clock3 size={17} className="text-ink-secondary" />
              <div className="min-w-0 flex-1"><div className="text-[14px] font-medium text-ink">{routine.name}</div><div className="truncate text-[12px] text-ink-secondary">{bot?.name ?? "Deleted bot"} · {routine.cadence} · next {new Date(routine.nextRunAt).toLocaleString()}</div>{routine.lastStatus === "failed" && <div className="truncate text-[11px] text-danger">{lastError}</div>}</div>
              <button onClick={() => api(`/api/routines/${routine.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !routine.enabled }) }).then(load)} className="rounded-md bg-raised px-2 py-1 text-[11px] text-ink">{routine.enabled ? "On" : "Off"}</button>
              <button title="Run now" onClick={() => api(`/api/routines/${routine.id}/run`, { method: "POST" }).then(load).catch((e) => setError(e.message))} className="p-1.5 text-ink-secondary hover:text-ink"><Play size={15} /></button>
              <button title="Delete" onClick={() => api(`/api/routines/${routine.id}`, { method: "DELETE" }).then(load)} className="p-1.5 text-ink-secondary hover:text-danger"><Trash2 size={15} /></button>
            </div>;
          })}
          {routines.length === 0 && <div className="py-8 text-center text-[13px] text-ink-secondary">No routines yet.</div>}
        </div>
      </div>
    </div>
  );
}
