import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetAuthHintStateForTests } from "@/components/auth-switch";
import { AUTH_HINT_COOKIE, AUTH_HINT_VALUE } from "@/lib/auth/auth-hint";

import { Faq } from "./faq";
import { Features } from "./features";
import { Hero } from "./hero";

afterEach(() => {
  document.cookie = `${AUTH_HINT_COOKIE}=; Max-Age=0; Path=/`;
  resetAuthHintStateForTests();
});

describe("landing", () => {
  it("sends visitors to the guest editor and to sign-up", () => {
    render(<Hero />);
    expect(screen.getByTestId("landing-hero")).toBeInTheDocument();
    expect(screen.getByTestId("landing-preview-image")).toHaveAccessibleName(
      /wooden artist mannequin/,
    );
    expect(screen.getByTestId("landing-cta-editor")).toHaveAttribute("href", "/editor");
    expect(screen.getByTestId("landing-cta-sign-up")).toHaveAttribute("href", "/sign-up");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pose. Light. Draw.");
  });

  it("offers My workspaces instead of Sign up when the signed-in hint is set", () => {
    document.cookie = `${AUTH_HINT_COOKIE}=${AUTH_HINT_VALUE}; Path=/`;
    render(<Hero />);
    expect(screen.queryByTestId("landing-cta-sign-up")).not.toBeInTheDocument();
    expect(screen.getByTestId("landing-cta-workspaces")).toHaveAttribute("href", "/workspaces");
  });

  it("states the configured workspace quota instead of a hard-coded number", () => {
    render(
      <>
        <Features workspaceLimit={7} />
        <Faq workspaceLimit={7} />
      </>,
    );
    expect(screen.getByRole("heading", { name: "Up to 7 saved workspaces" })).toBeInTheDocument();
    expect(screen.getByText(/keep up to seven scenes/)).toBeInTheDocument();
    expect(screen.getByText(/saves up to seven workspaces/)).toBeInTheDocument();
  });
});
