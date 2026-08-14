// Workspace capability MCP proxy — spawned inside a bot's agent process via
// the historical "agents" integration. It keeps the harness as the single
// owner of bot delegation, memory, routines, and capability truth.
//
//   list_bots()            → the other bots in this workspace + their status
//   ask_bot(bot_id, msg)   → send msg to that bot, wait, return its reply
//
// Speaks raw JSON-RPC 2.0 over stdio (no MCP SDK — house style, matches
// computer-proxy / permission-proxy). All state comes from env, injected by
// the harness when it builds the integration:
//   OMB_HARNESS_URL  base URL of the harness (http://127.0.0.1:8799)
//   OMB_BOT_ID       the calling bot's id (excluded from list_bots; sender)
//   OMB_COMMS_TOKEN  shared secret for the localhost-only internal endpoints
//   OMB_TURN_DEPTH   this turn's comms depth (the harness refuses recursion)
import readline from "node:readline";
import { resolveNamedItem } from "../capabilities.js";
const HARNESS = process.env.OMB_HARNESS_URL ?? "http://127.0.0.1:8799";
const BOT_ID = process.env.OMB_BOT_ID ?? "";
const TOKEN = process.env.OMB_COMMS_TOKEN ?? "";
const DEPTH = Number(process.env.OMB_TURN_DEPTH ?? "0") || 0;
const WORKSPACE_TOOLS = [
    {
        name: "list_capabilities",
        description: "Return the capabilities currently available to this bot and the recommended fallback order. Use when you are unsure whether connected apps, browser, computer, bots, memory, or routines are available.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "list_bots",
        description: "List the other bots (agents) in this OpenMausBot workspace you can message, with their model and whether they're busy. Call this before ask_bot to discover who's available.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "ask_bot",
        description: "Send a message to another bot in this workspace and wait for its reply. Use it to delegate a subtask to a specialist bot or ask a peer a question. The other bot runs a full turn under its own model and permissions; the reply is returned to you as text. Returns promptly with a note if that bot is busy.",
        inputSchema: {
            type: "object",
            properties: {
                bot_id: { type: "string", description: "The target bot's id from list_bots, when known." },
                bot_name: { type: "string", description: "A bot name or close spelling. Use when the user named a bot without an id." },
                message: { type: "string", description: "What to say / ask the bot." },
            },
            required: ["message"],
        },
    },
    {
        name: "search_memory",
        description: "Search user-managed workspace memory for preferences, facts, procedures, and project context before asking the user for information they may already have saved.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Words describing the information to recall." },
                limit: { type: "number", minimum: 1, maximum: 20 },
            },
            required: ["query"],
        },
    },
    {
        name: "remember",
        description: "Save something to user-managed memory only when the user explicitly asked to remember or save it. This creates persistent state; never infer consent from ordinary conversation.",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", description: "The concise fact, preference, procedure, or project context to save." },
                scope: { type: "string", enum: ["bot", "shared"], description: "Use bot unless the user asked all bots to remember it." },
                kind: { type: "string", enum: ["fact", "preference", "procedure", "project"] },
            },
            required: ["text"],
        },
    },
    {
        name: "list_routines",
        description: "List this bot's scheduled routines, including cadence, next run, and enabled state.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "create_routine",
        description: "Create persistent recurring work for this bot after the user explicitly requests scheduling. Resolve or ask for any unclear cadence, timezone, or wall-clock time before calling.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Short routine name." },
                prompt: { type: "string", description: "The complete task to run each time." },
                cadence: { type: "string", enum: ["once", "hourly", "daily", "weekdays", "weekly", "monthly", "yearly"] },
                timezone: { type: "string", description: "IANA timezone such as America/New_York." },
                at: { type: "string", description: "24-hour local time HH:MM. Omit only for hourly." },
            },
            required: ["name", "prompt", "cadence", "timezone"],
        },
    },
];
// Defense in depth: the harness does not mount this server on peer-invoked
// turns, but if a caller does spawn it at depth 1, delegation stays hidden.
const TOOLS = DEPTH >= 1
    ? WORKSPACE_TOOLS.filter((tool) => !["list_bots", "ask_bot"].includes(tool.name))
    : WORKSPACE_TOOLS;
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
const textResult = (id, text, isError = false) => ok(id, { content: [{ type: "text", text }], isError });
async function api(path, init) {
    const res = await fetch(HARNESS + path, {
        ...init,
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...(init?.headers ?? {}) },
    });
    const body = (await res.json().catch(() => ({})));
    if (!res.ok)
        throw new Error(String(body.error ?? `HTTP ${res.status}`));
    return body;
}
async function callTool(name, args) {
    if (name === "list_capabilities") {
        const r = await api(`/api/internal/capabilities?botId=${encodeURIComponent(BOT_ID)}`);
        return { text: JSON.stringify(r, null, 2) };
    }
    if (name === "list_bots") {
        const r = await api(`/api/internal/agents?self=${encodeURIComponent(BOT_ID)}`);
        const bots = r.bots ?? [];
        if (!bots.length)
            return { text: "No other bots in this workspace yet." };
        const lines = bots.map((b) => `- ${b.name} (id: ${b.id}, model: ${b.model}${b.busy ? ", busy" : ""})`);
        return { text: `Other bots you can message with ask_bot:\n${lines.join("\n")}` };
    }
    if (name === "ask_bot") {
        let toBotId = String(args.bot_id ?? "").trim();
        const botName = String(args.bot_name ?? "").trim();
        const message = String(args.message ?? "").trim();
        if (!message || (!toBotId && !botName))
            return { text: "ask_bot needs message and either bot_id or bot_name.", isError: true };
        if (!toBotId) {
            const roster = await api(`/api/internal/agents?self=${encodeURIComponent(BOT_ID)}`);
            const bots = (roster.bots ?? []).map((bot) => ({ id: String(bot.id), name: String(bot.name) }));
            const resolved = resolveNamedItem(botName, bots);
            if (!resolved.item) {
                const choices = resolved.ambiguous.map((bot) => `${bot.name} (${bot.id})`).join(", ");
                return { text: choices ? `Bot name is ambiguous. Ask the user to choose: ${choices}` : `No bot matched "${botName}".`, isError: true };
            }
            toBotId = resolved.item.id;
        }
        const r = await api(`/api/internal/ask-bot`, {
            method: "POST",
            body: JSON.stringify({ fromBotId: BOT_ID, toBotId, message, depth: DEPTH }),
        });
        if (r.busy)
            return { text: `That bot is busy right now — try again after it finishes.` };
        if (r.error)
            return { text: `Couldn't reach that bot: ${r.error}`, isError: true };
        return { text: `${r.botName ?? "Bot"} replied:\n${r.text ?? "(no reply)"}` };
    }
    if (name === "search_memory") {
        const query = String(args.query ?? "").trim();
        if (!query)
            return { text: "search_memory needs a query.", isError: true };
        const limit = Math.min(20, Math.max(1, Number(args.limit ?? 10) || 10));
        const r = await api(`/api/internal/memory?botId=${encodeURIComponent(BOT_ID)}&query=${encodeURIComponent(query)}&limit=${limit}`);
        const items = r.memories ?? [];
        if (!items.length)
            return { text: "No matching saved memory." };
        return { text: items.map((item) => `- [${item.kind}] ${item.text}`).join("\n") };
    }
    if (name === "remember") {
        const text = String(args.text ?? "").trim();
        if (!text)
            return { text: "remember needs text.", isError: true };
        const r = await api(`/api/internal/memory`, {
            method: "POST",
            body: JSON.stringify({ botId: BOT_ID, text, scope: args.scope, kind: args.kind }),
        });
        const item = r.memory;
        return { text: `Saved memory ${item.id}: [${item.kind}] ${item.text}` };
    }
    if (name === "list_routines") {
        const r = await api(`/api/internal/routines?botId=${encodeURIComponent(BOT_ID)}`);
        const items = r.routines ?? [];
        if (!items.length)
            return { text: "This bot has no scheduled routines." };
        return { text: items.map((item) => `- ${item.name} (id: ${item.id}, ${item.cadence}, ${item.enabled ? "enabled" : "disabled"}, next: ${new Date(Number(item.nextRunAt)).toISOString()})`).join("\n") };
    }
    if (name === "create_routine") {
        const r = await api(`/api/internal/routines`, {
            method: "POST",
            body: JSON.stringify({ botId: BOT_ID, name: args.name, prompt: args.prompt, cadence: args.cadence, timezone: args.timezone, at: args.at }),
        });
        const item = r.routine;
        return { text: `Created routine ${item.id}: ${item.name}; ${item.cadence}; next run ${new Date(Number(item.nextRunAt)).toISOString()}.` };
    }
    return { text: `Unknown tool: ${name}`, isError: true };
}
async function handle(msg) {
    const id = msg.id;
    const method = msg.method;
    if (!method)
        return;
    const params = (msg.params ?? {});
    switch (method) {
        case "initialize":
            ok(id, {
                protocolVersion: params.protocolVersion ?? "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "opengrokbot-agents", version: "0.1.0" },
            });
            return;
        case "notifications/initialized":
        case "notifications/cancelled":
            return;
        case "ping":
            ok(id, {});
            return;
        case "tools/list":
            ok(id, { tools: TOOLS });
            return;
        case "tools/call": {
            const name = params.name;
            if (!TOOLS.some((t) => t.name === name))
                return rpcErr(id, -32602, `Unknown tool: ${name}`);
            try {
                const { text, isError } = await callTool(name, (params.arguments ?? {}));
                textResult(id, text, isError);
            }
            catch (e) {
                textResult(id, e.message, true);
            }
            return;
        }
        default:
            if (id !== undefined)
                rpcErr(id, -32601, `Method not found: ${method}`);
    }
}
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
    const t = line.trim();
    if (!t)
        return;
    let msg;
    try {
        msg = JSON.parse(t);
    }
    catch {
        return;
    }
    void handle(msg).catch((e) => {
        if (msg.id !== undefined)
            rpcErr(msg.id, -32603, e.message);
    });
});
rl.on("close", () => process.exit(0));
