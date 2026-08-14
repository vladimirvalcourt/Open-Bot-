import { expect, test } from "@playwright/test";
import { closeOpenMausBot, launchOpenMausBot } from "./helpers";

test("starter bot is Vladbot and can be renamed in bot settings", async () => {
  const launched = await launchOpenMausBot();
  try {
    await launched.page.evaluate(() => localStorage.setItem("omb-email-gate", "skipped"));
    await launched.page.reload();

    await expect(launched.page.getByText("Vladbot", { exact: true }).first()).toBeVisible();
    await launched.page.getByTitle("Bot settings").click();
    const name = launched.page.getByLabel("Bot name");
    await expect(name).toHaveValue("Vladbot");
    await name.fill("My helper");
    await expect(launched.page.getByText("My helper", { exact: true }).first()).toBeVisible();
  } finally {
    await closeOpenMausBot(launched);
  }
});
