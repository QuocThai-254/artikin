const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_SUFFIX_LENGTH = 8;

/** Prefixes of scene object ids: figures (`fig_…`) and lights (`light_…`). */
export type SceneObjectIdPrefix = "fig" | "light";

/**
 * Random scene-local id such as `fig_k3v9x0qa`, unique among `existingIds`.
 * Matches `SceneObjectIdSchema`; works in the browser and in Node.js.
 */
export function createSceneObjectId(
  prefix: SceneObjectIdPrefix,
  existingIds: Iterable<string> = [],
): string {
  const taken = new Set(existingIds);
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(ID_SUFFIX_LENGTH));
    let suffix = "";
    for (const byte of bytes) suffix += ID_ALPHABET[byte % ID_ALPHABET.length];
    const id = `${prefix}_${suffix}`;
    if (!taken.has(id)) return id;
  }
}
