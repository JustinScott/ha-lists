import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function verifyListManagement({ browser, page, native, base, token, post, openPanel, username, password, entityId }) {
  const observer = await openPanel(browser, base, "/ha-lists", username, password);
  const reviewLayout = async (stage) => {
    const previous = page.viewportSize();
    for (const [layout, width] of [["desktop", 1280], ["mobile", 390]]) {
      await page.setViewportSize({ width, height: 900 });
      // HA's narrow state and sidebar layout update asynchronously on resize.
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.HA_LISTS_SCREENSHOT_DIR) {
        await mkdir(process.env.HA_LISTS_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.HA_LISTS_SCREENSHOT_DIR, `lists-${stage}-${layout}.png`), fullPage: true });
      }
    }
    await page.setViewportSize(previous);
  };
  const listButton = (target, name) => target.locator("ha-lists-panel nav").getByRole("button", { name, exact: true });
  const items = async (id) => (await post(base, "/api/services/todo/get_items?return_response", { entity_id: id }, token)).service_response[id].items;
  const states = async () => {
    const response = await fetch(new URL("/api/states", base), { headers: { Authorization: "Bearer " + token } });
    assert.ok(response.ok);
    return response.json();
  };
  const findEntity = async (name) => {
    const found = (await states()).filter((state) => state.entity_id.startsWith("todo.") && state.attributes.friendly_name === name);
    assert.equal(found.length, 1);
    return found[0].entity_id;
  };
  const choose = async (name) => {
    await listButton(page, name).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    await page.locator('ha-lists-panel [role="status"]').filter({ hasText: /^\d+( of \d+)? tasks?$/ }).waitFor();
  };
  const create = async (name) => {
    await page.getByRole("button", { name: "New list", exact: true }).click();
    await page.getByRole("textbox", { name: "List name", exact: true }).fill(name);
    await reviewLayout("create");
    await page.getByRole("button", { name: "Create list", exact: true }).click();
    await listButton(observer, name).waitFor();
    await choose(name);
    return findEntity(name);
  };
  const connect = async (id, name) => {
    await page.getByRole("button", { name: "Connect existing list", exact: true }).click();
    await page.getByRole("combobox", { name: "Existing Local To-do list", exact: true }).selectOption(id);
    await page.getByRole("button", { name: "Show list", exact: true }).click();
    await listButton(observer, name).waitFor();
    await choose(name);
  };
  const remove = async (name) => {
    await page.getByRole("button", { name: "Delete list…", exact: true }).click();
    assert.ok(await page.getByRole("button", { name: "Keep list", exact: true }).evaluate((button) => button.getRootNode().activeElement === button));
    const confirmation = page.getByRole("textbox", { name: "Type the list name to delete", exact: true });
    const submit = page.getByRole("button", { name: "Delete list and all tasks", exact: true });
    await confirmation.fill("Wrong name");
    assert.ok(await submit.isDisabled());
    await reviewLayout("delete");
    await confirmation.fill(name);
    await submit.click();
    await listButton(page, name).waitFor({ state: "detached" });
    await listButton(observer, name).waitFor({ state: "detached" });
  };
  try {
    const original = await items(entityId);
    const alpha = "UI alpha list";
    const beta = "UI beta list";
    const alphaId = await create(alpha);
    const quickAdd = page.locator('ha-lists-panel ha-input[label="Add a task"] input');
    await quickAdd.fill("Alpha panel task");
    await quickAdd.press("Enter");
    await page.getByRole("button", { name: "Rename Alpha panel task", exact: true }).waitFor();
    await native.goto(new URL(`/todo?entity_id=${alphaId}`, base).href);
    await native.locator("hui-todo-list-card").getByText("Alpha panel task", { exact: true }).waitFor();
    await post(base, "/api/services/todo/add_item", { entity_id: alphaId, item: "Alpha native task" }, token);
    await page.getByRole("button", { name: "Rename Alpha native task", exact: true }).waitFor();
    const alphaTasks = await items(alphaId);
    const betaId = await create(beta);
    assert.notEqual(alphaId, betaId);
    await quickAdd.fill("Beta task");
    await quickAdd.press("Enter");
    await page.getByRole("button", { name: "Rename Beta task", exact: true }).waitFor();
    const betaTasks = await items(betaId);
    await choose(alpha);
    await page.getByRole("button", { name: "Remove list from panel", exact: true }).click();
    await listButton(observer, alpha).waitFor({ state: "detached" });
    assert.deepEqual(await items(alphaId), alphaTasks);
    await page.getByRole("button", { name: "New list", exact: true }).click();
    await page.getByRole("textbox", { name: "List name", exact: true }).fill(alpha);
    await page.getByRole("button", { name: "Create list", exact: true }).click();
    await page.getByText("A Local To-do list with this name already exists.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "List name", exact: true }).inputValue(), alpha);
    await page.getByRole("button", { name: "Cancel new list", exact: true }).click();
    await connect(alphaId, alpha);
    assert.deepEqual(await items(alphaId), alphaTasks);
    await page.getByRole("button", { name: "Delete list…", exact: true }).click();
    await page.getByRole("button", { name: "Keep list", exact: true }).click();
    assert.deepEqual(await items(alphaId), alphaTasks);
    await remove(alpha);
    assert.ok(!(await states()).some((state) => state.entity_id === alphaId));
    assert.deepEqual(await items(betaId), betaTasks);
    assert.deepEqual(await items(entityId), original);

    // A native list created outside HA Lists is equally deletable after connection.
    const externalName = "External synthetic list";
    const flows = "/api/config/config_entries/flow";
    const flow = await post(base, flows, { handler: "local_todo" }, token);
    const created = await post(base, `${flows}/${flow.flow_id}`, { todo_list_name: externalName }, token);
    assert.equal(created.type, "create_entry");
    const externalId = await findEntity(externalName);
    await post(base, "/api/services/todo/add_item", { entity_id: externalId, item: "External sample task" }, token);
    await connect(externalId, externalName);
    await remove(externalName);
    assert.ok(!(await states()).some((state) => state.entity_id === externalId));
    await page.reload();
    await choose(beta);
    await page.getByRole("button", { name: "Rename Beta task", exact: true }).waitFor();
    assert.equal(await listButton(page, alpha).count(), 0);
    assert.equal(await listButton(page, externalName).count(), 0);
    assert.deepEqual(await items(betaId), betaTasks);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log("Verified native list creation, connection, hiding, confirmed deletion, cross-session updates and persistence");
  } finally {
    await observer.close();
  }
}
