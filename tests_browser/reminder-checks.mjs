import assert from "node:assert/strict";
import { chooseList } from "./panel-controls.mjs";

// Installed-HA check for the one-tap reminder setup. This is the part that uses
// Home Assistant's own blueprint/save WebSocket command and automation config
// API, so it must run against a real Home Assistant, not the panel harness.
export async function verifyReminderSetup({ browser, base, token, post, openPanel, username, password, entityId, listName }) {
  const title = "Synthetic reminder task";
  await post(base, "/api/services/todo/add_item", { entity_id: entityId, item: title, due_date: "2020-01-01" }, token);
  const page = await openPanel(browser, base, "/ha-lists", username, password, {
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  try {
    await chooseList(page, listName);
    await page.getByRole("heading", { name: listName, exact: true }).waitFor();
    await page.getByRole("button", { name: `Rename ${title}`, exact: true }).tap();
    const bell = page.getByRole("button", { name: "Reminder", exact: true });
    await bell.tap();
    await page.locator('button[aria-label="Reminder"][aria-pressed="true"]').waitFor();
    await page.getByText("Reminders need a reminder automation.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Set up reminders", exact: true }).tap();
    await page.waitForURL((url) => /^\/config\/automation\/edit\/\d+$/.test(url.pathname));
    const id = new URL(page.url()).pathname.split("/").pop();
    const response = await fetch(new URL(`/api/config/automation/config/${id}`, base), {
      headers: { Authorization: "Bearer " + token },
    });
    assert.equal(response.status, 200);
    const config = await response.json();
    assert.equal(config.use_blueprint.path, "ha_lists/task_reminders.yaml");
    assert.equal(config.alias, "Task reminders");
    // HA's editor shows the blueprint's form, so the person can pick their action.
    await page.getByText("Reminder actions", { exact: false }).first().waitFor();
    // Back in Lists, the bell stays on and no setup prompt remains.
    await page.goto(new URL("/ha-lists", base).href);
    await chooseList(page, listName);
    await page.getByRole("button", { name: `Rename ${title}`, exact: true }).tap();
    await page.locator('button[aria-label="Reminder"][aria-pressed="true"]').waitFor();
    assert.equal(await page.getByRole("button", { name: "Set up reminders", exact: true }).isVisible(), false);
    const due = await post(base, "/api/services/ha_lists/get_due_tasks?return_response", { include_overdue: true }, token);
    assert.ok(due.service_response.tasks.some((task) => task.summary === title));
    console.log("Verified one-tap reminder setup: blueprint saved, automation created and opened, bell state kept");
  } finally {
    await page.close();
  }
}
