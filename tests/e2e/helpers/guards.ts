import type { BrowserContext, Page } from "@playwright/test";

/**
 * OBS-01 — collects console errors and uncaught page errors. The `page` fixture fails the test
 * at teardown when an error is not on the allowlist; tests that provoke an error on purpose call
 * `consoleGuard.allow(/…/)` first.
 */
export class ConsoleGuard {
  private readonly allowed: RegExp[] = [
    // Software-WebGL driver notices caused by pixel reads (Q-00b spike).
    /GPU stall due to ReadPixels/i,
    /GL Driver Message/i,
  ];

  readonly messages: string[] = [];

  attach(page: Page): void {
    page.on("console", (message) => {
      if (message.type() === "error") this.messages.push(`console.error: ${message.text()}`);
    });
    page.on("pageerror", (error) => this.messages.push(`pageerror: ${error.message}`));
  }

  allow(...patterns: RegExp[]): void {
    this.allowed.push(...patterns);
  }

  unexpected(): string[] {
    return this.messages.filter((message) => !this.allowed.some((pattern) => pattern.test(message)));
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalUrl(url: URL): boolean {
  if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") return true;
  return LOCAL_HOSTS.has(url.hostname);
}

/**
 * CMP-05 — aborts and records every browser request or WebSocket to a host other than localhost
 * (fonts, CDNs, analytics, telemetry…). The `context` fixture fails the test if any was attempted.
 */
export class NetworkGuard {
  readonly blocked: string[] = [];

  async attach(context: BrowserContext): Promise<void> {
    await context.route(
      (url) => !isLocalUrl(url),
      async (route) => {
        const url = new URL(route.request().url());
        this.blocked.push(`${route.request().method()} ${url.origin}${url.pathname}`);
        await route.abort("blockedbyclient");
      },
    );
    await context.routeWebSocket(
      (url) => !isLocalUrl(url),
      (socket) => {
        const url = new URL(socket.url());
        this.blocked.push(`WebSocket ${url.origin}${url.pathname}`);
        void socket.close();
      },
    );
  }
}
