/**
 * Log-safe error descriptions (PROJECT §14: no personal data in logs). Database errors can carry
 * the failed SQL with its parameters (scene documents, thumbnails, user ids, session tokens) in
 * their message, so only the error class names and the Postgres SQLSTATE code are ever logged.
 */

const SQLSTATE = /^[0-9A-Z]{5}$/;
const MAX_CAUSE_DEPTH = 4;

function errorName(error: object): string {
  const name = "name" in error && typeof error.name === "string" ? error.name : "";
  return /^[A-Za-z][\w.]{0,63}$/.test(name) ? name : error.constructor?.name || "Error";
}

/** `"DrizzleQueryError ← PostgresError (SQLSTATE 23505)"`; never messages, SQL or parameters. */
export function describeErrorForLog(error: unknown): string {
  if (error === null || typeof error !== "object") return typeof error;
  const names: string[] = [];
  let sqlState: string | undefined;
  let current: unknown = error;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && current && typeof current === "object";
    depth += 1
  ) {
    names.push(errorName(current));
    const code = "code" in current ? current.code : undefined;
    if (!sqlState && typeof code === "string" && SQLSTATE.test(code)) sqlState = code;
    current = "cause" in current ? current.cause : undefined;
  }
  return `${names.join(" ← ")}${sqlState ? ` (SQLSTATE ${sqlState})` : ""}`;
}
