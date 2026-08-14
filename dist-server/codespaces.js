// GitHub Codespaces remote-computer provider. Codespaces is not a graphical
// desktop API, so OpenMausBot uses it for the part it actually guarantees:
// an isolated Linux machine with lifecycle control and SSH command execution.
// Browser work remains on the per-bot embedded browser.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { augmentedPath } from "./env-path.js";
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CODESPACE_NAME = /^[A-Za-z0-9-]+$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const MACHINE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export function configured(cfg) {
    return Boolean(cfg.codespaces?.token && validRepository(cfg.codespaces.repository));
}
export function validRepository(value) {
    return typeof value === "string" && REPOSITORY.test(value.trim());
}
export function validBranch(value) {
    if (value === "" || value === undefined)
        return true;
    return typeof value === "string" && BRANCH.test(value.trim()) && !value.includes("..") && !value.includes("//");
}
export function validMachine(value) {
    if (value === "" || value === undefined)
        return true;
    return typeof value === "string" && MACHINE.test(value.trim());
}
export function ghExecutable() {
    const candidates = [
        process.env.OMB_GH_CLI,
        resolve("build/github-cli/gh"),
        process.platform === "win32" ? resolve("build/github-cli/gh.exe") : undefined,
    ].filter((value) => Boolean(value));
    return candidates.find((candidate) => existsSync(candidate)) ?? "gh";
}
function envFor(cfg) {
    return {
        ...process.env,
        PATH: augmentedPath(),
        GH_TOKEN: cfg.codespaces?.token ?? "",
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
    };
}
export function runGh(cfg, args, timeoutMs = 120_000) {
    return new Promise((resolveRun, reject) => {
        const child = spawn(ghExecutable(), args, { env: envFor(cfg), stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            reject(new Error(`GitHub CLI timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
        timer.unref?.();
        child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 2_000_000)
            child.kill("SIGTERM"); });
        child.stderr.on("data", (chunk) => { stderr += chunk; if (stderr.length > 2_000_000)
            child.kill("SIGTERM"); });
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", (code) => {
            clearTimeout(timer);
            resolveRun({ exitCode: code, stdout, stderr });
        });
    });
}
function requireConfig(cfg) {
    if (!cfg.codespaces?.token)
        throw new Error("GitHub Codespaces token is not configured");
    if (!validRepository(cfg.codespaces.repository))
        throw new Error("Codespaces repository must be owner/repo");
    if (!validBranch(cfg.codespaces.branch))
        throw new Error("Codespaces branch contains unsupported characters");
    if (!validMachine(cfg.codespaces.machine))
        throw new Error("Codespaces machine name contains unsupported characters");
    return cfg.codespaces.repository.trim();
}
function displayName(botId) {
    const hash = createHash("sha256").update(botId).digest("hex").slice(0, 6);
    return `omb-${botId.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "")}-${hash}`;
}
async function list(cfg) {
    const repository = requireConfig(cfg);
    const result = await runGh(cfg, [
        "codespace", "list", "--repo", repository, "--limit", "100",
        "--json", "name,displayName,state,repository,machineName,lastUsedAt",
    ], 30_000);
    if (result.exitCode !== 0)
        throw new Error(result.stderr.trim() || "Could not list GitHub Codespaces");
    try {
        const parsed = JSON.parse(result.stdout);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        throw new Error("GitHub CLI returned invalid Codespaces data");
    }
}
export async function find(cfg, botId) {
    const wanted = displayName(botId);
    return (await list(cfg)).find((item) => item.displayName === wanted) ?? null;
}
export async function status(cfg, botId) {
    if (!configured(cfg))
        return { configured: false, provider: "codespaces", computer: null, capabilities: { screenshot: false } };
    const computer = await find(cfg, botId);
    return {
        configured: true,
        provider: "codespaces",
        computer: computer ? { id: computer.name, state: computer.state ?? "Unknown", displayName: computer.displayName } : null,
        capabilities: { screenshot: false, exec: true, join: true },
    };
}
async function waitAvailable(cfg, botId, budgetMs = 120_000) {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
        const codespace = await find(cfg, botId);
        if (codespace && /available|running/i.test(codespace.state ?? ""))
            return codespace;
        if (codespace && /shutdown|stopped/i.test(codespace.state ?? "")) {
            // `gh codespace ssh` wakes a stopped codespace; a cheap true command
            // is the most stable public CLI contract for doing so.
            await runRemote(cfg, codespace.name, "true", 60_000).catch(() => { });
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 2500));
    }
    return null;
}
export async function provision(cfg, botId, _botName) {
    const repository = requireConfig(cfg);
    let codespace = await find(cfg, botId);
    const reused = Boolean(codespace);
    if (!codespace) {
        const args = [
            "codespace", "create", "--repo", repository,
            "--display-name", displayName(botId),
            "--idle-timeout", "30m", "--retention-period", "72h",
            "--default-permissions",
        ];
        if (cfg.codespaces?.branch?.trim())
            args.push("--branch", cfg.codespaces.branch.trim());
        if (cfg.codespaces?.machine?.trim())
            args.push("--machine", cfg.codespaces.machine.trim());
        const created = await runGh(cfg, args, 180_000);
        if (created.exitCode !== 0)
            throw new Error(created.stderr.trim() || "GitHub Codespace creation failed");
    }
    codespace = await waitAvailable(cfg, botId);
    if (!codespace)
        throw new Error("GitHub Codespace did not become available within two minutes");
    return {
        boxId: codespace.name,
        machineName: codespace.displayName ?? displayName(botId),
        reused,
        state: codespace.state ?? "Available",
        joinUrl: `https://github.com/codespaces/${encodeURIComponent(codespace.name)}`,
        provider: "codespaces",
        capabilities: { screenshot: false, exec: true, join: true },
    };
}
export async function join(cfg, botId) {
    const codespace = await find(cfg, botId);
    if (!codespace)
        throw new Error("no Codespace yet — provision it first");
    const ready = await waitAvailable(cfg, botId);
    if (!ready)
        throw new Error("the Codespace did not wake in time");
    return { joinUrl: `https://github.com/codespaces/${encodeURIComponent(ready.name)}`, state: ready.state ?? null };
}
export async function sleep(cfg, botId) {
    const codespace = await find(cfg, botId);
    if (!codespace)
        throw new Error("no Codespace for this bot");
    const result = await runGh(cfg, ["codespace", "stop", "--codespace", codespace.name], 60_000);
    if (result.exitCode !== 0)
        throw new Error(result.stderr.trim() || "Could not stop the Codespace");
    return { ok: true };
}
export async function runRemote(cfg, codespaceName, command, timeoutMs = 120_000) {
    if (!CODESPACE_NAME.test(codespaceName))
        throw new Error("invalid Codespace name");
    const bounded = String(command ?? "").slice(0, 4000);
    const result = await runGh(cfg, ["codespace", "ssh", "--codespace", codespaceName, "--", "-T", bounded], timeoutMs);
    return { ok: result.exitCode === 0, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}
export async function exec(cfg, botId, command) {
    let codespace = await find(cfg, botId);
    if (!codespace)
        throw new Error("no Codespace for this bot yet");
    if (!/available|running/i.test(codespace.state ?? ""))
        codespace = await waitAvailable(cfg, botId, 90_000);
    if (!codespace)
        throw new Error("Codespace did not wake");
    const out = await runRemote(cfg, codespace.name, command);
    return { exitCode: out.exitCode, stdout: out.stdout.slice(-6000), stderr: out.stderr.slice(-2000) };
}
export async function integration(cfg, botId, proxyPath, nodeCommand, nodeEnv) {
    const codespace = await find(cfg, botId);
    if (!codespace)
        return null;
    return {
        command: nodeCommand,
        args: [proxyPath],
        env: {
            ...nodeEnv,
            OMB_GH_CLI: ghExecutable(),
            OMB_CODESPACE_NAME: codespace.name,
            OMB_CODESPACES_TOKEN: cfg.codespaces?.token ?? "",
        },
    };
}
