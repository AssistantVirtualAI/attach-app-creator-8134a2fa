import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() }, functions: { invoke: vi.fn() }, channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })), removeChannel: vi.fn() } }));

import { MMoreSheet } from "./MMore";
import { tr } from "@/lib/i18n/tr";

describe("MMore sheet", () => {
  it("renders in document.body above the tab bar and restores scroll on close", () => {
    const onClose = vi.fn();
    const { unmount, container } = render(<div style={{ position: "relative", zIndex: 1 }}><MMoreSheet title="DND" onClose={onClose}><p>x</p></MMoreSheet></div>);
    const dialog = document.body.querySelector('[role="dialog"][aria-label="DND"]')!;
    expect(dialog).toBeTruthy();
    expect(container.contains(dialog)).toBe(false);
    const overlay = dialog.parentElement!;
    expect(overlay.parentElement).toBe(document.body);
    expect(overlay.className).toContain("z-[1000]");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("Language FR → EN", () => {
  const src = (f: string) => fs.readFileSync(path.resolve(__dirname, f), "utf8");
  it.each([
    ["MMore.tsx", "Ouvrir mon portail AVA Statistic", "Open my AVA Statistic portal"],
    ["MCalls.tsx", "Raccrocher", "Hang up"],
    ["MContacts.tsx", "Nouveau RDV", "New appointment"],
  ])("%s label follows the selected language", (file, fr, en) => {
    expect(src(file)).toContain(`tr("${fr}", "${en}")`);
    localStorage.setItem("mplanipret-lang", "fr");
    expect(tr(fr, en)).toBe(fr);
    localStorage.setItem("mplanipret-lang", "en");
    expect(tr(fr, en)).toBe(en);
  });
});
