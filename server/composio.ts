import { randomUUID } from "node:crypto";
import { Composio, type Session } from "./composio-runtime.ts";

import { saveConfig, type AppConfig } from "./config.ts";

const BACKEND_URL = "https://backend.composio.dev/api/v3.1";

let cached: { apiKey: string; session: Session<any, any, any> } | null = null;

/**
 * Sessions intentionally expose a small set of meta tools instead of one
 * tool per connected app. Without an explicit routing contract, models can
 * mistake that lazy tool list for "the LinkedIn/Gmail plugin is unavailable"
 * and bounce the user back to the plugin picker.
 */
export function connectedAppsInstructions(): string {
  return [
    "You can use the user's connected apps through the Composio meta tools.",
    "Treat app names, the words plugin/connector/integration, and obvious misspellings (for example, 'linkding' meaning LinkedIn) as requests to resolve and use that app.",
    "For every task involving an external app, call COMPOSIO_SEARCH_TOOLS first with atomic queries that name the intended app and action; this search is how app-specific tools are exposed at runtime.",
    "Do not claim that an app or plugin is unavailable, ask the user to tag it, or ask for an exact plugin name until you have actually searched for it.",
    "Use the returned session id and plan, check or establish the connection with COMPOSIO_MANAGE_CONNECTIONS when required, inspect schemas when required, then perform the requested operation with COMPOSIO_MULTI_EXECUTE_TOOL.",
    "Never invent toolkit or tool slugs. If authorization is required, give the user the returned Connect Link and continue after they connect.",
    "When the user asked you to perform an action, carry it through and verify the provider result; do not stop after merely drafting or explaining unless Trust mode requires that.",
  ].join(" ");
}

function apiKey(cfg: AppConfig): string {
  const value = cfg.composio?.apiKey?.trim();
  if (!value) throw new Error("no Composio Platform API key configured");
  return value;
}

function localUserId(cfg: AppConfig): string {
  if (cfg.composio?.userId) return cfg.composio.userId;
  const userId = `openmausbot_${randomUUID()}`;
  cfg.composio = { ...cfg.composio, userId };
  saveConfig({ composio: { userId } });
  return userId;
}

export async function platformSession(cfg: AppConfig) {
  const key = apiKey(cfg);
  if (cached?.apiKey === key) return cached.session;
  const client = new Composio({ apiKey: key });
  let session: Session<any, any, any> | null = null;
  if (cfg.composio?.sessionId) {
    try { session = await client.use(cfg.composio.sessionId, { mcp: true }); } catch {}
  }
  if (!session) {
    session = await client.create(localUserId(cfg), { mcp: true });
    cfg.composio = { ...cfg.composio, sessionId: session.sessionId };
    saveConfig({ composio: { userId: cfg.composio.userId, sessionId: session.sessionId } });
  }
  cached = { apiKey: key, session };
  return session;
}

export async function mcpIntegration(cfg: AppConfig) {
  const session = await platformSession(cfg);
  return { url: session.mcp.url, headers: session.mcp.headers ?? {} };
}

/** Connection status per toolkit slug. */
export async function connectionStatus(cfg: AppConfig, slugs: string[]) {
  const session = await platformSession(cfg);
  const result = await session.toolkits({ toolkits: slugs });
  const status: Record<string, { connected: boolean; status: string }> = {};
  for (const slug of slugs) {
    const item = result.items.find((candidate) => candidate.slug === slug);
    status[slug] = {
      connected: item?.connection?.isActive === true || item?.isNoAuth === true,
      status: item?.connection?.connectedAccount?.status ?? (item?.isNoAuth ? "ACTIVE" : "NOT_CONNECTED"),
    };
  }
  return status;
}

export async function removeService(cfg: AppConfig, slug: string) {
  const key = apiKey(cfg);
  const session = await platformSession(cfg);
  const result = await session.toolkits({ toolkits: [slug] });
  const id = result.items[0]?.connection?.connectedAccount?.id;
  if (!id) return { removed: 0 };
  await new Composio({ apiKey: key }).connectedAccounts.delete(id);
  return { removed: 1 };
}

/** Create a Composio-managed Connect Link for this app's local user. */
export async function authorizeService(cfg: AppConfig, slug: string) {
  const request = await (await platformSession(cfg)).authorize(slug);
  if (!request.redirectUrl) throw new Error(`Composio returned no auth link for ${slug}`);
  return { url: request.redirectUrl };
}

export interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  domain: string | null;
}

const CURATED: ToolkitCard[] = [
  { slug: "slack", label: "Slack", blurb: "Post updates and read channels", domain: "slack.com", logo: null },
  { slug: "github", label: "GitHub", blurb: "Issues, pull requests, and code", domain: "github.com", logo: null },
  { slug: "gmail", label: "Gmail", blurb: "Read and send email", domain: "gmail.com", logo: null },
  { slug: "googlecalendar", label: "Google Calendar", blurb: "Read and create events", domain: "calendar.google.com", logo: null },
  { slug: "googlesheets", label: "Google Sheets", blurb: "Read and update spreadsheets", domain: "sheets.google.com", logo: null },
  { slug: "googledocs", label: "Google Docs", blurb: "Read and write documents", domain: "docs.google.com", logo: null },
  { slug: "googledrive", label: "Google Drive", blurb: "Browse and manage files", domain: "drive.google.com", logo: null },
  { slug: "notion", label: "Notion", blurb: "Pages and databases", domain: "notion.so", logo: null },
  { slug: "linear", label: "Linear", blurb: "Issues and project tracking", domain: "linear.app", logo: null },
  { slug: "sentry", label: "Sentry", blurb: "Errors and alerts", domain: "sentry.io", logo: null },
  { slug: "posthog", label: "PostHog", blurb: "Analytics, feature flags, experiments", domain: "posthog.com", logo: null },
  { slug: "discord", label: "Discord", blurb: "Messages and channels", domain: "discord.com", logo: null },
  { slug: "x", label: "X (Twitter)", blurb: "Post and read on X", domain: "x.com", logo: null },
  { slug: "reddit", label: "Reddit", blurb: "Browse and post", domain: "reddit.com", logo: null },
  { slug: "zapier", label: "Zapier", blurb: "Connect 9,000+ apps", domain: "zapier.com", logo: null },
  { slug: "hubspot", label: "HubSpot", blurb: "CRM search and updates", domain: "hubspot.com", logo: null },
  { slug: "salesforce", label: "Salesforce", blurb: "CRM records and reports", domain: "salesforce.com", logo: null },
  { slug: "jira", label: "Jira", blurb: "Issues and sprints", domain: "atlassian.com", logo: null },
  { slug: "asana", label: "Asana", blurb: "Tasks and projects", domain: "asana.com", logo: null },
  { slug: "trello", label: "Trello", blurb: "Boards and cards", domain: "trello.com", logo: null },
  { slug: "dropbox", label: "Dropbox", blurb: "Files and folders", domain: "dropbox.com", logo: null },
  { slug: "airtable", label: "Airtable", blurb: "Bases and records", domain: "airtable.com", logo: null },
  { slug: "figma", label: "Figma", blurb: "Files and comments", domain: "figma.com", logo: null },
  { slug: "stripe", label: "Stripe", blurb: "Payments and customers", domain: "stripe.com", logo: null },
];

let toolkitCache: { at: number; cards: ToolkitCard[] } | null = null;

export async function listToolkits(cfg: AppConfig): Promise<{ cards: ToolkitCard[]; source: "api" | "curated" }> {
  if (toolkitCache && Date.now() - toolkitCache.at < 10 * 60_000) return { cards: toolkitCache.cards, source: "api" };
  const key = cfg.composio?.apiKey;
  if (key) {
    try {
      const res = await fetch(`${BACKEND_URL}/toolkits?limit=500&sort_by=usage`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const json: any = await res.json();
        const items = json.items ?? json.data ?? [];
        if (Array.isArray(items) && items.length) {
          const cards = items.map((t: any) => ({ slug: (t.slug ?? t.key ?? t.name ?? "").toLowerCase(), label: t.name ?? t.slug ?? "", blurb: (t.meta?.description ?? t.description ?? "").slice(0, 90), logo: t.meta?.logo ?? t.logo ?? null, domain: null }));
          toolkitCache = { at: Date.now(), cards };
          return { cards, source: "api" };
        }
      }
    } catch {}
  }
  return { cards: CURATED, source: "curated" };
}

export const CURATED_SLUGS = CURATED.map((card) => card.slug);
