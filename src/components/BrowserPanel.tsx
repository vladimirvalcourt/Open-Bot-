import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Circle, ExternalLink, Globe2, RefreshCw, Square, X } from "./icons";
import { api, useStore, type Bot } from "@/state/store";
import { systemText } from "@/lib/presentation";

export function BrowserPanel({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const bridge = window.ogb?.browser;
  const host = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("https://www.google.com");
  const [error, setError] = useState<string | null>(null);
  const [teaching, setTeaching] = useState(false);

  useEffect(() => {
    if (!bridge || !host.current) return;
    let alive = true;
    const update = () => {
      const rect = host.current!.getBoundingClientRect();
      void bridge.show(bot.id, url, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
        .then((result) => {
          if (!alive) return;
          setUrl(result.url);
          setError(null);
        })
        .catch((e) => alive && setError(e.message));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host.current);
    window.addEventListener("resize", update);
    return () => { alive = false; observer.disconnect(); window.removeEventListener("resize", update); void bridge.hide(bot.id); };
  }, [bot.id, bridge]);

  const navigate = () => {
    setError(null);
    bridge?.navigate(bot.id, url).then((result) => setUrl(result.url)).catch((e) => setError(e.message));
  };
  const close = () => { void bridge?.hide(bot.id); dispatch({ type: "toggleBrowser", open: false }); };
  const toggleTeach = async () => {
    if (!bridge) return;
    if (!teaching) { await bridge.teachStart(bot.id); setTeaching(true); return; }
    const { steps } = await bridge.teachStop(bot.id); setTeaching(false);
    if (!steps.length) return setError("No browser actions were recorded.");
    const name = window.prompt("Name this taught routine", `Workflow for ${new URL(url).hostname}`)?.trim();
    if (!name) return;
    const prompt = `Repeat this browser workflow carefully. Values marked <input> are variables: ask the user when needed. Take a fresh accessibility snapshot before each action and stop for approval if the page differs.\n\n${steps.map((step, index) => `${index + 1}. ${step.action}${step.url ? ` on ${step.url}` : ""}${step.ref ? ` using element reference ${step.ref}` : ""}${step.value ? ` with value ${step.value}` : ""}`).join("\n")}`;
    await api("/api/routines", { method: "POST", body: JSON.stringify({ botId: bot.id, name, prompt, cadence: "once", enabled: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
  };

  return <aside className="flex h-full w-[520px] shrink-0 flex-col border-l border-hairline/40 bg-panel">
    <div className="flex items-center gap-2 border-b border-hairline/40 p-2">
      <button onClick={() => bridge?.action(bot.id, "back")} className="p-1.5 text-ink-secondary hover:text-ink"><ArrowLeft size={16} /></button>
      <button onClick={() => bridge?.action(bot.id, "forward")} className="p-1.5 text-ink-secondary hover:text-ink"><ArrowRight size={16} /></button>
      <button onClick={() => bridge?.action(bot.id, "reload")} className="p-1.5 text-ink-secondary hover:text-ink"><RefreshCw size={15} /></button>
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-inset px-2.5"><Globe2 size={14} className="text-ink-secondary" /><input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && navigate()} className="min-w-0 flex-1 bg-transparent py-2 text-[12px] text-ink outline-none" /></div>
      <button onClick={() => window.open(url)} title="Open externally" className="p-1.5 text-ink-secondary hover:text-ink"><ExternalLink size={15} /></button>
      <button onClick={() => void toggleTeach()} title={teaching ? "Stop teaching and save" : "Teach a task"} className={teaching ? "rounded-md bg-danger/20 p-1.5 text-danger" : "p-1.5 text-ink-secondary hover:text-ink"}>{teaching ? <Square size={14} className="fill-current" /> : <Circle size={14} />}</button>
      <button onClick={close} className="p-1.5 text-ink-secondary hover:text-ink"><X size={17} /></button>
    </div>
    {error && <div className="bg-danger/10 px-3 py-2 text-[12px] text-danger">{systemText(error)}</div>}
    {bridge ? <div ref={host} className="min-h-0 flex-1 bg-white" /> : <div className="flex flex-1 items-center justify-center px-8 text-center text-[13px] text-ink-secondary">The embedded browser is available in the desktop app.</div>}
  </aside>;
}
