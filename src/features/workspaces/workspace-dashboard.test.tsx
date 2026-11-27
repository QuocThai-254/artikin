import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceSummary } from "./contract";
import { WorkspaceDashboard } from "./workspace-dashboard";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
  api: { create: vi.fn(), update: vi.fn(), remove: vi.fn(), duplicate: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

vi.mock("./api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api-client")>()),
  workspaceApi: mocks.api,
}));

// Client renders read the real clock (`useClock`), so fixtures are relative to now.
const NOW = Date.now();

function summary(index: number, overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    id: `00000000-0000-4000-8000-00000000000${index}`,
    name: `Scene ${index}`,
    thumbnail: null,
    createdAt: "2026-11-20T05:00:00.000Z",
    updatedAt: new Date(NOW - index * 5 * 60_000).toISOString(),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeAll(() => {
  // Radix primitives rely on browser APIs jsdom lacks.
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => undefined;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  for (const fn of [...Object.values(mocks.router), ...Object.values(mocks.api)]) fn.mockReset();
});

async function openCardMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  const card = screen
    .getAllByTestId("workspace-card")
    .find((element) => within(element).queryByText(name));
  if (!card) throw new Error(`no card named ${name}`);
  await user.click(within(card).getByTestId("workspace-card-menu"));
  return card;
}

describe("WorkspaceDashboard", () => {
  it("shows cards, usage and relative times", () => {
    render(
      <WorkspaceDashboard
        workspaces={[
          summary(1, { thumbnail: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" }),
          summary(2),
        ]}
        limit={5}
        renderedAt={NOW}
      />,
    );
    const usage = screen.getByTestId("workspace-usage");
    expect(usage).toHaveTextContent("2 / 5");
    expect(usage).toHaveAttribute("data-count", "2");
    expect(usage).toHaveAttribute("data-limit", "5");
    expect(screen.getByTestId("workspace-new")).toBeEnabled();
    expect(screen.queryByTestId("workspace-limit-message")).not.toBeInTheDocument();

    const cards = screen.getAllByTestId("workspace-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("data-workspace-id", summary(1).id);
    expect(within(cards[0] as HTMLElement).getByTestId("workspace-card-open")).toHaveAttribute(
      "href",
      `/editor/${summary(1).id}`,
    );
    expect(within(cards[0] as HTMLElement).getByTestId("workspace-card-updated")).toHaveTextContent(
      /^Edited \d+ min ago$/,
    );
    const thumbnail = within(cards[0] as HTMLElement).getByTestId("workspace-card-thumbnail");
    expect(thumbnail.querySelector("img")).toHaveAttribute("alt", "");
    expect(thumbnail.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(within(cards[1] as HTMLElement).getByTestId("workspace-card-thumbnail")).toHaveAttribute(
      "data-placeholder",
    );
  });

  it("disables creating and duplicating at the limit and says why", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceDashboard
        workspaces={[1, 2, 3, 4, 5].map((index) => summary(index))}
        limit={5}
        renderedAt={NOW}
      />,
    );
    expect(screen.getByTestId("workspace-usage")).toHaveTextContent("5 / 5");
    expect(screen.getByTestId("workspace-new")).toBeDisabled();
    expect(screen.getByTestId("workspace-limit-message")).toHaveTextContent(
      "5 / 5 workspaces used — delete one to create another.",
    );
    await openCardMenu(user, "Scene 1");
    expect(await screen.findByTestId("workspace-duplicate")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("teaches the empty state with the server's quota", () => {
    render(<WorkspaceDashboard workspaces={[]} limit={2} renderedAt={NOW} />);
    expect(screen.getByTestId("workspace-empty")).toHaveTextContent("You can keep up to 2.");
    expect(screen.getByTestId("workspace-usage")).toHaveTextContent("0 / 2");
    expect(screen.queryByTestId("workspace-grid")).not.toBeInTheDocument();
  });

  it("creates a workspace and opens it in the editor", async () => {
    mocks.api.create.mockResolvedValue(summary(7));
    const user = userEvent.setup();
    render(<WorkspaceDashboard workspaces={[]} limit={5} renderedAt={NOW} />);
    await user.click(screen.getByTestId("workspace-new"));
    expect(mocks.router.push).toHaveBeenCalledWith(`/editor/${summary(7).id}`);
  });

  it("validates and applies a rename optimistically", async () => {
    const pending = deferred<WorkspaceSummary>();
    mocks.api.update.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<WorkspaceDashboard workspaces={[summary(1)]} limit={5} renderedAt={NOW} />);

    await openCardMenu(user, "Scene 1");
    await user.click(await screen.findByTestId("workspace-rename"));
    const input = await screen.findByTestId("workspace-name-input");
    expect(input).toHaveValue("Scene 1");

    await user.clear(input);
    await user.type(input, "n".repeat(61));
    expect(screen.getByText("Use 60 characters or fewer.")).toBeInTheDocument();
    await user.click(screen.getByTestId("workspace-dialog-submit"));
    expect(mocks.api.update).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "  Fight scene ");
    await user.click(screen.getByTestId("workspace-dialog-submit"));
    expect(mocks.api.update).toHaveBeenCalledWith(summary(1).id, { name: "Fight scene" });
    expect(await screen.findByTestId("workspace-card-name")).toHaveTextContent("Fight scene");

    await act(async () => pending.resolve({ ...summary(1), name: "Fight scene" }));
    await waitFor(() => expect(mocks.router.refresh).toHaveBeenCalled());
  });

  it("deletes after confirmation, removing the card optimistically", async () => {
    const pending = deferred<void>();
    mocks.api.remove.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<WorkspaceDashboard workspaces={[summary(1), summary(2)]} limit={5} renderedAt={NOW} />);

    await openCardMenu(user, "Scene 2");
    await user.click(await screen.findByTestId("workspace-delete"));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Delete “Scene 2”?");
    await user.click(screen.getByTestId("workspace-delete-confirm"));

    expect(mocks.api.remove).toHaveBeenCalledWith(summary(2).id);
    await waitFor(() => expect(screen.getAllByTestId("workspace-card")).toHaveLength(1));
    expect(screen.getByTestId("workspace-usage")).toHaveTextContent("1 / 5");
    await act(async () => pending.resolve());
    await waitFor(() => expect(mocks.router.refresh).toHaveBeenCalled());
  });

  it("keeps the workspace when deletion is cancelled", async () => {
    const user = userEvent.setup();
    render(<WorkspaceDashboard workspaces={[summary(1)]} limit={5} renderedAt={NOW} />);
    await openCardMenu(user, "Scene 1");
    await user.click(await screen.findByTestId("workspace-delete"));
    await user.click(await screen.findByTestId("workspace-dialog-cancel"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mocks.api.remove).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("workspace-card")).toHaveLength(1);
  });
});
