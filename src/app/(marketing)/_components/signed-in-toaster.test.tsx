import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AuthSwitch, resetAuthHintStateForTests } from "@/components/auth-switch";
import { SiteHeader } from "@/components/site-header";
import { AUTH_HINT_COOKIE, AUTH_HINT_VALUE } from "@/lib/auth/auth-hint";

import { SignedInToaster } from "./signed-in-toaster";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() },
  signOut: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/auth/auth-client", () => ({
  authClient: { signOut: mocks.signOut, getSession: mocks.getSession },
}));

// Both load through `next/dynamic`; importing them first keeps cold transforms out of the test.
beforeAll(async () => {
  await Promise.all([import("@/components/user-menu-dropdown"), import("@/components/ui/sonner")]);
}, 30_000);

afterEach(() => {
  document.cookie = `${AUTH_HINT_COOKIE}=; Max-Age=0; Path=/`;
  resetAuthHintStateForTests();
});

describe("SignedInToaster", () => {
  it("shows a failed sign-out from the account menu on the static landing", async () => {
    document.cookie = `${AUTH_HINT_COOKIE}=${AUTH_HINT_VALUE}; Path=/`;
    mocks.getSession.mockResolvedValue({
      data: { user: { name: "Mai Tran", email: "mai@example.com" }, session: {} },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: { message: "Network error" } });
    const user = userEvent.setup();
    // The landing's composition: static header plus the toaster island (no app-wide Toaster).
    render(
      <>
        <SiteHeader />
        <AuthSwitch signedIn={<SignedInToaster />} />
      </>,
    );
    // Sonner's live region exists before anything is toasted (toasts are not replayed).
    await screen.findByRole("region", { name: /notifications/i }, { timeout: 3_000 });

    await user.click(await screen.findByTestId("user-menu-trigger", {}, { timeout: 3_000 }));
    await user.click(await screen.findByTestId("user-menu-sign-out"));

    expect(
      await screen.findByText("Couldn't sign out. Check your connection and try again."),
    ).toBeInTheDocument();
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId("user-menu-trigger")).toBeInTheDocument();
  });
});
