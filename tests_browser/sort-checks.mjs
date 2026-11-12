import assert from "node:assert/strict";

export async function verifyTaskSorting({ page, base, token, post, entityId, listName, secondName }) {
  for (const item of ["Sort older", "Sort completed first", "Sort newer", "Sort completed second"]) {
    await post(base, "/api/services/todo/add_item", { entity_id: entityId, item }, token);
  }
  const readNative = async () => (await post(base, "/api/services/todo/get_items?return_response",
    { entity_id: entityId }, token)).service_response[entityId].items;
  for (const item of (await readNative()).filter((task) => task.summary.startsWith("Sort completed"))) {
    await post(base, "/api/services/todo/update_item", {
      entity_id: entityId, item: item.uid, status: "completed",
    }, token);
  }
  await page.getByRole("checkbox", { name: "Reopen Sort completed second", exact: true }).waitFor();
  const before = await readNative();
  const search = page.getByRole("searchbox", { name: "Search tasks", exact: true });
  const sort = page.getByRole("combobox", { name: "Sort active tasks", exact: true });
  const filter = page.getByRole("combobox", { name: "Show tasks", exact: true });
  const quickAdd = page.locator('ha-lists-panel ha-input[label="Add a task"] input');
  await quickAdd.fill("Unsent sorting draft");
  await page.getByRole("button", { name: "Search tasks", exact: true }).click();
  await search.fill("Sort ");
  const panel = await page.locator("ha-lists-panel").elementHandle();
  const expectTitles = async (expected) => {
    const snapshot = await page.waitForFunction(({ panel, expected }) => {
      if (panel.shadowRoot.querySelector('[role="status"]').textContent === "Loading tasks…") return false;
      const titles = [...panel.shadowRoot.querySelectorAll("li .task-title")]
        .map((element) => element.textContent).filter((title) => title.startsWith("Sort "));
      return JSON.stringify(titles) === JSON.stringify(expected) ? titles : false;
    }, { panel, expected });
    try { assert.deepEqual(await snapshot.jsonValue(), expected); }
    finally { await snapshot.dispose(); }
  };
  const completed = ["Sort completed first", "Sort completed second"];
  try {
    await expectTitles(["Sort newer", "Sort older", ...completed]);
    await page.getByRole("button", { name: "Rename Sort older", exact: true }).click();
    const title = page.getByRole("textbox", { name: "Task title", exact: true });
    await title.fill("Unsent sorted editor");
    await sort.selectOption("oldest");
    await expectTitles(["Sort older", "Sort newer", ...completed]);
    assert.equal(await title.inputValue(), "Unsent sorted editor");
    assert.equal(await quickAdd.inputValue(), "Unsent sorting draft");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await filter.selectOption("completed");
    await expectTitles(completed);
    await sort.selectOption("newest");
    await expectTitles(completed);
    await sort.selectOption("oldest");
    await filter.selectOption("active");
    await expectTitles(["Sort older", "Sort newer"]);
    await filter.selectOption("all");
    await page.getByRole("button", { name: secondName, exact: true }).click();
    await page.getByText("No tasks match your search and filter.", { exact: true }).waitFor();
    assert.equal(await sort.inputValue(), "oldest");
    await page.getByRole("button", { name: listName, exact: true }).click();
    await expectTitles(["Sort older", "Sort newer", ...completed]);
    await sort.focus();
    await sort.press("Home");
    await sort.press("Enter");
    assert.equal(await sort.inputValue(), "newest");
    await expectTitles(["Sort newer", "Sort older", ...completed]);
    assert.deepEqual(await readNative(), before, "display sorting must not change native tasks or their order");
    await sort.selectOption("oldest");
    await post(base, "/api/services/todo/add_item", { entity_id: entityId, item: "Sort latest" }, token);
    await expectTitles(["Sort older", "Sort newer", "Sort latest", ...completed]);
    await page.getByRole("checkbox", { name: "Complete Sort older", exact: true }).click();
    await expectTitles(["Sort newer", "Sort latest", "Sort older", ...completed]);
    await page.getByRole("checkbox", { name: "Reopen Sort older", exact: true }).click();
    await expectTitles(["Sort older", "Sort newer", "Sort latest", ...completed]);
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(await sort.inputValue(), "oldest");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await quickAdd.inputValue(), "Unsent sorting draft");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.reload();
    await page.getByRole("button", { name: "Rename Sort older", exact: true }).waitFor();
    assert.equal(await sort.count(), 0);
    assert.equal(await search.count(), 0);
    await page.getByRole("button", { name: "View options", exact: true }).click();
    assert.equal(await sort.inputValue(), "newest");
    await page.getByRole("button", { name: "Search tasks", exact: true }).click();
    assert.equal(await search.inputValue(), "");
    console.log("Verified sorting, keyboard selection, native order, filters/search, drafts, list switches and updates");
  } finally {
    await panel.dispose();
  }
}
