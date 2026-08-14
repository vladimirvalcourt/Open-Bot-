// Machine identifiers remain stable in APIs and storage, but customer UI
// must always render deliberate product language.
const SYSTEM_LABELS: Record<string, string> = {
  auth_required: "Sign-in required",
  exit_before_result: "The provider stopped before returning a result.",
  spawn_error: "The provider could not start.",
  rpc_error: "The provider connection failed.",
  NOT_CONNECTED: "Not connected",
  COMPOSIO_SEARCH_TOOLS: "Searching connected apps",
  COMPOSIO_MULTI_EXECUTE_TOOL: "Using connected apps",
};

const WORD_LABELS: Record<string, string> = { api: "API", cli: "CLI", mcp: "MCP", oauth: "OAuth", rpc: "RPC" };

export function systemLabel(value?: string | null, fallback = "Unknown"): string {
  const raw = value?.trim();
  if (!raw) return fallback;
  if (SYSTEM_LABELS[raw]) return SYSTEM_LABELS[raw];
  if (!/^[A-Za-z][A-Za-z0-9]*(?:_+[A-Za-z0-9]+)+$/.test(raw)) return raw;
  const label = raw.split(/_+/).filter(Boolean).map((word) => WORD_LABELS[word.toLowerCase()] ?? word.toLowerCase()).join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function systemText(value?: string | null, fallback = "Something went wrong."): string {
  const raw = value?.trim();
  if (!raw) return fallback;
  if (SYSTEM_LABELS[raw]) return SYSTEM_LABELS[raw];
  const known = Object.entries(SYSTEM_LABELS).reduce(
    (text, [token, label]) => text.replace(new RegExp(`\\b${token}\\b`, "g"), label),
    raw,
  );
  return known.replace(/\b[A-Za-z][A-Za-z0-9]*(?:_+[A-Za-z0-9]+)+\b/g, (token) => systemLabel(token));
}

export function presentSystemFields<T extends object>(value: T): T {
  return new Proxy(value, {
    get(target, property, receiver) {
      const current = Reflect.get(target, property, receiver);
      if (typeof current !== "string") return current;
      if (["source", "kind", "type", "tool", "summary"].includes(String(property))) return systemLabel(current);
      if (["error", "reason", "lastError"].includes(String(property))) return systemText(current);
      return current;
    },
  });
}
