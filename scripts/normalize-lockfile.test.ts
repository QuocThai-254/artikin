import { describe, expect, it } from "vitest";

import { PUBLIC_REGISTRY, findOffenders, normalizeLockfileText } from "./normalize-lockfile.mjs";

const MIRROR = "https://registry-proxy.example/npm/registry/";

type Entry = Record<string, unknown>;

/** Lockfile v3 text in npm's own format (2-space indent, trailing newline). */
function lockfileText(packages: Record<string, Entry>): string {
  const lock = {
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: "fixture", version: "1.0.0" }, ...packages },
  };
  return `${JSON.stringify(lock, null, 2)}\n`;
}

function packagesOf(text: string): Record<string, Entry> {
  const lock: unknown = JSON.parse(text);
  if (typeof lock !== "object" || lock === null || !("packages" in lock)) {
    throw new Error("lockfile without packages");
  }
  return lock.packages as Record<string, Entry>;
}

describe("normalize-lockfile", () => {
  const mirrored = lockfileText({
    "node_modules/zod": {
      version: "4.6.7",
      resolved: `${MIRROR}zod/-/zod-4.6.7.tgz`,
      integrity: "sha512-zod",
    },
    "node_modules/@types/node": {
      version: "24.19.2",
      resolved: `${MIRROR}@types%2fnode/-/node-24.19.2.tgz`,
      integrity: "sha512-types-node",
      dev: true,
    },
    "node_modules/string-width-cjs": {
      name: "string-width",
      version: "4.2.3",
      resolved: `${MIRROR}string-width/-/string-width-4.2.3.tgz?token=abc`,
      integrity: "sha512-string-width",
    },
    "node_modules/debug/node_modules/ms": {
      version: "2.1.3",
      resolved: "http://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
      integrity: "sha512-ms",
    },
    "node_modules/react": {
      version: "19.3.1",
      resolved: `${PUBLIC_REGISTRY}react/-/react-19.3.1.tgz`,
      integrity: "sha512-react",
    },
  }).replaceAll("\n", "\r\n");

  it("rewrites registry tarballs on other hosts and keeps integrity and formatting", () => {
    const result = normalizeLockfileText(mirrored);

    expect(result.rewritten).toBe(4);
    expect(result.remaining).toEqual([]);
    const packages = packagesOf(result.text);
    expect(packages["node_modules/zod"]?.resolved).toBe(`${PUBLIC_REGISTRY}zod/-/zod-4.6.7.tgz`);
    expect(packages["node_modules/@types/node"]?.resolved).toBe(
      `${PUBLIC_REGISTRY}@types/node/-/node-24.19.2.tgz`,
    );
    expect(packages["node_modules/string-width-cjs"]?.resolved).toBe(
      `${PUBLIC_REGISTRY}string-width/-/string-width-4.2.3.tgz`,
    );
    expect(packages["node_modules/debug/node_modules/ms"]?.resolved).toBe(
      `${PUBLIC_REGISTRY}ms/-/ms-2.1.3.tgz`,
    );

    const integrity = (text: string) =>
      Object.values(packagesOf(text)).map((entry) => entry.integrity);
    expect(integrity(result.text)).toEqual(integrity(mirrored));
    expect(result.text.split("\r\n")).toHaveLength(mirrored.split("\r\n").length);
    expect(result.text.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("is idempotent", () => {
    const once = normalizeLockfileText(mirrored).text;
    const twice = normalizeLockfileText(once);
    expect(twice.rewritten).toBe(0);
    expect(twice.text).toBe(once);
    expect(findOffenders(JSON.parse(once))).toEqual([]);
  });

  it("reports URLs that are not registry tarballs and allows local paths", () => {
    const input = lockfileText({
      "node_modules/private-tool": {
        version: "1.0.0",
        resolved: "git+ssh://git@git.example/tools/private-tool.git#0123456789abcdef",
      },
      "node_modules/vendored": {
        version: "2.0.0",
        resolved: "https://downloads.example/vendored.tgz",
        integrity: "sha512-vendored",
      },
      "node_modules/local-lib": { version: "1.0.0", resolved: "file:../local-lib" },
      "node_modules/app": { resolved: "packages/app", link: true },
      "packages/app": { name: "app", version: "0.0.0" },
    });

    const result = normalizeLockfileText(input);

    expect(result.rewritten).toBe(0);
    expect(result.text).toBe(input);
    expect(result.remaining.map(({ location, publicUrl }) => ({ location, publicUrl }))).toEqual([
      { location: "node_modules/private-tool", publicUrl: null },
      { location: "node_modules/vendored", publicUrl: null },
    ]);
  });

  it("finds offenders in legacy dependency trees, including aliases", () => {
    const lock = {
      lockfileVersion: 2,
      dependencies: {
        zod: {
          version: "4.6.7",
          resolved: `${MIRROR}zod/-/zod-4.6.7.tgz`,
          dependencies: { ms: { version: "2.1.3", resolved: `${MIRROR}ms/-/ms-2.1.3.tgz` } },
        },
        "string-width-cjs": {
          version: "npm:string-width@4.2.3",
          resolved: `${MIRROR}string-width/-/string-width-4.2.3.tgz`,
        },
      },
    };

    expect(findOffenders(lock).map(({ location, publicUrl }) => ({ location, publicUrl }))).toEqual(
      [
        { location: "dependencies > zod", publicUrl: `${PUBLIC_REGISTRY}zod/-/zod-4.6.7.tgz` },
        { location: "dependencies > zod > ms", publicUrl: `${PUBLIC_REGISTRY}ms/-/ms-2.1.3.tgz` },
        {
          location: "dependencies > string-width-cjs",
          publicUrl: `${PUBLIC_REGISTRY}string-width/-/string-width-4.2.3.tgz`,
        },
      ],
    );
  });
});
