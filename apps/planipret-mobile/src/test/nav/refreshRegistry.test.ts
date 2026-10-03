import { describe, it, expect, vi } from "vitest";
import { createRefreshRegistry } from "@/lib/planipret/refreshRegistry";

describe("refreshRegistry (P2R contextuel)", () => {
  it("le dernier propriétaire visible possède le geste", () => {
    const r = createRefreshRegistry(); const a = vi.fn(); const b = vi.fn();
    r.register(a); r.register(b); r.current()!(); expect(b).toHaveBeenCalled(); expect(a).not.toHaveBeenCalled();
  });
  it("SMS→Teams→Courriels→SMS : aucun ancien callback ne survit", () => {
    const r = createRefreshRegistry(); const sms = vi.fn();
    let un = r.register(sms); un();            // SMS caché
    expect(r.current()).toBeNull();           // Teams : refreshDisabled
    expect(r.current()).toBeNull();           // Courriels : refreshDisabled
    un = r.register(sms); expect(r.size).toBe(1); r.current()!(); expect(sms).toHaveBeenCalledTimes(1);
  });
  it("désinscription par identité, jamais un pop aveugle", () => {
    const r = createRefreshRegistry(); const parent = vi.fn(); const child = vi.fn();
    const unP = r.register(parent); const unC = r.register(child);
    unP(); expect(r.current()).toBe(child); unC(); unC(); expect(r.current()).toBeNull();
  });
  it("register(null) = aucun propriétaire, aucun indicateur", () => {
    const r = createRefreshRegistry(); r.register(null)(); expect(r.current()).toBeNull(); expect(r.size).toBe(0);
  });
  it("tout changement d'onglet incrémente la génération (spinner libéré)", () => {
    const r = createRefreshRegistry(); const g0 = r.generation; const un = r.register(vi.fn()); un();
    expect(r.generation).toBe(g0 + 2);
  });
});
