import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompanionCard } from "./CompanionCard.js";
import type { Scope } from "../lib/types.js";

const S = (...s: string[]) => s as Scope[];

describe("CompanionCard", () => {
  it("renders the matching companion with its actions", () => {
    render(
      <CompanionCard host="www.sos.mo.gov" scopes={S("voter.read")} onDismiss={vi.fn()} />
    );
    expect(screen.getByText(/missouri voter site/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Register" })).toBeInTheDocument();
  });

  it("renders nothing for a non-allow-listed host", () => {
    const { container } = render(
      <CompanionCard host="example.com" scopes={S("voter.read")} onDismiss={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the role lacks the scope", () => {
    const { container } = render(
      <CompanionCard host="airtable.com" scopes={S("voter.read")} onDismiss={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("calls onDismiss when Hide is clicked", async () => {
    const onDismiss = vi.fn();
    render(
      <CompanionCard host="airtable.com" scopes={S("list.import")} onDismiss={onDismiss} />
    );
    await userEvent.click(screen.getByRole("button", { name: /hide/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
