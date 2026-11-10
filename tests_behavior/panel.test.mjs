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

async function setup({ lists = ["todo.groceries"], items = [], service } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "outside-only", pretendToBeVisual: true,
  });
  const { window } = dom;
  class HaInput extends window.HTMLElement {
    constructor() { super(); this.value = ""; }
  }
  window.customElements.define("ha-input", HaInput);
  window.eval(source);
  const calls = [];
  const requests = [];
  const states = Object.fromEntries(lists.map((id) => [id, {
    entity_id: id, state: "0", attributes: { friendly_name: id },
  }]));
  const hass = {
    states,
    connection: {
      async sendMessagePromise(request) {
        requests.push(request);
        if (request.type === "ha_lists/lists") return { lists };
        if (request.type === "todo/item/list") return { items: items.map((item) => ({ ...item })) };
        throw new Error("Unexpected websocket message");
      },
    },
    async callService(domain, action, data) {
      calls.push({ domain, action, data });
      if (service) return service(domain, action, data);
      if (action === "add_item") items.push({ uid: "new-" + items.length, summary: data.item, status: "needs_action" });
      if (action === "update_item") {
        const item = items.find((candidate) => (candidate.uid || candidate.summary) === data.item);
        if (item) item.status = data.status;
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
});

test("Add button submits through native service and clears input", async () => {
  const { panel, window, calls } = await setup();
  panel._input.value = "Eggs";
  panel._form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await tick(); await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { domain: "todo", action: "add_item", data: { entity_id: "todo.groceries", item: "Eggs" } });
  assert.equal(panel._input.value, "");
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
  change(window, rows(panel)[0].querySelector("input"), true);
  await tick(); await tick();
  assert.deepEqual(calls[0], { domain: "todo", action: "update_item", data: { entity_id: "todo.groceries", item: "a", status: "completed" } });
  assert.deepEqual(rows(panel).map((row) => row.textContent), ["Bread", "Apples"]);
  assert.equal(rows(panel)[1].querySelector("span").className, "completed");
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
