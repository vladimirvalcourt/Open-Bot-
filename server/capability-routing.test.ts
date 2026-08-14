import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");

posixOnly("universal capability routing e2e", () => {
  let child: ChildProcess;
  let home: string;
  let stderr = "";
  const appToken = "capability-test-local-app-token";

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${appToken}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() as any };
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-capability-test-"));
    mkdirSync(join(home, ".openmausbot"), { recursive: true });
    writeFileSync(join(home, ".openmausbot", "config.json"), JSON.stringify({
      instances: {
        grok: {
          driver: "grokAgent",
          environment: { FAKE_ACP_MODE: "workspace-tools" },
          config: { cli: FAKE_CLI, fullAuto: true },
        },
      },
    }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_APP_TOKEN: appToken },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (chunk) => (stderr += chunk));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error(`server never came up: ${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
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

  it("uses workspace tools on a normal turn even when there are no peer bots", async () => {
    const bot = (await api("GET", "/api/bots")).body.bots[0];
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "Remember my brief style and schedule it weekly." });
    expect(sent.status).toBe(202);

    const deadline = Date.now() + 20_000;
    let settled: any;
    for (;;) {
      settled = (await api("GET", "/api/bots")).body.bots.find((item: any) => item.id === bot.id);
      if (!settled.busy && settled.messages.some((message: any) => message.text?.includes("workspace says:"))) break;
      if (Date.now() > deadline) throw new Error(`turn did not settle: ${stderr}\n${JSON.stringify(settled.messages.slice(-6))}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const memory = (await api("GET", `/api/memory?botId=${bot.id}`)).body.memories;
    expect(memory).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "preference", text: "Use concise weekly briefs" })]));
    const routines = (await api("GET", "/api/routines")).body.routines;
    expect(routines).toEqual(expect.arrayContaining([expect.objectContaining({ botId: bot.id, name: "Weekly brief", cadence: "weekly", enabled: true })]));
    const reply = settled.messages.findLast((message: any) => message.kind === "text" && message.role === "bot");
    expect(reply.text).toContain("Weekly brief");
  }, 30_000);
});
