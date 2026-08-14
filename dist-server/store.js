// Bot + thread persistence. bots.json holds bot records (including the
// thread→instance binding and per-instance resume cursors — upstream's
// ProviderSessionDirectory, recipe step 6: persist the binding from day
// one). messages-<threadId>.json holds the folded transcript.
import { chmodSync, copyFileSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.js";
import { newId } from "./contracts.js";
const BOTS_FILE = join(DATA_DIR, "bots.json");
const BOTS_BACKUP_FILE = `${BOTS_FILE}.bak`;
const DELETED_DIR = join(DATA_DIR, "deleted");
const messagesFile = (threadId) => join(DATA_DIR, `messages-${threadId}.json`);
const COLORS = [
    "green",
    "blue",
    "red",
    "orange",
    "purple",
    "cyan",
    "pink",
    "yellow",
    "teal",
    "coral",
];
/** Resolve @mentions in a message against a bot roster: `@` must start a
 * word, names match case-insensitively, longest name wins (so "@New Bot 2"
 * never half-matches "New Bot"), hidden bots skipped, results deduped.
 * Callers pre-filter the sender out of `peers`. */
export function mentionedBots(text, peers) {
    const candidates = peers
        .filter((p) => !p.hidden && p.name.trim())
        .sort((a, b) => b.name.length - a.name.length);
    const lower = text.toLowerCase();
    const found = [];
    let at = -1;
    while ((at = lower.indexOf("@", at + 1)) !== -1) {
        if (at > 0 && !/\s/.test(text[at - 1]))
            continue; // user@host, not a tag
        const rest = lower.slice(at + 1);
        const hit = candidates.find((p) => rest.startsWith(p.name.toLowerCase()));
        if (hit && !found.includes(hit))
            found.push(hit);
    }
    return found;
}
const onboardingCard = () => ({
    title: "What do you mostly want help with?",
    subtitle: "Pick whatever's closest; we can always expand from there.",
    options: ["Work & projects", "Writing & research", "Life admin", "A bit of everything"],
});
function nextVladbotName(existing) {
    const names = new Set([...existing].map((name) => name.trim().toLowerCase()));
    if (!names.has("vladbot"))
        return "Vladbot";
    for (let suffix = 2;; suffix += 1) {
        const candidate = `Vladbot ${suffix}`;
        if (!names.has(candidate.toLowerCase()))
            return candidate;
    }
}
export class Store {
    bots = [];
    messages = new Map();
    defaultSelection;
    constructor(defaultSelection) {
        this.defaultSelection = defaultSelection;
        mkdirSync(DATA_DIR, { recursive: true });
        try {
            this.bots = JSON.parse(readFileSync(BOTS_FILE, "utf8"));
        }
        catch {
            try {
                this.bots = JSON.parse(readFileSync(BOTS_BACKUP_FILE, "utf8"));
            }
            catch {
                this.bots = [];
            }
        }
        // Busy never survives a restart — no turn does either. Migrate only the
        // untouched legacy default; names chosen by users are never rewritten.
        let migratedDefaultName = false;
        const occupiedNames = this.bots.filter((bot) => bot.name !== "New Bot").map((bot) => bot.name);
        for (const b of this.bots) {
            b.busy = false;
            b.projectId ??= "default";
            if (b.name === "New Bot") {
                b.name = nextVladbotName(occupiedNames);
                occupiedNames.push(b.name);
                migratedDefaultName = true;
                const messages = this.messagesFor(b.threadId);
                const greeting = messages.find((message) => message.role === "bot" && message.kind === "text");
                if (greeting?.text === "Hey — I'm your new bot. Nice to meet you.") {
                    greeting.text = `Hey — I'm ${b.name}. Nice to meet you.`;
                    writeFileSync(messagesFile(b.threadId), JSON.stringify(messages, null, 2), { mode: 0o600 });
                    try {
                        chmodSync(messagesFile(b.threadId), 0o600);
                    }
                    catch { }
                }
            }
        }
        if (migratedDefaultName)
            this.saveBots();
    }
    saveBots() {
        const temp = `${BOTS_FILE}.tmp`;
        if (this.bots.length === 0) {
            // Keep one recoverable snapshot before committing an empty registry.
            // A malformed/transient read must never be amplified into permanent
            // deletion on the next unrelated save.
            try {
                copyFileSync(BOTS_FILE, BOTS_BACKUP_FILE);
            }
            catch { }
        }
        writeFileSync(temp, JSON.stringify(this.bots, null, 2), { mode: 0o600 });
        renameSync(temp, BOTS_FILE);
        try {
            chmodSync(BOTS_FILE, 0o600);
        }
        catch { }
    }
    messagesFor(threadId) {
        let list = this.messages.get(threadId);
        if (!list) {
            try {
                list = JSON.parse(readFileSync(messagesFile(threadId), "utf8"));
            }
            catch {
                list = [];
            }
            this.messages.set(threadId, list);
        }
        return list;
    }
    appendMessage(threadId, message) {
        const full = { id: newId(), at: Date.now(), ...message };
        const list = this.messagesFor(threadId);
        list.push(full);
        writeFileSync(messagesFile(threadId), JSON.stringify(list, null, 2), { mode: 0o600 });
        try {
            chmodSync(messagesFile(threadId), 0o600);
        }
        catch { }
        return full;
    }
    patchMessage(threadId, messageId, patch) {
        const list = this.messagesFor(threadId);
        const idx = list.findIndex((m) => m.id === messageId);
        if (idx === -1)
            return null;
        list[idx] = { ...list[idx], ...patch, card: patch.card ?? list[idx].card };
        writeFileSync(messagesFile(threadId), JSON.stringify(list, null, 2), { mode: 0o600 });
        try {
            chmodSync(messagesFile(threadId), 0o600);
        }
        catch { }
        return list[idx];
    }
    bot(id) {
        return this.bots.find((b) => b.id === id) ?? null;
    }
    botByThread(threadId) {
        return this.bots.find((b) => b.threadId === threadId) ?? null;
    }
    createBot() {
        const name = nextVladbotName(this.bots.map((bot) => bot.name));
        const bot = {
            id: newId(),
            threadId: newId(),
            name,
            title: "",
            description: "",
            notifications: true,
            color: COLORS[this.bots.length % COLORS.length],
            unread: false,
            modelSelection: this.defaultSelection(),
            resumeCursors: {},
            projectId: "default",
            createdAt: Date.now(),
        };
        this.bots.unshift(bot);
        this.saveBots();
        this.appendMessage(bot.threadId, {
            role: "bot",
            kind: "text",
            text: `Hey — I'm ${name}. Nice to meet you.`,
        });
        this.appendMessage(bot.threadId, { role: "bot", kind: "options", card: onboardingCard() });
        return bot;
    }
    deleteBot(id) {
        const bot = this.bot(id);
        if (!bot)
            return false;
        // Preserve a recoverable deletion record and transcript before removing
        // either from the live registry. This also covers deleting one of many
        // bots, where the empty-registry backup below would not run.
        const deletedAt = Date.now();
        mkdirSync(DELETED_DIR, { recursive: true });
        writeFileSync(join(DELETED_DIR, `bot-${bot.id}-${deletedAt}.json`), JSON.stringify(bot, null, 2), { mode: 0o600 });
        try {
            renameSync(messagesFile(bot.threadId), join(DELETED_DIR, `messages-${bot.threadId}-${deletedAt}.json`));
        }
        catch { }
        this.bots = this.bots.filter((b) => b.id !== id);
        this.messages.delete(bot.threadId);
        this.saveBots();
        return true;
    }
    patchBot(id, patch) {
        const bot = this.bot(id);
        if (!bot)
            return null;
        Object.assign(bot, patch);
        this.saveBots();
        return bot;
    }
    setResumeCursor(botId, instanceId, cursor) {
        const bot = this.bot(botId);
        if (!bot)
            return;
        bot.resumeCursors[instanceId] = cursor;
        this.saveBots();
    }
    /** First-run seed: one bot so the app never opens empty. */
    seedIfEmpty() {
        if (this.bots.length)
            return;
        const bot = this.createBot();
        this.patchBot(bot.id, { color: "blue" });
    }
}
