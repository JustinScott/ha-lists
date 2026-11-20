export async function openListSelector(page) {
  const panel = page.locator("ha-lists-panel");
  await panel.waitFor();
  await page.waitForFunction((node) => node._configured !== null, await panel.elementHandle());
  const toggle = page.getByRole("button", { name: "My lists", exact: true });
  if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
    await page.locator("ha-lists-panel .list-drawer").evaluate(async (node) => Promise.all(node.getAnimations().map((animation) => animation.finished)));
  }
}

export async function chooseList(page, name) {
  await openListSelector(page);
  await page.locator("ha-lists-panel nav").getByRole("button", { name, exact: true }).click();
  await page.locator("ha-lists-panel .list-drawer").waitFor({ state: "hidden" });
}

export async function clickListManagement(page, name) {
  await openListSelector(page);
  await page.getByRole("button", { name, exact: true }).click();
}

export async function openListMenu(page) {
  const menu = page.getByRole("button", { name: "List settings", exact: true });
  if (await menu.getAttribute("aria-expanded") !== "true") await menu.click();
}

export async function closeListMenu(page) {
  const menu = page.getByRole("button", { name: "List settings", exact: true });
  if (await menu.getAttribute("aria-expanded") === "true") await menu.click();
}

export async function clickListAction(page, name) {
  await openListMenu(page);
  await page.getByRole("button", { name, exact: true }).click();
}

export async function openViewOptions(page) {
  await openListMenu(page);
  const view = page.getByRole("button", { name: "View options", exact: true });
  if (await view.getAttribute("aria-expanded") !== "true") await view.click();
}

export async function selectTaskView(page, name, value) {
  await openViewOptions(page);
  await page.getByRole("combobox", { name, exact: true }).selectOption(value);
  await closeListMenu(page);
}
