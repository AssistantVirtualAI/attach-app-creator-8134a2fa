import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { normalizeTask } from "../../supabase/functions/_shared/planipret-tasks";

// ── Mocks ─────────────────────────────────────────────────────────────────
const listTasks = vi.fn();
const createTask = vi.fn();
const updateTask = vi.fn();
const deleteTask = vi.fn();
let broadcastHandler: (() => void) | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => ({
      on: (_t: string, _f: any, cb: () => void) => { broadcastHandler = cb; return { subscribe: () => ({}) }; },
      subscribe: () => ({}),
    }),
    removeChannel: () => {},
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/planipret/tasks", async () => {
  const shared = await vi.importActual<any>("../../supabase/functions/_shared/planipret-tasks");
  return {
    ...shared,
    listTasks: (...a: any[]) => listTasks(...a),
    createTask: (...a: any[]) => createTask(...a),
    updateTask: (...a: any[]) => updateTask(...a),
    deleteTask: (...a: any[]) => deleteTask(...a),
    loadTaskCache: () => [],
    saveTaskCache: () => {},
    clearTaskCache: () => {},
  };
});

import TasksSection from "@/components/planipret/mobile/TasksSection";

const NOW = new Date("2026-09-02T15:00:00Z");

const TASKS = [
  { id: "a", notes: "Rappeler Jean", date: "2026-08-30 10:00:00", status: "pending" },
  { id: "b", notes: "Signer le dossier", date: "2026-09-02 18:00:00", status: "pending" },
  { id: "c", notes: "Suivi Sophie", date: "2026-09-20 10:00:00", status: "pending" },
].map(normalizeTask);

function listResult(over: any = {}) {
  return {
    success: true,
    source: "api",
    tasks: TASKS,
    buckets: { overdue: [], today: [], upcoming: [] },
    overdue_count: 1,
    counts: { overdue: 1, today: 1, upcoming: 1, open: 3, all: 3 },
    filter: "open",
    page: 1, limit: 20, total: 3, has_more: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  broadcastHandler = null;
  vi.setSystemTime(NOW);
  listTasks.mockResolvedValue(listResult());
});

describe("TasksSection", () => {
  it("renders the overdue / today / upcoming buckets", async () => {
    render(<TasksSection userId="u1" lang="fr" />);
    expect(await screen.findByText("Rappeler Jean")).toBeInTheDocument();
    expect(screen.getByText("Signer le dossier")).toBeInTheDocument();
    expect(screen.getByText("Suivi Sophie")).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\s+/g, " ").trim());
    expect(tabs).toEqual(["Toutes · 3", "En retard · 1", "Aujourd'hui · 1", "À venir · 1"]);
  });

  it("shows the empty state", async () => {
    listTasks.mockResolvedValue(listResult({ tasks: [], counts: { overdue: 0, today: 0, upcoming: 0, open: 0, all: 0 } }));
    render(<TasksSection userId="u1" lang="fr" />);
    expect(await screen.findByText(/Aucune tâche ouverte/)).toBeInTheDocument();
  });

  it("shows the offline / projection notice", async () => {
    listTasks.mockResolvedValue(listResult({ source: "projection", message: "Dernier état connu" }));
    render(<TasksSection userId="u1" lang="fr" />);
    expect(await screen.findByText(/Hors ligne/)).toBeInTheDocument();
  });

  it("shows tasks_unavailable when the API exposes no list", async () => {
    listTasks.mockResolvedValue(listResult({
      source: "unavailable", tasks: [], error: "tasks_unavailable",
      message: "Liste des tâches indisponible pour le moment.",
      counts: { overdue: 0, today: 0, upcoming: 0, open: 0, all: 0 },
    }));
    render(<TasksSection userId="u1" lang="fr" />);
    expect(await screen.findByText(/indisponible/)).toBeInTheDocument();
  });

  it("shows an error state with a retry button", async () => {
    listTasks.mockResolvedValue(listResult({ success: false, error: "network_error", message: "Réseau indisponible", source: "api", tasks: [] }));
    render(<TasksSection userId="u1" lang="fr" />);
    const retry = await screen.findByText("Réessayer");
    listTasks.mockResolvedValue(listResult());
    fireEvent.click(retry);
    expect(await screen.findByText("Rappeler Jean")).toBeInTheDocument();
  });

  it("opens the composer from the + button", async () => {
    render(<TasksSection userId="u1" lang="fr" />);
    await screen.findByText("Rappeler Jean");
    fireEvent.click(screen.getByLabelText("Nouvelle tâche"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toBeInTheDocument();
  });

  it("requires a confirmation before deleting and then calls the API", async () => {
    deleteTask.mockResolvedValue({ success: true });
    render(<TasksSection userId="u1" lang="fr" />);
    await screen.findByText("Rappeler Jean");
    fireEvent.click(screen.getAllByLabelText("Supprimer")[0]);
    expect(await screen.findByText("Supprimer la tâche ?")).toBeInTheDocument();
    expect(deleteTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("alertdialog").querySelector("button:last-of-type")!);
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("a"));
  });

  it("cancelling the delete dialog mutates nothing", async () => {
    render(<TasksSection userId="u1" lang="fr" />);
    await screen.findByText("Rappeler Jean");
    fireEvent.click(screen.getAllByLabelText("Supprimer")[0]);
    fireEvent.click(await screen.findByText("Annuler"));
    await waitFor(() => expect(screen.queryByText("Supprimer la tâche ?")).not.toBeInTheDocument());
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it("snoozes a task through update", async () => {
    updateTask.mockResolvedValue({ success: true });
    render(<TasksSection userId="u1" lang="fr" />);
    await screen.findByText("Rappeler Jean");
    fireEvent.click(screen.getAllByLabelText("Reporter")[0]);
    await waitFor(() => expect(updateTask).toHaveBeenCalled());
    expect(updateTask.mock.calls[0][0]).toBe("a");
  });

  it("refreshes when AVA broadcasts a task mutation", async () => {
    render(<TasksSection userId="u1" lang="fr" />);
    await screen.findByText("Rappeler Jean");
    const before = listTasks.mock.calls.length;
    broadcastHandler?.();
    await waitFor(() => expect(listTasks.mock.calls.length).toBeGreaterThan(before));
  });

  it("filters through the chips", async () => {
    render(<TasksSection userId="u1" lang="fr" />);
    await screen.findByText("Rappeler Jean");
    fireEvent.click(screen.getAllByRole("tab")[1]);
    await waitFor(() => expect(listTasks).toHaveBeenLastCalledWith(expect.objectContaining({ filter: "overdue" })));
  });
});
