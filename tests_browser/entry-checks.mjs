import assert from "node:assert/strict";

export async function verifySteadyEntry(page) {
  const viewport = page.viewportSize();
  const panel = page.locator("ha-lists-panel");
  const input = panel.locator('ha-input[label="Add a task"] input');
  const add = page.getByRole("button", { name: "Add", exact: true });
  const ime = await page.context().newCDPSession(page);
  try {
    // A reduced viewport exercises scroll clamping while entry is in view.
    // It does not simulate an Android keyboard or Companion WebView.
    await page.setViewportSize({ width: 390, height: 430 });
    for (const method of ["touch", "keyboard", "voice-action"]) {
      const title = `Steady ${method} task`;
      if (method !== "keyboard") {
        await input.fill(title);
        await input.selectText();
        await ime.send("Input.imeSetComposition", { text: title, selectionStart: title.length, selectionEnd: title.length });
      } else await page.keyboard.type(title);
      await panel.evaluate((node) => node._form.scrollIntoView({ block: "nearest" }));
      await panel.evaluate((node) => {
        const field = node._nativeInput;
        const controls = [node._input, node._submit];
        const bounds = () => controls.map((control) => {
          const { x, y, width, height } = control.getBoundingClientRect();
          return [x, y, width, height];
        });
        const trace = window.entryTrace = { baseline: bounds(), maxShift: 0, blurs: 0, running: true };
        const blur = () => trace.blurs++;
        field.addEventListener("blur", blur);
        trace.stop = () => { trace.running = false; field.removeEventListener("blur", blur); };
        const sample = () => {
          bounds().forEach((rect, index) => rect.forEach((value, axis) => {
            trace.maxShift = Math.max(trace.maxShift, Math.abs(value - trace.baseline[index][axis]));
          }));
          if (trace.running) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      if (method === "touch") await add.tap();
      else if (method === "keyboard") await input.press("Enter");
      else {
        // Emulate the DOM signals of a keyboard action while a composition
        // session is open; this does not operate a real microphone/keyboard.
        await input.dispatchEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true, bubbles: true, composed: true, cancelable: true });
        assert.equal(await page.getByRole("button", { name: `Rename ${title}`, exact: true }).count(), 0);
        // Chrome on Android synthesizes the Enter/Done editor action as keyCode 13
        // while the dictated text is still composing.
        await input.dispatchEvent("keydown", { key: "Enter", keyCode: 13, isComposing: true, bubbles: true, composed: true, cancelable: true });
      }
      await page.getByRole("button", { name: `Rename ${title}`, exact: true }).waitFor();
      await page.waitForFunction((node) => node.getAttribute("aria-busy") === "false", await panel.evaluateHandle((node) => node._form));
      const trace = await page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        window.entryTrace.stop();
        return { maxShift: window.entryTrace.maxShift, blurs: window.entryTrace.blurs };
      });
      assert.ok(trace.maxShift <= 1, `${method} submission moved entry controls by ${trace.maxShift}px`);
      assert.equal(trace.blurs, 0, `${method} submission must not blur the input`);
      assert.equal(await input.inputValue(), "");
      assert.ok(await input.evaluate((node) => node.matches(":focus")));
      assert.equal(await panel.locator("li").first().textContent(), title);
    }
    console.log("Verified steady touch/keyboard add geometry, uninterrupted focus and newest-first insertion in a short viewport");
  } finally {
    await page.evaluate(() => window.entryTrace?.stop());
    await ime.detach();
    await page.setViewportSize(viewport);
  }
}
