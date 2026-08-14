import { expect, test } from "@playwright/test";
import { closeOpenMausBot, launchOpenMausBot } from "./helpers";

test("customer chat hides historical internal tool activity", async () => {
  const launched = await launchOpenMausBot();
  try {
    await launched.page.evaluate(() => localStorage.setItem("omb-email-gate", "skipped"));
    await launched.page.reload();
    await expect(launched.page.getByPlaceholder(/Message/)).toBeVisible();

    await launched.page.evaluate(() => {
      window.dispatchEvent(new MessageEvent("message", { data: "noop" }));
    });

    const rawToolPills = launched.page.locator("span.font-mono", { hasText: /^(js|shell|bash|zsh)$/ });
    await expect(rawToolPills).toHaveCount(0);
  } finally {
    await closeOpenMausBot(launched);
  }
});
