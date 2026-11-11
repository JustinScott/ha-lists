import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";

const docker = promisify(execFile);
const image = "ghcr.io/home-assistant/home-assistant:2026.11.1";
const listName = "Smoke test list";
const entityId = "todo.smoke_test_list";

async function post(base, path, data, token) {
  const response = await fetch(new URL(path, base), {
    method: "POST",
    headers: {
      "Content-Type": data instanceof URLSearchParams
        ? "application/x-www-form-urlencoded" : "application/json",
      ...(token && { Authorization: "Bearer " + token }),
    },
    body: data instanceof URLSearchParams ? data : JSON.stringify(data),
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `POST ${path}: HTTP ${response.status}`);
  return response.json();
}

async function waitForHomeAssistant(base) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const response = await fetch(new URL("/api/onboarding", base), {
      signal: AbortSignal.timeout(1_000),
    }).catch(() => null);
    if (response?.ok) return;
    await delay(1_000);
  }
  assert.fail("Home Assistant did not finish starting");
}

async function configureLists(base, username, password) {
  // Complete the user step through HA, with optional onboarding already seeded.
  const { auth_code } = await post(base, "/api/onboarding/users", {
    name: "Smoke test",
    username,
    password,
    client_id: base,
    language: "en",
  });
  const { access_token: token } = await post(base, "/auth/token", new URLSearchParams({
    grant_type: "authorization_code",
    code: auth_code,
    client_id: base,
  }));

  const flows = "/api/config/config_entries/flow";
  for (const [handler, fields] of [
    ["local_todo", { todo_list_name: listName }],
    ["ha_lists", {}],
  ]) {
    const flow = await post(base, flows, { handler }, token);
    const result = await post(base, `${flows}/${flow.flow_id}`, fields, token);
    assert.equal(result.type, "create_entry", `${handler} configuration flow`);
  }

  const response = await fetch(new URL("/api/config/config_entries/entry?domain=ha_lists", base), {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(response.ok);
  const [entry] = await response.json();
  assert.equal(entry.state, "loaded");
  const options = "/api/config/config_entries/options/flow";
  const flow = await post(base, options, { handler: entry.entry_id }, token);
  const result = await post(base, `${options}/${flow.flow_id}`, { lists: [entityId] }, token);
  assert.equal(result.type, "create_entry");
}

async function openPanel(browser, base, path, username, password, options) {
  const page = await browser.newPage(options);
  await page.goto(new URL(path, base).href);
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="password"]').press("Enter");
  await page.waitForURL((url) => url.pathname === path);
  return page;
}

test("native To-do and HA Lists share task changes across browser sessions", { timeout: 600_000 }, async () => {
  const name = "ha-lists-test-" + randomUUID();
  let browser;
  let created = false;
  try {
    const onboarding = JSON.stringify({
      version: 4,
      minor_version: 1,
      key: "onboarding",
      data: { done: ["core_config", "analytics", "integration"] },
    });

    await docker("docker", [
      "create", "--name", name, "--publish", "127.0.0.1::8123",
      "--entrypoint", "/bin/sh", image, "-c",
      'mkdir -p /config/.storage && printf "%s" "$1" > /config/configuration.yaml && ' +
      'printf "%s" "$2" > /config/.storage/onboarding && exec /init',
      "ha-lists", "frontend:\nconfig:\ntodo:\n", onboarding,
    ], { timeout: 480_000 });
    created = true;
    const components = fileURLToPath(new URL("../custom_components", import.meta.url));
    await docker("docker", ["cp", components, `${name}:/config/`], { timeout: 30_000 });
    await docker("docker", ["start", name]);
    const { stdout } = await docker("docker", ["port", name, "8123/tcp"]);
    const base = `http://${stdout.trim()}/`;
    await waitForHomeAssistant(base);

    const username = "smoke-test";
    const password = randomUUID();
    await configureLists(base, username, password);

    browser = await chromium.launch();
    const lists = await openPanel(browser, base, "/ha-lists", username, password, {
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    });
    await lists.getByRole("button", { name: listName }).waitFor();
    await lists.getByText("No tasks found.").waitFor();
    const quickAdd = lists.locator("ha-lists-panel ha-input input");
    await quickAdd.fill("First quick task");
    await quickAdd.press("Enter");
    await lists.getByRole("button", { name: "Rename First quick task" }).waitFor();
    assert.equal(await quickAdd.inputValue(), "");
    assert.ok(await quickAdd.evaluate((input) => input.matches(":focus")));
    await lists.keyboard.type("Second quick task");
    await lists.getByRole("button", { name: "Add", exact: true }).tap();
    await lists.getByRole("button", { name: "Rename Second quick task" }).waitFor();
    assert.equal(await quickAdd.inputValue(), "");
    assert.ok(await quickAdd.evaluate((input) => input.matches(":focus")));

    const native = await openPanel(browser, base, "/todo", username, password);
    const item = "Shared browser task";
    const nativeCard = native.locator("hui-todo-list-card");
    const nativeInput = nativeCard.locator("ha-input input");
    await nativeInput.fill(item);
    await nativeInput.press("Enter");

    await lists.getByRole("button", { name: `Rename ${item}` }).tap();
    const renamed = "Renamed browser task";
    await lists.getByRole("textbox", { name: "Task title" }).fill(renamed);
    await lists.getByRole("button", { name: "Save", exact: true }).tap();
    await nativeCard.getByText(renamed, { exact: true }).waitFor();
    assert.equal(await nativeCard.getByText(item, { exact: true }).count(), 0);

    const complete = lists.getByRole("checkbox", { name: `Complete ${renamed}` });
    await complete.click();
    await lists.locator(`input[aria-label="Reopen ${renamed}"]:checked`).waitFor();
    await nativeCard.locator(".completed").getByText(renamed, { exact: true }).waitFor();
  } catch (error) {
    const logs = created && await docker("docker", ["logs", "--tail", "50", name],
      { timeout: 5_000 }).catch(() => null);
    if (logs) process.stderr.write(logs.stdout + logs.stderr);
    throw error;
  } finally {
    try {
      await browser?.close();
    } finally {
      if (created) {
        await docker("docker", ["rm", "--force", "--volumes", name], { timeout: 30_000 });
      }
    }
  }
});
