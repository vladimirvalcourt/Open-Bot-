import { describe, expect, it } from "vitest";
import { nextRun } from "./routines.ts";

describe("nextRun", () => {
  it("honors wall-clock time across the spring DST transition", () => {
    const from = Date.parse("2026-03-07T15:00:00Z");
    const next = nextRun("daily", from, "America/New_York", "09:00");
    expect(new Date(next).toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });
  it("skips weekends", () => {
    const from = Date.parse("2026-08-14T15:00:00Z"); // Friday
    const next = nextRun("weekdays", from, "America/New_York", "09:00");
    expect(new Date(next).toISOString()).toBe("2026-08-17T13:00:00.000Z");
  });
});
