export async function openListMenu(page) {
  const menu = page.getByRole("button", { name: "List menu", exact: true });
  if (await menu.getAttribute("aria-expanded") !== "true") await menu.click();
}

export async function closeListMenu(page) {
  const menu = page.getByRole("button", { name: "List menu", exact: true });
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
