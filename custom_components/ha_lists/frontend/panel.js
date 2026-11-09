/** Lists panel: selected provider discovery and task retrieval and native todo item creation. */
class HaListsPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._connection = null;
    this._configured = null;
    this._selected = "";
    this._items = [];
    this._error = "";
    this._loading = false;
    this._adding = false;
    this._draft = "";
    this._requestId = 0;
  }

  set hass(value) {
    this._hass = value;
    if (value?.connection && value.connection !== this._connection) {
      this._connection = value.connection;
      this.loadConfiguration();
    }
    // HA updates `hass` frequently. Replacing the focused input on every
    // state update dismisses mobile keyboards and interrupts text entry.
    // Configuration changes and task actions render explicitly instead.
  }

  set panel(value) { this._panel = value; }
  connectedCallback() { this.render(); }

  async loadConfiguration() {
    try {
      const response = await this._connection.sendMessagePromise({ type: "ha_lists/lists" });
      this._configured = response.lists || [];
      this._error = "";
      this.render();
      this.selectFirstAvailable();
    } catch (error) {
      this._error = "Could not load list configuration: " + String(error);
      this._configured = [];
      this.render();
    }
  }

  get availableLists() {
    const states = this._hass?.states || {};
    return (this._configured || [])
      .map((id) => states[id] || { entity_id: id, state: "unavailable", attributes: { friendly_name: id } });
  }

  selectFirstAvailable() {
    const ids = this.availableLists.map((entity) => entity.entity_id);
    if (!ids.includes(this._selected)) this._selected = ids[0] || "";
    this.loadItems();
  }

  async loadItems() {
    const entityId = this._selected;
    const requestId = ++this._requestId;
    this._items = [];
    this._error = "";
    if (!entityId || !this._connection) {
      this._loading = false;
      this.render();
      return;
    }
    this._loading = true;
    this.render();
    try {
      const response = await this._connection.sendMessagePromise({
        type: "todo/item/list",
        entity_id: entityId
      });
      if (requestId !== this._requestId) return;
      this._items = response.items || [];
    } catch (error) {
      if (requestId !== this._requestId) return;
      this._error = "Unable to load tasks: " + String(error);
    } finally {
      if (requestId === this._requestId) {
        this._loading = false;
        this.render();
      }
    }
  }

  async addItem() {
    const entityId = this._selected;
    const item = this._draft.trim();
    if (!entityId || !item || this._adding || this._loading) return;
    if (!this.availableLists.some((entity) => entity.entity_id === entityId)) return;
    this._adding = true;
    this._error = "";
    this.render();
    try {
      await this._hass.callService("todo", "add_item", {
        entity_id: entityId,
        item
      });
      if (this._selected === entityId) {
        this._draft = "";
        await this.loadItems();
      }
    } catch (error) {
      this._error = "Unable to add task: " + String(error);
    } finally {
      this._adding = false;
      this.render();
    }
  }

  render() {
    if (!this.shadowRoot) return;
    // Preserve the actual focused input node while the Android keyboard is open.
    // Replacing the shadow DOM dismisses the keyboard even when the value is saved.
    const focused = this.shadowRoot.activeElement;
    if (focused?.matches?.('input[aria-label="New task"]') && !this._adding) return;
    const style = document.createElement("style");
    style.textContent = `
      :host { display:block; color:var(--primary-text-color); font-family:var(--paper-font-body1_-_font-family,sans-serif); }
      main { max-width:1200px; margin:auto; padding:24px; }
      h1 { margin:0 0 20px; font-size:26px; }
      .layout { display:grid; grid-template-columns:minmax(220px,290px) minmax(0,1fr); gap:18px; }
      nav,article { padding:18px; background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:12px; }
      nav button { display:block; width:100%; border:0; border-radius:8px; background:transparent; color:inherit; text-align:left; font:inherit; padding:12px; cursor:pointer; overflow-wrap:anywhere; }
      nav button[aria-current=true] { background:var(--secondary-background-color); font-weight:600; }
      button:focus-visible { outline:2px solid var(--primary-color); }
      .muted { color:var(--secondary-text-color); }
      .error { color:var(--error-color); }
      form { display:flex; gap:8px; margin:12px 0; }\n      input { flex:1; min-width:0; padding:10px; color:inherit; background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:8px; font:inherit; }\n      form button { padding:10px 14px; font:inherit; cursor:pointer; }\n      li { padding:10px 0; border-bottom:1px solid var(--divider-color); }
      ul { list-style:none; padding:0; }
      @media(max-width:650px) { main { padding:12px; } .layout { grid-template-columns:1fr; } }
    `;
    const main = document.createElement("main");
    const h1 = document.createElement("h1");
    h1.textContent = "Lists";
    main.append(h1);
    const layout = document.createElement("div");
    layout.className = "layout";
    const nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Configured to-do lists");
    const navTitle = document.createElement("strong");
    navTitle.textContent = "My lists";
    nav.append(navTitle);
    for (const entity of this.availableLists) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entity.attributes?.friendly_name || entity.entity_id;
      button.setAttribute("aria-current", String(entity.entity_id === this._selected));
      button.addEventListener("click", () => { this._selected = entity.entity_id; this.loadItems(); });
      nav.append(button);
    }
    if (this._configured?.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "No lists selected. Open Settings → Devices & services → HA Lists → Configure to choose lists.";
      nav.append(p);
    }
    const article = document.createElement("article");
    const selected = this.availableLists.find((entity) => entity.entity_id === this._selected);
    const heading = document.createElement("h2");
    heading.textContent = selected?.attributes?.friendly_name || "Select a list";
    article.append(heading);
    if (selected) {
      const form = document.createElement("form");
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Add a task";
      input.setAttribute("aria-label", "New task");
      input.maxLength = 255;
      input.value = this._draft;
      input.disabled = this._adding || this._loading || selected.state === "unavailable";
      input.addEventListener("input", () => { this._draft = input.value; });
      input.addEventListener("blur", () => { this.render(); });
      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = this._adding ? "Adding…" : "Add";
      button.disabled = input.disabled;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        this._draft = input.value;
        this.addItem();
      });
      form.append(input, button);
      article.append(form);
    }
    if (this._loading) {
      const p = document.createElement("p");
      p.textContent = "Loading tasks…";
      article.append(p);
    } else if (this._error) {
      const p = document.createElement("p");
      p.className = "error";
      p.setAttribute("role", "alert");
      p.textContent = this._error;
      article.append(p);
    } else if (selected) {
      if (!this._items.length) {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = "No tasks found.";
        article.append(p);
      } else {
        const list = document.createElement("ul");
        for (const item of this._items) {
          const li = document.createElement("li");
          li.textContent = (item.status === "completed" ? "✓ " : "○ ") + (item.summary || "Untitled task");
          list.append(li);
        }
        article.append(list);
      }
    }
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "Task creation is available. Editing, completion and rich metadata are coming later.";
    article.append(note);
    layout.append(nav, article);
    main.append(layout);
    this.shadowRoot.replaceChildren(style, main);
  }
}
if (!customElements.get("ha-lists-panel")) {
  customElements.define("ha-lists-panel", HaListsPanel);
}
