import { chooseList, clickListManagement, clickListAction, openViewOptions } from "./panel-controls.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function verifySuggestions({ browser, page, base, token, post, openPanel, username, password }) {
  const name = "Suggestion browser sample";
  const flow = await post(base, "/api/config/config_entries/flow", { handler: "local_todo" }, token);
  const created = await post(base, `/api/config/config_entries/flow/${flow.flow_id}`, { todo_list_name: name }, token);
  assert.equal(created.type, "create_entry");
  const response = await fetch(new URL("/api/states", base), { headers: { Authorization: "Bearer " + token } });
  const entityId = (await response.json()).find((state) => state.entity_id.startsWith("todo.") && state.attributes.friendly_name === name).entity_id;
  const tasks = async () => (await post(base, "/api/services/todo/get_items?return_response", { entity_id: entityId }, token)).service_response[entityId].items;
  const completed = async (title) => {
    await post(base, "/api/services/todo/add_item", { entity_id: entityId, item: title }, token);
    const item = (await tasks()).find((task) => task.summary === title && task.status !== "completed");
    await post(base, "/api/services/todo/update_item", { entity_id: entityId, item: item.uid, status: "completed" }, token);
  };
  for (const title of ["Catalog milk", "Catalog milkshake", "Catalog almond milk"]) await completed(title);
  await post(base, "/api/services/todo/add_item", { entity_id: entityId, item: "Catalog baseline" }, token);
  await clickListManagement(page, "Connect existing list");
  await page.getByRole("combobox", { name: "Existing Local To-do list", exact: true }).selectOption(entityId);
  await page.getByRole("button", { name: "Show list", exact: true }).click();
  await chooseList(page, name);
  await page.getByRole("button", { name: "Rename Catalog milk", exact: true }).waitFor();
  const input = page.locator('ha-lists-panel ha-input[label="Add a task"] input');
  const options = page.getByRole("listbox", { name: "Task suggestions", exact: true });
  await page.getByRole("checkbox", { name: "Complete Catalog baseline", exact: true }).click();
  await input.fill("Catalog baseline");
  await options.getByRole("option", { name: "Catalog baseline", exact: true }).waitFor();
  await input.press("Escape");
  const seeded = await tasks();
  const row = page.getByRole("button", { name: "Rename Catalog milk", exact: true });
  const relativeRowBefore = (await row.boundingBox()).y - (await input.boundingBox()).y;
  await input.fill("Catalog milk");
  await options.getByRole("option", { name: "Catalog milk", exact: true }).waitFor();
  const popup = await options.elementHandle();
  await options.evaluate((node) => {
    window.suggestionFlickers = 0;
    new MutationObserver(() => { if (node.hidden) window.suggestionFlickers++; }).observe(node, { attributes: true, attributeFilter: ["hidden"] });
  });
  await input.press("Backspace");
  await input.type("k");
  await page.waitForFunction((node) => node.getAttribute("aria-busy") === "false", popup);
  assert.equal(await page.evaluate(() => window.suggestionFlickers), 0);
  // Chromium's IME protocol drives actual composition events through HA's input.
  // Touch emulation and ordinary Playwright typing do not exercise this path.
  await input.selectText();
  const ime = await page.context().newCDPSession(page);
  try {
    for (const text of ["Catalog almond", "Catalog mi", "Catalog mil", "Catalog milk"]) {
      await ime.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
      await options.getByRole("option", { name: text === "Catalog almond" ? "Catalog almond milk" : "Catalog milk", exact: true }).waitFor();
      await page.waitForFunction((value) => {
        return value.node.value === value.text && value.popup.getAttribute("aria-busy") === "false";
      }, { node: await input.elementHandle(), text, popup });
      assert.equal(await input.getAttribute("aria-expanded"), "true");
    }
    await ime.send("Input.insertText", { text: "Catalog milk" });
  } finally {
    await ime.detach();
  }
  assert.equal(await page.evaluate(() => window.suggestionFlickers), 0, "IME edits must not hide the suggestion popup");
  assert.ok(Math.abs((await row.boundingBox()).y - (await input.boundingBox()).y - relativeRowBefore) <= 1,
    "suggestions must float without pushing task rows down");
  assert.equal(await input.getAttribute("aria-expanded"), "true");
  assert.equal(await input.evaluate((node) => node.ariaControlsElements?.[0]?.getAttribute("aria-label")), "Task suggestions");
  await input.press("ArrowDown");
  assert.equal(await input.evaluate((node) => node.ariaActiveDescendantElement?.textContent), "Catalog milk");
  await input.press("Enter");
  await page.getByRole("checkbox", { name: "Complete Catalog milk", exact: true }).waitFor();
  assert.equal(await input.inputValue(), "");
  assert.ok(await input.evaluate((node) => node.matches(":focus")));
  const milkTasks = (await tasks()).filter((task) => task.summary === "Catalog milk");
  assert.equal(milkTasks.length, 2);
  assert.notEqual(milkTasks[0].uid, milkTasks[1].uid);
  assert.deepEqual((await tasks()).filter((task) => seeded.some((old) => old.uid === task.uid)), seeded);
  await input.fill("Catalog mi");
  await options.getByRole("option", { name: "Catalog milkshake", exact: true }).waitFor();
  assert.equal(await options.getByRole("option", { name: "Catalog milk", exact: true }).count(), 0);
  await options.getByRole("option", { name: "Catalog milkshake", exact: true }).tap();
  await page.getByRole("checkbox", { name: "Complete Catalog milkshake", exact: true }).waitFor();
  assert.ok(await input.evaluate((node) => node.matches(":focus")));
  await input.fill("Catalog almond");
  await options.getByRole("option", { name: "Catalog almond milk", exact: true }).waitFor();
  await input.press("Escape");
  assert.equal(await input.inputValue(), "Catalog almond");
  assert.equal(await options.count(), 0);
  // With no highlighted suggestion Enter adds the literal free-text draft.
  await input.fill("Catalog free text");
  await input.press("Enter");
  await page.getByRole("checkbox", { name: "Complete Catalog free text", exact: true }).waitFor();

  // No Lists panel is open while this synthetic automation adds/completes a task.
  await page.goto(new URL(`/todo?entity_id=${entityId}`, base).href);
  await completed("Catalog automation");
  await page.goto(new URL("/ha-lists", base).href);
  await chooseList(page, name);
  await page.getByRole("button", { name: "Rename Catalog automation", exact: true }).waitFor();
  await input.fill("Catalog auto");
  await options.getByRole("option", { name: "Catalog automation", exact: true }).waitFor();
  const observer = await openPanel(browser, base, "/ha-lists", username, password);
  try {
    await chooseList(observer, name);
    const otherInput = observer.locator('ha-lists-panel ha-input[label="Add a task"] input');
    await otherInput.fill("Catalog auto");
    await observer.getByRole("option", { name: "Catalog automation", exact: true }).waitFor();
    await clickListAction(page, "View options");
    await page.getByRole("heading", { name: "Suggestion history", exact: true }).waitFor();
    const historySearch = page.getByRole("searchbox", { name: "Find a learned suggestion", exact: true });
    await historySearch.fill("Catalog automation");
    assert.ok(await historySearch.evaluate((node) => node.matches(":focus")));
    await page.getByRole("button", { name: "Forget suggestion Catalog automation", exact: true }).click();
    await page.getByRole("button", { name: "Forget suggestion Catalog automation", exact: true }).waitFor({ state: "detached" });
    await input.fill("Catalog auto");
    await input.press("Escape");
    assert.equal(await page.getByRole("option", { name: "Catalog automation", exact: true }).count(), 0);
    const nativeBefore = await tasks();
    await openViewOptions(page);
    await page.getByRole("button", { name: "Clear learned history", exact: true }).click();
    await page.getByRole("button", { name: "Confirm history change", exact: true }).click();
    await page.getByText("0 learned suggestions. Shared on this Home Assistant server.", { exact: true }).waitFor();
    assert.deepEqual(await tasks(), nativeBefore);
    await page.getByRole("button", { name: "Rebuild from completed items", exact: true }).click();
    await page.getByRole("button", { name: "Confirm history change", exact: true }).click();
    await page.getByRole("button", { name: "Forget suggestion Catalog automation", exact: true }).waitFor();
    if (process.env.HA_LISTS_SCREENSHOT_DIR) {
      await mkdir(process.env.HA_LISTS_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.HA_LISTS_SCREENSHOT_DIR, "suggestion-history-mobile.png"), fullPage: true });
    }
    await clickListAction(page, "View options");
    await input.fill("Catalog auto");
    await options.getByRole("option", { name: "Catalog automation", exact: true }).waitFor();
    if (process.env.HA_LISTS_SCREENSHOT_DIR) {
      await mkdir(process.env.HA_LISTS_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.HA_LISTS_SCREENSHOT_DIR, "suggestions-mobile.png"), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
      await page.screenshot({ path: join(process.env.HA_LISTS_SCREENSHOT_DIR, "suggestions-desktop.png"), fullPage: true });
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log("Verified completed seeding, keyboard/touch autocomplete, native identities, active exclusion, cross-session/background learning and safe history controls");
  } finally {
    await observer.close();
  }
}
