// App-level settings, in the right-side slot: who you are + credentials
// shared by all bots. Per-bot settings (name, persona, model, computer)
// live in SettingsPanel; contextual Box-token entry stays in ComputerPanel.
import { Plus, Trash2, X } from "./icons";
import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { ApiKeyRow } from "./ApiKeys";
import { useUpdaterState } from "@/lib/updater";
import { type ThemePreference, useThemePreference } from "@/lib/theme";
import { systemText } from "@/lib/presentation";

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function AppearanceSettings() {
  const [theme, setTheme] = useThemePreference();

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Appearance</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">Choose a theme or match your Mac.</div>
      <div
        role="radiogroup"
        aria-label="App theme"
        className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-inset p-1 ring-1 ring-hairline/40"
      >
        {THEME_OPTIONS.map((option) => {
          const selected = theme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(option.value)}
              className={
                selected
                  ? "rounded-md bg-raised px-3 py-1.5 text-[13px] font-medium text-ink shadow-sm outline-none ring-2 ring-accent/50 ring-offset-1 ring-offset-inset focus-visible:ring-accent"
                  : "rounded-md px-3 py-1.5 text-[13px] text-ink-secondary outline-none hover:bg-raised/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Name + email, persisted to /api/config {profile} on blur. Prefilled from
 * the current config (the values are echoed back — they're not secrets). */
function ProfileFields() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(state.config?.profile?.name ?? "");
  const [email, setEmail] = useState(state.config?.profile?.email ?? "");
  // adopt late-arriving config exactly once per open (config loads async)
  useEffect(() => {
    setName(state.config?.profile?.name ?? "");
    setEmail(state.config?.profile?.email ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.config?.profile?.name, state.config?.profile?.email]);

  const save = () => {
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { name: name.trim(), email: email.trim().toLowerCase() } }),
    })
      .then((r) => r.json())
      .then((config) => dispatch({ type: "configStatus", config }))
      .catch(() => {});
  };

  const inputClass =
    "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";
  return (
    <div className="flex flex-col gap-3">
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={save} placeholder="Your name" className={inputClass} />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={save}
        placeholder="you@example.com"
        className={inputClass}
      />
    </div>
  );
}

/** Manual update check row — packaged app only (no bridge in dev). */
function UpdatesRow() {
  const s = useUpdaterState();
  if (!window.ogb?.updater) return null;
  const updater = window.ogb.updater;
  const label =
    s?.status === "checking"
      ? "Checking…"
      : s?.status === "available"
        ? `${s.version} available`
        : s?.status === "downloading"
          ? `Downloading… ${Math.round(s.percent ?? 0)}%`
          : s?.status === "downloaded"
            ? `${s.version} ready — restart to apply`
            : s?.status === "error"
      ? `Check failed: ${s.message ?? "unknown error"}`
      : s?.status === "disabled"
        ? (s.message ?? "Automatic updates are disabled for this build.")
      : "You're on the latest version we know of.";
  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">App updates</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{label}</div>
      <div className="mt-3 flex gap-2">
        {s?.status === "available" ? (
          <button
            onClick={() => void updater.download()}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white"
          >
            Download
          </button>
        ) : s?.status === "downloaded" ? (
          <button
            onClick={() => void updater.install()}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white"
          >
            Restart to update
          </button>
        ) : s?.status === "disabled" ? null : (
          <button
            onClick={() => void updater.check()}
            disabled={s?.status === "checking" || s?.status === "downloading"}
            className="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40"
          >
            Check for updates
          </button>
        )}
      </div>
    </div>
  );
}

const PROVIDER_PRESETS = [
  { label: "DeepSeek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  { label: "Kimi API", name: "Kimi API", baseUrl: "https://api.moonshot.ai/v1", model: "kimi-k2.5" },
  { label: "Z.AI / GLM", name: "Z.AI", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4.7" },
  { label: "MiniMax", name: "MiniMax", baseUrl: "https://api.minimax.io/v1", model: "MiniMax-M2.5" },
  { label: "Qwen", name: "Qwen", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", model: "qwen3-coder-plus" },
] as const;

function ApiProviders() {
  const { state, dispatch } = useStore();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputClass = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, baseUrl, model, apiKey }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not add provider");
      dispatch({ type: "configStatus", config: body });
      const instances = await fetch("/api/instances").then((result) => result.json());
      dispatch({ type: "instances", instances: instances.instances ?? [] });
      setName(""); setBaseUrl(""); setModel(""); setApiKey(""); setAdding(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    const response = await fetch(`/api/providers/${id}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) return setError(body.error ?? "Could not remove provider");
    dispatch({ type: "configStatus", config: body });
    const instances = await fetch("/api/instances").then((result) => result.json());
    dispatch({ type: "instances", instances: instances.instances ?? [] });
  };
  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[15px] font-medium text-ink">API model providers</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">Add any OpenAI-compatible provider. Keys stay local and are never shown again.</div>
        </div>
        <button onClick={() => setAdding((value) => !value)} className="shrink-0 rounded-lg bg-raised p-2 text-ink hover:bg-raised-hover" title="Add API provider"><Plus size={15} /></button>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {(state.config?.apiProviders ?? []).map((provider) => (
          <div key={provider.id} className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] text-ink">{provider.name}</div>
              <div className="truncate text-[11px] text-ink-secondary">{provider.model} · {provider.baseUrl}</div>
            </div>
            <button onClick={() => void remove(provider.id)} className="shrink-0 rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-danger" title={`Remove ${provider.name}`}><Trash2 size={14} /></button>
          </div>
        ))}
        {!state.config?.apiProviders?.length && !adding && <div className="text-[12px] text-ink-secondary">No API providers added.</div>}
      </div>
      {adding && (
        <div className="mt-3 flex flex-col gap-2 border-t border-hairline/30 pt-3">
          <div className="flex flex-wrap gap-1.5">
            {PROVIDER_PRESETS.map((preset) => <button key={preset.label} onClick={() => { setName(preset.name); setBaseUrl(preset.baseUrl); setModel(preset.model); }} className="rounded-md bg-inset px-2 py-1 text-[11px] text-ink-secondary hover:text-ink">{preset.label}</button>)}
          </div>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Provider name" className={inputClass} />
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://provider.example/v1" className={inputClass} />
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Model ID" className={inputClass} />
          <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="API key" autoComplete="off" className={inputClass} />
          {error && <div className="text-[12px] text-danger">{systemText(error)}</div>}
          <button disabled={busy || !name.trim() || !baseUrl.trim() || !model.trim() || !apiKey.trim()} onClick={() => void save()} className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40">{busy ? "Adding…" : "Add provider"}</button>
        </div>
      )}
    </div>
  );
}

function RemoteAccess() {
  const { state, dispatch } = useStore();
  const [busy, setBusy] = useState(false); const [token, setToken] = useState(""); const [error, setError] = useState("");
  const toggle = async () => { setBusy(true); setError(""); try { const response = await fetch("/api/remote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !state.config?.remote?.enabled }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Could not update remote access"); setToken(body.token ?? ""); dispatch({ type: "configStatus", config: body }); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };
  return <div className="mt-4 rounded-xl bg-card p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-[15px] font-medium text-ink">Remote & mobile access</div><div className="mt-0.5 text-[13px] text-ink-secondary">Off by default. The server stays on loopback; remote traffic must arrive through an explicitly trusted HTTPS reverse proxy.</div></div><button disabled={busy} onClick={() => void toggle()} className={state.config?.remote?.enabled ? "rounded-lg bg-danger/15 px-3 py-1.5 text-[12px] text-danger" : "rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink"}>{state.config?.remote?.enabled ? "Disable" : "Enable"}</button></div>{token && <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3"><div className="text-[12px] text-warning">Copy this bearer token now. It will not be shown again. Enabling again rotates it.</div><button onClick={() => void navigator.clipboard.writeText(token)} className="mt-2 max-w-full truncate rounded bg-inset px-2 py-1 font-mono text-[11px] text-ink">{token}</button></div>}{error && <div className="mt-2 text-[12px] text-danger">{error}</div>}</div>;
}

function UsageLimits() {
  const { state, dispatch } = useStore();
  const [concurrent, setConcurrent] = useState(state.config?.limits?.maxConcurrentTasks ?? 4);
  const [tokens, setTokens] = useState(state.config?.limits?.dailyApiTokens ?? 2_000_000);
  const save = async () => { const response = await fetch("/api/config", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ limits: { maxConcurrentTasks: Math.min(16, Math.max(1, concurrent)), dailyApiTokens: Math.max(1000, tokens) } }) }); const body = await response.json(); if (response.ok) dispatch({ type: "configStatus", config: body }); };
  return <div className="mt-4 rounded-xl bg-card p-4"><div className="text-[15px] font-medium text-ink">Autonomy limits</div><div className="mt-0.5 text-[13px] text-ink-secondary">Hard local ceilings protect API spend and prevent runaway bot fan-out.</div><div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[11px] text-ink-secondary">Concurrent tasks<input type="number" min={1} max={16} value={concurrent} onChange={(event) => setConcurrent(Number(event.target.value))} className="mt-1 w-full rounded-lg bg-inset px-3 py-2 text-[13px] text-ink" /></label><label className="text-[11px] text-ink-secondary">API tokens / 24h<input type="number" min={1000} step={1000} value={tokens} onChange={(event) => setTokens(Number(event.target.value))} className="mt-1 w-full rounded-lg bg-inset px-3 py-2 text-[13px] text-ink" /></label></div><button onClick={() => void save()} className="mt-3 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink">Save limits</button></div>;
}

function CloudComputerSettings() {
  const { state, dispatch } = useStore();
  const [provider, setProvider] = useState<"box" | "codespaces">(state.config?.cloud?.provider ?? "codespaces");
  const [repository, setRepository] = useState(state.config?.codespaces?.repository ?? "");
  const [branch, setBranch] = useState(state.config?.codespaces?.branch ?? "");
  const [machine, setMachine] = useState(state.config?.codespaces?.machine ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setProvider(state.config?.cloud?.provider ?? "codespaces");
    setRepository(state.config?.codespaces?.repository ?? "");
    setBranch(state.config?.codespaces?.branch ?? "");
    setMachine(state.config?.codespaces?.machine ?? "");
  }, [state.config?.cloud?.provider, state.config?.codespaces?.repository, state.config?.codespaces?.branch, state.config?.codespaces?.machine]);

  const save = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cloud: { provider },
          codespaces: { repository: repository.trim(), branch: branch.trim(), machine: machine.trim() },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save cloud settings");
      dispatch({ type: "configStatus", config: body });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setSaving(false); }
  };

  const inputClass = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";
  return <div className="mt-4 rounded-xl bg-card p-4">
    <div className="text-[15px] font-medium text-ink">Cloud computer</div>
    <div className="mt-0.5 text-[13px] text-ink-secondary">Codespaces uses GitHub's recurring personal-account quota. Box remains available as an optional paid backend.</div>
    <select value={provider} onChange={(event) => setProvider(event.target.value as "box" | "codespaces")} className={`${inputClass} mt-3`}>
      <option value="codespaces">GitHub Codespaces</option>
      <option value="box">Box</option>
    </select>
    {provider === "codespaces" ? <div className="mt-3 flex flex-col gap-3">
      <ApiKeyRow section="codespaces" label="GitHub Codespaces token" placeholder="Token with Codespaces access" />
      <label className="text-[11px] text-ink-secondary">Repository
        <input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="owner/repository" className={`${inputClass} mt-1`} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-ink-secondary">Branch (optional)
          <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="main" className={`${inputClass} mt-1`} />
        </label>
        <label className="text-[11px] text-ink-secondary">Machine (optional)
          <input value={machine} onChange={(event) => setMachine(event.target.value)} placeholder="GitHub default" className={`${inputClass} mt-1`} />
        </label>
      </div>
      <div className="text-[11px] leading-relaxed text-ink-secondary">Use a fine-grained token with Codespaces read/write permission for only this repository, or a classic token with <code>codespace</code> and <code>repo</code> when the repository is private. Secrets remain server-side.</div>
    </div> : <div className="mt-3"><ApiKeyRow section="box" label="Box token" placeholder="Token from box.ascii.dev" /></div>}
    <button disabled={saving || (provider === "codespaces" && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.trim()))} onClick={() => void save()} className="mt-3 w-full rounded-lg bg-raised py-2 text-[13px] text-ink disabled:opacity-40">{saving ? "Saving…" : "Save cloud settings"}</button>
    {error && <div className="mt-2 text-[12px] text-danger">{systemText(error)}</div>}
  </div>;
}

export function AppSettingsPanel() {
  const { state, dispatch } = useStore();

  return (
    <aside className="animate-panel-in flex h-full w-[400px] shrink-0 flex-col border-l border-hairline/40 bg-panel">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="w-6" />
        <span className="text-[15px] font-semibold text-ink">App Settings</span>
        <button
          onClick={() => dispatch({ type: "toggleAppSettings", open: false })}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="mt-2 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">Profile</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">Shown in the sidebar. Saved as you go.</div>
          <div className="mt-4">
            <ProfileFields />
          </div>
        </div>

        <AppearanceSettings />

        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">Connections</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            Shared by all bots. Credentials are stored locally and never shown again. A configured credential
            is verified when the app first contacts its provider.
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <ApiKeyRow section="composio" label="Composio Platform API key" placeholder="ak_…" />
          </div>
        </div>

        <CloudComputerSettings />

        <ApiProviders />
        <RemoteAccess />
        <UsageLimits />

        <div className="mt-4 rounded-xl bg-card p-4">
          <div className="text-[15px] font-medium text-ink">Agent CLIs</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">Install and sign in to at least one provider on this Mac. OpenMausBot uses that provider's local subscription and never asks for its password.</div>
          <div className="mt-3 flex flex-col gap-2">
            {state.instances.filter((instance) => instance.driverKind !== "boxAgent").map((instance) => (
              <div key={instance.instanceId} className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2">
                <span className="text-[13px] text-ink">{instance.displayName}</span>
                <span className={instance.snapshot.state === "available" ? (instance.snapshot.authenticated === false ? "text-[11px] text-warning" : "text-[11px] text-success") : "max-w-[220px] truncate text-[11px] text-warning"} title={instance.snapshot.reason ? systemText(instance.snapshot.reason) : undefined}>
                  {instance.snapshot.state === "available"
                    ? instance.snapshot.authenticated === false
                      ? "Sign in on first message"
                      : "Ready"
                    : systemText(instance.snapshot.reason, "Unavailable")}
                </span>
              </div>
            ))}
          </div>
        </div>

        <UpdatesRow />
      </div>
    </aside>
  );
}
