// ==UserScript==
// @name         NotebookLM - Eliminar fuentes (3 puntos)
// @author       Koke
// @namespace    notebookllm-remover
// @version      1.0.0
// @match        https://notebooklm.google.com/notebook/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const processed = new WeakSet();

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function smartClick(el) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.click();
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
  }

  function evaluateXPath(xpathExpr, contextNode) {
    const out = [];
    const result = document.evaluate(
      xpathExpr,
      contextNode || document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );

    for (let i = 0; i < result.snapshotLength; i++) {
      const node = result.snapshotItem(i);
      if (node) out.push(node);
    }
    return out;
  }

  function getSourcePickerRoot() {
    const exact = evaluateXPath(
      "/html/body/labs-tailwind-root/div/notebook/div/section[1]/div[2]/source-picker"
    )[0];
    if (exact) return exact;

    return (
      document.querySelector("notebook section:nth-of-type(1) > div:nth-of-type(2) > source-picker") ||
      document.querySelector("source-picker")
    );
  }

  function getSourceMenuButtons() {
    const root = getSourcePickerRoot();
    if (!root) return [];

    const fromPrimaryPath = evaluateXPath("./div/div[2]/div/div/div[1]/div/div/button", root);
    const fromFallbackPath = evaluateXPath(".//div[1]/div/div/button", root);
    const merged = Array.from(new Set([...fromPrimaryPath, ...fromFallbackPath]));

    return merged.filter((btn) => {
      if (!(btn instanceof HTMLButtonElement)) return false;
      if (!isVisible(btn)) return false;

      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      const text = (btn.textContent || "").trim().toLowerCase();
      const icon = (btn.querySelector("mat-icon, i, span")?.textContent || "")
        .trim()
        .toLowerCase();

      if (/(more|menu|options|opciones|mas|acciones)/.test(aria)) return true;
      if (text === "more_vert") return true;
      if (/(more_vert|menu|options|overflow)/.test(icon)) return true;

      return fromPrimaryPath.includes(btn);
    });
  }

  function findMenuDeleteButton() {
    const candidates = Array.from(
      document.querySelectorAll(
        "button,[role='button'],[role='menuitem'],div[role='menuitem']"
      )
    );

    return candidates.find((el) => {
      if (!isVisible(el)) return false;
      const txt = (el.textContent || "").trim().toLowerCase();
      return txt.includes("eliminar") || txt.includes("delete");
    });
  }

  function findConfirmDeleteButton() {
    const dialog =
      document.querySelector("mat-dialog-container delete-source") ||
      document.querySelector("mat-dialog-container");
    if (!dialog) return null;

    const buttons = Array.from(
      dialog.querySelectorAll("button,[role='button'],[mat-button],[mat-raised-button],[mat-flat-button]")
    );

    return buttons.find((el) => {
      if (!isVisible(el)) return false;
      const txt = (el.textContent || "").trim().toLowerCase();
      if (!txt) return false;
      if (txt.includes("cancel") || txt.includes("cancelar")) return false;
      return txt.includes("eliminar") || txt.includes("delete");
    });
  }

  async function clickDeleteFromOpenMenu() {
    const timeoutMs = 2500;
    const stepMs = 60;
    const steps = Math.ceil(timeoutMs / stepMs);

    for (let i = 0; i < steps; i++) {
      const delBtn = findMenuDeleteButton();
      if (delBtn) {
        smartClick(delBtn);
        return true;
      }
      await sleep(stepMs);
    }
    return false;
  }

  async function clickConfirmDeleteDialog() {
    const timeoutMs = 3000;
    const stepMs = 70;
    const steps = Math.ceil(timeoutMs / stepMs);

    for (let i = 0; i < steps; i++) {
      const confirmBtn = findConfirmDeleteButton();
      if (confirmBtn) {
        smartClick(confirmBtn);
        return true;
      }
      await sleep(stepMs);
    }
    return false;
  }

  async function clickMenuAndDelete(menuBtn) {
    try {
      menuBtn.scrollIntoView({ block: "center", inline: "center" });
    } catch (_) {}

    smartClick(menuBtn);
    await sleep(140);

    const menuDeleteClicked = await clickDeleteFromOpenMenu();
    if (!menuDeleteClicked) return false;

    const confirmed = await clickConfirmDeleteDialog();
    return confirmed;
  }

  async function deleteAllFromMenus(ui) {
    let deleted = 0;
    let tried = 0;
    let safety = 0;

    while (safety < 300) {
      safety++;
      const sourceMenus = getSourceMenuButtons().filter((b) => !processed.has(b));
      if (!sourceMenus.length) break;

      const btn = sourceMenus[0];
      processed.add(btn);
      tried++;

      if (ui) {
        ui.status.textContent = `Procesando ${tried}...`;
      }

      const ok = await clickMenuAndDelete(btn);
      if (ok) deleted++;

      if (ui) {
        ui.status.textContent = `Procesados: ${tried} | Eliminados: ${deleted}`;
      }

      await sleep(220);
    }

    console.log(`[NotebookLM] Eliminaciones realizadas: ${deleted}`);
    return deleted;
  }

  function isTypingTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = (target.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select";
  }

  function registerHotkey() {
    const HOTKEY = { key: "f10", ctrl: true, shift: true, alt: false };
    let running = false;

    window.addEventListener(
      "keydown",
      async (ev) => {
        if (isTypingTarget(ev.target)) return;
        if (ev.repeat) return;
        if (ev.key.toLowerCase() !== HOTKEY.key) return;
        if (!!ev.ctrlKey !== HOTKEY.ctrl) return;
        if (!!ev.shiftKey !== HOTKEY.shift) return;
        if (!!ev.altKey !== HOTKEY.alt) return;

        ev.preventDefault();
        if (running) return;
        running = true;

        try {
          console.log("[NotebookLM] Atajo activo: iniciando eliminacion...");
          const total = await deleteAllFromMenus(null);
          console.log(`[NotebookLM] Eliminacion completada. Eliminados: ${total}`);
        } catch (err) {
          console.error("[NotebookLM] Error en eliminacion:", err);
        } finally {
          running = false;
        }
      },
      true
    );

    console.log("[NotebookLM] Atajo temporal: Ctrl+Shift+F10 para eliminar fuentes.");
  }

  function init() {
    registerHotkey();

    console.log("Startup Succesful");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
