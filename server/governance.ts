import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { newId } from "./contracts.ts";

export type AutonomyMode = "observe" | "draft" | "approve" | "auto";
export type PermissionDecision = "ask" | "allow" | "deny";
export type OrganizationRole = "owner" | "admin" | "operator" | "viewer";

export interface PermissionRule {
  id: string;
  botId?: string;
  tool?: string;
  resource?: string;
  decision: Exclude<PermissionDecision, "ask">;
  expiresAt?: number;
  createdAt: number;
  note?: string;
}

export interface OrganizationMember {
  id: string;
  name: string;
  email: string;
  role: OrganizationRole;
  active: boolean;
  createdAt: number;
}

export interface GovernanceData {
  version: 1;
  trust: {
    emergencyStopped: boolean;
    defaultMode: AutonomyMode;
    botModes: Record<string, AutonomyMode>;
    rules: PermissionRule[];
    updatedAt: number;
  };
  privacy: {
    analytics: boolean;
    crashReports: boolean;
    includeContentInDiagnostics: boolean;
    retentionDays: number;
  };
  organization: {
    name: string;
    members: OrganizationMember[];
    sso: { enabled: boolean; provider: "oidc" | "saml"; issuer: string; domain: string };
  };
  release: {
    channel: "stable" | "beta";
    lastKnownGoodVersion?: string;
  };
  reliability: {
    autoFailover: boolean;
    resumeInterruptedAutomatically: boolean;
    routineMisfire: "skip" | "run-once";
  };
}

const FILE = join(DATA_DIR, "governance.json");
const now = () => Date.now();
const DEFAULTS: GovernanceData = {
  version: 1,
  trust: { emergencyStopped: false, defaultMode: "approve", botModes: {}, rules: [], updatedAt: 0 },
  privacy: { analytics: false, crashReports: false, includeContentInDiagnostics: false, retentionDays: 365 },
  organization: { name: "Personal workspace", members: [], sso: { enabled: false, provider: "oidc", issuer: "", domain: "" } },
  release: { channel: "stable" },
  reliability: { autoFailover: true, resumeInterruptedAutomatically: false, routineMisfire: "run-once" },
};

const MODES = new Set<AutonomyMode>(["observe", "draft", "approve", "auto"]);
const ROLES = new Set<OrganizationRole>(["owner", "admin", "operator", "viewer"]);

function normalized(value: any): GovernanceData {
  const trust = value?.trust ?? {};
  const privacy = value?.privacy ?? {};
  const organization = value?.organization ?? {};
  const release = value?.release ?? {};
  const reliability = value?.reliability ?? {};
  return {
    version: 1,
    trust: {
      emergencyStopped: trust.emergencyStopped === true,
      defaultMode: MODES.has(trust.defaultMode) ? trust.defaultMode : "approve",
      botModes: Object.fromEntries(Object.entries(trust.botModes ?? {}).filter((entry): entry is [string, AutonomyMode] => MODES.has(entry[1] as AutonomyMode))),
      rules: Array.isArray(trust.rules) ? trust.rules.filter((rule: any) => rule?.id && ["allow", "deny"].includes(rule.decision)) : [],
      updatedAt: Number(trust.updatedAt) || 0,
    },
    privacy: {
      analytics: privacy.analytics === true,
      crashReports: privacy.crashReports === true,
      includeContentInDiagnostics: privacy.includeContentInDiagnostics === true,
      retentionDays: Math.min(3650, Math.max(1, Number(privacy.retentionDays) || 365)),
    },
    organization: {
      name: String(organization.name || "Personal workspace").slice(0, 120),
      members: Array.isArray(organization.members)
        ? organization.members.filter((member: any) => member?.id && ROLES.has(member.role))
        : [],
      sso: {
        enabled: organization.sso?.enabled === true,
        provider: organization.sso?.provider === "saml" ? "saml" : "oidc",
        issuer: String(organization.sso?.issuer ?? "").slice(0, 500),
        domain: String(organization.sso?.domain ?? "").toLowerCase().slice(0, 253),
      },
    },
    release: {
      channel: release.channel === "beta" ? "beta" : "stable",
      ...(release.lastKnownGoodVersion ? { lastKnownGoodVersion: String(release.lastKnownGoodVersion).slice(0, 40) } : {}),
    },
    reliability: {
      autoFailover: reliability.autoFailover !== false,
      resumeInterruptedAutomatically: reliability.resumeInterruptedAutomatically === true,
      routineMisfire: reliability.routineMisfire === "skip" ? "skip" : "run-once",
    },
  };
}

function match(pattern: string | undefined, value: string) {
  if (!pattern || pattern === "*") return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

// Auto mode is capability-based and fail-closed. Names are emitted by trusted
// adapters, not inferred from user-controlled prose. Unknown tools, shell,
// edits, navigation, clicks, and connected-app calls always require approval.
const READ_ONLY_TOOLS = new Set([
  "read_file", "list_files", "search", "web_search", "inspect", "status",
  "mcp__agents__list_capabilities", "mcp__agents__list_bots",
  "mcp__agents__search_memory", "mcp__agents__list_routines",
  "mcp__browser__state", "mcp__browser__snapshot", "mcp__browser__screenshot", "mcp__browser__wait",
  "mcp__computer__screenshot", "mcp__computer__computer_state",
]);

function readOnly(tool: string) {
  return READ_ONLY_TOOLS.has(String(tool).trim().toLowerCase());
}

export class GovernanceStore {
  data: GovernanceData;

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });
    try { this.data = normalized(JSON.parse(readFileSync(FILE, "utf8"))); }
    catch { this.data = structuredClone(DEFAULTS); }
  }

  private save() {
    const temp = `${FILE}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(temp, FILE);
    try { chmodSync(FILE, 0o600); } catch {}
  }

  mode(botId: string): AutonomyMode {
    return this.data.trust.botModes[botId] ?? this.data.trust.defaultMode;
  }

  decision(botId: string, tool: string, summary: string): PermissionDecision {
    if (this.data.trust.emergencyStopped) return "deny";
    const current = now();
    const rule = this.data.trust.rules.find((item) =>
      (!item.expiresAt || item.expiresAt > current) &&
      (!item.botId || item.botId === botId) &&
      match(item.tool, tool) && match(item.resource, summary));
    if (rule) return rule.decision;
    const mode = this.mode(botId);
    if (mode === "observe" || mode === "draft") return "deny";
    if (mode === "auto" && readOnly(tool)) return "allow";
    return "ask";
  }

  patch(input: any) {
    if (input?.trust) {
      const trust = input.trust;
      if (trust.defaultMode !== undefined) {
        if (!MODES.has(trust.defaultMode)) throw Object.assign(new Error("invalid autonomy mode"), { status: 400 });
        this.data.trust.defaultMode = trust.defaultMode;
      }
      if (trust.botModes && typeof trust.botModes === "object") {
        for (const [botId, mode] of Object.entries(trust.botModes)) {
          if (mode === null) delete this.data.trust.botModes[botId];
          else if (MODES.has(mode as AutonomyMode)) this.data.trust.botModes[botId] = mode as AutonomyMode;
          else throw Object.assign(new Error("invalid bot autonomy mode"), { status: 400 });
        }
      }
      this.data.trust.updatedAt = now();
    }
    if (input?.privacy) {
      const privacy = input.privacy;
      for (const key of ["analytics", "crashReports", "includeContentInDiagnostics"] as const) {
        if (privacy[key] !== undefined) this.data.privacy[key] = privacy[key] === true;
      }
      if (privacy.retentionDays !== undefined) this.data.privacy.retentionDays = Math.min(3650, Math.max(1, Number(privacy.retentionDays) || 365));
    }
    if (input?.organization) {
      if (input.organization.name !== undefined) this.data.organization.name = String(input.organization.name).trim().slice(0, 120) || "Personal workspace";
      if (input.organization.sso) {
        const sso = input.organization.sso;
        if (sso.provider !== undefined && !["oidc", "saml"].includes(sso.provider)) throw Object.assign(new Error("invalid SSO provider"), { status: 400 });
        if (sso.enabled !== undefined) this.data.organization.sso.enabled = sso.enabled === true;
        if (sso.provider !== undefined) this.data.organization.sso.provider = sso.provider;
        if (sso.issuer !== undefined) this.data.organization.sso.issuer = String(sso.issuer).trim().slice(0, 500);
        if (sso.domain !== undefined) this.data.organization.sso.domain = String(sso.domain).trim().toLowerCase().slice(0, 253);
      }
    }
    if (input?.release?.channel !== undefined) {
      if (!["stable", "beta"].includes(input.release.channel)) throw Object.assign(new Error("invalid release channel"), { status: 400 });
      this.data.release.channel = input.release.channel;
    }
    if (input?.reliability) {
      if (input.reliability.autoFailover !== undefined) this.data.reliability.autoFailover = input.reliability.autoFailover === true;
      if (input.reliability.resumeInterruptedAutomatically !== undefined) this.data.reliability.resumeInterruptedAutomatically = input.reliability.resumeInterruptedAutomatically === true;
      if (input.reliability.routineMisfire !== undefined) {
        if (!["skip", "run-once"].includes(input.reliability.routineMisfire)) throw Object.assign(new Error("invalid routine misfire policy"), { status: 400 });
        this.data.reliability.routineMisfire = input.reliability.routineMisfire;
      }
    }
    this.save();
    return this.data;
  }

  emergencyStop(stopped: boolean) {
    this.data.trust.emergencyStopped = stopped;
    this.data.trust.updatedAt = now();
    this.save();
    return this.data;
  }

  addRule(input: Partial<PermissionRule>) {
    if (!input.decision || !["allow", "deny"].includes(input.decision)) throw Object.assign(new Error("rule decision must be allow or deny"), { status: 400 });
    const rule: PermissionRule = {
      id: newId(), decision: input.decision, createdAt: now(),
      ...(input.botId ? { botId: String(input.botId).slice(0, 128) } : {}),
      ...(input.tool ? { tool: String(input.tool).slice(0, 200) } : {}),
      ...(input.resource ? { resource: String(input.resource).slice(0, 500) } : {}),
      ...(input.note ? { note: String(input.note).slice(0, 500) } : {}),
      ...(input.expiresAt && Number(input.expiresAt) > now() ? { expiresAt: Number(input.expiresAt) } : {}),
    };
    this.data.trust.rules.unshift(rule); this.data.trust.updatedAt = now(); this.save(); return rule;
  }

  deleteRule(id: string) {
    const before = this.data.trust.rules.length;
    this.data.trust.rules = this.data.trust.rules.filter((item) => item.id !== id);
    if (before !== this.data.trust.rules.length) { this.data.trust.updatedAt = now(); this.save(); return true; }
    return false;
  }

  addMember(input: { name: string; email: string; role: OrganizationRole }) {
    const email = input.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error("enter a valid member email"), { status: 400 });
    if (!ROLES.has(input.role)) throw Object.assign(new Error("invalid organization role"), { status: 400 });
    if (this.data.organization.members.some((item) => item.email === email)) throw Object.assign(new Error("member already exists"), { status: 409 });
    const member: OrganizationMember = { id: newId(), name: input.name.trim().slice(0, 120) || email.split("@")[0], email, role: input.role, active: true, createdAt: now() };
    this.data.organization.members.push(member); this.save(); return member;
  }

  patchMember(id: string, input: Partial<Pick<OrganizationMember, "role" | "active">>) {
    const member = this.data.organization.members.find((item) => item.id === id); if (!member) return null;
    if (input.role !== undefined) { if (!ROLES.has(input.role)) throw Object.assign(new Error("invalid organization role"), { status: 400 }); member.role = input.role; }
    if (input.active !== undefined) member.active = input.active === true;
    this.save(); return member;
  }
}
