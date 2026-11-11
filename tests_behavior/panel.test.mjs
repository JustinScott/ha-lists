import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../custom_components/ha_lists/frontend/panel.js", import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

async function setup({ lists = ["todo.groceries"], items = [], service, readItems, supportedFeatures = 6, clock } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "outside-only", pretendToBeVisual: true,
  });
  const { window } = dom;
  if (clock) {
    const RealDate = window.Date;
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [clock()])); }
      static now() { return new RealDate(clock()).getTime(); }
    };
  }
  class HaInput extends window.HTMLElement {
    constructor() { super(); this.value = ""; }
  }
  window.customElements.define("ha-input", HaInput);
  window.eval(source);
  const calls = [];
  const requests = [];
  const states = Object.fromEntries(lists.map((id) => [id, {
    entity_id: id, state: "0", attributes: { friendly_name: id, supported_features: supportedFeatures },
  }]));
  const hass = {
    states,
    connection: {
      async sendMessagePromise(request) {
        requests.push(request);
        if (request.type === "ha_lists/lists") return { lists };
        if (request.type === "todo/item/list") {
          return { items: await (readItems?.(request.entity_id) ?? items.map((item) => ({ ...item }))) };
        }
        throw new Error("Unexpected websocket message");
      },
    },
    async callService(domain, action, data) {
      calls.push({ domain, action, data });
      if (service) return service(domain, action, data);
      if (action === "add_item") items.push({ uid: "new-" + items.length, summary: data.item, status: "needs_action" });
      if (action === "remove_item") {
        const index = items.findIndex((item) => item.uid === data.item);
        if (index !== -1) items.splice(index, 1);
      }
      if (action === "update_item") {
        const item = items.find((candidate) => (candidate.uid || candidate.summary) === data.item);
        if (item && data.status) item.status = data.status;
        if (item && data.rename) item.summary = data.rename;
        if (item && "description" in data) item.description = data.description;
        if (item && "due_date" in data) item.due = data.due_date;
        if (item && "due_datetime" in data) item.due = data.due_datetime;
      }
    },
  };
  const panel = window.document.createElement("ha-lists-panel");
  window.document.body.append(panel);
  panel.hass = hass;
  await tick(); await tick();
  return { window, panel, calls, requests, items, hass };
}

function rows(panel) { return [...panel.shadowRoot.querySelectorAll("li")]; }
function change(window, checkbox, checked) {
  checkbox.checked = checked;
  checkbox.dispatchEvent(new window.Event("change", { bubbles: true }));
}

test("loads configured lists, native todo items and accessible named navigation", async () => {
  const { panel, requests } = await setup({ items: [{ uid: "1", summary: "Apples", status: "needs_action" }] });
  assert.equal(panel.shadowRoot.querySelector("nav button").textContent, "todo.groceries");
  assert.equal(rows(panel)[0].textContent, "Apples");
  assert.ok(requests.some((request) => request.type === "todo/item/list" && request.entity_id === "todo.groceries"));
});

test("empty configuration and empty list show useful states", async () => {
  const { panel } = await setup({ lists: [] });
  assert.match(panel.shadowRoot.textContent, /No lists selected/);
  const populated = await setup();
  assert.match(populated.panel.shadowRoot.textContent, /No tasks found/);
});

test("Enter adds once, clears draft and retains input element for consecutive entry", async () => {
  const { panel, window, calls } = await setup();
  const input = panel._input;
  input.value = "Milk";
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await tick(); await tick();
  assert.equal(calls.filter((call) => call.action === "add_item").length, 1);
  assert.equal(calls[0].data.item, "Milk");
  assert.equal(panel._input, input);
  assert.equal(input.value, "");
  input.value = "Bread";
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await tick(); await tick();
  assert.deepEqual(calls.map((call) => call.data.item), ["Milk", "Bread"]);
  assert.deepEqual(rows(panel).map((row) => row.textContent), ["Bread", "Milk"]);
});

test("Add button submits through native service and clears input", async () => {
  const { panel, window, calls } = await setup();
  panel._input.value = "  Eggs  ";
  panel._form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await tick(); await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { domain: "todo", action: "add_item", data: { entity_id: "todo.groceries", item: "Eggs" } });
  assert.equal(panel._input.value, "");
  assert.deepEqual(rows(panel).map((row) => row.textContent), ["Eggs"]);
});

test("IME composition and repeated Enter do not create extra tasks", async () => {
  const pending = deferred();
  const { panel, window, calls } = await setup({ service: () => pending.promise });
  panel._input.value = "Coffee";
  const composing = new window.KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true });
  panel._input.dispatchEvent(composing);
  assert.equal(calls.length, 0);
  const enter = () => panel._input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  enter(); enter();
  assert.equal(calls.length, 1);
  assert.equal(panel._input.disabled, false);
  pending.resolve();
  await tick(); await tick();
});

test("failed addition preserves draft and displays error", async () => {
  const { panel, window } = await setup({ service: async () => { throw Error("write denied"); } });
  panel._input.value = "Tea";
  panel._form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await tick();
  assert.equal(panel._input.value, "Tea");
  assert.match(panel.shadowRoot.textContent, /Unable to add task.*write denied/);
});

test("completion sends UID, sorts completed last and strikes title", async () => {
  const { panel, window, calls } = await setup({ items: [
    { uid: "a", summary: "Apples", status: "needs_action" },
    { uid: "b", summary: "Bread", status: "needs_action" },
  ] });
  change(window, panel.shadowRoot.querySelector('[aria-label="Complete Apples"]'), true);
  await tick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { domain: "todo", action: "update_item", data: { entity_id: "todo.groceries", item: "a", status: "completed" } });
  assert.deepEqual(rows(panel).map((row) => row.textContent), ["Bread", "Apples"]);
  assert.equal(rows(panel)[1].querySelector(".task-title").classList.contains("completed"), true);
});

test("reopening a completed item sends needs_action and restores active order", async () => {
  const { panel, window, calls } = await setup({ items: [
    { uid: "a", summary: "Apples", status: "completed" },
    { uid: "b", summary: "Bread", status: "needs_action" },
  ] });
  change(window, rows(panel)[1].querySelector("input"), false);
  await tick(); await tick();
  assert.equal(calls[0].data.status, "needs_action");
  assert.equal(calls[0].data.item, "a");
  assert.equal(rows(panel)[0].querySelector("input").checked, false);
});

test("failed completion rolls back checked status and reports error", async () => {
  const { panel, window } = await setup({
    items: [{ uid: "a", summary: "Apples", status: "needs_action" }],
    service: async () => { throw Error("provider offline"); },
  });
  change(window, rows(panel)[0].querySelector("input"), true);
  await tick();
  assert.equal(rows(panel)[0].querySelector("input").checked, false);
  assert.match(panel.shadowRoot.textContent, /Unable to update task.*provider offline/);
});

test("pending checkbox updates cannot be submitted twice", async () => {
  const pending = deferred();
  const { panel, window, calls } = await setup({
    items: [{ uid: "a", summary: "Apples", status: "needs_action" }],
    service: () => pending.promise,
  });
  change(window, rows(panel)[0].querySelector("input"), true);
  assert.equal(rows(panel)[0].querySelector("input").disabled, true);
  change(window, rows(panel)[0].querySelector("input"), false);
  assert.equal(calls.length, 1);
  pending.resolve();
  await tick(); await tick();
});

test("task names are rendered as text, not HTML", async () => {
  const { panel } = await setup({ items: [{ uid: "x", summary: "<img src=x onerror=alert(1)>", status: "needs_action" }] });
  assert.equal(panel.shadowRoot.querySelectorAll("img").length, 0);
  assert.match(rows(panel)[0].textContent, /<img/);
});

test("switching configured lists targets selected entity", async () => {
  const { panel, window, calls } = await setup({ lists: ["todo.groceries", "todo.hardware"] });
  panel.shadowRoot.querySelectorAll("nav button")[1].click();
  await tick();
  panel._input.value = "Screws";
  panel._form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await tick();
  assert.equal(calls[0].data.entity_id, "todo.hardware");
});

test("external To-do changes refresh the selected list and preserve the task draft", async () => {
  const { panel, window, hass, items, requests } = await setup();
  const input = panel.shadowRoot.querySelector("ha-input");
  input.value = "Keep this draft";
  input.dispatchEvent(new window.Event("input"));
  const initialRequests = requests.length;

  panel.hass = { ...hass, states: { ...hass.states, "sensor.example": { state: "1" } } };
  assert.equal(requests.length, initialRequests);

  items.push({ uid: "external", summary: "Added elsewhere", status: "needs_action" });
  panel.hass = {
    ...hass,
    states: {
      ...hass.states,
      "todo.groceries": { ...hass.states["todo.groceries"], state: "1" },
    },
  };
  await tick();
  assert.equal(rows(panel)[0].textContent, "Added elsewhere");
  assert.equal(panel.shadowRoot.querySelector("ha-input"), input);
  assert.equal(input.value, "Keep this draft");
});

test("a delayed response from a previous connection cannot restore its lists", async () => {
  const { panel, hass } = await setup();
  const pending = deferred();
  panel.hass = {
    ...hass,
    connection: { sendMessagePromise: () => pending.promise },
  };
  assert.equal(panel.shadowRoot.querySelector("nav button"), null);
  panel.hass = {
    ...hass,
    connection: { sendMessagePromise: async () => ({ lists: [] }) },
  };
  await tick();
  pending.resolve({ lists: ["todo.groceries"] });
  await tick();
  assert.equal(panel.shadowRoot.querySelector("nav button"), null);
  assert.match(panel.shadowRoot.textContent, /No lists selected/);
});

test("a slow task response cannot overwrite the list the user switched to", async () => {
  const groceries = deferred();
  const { panel } = await setup({
    lists: ["todo.groceries", "todo.hardware"],
    readItems: (id) => id === "todo.groceries"
      ? groceries.promise
      : [{ uid: "screws", summary: "Screws", status: "needs_action" }],
  });
  panel.shadowRoot.querySelectorAll("nav button")[1].click();
  await tick();
  assert.deepEqual(rows(panel).map((row) => row.textContent), ["Screws"]);

  groceries.resolve([{ uid: "apples", summary: "Apples", status: "needs_action" }]);
  await tick();
  assert.deepEqual(rows(panel).map((row) => row.textContent), ["Screws"]);
});

function openRename(panel, title) {
  const root = panel.shadowRoot;
  [...root.querySelectorAll("button")].find((button) =>
    button.getAttribute("aria-label") === `Rename ${title}`).click();
  return root.querySelector(".title-input");
}

function saveTitle(window, input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.form.requestSubmit();
}

test("rename uses the stable ID even when two tasks have the same title", async () => {
  const { panel, window, calls } = await setup({ items: [
    { uid: "first", summary: "Apples", status: "needs_action" },
    { uid: "second", summary: "Apples", status: "needs_action" },
  ] });
  const input = openRename(panel, "Apples");
  assert.equal(input.value, "Apples");
  saveTitle(window, input, "  Green apples  ");
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].data)), {
    entity_id: "todo.groceries", item: "second", rename: "Green apples",
  });
  assert.deepEqual(rows(panel).map((row) => row.textContent), ["Green apples", "Apples"]);
  assert.equal(input.form.hidden, true);
});

test("cancel and unsupported items never submit a rename", async () => {
  const { panel, calls } = await setup({ items: [
    { uid: "first", summary: "Apples", status: "needs_action" },
    { summary: "No ID", status: "needs_action" },
  ] });
  const input = openRename(panel, "Apples");
  input.value = "Discard me";
  deleteButton(panel, "Cancel").click();
  assert.equal(input.form.hidden, true);
  assert.equal(panel.shadowRoot.activeElement.textContent, "Apples");
  assert.equal(calls.length, 0);
  assert.equal(panel.shadowRoot.querySelector('[aria-label="Rename No ID"]'), null);
  const readOnly = await setup({
    supportedFeatures: 0, items: [{ uid: "first", summary: "Apples" }],
  });
  assert.equal(readOnly.panel.shadowRoot.querySelector('[aria-label="Rename Apples"]'), null);
});

test("a rejected rename preserves the draft and shows the original task title", async () => {
  const { panel, window } = await setup({
    items: [{ uid: "first", summary: "Apples", status: "needs_action" }],
    service: async () => { throw Error("provider offline"); },
  });
  const input = openRename(panel, "Apples");
  saveTitle(window, input, "Green apples");
  await tick();
  assert.equal(input.form.hidden, false);
  assert.equal(input.value, "Green apples");
  assert.equal(rows(panel)[0].textContent, "Apples");
  assert.match(panel.shadowRoot.querySelector('.edit-form + [role="alert"]').textContent, /provider offline/);
});

test("an external rename detected on save preserves the newer title", async () => {
  const items = [{ uid: "first", summary: "Apples", status: "needs_action" }];
  const { panel, window, calls } = await setup({ items });
  const input = openRename(panel, "Apples");
  items[0].summary = "Changed elsewhere";
  saveTitle(window, input, "Green apples");
  await tick();
  assert.equal(input.value, "Green apples");
  assert.equal(rows(panel)[0].textContent, "Changed elsewhere");
  assert.match(panel.shadowRoot.querySelector('.edit-form + [role="alert"]').textContent, /changed elsewhere/);
  assert.equal(calls.length, 0);
});

function deleteButton(panel, text) {
  return [...panel.shadowRoot.querySelectorAll(".edit-form button")].find(
    (button) => button.textContent === text && !button.hidden
  );
}

test("delete confirmation names the task and keeping it leaves the draft and list intact", async () => {
  const { panel, calls } = await setup({ items: [{ uid: "one", summary: "Apples" }] });
  const input = openRename(panel, "Apples");
  input.value = "Unsaved draft";
  deleteButton(panel, "Delete").click();
  assert.match(panel.shadowRoot.querySelector(".delete-confirmation").textContent, /Delete .*Apples/);
  assert.equal(panel.shadowRoot.activeElement.textContent, "Keep task");
  deleteButton(panel, "Keep task").click();
  assert.equal(input.value, "Unsaved draft");
  assert.deepEqual(rows(panel).map((row) => row.textContent), ["Apples"]);
  assert.equal(calls.length, 0);
});

test("a confirmed delete removes the selected UID among duplicate titles", async () => {
  const { panel, calls, items } = await setup({ items: [
    { uid: "older", summary: "Apples" },
    { uid: "newer", summary: "Apples" },
  ] });
  openRename(panel, "Apples");
  deleteButton(panel, "Delete").click();
  deleteButton(panel, "Delete task").click();
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    domain: "todo", action: "remove_item", data: { entity_id: "todo.groceries", item: "newer" },
  });
  assert.deepEqual(items.map((item) => item.uid), ["older"]);
  assert.deepEqual(rows(panel).map((row) => row.textContent), ["Apples"]);
});

test("a failed delete leaves the task visible and allows retry", async () => {
  const { panel } = await setup({
    items: [{ uid: "one", summary: "Apples" }],
    service: async () => { throw Error("provider offline"); },
  });
  openRename(panel, "Apples");
  deleteButton(panel, "Delete").click();
  deleteButton(panel, "Delete task").click();
  await tick();
  assert.equal(rows(panel)[0].textContent, "Apples");
  assert.match(panel.shadowRoot.querySelector('[role="alert"]').textContent, /Unable to delete task.*provider offline/);
  assert.equal(deleteButton(panel, "Delete task").disabled, false);
});

test("delete-only providers can open the editor and providers without delete hide the action", async () => {
  const items = [{ uid: "one", summary: "Apples" }];
  const renameOnly = await setup({ items, supportedFeatures: 4 });
  openRename(renameOnly.panel, "Apples");
  assert.equal(deleteButton(renameOnly.panel, "Delete"), undefined);
  const deleteOnly = await setup({ items, supportedFeatures: 2 });
  deleteOnly.panel.shadowRoot.querySelector('[aria-label="Open task Apples"]').click();
  assert.ok(deleteButton(deleteOnly.panel, "Delete"));
  assert.equal(deleteOnly.panel.shadowRoot.querySelector(".title-input").hidden, true);
});

test("description and date-only edits send only changed fields, including explicit clears", async () => {
  const { panel, calls } = await setup({ supportedFeatures: 4 | 16 | 64, items: [
    { uid: "one", summary: "Apples", description: "Old note", due: "2030-04-05" },
  ] });
  const title = openRename(panel, "Apples");
  const description = title.form.querySelector("textarea");
  const due = title.form.querySelector('input[type="date"]');
  assert.equal(description.value, "Old note");
  assert.equal(due.value, "2030-04-05");
  description.value = "New note";
  due.value = "2030-04-06";
  title.form.requestSubmit();
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].data)), {
    entity_id: "todo.groceries", item: "one", description: "New note", due_date: "2030-04-06",
  });

  openRename(panel, "Apples");
  description.value = "";
  due.value = "";
  title.form.requestSubmit();
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].data)), {
    entity_id: "todo.groceries", item: "one", description: null, due_date: null,
  });
});

test("only supported fields appear and saving a title preserves timed deadlines", async () => {
  const renameOnly = await setup({ items: [{ uid: "one", summary: "Apples" }] });
  const title = openRename(renameOnly.panel, "Apples");
  assert.equal(title.form.querySelector("textarea").parentElement.hidden, true);
  assert.equal(title.form.querySelector('input[type="date"]').parentElement.hidden, true);

  const { panel, window, calls } = await setup({ supportedFeatures: 4 | 16 | 64, items: [
    { uid: "one", summary: "Apples", description: "Keep note", due: "2030-04-05T12:30:00+00:00" },
  ] });
  const input = openRename(panel, "Apples");
  assert.equal(input.form.querySelector('input[type="date"]').parentElement.hidden, true);
  assert.match(input.form.querySelector(".timed-deadline").textContent, /Due date and time/);
  saveTitle(window, input, "Green apples");
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].data)), {
    entity_id: "todo.groceries", item: "one", rename: "Green apples",
  });
});

test("an external description change blocks overwriting that field and preserves the draft", async () => {
  const items = [{ uid: "one", summary: "Apples", description: "Old note" }];
  const { panel, calls } = await setup({ items, supportedFeatures: 4 | 64 });
  const title = openRename(panel, "Apples");
  const description = title.form.querySelector("textarea");
  description.value = "Draft note";
  items[0].description = "Newer note";
  title.form.requestSubmit();
  await tick();
  assert.equal(description.value, "Draft note");
  assert.match(panel.shadowRoot.querySelector('[role="alert"]').textContent, /changed elsewhere/);
  assert.equal(calls.length, 0);
});

test("timed deadlines can be edited, changed to date-only and cleared", async () => {
  const { panel, calls } = await setup({ supportedFeatures: 4 | 16 | 32, items: [
    { uid: "one", summary: "Apples", due: "2030-07-05T15:30:00Z" },
  ] });
  const title = openRename(panel, "Apples");
  const date = title.form.querySelector('input[type="date"]');
  const time = title.form.querySelector('input[type="time"]');
  assert.equal(time.parentElement.hidden, false);
  date.value = "2030-07-06";
  time.value = "10:45:00";
  title.form.requestSubmit();
  await tick();
  assert.equal(calls[0].data.due_datetime, new Date("2030-07-06T10:45:00").toISOString());
  assert.equal("due_date" in calls[0].data, false);

  openRename(panel, "Apples");
  time.value = "";
  title.form.requestSubmit();
  await tick();
  assert.equal(calls[1].data.due_date, "2030-07-06");

  openRename(panel, "Apples");
  deleteButton(panel, "Clear deadline").click();
  title.form.requestSubmit();
  await tick();
  assert.equal(calls[2].data.due_datetime, null);
});

test("unchanged timed deadlines retain their original offset and seconds", async () => {
  const { panel, window, calls } = await setup({ supportedFeatures: 4 | 16 | 32, items: [
    { uid: "one", summary: "Apples", due: "2030-11-03T01:30:47-06:00" },
  ] });
  const title = openRename(panel, "Apples");
  saveTitle(window, title, "Green apples");
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].data)), {
    entity_id: "todo.groceries", item: "one", rename: "Green apples",
  });
});

test("datetime-only providers reject date-only edits and preserve a rejected draft", async () => {
  const { panel, calls } = await setup({ supportedFeatures: 4 | 32, items: [
    { uid: "one", summary: "Apples" },
  ] });
  const title = openRename(panel, "Apples");
  const date = title.form.querySelector('input[type="date"]');
  const time = title.form.querySelector('input[type="time"]');
  date.value = "2030-07-06";
  title.form.requestSubmit();
  await tick();
  assert.match(panel.shadowRoot.querySelector('[role="alert"]').textContent, /requires a time/);
  assert.equal(calls.length, 0);
  time.value = "10:30";
  date.value = "";
  title.form.requestSubmit();
  await tick();
  assert.match(panel.shadowRoot.querySelector('[role="alert"]').textContent, /Choose a due date/);
  assert.equal(time.value, "10:30");
  assert.equal(calls.length, 0);
});

test("structured Home Assistant errors show the message and preserve the draft", async () => {
  const { window, panel } = await setup({
    service: async () => { throw { code: "service_validation_error", message: "Synthetic provider unavailable" }; },
  });
  const input = panel.shadowRoot.querySelector("ha-input");
  input.value = "Keep this draft";
  input.dispatchEvent(new window.Event("input"));
  panel.shadowRoot.querySelector("form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  await tick(); await tick();
  assert.equal(input.value, "Keep this draft");
  assert.match(panel.shadowRoot.textContent, /Unable to add task: Synthetic provider unavailable/);
});

function selectFilter(window, panel, value) {
  const select = panel.shadowRoot.querySelector("select");
  select.value = value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function visibleTitles(panel) {
  return rows(panel).map((row) => row.querySelector(".task-title, span").textContent);
}

test("All, Active and Completed preserve provider order, drafts and the selected filter", async () => {
  const items = [
    { uid: "a", summary: "First active", status: "needs_action" },
    { uid: "c", summary: "Completed task", status: "completed" },
    { uid: "b", summary: "Second active", status: "needs_action" },
  ];
  const { panel, window, requests, calls } = await setup({ items, lists: ["todo.groceries", "todo.hardware"] });
  const input = panel._input;
  input.value = "Unsent draft";
  input.dispatchEvent(new window.Event("input"));
  const reads = requests.length;
  selectFilter(window, panel, "active");
  assert.deepEqual(visibleTitles(panel), ["Second active", "First active"]);
  assert.equal(panel.shadowRoot.querySelector('[role="status"]').textContent, "2 of 3 tasks");
  selectFilter(window, panel, "completed");
  assert.deepEqual(visibleTitles(panel), ["Completed task"]);
  assert.equal(panel._input, input);
  assert.equal(input.value, "Unsent draft");
  assert.equal(requests.length, reads);
  assert.equal(calls.length, 0);
  panel.shadowRoot.querySelectorAll("nav button")[1].click();
  await tick(); await tick();
  assert.equal(panel.shadowRoot.querySelector("select").value, "completed");
  selectFilter(window, panel, "all");
  assert.deepEqual(visibleTitles(panel), ["Second active", "First active", "Completed task"]);
  assert.deepEqual(items.map((item) => item.uid), ["a", "c", "b"]);
  panel.remove(); window.close();
});

for (const [zone, expectedToday, expectedOverdue] of [
  ["America/Chicago", ["Date Jan 5", "Timed past", "Timed future"], ["Date Jan 4", "Timed past"]],
  ["Pacific/Kiritimati", ["Date Jan 6", "Timed past", "Timed future"], ["Date Jan 4", "Date Jan 5", "Timed past"]],
  ["UTC", ["Date Jan 6", "Timed future"], ["Date Jan 4", "Date Jan 5", "Timed past"]],
]) {
  test(`date filters use ${zone} calendar days and absolute timed deadlines`, async () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = zone;
    let window;
    try {
      const items = [
        { uid: "4", summary: "Date Jan 4", status: "needs_action", due: "2030-01-04" },
        { uid: "5", summary: "Date Jan 5", status: "needs_action", due: "2030-01-05" },
        { uid: "6", summary: "Date Jan 6", status: "needs_action", due: "2030-01-06" },
        { uid: "p", summary: "Timed past", status: "needs_action", due: "2030-01-05T23:00:00Z" },
        { uid: "f", summary: "Timed future", status: "needs_action", due: "2030-01-06T03:00:00Z" },
        { uid: "c", summary: "Completed date", status: "completed", due: "2030-01-05" },
        { uid: "n", summary: "No deadline", status: "needs_action" },
        { uid: "i", summary: "Invalid deadline", status: "needs_action", due: "not a date" },
        { uid: "x", summary: "Impossible date", status: "needs_action", due: "2030-02-30" },
      ];
      const state = await setup({ items, clock: () => "2030-01-06T00:30:00Z" });
      window = state.window;
      selectFilter(window, state.panel, "today");
      assert.deepEqual(visibleTitles(state.panel).sort(), [...expectedToday].sort());
      assert.match(state.panel._filterHelp.textContent, new RegExp(zone));
      selectFilter(window, state.panel, "overdue");
      assert.deepEqual(visibleTitles(state.panel).sort(), [...expectedOverdue].sort());
      selectFilter(window, state.panel, "all");
      assert.equal(rows(state.panel).length, items.length);
      state.panel.remove();
    } finally {
      window?.close();
      if (originalTZ === undefined) delete process.env.TZ;
      else process.env.TZ = originalTZ;
    }
  });
}

test("filtered empty state, completion and rollback keep task data intact", async () => {
  const { window, panel } = await setup({ items: [{ uid: "a", summary: "Milk", status: "needs_action" }],
    service: async () => { throw { message: "Synthetic denied write" }; } });
  selectFilter(window, panel, "completed");
  assert.match(panel._results.textContent, /No tasks match this filter/);
  selectFilter(window, panel, "active");
  change(window, panel.shadowRoot.querySelector('input[type="checkbox"]'), true);
  await tick(); await tick();
  assert.deepEqual(visibleTitles(panel), ["Milk"]);
  assert.match(panel._results.textContent, /Synthetic denied write/);
  panel.remove(); window.close();
});

test("date filters refresh at deadline and midnight boundaries and clean up on disconnect", async () => {
  const originalTZ = process.env.TZ;
  process.env.TZ = "America/Chicago";
  let window;
  try {
    let now = "2030-03-10T07:59:59Z";
    const state = await setup({ clock: () => now, items: [
      { uid: "a", summary: "At spring-forward", status: "needs_action", due: "2030-03-10T03:00:00-05:00" },
      { uid: "b", summary: "Date only", status: "needs_action", due: "2030-03-10" },
    ] });
    window = state.window;
    const pending = new Map();
    let nextId = 0;
    window.setTimeout = (callback, delay) => { pending.set(++nextId, { callback, delay }); return nextId; };
    window.clearTimeout = (id) => pending.delete(id);
    selectFilter(window, state.panel, "overdue");
    assert.deepEqual(visibleTitles(state.panel), []);
    assert.equal(pending.size, 1);
    const first = pending.get(state.panel._filterTimer);
    assert.equal(first.delay, 1001);
    now = "2030-03-10T08:00:00.001Z";
    pending.clear(); first.callback();
    assert.deepEqual(visibleTitles(state.panel), ["At spring-forward"]);
    selectFilter(window, state.panel, "today");
    now = "2030-03-11T05:00:00Z";
    window.document.dispatchEvent(new window.Event("visibilitychange"));
    assert.equal(rows(state.panel).length, 0);
    assert.equal(pending.size, 1);
    state.panel.remove();
    assert.equal(pending.size, 0);
    assert.equal(state.panel._filterTimer, null);
  } finally {
    window?.close();
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});

test("switching filters preserves an unsaved task editor", async () => {
  const { panel, window, calls } = await setup({ items: [
    { uid: "a", summary: "Apples", status: "needs_action" },
  ] });
  const title = openRename(panel, "Apples");
  title.value = "Unsaved title";
  title.dispatchEvent(new window.Event("input", { bubbles: true }));
  selectFilter(window, panel, "completed");
  assert.equal(title.form.hidden, false);
  assert.equal(title.value, "Unsaved title");
  assert.equal(calls.length, 0);
  selectFilter(window, panel, "active");
  assert.equal(title.value, "Unsaved title");
  panel.remove(); window.close();
});

test("repeated fall-back wall times have distinct overdue instants", async () => {
  const originalTZ = process.env.TZ;
  process.env.TZ = "America/Chicago";
  let window;
  try {
    const state = await setup({ clock: () => "2030-11-03T07:15:00Z", items: [
      { uid: "first", summary: "First 1:30", status: "needs_action", due: "2030-11-03T01:30:00-05:00" },
      { uid: "second", summary: "Second 1:30", status: "needs_action", due: "2030-11-03T01:30:00-06:00" },
    ] });
    window = state.window;
    selectFilter(window, state.panel, "today");
    assert.deepEqual(visibleTitles(state.panel), ["Second 1:30", "First 1:30"]);
    selectFilter(window, state.panel, "overdue");
    assert.deepEqual(visibleTitles(state.panel), ["First 1:30"]);
    state.panel.remove();
  } finally {
    window?.close();
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});

test("date-only deadlines stay due through the final local millisecond", async () => {
  const originalTZ = process.env.TZ;
  process.env.TZ = "America/Chicago";
  let window;
  try {
    let now = "2030-01-06T05:59:59.999Z";
    const state = await setup({ clock: () => now, items: [
      { uid: "a", summary: "Ends at midnight", status: "needs_action", due: "2030-01-05" },
    ] });
    window = state.window;
    selectFilter(window, state.panel, "today");
    assert.deepEqual(visibleTitles(state.panel), ["Ends at midnight"]);
    selectFilter(window, state.panel, "overdue");
    assert.equal(rows(state.panel).length, 0);
    now = "2030-01-06T06:00:00Z";
    state.panel.render();
    assert.deepEqual(visibleTitles(state.panel), ["Ends at midnight"]);
    selectFilter(window, state.panel, "today");
    assert.equal(rows(state.panel).length, 0);
    state.panel.remove();
  } finally {
    window?.close();
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});
