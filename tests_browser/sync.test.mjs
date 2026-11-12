import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { startNative } from "./native-runtime.mjs";
import { verifyTaskFilters } from "./filter-checks.mjs";
import { verifyTaskSearch } from "./search-checks.mjs";
import { verifyPanelNavigation } from "./navigation-checks.mjs";
import { verifyTaskSorting } from "./sort-checks.mjs";
import { verifyListManagement } from "./list-checks.mjs";
import { verifyCompactControls } from "./compact-checks.mjs";
import { verifySuggestions } from "./suggestion-checks.mjs";

const docker = promisify(execFile);
const image = "ghcr.io/home-assistant/home-assistant:2026.11.1";
const listName = "Smoke test list";
const entityId = "todo.smoke_test_list";
const secondName = "Second smoke list";
const secondId = "todo.second_smoke_list";

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
    ["local_todo", { todo_list_name: secondName }],
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
  const result = await post(base, `${options}/${flow.flow_id}`, { lists: [entityId, secondId] }, token);
  assert.equal(result.type, "create_entry");
  return token;
}

// Run the rejection handshake against the installed server: the fixture-based
// client currently leaves an aiohttp 3.14.5 heartbeat timer after auth rejection.
async function verifyRejectedAuthentication(base) {
  await new Promise((resolve, reject) => {
    const url = new URL("/api/websocket", base);
    url.protocol = "ws:";
    const socket = new WebSocket(url);
    let rejected = false;
    const timer = setTimeout(() => { socket.close(); reject(new Error("Rejected authentication did not close")); }, 10000);
    socket.onerror = () => { clearTimeout(timer); reject(new Error("Authentication test connection failed")); };
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.type === "auth_required") socket.send(JSON.stringify({ type: "auth", access_token: "synthetic-invalid-token" }));
      else if (message.type === "auth_invalid") rejected = true;
      else { clearTimeout(timer); socket.close(); reject(new Error("Unauthenticated connection received an unexpected response")); }
    };
    socket.onclose = () => {
      clearTimeout(timer);
      if (rejected) resolve();
      else reject(new Error("Invalid token was not explicitly rejected"));
    };
  });
}

async function confirmNativeHTTP(base, token) {
  await new Promise((resolve, reject) => {
    const url = new URL("/api/websocket", base);
    url.protocol = "ws:";
    const socket = new WebSocket(url);
    const timer = setTimeout(() => { socket.close(); reject(new Error("HTTP confirmation timed out")); }, 10000);
    socket.onerror = () => { clearTimeout(timer); reject(new Error("HTTP confirmation connection failed")); };
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.type === "auth_required") socket.send(JSON.stringify({ type: "auth", access_token: token }));
      else if (message.type === "auth_ok") socket.send(JSON.stringify({ id: 1, type: "http/config" }));
      else if (message.type === "result") {
        if (!message.success) { clearTimeout(timer); socket.close(); reject(new Error("HTTP confirmation rejected")); }
        else if (message.id === 1 && message.result.pending) socket.send(JSON.stringify({ id: 2, type: "http/config/promote" }));
        else { clearTimeout(timer); socket.close(); resolve(); }
      }
    };
  });
}

async function openPanel(browser, base, path, username, password, options, beforeNavigate) {
  const page = await browser.newPage(options);
  await beforeNavigate?.(page);
  await page.goto(new URL(path, base).href);
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="password"]').press("Enter");
  await page.waitForURL((url) => url.pathname === new URL(path, base).pathname);
  return page;
}

test("native To-do and HA Lists share task changes across browser sessions", { timeout: 600_000 }, async (context) => {
  // AbortSignal.timeout() and the test deadline are unreferenced timers. Keep
  // setup alive until it succeeds or fails, even before Chromium is launched.
  const lifetime = setInterval(() => {}, 1_000);
  context.after(() => clearInterval(lifetime));
  const name = "ha-lists-test-" + randomUUID();
  let browser;
  let lists;
  let nativeRuntime;
  let created = false;
  try {
    const onboarding = JSON.stringify({
      version: 4,
      minor_version: 1,
      key: "onboarding",
      data: { done: ["core_config", "analytics", "integration"] },
    });

    const components = fileURLToPath(new URL("../custom_components", import.meta.url));
    let base;
    if (process.env.HA_TEST_PYTHON) {
      nativeRuntime = await startNative(process.env.HA_TEST_PYTHON, components,
        "frontend:\nconfig:\ntodo:\n", onboarding);
      base = nativeRuntime.base;
    } else {
      await docker("docker", [
        "create", "--name", name, "--publish", "127.0.0.1::8123",
        "--entrypoint", "/bin/sh", image, "-c",
        'mkdir -p /config/.storage && printf "%s" "$1" > /config/configuration.yaml && ' +
        'printf "%s" "$2" > /config/.storage/onboarding && exec /init',
        "ha-lists", "frontend:\nconfig:\ntodo:\n", onboarding,
      ], { timeout: 480_000 });
      created = true;
      await docker("docker", ["cp", components, `${name}:/config/`], { timeout: 30_000 });
      await docker("docker", ["start", name]);
      const { stdout } = await docker("docker", ["port", name, "8123/tcp"]);
      base = `http://${stdout.trim()}/`;
    }
    await waitForHomeAssistant(base);
    console.log("Started disposable Home Assistant");

    const username = "smoke-test";
    const password = randomUUID();
    const token = await configureLists(base, username, password);
    console.log("Configured synthetic Local To-do lists");
    if (nativeRuntime) await confirmNativeHTTP(base, token);
    await verifyRejectedAuthentication(base);

    browser = await chromium.launch({
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && {
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      }),
    });
    let rejectAdd = true;
    const failureDraft = "Rejected synthetic task";
    lists = await openPanel(browser, base, "/ha-lists", username, password, {
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "America/Chicago",
    }, async (page) => {
      await page.routeWebSocket("**/api/websocket", (socket) => {
        const server = socket.connectToServer();
        socket.onMessage((raw) => {
          const message = JSON.parse(raw.toString());
          if (rejectAdd && message.type === "call_service" &&
              message.domain === "todo" && message.service === "add_item" &&
              message.service_data?.item === failureDraft) {
            rejectAdd = false;
            socket.send(JSON.stringify({ id: message.id, type: "result", success: false,
              error: { code: "service_validation_error", message: "Synthetic provider unavailable" } }));
          } else {
            server.send(raw);
          }
        });
      });
    });
    await lists.getByRole("button", { name: listName }).waitFor();
    await lists.getByText("No tasks found.").waitFor();
    await verifyPanelNavigation(lists);
    await verifyCompactControls(lists);
    const quickAdd = lists.locator("ha-lists-panel ha-input input");
    await lists.locator("ha-lists-panel ha-input").evaluate(async (input) => {
      await input.updateComplete;
      await customElements.whenDefined("wa-input");
      await input.shadowRoot.querySelector("wa-input").updateComplete;
    });
    await quickAdd.fill("First quick task");
    await quickAdd.press("Enter");
    await lists.getByRole("button", { name: "Rename First quick task" }).waitFor();
    assert.equal(await quickAdd.inputValue(), "");
    assert.ok(await quickAdd.evaluate((input) => input.matches(":focus")));
    await lists.keyboard.type("Second quick task");
    await lists.getByRole("button", { name: "Add", exact: true }).tap();
    await lists.getByRole("button", { name: "Rename Second quick task" }).waitFor();
    assert.deepEqual(await lists.locator("ha-lists-panel li").allTextContents(),
      ["Second quick task", "First quick task"]);
    assert.equal(await quickAdd.inputValue(), "");
    assert.ok(await quickAdd.evaluate((input) => input.matches(":focus")));

    assert.ok(await lists.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "mobile page must not overflow horizontally");
    assert.ok(await lists.locator("ha-lists-panel main").evaluate((main) => main.scrollWidth <= main.clientWidth),
      "mobile panel must not overflow horizontally");
    await quickAdd.fill("Rapid synthetic task");
    await quickAdd.press("Enter");
    await quickAdd.press("Enter");
    await lists.getByRole("button", { name: "Rename Rapid synthetic task", exact: true }).waitFor();
    const rapid = await post(base, "/api/services/todo/get_items?return_response", { entity_id: entityId }, token);
    assert.equal(rapid.service_response[entityId].items.filter((task) => task.summary === "Rapid synthetic task").length, 1);

    await quickAdd.fill(failureDraft);
    await quickAdd.press("Enter");
    await lists.getByRole("alert").filter({ hasText: "Synthetic provider unavailable" }).waitFor();
    assert.equal(await quickAdd.inputValue(), failureDraft);
    await lists.getByRole("button", { name: "Add", exact: true }).tap();
    await lists.getByRole("button", { name: `Rename ${failureDraft}`, exact: true }).waitFor();
    assert.equal(await quickAdd.inputValue(), "");

    await lists.getByRole("button", { name: secondName, exact: true }).tap();
    await lists.getByRole("heading", { name: secondName, exact: true }).waitFor();
    await lists.getByText("No tasks found.", { exact: true }).waitFor();
    await quickAdd.fill("Second list only");
    await quickAdd.press("Enter");
    await lists.getByRole("button", { name: "Rename Second list only", exact: true }).waitFor();
    await lists.getByRole("button", { name: listName, exact: true }).tap();
    await lists.getByRole("button", { name: "Rename First quick task", exact: true }).waitFor();
    assert.equal(await lists.getByRole("button", { name: "Rename Second list only", exact: true }).count(), 0);
    console.log("Verified mobile layout/focus, rapid entry, provider rejection/retry, and list switching");

    await verifyTaskFilters({ browser, page: lists, base, token, username, password,
      post, openPanel, entityId });
    await verifyTaskSearch({ page: lists, base, token, post, entityId, listName, secondName });
    await verifyTaskSorting({ page: lists, base, token, post, entityId, listName, secondName });

    const native = await openPanel(browser, base, `/todo?entity_id=${entityId}`, username, password);
    const item = "Shared browser task";
    const nativeCard = native.locator("hui-todo-list-card");
    const nativeInput = nativeCard.locator("ha-input input");
    await nativeInput.fill(item);
    await nativeInput.press("Enter");

    await lists.getByRole("button", { name: `Rename ${item}` }).tap();
    const renamed = "Renamed browser task";
    const nativeTask = nativeCard.locator("ha-check-list-item").filter({ hasText: renamed });
    await lists.getByRole("textbox", { name: "Task title" }).fill(renamed);
    await lists.getByLabel("Description", { exact: true }).fill("Pick up the green ones");
    await lists.getByLabel("Due date", { exact: true }).fill("2030-04-05");
    await lists.getByRole("button", { name: "Save", exact: true }).tap();
    await nativeCard.getByText(renamed, { exact: true }).waitFor();
    assert.equal(await nativeCard.getByText(item, { exact: true }).count(), 0);
    await nativeCard.getByText("Pick up the green ones", { exact: true }).waitFor();
    await nativeTask.locator(".due").waitFor();
    await lists.getByRole("button", { name: `Rename ${renamed}` }).tap();
    const dueDate = lists.getByLabel("Due date", { exact: true });
    assert.equal(await dueDate.inputValue(), "2030-04-05");
    const dueTime = lists.getByLabel("Due time", { exact: true });
    for (const [date, utcHour] of [["2030-07-05", 15], ["2030-01-05", 16]]) {
      await dueDate.fill(date);
      await dueTime.fill("10:30:00");
      await lists.getByRole("button", { name: "Save", exact: true }).tap();
      await lists.getByRole("button", { name: `Rename ${renamed}` }).tap();
      assert.equal(await dueDate.inputValue(), date);
      assert.match(await dueTime.inputValue(), /^10:30/);
      const response = await post(base, "/api/services/todo/get_items?return_response", {
        entity_id: entityId,
      }, token);
      const task = response.service_response[entityId].items.find((task) => task.summary === renamed);
      assert.equal(new Date(task.due).toISOString(), `${date}T${utcHour}:30:00.000Z`);
    }
    await dueDate.fill("2030-03-10");
    await dueTime.fill("02:30:00");
    await lists.getByRole("button", { name: "Save", exact: true }).tap();
    await lists.getByText("This time does not exist in your time zone. Choose another time.", { exact: true }).waitFor();
    assert.equal(await dueDate.inputValue(), "2030-03-10");
    await lists.getByRole("button", { name: "Clear deadline", exact: true }).tap();
    await lists.getByLabel("Description", { exact: true }).fill("");
    await lists.getByRole("button", { name: "Save", exact: true }).tap();
    await nativeCard.getByText("Pick up the green ones", { exact: true }).waitFor({ state: "detached" });
    await nativeTask.locator(".due").waitFor({ state: "detached" });

    const complete = lists.getByRole("checkbox", { name: `Complete ${renamed}` });
    await complete.click();
    await lists.locator(`input[aria-label="Reopen ${renamed}"]:checked`).waitFor();
    await nativeCard.locator(".completed").getByText(renamed, { exact: true }).waitFor();

    // Give the active and completed tasks the same title. Delete the completed UID.
    await nativeInput.fill(renamed);
    await nativeInput.press("Enter");
    const completedTask = lists.locator("li").filter({
      has: lists.getByRole("checkbox", { name: `Reopen ${renamed}`, exact: true }),
    });
    await lists.getByRole("checkbox", { name: `Complete ${renamed}`, exact: true }).waitFor();
    await completedTask.getByRole("button", { name: `Rename ${renamed}` }).tap();
    await lists.getByRole("button", { name: "Delete", exact: true }).tap();
    await lists.getByText(`Delete “${renamed}”?`, { exact: true }).waitFor();
    await lists.getByRole("button", { name: "Delete task", exact: true }).tap();

    await completedTask.waitFor({ state: "detached" });
    await nativeCard.locator(".completed").getByText(renamed, { exact: true }).waitFor({ state: "detached" });
    assert.equal(await lists.getByRole("checkbox", { name: `Complete ${renamed}`, exact: true }).count(), 1);
    assert.equal(await nativeCard.getByText(renamed, { exact: true }).count(), 1);
    await verifyListManagement({ browser, page: lists, native, base, token, post, openPanel, username, password, entityId });
    await verifySuggestions({ browser, page: lists, base, token, post, openPanel, username, password });
  } catch (error) {
    if (lists) process.stderr.write(await lists.locator("ha-lists-panel").ariaSnapshot().catch(() => "") + "\n");
    const logs = created && await docker("docker", ["logs", "--tail", "50", name],
      { timeout: 5_000 }).catch(() => null);
    if (logs) process.stderr.write(logs.stdout + logs.stderr);
    if (nativeRuntime) process.stderr.write(nativeRuntime.logs());
    throw error;
  } finally {
    try {
      await browser?.close();
    } finally {
      await nativeRuntime?.close();
      if (created) {
        await docker("docker", ["rm", "--force", "--volumes", name], { timeout: 30_000 });
      }
    }
  }
});
