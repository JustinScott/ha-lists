import assert from "node:assert/strict";

export async function verifyTaskSearch({ page, base, token, post, entityId, listName, secondName }) {
  await post(base, "/api/services/todo/add_item", {
    entity_id: entityId, item: "Search sample", description: "Synthetic violet note",
  }, token);
  await page.getByRole("button", { name: "Rename Search sample", exact: true }).waitFor();
  const search = page.getByRole("searchbox", { name: "Search tasks", exact: true });
  const quickAdd = page.locator('ha-lists-panel ha-input[label="Add a task"] input');
  await quickAdd.fill("Unsent search draft");
  await search.fill("  VIOLET  ");
  await page.locator('ha-lists-panel [role="status"]').filter({ hasText: /^1 of \d+ tasks$/ }).waitFor();
  await page.getByRole("button", { name: "Rename Search sample", exact: true }).waitFor();
  assert.equal(await search.inputValue(), "  VIOLET  ");
  await search.press("Enter");
  assert.equal(await quickAdd.inputValue(), "Unsent search draft");
  await page.getByRole("combobox", { name: "Show tasks", exact: true }).selectOption("completed");
  await page.getByText("No tasks match your search and filter.", { exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Show tasks", exact: true }).selectOption("all");
  await page.getByRole("button", { name: secondName, exact: true }).click();
  await page.getByText("No tasks match your search and filter.", { exact: true }).waitFor();
  assert.equal(await search.inputValue(), "  VIOLET  ");
  await page.getByRole("button", { name: listName, exact: true }).click();
  await page.getByRole("button", { name: "Rename Search sample", exact: true }).waitFor();
  const response = await post(base, "/api/services/todo/get_items?return_response", { entity_id: entityId }, token);
  const item = response.service_response[entityId].items.find((task) => task.summary === "Search sample");
  await post(base, "/api/services/todo/update_item", {
    entity_id: entityId, item: item.uid, description: "Changed outside the panel",
  }, token);
  await page.getByText("No tasks match your search and filter.", { exact: true }).waitFor();
  assert.equal(await search.inputValue(), "  VIOLET  ");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  assert.equal(await search.inputValue(), "");
  assert.ok(await search.evaluate((input) => input.getRootNode().activeElement === input));
  await page.getByRole("button", { name: "Rename Search sample", exact: true }).waitFor();
  await quickAdd.fill("");
  console.log("Verified task search, filters, list switching, native updates, draft preservation and mobile layout");
}
