import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CommissionSections from "./CommissionSections";

vi.mock("./PendingCommissionsCard", () => ({ default: ({ cacheScope }: any) => <p>pending-{cacheScope}</p> }));
vi.mock("./RegisterCommissions", () => ({ default: ({ scope }: any) => <p>paid-{scope}</p> }));

describe("Commission status sections", () => {
  it("separates pending and paid on one page", () => {
    render(<CommissionSections lang="fr" scope="admin" />);
    expect(screen.getByText("pending-admin")).toBeVisible();
    expect(screen.getByText("paid-admin")).not.toBeVisible();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Déboursées" }), { button: 0, ctrlKey: false });
    expect(screen.getByText("paid-admin")).toBeVisible();
    expect(screen.getByText("pending-admin")).not.toBeVisible();
  });
  it("keeps the broker scope on both sources", () => {
    render(<CommissionSections lang="fr" scope="broker" />);
    expect(screen.getByText("pending-broker")).toBeInTheDocument();
    expect(screen.getByText("paid-broker")).toBeInTheDocument();
  });
});