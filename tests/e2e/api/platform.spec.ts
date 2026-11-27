import { connect } from "node:net";
import { networkInterfaces } from "node:os";

import { E2E_PORT, RUNTIME } from "../fixtures/runtime";
import { expect, test } from "../fixtures/test";

/** Platform checks: security headers, HTTP methods and localhost-only binding (ARCH §13, CMP-04). */

test.describe("Platform", () => {
  test("SEC-01 security headers on pages and API responses @p0", async ({ request }) => {
    for (const path of ["/", "/editor", "/sign-in", "/workspaces", "/api/workspaces", "/api/auth/ok"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(headers["x-frame-options"], path).toBe("DENY");
      expect(headers["content-security-policy"], path).toMatch(/frame-ancestors 'none'/);
      expect(headers["permissions-policy"], path).toMatch(/camera=\(\)/);
      expect(headers["x-powered-by"], path).toBeUndefined();
      // ADR-049: production builds only — two years, subdomains, no preload; `next dev` never sends it.
      if (RUNTIME.serverMode === "prod") {
        expect(headers["strict-transport-security"], path).toBe("max-age=63072000; includeSubDomains");
      } else {
        expect(headers["strict-transport-security"], path).toBeUndefined();
      }
    }
  });

  test("SEC-13 unsupported methods are 405 and HEAD/OPTIONS never fail @p0", async ({ signedInApi }) => {
    const { api } = signedInApi;
    const workspace = await api.create();
    expect((await api.raw("PUT", "/api/workspaces", { data: {} })).status()).toBe(405);
    expect((await api.raw("PUT", `/api/workspaces/${workspace.id}`, { data: {} })).status()).toBe(405);
    for (const method of ["HEAD", "OPTIONS"]) {
      for (const path of ["/api/workspaces", `/api/workspaces/${workspace.id}`]) {
        expect((await api.raw(method, path)).status(), `${method} ${path}`).toBeLessThan(500);
      }
    }
  });

  test("CMP-04 the E2E server is not reachable from the network @p0", async () => {
    test.skip(RUNTIME.external, "Checks the server Playwright started on localhost:3100.");
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((address) => address !== undefined && !address.internal)
      .map((address) => address?.address ?? "");
    const reachable: string[] = [];
    for (const host of addresses) {
      const connected = await new Promise<boolean>((resolve) => {
        const socket = connect({ host, port: E2E_PORT });
        const done = (result: boolean) => {
          socket.destroy();
          resolve(result);
        };
        socket.setTimeout(1500, () => done(false));
        socket.once("connect", () => done(true));
        socket.once("error", () => done(false));
      });
      if (connected) reachable.push(host);
    }
    expect(reachable, "non-loopback addresses that accept connections on the E2E port").toEqual([]);
  });
});
