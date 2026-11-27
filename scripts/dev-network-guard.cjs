// @ts-check
/**
 * Network guard (ADR-028) — `npm run dev`, `npm run build` and `npm run start` preload it through
 * `NODE_OPTIONS="--require=./scripts/dev-network-guard.cjs $NODE_OPTIONS"` (options the caller
 * already set are kept), so every Node.js process of the dev server, the build and the production
 * server loads it.
 *
 * Why: nothing in this project may contact the public npm registry — some networks block it and
 * show a notification for every attempt (AGENTS.md "Compliance & safety"). The Next.js dev server
 * contacts it twice: at startup it checks security advisories (switched off in next.config.ts with
 * `experimental.agentUpgrade: false`, which also covers `next build`), and on the first browser
 * connection it fetches https://registry.npmjs.org/-/package/next/dist-tags to report whether
 * Next.js is outdated, which no option turns off. In build and start the guard is defense in depth.
 *
 * What: requests to the public npm and Yarn registry hosts made with `fetch()` or
 * `http(s).request()` / `http(s).get()` fail inside the process — before any DNS lookup or
 * socket — with an error whose `code` is `ERR_ARTIKIN_NETWORK_BLOCKED`. The first blocked request
 * per host is logged on stderr. Every other request passes through untouched. Next.js reports the
 * failed version check as "unknown". Native code (Turbopack's Rust side, e.g. next/font downloads)
 * is not affected.
 *
 * Dependency-free CommonJS so it loads before anything else. ARTIKIN_NETWORK_GUARD_DEBUG=1 logs
 * every blocked request, plus a line from every process that loads the guard (to check that child
 * processes inherit it).
 */
"use strict";

const http = require("node:http");
const https = require("node:https");
const { syncBuiltinESMExports } = require("node:module");
const path = require("node:path");
const { urlToHttpOptions } = require("node:url");

/** Public package registries that guarded processes must never contact. */
const BLOCKED_HOSTS = Object.freeze([
  "registry.npmjs.org",
  "registry.npmjs.com",
  "registry.yarnpkg.com",
]);
const ERROR_CODE = "ERR_ARTIKIN_NETWORK_BLOCKED";
const MARKER = Symbol.for("artikin.devNetworkGuard");
const DEBUG = process.env.ARTIKIN_NETWORK_GUARD_DEBUG === "1";

const blockedHosts = new Set(BLOCKED_HOSTS);
/** @type {Set<string>} */
const loggedHosts = new Set();

/** @param {string} line */
function writeLine(line) {
  try {
    process.stderr.write(`${line}\n`);
  } catch {
    // stderr may already be closed while the process exits.
  }
}

/**
 * Lower-cased host name without port or trailing dots (IPv6 literals are returned as they are).
 * @param {unknown} host
 * @returns {string}
 */
function normalizeHost(host) {
  if (typeof host !== "string") return "";
  let value = host.trim().toLowerCase();
  if (value.startsWith("[") || value.split(":").length > 2) return value;
  // Node.js ignores a port in `options.host`, but a stray one must not hide a blocked host.
  const colon = value.indexOf(":");
  if (colon !== -1) value = value.slice(0, colon);
  return value.replace(/\.+$/, "");
}

/** @param {unknown} host */
function isBlockedHost(host) {
  return blockedHosts.has(normalizeHost(host));
}

/**
 * Error for a blocked request; the first one per host (every one in debug mode) is also logged.
 * `target` is shown without credentials, query or fragment.
 * @param {string} host
 * @param {string} protocol
 * @param {string} pathname
 * @param {ErrorConstructor | TypeErrorConstructor} ErrorClass
 */
function blockedError(host, protocol, pathname, ErrorClass) {
  const normalized = normalizeHost(host);
  const target = `${protocol}//${normalized}${pathname.split(/[?#]/)[0] || "/"}`;
  if (DEBUG || !loggedHosts.has(normalized)) {
    loggedHosts.add(normalized);
    writeLine(
      `[artikin] blocked outbound request to ${target} ` +
        "(Artikin network guard: public package registries are disabled in local servers)",
    );
  }
  const error = new ErrorClass(
    `Blocked outbound request to ${target}: public package registries are disabled in ` +
      "Artikin's local servers (scripts/dev-network-guard.cjs).",
  );
  return Object.assign(error, { code: ERROR_CODE });
}

/** @param {unknown} fn */
function isGuarded(fn) {
  return typeof fn === "function" && Reflect.get(fn, MARKER) === true;
}

/** @param {Function} fn */
function markGuarded(fn) {
  Object.defineProperty(fn, MARKER, { value: true });
}

/**
 * URL that fetch() would request, or null when fetch() itself rejects the input.
 * @param {unknown} input
 * @returns {URL | null}
 */
function fetchTarget(input) {
  try {
    if (input instanceof URL) return input;
    // Request objects (from any realm) carry the URL in `url`; fetch() stringifies anything else.
    const url = typeof input === "object" && input !== null ? Reflect.get(input, "url") : undefined;
    return new URL(typeof url === "string" ? url : String(input));
  } catch {
    return null;
  }
}

function guardFetch() {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function" || isGuarded(originalFetch)) return;
  /**
   * @this {unknown}
   * @param {...unknown} args
   */
  const guardedFetch = function fetch(...args) {
    const url = fetchTarget(args[0]);
    if (url !== null && isBlockedHost(url.hostname)) {
      return Promise.reject(blockedError(url.hostname, url.protocol, url.pathname, TypeError));
    }
    return Reflect.apply(originalFetch, this, args);
  };
  markGuarded(guardedFetch);
  globalThis.fetch = /** @type {typeof fetch} */ (/** @type {unknown} */ (guardedFetch));
}

/**
 * Node.js' own URL detection for http(s).request(): a WHATWG URL or a URL-like object.
 * @param {unknown} value
 * @returns {value is URL}
 */
function isUrlLike(value) {
  if (typeof value !== "object" || value === null) return false;
  return Boolean(
    Reflect.get(value, "href") &&
    Reflect.get(value, "protocol") &&
    Reflect.get(value, "auth") === undefined &&
    Reflect.get(value, "path") === undefined,
  );
}

/**
 * Reads http(s).request()/get() arguments the way Node.js does: `(url[, options][, callback])`
 * or `(options[, callback])`. Returns null for arguments Node.js would reject, so the original
 * function reports the error.
 * @param {unknown[]} args
 * @returns {{ options: Record<string, unknown>, callback: Function | undefined } | null}
 */
function requestArguments(args) {
  try {
    const rest = [...args];
    /** @type {Record<string, unknown>} */
    let options = {};
    const first = rest[0];
    if (typeof first === "string") {
      options = { ...urlToHttpOptions(new URL(first)) };
      rest.shift();
    } else if (isUrlLike(first)) {
      options = { ...urlToHttpOptions(first) };
      rest.shift();
    }
    if (rest[0] && typeof rest[0] !== "function") {
      options = Object.assign(options, rest.shift());
    }
    const callback = typeof rest[0] === "function" ? rest[0] : undefined;
    return { options, callback };
  } catch {
    return null;
  }
}

/**
 * @param {typeof http | typeof https} httpModule
 * @param {"http:" | "https:"} defaultProtocol
 */
function guardHttpModule(httpModule, defaultProtocol) {
  const originalRequest = httpModule.request;
  const originalGet = httpModule.get;
  if (isGuarded(originalRequest)) return;

  /**
   * A request that fails instead of connecting, or null when the target is not blocked.
   * @param {unknown[]} args
   * @returns {http.ClientRequest | null}
   */
  function blockedRequest(args) {
    const parsed = requestArguments(args);
    if (parsed === null) return null;
    const { options, callback } = parsed;
    // Unix sockets and named pipes are local, whatever `host` says.
    if (typeof options.socketPath === "string" && options.socketPath !== "") return null;
    const host =
      (typeof options.hostname === "string" && options.hostname) ||
      (typeof options.host === "string" && options.host) ||
      "localhost";
    if (!isBlockedHost(host)) return null;
    const protocol =
      typeof options.protocol === "string" && options.protocol ? options.protocol : defaultProtocol;
    const pathname = typeof options.path === "string" ? options.path : "/";
    const error = blockedError(host, protocol, pathname, Error);
    // A per-request agent whose connection fails at once: no DNS lookup, no socket. The request
    // then emits `error` asynchronously, like any other network failure.
    const agent = new httpModule.Agent();
    agent.createConnection = (_connectOptions, onCreate) => {
      if (onCreate) onCreate(error, /** @type {never} */ (undefined));
      return undefined;
    };
    return new http.ClientRequest(
      /** @type {http.ClientRequestArgs} */ ({ ...options, protocol, agent }),
      /** @type {((response: http.IncomingMessage) => void) | undefined} */ (callback),
    );
  }

  /**
   * @this {unknown}
   * @param {...unknown} args
   */
  const request = function request(...args) {
    return blockedRequest(args) ?? Reflect.apply(originalRequest, this, args);
  };
  /**
   * @this {unknown}
   * @param {...unknown} args
   */
  const get = function get(...args) {
    const blocked = blockedRequest(args);
    if (blocked === null) return Reflect.apply(originalGet, this, args);
    blocked.end();
    return blocked;
  };
  markGuarded(request);
  markGuarded(get);
  Object.assign(httpModule, { request, get });
}

/**
 * NODE_OPTIONS names this file relative to the working directory; a child process started in
 * another directory could not load it. Point descendants at the absolute path instead.
 */
function pinPreloadPath() {
  const nodeOptions = process.env.NODE_OPTIONS;
  if (!nodeOptions) return;
  const absolute = __filename.replace(/\\/g, "/");
  const replacement = /\s/.test(absolute) ? JSON.stringify(absolute) : absolute;
  const sameFile = (/** @type {string} */ file) =>
    process.platform === "win32"
      ? path.resolve(file).toLowerCase() === __filename.toLowerCase()
      : path.resolve(file) === __filename;
  const updated = nodeOptions.replace(
    /(--require[=\s]+|-r\s+)([^\s"']*dev-network-guard\.cjs)(?=\s|$)/g,
    (match, flag, file) => (sameFile(file) ? `${flag}${replacement}` : match),
  );
  if (updated !== nodeOptions) process.env.NODE_OPTIONS = updated;
}

function install() {
  if (Reflect.get(globalThis, MARKER) === true) return;
  Object.defineProperty(globalThis, MARKER, { value: true });
  pinPreloadPath();
  guardFetch();
  guardHttpModule(http, "http:");
  guardHttpModule(https, "https:");
  // ESM `import { request } from "node:https"` must see the guarded functions too.
  syncBuiltinESMExports();
  if (DEBUG) {
    const entry = process.argv[1] ? `, ${path.basename(process.argv[1])}` : "";
    writeLine(`[artikin] dev network guard active (pid ${process.pid}${entry})`);
  }
}

install();

module.exports = { BLOCKED_HOSTS, ERROR_CODE };
