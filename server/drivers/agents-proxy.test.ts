// Contract test for the agent-to-agent comms MCP proxy (agents-proxy.ts):
// spawn it exactly the way a driver's mcpServers entry does (process.execPath
// + entry file + env) against a scripted stub of the harness's /api/internal
// endpoints, and drive the MCP stdio surface end to end. No shebang, no
// shell — plain node child, so this runs on every OS like index.test.ts.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROXY = join(dirname(fileURLToPath(import.meta.url)), "agents-proxy.ts");
const TOKEN = "test-comms-token";

// scripted harness stub
let stub: Server;
let stubPort = 0;
let lastAuth: string | undefined;
let lastAskBody: any = null;
let lastMemoryBody: any = null;
let lastRoutineBody: any = null;
let askResponse: unknown = { botName: "Helper", text: "hi from helper" };

let child: ChildProcess;
const pending = new Map<number, (msg: any) => void>();
let nextId = 100;

function rpc(method: string, params?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out`));
    }, 10_000).unref?.();
  });
}
const callTool = (name: string, args: unknown) => rpc("tools/call", { name, arguments: args });

beforeAll(async () => {
  stub = createServer((req, res) => {
    lastAuth = req.headers.authorization;
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    if (req.method === "GET" && req.url?.startsWith("/api/internal/agents")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          bots: [{ id: "bot-helper", name: "Helper", model: "fake-model", busy: false }],
        }),
      );
    }
    if (req.method === "GET" && req.url?.startsWith("/api/internal/capabilities")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ capabilities: { connectedApps: true, browser: true, memory: true, routines: true }, fallbackOrder: ["connectedApps", "browser", "computer"] }));
    }
    if (req.method === "GET" && req.url?.startsWith("/api/internal/memory")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ memories: [{ id: "m1", kind: "preference", text: "Use concise email" }] }));
    }
    if (req.method === "GET" && req.url?.startsWith("/api/internal/routines")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ routines: [{ id: "r1", name: "Weekly brief", cadence: "weekly", enabled: true, nextRunAt: Date.UTC(2030, 0, 1) }] }));
    }
    const receive = (done: (body: any) => void) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => done(JSON.parse(data)));
    };
    if (req.method === "POST" && req.url === "/api/internal/memory") {
      return receive((body) => {
        lastMemoryBody = body;
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ memory: { id: "m2", kind: body.kind ?? "fact", text: body.text } }));
      });
    }
    if (req.method === "POST" && req.url === "/api/internal/routines") {
      return receive((body) => {
        lastRoutineBody = body;
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ routine: { id: "r2", name: body.name, cadence: body.cadence, nextRunAt: Date.UTC(2030, 0, 2) } }));
      });
    }
    if (req.method === "POST" && req.url === "/api/internal/ask-bot") {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        lastAskBody = JSON.parse(data);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(askResponse));
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unknown" }));
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  stubPort = (stub.address() as { port: number }).port;

  child = spawn(process.execPath, [PROXY], {
    env: {
      ...process.env,
      OMB_HARNESS_URL: `http://127.0.0.1:${stubPort}`,
      OMB_BOT_ID: "bot-asker",
      OMB_COMMS_TOKEN: TOKEN,
      OMB_TURN_DEPTH: "0",
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buf = "";
  child.stdout!.on("data", (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });
});

afterAll(async () => {
  child?.kill();
  await new Promise<void>((r) => stub.close(() => r()));
});

describe("agents-proxy MCP surface", () => {
  it("answers the MCP handshake and lists all workspace tools", async () => {
    const init = await rpc("initialize", { protocolVersion: "2024-11-05" });
    expect(init.result.serverInfo.name).toContain("agents");
    const list = await rpc("tools/list");
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "list_capabilities", "list_bots", "ask_bot", "search_memory", "remember", "list_routines", "create_routine",
    ]);
  });

  it("returns the live capability registry", async () => {
    const res = await callTool("list_capabilities", {});
    expect(res.result.content[0].text).toContain('"connectedApps": true');
    expect(res.result.content[0].text).toContain("fallbackOrder");
  });

  it("list_bots renders the roster and authenticates with the shared token", async () => {
    const res = await callTool("list_bots", {});
    const text = res.result.content[0].text;
    expect(text).toContain("Helper");
    expect(text).toContain("bot-helper");
    expect(lastAuth).toBe(`Bearer ${TOKEN}`);
  });

  it("ask_bot forwards sender + depth and returns the reply", async () => {
    askResponse = { botName: "Helper", text: "hi from helper" };
    const res = await callTool("ask_bot", { bot_id: "bot-helper", message: "ping" });
    expect(res.result.content[0].text).toContain("Helper replied:");
    expect(res.result.content[0].text).toContain("hi from helper");
    expect(lastAskBody).toMatchObject({ fromBotId: "bot-asker", toBotId: "bot-helper", message: "ping", depth: 0 });
  });

  it("resolves a misspelled bot name before delegation", async () => {
    askResponse = { botName: "Helper", text: "resolved" };
    const res = await callTool("ask_bot", { bot_name: "Helpr", message: "ping" });
    expect(res.result.content[0].text).toContain("resolved");
    expect(lastAskBody.toBotId).toBe("bot-helper");
  });

  it("searches and saves memory through the harness", async () => {
    const searched = await callTool("search_memory", { query: "email style" });
    expect(searched.result.content[0].text).toContain("Use concise email");
    const saved = await callTool("remember", { text: "Use short subjects", kind: "preference", scope: "shared" });
    expect(saved.result.content[0].text).toContain("Saved memory m2");
    expect(lastMemoryBody).toMatchObject({ botId: "bot-asker", text: "Use short subjects", kind: "preference", scope: "shared" });
  });

  it("lists and creates scheduled routines through the harness", async () => {
    const listed = await callTool("list_routines", {});
    expect(listed.result.content[0].text).toContain("Weekly brief");
    const created = await callTool("create_routine", { name: "Digest", prompt: "Send a digest", cadence: "weekly", timezone: "America/New_York", at: "09:00" });
    expect(created.result.content[0].text).toContain("Created routine r2");
    expect(lastRoutineBody).toMatchObject({ botId: "bot-asker", name: "Digest", cadence: "weekly", timezone: "America/New_York", at: "09:00" });
  });

  it("renders a busy peer as a clean answer, not an error", async () => {
    askResponse = { busy: true };
    const res = await callTool("ask_bot", { bot_id: "bot-helper", message: "ping" });
    expect(res.result.content[0].text).toContain("busy");
    expect(res.result.isError).toBeFalsy();
  });

  it("surfaces the harness's depth refusal as a tool error", async () => {
    askResponse = { error: "message chains are limited to one hop" };
    const res = await callTool("ask_bot", { bot_id: "bot-helper", message: "ping" });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("one hop");
  });

  it("rejects unknown tools with -32602", async () => {
    const res = await rpc("tools/call", { name: "made_up", arguments: {} });
    expect(res.error.code).toBe(-32602);
  });

  it("requires a bot target and message", async () => {
    const res = await callTool("ask_bot", { bot_id: "", message: "" });
    expect(res.result.isError).toBe(true);
  });
});
