import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hosted = vi.hoisted(() => ({
  api: { updateMemberProfile: vi.fn(), issueTemporaryPassword: vi.fn(), revokeAccess: vi.fn(), restoreMember: vi.fn(), removeMember: vi.fn() },
}));
vi.mock("../lemtelHostedApi", () => ({
  portalApi: hosted.api,
  LemtelError: class LemtelError extends Error { constructor(public key: string) { super(key); } },
  LEMTEL_ONBOARDING_ENABLED: true,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { PersonActionsPanel } from "../LemtelPersonActions";
import { ActivityLog } from "../LemtelActivityLog";
import { LEMTEL_DICT } from "../lemtelI18n";

const t = LEMTEL_DICT.fr;
const ORG = "11111111-1111-4111-8111-111111111111";
const person = { userId: "22222222-2222-4222-8222-222222222222", fullName: "Ana Roy", email: "ana@lemtel.tel", role: "member" as const, status: "active" as const, locale: "fr" as const };

beforeEach(() => { Object.values(hosted.api).forEach((fn) => fn.mockReset()); vi.stubGlobal("confirm", vi.fn(() => true)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("person management panel", () => {
  it("saves the profile, sends a temporary password in the chosen language, suspends and removes", async () => {
    const onDone = vi.fn();
    hosted.api.updateMemberProfile.mockResolvedValue({ ok: true });
    hosted.api.issueTemporaryPassword.mockResolvedValue({ ok: true, deliveryStatus: "provider_accepted" });
    hosted.api.revokeAccess.mockResolvedValue({ ok: true });
    hosted.api.removeMember.mockResolvedValue({ ok: true, account: "deleted" });
    render(<PersonActionsPanel t={t} organizationId={ORG} person={person} onClose={vi.fn()} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(t.personActions.fullName), { target: { value: "Ana Roy-Tremblay" } });
    fireEvent.change(screen.getByLabelText(t.personActions.language), { target: { value: "en" } });
    fireEvent.click(screen.getByText(t.personActions.saveProfile));
    await waitFor(() => expect(hosted.api.updateMemberProfile).toHaveBeenCalledWith(ORG, person.userId, { fullName: "Ana Roy-Tremblay", locale: "en" }));
    fireEvent.click(screen.getByText(t.personActions.sendPassword));
    await waitFor(() => expect(hosted.api.issueTemporaryPassword).toHaveBeenCalledWith(ORG, person.userId, "en"));
    fireEvent.click(screen.getByText(t.personActions.suspend));
    await waitFor(() => expect(hosted.api.revokeAccess).toHaveBeenCalledWith(ORG, person.userId));
    fireEvent.click(screen.getByText(t.personActions.remove));
    await waitFor(() => expect(hosted.api.removeMember).toHaveBeenCalledWith(ORG, person.userId));
    expect(onDone).toHaveBeenCalledTimes(4);
    expect((screen.getByText(t.personActions.voicemailReset).closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("protects the owner and offers restore for a suspended person", async () => {
    hosted.api.restoreMember.mockResolvedValue({ ok: true });
    render(<PersonActionsPanel t={t} organizationId={ORG} person={{ ...person, role: "owner", status: "suspended" }} onClose={vi.fn()} onDone={vi.fn()} />);
    expect((screen.getByText(t.personActions.remove).closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText(t.personActions.restore));
    await waitFor(() => expect(hosted.api.restoreMember).toHaveBeenCalledWith(ORG, person.userId));
  });

  it("does nothing when the confirmation is declined", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<PersonActionsPanel t={t} organizationId={ORG} person={person} onClose={vi.fn()} onDone={vi.fn()} />);
    fireEvent.click(screen.getByText(t.personActions.remove));
    expect(hosted.api.removeMember).not.toHaveBeenCalled();
  });
});

describe("activity log", () => {
  it("shows who did what and filters by text and action", () => {
    const items = [
      { id: "1", at: "2026-10-19T23:00:00Z", action: "user_removed", actor: { name: "Mohamad", email: "m@x.ca" }, subject: { name: "Ana", email: "ana@lemtel.tel" } },
      { id: "2", at: "2026-10-19T22:00:00Z", action: "domain_created", actor: { name: "Mohamad", email: "m@x.ca" } },
    ];
    render(<ActivityLog t={t} items={items} />);
    expect(screen.getByText(t.activityActions.user_removed, { selector: "p" })).toBeTruthy();
    expect(screen.getByText(/Concerne Ana \(ana@lemtel.tel\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(t.activityLog.search), { target: { value: "ana@" } });
    expect(screen.queryByText(t.activityActions.domain_created, { selector: "p" })).toBeNull();
    fireEvent.change(screen.getByLabelText(t.activityLog.search), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(t.activityLog.filter), { target: { value: "domain_created" } });
    expect(screen.queryByText(t.activityActions.user_removed, { selector: "p" })).toBeNull();
    expect(screen.getByText(t.activityActions.domain_created, { selector: "p" })).toBeTruthy();
  });
});
