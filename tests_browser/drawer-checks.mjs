import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chooseList, openListSelector } from "./panel-controls.mjs";

export async function verifyListDrawer({ page, listName, secondName }) {
  const panel = page.locator("ha-lists-panel");
  const drawer = panel.getByRole("dialog", { name: "My lists", exact: true });
  const toggle = page.getByRole("button", { name: "My lists", exact: true });
  const input = panel.locator('ha-input[label="Add a task"] input');
  await input.fill("Retained drawer draft");
  const before = await input.boundingBox();
  assert.equal(await panel.locator("nav").isVisible(), false);
  await toggle.tap();
  await drawer.waitFor();
  await drawer.evaluate(async (node) => Promise.all(node.getAnimations().map((animation) => animation.finished)));
  const drawerBox = await drawer.boundingBox();
  const viewportWidth = page.viewportSize().width;
  assert.ok(Math.abs(drawerBox.x + drawerBox.width - viewportWidth) <= 1, "list drawer must sit against the right edge");
  assert.ok(drawerBox.x >= 44, "list drawer must leave backdrop visible on the left");
  assert.ok(await drawer.getByRole("button", { name: listName, exact: true }).evaluate((node) => node === node.getRootNode().activeElement));
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    assert.ok(await drawer.evaluate((node) => node.contains(node.getRootNode().activeElement)), "modal focus must stay inside list selection");
  }
  if (process.env.HA_LISTS_SCREENSHOT_DIR) {
    await mkdir(process.env.HA_LISTS_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.HA_LISTS_SCREENSHOT_DIR, "list-drawer-mobile.png"), fullPage: true });
  }
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  assert.ok(await toggle.evaluate((node) => node === node.getRootNode().activeElement));
  assert.equal(await input.inputValue(), "Retained drawer draft");
  const after = await input.boundingBox();
  assert.ok(Math.abs(after.y - before.y) <= 1, "drawer must not shift task entry");
  // Real touch drags: left across the task page pulls the drawer out; right puts it away.
  const touch = await page.context().newCDPSession(page);
  const drag = async (from, to) => {
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y: 600 }] });
    for (let step = 1; step <= 8; step++) {
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from + (to - from) * step / 8, y: 600 + step }] });
    }
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await drag(viewportWidth - 40, 60);
  await drawer.waitFor();
  await page.waitForFunction((node) => !node.classList.contains("settling") && !node.style.transform, await drawer.elementHandle());
  const swipedBox = await drawer.boundingBox();
  assert.ok(Math.abs(swipedBox.x + swipedBox.width - viewportWidth) <= 1, "swiped drawer must settle against the right edge");
  await drag(swipedBox.x + 40, viewportWidth - 10);
  await drawer.waitFor({ state: "hidden" });
  assert.equal(await input.inputValue(), "Retained drawer draft");
  await touch.detach();
  await openListSelector(page);
  await page.mouse.click(10, 150);
  await drawer.waitFor({ state: "hidden" });
  await chooseList(page, secondName);
  await page.getByRole("heading", { name: secondName, exact: true }).waitFor();
  assert.equal(await input.inputValue(), "Retained drawer draft");
  await chooseList(page, listName);
  await openListSelector(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await toggle.waitFor({ state: "hidden" });
  await drawer.waitFor({ state: "hidden" });
  assert.ok(await panel.locator("nav").isVisible());
  await page.setViewportSize({ width: 390, height: 844 });
  await toggle.waitFor();
  assert.equal(await panel.locator("nav").isVisible(), false);
  if (process.env.HA_LISTS_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.HA_LISTS_SCREENSHOT_DIR, "list-main-mobile.png"), fullPage: true });
  await input.fill("");
  console.log("Verified mobile list drawer swipe open/close, focus containment, Escape/backdrop dismissal, selection, draft/layout retention and desktop resizing");
}
