/**
 * Normalizes profile fields that Better Auth accepts from clients (sign-up, update-user) and
 * OAuth providers before they are stored (ARCHITECTURE §13 — validation at the boundary).
 * Never throws, so an unusual OAuth profile can still sign in.
 */

export const USER_NAME_MAX_LENGTH = 60;

const MAX_IMAGE_URL_LENGTH = 2048;

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastCode = cut.charCodeAt(cut.length - 1);
  return (lastCode >= 0xd800 && lastCode <= 0xdbff ? cut.slice(0, -1) : cut).trimEnd();
}

/**
 * Trimmed display name with whitespace runs (including line breaks) collapsed, at most 60
 * characters. Empty names fall back to the email's local part, then to "Artist".
 */
export function normalizeUserName(name: unknown, email?: unknown): string {
  const clean = (value: unknown) =>
    typeof value === "string"
      ? truncate(value.replace(/\s+/g, " ").trim(), USER_NAME_MAX_LENGTH)
      : "";
  const fromName = clean(name);
  if (fromName) return fromName;
  const localPart = typeof email === "string" ? email.split("@", 1)[0] : undefined;
  return clean(localPart) || "Artist";
}

/** Keeps `https:` avatar URLs (as sent by OAuth providers); anything else becomes `null`. */
export function normalizeUserImage(image: unknown): string | null {
  if (typeof image !== "string" || image.length > MAX_IMAGE_URL_LENGTH) return null;
  try {
    return new URL(image).protocol === "https:" ? image : null;
  } catch {
    return null;
  }
}
