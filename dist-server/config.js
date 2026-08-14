// Config + data dirs. One file, ~/.openmausbot/config.json, env fallbacks:
//   { "xai": {"key":"xai-…"}, "composio": {"apiKey":"ak_…"}, "box": {"token":"…"},
//     "codespaces": {"token":"…", "repository":"owner/repo"},
//     "cloud": {"provider":"codespaces"},
//     "instances": { "<instanceId>": {"driver":"grok", …} } }
import { chmodSync, readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deleteKeychainSecret, keychainEnabled, migrateLegacyKeychainSecrets, readKeychainSecret, secretAccount, writeKeychainSecret } from "./keychain.js";
export const DATA_DIR = process.env.OMB_DATA_DIR || join(homedir(), ".openmausbot");
const LEGACY_DATA_DIR = join(homedir(), ".opengrokbot");
export const EVENTS_DIR = join(DATA_DIR, "events");
export const NATIVE_DIR = join(DATA_DIR, "native");
export function ensureDirs() {
    // one-time migration from the pre-rename data dir — bots, transcripts,
    // config and keys all carry over
    if (!existsSync(DATA_DIR) && existsSync(LEGACY_DATA_DIR)) {
        try {
            renameSync(LEGACY_DATA_DIR, DATA_DIR);
        }
        catch {
            /* cross-device or busy — fall through to a fresh dir */
        }
    }
    for (const dir of [DATA_DIR, EVENTS_DIR, NATIVE_DIR]) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        try {
            chmodSync(dir, 0o700);
        }
        catch { }
    }
    // Conversations, provider protocol logs, webhook secrets, and screenshots
    // all live below DATA_DIR. Repair legacy umask-created 0644/0755 entries on
    // every boot, without following symlinks outside the application directory.
    const harden = (dir) => {
        let entries = [];
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const path = join(dir, entry.name);
            let stat;
            try {
                stat = lstatSync(path);
            }
            catch {
                continue;
            }
            if (stat.isSymbolicLink())
                continue;
            if (stat.isDirectory()) {
                try {
                    chmodSync(path, 0o700);
                }
                catch { }
                harden(path);
            }
            else if (stat.isFile()) {
                try {
                    chmodSync(path, 0o600);
                }
                catch { }
            }
        }
    };
    harden(DATA_DIR);
}
export function loadConfig() {
    let cfg = {};
    const configPath = join(DATA_DIR, "config.json");
    try {
        cfg = JSON.parse(readFileSync(configPath, "utf8"));
    }
    catch {
        /* first run — env fallbacks below */
    }
    cfg.xai = { key: process.env.XAI_API_KEY, ...cfg.xai };
    cfg.composio = { apiKey: process.env.COMPOSIO_API_KEY, ...cfg.composio };
    cfg.box = { token: process.env.BOX_TOKEN, ...cfg.box };
    cfg.codespaces = { token: process.env.GITHUB_CODESPACES_TOKEN, ...cfg.codespaces };
    if (keychainEnabled()) {
        let migrated = false;
        const sections = [
            ["xai", "key"], ["composio", "apiKey"], ["box", "token"], ["codespaces", "token"], ["remote", "token"],
        ];
        migrateLegacyKeychainSecrets([
            ...sections.map(([section, field]) => secretAccount(section, field)),
            ...Object.keys(cfg.apiProviders ?? {}).map((id) => secretAccount("apiProviders", "apiKey", id)),
        ]);
        for (const [section, field] of sections) {
            const record = cfg[section];
            const account = secretAccount(section, field);
            const diskValue = typeof record?.[field] === "string" ? String(record[field]) : "";
            if (diskValue && writeKeychainSecret(account, diskValue)) {
                delete record[field];
                migrated = true;
            }
            const stored = readKeychainSecret(account);
            if (stored) {
                if (!cfg[section])
                    cfg[section] = {};
                cfg[section][field] = stored;
            }
        }
        for (const [id, provider] of Object.entries(cfg.apiProviders ?? {})) {
            const account = secretAccount("apiProviders", "apiKey", id);
            if (provider.apiKey && writeKeychainSecret(account, provider.apiKey)) {
                delete provider.apiKey;
                migrated = true;
            }
            const stored = readKeychainSecret(account);
            if (stored)
                provider.apiKey = stored;
        }
        if (migrated) {
            const sanitized = structuredClone(cfg);
            for (const [section, field] of sections)
                if (sanitized[section])
                    delete sanitized[section][field];
            for (const provider of Object.values(sanitized.apiProviders ?? {}))
                delete provider.apiKey;
            mkdirSync(DATA_DIR, { recursive: true });
            writeFileSync(configPath, JSON.stringify(sanitized, null, 2), { mode: 0o600 });
            try {
                chmodSync(configPath, 0o600);
            }
            catch { }
        }
    }
    return cfg;
}
/** Merge a partial config into ~/.openmausbot/config.json (secrets never
 * echoed back — callers report configured-or-not booleans only). */
export function saveConfig(patch) {
    const p = join(DATA_DIR, "config.json");
    let disk = {};
    try {
        disk = JSON.parse(readFileSync(p, "utf8"));
    }
    catch {
        /* first write */
    }
    const secretFields = { xai: "key", composio: "apiKey", box: "token", codespaces: "token", remote: "token" };
    for (const key of ["xai", "composio", "box", "codespaces", "cloud", "profile", "apiProviders", "remote", "limits"]) {
        if (patch[key] && typeof patch[key] === "object") {
            const incoming = structuredClone(patch[key]);
            if (key === "apiProviders") {
                const current = { ...(disk.apiProviders ?? {}) };
                for (const [id, raw] of Object.entries(incoming)) {
                    const provider = structuredClone(raw);
                    if (provider.apiKey !== undefined && keychainEnabled()) {
                        const value = String(provider.apiKey ?? "");
                        const ok = value ? writeKeychainSecret(secretAccount("apiProviders", "apiKey", id), value) : deleteKeychainSecret(secretAccount("apiProviders", "apiKey", id));
                        if (ok)
                            delete provider.apiKey;
                    }
                    current[id] = { ...(current[id] ?? {}), ...provider };
                }
                disk.apiProviders = current;
                continue;
            }
            const secretField = secretFields[key];
            if (secretField && incoming[secretField] !== undefined && keychainEnabled()) {
                const value = String(incoming[secretField] ?? "");
                const ok = value ? writeKeychainSecret(secretAccount(key, secretField), value) : deleteKeychainSecret(secretAccount(key, secretField));
                if (ok) {
                    delete incoming[secretField];
                    if (disk[key] && typeof disk[key] === "object")
                        delete disk[key][secretField];
                }
            }
            disk[key] = { ...disk[key], ...incoming };
        }
    }
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(p, JSON.stringify(disk, null, 2));
    // This file contains provider credentials. Tighten permissions even when it
    // existed before API-provider support or the user's umask is permissive.
    try {
        chmodSync(p, 0o600);
    }
    catch { }
}
export function removeApiProvider(id) {
    const p = join(DATA_DIR, "config.json");
    let disk = {};
    try {
        disk = JSON.parse(readFileSync(p, "utf8"));
    }
    catch { }
    if (disk.apiProviders && typeof disk.apiProviders === "object")
        delete disk.apiProviders[id];
    deleteKeychainSecret(secretAccount("apiProviders", "apiKey", id));
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(p, JSON.stringify(disk, null, 2), { mode: 0o600 });
    try {
        chmodSync(p, 0o600);
    }
    catch { }
}
// Default fleet: one instance per built-in driver (upstream
// defaultInstanceIdForDriver — instanceId defaults to the driver kind).
// Config-file keys are injected as per-instance environment so drivers
// see them without needing real process env vars.
export function instanceConfigs(cfg) {
    // The default `grok` instance rides the `grokAgent` driver, not the API-key
    // one: like claude and codex it needs no credential from us, just the CLI
    // installed and logged in (it shows up unavailable otherwise). The API-key
    // `grok` driver stays registered but out of the default fleet — that key is
    // a credential Milind doesn't want to manage; an `instances` entry brings
    // it back anytime.
    const configured = cfg.instances && Object.keys(cfg.instances).length
        ? cfg.instances
        : {
            grok: { driver: "grokAgent" },
            gemini: { driver: "geminiAgent" },
            kimi: { driver: "kimiAgent" },
            claude: { driver: "claudeAgent" },
            codex: { driver: "codex" },
            computer: { driver: "boxAgent" },
        };
    // Work on a fresh map: provider reloads must never smuggle generated API
    // instances or injected secret environments back into cfg.instances.
    const map = Object.fromEntries(Object.entries(configured).map(([id, entry]) => [
        id,
        { ...entry, environment: { ...(entry.environment ?? {}) } },
    ]));
    for (const [id, provider] of Object.entries(cfg.apiProviders ?? {})) {
        if (!provider?.name || !provider.baseUrl || !provider.model || !provider.apiKey)
            continue;
        map[`api-${id}`] = {
            driver: "openaiCompatible",
            displayName: provider.name,
            environment: { API_KEY: provider.apiKey },
            config: { baseUrl: provider.baseUrl, model: provider.model },
        };
    }
    for (const entry of Object.values(map)) {
        entry.environment = {
            ...(cfg.xai?.key ? { XAI_API_KEY: cfg.xai.key } : {}),
            ...(cfg.box?.token ? { BOX_TOKEN: cfg.box.token } : {}),
            ...entry.environment,
        };
    }
    return map;
}
