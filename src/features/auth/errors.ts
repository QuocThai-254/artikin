import type { AuthFieldName } from "./schemas";

/** What the auth client reports for a failed request (`{ data, error }` result or a thrown error). */
export interface AuthErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

export interface AuthFormError {
  /** Field the message belongs to; omitted for form-level errors. */
  field?: AuthFieldName;
  message: string;
  /** Offer a link to the other auth page (e.g. "email already registered → sign in"). */
  suggestSwitch?: boolean;
}

export const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again.";
export const RATE_LIMIT_MESSAGE = "Too many attempts — try again later.";

/** Maps Better Auth error codes / statuses to user-facing messages (PROJECT F11). */
export function describeAuthError(error: AuthErrorLike): AuthFormError {
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      // Same message for unknown emails and wrong passwords (no account enumeration).
      return { message: "Invalid email or password." };
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return {
        message: "An account with this email already exists. Sign in instead.",
        suggestSwitch: true,
      };
    case "INVALID_EMAIL":
      return { field: "email", message: "Enter a valid email address." };
    case "PASSWORD_TOO_SHORT":
      return { field: "password", message: "Use at least 8 characters." };
    case "PASSWORD_TOO_LONG":
      return { field: "password", message: "Use 128 characters or fewer." };
    case "INVALID_ORIGIN":
    case "MISSING_OR_NULL_ORIGIN":
    case "CROSS_SITE_NAVIGATION_LOGIN_BLOCKED":
      return {
        message: "This request was blocked for security reasons. Reload the page and try again.",
      };
  }
  if (error.status === 429) return { message: RATE_LIMIT_MESSAGE };
  if (error.status === 0 || error.status === undefined) return { message: NETWORK_ERROR_MESSAGE };
  return { message: "Something went wrong. Please try again." };
}

/** Message for `?error=<code>` after a failed OAuth round trip (Better Auth `onAPIError.errorURL`). */
export function describeOAuthError(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (code === "access_denied") return "Sign-in was cancelled.";
  // Account linking is off (ARCHITECTURE §7): the email already belongs to a password account.
  if (code === "account_not_linked") {
    return "An account with this email already exists. Sign in with your email and password.";
  }
  return "Signing in with that provider didn't work. Please try again or use your email.";
}
