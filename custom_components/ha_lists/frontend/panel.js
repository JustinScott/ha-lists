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
        // Clear and refocus immediately, before the asynchronous list refresh.
        // The input must remain enabled: disabling it dismisses Android's IME.
        this._input.value = "";
        this._input.focus();
        await this.loadItems();
        if (this._selected === entityId && this.isConnected) this._input.focus();
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
    // Construct the form once. Never detach or replace its input during updates:
    // Android WebView dismisses the keyboard when a focused input is removed.
    if (!this._main) {
      const style = document.createElement("style");
      style.textContent = `
        :host { display:block; color:var(--primary-text-color); font-family:sans-serif; }
        main { max-width:1200px; margin:auto; padding:24px; }
        h1 { margin:0 0 20px; font-size:26px; }
        .layout { display:grid; grid-template-columns:minmax(220px,290px) minmax(0,1fr); gap:18px; }
        nav,article { padding:18px; background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:12px; }
        nav button { display:block; width:100%; border:0; border-radius:8px; background:transparent; color:inherit; text-align:left; font:inherit; padding:12px; cursor:pointer; overflow-wrap:anywhere; }
        nav button[aria-current=true] { background:var(--secondary-background-color); font-weight:600; }
        button:focus-visible { outline:2px solid var(--primary-color); }
        .muted { color:var(--secondary-text-color); }
        .error { color:var(--error-color); }
        form { display:flex; gap:8px; margin:12px 0; }
        ha-input { flex:1; min-width:0; }
        form button { padding:10px 14px; font:inherit; cursor:pointer; }
        li { padding:10px 0; border-bottom:1px solid var(--divider-color); }
        ul { list-style:none; padding:0; }
        @media(max-width:650px) { main { padding:12px; } .layout { grid-template-columns:1fr; } }
      `;
      this._main = document.createElement("main");
      const h1 = document.createElement("h1");
      h1.textContent = "Lists";
      const layout = document.createElement("div");
      layout.className = "layout";
      this._nav = document.createElement("nav");
      this._nav.setAttribute("aria-label", "Configured to-do lists");
      const article = document.createElement("article");
      this._heading = document.createElement("h2");
      this._form = document.createElement("form");
      // Use Home Assistant's native input component for companion-app focus handling.
      // ha-input superseded ha-textfield in HA 2026.4.
      this._input = document.createElement("ha-input");
      this._input.setAttribute("type", "text");
      this._input.setAttribute("label", "Add a task");
      this._input.setAttribute("maxlength", "255");
      this._input.setAttribute("enterkeyhint", "done");
      // Handle Enter explicitly: ha-input's native field lives in its own shadow DOM,
      // so relying on the surrounding form's implicit submit is unreliable on Android.
      const submitOnEnter = (event) => {
        if (event.key !== "Enter" || event.isComposing || event.repeat || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        this._draft = this._input.value;
        this.addItem();
      };
      this._input.addEventListener("keydown", submitOnEnter);
      // Some HA input implementations stop keyboard events inside their shadow root.
      // Bind to the native input as well, without double-handling a single event.
      const bindNativeEnter = () => {
        const nativeInput = this._input.shadowRoot?.querySelector("input");
        if (nativeInput && nativeInput !== this._nativeInput) {
          this._nativeInput = nativeInput;
          nativeInput.addEventListener("keydown", submitOnEnter);
        }
      };
      this._input.updateComplete?.then(bindNativeEnter);
      customElements.whenDefined("ha-input").then(() => {
        this._input.updateComplete?.then(bindNativeEnter);
      });
      this._input.addEventListener("input", () => { this._draft = this._input.value; });
      this._submit = document.createElement("button");
      this._submit.type = "submit";
      this._form.addEventListener("submit", (event) => {
        event.preventDefault();
        this._draft = this._input.value;
        this.addItem();
      });
      this._form.append(this._input, this._submit);
      this._results = document.createElement("div");
      this._note = document.createElement("p");
      this._note.className = "muted";
      this._note.textContent = "Task creation is available. Editing, completion and rich metadata are coming later.";
      article.append(this._heading, this._form, this._results, this._note);
      layout.append(this._nav, article);
      this._main.append(h1, layout);
      this.shadowRoot.replaceChildren(style, this._main);
    }
    const entities = this.availableLists;
    const selected = entities.find((entity) => entity.entity_id === this._selected);
    const navTitle = document.createElement("strong");
    navTitle.textContent = "My lists";
    const navChildren = [navTitle];
    for (const entity of entities) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entity.attributes?.friendly_name || entity.entity_id;
      button.setAttribute("aria-current", String(entity.entity_id === this._selected));
      button.addEventListener("click", () => { this._selected = entity.entity_id; this.loadItems(); });
      navChildren.push(button);
    }
    if (this._configured?.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "No lists selected. Open Settings → Devices & services → HA Lists → Configure to choose lists.";
      navChildren.push(p);
    }
    this._nav.replaceChildren(...navChildren);
    this._heading.textContent = selected?.attributes?.friendly_name || "Select a list";
    this._form.hidden = !selected;
    // Do not disable the focused input during a write or refresh: on Android
    // that blurs the native field and closes the soft keyboard.
    this._input.disabled = !selected || selected.state === "unavailable";
    this._submit.disabled = this._adding || this._loading || this._input.disabled;
    this._submit.textContent = this._adding ? "Adding…" : "Add";
    // Keep the live input value and caret intact while it has focus.
    if (this.shadowRoot.activeElement !== this._input && this._input.value !== this._draft) {
      this._input.value = this._draft;
    }
    const results = [];
    if (this._loading) {
      const p = document.createElement("p");
      p.textContent = "Loading tasks…";
      results.push(p);
    } else if (this._error) {
      const p = document.createElement("p");
      p.className = "error";
      p.setAttribute("role", "alert");
      p.textContent = this._error;
      results.push(p);
    } else if (selected) {
      if (!this._items.length) {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = "No tasks found.";
        results.push(p);
      } else {
        const list = document.createElement("ul");
        for (const item of this._items) {
          const li = document.createElement("li");
          li.textContent = (item.status === "completed" ? "✓ " : "○ ") + (item.summary || "Untitled task");
          list.append(li);
        }
        results.push(list);
      }
    }
    this._results.replaceChildren(...results);
  }
}
if (!customElements.get("ha-lists-panel")) {
  customElements.define("ha-lists-panel", HaListsPanel);
}
