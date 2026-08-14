import { expect, test } from "@playwright/test";
import { closeOpenMausBot, launchOpenMausBot } from "./helpers";

test("packaged-style desktop profile keeps projects isolated from real user data", async () => {
  const launched = await launchOpenMausBot();
  try {
    await launched.page.evaluate(() => localStorage.setItem("omb-email-gate", "skipped"));
    await launched.page.reload();
    await expect(launched.page.getByRole("button", { name: "Work", exact: true })).toBeVisible();
    await launched.page.getByRole("button", { name: "Work", exact: true }).click();
    await expect(launched.page.getByText("Tasks, completed runs, failures, and decisions that need you.")).toBeVisible();
    await launched.page.getByPlaceholder("New project").fill("E2E Project");
    await launched.page.getByTitle("Create project").click();
    await expect(launched.page.getByRole("option", { name: /E2E Project/ })).toBeAttached();
  } finally {
    await closeOpenMausBot(launched);
  }
});
