import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { invoke, records, t } = vi.hoisted(() => ({
  invoke: vi.fn(),
  t: (key: string) => key,
  records: [
    { id: "accepted", action: "widget.sync", response_status: 200, success: null, response_body: null, created_at: "2026-10-23T11:00:00Z" },
    { id: "failed", action: "widget.sync", response_status: 500, success: null, response_body: { error: "http_500" }, created_at: "2026-10-23T11:01:00Z" },
    { id: "business-failed", action: "call.summary", response_status: 200, success: false, created_at: "2026-10-23T11:02:00Z" },
  ],
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke },
  from: () => ({ select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: records, error: null }) }) }) }),
} }));
vi.mock("@/hooks/useMplanipretLang", () => ({ useMplanipretLang: () => ({ lang: "fr", t }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import MMaestroSync from "../MMaestroSync";

it("excludes accepted HTTP 200 from failures and retry without sending anything", async () => {
  render(<MemoryRouter><MMaestroSync /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
  expect(screen.getAllByRole("button", { name: "screens.maestroSync.retry" })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "screens.maestroSync.filterFailed" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalled();
});