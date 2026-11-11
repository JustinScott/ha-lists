import assert from "node:assert/strict";

export async function verifyPanelNavigation(page) {
  const panel = page.locator("ha-lists-panel");
  const menu = panel.locator("header ha-menu-button ha-icon-button");
  const menuButton = menu.getByRole("button");
  const drawer = page.locator("home-assistant-main ha-drawer");
  const input = panel.locator('ha-input[label="Add a task"] input');
  await input.fill("Unsent navigation draft");
  await menu.waitFor();
  assert.ok(await panel.evaluate((element) => element.narrow));
  const drawerHandle = await drawer.elementHandle();
  const waitForDrawer = async (open) => {
    const state = await page.waitForFunction(
      ({ drawer, open }) => drawer.open === open, { drawer: drawerHandle, open });
    await state.dispose();
    // Navigation requests closure before the native modal finishes animating.
    // Wait until it releases focus/inertness before typing into the panel.
    await drawer.locator("wa-drawer dialog").waitFor({ state: open ? "visible" : "hidden" });
  };
  try {
    await menu.tap();
    await waitForDrawer(true);
    await page.keyboard.press("Escape");
    await waitForDrawer(false);
    assert.equal(await input.inputValue(), "Unsent navigation draft");
    for (const key of ["Enter", "Space"]) {
      await menuButton.focus();
      await menuButton.press(key);
      await waitForDrawer(true);
      await page.keyboard.press("Escape");
      await waitForDrawer(false);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await menu.waitFor({ state: "hidden" });
    assert.equal(await panel.evaluate((element) => element.narrow), false);
    assert.equal(await input.inputValue(), "Unsent navigation draft");
    await page.setViewportSize({ width: 390, height: 844 });
    await menu.waitFor();
    assert.ok(await panel.evaluate((element) => element.narrow));
    assert.equal(await input.inputValue(), "Unsent navigation draft");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // HA recreates custom panels on route changes. Verify actual navigation
    // separately from draft retention while opening/closing the drawer/resizing.
    await menu.tap();
    await waitForDrawer(true);
    await page.locator("ha-sidebar").getByText("To-do lists", { exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/todo");
    await waitForDrawer(false);
    await page.locator("ha-panel-todo ha-menu-button ha-icon-button").tap();
    await waitForDrawer(true);
    await page.locator("ha-sidebar").getByText("Lists", { exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/ha-lists");
    await waitForDrawer(false);
    await menu.waitFor();
    await panel.locator('[role="status"]').filter({ hasText: /^\d+ of \d+ tasks$/ }).waitFor();
    console.log("Verified native sidebar toggle, touch/keyboard navigation, viewport changes and retained draft");
  } finally {
    await drawerHandle.dispose();
  }
}
