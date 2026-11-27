import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_HINT_COOKIE, AUTH_HINT_VALUE } from "@/lib/auth/auth-hint";

import { resetAuthHintStateForTests } from "./auth-switch";
import { SiteHeader, siteUserFromSession } from "./site-header";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() },
  signOut: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/auth/auth-client", () => ({
  authClient: { signOut: mocks.signOut, getSession: mocks.getSession },
}));

// `UserMenu` loads its dropdown with `next/dynamic`. Importing that module first keeps the cold
// transform out of the tests (it alone can exceed `findBy*`'s 1 s default on a busy machine).
// An unrelated cookie makes the islands find the hint among others, as in a real browser.
beforeAll(async () => {
  document.cookie = "theme=dark; Path=/";
  await import("./user-menu-dropdown");
}, 30_000);

beforeEach(() => {
  mocks.router.replace.mockReset();
  mocks.router.refresh.mockReset();
  mocks.signOut.mockReset();
  mocks.getSession.mockReset();
});

afterEach(() => {
  clearHint();
  resetAuthHintStateForTests();
});

/** What S3's auth server sets with a session and clears without one (FT-02). */
const setHint = () => {
  document.cookie = `${AUTH_HINT_COOKIE}=${AUTH_HINT_VALUE}; Path=/`;
};
const clearHint = () => {
  document.cookie = `${AUTH_HINT_COOKIE}=; Max-Age=0; Path=/`;
};

const MAI = { name: "Mai Tran", email: "mai@example.com" };
const SESSION = {
  data: { user: { name: "  Mai   Tran ", email: MAI.email }, session: {} },
  error: null,
};
const NAV = [{ href: "#features", label: "Features" }] as const;

/** The account-menu trigger, once `next/dynamic` has rendered the dropdown. */
const findMenuTrigger = () => screen.findByTestId("user-menu-trigger", {}, { timeout: 3_000 });

/** WCAG 2.5.3 (label in name): the name (here `aria-label`) begins with the text the button shows. */
function expectLabelInName(trigger: HTMLElement) {
  const shown = (trigger.textContent ?? "").trim();
  expect(trigger.getAttribute("aria-label")?.startsWith(shown)).toBe(true);
}

describe("SiteHeader on a static page (no `user`)", () => {
  it("offers Sign in and Sign up to visitors", () => {
    render(<SiteHeader nav={NAV} />);
    const header = screen.getByTestId("site-header");
    expect(within(header).getByTestId("site-logo")).toHaveAttribute("href", "/");
    expect(within(header).getByTestId("site-logo")).toHaveAccessibleName("Artikin home");
    expect(screen.getByTestId("header-sign-in")).toHaveAttribute("href", "/sign-in");
    expect(screen.getByTestId("header-sign-up")).toHaveAttribute("href", "/sign-up");
    expect(screen.getByRole("link", { name: "Features" })).toHaveAttribute("href", "#features");
    expect(screen.queryByTestId("user-menu-trigger")).not.toBeInTheDocument();
  });

  it("prerenders the visitor header and switches after hydration when the hint is set", async () => {
    const html = renderToString(<SiteHeader />);
    expect(html).toContain('data-testid="header-sign-in"');
    expect(html).not.toContain("user-menu-trigger");

    setHint();
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    const root = await act(async () =>
      hydrateRoot(container, <SiteHeader />, { onRecoverableError: recoverable }),
    );

    expect(await findMenuTrigger()).toHaveAccessibleName("Account menu");
    expect(screen.queryByTestId("header-sign-in")).not.toBeInTheDocument();
    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });

  it("shows the account area for the hint without loading the session", async () => {
    setHint();
    render(<SiteHeader />);
    const trigger = await findMenuTrigger();
    expect(trigger).toHaveAccessibleName("Account menu");
    expect(trigger).toHaveTextContent("");
    expectLabelInName(trigger);
    expect(screen.getByTestId("header-workspaces")).toHaveAttribute("href", "/workspaces");
    expect(screen.queryByTestId("header-sign-in")).not.toBeInTheDocument();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("loads the account the first time the menu opens", async () => {
    setHint();
    mocks.getSession.mockResolvedValue(SESSION);
    const user = userEvent.setup();
    render(<SiteHeader />);

    await user.click(await findMenuTrigger());
    expect(await screen.findByText("Mai Tran")).toBeInTheDocument();
    expect(screen.getByText(MAI.email)).toBeInTheDocument();
    expect(screen.getByTestId("user-menu-workspaces")).toHaveAttribute("href", "/workspaces");
    const trigger = screen.getByTestId("user-menu-trigger");
    expect(trigger).toHaveAccessibleName("MT, account menu for Mai Tran");
    expect(trigger).toHaveTextContent("MT");
    expectLabelInName(trigger);

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("user-menu-trigger"));
    expect(await screen.findByText(MAI.email)).toBeInTheDocument();
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
  });

  it("turns a stale hint into Sign in once the menu has explained it", async () => {
    setHint();
    // The session check finds no session, so the auth server clears the hint with its response.
    mocks.getSession.mockImplementation(async () => {
      clearHint();
      return { data: null, error: null };
    });
    const user = userEvent.setup();
    render(<SiteHeader />);

    await user.click(await findMenuTrigger());
    expect(await screen.findByText("Your session has ended")).toBeInTheDocument();
    expect(screen.getByTestId("user-menu-sign-in")).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByTestId("user-menu-sign-out")).not.toBeInTheDocument();
    // The header keeps the menu (and its explanation) until the visitor closes it.
    expect(screen.getByTestId("user-menu-trigger")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    const signIn = await screen.findByTestId("header-sign-in");
    expect(screen.queryByTestId("user-menu-trigger")).not.toBeInTheDocument();
    expect(signIn).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Your session has ended.");
  });

  it("offers a retry when the account can't be loaded", async () => {
    setHint();
    mocks.getSession.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    mocks.getSession.mockResolvedValueOnce(SESSION);
    const user = userEvent.setup();
    render(<SiteHeader />);

    await user.click(await findMenuTrigger());
    expect(await screen.findByText("Couldn't load your account")).toBeInTheDocument();
    expect(screen.getByTestId("user-menu-sign-out")).toBeInTheDocument();

    await user.click(screen.getByTestId("user-menu-retry"));
    expect(await screen.findByText(MAI.email)).toBeInTheDocument();
    expect(screen.queryByTestId("user-menu-retry")).not.toBeInTheDocument();
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
  });

  it("switches to the visitor header after signing out", async () => {
    setHint();
    mocks.getSession.mockResolvedValue(SESSION);
    // The auth server clears the hint cookie together with the session.
    mocks.signOut.mockImplementation(async () => {
      clearHint();
      return { error: null };
    });
    const user = userEvent.setup();
    render(<SiteHeader />);

    await user.click(await findMenuTrigger());
    await user.click(await screen.findByTestId("user-menu-sign-out"));

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.router.replace).toHaveBeenCalledWith("/");
    expect(await screen.findByTestId("header-sign-in")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("You're signed out.");
  });

  it("follows a sign-in or sign-out in another tab when the page becomes active", async () => {
    render(<SiteHeader />);
    expect(screen.getByTestId("header-sign-in")).toBeInTheDocument();

    setHint();
    act(() => window.dispatchEvent(new Event("focus")));
    expect(await findMenuTrigger()).toBeInTheDocument();

    clearHint();
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByTestId("header-sign-in")).toBeInTheDocument();
    expect(screen.queryByTestId("user-menu-trigger")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});

describe("SiteHeader on a per-request page (server-known user)", () => {
  it("shows the account menu for the given user without fetching", async () => {
    const user = userEvent.setup();
    render(<SiteHeader user={MAI} />);
    expect(screen.queryByTestId("header-sign-in")).not.toBeInTheDocument();

    const trigger = await findMenuTrigger();
    expect(trigger).toHaveAccessibleName("MT, account menu for Mai Tran");
    expect(trigger).toHaveTextContent("MT");
    expectLabelInName(trigger);

    await user.click(trigger);
    expect(await screen.findByTestId("user-menu-workspaces")).toHaveAttribute(
      "href",
      "/workspaces",
    );
    expect(screen.getByText(MAI.email)).toBeInTheDocument();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("trusts the server over the hint cookie", () => {
    setHint();
    render(<SiteHeader user={null} />);
    expect(screen.getByTestId("header-sign-in")).toBeInTheDocument();
    expect(screen.queryByTestId("header-workspaces")).not.toBeInTheDocument();
  });

  it("signs out from the menu and returns to the landing page", async () => {
    mocks.signOut.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SiteHeader user={MAI} />);

    await user.click(await findMenuTrigger());
    await user.click(await screen.findByTestId("user-menu-sign-out"));

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.router.replace).toHaveBeenCalledWith("/");
  });
});

describe("siteUserFromSession", () => {
  it("normalizes the display name and falls back to the email's local part", () => {
    expect(siteUserFromSession(null)).toBeNull();
    expect(
      siteUserFromSession({ user: { name: "  Mai   Tran ", email: "mai@example.com" } }),
    ).toEqual({
      name: "Mai Tran",
      email: "mai@example.com",
    });
    expect(siteUserFromSession({ user: { name: "", email: "lan@example.com" } })?.name).toBe("lan");
  });
});
