import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAuthHintStateForTests } from "@/components/auth-switch";
import { FigurePresetApiError } from "@/features/figure-presets/api-client";
import type { CreateFigurePresetBody, FigurePreset } from "@/features/figure-presets/contract";
import { AUTH_HINT_COOKIE } from "@/lib/auth/auth-hint";
import { getBodyPreset } from "@/lib/mannequin/presets/body";
import { type FigurePresetData, parseFigurePresetData } from "@/lib/mannequin/presets/figure-preset";
import { POSE_CROUCH } from "@/lib/mannequin/presets/pose";

import { useEditorShortcuts } from "../../hooks/use-editor-shortcuts";
import { EditorStoreProvider } from "../../store/context";
import { createEditorStore } from "../../store/editor-store";
import { AddFigureDialog } from "../add-figure-dialog";
import { MyPresetsProvider, createMyPresetsStore } from "./my-presets-store";
import { PresetsPanel } from "./presets-panel";

const CHILD = getBodyPreset("anime-child");
const MODEL_REF = { source: "local", id: "0123456789abcdef".repeat(4), name: "my-figure.vrm", format: "vrm" } as const;

function documentOf(input: Record<string, unknown>): FigurePresetData {
  const result = parseFigurePresetData(input);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const CROUCHING_KID = documentOf({
  version: 1,
  body: { presetId: CHILD.id, proportions: CHILD.proportions, material: { style: "clay", color: "#336699" } },
  pose: { pose: POSE_CROUCH.pose, hips: { orientation: [0, 0, 0] }, grounded: true },
});
const KID_BODY = documentOf({ version: 1, body: CROUCHING_KID.body });

let idCounter = 0;
function stored(name: string, data: FigurePresetData, minute = 0): FigurePreset {
  idCounter += 1;
  const at = new Date(Date.UTC(2026, 10, 27, 9, minute)).toISOString();
  return { id: `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`, name, data, createdAt: at, updatedAt: at };
}

/** In-memory stand-in for `/api/presets` (same answers and errors as the real API). */
function fakeApi(initial: FigurePreset[] = [], limit = 50) {
  let presets = [...initial];
  let clock = 0;
  const now = () => new Date(Date.UTC(2026, 10, 27, 10, 0, (clock += 1))).toISOString();
  return {
    list: vi.fn(async () => ({ presets: [...presets], limit })),
    create: vi.fn(async (body: CreateFigurePresetBody) => {
      if (presets.length >= limit) {
        throw new FigurePresetApiError({
          status: 409,
          code: "PRESET_LIMIT_REACHED",
          message: `You can have up to ${limit} presets. Delete one to save another.`,
          details: { limit, count: presets.length },
        });
      }
      const at = now();
      const preset = { ...stored(body.name, body.data), createdAt: at, updatedAt: at };
      presets = [preset, ...presets];
      return preset;
    }),
    rename: vi.fn(async (presetId: string, body: { name: string }) => {
      const found = presets.find((p) => p.id === presetId);
      if (!found) throw new FigurePresetApiError({ status: 404, code: "NOT_FOUND", message: "Preset not found." });
      const renamed = { ...found, name: body.name, updatedAt: now() };
      presets = presets.map((p) => (p.id === presetId ? renamed : p));
      return renamed;
    }),
    remove: vi.fn(async (presetId: string) => {
      presets = presets.filter((p) => p.id !== presetId);
    }),
  };
}

function setCookie(signedIn: boolean) {
  document.cookie = signedIn
    ? `${AUTH_HINT_COOKIE}=1; path=/`
    : `${AUTH_HINT_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

function Shortcuts() {
  useEditorShortcuts();
  return null;
}

function setup(api = fakeApi(), { addFigure = false, shortcuts = false } = {}) {
  const store = createEditorStore();
  const presets = createMyPresetsStore(api);
  const figure = () => store.getState().scene.mannequins[0];
  const user = userEvent.setup();
  if (addFigure) store.getState().setDialog("addFigure");
  render(
    <EditorStoreProvider value={store}>
      <MyPresetsProvider value={presets}>
        {shortcuts && <Shortcuts />}
        <PresetsPanel />
        <AddFigureDialog />
      </MyPresetsProvider>
    </EditorStoreProvider>,
  );
  return { api, store, presets, figure, user };
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

beforeEach(() => setCookie(true));

afterEach(() => {
  setCookie(false);
  resetAuthHintStateForTests();
});

describe("My presets", () => {
  it("shows guests a sign-in prompt that returns to the editor, without any request", async () => {
    setCookie(false);
    const { api, user } = setup();
    await user.click(screen.getByTestId("presets-tab-mine"));
    const prompt = screen.getByTestId("my-presets-sign-in");
    expect(prompt).toHaveTextContent("Sign in to save your own presets");
    expect(within(prompt).getByTestId("my-presets-sign-in-link")).toHaveAttribute("href", "/sign-in?callbackUrl=%2Feditor");
    expect(within(prompt).getByTestId("my-presets-sign-up-link")).toHaveAttribute("href", "/sign-up?callbackUrl=%2Feditor");
    expect(api.list).not.toHaveBeenCalled();
  });

  it("fetches the list when Mine is first opened and saves the active figure with its pose", async () => {
    const { api, figure, user } = setup();
    expect(api.list).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("presets-tab-mine"));
    expect(await screen.findByTestId("my-presets-empty")).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("my-preset-save-open"));
    const dialog = await screen.findByTestId("my-preset-save-dialog");
    const name = within(dialog).getByTestId("my-preset-name-input");
    expect(name).toHaveValue(figure().name);
    expect(within(dialog).getByTestId("my-preset-include-pose")).toBeChecked();
    await user.clear(name);
    await user.type(name, "  Relaxed hero ");
    await user.click(within(dialog).getByTestId("my-preset-save-submit"));

    await waitFor(() => expect(screen.queryByTestId("my-preset-save-dialog")).not.toBeInTheDocument());
    expect(api.create).toHaveBeenCalledTimes(1);
    const body = api.create.mock.calls[0]?.[0];
    expect(body?.name).toBe("Relaxed hero");
    expect(body?.data.body.presetId).toBe(figure().presetId);
    expect(body?.data.pose?.pose).toEqual(figure().pose);
    expect(body?.data.pose?.grounded).toBe(true);
    expect(JSON.stringify(body?.data)).not.toContain(figure().name);

    const list = screen.getByTestId("my-presets-list");
    expect(within(list).getByRole("button", { name: /Apply Relaxed hero/ })).toBeInTheDocument();
    expect(screen.getByTestId("my-presets-count")).toHaveTextContent("1 / 50");

    // Back and forth between tabs: the list stays in memory.
    await user.click(screen.getByTestId("presets-tab-pose"));
    await user.click(screen.getByTestId("presets-tab-mine"));
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("saves the body only when the pose is left out", async () => {
    const { api, user } = setup();
    await user.click(screen.getByTestId("presets-tab-mine"));
    await user.click(await screen.findByTestId("my-preset-save-open"));
    const dialog = await screen.findByTestId("my-preset-save-dialog");
    await user.click(within(dialog).getByTestId("my-preset-include-pose"));
    await user.click(within(dialog).getByTestId("my-preset-save-submit"));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]?.[0].data.pose).toBeUndefined();
  });

  it("applies a preset to the active figure in one undo step, and not while the pose is locked", async () => {
    const preset = stored("Crouching kid", CROUCHING_KID);
    const { store, figure, user } = setup(fakeApi([preset]));
    await user.click(screen.getByTestId("presets-tab-mine"));
    const apply = await screen.findByTestId(`my-preset-apply-${preset.id}`);
    expect(apply).toHaveAccessibleName(/^Apply Crouching kid/);
    expect(apply.querySelectorAll("svg")).toHaveLength(2);

    const before = figure();
    const steps = store.temporal.getState().pastStates.length;
    await user.click(apply);
    expect(figure()).toMatchObject({ presetId: CHILD.id, material: { style: "clay", color: "#336699" } });
    expect(figure().pose.leftLowerLeg).toEqual(CROUCHING_KID.pose?.pose.leftLowerLeg);
    expect(figure().transform.rotation).toEqual(before.transform.rotation);
    expect(store.temporal.getState().pastStates.length).toBe(steps + 1);

    act(() => store.getState().setLock({ pose: true }));
    expect(screen.getByTestId(`my-preset-apply-${preset.id}`)).toBeDisabled();
  });

  it("renames and deletes a preset, deleting only after confirmation", async () => {
    const preset = stored("Old name", KID_BODY);
    const { api, user } = setup(fakeApi([preset]));
    await user.click(screen.getByTestId("presets-tab-mine"));

    await user.click(await screen.findByTestId(`my-preset-menu-${preset.id}`));
    await user.click(await screen.findByTestId("my-preset-rename"));
    const input = await screen.findByTestId("my-preset-rename-input");
    await user.clear(input);
    await user.type(input, "New name");
    await user.click(screen.getByTestId("my-preset-rename-submit"));
    await waitFor(() => expect(api.rename).toHaveBeenCalledWith(preset.id, { name: "New name" }));
    expect(await screen.findByRole("button", { name: /Apply New name/ })).toBeInTheDocument();

    await user.click(screen.getByTestId(`my-preset-menu-${preset.id}`));
    await user.click(await screen.findByTestId("my-preset-delete"));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Delete “New name”?");
    expect(api.remove).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("my-preset-delete-confirm"));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(preset.id));
    expect(screen.queryByTestId(`my-preset-${preset.id}`)).not.toBeInTheDocument();
    expect(await screen.findByTestId("my-presets-empty")).toBeInTheDocument();
  });

  it("explains the preset limit before and after a refused save", async () => {
    const full = fakeApi([stored("Only one", KID_BODY)], 1);
    const first = setup(full);
    await first.user.click(screen.getByTestId("presets-tab-mine"));
    await first.user.click(await screen.findByTestId("my-preset-save-open"));
    expect(await screen.findByTestId("my-preset-limit-message")).toHaveTextContent("1 / 1 presets");
    expect(screen.getByTestId("my-preset-save-submit")).toBeDisabled();
  });

  it("shows the server's limit message when another device filled the quota", async () => {
    const api = fakeApi([], 50);
    api.create.mockRejectedValueOnce(
      new FigurePresetApiError({
        status: 409,
        code: "PRESET_LIMIT_REACHED",
        message: "You can have up to 50 presets. Delete one to save another.",
        details: { limit: 50, count: 50 },
      }),
    );
    const { user } = setup(api);
    await user.click(screen.getByTestId("presets-tab-mine"));
    await user.click(await screen.findByTestId("my-preset-save-open"));
    await user.click(await screen.findByTestId("my-preset-save-submit"));
    expect(await screen.findByTestId("my-preset-save-error")).toHaveTextContent("up to 50 presets");
    expect(screen.getByTestId("my-preset-save-dialog")).toBeInTheDocument();
  });

  it("applies only the pose to a figure that shows an imported model", async () => {
    const posed = stored("Crouching kid", CROUCHING_KID, 2);
    const bodyOnly = stored("Kid body", KID_BODY, 1);
    const { store, figure, user } = setup(fakeApi([posed, bodyOnly]));
    act(() => store.getState().setMannequinModel(figure().id, MODEL_REF));
    await user.click(screen.getByTestId("presets-tab-mine"));
    expect(await screen.findByTestId(`my-preset-apply-${bodyOnly.id}`)).toBeDisabled();
    const before = figure();
    await user.click(screen.getByTestId(`my-preset-apply-${posed.id}`));
    expect(figure()).toMatchObject({ presetId: before.presetId, material: before.material, model: before.model });
    expect(figure().pose.leftLowerLeg).toEqual(CROUCHING_KID.pose?.pose.leftLowerLeg);
  });

  it("asks to sign in again when the session has ended", async () => {
    const api = fakeApi();
    api.list.mockRejectedValueOnce(new FigurePresetApiError({ status: 401, code: "UNAUTHORIZED", message: "Sign in to continue." }));
    const { user } = setup(api);
    await user.click(screen.getByTestId("presets-tab-mine"));
    expect(await screen.findByTestId("my-presets-sign-in")).toHaveTextContent("Your session has ended");
  });

  it("keeps keys pressed in its dialogs away from the editor shortcuts", async () => {
    const preset = stored("Keep me", KID_BODY);
    const { store, figure, user } = setup(fakeApi([preset]), { shortcuts: true });
    act(() => store.getState().select({ kind: "mannequin", mannequinId: figure().id }));
    await user.click(screen.getByTestId("presets-tab-mine"));
    await user.click(await screen.findByTestId(`my-preset-menu-${preset.id}`));
    await user.click(await screen.findByTestId("my-preset-delete"));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    await user.keyboard("{Delete}");
    expect(store.getState().scene.mannequins).toHaveLength(1);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(store.getState().selection).toEqual({ kind: "mannequin", mannequinId: figure().id });
    expect(store.getState().scene.mannequins).toHaveLength(1);
  });

  it("adds a figure from a preset in the Add figure dialog", async () => {
    const preset = stored("Crouching kid", CROUCHING_KID);
    const { api, store, user } = setup(fakeApi([preset]), { addFigure: true });
    const group = await screen.findByTestId("add-figure-my-presets");
    await user.click(await within(group).findByTestId(`add-figure-my-preset-${preset.id}`));
    expect(api.list).toHaveBeenCalledTimes(1);
    const added = store.getState().scene.mannequins.at(-1);
    expect(added).toMatchObject({ name: "Crouching kid", presetId: CHILD.id });
    expect(store.getState().dialog).toBe("none");
  });
});
