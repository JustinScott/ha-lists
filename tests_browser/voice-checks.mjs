import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { closeListMenu, openListMenu } from "./panel-controls.mjs";

// Assist's own HTTP endpoint is the same agent a voice satellite uses after speech-to-text.
async function say(base, token, post, text) {
  return (await post(base, "/api/conversation/process", { text, language: "en" }, token)).response;
}

async function items(base, token, post, entityId) {
  const result = await post(base, "/api/services/todo/get_items?return_response", { entity_id: entityId }, token);
  return result.service_response[entityId].items.map((item) => item.summary);
}

export async function verifyVoiceAccess({ page, base, token, post, entityId, listName }) {
  const phrase = `add synthetic voice item to ${listName}`;
  const panel = await page.locator("ha-lists-panel").elementHandle();
  const settled = (exposed) => page.waitForFunction(([node, expected]) => node._voiceOperation === null &&
    node._management?.voice?.exposure?.[node._selected]?.conversation === expected, [panel, exposed]);
  await openListMenu(page);
  const section = page.getByRole("region", { name: "Voice assistants", exact: true });
  const assist = section.getByRole("checkbox", { name: "Assist", exact: true });
  await assist.waitFor();
  await section.getByText(`Add milk to ${listName}`, { exact: false }).waitFor();
  if (await assist.isChecked()) {
    await assist.uncheck();
    await settled(false);
  }
  const refused = await say(base, token, post, phrase);
  assert.equal(refused.response_type, "error", "unexposed list must be refused");
  assert.ok(!(await items(base, token, post, entityId)).includes("Synthetic voice item"));

  await assist.check();
  await settled(true);
  assert.equal(await assist.isChecked(), true);
  if (process.env.HA_LISTS_SCREENSHOT_DIR) {
    await mkdir(process.env.HA_LISTS_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.HA_LISTS_SCREENSHOT_DIR, "voice-settings-mobile.png"), fullPage: true });
  }
  const added = await say(base, token, post, phrase);
  assert.equal(added.response_type, "action_done", JSON.stringify(added));
  await page.getByRole("button", { name: "Rename Synthetic voice item", exact: true }).waitFor();

  // Reflects changes made in Home Assistant's own exposure settings, without reload.
  await panel.evaluate((node, id) => node._hass.connection.sendMessagePromise({
    type: "homeassistant/expose_entity", assistants: ["conversation"], entity_ids: [id], should_expose: false,
  }), entityId);
  await settled(false);
  assert.equal(await assist.isChecked(), false);
  await closeListMenu(page);
  await page.getByRole("button", { name: "Rename Synthetic voice item", exact: true }).tap();
  await page.getByRole("button", { name: "Delete", exact: true }).tap();
  await page.getByRole("button", { name: "Delete task", exact: true }).tap();
  await page.getByRole("button", { name: "Rename Synthetic voice item", exact: true }).waitFor({ state: "detached" });
  await panel.dispose();
  console.log("Verified voice access toggles native Assist exposure end to end and follows HA settings");
}
