import { expect, test } from "@playwright/test";
import { closeOpenMausBot, launchOpenMausBot } from "./helpers";

test("Work renders stored runtime codes as customer language", async () => {
  const launched = await launchOpenMausBot();
  try {
    await launched.page.evaluate(() => localStorage.setItem("omb-email-gate", "skipped"));
    await launched.page.reload();
    await launched.page.getByRole("button", { name: "Work", exact: true }).click();
    await expect(launched.page.locator("body")).not.toContainText(/\bauth_required\b|\bexit_before_result\b/);
  } finally {
    await closeOpenMausBot(launched);
  }
});
