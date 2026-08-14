import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.js";
import { newId } from "./contracts.js";
const FILE = join(DATA_DIR, "routines.json");
const cadenceMs = {
    hourly: 60 * 60_000,
    once: Number.POSITIVE_INFINITY,
    daily: 24 * 60 * 60_000,
    weekdays: 24 * 60 * 60_000,
    weekly: 7 * 24 * 60 * 60_000,
    monthly: 30 * 24 * 60 * 60_000,
    yearly: 365 * 24 * 60 * 60_000,
};
function partsInZone(date, timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}
/** Next schedule occurrence with explicit wall-clock time and timezone.
 * Search minute-by-minute only across a narrow 400-day ceiling; this avoids
 * silently applying the host Mac's timezone or breaking across DST changes. */
export function nextRun(cadence, from = Date.now(), timezone, at) {
    if (!timezone || !/^([01]\d|2[0-3]):[0-5]\d$/.test(at ?? "") || cadence === "hourly")
        return cadence === "once" ? from : from + cadenceMs[cadence];
    const [hour, minute] = at.split(":");
    const base = partsInZone(new Date(from), timezone);
    for (let candidate = from + 60_000; candidate <= from + 400 * 24 * 60 * 60_000; candidate += 60_000) {
        const value = partsInZone(new Date(candidate), timezone);
        if (value.hour !== hour || value.minute !== minute)
            continue;
        const days = Math.round((Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day)) - Date.UTC(Number(base.year), Number(base.month) - 1, Number(base.day))) / 86_400_000);
        if (cadence === "once" || cadence === "daily" || (cadence === "weekdays" && !["Sat", "Sun"].includes(value.weekday)) || (cadence === "weekly" && days >= 7) || (cadence === "monthly" && value.day === base.day && days >= 27) || (cadence === "yearly" && value.day === base.day && value.month === base.month && days >= 360))
            return candidate;
    }
    throw new Error("could not calculate the next scheduled time");
}
export class RoutineStore {
    routines = [];
    constructor() {
        mkdirSync(DATA_DIR, { recursive: true });
        try {
            this.routines = JSON.parse(readFileSync(FILE, "utf8"));
        }
        catch {
            this.routines = [];
        }
    }
    save() {
        writeFileSync(FILE, JSON.stringify(this.routines, null, 2), { mode: 0o600 });
        try {
            chmodSync(FILE, 0o600);
        }
        catch { }
    }
    create(input) {
        const routine = {
            id: newId(),
            botId: input.botId,
            name: input.name.trim(),
            prompt: input.prompt.trim(),
            cadence: input.cadence,
            enabled: input.enabled ?? true,
            nextRunAt: nextRun(input.cadence, Date.now(), input.timezone, input.at),
            createdAt: Date.now(),
            timezone: input.timezone,
            at: input.at,
            trigger: input.trigger ?? { type: "schedule" },
            retryLimit: Math.min(5, Math.max(0, input.retryLimit ?? 1)),
        };
        this.routines.unshift(routine);
        this.save();
        return routine;
    }
    patch(id, patch) {
        const routine = this.routines.find((item) => item.id === id);
        if (!routine)
            return null;
        Object.assign(routine, patch);
        if ((patch.cadence || patch.timezone || patch.at) && patch.nextRunAt === undefined)
            routine.nextRunAt = nextRun(patch.cadence ?? routine.cadence, Date.now(), patch.timezone ?? routine.timezone, patch.at ?? routine.at);
        this.save();
        return routine;
    }
    delete(id) {
        const before = this.routines.length;
        this.routines = this.routines.filter((item) => item.id !== id);
        if (this.routines.length !== before)
            this.save();
        return this.routines.length !== before;
    }
}
