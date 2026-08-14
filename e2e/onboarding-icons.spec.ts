import { expect, test } from "@playwright/test";
import { closeOpenMausBot, launchOpenMausBot } from "./helpers";

test("engine status uses bare Phosphor icons without colored icon bubbles", async () => {
  const launched = await launchOpenMausBot();
  try {
    await launched.page.evaluate(() => localStorage.removeItem("omb-email-gate"));
    await launched.page.reload();
    await launched.page.getByPlaceholder("Your name").fill("Icon Review");
    await launched.page.getByPlaceholder("you@example.com").fill("icons@example.com");
    await launched.page.getByRole("button", { name: "Continue" }).click();

    const engines = launched.page.getByRole("heading", { name: "Your engines" }).locator("..");
    await expect(engines).toBeVisible();
    await expect(engines.locator("svg")).toHaveCount(5);
    await expect(engines.locator(".rounded-full")).toHaveCount(0);

    for (const icon of await engines.locator("svg").all()) {
      await expect(icon).toBeVisible();
      expect(await icon.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    }
  } finally {
    await closeOpenMausBot(launched);
  }
});
