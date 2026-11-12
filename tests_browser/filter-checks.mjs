import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function verifyTaskFilters({ browser, page, base, token, username, password, post, openPanel, entityId }) {
  const now = new Date("2030-01-06T00:30:00Z");
  await page.clock.setFixedTime(now);
  const examples = [
    { item: "Filter yesterday", due_date: "2030-01-04" },
    { item: "Filter today", due_date: "2030-01-05" },
    { item: "Filter tomorrow", due_date: "2030-01-06" },
    { item: "Filter timed past", due_datetime: "2030-01-05T23:00:00Z" },
    { item: "Filter timed future", due_datetime: "2030-01-06T03:00:00Z" },
    { item: "Filter completed", due_date: "2030-01-05" },
    { item: "Filter no deadline" },
  ];
  for (const task of examples) await post(base, "/api/services/todo/add_item", { entity_id: entityId, ...task }, token);
  const response = await post(base, "/api/services/todo/get_items?return_response", { entity_id: entityId }, token);
  const completed = response.service_response[entityId].items.find((task) => task.summary === "Filter completed");
  await post(base, "/api/services/todo/update_item", { entity_id: entityId, item: completed.uid, status: "completed" }, token);
  await page.getByRole("checkbox", { name: "Reopen Filter completed", exact: true }).waitFor();

  const choose = async (target, filter, expected) => {
    const options = target.getByRole("button", { name: "View options", exact: true });
    if (await options.getAttribute("aria-expanded") !== "true") await options.click();
    await target.getByRole("combobox", { name: "Show tasks", exact: true }).selectOption(filter);
    const panel = await target.locator("ha-lists-panel").elementHandle();
    try {
      const snapshot = await target.waitForFunction(({ panel, expected }) => {
        if (panel.shadowRoot.querySelector('[role="status"]').textContent === "Loading tasks…") return false;
        const titles = [...panel.shadowRoot.querySelectorAll("li .task-title")]
          .map((element) => element.textContent).filter((title) => title.startsWith("Filter ")).sort();
        return JSON.stringify(titles) === JSON.stringify(expected) ? titles : false;
      }, { panel, expected: [...expected].sort() });
      try {
        // Assert the snapshot that satisfied the wait: a provider refresh may
        // replace the rows with a loading state before another DOM read.
        assert.deepEqual(await snapshot.jsonValue(), [...expected].sort());
      } finally {
        await snapshot.dispose();
      }
    } finally {
      await panel.dispose();
    }
  };
  await choose(page, "all", examples.map((task) => task.item));
  await choose(page, "active", examples.filter((task) => task.item !== "Filter completed").map((task) => task.item));
  await page.getByRole("checkbox", { name: "Complete Filter today", exact: true }).click();
  await page.getByRole("button", { name: "Rename Filter today", exact: true }).waitFor({ state: "detached" });
  await choose(page, "completed", ["Filter completed", "Filter today"]);
  await page.getByRole("checkbox", { name: "Reopen Filter today", exact: true }).click();
  await page.getByRole("button", { name: "Rename Filter today", exact: true }).waitFor({ state: "detached" });
  await choose(page, "today", ["Filter today", "Filter timed past", "Filter timed future"]);
  await page.getByText("Unfinished tasks due today. Time zone: America/Chicago", { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const select = page.getByRole("combobox", { name: "Show tasks", exact: true });
  await select.focus();
  await select.press("Home");
  await select.press("Enter");
  assert.equal(await select.inputValue(), "all");
  await choose(page, "overdue", ["Filter yesterday", "Filter timed past"]);

  // The same provider dates have different calendar-day membership for another user.
  const other = await openPanel(browser, base, "/ha-lists", username, password,
    { viewport: { width: 1280, height: 900 }, timezoneId: "Pacific/Kiritimati" },
    async (target) => target.clock.setFixedTime(now));
  try {
    await other.getByRole("button", { name: "Rename Filter tomorrow", exact: true }).waitFor();
    await choose(other, "today", ["Filter tomorrow", "Filter timed past", "Filter timed future"]);
    await other.getByText("Unfinished tasks due today. Time zone: Pacific/Kiritimati", { exact: true }).waitFor();
    await choose(other, "overdue", ["Filter yesterday", "Filter today", "Filter timed past"]);
    if (process.env.HA_LISTS_SCREENSHOT_DIR) {
      await mkdir(process.env.HA_LISTS_SCREENSHOT_DIR, { recursive: true });
      await other.screenshot({ path: join(process.env.HA_LISTS_SCREENSHOT_DIR, "filters-desktop.png"), fullPage: true });
      await choose(page, "today", ["Filter today", "Filter timed past", "Filter timed future"]);
      await page.keyboard.press("Escape");
      await page.screenshot({ path: join(process.env.HA_LISTS_SCREENSHOT_DIR, "filters-mobile.png"), fullPage: true });
    }
  } finally {
    await other.close();
  }
  await page.clock.setFixedTime(new Date());
  const options = page.getByRole("button", { name: "View options", exact: true });
  if (await options.getAttribute("aria-expanded") !== "true") await options.click();
  await page.getByRole("combobox", { name: "Show tasks", exact: true }).selectOption("all");
  console.log("Verified all five filters, keyboard selection, completion/reopening, and different user time zones");
}
