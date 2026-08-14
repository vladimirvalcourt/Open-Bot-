export interface CapabilitySnapshot {
  connectedApps: boolean;
  browser: boolean;
  computer: boolean;
  bots: boolean;
  memory: boolean;
  routines: boolean;
}

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

function editDistance(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

export function resolveNamedItem<T extends { id: string; name: string }>(query: string, items: T[]) {
  const wanted = normalized(query);
  if (!wanted) return { item: null, ambiguous: [] as T[] };
  const exact = items.filter((item) => normalized(item.name) === wanted);
  if (exact.length === 1) return { item: exact[0], ambiguous: [] as T[] };
  const contained = items.filter((item) => normalized(item.name).includes(wanted) || wanted.includes(normalized(item.name)));
  if (contained.length === 1) return { item: contained[0], ambiguous: [] as T[] };
  const ranked = items
    .map((item) => {
      const name = normalized(item.name);
      const distance = editDistance(wanted, name);
      return { item, score: 1 - distance / Math.max(wanted.length, name.length, 1) };
    })
    .sort((left, right) => right.score - left.score);
  if (ranked[0]?.score >= 0.62 && ranked[0].score - (ranked[1]?.score ?? 0) >= 0.12) {
    return { item: ranked[0].item, ambiguous: [] as T[] };
  }
  const ambiguous = (contained.length > 1 ? contained : ranked.filter((entry) => entry.score >= 0.5).slice(0, 5).map((entry) => entry.item));
  return { item: null, ambiguous };
}

export function capabilityRouterInstructions(capabilities: CapabilitySnapshot) {
  const available = [
    capabilities.connectedApps && "connected apps",
    capabilities.browser && "embedded browser",
    capabilities.computer && "computer control",
    capabilities.bots && "bot delegation",
    capabilities.memory && "workspace memory",
    capabilities.routines && "scheduled routines",
  ].filter(Boolean).join(", ") || "no action tools";

  return [
    `Capability router: currently available — ${available}.`,
    "Choose and invoke capabilities from the user's ordinary language; never require slash commands, an @mention, an exact integration name, or a plugin-panel action when a suitable capability is already available.",
    "Resolve obvious aliases and misspellings. Refresh with list_capabilities when availability is uncertain.",
    "Prefer the most direct reliable path. For an external service use its connected app first, then the embedded browser, then computer control; if a step fails, inspect the result and try the next available path before reporting a blocker.",
    "For multi-step requests, preserve dependencies and carry the workflow across capabilities instead of stopping after the first step.",
    "Before asking for missing details, search the relevant app, contacts, memory, or bot roster. Ask one focused question only when the remaining match is missing or genuinely ambiguous.",
    "A request to draft or write content does not authorize sending or publishing it. A direct request to send, post, create, schedule, save, or delete is authorization for that stated action, subject to Trust Center policy; otherwise show a concise action preview and ask for confirmation.",
    "Use search_memory for saved preferences and procedures. Use remember only when the user explicitly asks you to remember or save something.",
    "Use list_bots and ask_bot to delegate to an appropriate specialist even without an @mention. Resolve close bot-name matches and ask only when multiple plausible bots remain.",
    "Use create_routine when the user requests recurring work; confirm an unclear timezone, wall-clock time, or cadence before creating it.",
    "After every external or persistent action, verify the provider result or resulting state and report concrete evidence such as an id, URL, timestamp, recipient, or visible state. Never claim success from intent alone.",
  ].join(" ");
}
