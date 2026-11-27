import { afterEach, describe, expect, it } from "vitest";

import { resolveOpener } from "./use-return-focus";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("resolveOpener", () => {
  it("returns the focused control itself", () => {
    document.body.innerHTML = `<button id="help">Help</button>`;
    const button = document.getElementById("help");
    expect(resolveOpener(button)).toBe(button);
  });

  it("maps a menu item to the trigger that labels its menu", () => {
    document.body.innerHTML = `
      <button id="more-trigger">More</button>
      <div role="menu" aria-labelledby="more-trigger"><div role="menuitem" id="export">Export image…</div></div>`;
    expect(resolveOpener(document.getElementById("export"))).toBe(document.getElementById("more-trigger"));
  });

  it("returns nothing for the body or a menu without a known trigger", () => {
    document.body.innerHTML = `<div role="menu"><div role="menuitem" id="item">Item</div></div>`;
    expect(resolveOpener(document.body)).toBeNull();
    expect(resolveOpener(document.getElementById("item"))).toBeNull();
    expect(resolveOpener(null)).toBeNull();
  });
});
