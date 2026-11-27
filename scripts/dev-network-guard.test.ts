import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The guard patches process globals, so every scenario runs in a child Node.js process. Each
 * network scenario first installs NETWORK_TRAP: a TCP/TLS connection to any non-local host throws
 * and is recorded, so these tests cannot reach the network even if the guard is broken. Host names
 * come from the guard's own BLOCKED_HOSTS list.
 */

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const GUARD_PATH = fileURLToPath(new URL("./dev-network-guard.cjs", import.meta.url));
const ERROR_CODE = "ERR_ARTIKIN_NETWORK_BLOCKED";
const BLOCKED_LINE =
  /^\[artikin\] blocked outbound request to (\S+) \(Artikin network guard: public package registries are disabled in local servers\)$/;
/** What the npm scripts put in front of the caller's NODE_OPTIONS. */
const PRELOAD = "--require=./scripts/dev-network-guard.cjs";
/** The same entry after the guard pinned it to its absolute path (quoted if the path has spaces). */
const PINNED_PRELOAD = String.raw`--require=(?:"[^"]*/scripts/dev-network-guard\.cjs"|\S*/scripts/dev-network-guard\.cjs)`;

const NETWORK_TRAP = String.raw`
const net = require("node:net");
const attempts = [];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  let host = "localhost";
  if (first && typeof first === "object") host = first.path ? "localhost" : String(first.host || "localhost");
  else if (typeof args[1] === "string") host = args[1];
  if (!LOCAL_HOSTS.has(host.replace(/^\[|\]$/g, ""))) {
    attempts.push(host);
    throw new Error("network trap: unexpected connection to " + host);
  }
  return Reflect.apply(originalConnect, this, args);
};
`;

/** Fake fetch/http(s) functions stand in for the real ones; the guard is installed on top. */
const FAKES_SCENARIO = String.raw`
const http = require("node:http");
const https = require("node:https");
const calls = [];
const fake = (api) => function (...args) {
  calls.push({ api, args });
  return api === "fetch" ? Promise.resolve("passed through") : "passed through";
};
globalThis.fetch = fake("fetch");
for (const [name, mod] of [["http", http], ["https", https]]) {
  mod.request = fake(name + ".request");
  mod.get = fake(name + ".get");
}
const { BLOCKED_HOSTS } = require(process.env.GUARD_PATH);

const settle = (promise) =>
  promise.then((value) => ({ value }), (error) => ({ error: error.name + ":" + error.code }));
const requestOutcome = (start) =>
  new Promise((resolve) => {
    let responded = false;
    const req = start(() => (responded = true));
    if (typeof req?.on !== "function") return resolve({ value: req });
    const timer = setTimeout(() => resolve({ timeout: true }), 2000);
    req.on("error", (error) => {
      clearTimeout(timer);
      resolve({ error: error.name + ":" + error.code, socket: req.socket ?? null, responded });
    });
    if (!req.writableEnded) req.end();
  });

(async () => {
  const [host] = BLOCKED_HOSTS;
  const result = { blockedHosts: BLOCKED_HOSTS, attempts };

  result.blockedFetch = [];
  for (const blocked of BLOCKED_HOSTS) {
    result.blockedFetch.push(await settle(fetch("https://" + blocked + "/-/package/next/dist-tags")));
    result.blockedFetch.push(await settle(fetch(new URL("http://" + blocked.toUpperCase() + ".:80/x?token=secret"))));
    result.blockedFetch.push(await settle(fetch(new Request("https://" + blocked + "/react?token=secret#fragment"))));
    result.blockedFetch.push(await settle(fetch("https://user:password@" + blocked + "/react")));
  }

  result.passthroughFetch = [];
  for (const [input, init] of [
    ["https://fonts.googleapis.com/css2?display=swap", { method: "GET" }],
    [new URL("https://" + host + ".example.com/lookalike"), undefined],
    ["/relative", undefined],
  ]) {
    const before = calls.length;
    const value = await fetch(input, init);
    const call = calls[before];
    result.passthroughFetch.push({
      value,
      sameArguments: calls.length === before + 1 && call.api === "fetch" && call.args.length === 2 &&
        call.args[0] === input && call.args[1] === init,
    });
  }

  result.blockedHttp = [
    await requestOutcome((onResponse) => https.get("https://" + host + "/react", onResponse)),
    await requestOutcome(() => https.request({ hostname: host, path: "/pkg?secret=1" })),
    await requestOutcome((onResponse) => http.request(new URL("http://" + host + "/z"), { method: "HEAD" }, onResponse)),
    await requestOutcome(() => https.request("https://example.com/", { hostname: host })),
    await requestOutcome(() => http.get({ host: host.toUpperCase() + ":80", path: "/" })),
  ];

  result.passthroughHttp = [
    ["https.request", () => https.request("https://" + host + "/", { hostname: "localhost" })],
    ["http.get", () => http.get({ socketPath: "/tmp/artikin.sock", host })],
    ["http.get", () => http.get("http://localhost:1/")],
    ["https.get", () => https.get("not a url")],
  ].map(([api, start]) => {
    const before = calls.length;
    const value = start();
    return { value, sameApi: calls.length === before + 1 && calls[before].api === api };
  });

  result.calls = calls.map((call) => call.api);
  process.stdout.write(JSON.stringify(result));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;

/** The real fetch/http(s) stack with the guard preloaded through NODE_OPTIONS, as npm run dev does. */
const PRELOAD_SCENARIO = String.raw`
const marker = Symbol.for("artikin.devNetworkGuard");
// Checked before this script loads the guard itself (to read BLOCKED_HOSTS).
const preloaded = globalThis.fetch[marker] === true;
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { BLOCKED_HOSTS } = require(process.env.GUARD_PATH);

(async () => {
  const [host] = BLOCKED_HOSTS;
  const result = {
    attempts,
    host,
    preloaded,
    requestGuarded: https.request[marker] === true && http.get[marker] === true,
  };
  const started = performance.now();
  result.blockedFetch = await fetch("https://" + host + "/-/package/next/dist-tags").then(
    () => "resolved",
    (error) => error.code,
  );
  result.blockedFetchMs = performance.now() - started;
  result.blockedGet = await new Promise((resolve) => {
    https.get("https://" + host + "/react", () => resolve("response")).on("error", (error) => resolve(error.code));
  });
  result.localFetch = await fetch(process.env.LOCAL_URL).then(async (response) => response.status + " " + (await response.text()));
  result.localGet = await new Promise((resolve, reject) => {
    http.get(process.env.LOCAL_URL, (response) => {
      let body = "";
      response.setEncoding("utf8").on("data", (chunk) => (body += chunk)).on("end", () => resolve(response.statusCode + " " + body));
    }).on("error", reject);
  });
  result.nodeOptions = process.env.NODE_OPTIONS;
  // A descendant started in another directory still loads the guard.
  const grandchild = spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(String(globalThis.fetch[Symbol.for('artikin.devNetworkGuard')] === true))"],
    { cwd: os.tmpdir(), env: process.env, encoding: "utf8" },
  );
  result.grandchild = { status: grandchild.status, stdout: grandchild.stdout, stderr: grandchild.stderr };
  process.stdout.write(JSON.stringify(result));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;

interface Outcome {
  value?: string;
  error?: string;
  socket?: null;
  responded?: boolean;
  timeout?: boolean;
}

interface FakesResult {
  blockedHosts: string[];
  attempts: string[];
  blockedFetch: Outcome[];
  passthroughFetch: { value: string; sameArguments: boolean }[];
  blockedHttp: Outcome[];
  passthroughHttp: { value: string; sameApi: boolean }[];
  calls: string[];
}

interface PreloadResult {
  attempts: string[];
  host: string;
  preloaded: boolean;
  requestGuarded: boolean;
  blockedFetch: string;
  blockedFetchMs: number;
  blockedGet: string;
  localFetch: string;
  localGet: string;
  nodeOptions: string;
  grandchild: { status: number | null; stdout: string; stderr: string };
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GUARD_PATH, ...extra };
  for (const name of ["NODE_OPTIONS", "ARTIKIN_NETWORK_GUARD_DEBUG", "NODE_USE_ENV_PROXY"]) {
    if (!(name in extra)) delete env[name];
  }
  return env;
}

function collect(child: ChildProcess): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function runNode(script: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
  return collect(
    spawn(process.execPath, ["-e", script], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

/** Runs a command line through the platform shell (cmd.exe or sh), as npm runs scripts. */
function runShell(commandLine: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
  return collect(
    spawn(commandLine, { cwd: PROJECT_ROOT, env, shell: true, stdio: ["ignore", "pipe", "pipe"] }),
  );
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}

function npmScript(name: string): string {
  const manifest: { scripts: Record<string, string> } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  return manifest.scripts[name] ?? "";
}

describe("dev network guard", () => {
  let server: Server;
  let localUrl = "";

  beforeAll(async () => {
    server = createServer((_request, response) => response.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
    localUrl = `http://localhost:${(server.address() as AddressInfo).port}/ok`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("is preloaded by npm run dev, build and start, keeping NODE_OPTIONS set by the caller", async () => {
    const env = childEnv({
      NODE_OPTIONS: "--max-old-space-size=512",
      ARTIKIN_NETWORK_GUARD_DEBUG: "1",
    });
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = [path.join(PROJECT_ROOT, "node_modules", ".bin"), env[pathKey]].join(
      path.delimiter,
    );

    await Promise.all(
      ["dev", "build", "start"].map(async (name) => {
        const script = npmScript(name);
        expect(script, name).toContain("NEXT_TELEMETRY_DISABLED=1");
        if (name !== "build") {
          expect(script, name).toMatch(new RegExp(String.raw`\bnext ${name} -H localhost\b`));
        }

        // The script's environment prefix through the real shell and cross-env, with a command
        // that prints the NODE_OPTIONS Next.js would start with.
        const nextAt = script.search(/\bnext (?:dev|build|start)\b/);
        expect(nextAt, name).toBeGreaterThan(0);
        const run = await runShell(
          `${script.slice(0, nextAt)}node -p process.env.NODE_OPTIONS`,
          env,
        );
        expect(run.code, run.stderr).toBe(0);
        expect(run.stdout.trim(), name).toMatch(
          new RegExp(String.raw`^${PINNED_PRELOAD}\s+--max-old-space-size=512$`),
        );
        expect(run.stderr, name).toMatch(/\[artikin\] dev network guard active \(pid \d+/);
      }),
    );
  });

  it("fails registry requests without calling the real fetch or http(s) functions", async () => {
    const run = await runNode(NETWORK_TRAP + FAKES_SCENARIO, childEnv({}));
    expect(run.stderr.replace(/^\[artikin\].*$/gm, "").trim()).toBe("");
    expect(run.code).toBe(0);
    const result: FakesResult = JSON.parse(run.stdout);

    expect(result.blockedHosts.length).toBeGreaterThanOrEqual(2);
    expect(result.blockedFetch).toHaveLength(result.blockedHosts.length * 4);
    for (const outcome of result.blockedFetch) {
      expect(outcome).toEqual({ error: `TypeError:${ERROR_CODE}` });
    }
    for (const outcome of result.blockedHttp) {
      expect(outcome).toEqual({ error: `Error:${ERROR_CODE}`, socket: null, responded: false });
    }
    // Every other request reaches the original function with the very same arguments.
    for (const outcome of result.passthroughFetch) {
      expect(outcome).toEqual({ value: "passed through", sameArguments: true });
    }
    for (const outcome of result.passthroughHttp) {
      expect(outcome).toEqual({ value: "passed through", sameApi: true });
    }
    expect(result.calls).toEqual([
      "fetch",
      "fetch",
      "fetch",
      "https.request",
      "http.get",
      "http.get",
      "https.get",
    ]);
    expect(result.attempts).toEqual([]);

    // One log line per blocked host, without credentials, query or fragment.
    const logged = lines(run.stderr).map((line) => BLOCKED_LINE.exec(line)?.[1]);
    expect(logged).toEqual(
      result.blockedHosts.map((host) => `https://${host}/-/package/next/dist-tags`),
    );
    expect(run.stderr).not.toMatch(/secret|password|token|fragment/);
  });

  it("works as the NODE_OPTIONS preload with the real network stack and child processes", async () => {
    const run = await runNode(
      NETWORK_TRAP + PRELOAD_SCENARIO,
      childEnv({
        NODE_OPTIONS: PRELOAD,
        ARTIKIN_NETWORK_GUARD_DEBUG: "1",
        LOCAL_URL: localUrl,
      }),
    );
    expect(run.code, run.stderr).toBe(0);
    const result: PreloadResult = JSON.parse(run.stdout);

    expect(result.preloaded).toBe(true);
    expect(result.requestGuarded).toBe(true);
    expect(result.blockedFetch).toBe(ERROR_CODE);
    expect(result.blockedFetchMs).toBeLessThan(1000);
    expect(result.blockedGet).toBe(ERROR_CODE);
    expect(result.attempts).toEqual([]);
    expect(result.localFetch).toBe("200 ok");
    expect(result.localGet).toBe("200 ok");

    // Descendants get the absolute path, so they load the guard from any working directory.
    expect(result.nodeOptions).toMatch(new RegExp(`^${PINNED_PRELOAD}$`));
    expect(result.nodeOptions).not.toContain("./scripts");
    expect(result.grandchild).toMatchObject({ status: 0, stdout: "true" });
    expect(result.grandchild.stderr).toMatch(/\[artikin\] dev network guard active \(pid \d+/);

    const stderr = lines(run.stderr);
    expect(stderr.filter((line) => line.includes("dev network guard active"))).toHaveLength(1);
    // Debug mode logs every blocked request, not only the first one per host.
    expect(stderr.map((line) => BLOCKED_LINE.exec(line)?.[1]).filter(Boolean)).toEqual([
      `https://${result.host}/-/package/next/dist-tags`,
      `https://${result.host}/react`,
    ]);
  });
});
