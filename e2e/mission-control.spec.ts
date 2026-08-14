import { expect, test } from "@playwright/test";
import { closeOpenMausBot, launchOpenMausBot } from "./helpers";

test("Mission Control exposes trust, setup, and emergency stop", async () => {
  const launched = await launchOpenMausBot();
  try {
    await launched.page.evaluate(() => localStorage.setItem("omb-email-gate", "skipped"));
    await launched.page.reload();
    await launched.page.getByRole("button", { name: "Mission Control", exact: true }).click();
    await expect(launched.page.getByText("Trust, reliability, setup, data, and workspace administration.")).toBeVisible();
    await launched.page.getByRole("button", { name: "trust", exact: true }).click();
    await expect(launched.page.getByText("Default autonomy")).toBeVisible();
    await launched.page.getByRole("button", { name: "Stop all bots" }).click();
    await expect(launched.page.getByText("All bots stopped")).toBeVisible();
    await launched.page.getByRole("button", { name: "Resume bots" }).click();
    await expect(launched.page.getByText("Bots are available")).toBeVisible();
    await launched.page.getByRole("button", { name: "setup", exact: true }).click();
    await expect(launched.page.getByText(/Setup needs attention|Commercial setup certified/)).toBeVisible();
  } finally {
    await closeOpenMausBot(launched);
  }
});
