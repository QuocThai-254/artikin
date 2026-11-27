import { describe, expect, it, vi } from "vitest";

import { createWorkspaceApiClient, isWorkspaceApiError, WorkspaceApiError } from "./api-client";

const SUMMARY = {
  id: "6f0c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f",
  name: "Fight scene",
  thumbnail: null,
  createdAt: "2026-11-26T05:00:00.000Z",
  updatedAt: "2026-11-26T05:00:01.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("workspace API client", () => {
  it("sends JSON requests and unwraps the workspace", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ workspace: SUMMARY }, 201));
    const client = createWorkspaceApiClient({ fetch: fetchMock });

    await expect(client.create({ name: "Fight scene" })).resolves.toEqual(SUMMARY);
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Fight scene" }),
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it("passes keepalive and abort signals and encodes ids", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ workspace: SUMMARY }));
    const client = createWorkspaceApiClient({ fetch: fetchMock });
    const controller = new AbortController();

    await client.update("a/b", { name: "x" }, { signal: controller.signal, keepalive: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/a%2Fb",
      expect.objectContaining({ method: "PATCH", signal: controller.signal, keepalive: true }),
    );
  });

  it("resolves DELETE's 204 without a body", async () => {
    const client = createWorkspaceApiClient({
      fetch: vi.fn(async () => new Response(null, { status: 204 })),
    });
    await expect(client.remove(SUMMARY.id)).resolves.toBeUndefined();
  });

  it("throws typed errors with conflict and limit details", async () => {
    const conflict = createWorkspaceApiClient({
      fetch: vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "CONFLICT",
              message: "Changed elsewhere.",
              details: { updatedAt: SUMMARY.updatedAt },
            },
          },
          409,
        ),
      ),
    });
    const error = await conflict
      .update(SUMMARY.id, { name: "x" })
      .catch((caught: unknown) => caught);
    expect(isWorkspaceApiError(error, "CONFLICT")).toBe(true);
    expect(error).toMatchObject({ status: 409, message: "Changed elsewhere." });
    expect((error as WorkspaceApiError).currentUpdatedAt).toBe(SUMMARY.updatedAt);

    const limited = createWorkspaceApiClient({
      fetch: vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "WORKSPACE_LIMIT_REACHED",
              message: "Limit.",
              details: { limit: 5, count: 5 },
            },
          },
          409,
        ),
      ),
    });
    const limitError = await limited.create().catch((caught: unknown) => caught);
    expect((limitError as WorkspaceApiError).limit).toBe(5);
  });

  it("maps unreadable errors and network failures, but re-throws aborts", async () => {
    const gateway = createWorkspaceApiClient({
      fetch: vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })),
    });
    await expect(gateway.list()).rejects.toMatchObject({ code: "UNKNOWN", status: 502 });

    const offline = createWorkspaceApiClient({
      fetch: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    await expect(offline.list()).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });

    const abort = new DOMException("The operation was aborted.", "AbortError");
    const aborted = createWorkspaceApiClient({
      fetch: vi.fn(async () => {
        throw abort;
      }),
    });
    await expect(aborted.list()).rejects.toBe(abort);
  });
});
