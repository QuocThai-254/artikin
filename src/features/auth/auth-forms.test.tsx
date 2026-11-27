import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() },
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    signIn: { email: mocks.signInEmail, social: vi.fn() },
    signUp: { email: mocks.signUpEmail },
  },
}));

beforeEach(() => {
  mocks.router.replace.mockReset();
  mocks.router.refresh.mockReset();
  mocks.signInEmail.mockReset();
  mocks.signUpEmail.mockReset();
  // The pages are prerendered: the forms read `?callbackUrl=` / `?error=` from the URL.
  window.history.replaceState(null, "", "/sign-in");
});

describe("SignUpForm", () => {
  it("shows inline errors linked to their fields and sends nothing", async () => {
    const user = userEvent.setup();
    render(<SignUpForm providers={[]} />);

    await user.type(screen.getByTestId("auth-email"), "not-an-email");
    await user.type(screen.getByTestId("auth-password"), "1234567");
    await user.click(screen.getByTestId("auth-submit"));

    const nameInput = screen.getByTestId("auth-name");
    expect(screen.getByTestId("auth-error-name")).toHaveTextContent("Enter your name.");
    expect(screen.getByTestId("auth-error-email")).toHaveTextContent("valid email");
    expect(screen.getByTestId("auth-error-password")).toHaveTextContent("at least 8");
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput).toHaveAccessibleDescription("Enter your name.");
    expect(nameInput).toHaveFocus();
    expect(mocks.signUpEmail).not.toHaveBeenCalled();

    // Errors update live once the user starts correcting.
    await user.type(nameInput, "Mai");
    expect(screen.queryByTestId("auth-error-name")).not.toBeInTheDocument();
  });

  it("rejects passwords over 128 characters", async () => {
    const user = userEvent.setup();
    render(<SignUpForm providers={[]} />);
    await user.type(screen.getByTestId("auth-name"), "Mai");
    await user.type(screen.getByTestId("auth-email"), "mai@example.com");
    await user.click(screen.getByTestId("auth-password"));
    await user.paste("p".repeat(129));
    await user.click(screen.getByTestId("auth-submit"));
    expect(screen.getByTestId("auth-error-password")).toHaveTextContent("128 characters or fewer");
    expect(mocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("explains an already registered email and links to sign-in", async () => {
    mocks.signUpEmail.mockResolvedValue({
      data: null,
      error: { status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" },
    });
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/sign-up?callbackUrl=%2Feditor%2Fabc");
    render(<SignUpForm providers={[]} />);
    await user.type(screen.getByTestId("auth-name"), " Mai ");
    await user.type(screen.getByTestId("auth-email"), " Mai@Example.com ");
    await user.type(screen.getByTestId("auth-password"), "correct horse");
    await user.click(screen.getByTestId("auth-submit"));

    expect(mocks.signUpEmail).toHaveBeenCalledWith({
      name: "Mai",
      email: "Mai@Example.com",
      password: "correct horse",
    });
    const alert = await screen.findByTestId("auth-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("already exists");
    expect(screen.getByRole("link", { name: "Sign in instead" })).toHaveAttribute(
      "href",
      "/sign-in?callbackUrl=%2Feditor%2Fabc",
    );
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("goes to the destination after signing up", async () => {
    mocks.signUpEmail.mockResolvedValue({ data: { token: "t" }, error: null });
    const user = userEvent.setup();
    render(<SignUpForm providers={[]} />);
    await user.type(screen.getByTestId("auth-name"), "Mai");
    await user.type(screen.getByTestId("auth-email"), "mai@example.com");
    await user.type(screen.getByTestId("auth-password"), "12345678");
    await user.click(screen.getByTestId("auth-submit"));

    expect(mocks.router.replace).toHaveBeenCalledWith("/workspaces");
    expect(screen.getByTestId("auth-submit")).toBeDisabled();
  });
});

describe("SignInForm", () => {
  async function submitSignIn() {
    const user = userEvent.setup();
    await user.type(screen.getByTestId("auth-email"), "mai@example.com");
    await user.type(screen.getByTestId("auth-password"), "wrong password");
    await user.click(screen.getByTestId("auth-submit"));
  }

  it.each([
    [{ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" }, "Invalid email or password."],
    [{ status: 429, message: "Too many requests." }, "Too many attempts — try again later."],
    [{ status: 500 }, "Something went wrong. Please try again."],
  ])("shows a form-level error for %j", async (error, message) => {
    mocks.signInEmail.mockResolvedValue({ data: null, error });
    render(<SignInForm providers={[]} />);
    await submitSignIn();
    expect(await screen.findByTestId("auth-error")).toHaveTextContent(message);
    expect(screen.getByTestId("auth-submit")).toBeEnabled();
  });

  it("reports an unreachable server", async () => {
    mocks.signInEmail.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<SignInForm providers={[]} />);
    await submitSignIn();
    expect(await screen.findByTestId("auth-error")).toHaveTextContent("Can't reach the server");
  });

  it("returns to the requested page after signing in, without an extra refresh render", async () => {
    mocks.signInEmail.mockResolvedValue({ data: { token: "t" }, error: null });
    window.history.replaceState(null, "", "/sign-in?callbackUrl=%2Feditor%2Fabc");
    render(<SignInForm providers={[]} />);
    await submitSignIn();
    expect(mocks.router.replace).toHaveBeenCalledWith("/editor/abc");
    expect(mocks.router.refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("auth-switch-link")).toHaveAttribute(
      "href",
      "/sign-up?callbackUrl=%2Feditor%2Fabc",
    );
  });

  it("never navigates off-site, whatever the URL says (S6 QA M1)", async () => {
    mocks.signInEmail.mockResolvedValue({ data: { token: "t" }, error: null });
    window.history.replaceState(null, "", "/sign-in?callbackUrl=%2F.%2F%2Fevil.example%2Flogin");
    render(<SignInForm providers={[]} />);
    await submitSignIn();
    expect(mocks.router.replace).toHaveBeenCalledWith("/workspaces");
  });

  it("shows an OAuth error from the URL until the next submit", async () => {
    mocks.signInEmail.mockResolvedValue({
      data: null,
      error: { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" },
    });
    window.history.replaceState(null, "", "/sign-in?error=account_not_linked");
    render(<SignInForm providers={[]} />);
    expect(screen.getByTestId("auth-error")).toHaveTextContent(
      "An account with this email already exists.",
    );
    await submitSignIn();
    expect(await screen.findByTestId("auth-error")).toHaveTextContent("Invalid email or password.");
  });

  it("renders OAuth buttons only for enabled providers", () => {
    const { rerender } = render(<SignInForm providers={[]} />);
    expect(screen.queryByTestId("auth-oauth-github")).not.toBeInTheDocument();
    rerender(<SignInForm providers={["github"]} />);
    expect(screen.getByTestId("auth-oauth-github")).toHaveTextContent("Continue with GitHub");
    expect(screen.queryByTestId("auth-oauth-google")).not.toBeInTheDocument();
  });

  it("toggles password visibility", async () => {
    const user = userEvent.setup();
    render(<SignInForm providers={[]} />);
    const password = screen.getByTestId("auth-password");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
