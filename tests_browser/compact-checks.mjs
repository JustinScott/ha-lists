import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function verifyCompactControls(page) {
  const searchButton = page.getByRole("button", { name: "Search tasks", exact: true });
  const search = page.getByRole("searchbox", { name: "Search tasks", exact: true });
  const view = page.getByRole("button", { name: "View options", exact: true });
  const filter = page.getByRole("combobox", { name: "Show tasks", exact: true });
  const quickAdd = page.locator('ha-lists-panel ha-input[label="Add a task"] input');
  assert.equal(await search.count(), 0);
  assert.equal(await filter.count(), 0);
  await quickAdd.fill("Compact controls draft");
  await searchButton.focus();
  await searchButton.press("Enter");
  assert.ok(await search.evaluate((input) => input.getRootNode().activeElement === input));
  await search.fill("Synthetic search");
  await view.focus();
  assert.equal(await search.inputValue(), "Synthetic search");
  await view.press("Space");
  await filter.selectOption("active");
  await view.focus();
  await view.press("Enter");
  assert.equal(await view.getAttribute("aria-expanded"), "false");
  await page.locator("ha-lists-panel .task-tools").getByText("Active", { exact: true }).waitFor();
  await view.press("Enter");
  await filter.selectOption("all");
  await page.getByRole("combobox", { name: "Sort active tasks", exact: true }).focus();
  await page.keyboard.press("Escape");
  assert.equal(await view.getAttribute("aria-expanded"), "false");
  assert.ok(await view.evaluate((button) => button.getRootNode().activeElement === button));
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await search.press("Escape");
  assert.equal(await search.count(), 0);
  assert.equal(await quickAdd.inputValue(), "Compact controls draft");
  if (process.env.HA_LISTS_SCREENSHOT_DIR) {
    await mkdir(process.env.HA_LISTS_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.HA_LISTS_SCREENSHOT_DIR, "compact-mobile.png"), fullPage: true });
    await view.click();
    await searchButton.click();
    await page.screenshot({ path: join(process.env.HA_LISTS_SCREENSHOT_DIR, "expanded-mobile.png"), fullPage: true });
    await search.press("Escape");
    await view.click();
  }
  await quickAdd.fill("");
  console.log("Verified compact defaults, accessible disclosures, active-query visibility, keyboard closing and task draft retention");
}
