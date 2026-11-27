"use client";

/**
 * Loads a model file into an analysed asset (S8, client-only; imported on demand so three-vrm and
 * the glTF loader stay out of the editor's initial bundle). Everything happens in memory: the
 * loader never fetches anything (external URIs are refused by `inspectModelFile`, blob/data URLs
 * only), and the bytes never leave the browser.
 */

import { VRMLoaderPlugin, VRMMetaLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { HUMAN_BONE_NAMES } from "@/lib/mannequin/bones";
import { RigAnalysisError, analyzeRig } from "@/lib/model-import/analysis";
import { ModelImportError, inspectModelFile } from "@/lib/model-import/format";
import { mapHumanoidByNames } from "@/lib/model-import/name-map";
import type { ModelHumanBoneName } from "@/lib/model-import/rig-source";
import type { ModelFormat } from "@/lib/scene";
import { extractRigSource } from "./extract-rig-source";
import { collectNodes } from "./three-nodes";
import type { ImportedModelAsset } from "./types";

const MODEL_BONES: readonly ModelHumanBoneName[] = [...HUMAN_BONE_NAMES, "upperChest"];

/** Loading manager that refuses every URL except in-memory ones (defence in depth). */
function offlineManager(): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (url.startsWith("blob:") || url.startsWith("data:") ? url : "data:,"));
  return manager;
}

function humanoidFromVrm(vrm: VRM): Partial<Record<ModelHumanBoneName, THREE.Object3D>> {
  const out: Partial<Record<ModelHumanBoneName, THREE.Object3D>> = {};
  for (const bone of MODEL_BONES) {
    const node = vrm.humanoid.getRawBoneNode(bone);
    if (node) out[bone] = node;
  }
  return out;
}

function humanoidFromNames(gltf: GLTF, root: THREE.Object3D): Partial<Record<ModelHumanBoneName, THREE.Object3D>> {
  const objects = collectNodes(root);
  const jsonNodes = (gltf.parser.json as { nodes?: { name?: string }[] }).nodes ?? [];
  const names = objects.map((o) => {
    const node = gltf.parser.associations.get(o)?.nodes;
    return node !== undefined ? (jsonNodes[node]?.name ?? o.name) : o.name;
  });
  const mapped = mapHumanoidByNames(names);
  const out: Partial<Record<ModelHumanBoneName, THREE.Object3D>> = {};
  for (const [bone, index] of Object.entries(mapped) as [ModelHumanBoneName, number][]) out[bone] = objects[index];
  return out;
}

/** The license URL a VRM 1.0 file declares (three-vrm refuses unknown ones unless accepted). */
function declaredLicenseUrl(json: Record<string, unknown>): string | null {
  const extensions = json.extensions as { VRMC_vrm?: { meta?: { licenseUrl?: unknown } } } | undefined;
  const url = extensions?.VRMC_vrm?.meta?.licenseUrl;
  return typeof url === "string" ? url : null;
}

export interface LoadModelInput {
  id: string;
  name: string;
  bytes: ArrayBuffer;
}

/** Parses, maps and analyses a model; throws `ModelImportError`. */
export async function loadModelAsset(input: LoadModelInput): Promise<ImportedModelAsset> {
  const info = inspectModelFile(new Uint8Array(input.bytes));
  const loader = new GLTFLoader(offlineManager());
  loader.setMeshoptDecoder(MeshoptDecoder);
  if (info.vrm) {
    // The user confirmed their rights to the file; its own license terms are not ours to enforce here.
    const licenseUrl = declaredLicenseUrl(info.json);
    loader.register(
      (parser) =>
        new VRMLoaderPlugin(parser, {
          autoUpdateHumanBones: false,
          metaPlugin: new VRMMetaLoaderPlugin(parser, {
            acceptLicenseUrls: ["https://vrm.dev/licenses/1.0/", ...(licenseUrl ? [licenseUrl] : [])],
          }),
        }),
    );
  }
  let gltf: GLTF;
  try {
    gltf = await loader.parseAsync(input.bytes, "");
  } catch (error) {
    throw new ModelImportError("LOAD_FAILED", `The model could not be read${error instanceof Error && error.message ? `: ${error.message}` : "."}`);
  }
  const vrm = gltf.userData.vrm as VRM | undefined;
  const template = vrm?.scene ?? gltf.scene;
  let humanoid: Partial<Record<ModelHumanBoneName, THREE.Object3D>>;
  if (vrm) {
    humanoid = humanoidFromVrm(vrm);
    // three-vrm adds a normalized helper rig to the scene; this editor drives the raw bones itself.
    vrm.humanoid.normalizedHumanBonesRoot.removeFromParent();
  } else {
    humanoid = humanoidFromNames(gltf, template);
  }
  const format: ModelFormat = vrm ? "vrm" : "glb";
  try {
    const source = extractRigSource(template, humanoid);
    const analysis = analyzeRig(source, { key: `import:${input.id}` });
    return {
      id: input.id,
      name: input.name,
      format,
      figureModel: analysis.figureModel,
      template,
      plan: analysis.plan,
      colliders: analysis.colliders,
      proportions: analysis.proportions,
      missingBones: analysis.missingBones,
      dispose: () => VRMUtils.deepDispose(template),
    };
  } catch (error) {
    VRMUtils.deepDispose(template);
    if (error instanceof RigAnalysisError) {
      const hint = info.vrm
        ? "The VRM's humanoid mapping is incomplete."
        : "Artikin recognises VRM files and GLB rigs with Mixamo-style bone names (Hips, Spine, LeftArm, LeftForeArm, …).";
      throw new ModelImportError(
        "UNSUPPORTED_RIG",
        error.code === "UNSUPPORTED_RIG" ? `Unsupported rig — missing bones: ${error.missing.join(", ")}. ${hint}` : error.message,
      );
    }
    throw error;
  }
}
