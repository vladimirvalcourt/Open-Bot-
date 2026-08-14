// API smoke test: boots the real harness server (node server/index.ts)
// against a throwaway home directory and exercises the HTTP surface the
// app depends on. The config pins one deliberately-unknown driver so the
// suite is deterministic with or without agent CLIs installed — and pins
// the shadow-instance behavior end to end while it's at it.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = 18800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_TOKEN = "test-local-app-token-32-bytes-minimum";

let child: ChildProcess;
let home: string;
let stderr = "";

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${APP_TOKEN}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-api-test-"));
  // a fleet of exactly one unknown driver: no CLI probes, no network
  mkdirSync(join(home, ".openmausbot"), { recursive: true });
  writeFileSync(
    join(home, ".openmausbot", "config.json"),
    JSON.stringify({ instances: { ghost: { driver: "not-a-real-driver", displayName: "Ghost" } } }),
  );

  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      OMB_PORT: String(PORT),
      OMB_APP_TOKEN: APP_TOKEN,
      OMB_TRUST_TLS_PROXY: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (c) => (stderr += c));

  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}, 30_000);

afterAll(async () => {
  child?.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.on("close", () => resolve());
    setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
  });
  rmSync(home, { recursive: true, force: true });
});

describe("harness HTTP API", () => {
  it("identifies itself on /api/health", async () => {
    const { status, body } = await api("GET", "/api/health");
    expect(status).toBe(200);
    expect(body.app).toBe("openmausbot");
    expect(typeof body.pid).toBe("number");
  });

  it("seeds one starter bot with its greeting", async () => {
    const { status, body } = await api("GET", "/api/bots");
    expect(status).toBe(200);
    expect(body.bots.length).toBeGreaterThanOrEqual(1);
    expect(body.bots[0].messages.length).toBeGreaterThanOrEqual(2);
  });

  it("describes the configured fleet, shadows included", async () => {
    const { status, body } = await api("GET", "/api/instances");
    expect(status).toBe(200);
    expect(body.instances).toHaveLength(1);
    expect(body.instances[0]).toMatchObject({
      instanceId: "ghost",
      driverKind: "not-a-real-driver",
      displayName: "Ghost",
      snapshot: { state: "unavailable" },
    });
    expect(body.instances[0].snapshot.reason).toContain("not-a-real-driver");
  });

  it("creates, patches, and deletes a bot", async () => {
    const created = await api("POST", "/api/bots");
    expect(created.status).toBe(201);
    const bot = created.body.bot;

    const patched = await api("PATCH", `/api/bots/${bot.id}`, { name: "Renamed", pinned: true, section: "Research" });
    expect(patched.status).toBe(200);
    expect(patched.body.bot).toMatchObject({ name: "Renamed", pinned: true, section: "Research" });

    const missing = await api("PATCH", "/api/bots/does-not-exist", { name: "x" });
    expect(missing.status).toBe(404);

    const deleted = await api("DELETE", `/api/bots/${bot.id}`);
    expect(deleted.status).toBe(200);
    const after = await api("GET", "/api/bots");
    expect(after.body.bots.find((b: { id: string }) => b.id === bot.id)).toBeUndefined();
  });

  it("persists an answered onboarding card", async () => {
    const { body } = await api("GET", "/api/bots");
    const bot = body.bots[0];
    const card = bot.messages.find((m: { kind: string }) => m.kind === "options");
    const res = await api("PATCH", `/api/bots/${bot.id}/cards/${card.id}`, { answered: card.card.options[0] });
    expect(res.status).toBe(200);
    expect(res.body.message.card.answered).toBe(card.card.options[0]);
  });

  it("rejects an empty message and explains an unavailable provider", async () => {
    const { body } = await api("GET", "/api/bots");
    const bot = body.bots[0];

    const empty = await api("POST", `/api/bots/${bot.id}/messages`, { text: "   " });
    expect(empty.status).toBe(400);

    // the seeded bot's selection points at the ghost instance — sending a
    // real message must fail loudly, not 202-and-hang
    const send = await api("POST", `/api/bots/${bot.id}/messages`, { text: "hello?" });
    expect(send.status).toBe(409);
    expect(send.body.error).toContain("unavailable");
  });

  it("enhances a rough prompt without sending it or requiring a live provider", async () => {
    const { body } = await api("GET", "/api/bots");
    const bot = body.bots[0];
    const beforeMessages = bot.messages.length;
    const enhanced = await api("POST", `/api/bots/${bot.id}/enhance-prompt`, { text: "do reserarch about xyz" });
    expect(enhanced.status).toBe(200);
    expect(enhanced.body.source).toBe("structured");
    expect(enhanced.body.text).toContain("Research task:");
    expect(enhanced.body.text).toContain("credible, current primary sources");
    const after = (await api("GET", "/api/bots")).body.bots.find((item: { id: string }) => item.id === bot.id);
    expect(after.messages).toHaveLength(beforeMessages);
  });

  it("saves config keys write-only and reports booleans", async () => {
    const before = await api("GET", "/api/config");
    expect(before.body.box).toEqual({ configured: false });

    const put = await api("PUT", "/api/config", { box: { token: "tok_secret_value" } });
    expect(put.status).toBe(200);
    expect(put.body.box).toEqual({ configured: true });
    expect(JSON.stringify(put.body)).not.toContain("tok_secret_value");

    const after = await api("GET", "/api/config");
    expect(after.body.box).toEqual({ configured: true });
    expect(JSON.stringify(after.body)).not.toContain("tok_secret_value");

    const nothing = await api("PUT", "/api/config", {});
    expect(nothing.status).toBe(400);
  });

  it("validates Codespaces configuration without echoing its token", async () => {
    const invalid = await api("PATCH", "/api/config", {
      cloud: { provider: "codespaces" },
      codespaces: { token: "github-secret", repository: "https://github.com/owner/repo" },
    });
    expect(invalid.status).toBe(400);

    const saved = await api("PATCH", "/api/config", {
      cloud: { provider: "codespaces" },
      codespaces: { token: "github-secret", repository: "owner/repo", branch: "main" },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.cloud).toEqual({ provider: "codespaces" });
    expect(saved.body.codespaces).toMatchObject({
      configured: true,
      tokenConfigured: true,
      repository: "owner/repo",
      branch: "main",
    });
    expect(JSON.stringify(saved.body)).not.toContain("github-secret");
  });

  it("stores and echoes the user profile (not write-only, unlike keys)", async () => {
    const put = await api("PUT", "/api/config", { profile: { name: "Ada Lovelace", email: "Ada@Example.com" } });
    expect(put.status).toBe(200);
    expect(put.body.profile).toEqual({ name: "Ada Lovelace", email: "Ada@Example.com" });

    const after = await api("GET", "/api/config");
    expect(after.body.profile).toEqual({ name: "Ada Lovelace", email: "Ada@Example.com" });
  });

  it("adds and removes an OpenAI-compatible provider without echoing its API key", async () => {
    const created = await api("POST", "/api/providers", {
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-super-secret-provider-key",
    });
    expect(created.status).toBe(201);
    expect(created.body.apiProviders).toHaveLength(1);
    expect(created.body.apiProviders[0]).toMatchObject({
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      configured: true,
    });
    expect(JSON.stringify(created.body)).not.toContain("sk-super-secret-provider-key");

    const instances = await api("GET", "/api/instances");
    expect(instances.body.instances.some((instance: { driverKind: string; displayName: string }) =>
      instance.driverKind === "openaiCompatible" && instance.displayName === "DeepSeek",
    )).toBe(true);

    const id = created.body.apiProviders[0].id;
    const removed = await api("DELETE", `/api/providers/${id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.apiProviders).toEqual([]);
    expect((await api("DELETE", `/api/providers/${id}`)).status).toBe(404);
  });

  it("rejects insecure remote API provider URLs", async () => {
    const result = await api("POST", "/api/providers", {
      name: "Unsafe",
      baseUrl: "http://example.com/v1",
      model: "model",
      apiKey: "secret",
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("HTTPS");
  });

  it("enforces Trust Center modes and emergency stop server-side", async () => {
    const initial = await api("GET", "/api/governance");
    expect(initial.body.governance.trust.defaultMode).toBe("approve");
    const patched = await api("PATCH", "/api/governance", { trust: { defaultMode: "observe" }, privacy: { analytics: false } });
    expect(patched.body.governance.trust.defaultMode).toBe("observe");
    const stopped = await api("POST", "/api/governance/emergency-stop");
    expect(stopped.body.governance.trust.emergencyStopped).toBe(true);
    const bots = (await api("GET", "/api/bots")).body.bots;
    const blocked = await api("POST", `/api/bots/${bots[0].id}/messages`, { text: "hello" });
    expect(blocked.status).toBe(423);
    expect((await api("POST", "/api/governance/resume")).body.governance.trust.emergencyStopped).toBe(false);
  });

  it("exposes Mission Control and setup certification without credentials", async () => {
    const mission = await api("GET", "/api/mission-control");
    expect(mission.status).toBe(200);
    expect(mission.body.overview).toMatchObject({ totalBots: expect.any(Number), pendingApprovals: expect.any(Number) });
    expect(JSON.stringify(mission.body)).not.toContain("tok_secret_value");
    const setup = await api("GET", "/api/setup/certification");
    expect(setup.body.checks.some((check: { id: string }) => check.id === "trust")).toBe(true);
  });

  it("rejects cross-origin requests to the local control API", async () => {
    const response = await fetch(`${BASE}/api/bots`, { headers: { origin: "https://evil.example", authorization: `Bearer ${APP_TOKEN}` } });
    expect(response.status).toBe(403);
  });

  it("rejects unauthenticated loopback callers", async () => {
    expect((await fetch(`${BASE}/api/bots`)).status).toBe(401);
    expect((await fetch(`${BASE}/api/governance`, { headers: { origin: `http://127.0.0.1:${PORT}` } })).status).toBe(401);
  });

  it("accepts remote bearer auth only through the trusted HTTPS proxy", async () => {
    const enabled = await api("POST", "/api/remote", { enabled: true });
    const remoteToken = enabled.body.token;
    expect(typeof remoteToken).toBe("string");
    const plaintext = await fetch(`${BASE}/api/bots`, { headers: { "x-forwarded-proto": "http", authorization: `Bearer ${remoteToken}` } });
    expect(plaintext.status).toBe(426);
    const wrong = await fetch(`${BASE}/api/bots`, { headers: { "x-forwarded-proto": "https", authorization: "Bearer wrong" } });
    expect(wrong.status).toBe(401);
    const secure = await fetch(`${BASE}/api/bots`, { headers: { "x-forwarded-proto": "https", authorization: `Bearer ${remoteToken}` } });
    expect(secure.status).toBe(200);
  });

  it("installs professional templates once with routines paused", async () => {
    const installed = await api("POST", "/api/templates/research-lab/apply", { timezone: "America/New_York" });
    expect(installed.status).toBe(201);
    expect(installed.body.bots).toHaveLength(3);
    expect(installed.body.routines.every((routine: { enabled: boolean }) => !routine.enabled)).toBe(true);
    expect((await api("POST", "/api/templates/research-lab/apply", {})).status).toBe(409);
  });

  it("creates, toggles, lists, and deletes a scheduled routine", async () => {
    const bots = (await api("GET", "/api/bots")).body.bots;
    const created = await api("POST", "/api/routines", {
      botId: bots[0].id,
      name: "Daily brief",
      prompt: "Summarize what needs attention.",
      cadence: "daily",
    });
    expect(created.status).toBe(201);
    expect(created.body.routine).toMatchObject({ name: "Daily brief", cadence: "daily", enabled: true });

    const toggled = await api("PATCH", `/api/routines/${created.body.routine.id}`, { enabled: false });
    expect(toggled.body.routine.enabled).toBe(false);
    const listed = await api("GET", "/api/routines");
    expect(listed.body.routines.some((routine: { id: string }) => routine.id === created.body.routine.id)).toBe(true);
    expect((await api("DELETE", `/api/routines/${created.body.routine.id}`)).status).toBe(200);
  });

  it("404s unknown routes with the route in the error", async () => {
    const res = await api("GET", "/api/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("/api/definitely-not-a-route");
  });
});
