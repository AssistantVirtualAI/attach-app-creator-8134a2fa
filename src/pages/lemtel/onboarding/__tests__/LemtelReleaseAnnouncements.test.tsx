import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hosted = vi.hoisted(() => ({ api: { status: vi.fn(), announce: vi.fn() } }));
vi.mock("../lemtelHostedApi", () => ({
  releaseApi: hosted.api,
  LemtelError: class LemtelError extends Error { constructor(public key: string) { super(key); } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import LemtelReleaseAnnouncements from "../LemtelReleaseAnnouncements";
import { LemtelError } from "../lemtelHostedApi";

const latest = (version: string) => ({ version, source: "github_latest", publishedAt: null, releaseUrl: `https://github.com/x/releases/tag/v${version}` });
const baseline = { version: "2.5.22", state: "baseline", triggeredBy: "baseline", recipients: 0, accepted: 0, failed: 0, createdAt: "2026-10-20T00:00:00Z", completedAt: "2026-10-20T00:00:00Z" };

beforeEach(() => { Object.values(hosted.api).forEach((fn) => fn.mockReset()); vi.stubGlobal("confirm", vi.fn(() => true)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("desktop release announcements (platform administrators)", () => {
  it("is invisible to anyone who is not a platform administrator", async () => {
    hosted.api.status.mockRejectedValue(new LemtelError("not_allowed"));
    const { container } = render(<LemtelReleaseAnnouncements lang="fr" readonly={false} />);
    await waitFor(() => expect(hosted.api.status).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("shows the baseline as already in users' hands (no announce button enabled)", async () => {
    hosted.api.status.mockResolvedValue({ latest: latest("2.5.22"), history: [baseline] });
    render(<LemtelReleaseAnnouncements lang="fr" readonly={false} />);
    expect(await screen.findByText("Dernière version 2.5.22")).toBeTruthy();
    expect(screen.getByText("Référence (non annoncée)")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Annoncer maintenant/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("announces a new release once and refreshes the history", async () => {
    hosted.api.status.mockResolvedValueOnce({ latest: latest("2.5.23"), history: [baseline] })
      .mockResolvedValueOnce({ latest: latest("2.5.23"), history: [{ ...baseline, version: "2.5.23", state: "sent", triggeredBy: "platform_admin", recipients: 4, accepted: 4 }, baseline] });
    hosted.api.announce.mockResolvedValue({ status: "sent", version: "2.5.23", recipients: 4 });
    render(<LemtelReleaseAnnouncements lang="en" readonly={false} />);
    const button = await screen.findByRole("button", { name: /Announce now/ });
    fireEvent.click(button);
    await waitFor(() => expect(hosted.api.announce).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Sent")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Announce now/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
