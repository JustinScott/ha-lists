// Home Assistant TodoListEntityFeature
const DELETE_TODO_ITEM = 2;
const UPDATE_TODO_ITEM = 4;
const SET_DUE_DATE_ON_ITEM = 16;
const SET_DUE_DATETIME_ON_ITEM = 32;
const SET_DESCRIPTION_ON_ITEM = 64;

/** Lists panel: selected provider discovery and task retrieval and native todo item creation. */
class HaListsPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._narrow = false;
    this._connection = null;
    this._configured = null;
    this._management = null;
    this._configurationRequestId = 0;
    this._configurationSubscription = null;
    this._listOperation = null;
    this._listError = "";
    this._listNotice = "";
    this._newListOpen = false;
    this._connectListOpen = false;
    this._deleteListTarget = null;
    this._selected = "";
    this._items = [];
    this._error = "";
    this._loading = false;
    this._adding = false;
    this._draft = "";
    this._suggestions = [];
    this._suggestionIndex = -1;
    this._suggestionEpoch = 0;
    this._suggestionTimer = null;
    this._historyEpoch = 0;
    this._historyBusy = false;
    this._requestId = 0;
    this._updatingItems = new Set();
    this._edit = null;
    this._filter = "all";
    this._sort = "newest";
    this._search = "";
    this._searchOpen = false;
    this._viewOpen = false;
    this._searchPointerActive = false;
    this._searchBlurTimer = null;
    this.shadowRoot.addEventListener("pointerdown", () => { this._searchPointerActive = true; });
    this.shadowRoot.addEventListener("mousedown", () => { this._searchPointerActive = true; });
    this._onSearchPointerEnd = () => {
      if (!this._searchPointerActive) return;
      clearTimeout(this._searchBlurTimer);
      // Let the pointer gesture's click finish before collapsing layout beneath
      // it, including compatibility mouse events synthesized after touchend.
      this._searchBlurTimer = setTimeout(() => {
        this._searchBlurTimer = null;
        this._searchPointerActive = false;
        this.collapseEmptySearch();
      }, 0);
    };
    this._itemSubscription = null;
    this._filterTimer = null;
    this._onVisibility = () => {
      if (document.visibilityState === "visible") this.render();
    };
  }

  set hass(value) {
    const previous = this._hass;
    this._hass = value;
    if (value?.connection && value.connection !== this._connection) {
      this.stopItemSubscription();
      this.stopConfigurationSubscription();
      this._connection = value.connection;
      ++this._configurationRequestId;
      ++this._requestId;
      this._configured = null;
      this._management = null;
      this._listOperation = null;
      this._newListOpen = this._connectListOpen = false;
      this._deleteListTarget = null;
      this._listError = this._listNotice = "";
      this._selected = "";
      this._edit = null;
      this._items = [];
      this._loading = false;
      this._error = "";
      this.render();
      this.loadConfiguration();
      this.subscribeConfiguration();
    } else if (this._selected &&
        previous?.states?.[this._selected] !== value?.states?.[this._selected]) {
      this.loadItems();
    } else if (this._configured?.some((id) => previous?.states?.[id] !== value?.states?.[id])) {
      this.render();
    }
  }

  set panel(value) { this._panel = value; }
  set narrow(value) {
    this._narrow = Boolean(value);
    this.toggleAttribute("narrow", this._narrow);
    this.render();
  }
  get narrow() { return this._narrow; }
  connectedCallback() {
    document.addEventListener("visibilitychange", this._onVisibility);
    document.addEventListener("pointerup", this._onSearchPointerEnd);
    document.addEventListener("pointercancel", this._onSearchPointerEnd);
    document.addEventListener("mouseup", this._onSearchPointerEnd);
    this.render();
    this.subscribeConfiguration();
    if (this._selected) this.loadItems();
  }

  disconnectedCallback() {
    this.dismissSuggestions();
    ++this._historyEpoch;
    ++this._requestId;
    ++this._configurationRequestId;
    this.stopConfigurationSubscription();
    this.stopItemSubscription();
    document.removeEventListener("visibilitychange", this._onVisibility);
    document.removeEventListener("pointerup", this._onSearchPointerEnd);
    document.removeEventListener("pointercancel", this._onSearchPointerEnd);
    document.removeEventListener("mouseup", this._onSearchPointerEnd);
    clearTimeout(this._searchBlurTimer);
    this._searchBlurTimer = null;
    this._searchPointerActive = false;
    clearTimeout(this._filterTimer);
    this._filterTimer = null;
  }

  localDay(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")].join("-");
  }

  renderSearchControls() {
    this._searchControls.hidden = !this._configured?.includes(this._selected) ||
      !(this._searchOpen || this._search.trim());
    this._searchToggle.setAttribute("aria-expanded", String(!this._searchControls.hidden));
  }

  collapseEmptySearch() {
    if (this.isConnected && !this._search.trim() &&
        !this._searchControls.contains(this.shadowRoot.activeElement)) {
      this._searchOpen = false;
      this.renderSearchControls();
    }
  }

  stopConfigurationSubscription() {
    const subscription = this._configurationSubscription;
    this._configurationSubscription = null;
    if (subscription?.unsubscribe) Promise.resolve(subscription.unsubscribe()).catch(() => {});
  }

  async subscribeConfiguration() {
    const connection = this._connection;
    if (!connection || !this.isConnected || this._configurationSubscription?.connection === connection) return;
    this.stopConfigurationSubscription();
    const subscription = { connection, unsubscribe: null };
    this._configurationSubscription = subscription;
    try {
      const unsubscribe = await connection.subscribeMessage((response) => {
        if (this._configurationSubscription !== subscription || !this.isConnected) return;
        ++this._configurationRequestId;
        this.applyConfiguration(response);
      }, { type: "ha_lists/subscribe" });
      if (this._configurationSubscription !== subscription) await unsubscribe();
      else subscription.unsubscribe = unsubscribe;
    } catch {
      if (this._configurationSubscription === subscription) this._configurationSubscription = null;
    }
  }

  applyConfiguration(response) {
    this._configured = response.lists || [];
    this._management = response.management || null;
    const previous = this._selected;
    if (!this._configured.includes(previous)) {
      this._selected = this._configured[0] || "";
      this._edit = null;
    }
    if (previous !== this._selected || !this._selected) this.loadItems();
    else this.render();
  }

  async manageList(request) {
    if (!this._management || this._listOperation) return;
    const operation = { connection: this._connection, selected: this._selected };
    this._listOperation = operation;
    this._listError = this._listNotice = "";
    this.render();
    try {
      const response = await operation.connection.sendMessagePromise(request);
      if (operation !== this._listOperation || operation.connection !== this._connection || !this.isConnected) return;
      ++this._configurationRequestId;
      this.applyConfiguration(response);
      if (request.type === "ha_lists/list/create") {
        this._newListOpen = false;
        this._newListName.value = "";
        this._listNotice = response.entity_id
          ? "List created in Home Assistant."
          : "List created but not ready. Recover it in Settings → Devices & services, then connect it here.";
        if (response.entity_id && this._configured.includes(response.entity_id) && this._management &&
            this._selected === operation.selected && !this._edit && !this._draft.trim()) {
          this._selected = response.entity_id;
          await this.loadItems();
        }
      } else if (request.type === "ha_lists/list/delete") {
        this._deleteListTarget = null;
        this._listNotice = response.require_restart
          ? "List removed. Home Assistant requires a restart to finish unloading it."
          : "List and its tasks deleted from Home Assistant.";
      } else {
        this._connectListOpen = false;
        this._listNotice = request.visible ? "List connected." : "List removed from this panel. Its native tasks are unchanged.";
      }
    } catch (error) {
      if (operation === this._listOperation && operation.connection === this._connection) {
        this._listError = error?.message || String(error);
        if (["confirmation_changed", "not_deletable", "missing_list"].includes(error?.code)) await this.loadConfiguration();
      }
    } finally {
      if (operation === this._listOperation) {
        this._listOperation = null;
        this.render();
      }
    }
  }

  confirmListDeletion(target) {
    if (this._listOperation) return;
    this._deleteListTarget = target;
    this._confirmListName.value = "";
    this._listError = "";
    this.render();
    this._keepList.focus();
  }

  stopItemSubscription() {
    const subscription = this._itemSubscription;
    this._itemSubscription = null;
    if (subscription?.unsubscribe) {
      Promise.resolve(subscription.unsubscribe()).catch(() => {});
    }
  }

  async subscribeItems(entityId) {
    const connection = this._connection;
    if (this._itemSubscription?.entityId === entityId &&
        this._itemSubscription.connection === connection) return;
    this.stopItemSubscription();
    if (!entityId || !connection || !this.isConnected) return;
    const subscription = { entityId, connection, unsubscribe: null };
    this._itemSubscription = subscription;
    try {
      const unsubscribe = await connection.subscribeMessage((response) => {
        if (this._itemSubscription !== subscription || !this.isConnected) return;
        // A pushed snapshot supersedes any older in-flight list request.
        ++this._requestId;
        this._items = response.items || [];
        this._loading = false;
        this._error = "";
        this.render();
      }, { type: "todo/item/subscribe", entity_id: entityId });
      if (this._itemSubscription !== subscription) await unsubscribe();
      else subscription.unsubscribe = unsubscribe;
    } catch {
      // Retain ordinary reads/state refreshes if the provider/runtime rejects
      // subscriptions. No polling or wider permissions are introduced.
      if (this._itemSubscription === subscription) this._itemSubscription = null;
    }
  }

  filteredItems(now = new Date()) {
    const today = this.localDay(now);
    const query = this._search.trim().toLowerCase();
    return this._items.filter((item) => {
      if (query && ![item.summary, item.description].some((value) =>
        typeof value === "string" && value.toLowerCase().includes(query))) return false;
      const completed = item.status === "completed";
      if (this._filter === "all") return true;
      if (this._filter === "active") return !completed;
      if (this._filter === "completed") return completed;
      if (completed || typeof item.due !== "string") return false;
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(item.due);
      const due = new Date(dateOnly ? item.due + "T00:00:00Z" : item.due);
      if (!Number.isFinite(due.getTime())) return false;
      if (dateOnly && due.toISOString().slice(0, 10) !== item.due) return false;
      const day = dateOnly ? item.due : this.localDay(due);
      if (this._filter === "today") return day === today;
      return dateOnly ? day < today : due.getTime() < now.getTime();
    });
  }

  scheduleFilterRefresh() {
    clearTimeout(this._filterTimer);
    this._filterTimer = null;
    if (!this.isConnected || !["today", "overdue"].includes(this._filter)) return;
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // Refresh at calendar/deadline boundaries, and recheck clock/time zone each minute.
    let next = Math.min(midnight.getTime(), now.getTime() + 60000);
    if (this._filter === "overdue") {
      for (const item of this._items) {
        if (item.status === "completed" || typeof item.due !== "string" || !item.due.includes("T")) continue;
        const due = Date.parse(item.due);
        if (due >= now.getTime()) next = Math.min(next, due + 1);
      }
    }
    this._filterTimer = setTimeout(() => {
      this._filterTimer = null;
      this.render();
    }, Math.max(1, next - now.getTime()));
  }

  async loadConfiguration() {
    const connection = this._connection;
    const requestId = ++this._configurationRequestId;
    try {
      const response = await connection.sendMessagePromise({ type: "ha_lists/state" });
      if (connection !== this._connection || requestId !== this._configurationRequestId) return;
      this.applyConfiguration(response);
    } catch (error) {
      if (connection !== this._connection || requestId !== this._configurationRequestId) return;
      this._error = "Could not load list configuration: " + (error?.message || String(error));
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
    if (!ids.includes(this._selected)) {
      this._selected = ids[0] || "";
      this._edit = null;
    }
    this.loadItems();
  }

  async loadItems() {
    const entityId = this._selected;
    this.dismissSuggestions();
    this.loadSuggestionHistory();
    this.subscribeItems(entityId);
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
      this._error = "Unable to load tasks: " + (error?.message || String(error));
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
    this.dismissSuggestions();
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
      this._error = "Unable to add task: " + (error?.message || String(error));
    } finally {
      this._adding = false;
      this.render();
    }
  }

  dismissSuggestions() {
    clearTimeout(this._suggestionTimer);
    ++this._suggestionEpoch;
    this._suggestions = [];
    this._suggestionIndex = -1;
    if (this._suggestionList) this.renderSuggestions();
  }

  queueSuggestions() {
    this.dismissSuggestions();
    const query = this._draft.trim();
    if (!query || this._adding) return;
    const epoch = this._suggestionEpoch;
    const entityId = this._selected;
    const connection = this._connection;
    this._suggestionTimer = setTimeout(async () => {
      try {
        const result = await connection.sendMessagePromise({ type: "ha_lists/suggestions", entity_id: entityId, query });
        if (!this.isConnected || epoch !== this._suggestionEpoch || entityId !== this._selected || connection !== this._connection) return;
        this._suggestions = result.suggestions || [];
        this.renderSuggestions();
      } catch {
        // Suggestions are optional; failures never prevent normal task entry.
      }
    }, 150);
  }

  chooseSuggestion(index) {
    const title = this._suggestions[index];
    if (!title || this._adding || this._loading) return;
    this._draft = this._input.value = title;
    this.addItem();
  }

  renderSuggestions() {
    this._suggestionList.hidden = !this._suggestions.length;
    const options = this._suggestions.map((title, index) => {
      const option = document.createElement("div");
      option.id = `task-suggestion-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === this._suggestionIndex));
      option.textContent = title;
      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("click", () => this.chooseSuggestion(index));
      return option;
    });
    this._suggestionList.replaceChildren(...options);
    const input = this._nativeInput || this._input;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", String(Boolean(options.length)));
    input.setAttribute("aria-controls", "task-suggestions");
    // Element references keep the relationship across ha-input's shadow root.
    input.ariaControlsElements = [this._suggestionList];
    if ("ariaActiveDescendantElement" in input) input.ariaActiveDescendantElement = options[this._suggestionIndex] || null;
    else if (this._suggestionIndex >= 0) input.setAttribute("aria-activedescendant", options[this._suggestionIndex].id);
    else input.removeAttribute("aria-activedescendant");
    this._suggestionAnnouncement.textContent = options.length
      ? (this._suggestionIndex < 0 ? `${options.length} suggestions. Use arrow keys to choose, Enter to add.` : this._suggestions[this._suggestionIndex]) : "";
  }

  async loadSuggestionHistory() {
    if (!this._historyPanel || !this._viewOpen || !this._management || !this._selected) return;
    const epoch = ++this._historyEpoch;
    const entityId = this._selected;
    const connection = this._connection;
    if (this._historyEntity !== entityId) {
      this._historyPanel.hidden = true;
      this._historyEntity = entityId;
      this._historyConfirm.hidden = true;
      this._historyError.textContent = "";
    }
    try {
      const result = await connection.sendMessagePromise({ type: "ha_lists/suggestions", entity_id: entityId,
        query: this._historySearch.value, history: true });
      if (!this.isConnected || !this._management || epoch !== this._historyEpoch || entityId !== this._selected || connection !== this._connection) return;
      this._historyPanel.hidden = false;
      this._learningInput.checked = result.learning;
      this._excludeActiveInput.checked = result.exclude_active;
      this._historyCount.textContent = `${result.count} learned suggestions. Shared on this Home Assistant server.` +
        (result.capacity_reached ? " Learning capacity reached; existing suggestions remain available." : "");
      this._historyResults.replaceChildren(...result.suggestions.map((title) => {
        const row = document.createElement("div");
        const label = document.createElement("span");
        label.textContent = title;
        const forget = document.createElement("button");
        forget.type = "button";
        forget.textContent = "Forget";
        forget.setAttribute("aria-label", `Forget suggestion ${title}`);
        forget.disabled = this._historyBusy;
        forget.addEventListener("click", () => this.manageSuggestions("forget", title));
        row.append(label, forget);
        return row;
      }));
    } catch {
      if (epoch === this._historyEpoch && !this._historyPanel.hidden) {
        this._historyError.textContent = "Could not refresh suggestion history. Reopen View options to try again.";
      }
    }
  }

  async manageSuggestions(action, value) {
    if (this._historyBusy) return;
    const entityId = this._selected;
    const connection = this._connection;
    this._historyBusy = true;
    this._historyError.textContent = "";
    this._historyPanel.querySelectorAll("button,input").forEach((node) => { node.disabled = true; });
    try {
      await connection.sendMessagePromise({ type: "ha_lists/suggestions/manage", entity_id: entityId, action,
        ...(value !== undefined ? { value } : {}) });
      if (entityId !== this._selected || connection !== this._connection || !this.isConnected) return;
      this._historyConfirm.hidden = true;
      this.dismissSuggestions();
    } catch (error) {
      if (entityId === this._selected && connection === this._connection) this._historyError.textContent = error?.message || String(error);
    } finally {
      this._historyBusy = false;
      this._historyPanel.querySelectorAll("button,input").forEach((node) => { node.disabled = false; });
      await this.loadSuggestionHistory();
    }
  }

  async setItemCompleted(item, completed) {
    const entityId = this._selected;
    const itemId = item.uid || item.summary;
    const key = entityId + ":" + itemId;
    if (!entityId || !itemId || this._updatingItems.has(key)) return;
    this._updatingItems.add(key);
    this._error = "";
    // Optimistic update, rolled back on service failure.
    const previousStatus = item.status;
    item.status = completed ? "completed" : "needs_action";
    this.render();
    try {
      await this._hass.callService("todo", "update_item", {
        entity_id: entityId,
        item: itemId,
        status: item.status
      });
      if (this._selected === entityId) await this.loadItems();
    } catch (error) {
      item.status = previousStatus;
      if (this._selected === entityId) {
        this._error = "Unable to update task: " + (error?.message || String(error));
      }
    } finally {
      this._updatingItems.delete(key);
      this.render();
    }
  }

  supportsTaskAction(entity, feature) {
    return entity && entity.state !== "unavailable" && entity.state !== "unknown"
      && (entity.attributes?.supported_features & feature) !== 0;
  }

  openTaskEditor(item) {
    this._edit = {
      uid: item.uid,
      title: item.summary || "",
      description: item.description || "",
      due: item.due || "",
      timedDue: Boolean(item.due && !/^\d{4}-\d{2}-\d{2}$/.test(item.due)),
      saving: false, confirmingDelete: false, error: "",
    };
    this._titleInput.value = this._edit.title;
    this._descriptionInput.value = this._edit.description;
    const local = this._edit.timedDue ? new Date(this._edit.due) : null;
    const pad = (value) => String(value).padStart(2, "0");
    this._dueInput.value = local
      ? `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`
      : this._edit.due;
    this._dueTimeInput.value = local
      ? `${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}` : "";
    this._edit.dateValue = this._dueInput.value;
    this._edit.timeValue = this._dueTimeInput.value;
    this.render();
    if (this._titleInput.hidden) {
      this._deleteTask.focus();
    } else {
      this._titleInput.focus();
      this._titleInput.select();
    }
  }

  closeTaskEditor(uid) {
    this._edit = null;
    this.render();
    const button = [...this._results.querySelectorAll("button[data-uid]")]
      .find((candidate) => candidate.dataset.uid === uid);
    (button || this._input).focus();
  }

  async saveTask() {
    const edit = this._edit;
    const entityId = this._selected;
    const title = this._titleInput.value.trim();
    const entity = this.availableLists.find((candidate) => candidate.entity_id === entityId);
    if (!edit || edit.saving || edit.confirmingDelete || !title || !this.supportsTaskAction(entity, UPDATE_TODO_ITEM)) return;
    const changes = {};
    if (title !== edit.title) changes.rename = title;
    if (this.supportsTaskAction(entity, SET_DESCRIPTION_ON_ITEM)
        && this._descriptionInput.value !== edit.description) {
      changes.description = this._descriptionInput.value || null;
    }
    const canSetTime = this.supportsTaskAction(entity, SET_DUE_DATETIME_ON_ITEM);
    const canSetDate = this.supportsTaskAction(entity, SET_DUE_DATE_ON_ITEM);
    const dateChanged = this._dueInput.value !== edit.dateValue;
    const timeChanged = this._dueTimeInput.value !== edit.timeValue;
    if ((canSetTime || (canSetDate && !edit.timedDue)) && (dateChanged || timeChanged)) {
      const date = this._dueInput.value;
      const time = this._dueTimeInput.value;
      if (time && !date) {
        edit.error = "Choose a due date for this time, or clear the time.";
        this.renderEditor();
        return;
      }
      if (!date) {
        changes[canSetTime ? "due_datetime" : "due_date"] = null;
      } else if (time && canSetTime) {
        const local = new Date(date + "T" + time);
        const [year, month, day] = date.split("-").map(Number);
        const [hour, minute, second = 0] = time.split(":").map(Number);
        if (Number.isNaN(local.getTime()) || local.getFullYear() !== year
            || local.getMonth() + 1 !== month || local.getDate() !== day
            || local.getHours() !== hour || local.getMinutes() !== minute
            || local.getSeconds() !== second) {
          edit.error = "This time does not exist in your time zone. Choose another time.";
          this.renderEditor();
          return;
        }
        changes.due_datetime = local.toISOString();
      } else if (canSetDate) {
        changes.due_date = date;
      } else {
        edit.error = "This list requires a time with its due date.";
        this.renderEditor();
        return;
      }
    }
    if (!Object.keys(changes).length) {
      this.closeTaskEditor(edit.uid);
      return;
    }

    edit.saving = true;
    edit.error = "";
    this.render();
    try {
      const { items } = await this._connection.sendMessagePromise({
        type: "todo/item/list", entity_id: entityId,
      });
      if (this._edit !== edit || !this.isConnected) return;
      const current = items?.find((item) => item.uid === edit.uid);
      if (!current
          || ("rename" in changes && (current.summary || "") !== edit.title)
          || ("description" in changes && (current.description || "") !== edit.description)
          || (("due_date" in changes || "due_datetime" in changes) && (current.due || "") !== edit.due)) {
        await this.loadItems();
        throw new Error("This task changed elsewhere. Cancel and reopen it to edit the latest version.");
      }
      await this._hass.callService("todo", "update_item", {
        entity_id: entityId, item: edit.uid, ...changes,
      });
      if (this._edit !== edit || !this.isConnected) return;
      await this.loadItems();
      if (this._edit === edit && this.isConnected) this.closeTaskEditor(edit.uid);
    } catch (error) {
      if (this._edit === edit) {
        edit.error = "Unable to save task: " + (error?.message || String(error));
      }
    } finally {
      if (this._edit === edit) {
        edit.saving = false;
        this.render();
      }
    }
  }

  setDeleteConfirmation(confirming) {
    const edit = this._edit;
    if (!edit || edit.saving) return;
    edit.confirmingDelete = confirming;
    edit.error = "";
    this.renderEditor();
    (confirming ? this._cancelDelete : this._deleteTask).focus();
  }

  async deleteItem() {
    const edit = this._edit;
    const entityId = this._selected;
    const connection = this._connection;
    const selected = this.availableLists.find((entity) => entity.entity_id === entityId);
    if (!edit?.confirmingDelete || edit.saving || !this.supportsTaskAction(selected, DELETE_TODO_ITEM)) return;
    const key = entityId + ":" + edit.uid;
    if (this._updatingItems.has(key)) return;

    this._updatingItems.add(key);
    edit.saving = true;
    edit.error = "";
    this.render();
    try {
      await this._hass.callService("todo", "remove_item", {
        entity_id: entityId, item: edit.uid,
      });
      if (this.isConnected && this._connection === connection && this._selected === entityId) {
        await this.loadItems();
        if (this._edit === edit && this.isConnected) this.closeTaskEditor(edit.uid);
      }
    } catch (error) {
      if (this._edit === edit) edit.error = "Unable to delete task: " + (error?.message || String(error));
    } finally {
      this._updatingItems.delete(key);
      edit.saving = false;
      this.render();
      if (this._edit === edit && edit.error) this._cancelDelete.focus();
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
        header { display:flex; align-items:center; gap:8px; min-height:var(--header-height,56px); padding:0 8px; position:sticky; top:0; z-index:1; color:var(--app-header-text-color,var(--primary-text-color)); background:var(--app-header-background-color,var(--primary-background-color)); }
        header h1 { margin:0; font-size:20px; font-weight:400; }
        .layout { display:grid; grid-template-columns:minmax(220px,290px) minmax(0,1fr); gap:18px; }
        .list-pane,article { min-width:0; padding:18px; background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:12px; }
        .list-actions { display:flex; flex-wrap:wrap; gap:var(--ha-space-2,8px); margin-top:var(--ha-space-3,12px); }
        .list-actions button, .list-form button, .pending-lists button { min-height:44px; font:inherit; padding:var(--ha-space-2,8px); color:var(--primary-text-color); background:var(--secondary-background-color); border:1px solid var(--divider-color); border-radius:var(--ha-border-radius-md,6px); }
        .list-actions .delete-action, .list-form .delete-action { color:var(--error-color); }
        .list-form { flex-wrap:wrap; }
        .list-form label { display:grid; gap:var(--ha-space-1,4px); flex-basis:100%; min-width:0; }
        .list-form input, .list-form select { box-sizing:border-box; width:100%; min-width:0; min-height:44px; padding:var(--ha-space-2,8px); font:inherit; color:var(--primary-text-color); background:var(--card-background-color); border:1px solid var(--divider-color); }
        .list-form p { flex-basis:100%; overflow-wrap:anywhere; }
        .list-pane > p, .pending-lists p { overflow-wrap:anywhere; }
        nav button { display:block; width:100%; border:0; border-radius:8px; background:transparent; color:inherit; text-align:left; font:inherit; padding:12px; cursor:pointer; overflow-wrap:anywhere; }
        nav button[aria-current=true] { background:var(--secondary-background-color); font-weight:600; }
        button:focus-visible, select:focus-visible, input:focus-visible { outline:2px solid var(--primary-color); }
        .search { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin:12px 0; }
        .search label { display:grid; gap:4px; flex:1; min-width:0; }
        .search input { box-sizing:border-box; width:100%; min-width:0; min-height:44px; padding:8px; font:inherit; color:var(--primary-text-color); background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:6px; }
        .search button { min-height:44px; padding:8px; font:inherit; color:inherit; background:var(--secondary-background-color); border:1px solid var(--divider-color); border-radius:6px; }
        .task-tools { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:12px 0; }
        .task-tools button { min-height:44px; padding:8px 12px; font:inherit; color:inherit; background:var(--secondary-background-color); border:1px solid var(--divider-color); border-radius:6px; cursor:pointer; }
        .task-tools svg { width:22px; height:22px; display:block; fill:currentColor; }
        .view-options { padding:12px; border:1px solid var(--divider-color); border-radius:6px; margin:12px 0; }
        .suggestions { margin:-8px 0 12px; border:1px solid var(--divider-color); border-radius:6px; background:var(--card-background-color); }
        .suggestions [role=option] { min-height:44px; display:flex; align-items:center; padding:0 12px; overflow-wrap:anywhere; cursor:pointer; }
        .suggestions [aria-selected=true] { background:var(--secondary-background-color); outline:2px solid var(--primary-color); outline-offset:-2px; }
        .suggestion-history { border-top:1px solid var(--divider-color); margin-top:12px; padding-top:12px; }
        .suggestion-history label { display:flex; align-items:center; gap:8px; min-height:44px; margin:8px 0; }
        .suggestion-history input[type=checkbox] { width:22px; height:22px; flex:none; }
        .suggestion-history .history-search { display:grid; }
        .suggestion-history > button { margin:4px 8px 4px 0; }
        .suggestion-history button, .suggestion-history input[type=search] { min-height:44px; padding:8px; font:inherit; color:inherit; background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:6px; max-width:100%; box-sizing:border-box; }
        .history-results > div { display:flex; align-items:center; gap:8px; justify-content:space-between; margin:4px 0; }
        .history-results span { min-width:0; overflow-wrap:anywhere; }
        .sr-only { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
        .filters { display:flex; align-items:center; flex-wrap:wrap; gap:var(--ha-space-2,8px) var(--ha-space-4,16px); margin:var(--ha-space-3,12px) 0; }
        .filters label { display:flex; align-items:center; gap:var(--ha-space-2,8px); }
        .filters select { max-width:100%; min-height:44px; padding:var(--ha-space-2,8px); font:inherit; color:var(--primary-text-color); background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:var(--ha-border-radius-md,6px); }
        .filter-help { margin:4px 0; overflow-wrap:anywhere; }
        .muted { color:var(--secondary-text-color); }
        .error { color:var(--error-color); }
        form { display:flex; gap:8px; margin:12px 0; }
        ha-input, .title-input { flex:1; min-width:0; }
        form[hidden], [hidden] { display:none; }
        .edit-form { align-items:center; flex-wrap:wrap; }
        .task-title { border:0; background:transparent; color:inherit; font:inherit; padding:6px 0; text-align:left; cursor:pointer; overflow-wrap:anywhere; }
        .title-input, .edit-field input, .edit-field textarea { font:inherit; padding:8px; }
        .edit-field { display:grid; gap:4px; flex-basis:100%; }
        .edit-field textarea { resize:vertical; min-height:4em; }
        .timed-deadline { flex-basis:100%; }
        .delete-confirmation { flex-basis:100%; }
        .delete-action { color:var(--error-color); }
        form button { padding:10px 14px; font:inherit; cursor:pointer; }
        li { padding:10px 0; border-bottom:1px solid var(--divider-color); display:flex; align-items:center; gap:12px; }
        li input[type=checkbox] { width:22px; height:22px; flex:none; accent-color:var(--primary-color); }
        li .completed { text-decoration:line-through; color:var(--secondary-text-color); }
        ul { list-style:none; padding:0; }
        @media(max-width:650px) { main { padding:12px; } .layout { grid-template-columns:1fr; } }
        :host([narrow]) main { padding:12px; }
        :host([narrow]) .layout { grid-template-columns:1fr; }
      `;
      const header = document.createElement("header");
      // HA owns sidebar visibility, localization, keyboard interaction and the
      // hass-toggle-menu event through its native context-aware menu component.
      const menu = document.createElement("ha-menu-button");
      this._main = document.createElement("main");
      const h1 = document.createElement("h1");
      h1.textContent = "Lists";
      header.append(menu, h1);
      const layout = document.createElement("div");
      layout.className = "layout";
      this._nav = document.createElement("nav");
      this._nav.setAttribute("aria-label", "Configured to-do lists");
      const listPane = document.createElement("section");
      listPane.className = "list-pane";
      const actionButton = (text, handler) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.addEventListener("click", handler);
        return button;
      };
      this._listActions = document.createElement("div");
      this._listActions.className = "list-actions";
      this._newListButton = actionButton("New list", () => {
        this._newListOpen = !this._newListOpen;
        this._listError = "";
        this.render();
        if (this._newListOpen) this._newListName.focus();
      });
      this._connectListButton = actionButton("Connect existing list", () => {
        this._connectListOpen = !this._connectListOpen;
        this._listError = "";
        this.render();
        if (this._connectListOpen) {
          this.loadConfiguration();
          this._existingListSelect.focus();
        }
      });
      this._listActions.append(this._newListButton, this._connectListButton);
      this._newListForm = document.createElement("form");
      this._newListForm.className = "list-form";
      this._newListForm.setAttribute("aria-label", "Create a Local To-do list");
      const newListLabel = document.createElement("label");
      this._newListName = document.createElement("input");
      this._newListName.type = "text";
      this._newListName.required = true;
      this._newListName.maxLength = 255;
      this._newListName.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && event.isComposing) event.preventDefault();
      });
      newListLabel.append("List name", this._newListName);
      this._createListSubmit = document.createElement("button");
      this._createListSubmit.type = "submit";
      this._createListSubmit.textContent = "Create list";
      this._cancelNewList = actionButton("Cancel new list", () => {
        this._newListOpen = false;
        this._listError = "";
        this._newListName.value = "";
        this.render();
        this._newListButton.focus();
      });
      const localNotice = document.createElement("p");
      localNotice.className = "muted";
      localNotice.textContent = "Creates a native Home Assistant Local To-do list.";
      this._newListForm.append(newListLabel, localNotice, this._createListSubmit, this._cancelNewList);
      this._newListForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const name = this._newListName.value.trim();
        if (name) this.manageList({ type: "ha_lists/list/create", name });
      });
      this._connectListForm = document.createElement("form");
      this._connectListForm.className = "list-form";
      this._connectListForm.setAttribute("aria-label", "Connect an existing Local To-do list");
      const existingLabel = document.createElement("label");
      this._existingListSelect = document.createElement("select");
      this._existingListSelect.required = true;
      this._existingListSelect.addEventListener("change", () => this.renderListManagement());
      existingLabel.append("Existing Local To-do list", this._existingListSelect);
      this._connectListSubmit = document.createElement("button");
      this._connectListSubmit.type = "submit";
      this._connectListSubmit.textContent = "Show list";
      this._refreshLists = actionButton("Refresh available lists", () => this.loadConfiguration());
      this._connectListForm.append(existingLabel, this._connectListSubmit, this._refreshLists);
      this._connectListForm.addEventListener("submit", (event) => {
        event.preventDefault();
        if (this._existingListSelect.value) this.manageList({
          type: "ha_lists/list/visibility", entity_id: this._existingListSelect.value, visible: true,
        });
      });
      this._deleteListForm = document.createElement("form");
      this._deleteListForm.className = "list-form";
      this._deleteListForm.setAttribute("aria-label", "Delete list confirmation");
      this._deleteListText = document.createElement("p");
      this._deleteListText.id = "delete-list-warning";
      const confirmListLabel = document.createElement("label");
      this._confirmListName = document.createElement("input");
      this._confirmListName.type = "text";
      this._confirmListName.required = true;
      this._confirmListName.maxLength = 255;
      this._confirmListName.addEventListener("input", () => this.renderListManagement());
      confirmListLabel.append("Type the list name to delete", this._confirmListName);
      this._keepList = actionButton("Keep list", () => {
        this._deleteListTarget = null;
        this._listError = "";
        this.render();
        this._connectListButton.focus();
      });
      this._deleteListConfirm = document.createElement("button");
      this._deleteListConfirm.type = "submit";
      this._deleteListConfirm.className = "delete-action";
      this._deleteListConfirm.textContent = "Delete list and all tasks";
      this._deleteListConfirm.setAttribute("aria-describedby", "delete-list-warning");
      this._deleteListForm.append(this._deleteListText, confirmListLabel, this._keepList, this._deleteListConfirm);
      this._deleteListForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const target = this._deleteListTarget;
        if (target && this._confirmListName.value === target.name) this.manageList({
          type: "ha_lists/list/delete", entry_id: target.entry_id, confirm_name: this._confirmListName.value,
        });
      });
      this._pendingLists = document.createElement("div");
      this._pendingLists.className = "pending-lists";
      this._listErrorElement = document.createElement("p");
      this._listErrorElement.className = "error";
      this._listErrorElement.setAttribute("role", "alert");
      this._listNoticeElement = document.createElement("p");
      this._listNoticeElement.className = "muted";
      this._listNoticeElement.setAttribute("aria-live", "polite");
      listPane.append(this._nav, this._listActions, this._newListForm, this._connectListForm,
        this._deleteListForm, this._pendingLists, this._listErrorElement, this._listNoticeElement);
      const article = document.createElement("article");
      this._heading = document.createElement("h2");
      this._selectedListActions = document.createElement("div");
      this._selectedListActions.className = "list-actions";
      this._hideListButton = actionButton("Remove list from panel", () => {
        if (this._edit) {
          this._listError = "Save or cancel the task editor before removing this list from the panel.";
          this.render();
          return;
        }
        this.manageList({ type: "ha_lists/list/visibility", entity_id: this._selected, visible: false });
      });
      this._deleteListButton = actionButton("Delete list…", () => {
        const target = this._management?.deletable?.[this._selected];
        if (target) this.confirmListDeletion(target);
      });
      this._deleteListButton.className = "delete-action";
      this._selectedListActions.append(this._hideListButton, this._deleteListButton);
      this._taskTools = document.createElement("div");
      this._taskTools.className = "task-tools";
      this._searchToggle = actionButton("", () => {
        this._searchOpen = !this._searchOpen || Boolean(this._search.trim());
        this.render();
        if (this._searchOpen) this._searchInput.focus();
      });
      this._searchToggle.setAttribute("aria-label", "Search tasks");
      this._searchToggle.title = "Search tasks";
      this._searchToggle.setAttribute("aria-controls", "task-search");
      const searchIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      searchIcon.setAttribute("viewBox", "0 0 24 24");
      searchIcon.setAttribute("aria-hidden", "true");
      const searchPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      searchPath.setAttribute("d", "M9.5 3a6.5 6.5 0 1 0 3.97 11.65L19.82 21 21 19.82l-6.35-6.35A6.5 6.5 0 0 0 9.5 3m0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9");
      searchIcon.append(searchPath);
      this._searchToggle.append(searchIcon);
      this._viewToggle = actionButton("View options", () => {
        this._viewOpen = !this._viewOpen;
        this.render();
        if (this._viewOpen) this.loadSuggestionHistory();
      });
      this._viewToggle.setAttribute("aria-controls", "task-view-options");
      this._viewOptions = document.createElement("section");
      this._viewOptions.id = "task-view-options";
      this._viewOptions.className = "view-options";
      this._viewOptions.setAttribute("aria-label", "Task view options");
      this._viewOptions.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          this._viewOpen = false;
          this.render();
          this._viewToggle.focus();
        }
      });
      this._searchControls = document.createElement("div");
      this._searchControls.id = "task-search";
      this._searchControls.className = "search";
      this._searchControls.addEventListener("focusout", () => {
        queueMicrotask(() => {
          if (!this._searchPointerActive) this.collapseEmptySearch();
        });
      });
      const searchLabel = document.createElement("label");
      this._searchInput = document.createElement("input");
      this._searchInput.type = "search";
      this._searchInput.maxLength = 255;
      this._searchInput.placeholder = "Titles and descriptions";
      this._searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !event.isComposing && !this._search.trim()) {
          event.preventDefault();
          this._searchOpen = false;
          this.render();
          this._searchToggle.focus();
        }
      });
      this._searchInput.addEventListener("input", () => {
        this._search = this._searchInput.value;
        this.render();
      });
      searchLabel.append("Search tasks", this._searchInput);
      this._clearSearch = document.createElement("button");
      this._clearSearch.type = "button";
      this._clearSearch.textContent = "Clear search";
      this._clearSearch.addEventListener("click", () => {
        this._search = this._searchInput.value = "";
        this.render();
        this._searchInput.focus();
      });
      this._searchControls.append(searchLabel, this._clearSearch);
      this._filters = document.createElement("div");
      this._filters.className = "filters";
      const filterLabel = document.createElement("label");
      filterLabel.append("Show tasks");
      this._filterSelect = document.createElement("select");
      for (const [value, title] of [["all", "All"], ["active", "Active"],
        ["completed", "Completed"], ["today", "Due today"], ["overdue", "Overdue"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = title;
        this._filterSelect.append(option);
      }
      this._filterSelect.addEventListener("change", () => {
        this._filter = this._filterSelect.value;
        this.render();
      });
      filterLabel.append(this._filterSelect);
      const sortLabel = document.createElement("label");
      sortLabel.append("Sort active tasks");
      this._sortSelect = document.createElement("select");
      this._sortSelect.setAttribute("aria-describedby", "task-sort-help");
      for (const [value, title] of [["newest", "Newest first"], ["oldest", "Oldest first"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = title;
        this._sortSelect.append(option);
      }
      this._sortSelect.addEventListener("change", () => {
        this._sort = this._sortSelect.value;
        this.render();
      });
      sortLabel.append(this._sortSelect);
      this._filterCount = document.createElement("span");
      this._filterCount.setAttribute("role", "status");
      this._filterCount.setAttribute("aria-live", "polite");
      this._filters.append(filterLabel, sortLabel);
      this._viewSummary = document.createElement("span");
      this._viewSummary.className = "muted";
      this._taskTools.append(this._searchToggle, this._viewToggle, this._viewSummary, this._filterCount);
      this._sortHelp = document.createElement("p");
      this._sortHelp.id = "task-sort-help";
      this._sortHelp.className = "filter-help muted";
      this._sortHelp.textContent = "Newest/oldest use source-list order. Completed tasks keep their source order.";
      this._filterHelp = document.createElement("p");
      this._filterHelp.className = "filter-help muted";
      this._viewOptions.append(this._filters, this._sortHelp, this._filterHelp);
      this._historyPanel = document.createElement("section");
      this._historyPanel.className = "suggestion-history";
      this._historyPanel.hidden = true;
      const historyTitle = document.createElement("h3");
      historyTitle.textContent = "Suggestion history";
      this._historyCount = document.createElement("p");
      const learningLabel = document.createElement("label");
      this._learningInput = document.createElement("input");
      this._learningInput.type = "checkbox";
      this._learningInput.addEventListener("change", () => this.manageSuggestions("learning", this._learningInput.checked));
      learningLabel.append(this._learningInput, " Learn new suggestions for this list");
      const excludeLabel = document.createElement("label");
      this._excludeActiveInput = document.createElement("input");
      this._excludeActiveInput.type = "checkbox";
      this._excludeActiveInput.addEventListener("change", () => this.manageSuggestions("exclude_active", this._excludeActiveInput.checked));
      excludeLabel.append(this._excludeActiveInput, " Exclude items already active in this list");
      const historySearchLabel = document.createElement("label");
      historySearchLabel.className = "history-search";
      this._historySearch = document.createElement("input");
      this._historySearch.type = "search";
      this._historySearch.maxLength = 255;
      this._historySearch.addEventListener("input", () => this.loadSuggestionHistory());
      historySearchLabel.append("Find a learned suggestion", this._historySearch);
      this._historyResults = document.createElement("div");
      this._historyResults.className = "history-results";
      this._historyConfirm = document.createElement("div");
      this._historyConfirm.hidden = true;
      const confirmText = document.createElement("p");
      const confirmHistory = actionButton("Confirm history change", () => this.manageSuggestions(this._historyAction));
      this._historyConfirm.append(confirmText, confirmHistory, actionButton("Keep history", () => { this._historyConfirm.hidden = true; }));
      const askHistory = (action) => {
        this._historyAction = action;
        confirmText.textContent = action === "clear" ? "Clear learned suggestions for this list? Native tasks will stay unchanged." : "Replace learned suggestions with currently available completed items? Native tasks will stay unchanged.";
        this._historyConfirm.hidden = false;
      };
      this._historyError = document.createElement("p");
      this._historyError.className = "error";
      this._historyError.setAttribute("role", "alert");
      this._historyPanel.append(historyTitle, this._historyCount, learningLabel, excludeLabel, historySearchLabel, this._historyResults,
        actionButton("Clear learned history", () => askHistory("clear")),
        actionButton("Rebuild from completed items", () => askHistory("rebuild")), this._historyConfirm, this._historyError);
      this._viewOptions.append(this._historyPanel);
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
        if (event.isComposing || event.defaultPrevented) return;
        if (["ArrowDown", "ArrowUp"].includes(event.key) && this._suggestions.length) {
          event.preventDefault();
          event.stopPropagation();
          this._suggestionIndex = this._suggestionIndex < 0
            ? (event.key === "ArrowDown" ? 0 : this._suggestions.length - 1)
            : (this._suggestionIndex + (event.key === "ArrowDown" ? 1 : -1) + this._suggestions.length) % this._suggestions.length;
          this.renderSuggestions();
          return;
        }
        if (event.key === "Escape") {
          if (this._suggestions.length) { event.preventDefault(); event.stopPropagation(); }
          this.dismissSuggestions();
          return;
        }
        if (event.key !== "Enter" || event.isComposing || event.repeat || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        if (this._suggestionIndex >= 0) this.chooseSuggestion(this._suggestionIndex);
        else { this._draft = this._input.value; this.addItem(); }
      };
      this._input.addEventListener("keydown", submitOnEnter);
      // Some HA input implementations stop keyboard events inside their shadow root.
      // Bind to the native input as well, without double-handling a single event.
      const bindNativeEnter = (event) => {
        const nativeInput = event?.composedPath?.().find((node) => node instanceof HTMLInputElement) ||
          this._input.querySelector("input") || this._input.shadowRoot?.querySelector("input");
        if (nativeInput && nativeInput !== this._nativeInput) {
          this._nativeInput = nativeInput;
          nativeInput.addEventListener("keydown", submitOnEnter);
          for (const attribute of ["role", "aria-autocomplete", "aria-expanded", "aria-controls", "aria-activedescendant"]) this._input.removeAttribute(attribute);
          this.renderSuggestions();
        }
      };
      this._input.addEventListener("focusin", bindNativeEnter);
      this._input.updateComplete?.then(bindNativeEnter);
      customElements.whenDefined("ha-input").then(() => {
        this._input.updateComplete?.then(bindNativeEnter);
      });
      this._input.addEventListener("input", (event) => {
        this._draft = this._input.value;
        if (!event.isComposing) this.queueSuggestions();
      });
      this._input.addEventListener("compositionend", () => { this._draft = this._input.value; this.queueSuggestions(); });
      this._input.addEventListener("focusout", () => this.dismissSuggestions());
      this._input.addEventListener("focusin", () => { if (this._draft.trim()) this.queueSuggestions(); });
      this._submit = document.createElement("button");
      this._submit.type = "submit";
      this._form.addEventListener("submit", (event) => {
        event.preventDefault();
        this._draft = this._input.value;
        this.addItem();
      });
      this._form.append(this._input, this._submit);
      this._suggestionList = document.createElement("div");
      this._suggestionList.id = "task-suggestions";
      this._suggestionList.className = "suggestions";
      this._suggestionList.setAttribute("role", "listbox");
      this._suggestionList.setAttribute("aria-label", "Task suggestions");
      this._suggestionList.hidden = true;
      this._suggestionAnnouncement = document.createElement("span");
      this._suggestionAnnouncement.className = "sr-only";
      this._suggestionAnnouncement.setAttribute("aria-live", "polite");
      this._results = document.createElement("div");
      this._editForm = document.createElement("form");
      this._editForm.className = "edit-form";
      this._titleLabel = document.createElement("label");
      this._titleLabel.htmlFor = "task-title";
      this._titleLabel.textContent = "Task title";
      this._titleInput = document.createElement("input");
      this._titleInput.id = "task-title";
      this._titleInput.className = "title-input";
      this._titleInput.required = true;
      this._titleInput.maxLength = 255;
      this._titleInput.addEventListener("input", () => this.renderEditor());
      this._descriptionField = document.createElement("label");
      this._descriptionField.className = "edit-field";
      this._descriptionInput = document.createElement("textarea");
      this._descriptionField.append("Description", this._descriptionInput);
      this._dueField = document.createElement("label");
      this._dueField.className = "edit-field";
      this._dueInput = document.createElement("input");
      this._dueInput.type = "date";
      this._dueField.append("Due date", this._dueInput);
      this._dueTimeField = document.createElement("label");
      this._dueTimeField.className = "edit-field";
      this._dueTimeInput = document.createElement("input");
      this._dueTimeInput.type = "time";
      this._dueTimeInput.step = "1";
      this._dueTimeField.append("Due time", this._dueTimeInput);
      this._clearDeadline = document.createElement("button");
      this._clearDeadline.type = "button";
      this._clearDeadline.textContent = "Clear deadline";
      this._clearDeadline.addEventListener("click", () => {
        this._dueInput.value = "";
        this._dueTimeInput.value = "";
      });
      this._timedDeadline = document.createElement("p");
      this._timedDeadline.className = "timed-deadline";
      this._saveTitle = document.createElement("button");
      this._saveTitle.type = "submit";
      this._saveTitle.textContent = "Save";
      this._cancelTitle = document.createElement("button");
      this._cancelTitle.type = "button";
      this._cancelTitle.textContent = "Cancel";
      this._cancelTitle.addEventListener("click", () => this.closeTaskEditor(this._edit.uid));
      this._deleteTask = document.createElement("button");
      this._deleteTask.type = "button";
      this._deleteTask.className = "delete-action";
      this._deleteTask.textContent = "Delete";
      this._deleteTask.addEventListener("click", () => this.setDeleteConfirmation(true));
      this._deletePrompt = document.createElement("p");
      this._deletePrompt.className = "delete-confirmation";
      this._cancelDelete = document.createElement("button");
      this._cancelDelete.type = "button";
      this._cancelDelete.textContent = "Keep task";
      this._cancelDelete.addEventListener("click", () => this.setDeleteConfirmation(false));
      this._confirmDelete = document.createElement("button");
      this._confirmDelete.type = "button";
      this._confirmDelete.className = "delete-action";
      this._confirmDelete.textContent = "Delete task";
      this._confirmDelete.addEventListener("click", () => this.deleteItem());
      this._editForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.saveTask();
      });
      this._editForm.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this._edit && !this._edit.saving) {
          event.preventDefault();
          if (this._edit.confirmingDelete) this.setDeleteConfirmation(false);
          else this.closeTaskEditor(this._edit.uid);
        }
      });
      this._editForm.append(
        this._titleLabel, this._titleInput, this._descriptionField, this._dueField, this._dueTimeField, this._clearDeadline,
        this._timedDeadline, this._saveTitle, this._cancelTitle, this._deleteTask,
        this._deletePrompt, this._cancelDelete, this._confirmDelete,
      );
      this._editError = document.createElement("p");
      this._editError.className = "error";
      this._editError.setAttribute("role", "alert");
      article.append(this._heading, this._selectedListActions, this._taskTools, this._searchControls, this._viewOptions, this._form, this._suggestionList, this._suggestionAnnouncement, this._editForm, this._editError, this._results);
      layout.append(listPane, article);
      this._main.append(layout);
      this.shadowRoot.replaceChildren(style, header, this._main);
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
      button.addEventListener("click", () => {
        if (this._selected !== entity.entity_id) this._edit = null;
        this._selected = entity.entity_id;
        this.loadItems();
      });
      navChildren.push(button);
    }
    if (this._configured?.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "No lists selected. Open Settings → Devices & services → HA Lists → Configure to choose lists.";
      navChildren.push(p);
    }
    this._nav.replaceChildren(...navChildren);
    this.renderListManagement();
    this._heading.textContent = selected?.attributes?.friendly_name || "Select a list";
    this._clearSearch.disabled = !this._search;
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
    this.renderEditor();
    if (!this._management) this._historyPanel.hidden = true;
    const visibleItems = this.filteredItems();
    this._taskTools.hidden = !selected;
    this.renderSearchControls();
    this._viewOptions.hidden = !selected || !this._viewOpen;
    this._viewToggle.setAttribute("aria-expanded", String(!this._viewOptions.hidden));
    this._filterSelect.value = this._filter;
    this._viewSummary.textContent = [
      this._filter !== "all" ? this._filterSelect.selectedOptions[0]?.textContent : "",
      this._sort !== "newest" ? "Oldest first" : "",
    ].filter(Boolean).join(" · ");
    this._filters.hidden = !selected;
    this._sortSelect.value = this._sort;
    this._sortHelp.hidden = !selected;
    this._filterCount.textContent = this._loading ? "Loading tasks…" : `${visibleItems.length} of ${this._items.length} tasks`;
    this._filterHelp.hidden = !selected || !["today", "overdue"].includes(this._filter);
    this._filterHelp.textContent = (this._filter === "today"
      ? "Unfinished tasks due today. " : "Unfinished tasks past their deadline. ") +
      "Time zone: " + Intl.DateTimeFormat().resolvedOptions().timeZone;
    const results = [];
    if (this._loading) {
      const p = document.createElement("p");
      p.textContent = "Loading tasks…";
      results.push(p);
    }
    if (this._error) {
      const p = document.createElement("p");
      p.className = "error";
      p.setAttribute("role", "alert");
      p.textContent = this._error;
      results.push(p);
    }
    if (!this._loading && selected) {
      if (!visibleItems.length) {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = this._items.length
          ? (this._search.trim() ? "No tasks match your search and filter." : "No tasks match this filter.")
          : "No tasks found.";
        results.push(p);
      } else {
        const list = document.createElement("ul");
        // Native tasks have no creation timestamp; Local To-do appends new items.
        const active = [];
        const completed = [];
        for (const item of visibleItems) {
          (item.status === "completed" ? completed : active).push(item);
        }
        const sorted = [...(this._sort === "oldest" ? active : active.reverse()), ...completed];
        for (const item of sorted) {
          const li = document.createElement("li");
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = item.status === "completed";
          const itemId = item.uid || item.summary;
          checkbox.disabled = !itemId || this._updatingItems.has(this._selected + ":" + itemId);
          checkbox.setAttribute("aria-label", (checkbox.checked ? "Reopen " : "Complete ") + (item.summary || "Untitled task"));
          checkbox.addEventListener("change", () => this.setItemCompleted(item, checkbox.checked));
          const canRename = this.supportsTaskAction(selected, UPDATE_TODO_ITEM);
          const editable = item.uid && (canRename || this.supportsTaskAction(selected, DELETE_TODO_ITEM));
          const label = document.createElement(editable ? "button" : "span");
          if (editable) {
            label.type = "button";
            label.className = "task-title";
            label.dataset.uid = item.uid;
            label.setAttribute("aria-label", (canRename ? "Rename " : "Open task ") + (item.summary || "Untitled task"));
            label.disabled = Boolean(this._edit) || this._updatingItems.has(this._selected + ":" + item.uid);
            label.addEventListener("click", () => this.openTaskEditor(item));
          }
          label.textContent = item.summary || "Untitled task";
          if (checkbox.checked) label.classList.add("completed");
          li.append(checkbox, label);
          list.append(li);
        }
        results.push(list);
      }
    }
    this._results.replaceChildren(...results);
    this.scheduleFilterRefresh();
  }

  renderEditor() {
    const edit = this._edit;
    const selected = this.availableLists.find((entity) => entity.entity_id === this._selected);
    const confirming = Boolean(edit?.confirmingDelete);
    const canRename = this.supportsTaskAction(selected, UPDATE_TODO_ITEM);
    const canDelete = this.supportsTaskAction(selected, DELETE_TODO_ITEM);
    this._editForm.hidden = !edit;
    this._titleLabel.hidden = this._titleInput.hidden = this._saveTitle.hidden = confirming || !canRename;
    const showDetails = Boolean(edit && canRename && !confirming);
    this._descriptionField.hidden = !showDetails || !this.supportsTaskAction(selected, SET_DESCRIPTION_ON_ITEM);
    const canSetTime = this.supportsTaskAction(selected, SET_DUE_DATETIME_ON_ITEM);
    const canSetDate = this.supportsTaskAction(selected, SET_DUE_DATE_ON_ITEM);
    this._dueField.hidden = !showDetails || (!canSetTime && (!canSetDate || edit?.timedDue));
    this._dueTimeField.hidden = !showDetails || !canSetTime;
    this._clearDeadline.hidden = this._dueField.hidden;
    this._clearDeadline.disabled = Boolean(edit?.saving);
    this._timedDeadline.hidden = !showDetails || (!canSetTime && !edit?.timedDue);
    this._timedDeadline.textContent = canSetTime
      ? "Time zone: " + Intl.DateTimeFormat().resolvedOptions().timeZone
      : "Due date and time: " + new Date(edit?.due).toLocaleString();
    this._descriptionInput.readOnly = this._dueInput.readOnly = this._dueTimeInput.readOnly = Boolean(edit?.saving);
    this._cancelTitle.hidden = confirming;
    this._deleteTask.hidden = confirming || !canDelete;
    this._deleteTask.disabled = Boolean(edit?.saving);
    this._deletePrompt.hidden = this._cancelDelete.hidden = this._confirmDelete.hidden = !confirming;
    this._deletePrompt.textContent = confirming ? `Delete “${edit.title || "Untitled task"}”?` : "";
    this._cancelDelete.disabled = Boolean(edit?.saving);
    this._confirmDelete.disabled = Boolean(edit?.saving) || !canDelete;
    this._titleInput.readOnly = Boolean(edit?.saving);
    this._saveTitle.disabled = !edit || edit.saving || !this._titleInput.value.trim() || !this.supportsTaskAction(selected, UPDATE_TODO_ITEM);
    this._cancelTitle.disabled = Boolean(edit?.saving);
    this._editError.hidden = !edit?.error;
    this._editError.textContent = edit?.error || "";
  }

  renderListManagement() {
    const management = this._management;
    const busy = Boolean(this._listOperation);
    this._listActions.hidden = !management;
    this._newListButton.disabled = this._connectListButton.disabled = busy;
    this._newListForm.hidden = !management || !this._newListOpen;
    this._newListName.readOnly = busy;
    this._createListSubmit.disabled = this._cancelNewList.disabled = busy;
    this._connectListForm.hidden = !management || !this._connectListOpen;
    const available = (management?.available || []).filter((item) => !this._configured?.includes(item.entity_id));
    const optionKey = JSON.stringify(available);
    if (optionKey !== this._existingOptionKey) {
      this._existingOptionKey = optionKey;
      const selected = this._existingListSelect.value;
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose an existing list";
      const options = [placeholder];
      for (const item of available) {
        const option = document.createElement("option");
        option.value = item.entity_id;
        option.textContent = `${item.name} (${item.entity_id})`;
        options.push(option);
      }
      this._existingListSelect.replaceChildren(...options);
      this._existingListSelect.value = available.some((item) => item.entity_id === selected) ? selected : "";
    }
    this._existingListSelect.disabled = this._refreshLists.disabled = busy;
    this._connectListSubmit.disabled = busy || !this._existingListSelect.value;
    this._selectedListActions.hidden = !management || !this._selected;
    this._hideListButton.disabled = this._deleteListButton.disabled = busy;
    this._deleteListButton.hidden = !management?.deletable?.[this._selected];
    this._deleteListForm.hidden = !management || !this._deleteListTarget;
    this._deleteListText.textContent = this._deleteListTarget
      ? `Delete “${this._deleteListTarget.name}” and ALL its tasks from Home Assistant? Other dashboards and automations using the list will lose access. This cannot be undone here.` : "";
    this._confirmListName.readOnly = busy;
    this._keepList.disabled = busy;
    this._deleteListConfirm.disabled = busy || !this._deleteListTarget || this._confirmListName.value !== this._deleteListTarget.name;
    this._pendingLists.hidden = !management?.pending?.length;
    const pending = [];
    for (const item of management?.pending || []) {
      const p = document.createElement("p");
      p.textContent = `Created list awaiting setup: ${item.name}. Check Settings → Devices & services. `;
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = busy;
      button.textContent = "Delete this unavailable list…";
      button.addEventListener("click", () => this.confirmListDeletion(item));
      p.append(button);
      pending.push(p);
    }
    this._pendingLists.replaceChildren(...pending);
    this._listErrorElement.hidden = !this._listError;
    this._listErrorElement.textContent = this._listError;
    this._listNoticeElement.hidden = !this._listNotice;
    this._listNoticeElement.textContent = this._listNotice;
  }
}
if (!customElements.get("ha-lists-panel")) {
  customElements.define("ha-lists-panel", HaListsPanel);
}
