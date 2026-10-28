import { describe, expect, it } from "vitest";
import { COMMISSION_CHAT_TOOLS, formatCommissionAnswer, isCommissionQuestion, wantsMaestroDirectory } from "../../supabase/functions/_shared/ava-chat-routing";

describe("Marc's AVA financial questions", () => {
  it.each(["c’est qupi le volume de Francis Marois?", "montre moi le tableau des preteurs dans la vue globale", "liste des dossiers et commissions par courtier"])("routes %s to financial data, never clients", (question) => {
    expect(isCommissionQuestion(question)).toBe(true);
    expect(wantsMaestroDirectory(question)).toBe(false);
  });
  it("preserves explicit client lists", () => {
    expect(wantsMaestroDirectory("montre la liste des clients")).toBe(true);
    expect(isCommissionQuestion("montre la liste des clients")).toBe(false);
  });
  it("dispatches get_commissions through shared tools rather than unknown-action fallback", () => {
    expect(COMMISSION_CHAT_TOOLS.has("get_commissions")).toBe(true);
    expect(COMMISSION_CHAT_TOOLS.has("list_clients")).toBe(false);
  });
  it("renders broker amounts, units and volume from validated evidence only", () => {
    const answer = formatCommissionAnswer({ scope: "courtier: Francis Marois", paid: { total: 1234.56, files: 7, loan_volume: 2500000 } }, "en");
    expect(answer).toContain("Francis Marois");
    expect(answer).toContain("$1,234.56");
    expect(answer).toContain("7 files");
    expect(answer).toContain("$2,500,000.00");
  });
  it("renders the complete validated lender table", () => {
    const lenders = Array.from({ length: 20 }, (_, i) => ({ key: `Lender ${i}`, deals: i + 1, volume: 100000 * (i + 1) }));
    const answer = formatCommissionAnswer({ scope: "tous les courtiers", paid: { lenders } }, "en", true);
    expect(answer).toContain("Lender 19 | 20 | $2,000,000.00");
  });
  it("retains the global broker table and shared-tool messages", () => {
    const answer = formatCommissionAnswer({ paid_by_broker: [{ name: "Francis Marois", amount: 1234.56, files: 7, loan_volume: 2500000 }] }, "en");
    expect(answer).toContain("Francis Marois | $1,234.56 | 7 | $2,500,000.00");
    expect(formatCommissionAnswer({ success: true, message: "Validated lender breakdown" }, "en")).toBe("Validated lender breakdown");
  });
  it("refuses unavailable/out-of-team figures without invented zero totals", () => {
    const answer = formatCommissionAnswer({ paid: { not_in_team: true, message: "Not in your team" } }, "en");
    expect(answer).toBe("Not in your team");
    expect(answer).not.toContain("$0");
    expect(formatCommissionAnswer({ success: false, error: "broker_not_found" }, "en")).toBe("broker_not_found");
  });
});