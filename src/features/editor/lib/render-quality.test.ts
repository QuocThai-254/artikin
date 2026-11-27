import { describe, expect, it } from "vitest";

import { AUTO_MIN_PIXEL_RATIO, PixelRatioPolicy, restPixelRatio, shadowMapSize } from "./render-quality";

const feed = (policy: PixelRatioPolicy, device: number, ms: number, count = 10) => {
  for (let i = 0; i < count; i++) policy.sample("auto", device, ms);
};

describe("render quality", () => {
  it("caps the rest pixel ratio per profile and follows browser zoom below 1", () => {
    expect(restPixelRatio("auto", 3)).toBe(2);
    expect(restPixelRatio("high", 2)).toBe(2);
    expect(restPixelRatio("balanced", 3)).toBe(1.5);
    expect(restPixelRatio("low", 2)).toBe(1);
    expect(restPixelRatio("auto", 0.8)).toBe(0.8);
  });

  it("caps shadow maps for Balanced and Low only", () => {
    expect(shadowMapSize(2048, "auto")).toBe(2048);
    expect(shadowMapSize(2048, "high")).toBe(2048);
    expect(shadowMapSize(2048, "balanced")).toBe(1024);
    expect(shadowMapSize(1024, "low")).toBe(512);
    expect(shadowMapSize(512, "balanced")).toBe(512);
  });

  it("uses the rest ratio when idle and the profile's ratio while interacting", () => {
    const policy = new PixelRatioPolicy();
    expect(policy.pixelRatio("auto", 2, false)).toBe(2);
    expect(policy.pixelRatio("high", 2, true)).toBe(2);
    expect(policy.pixelRatio("balanced", 2, true)).toBe(1);
    expect(policy.pixelRatio("balanced", 1, true)).toBe(1);
    expect(policy.pixelRatio("low", 1, true)).toBe(0.75);
  });

  it("Auto softens slow interactions down to its floor and sharpens fast ones back to the rest ratio", () => {
    const policy = new PixelRatioPolicy();
    /** One gesture: the ratio it starts with, after feeding frame intervals. */
    const gesture = (ms: number, count = 10) => {
      const ratio = policy.pixelRatio("auto", 2, true);
      feed(policy, 2, ms, count);
      expect(policy.pixelRatio("auto", 2, true)).toBe(ratio); // latched: no resize mid-gesture
      policy.pixelRatio("auto", 2, false);
      return ratio;
    };
    expect(gesture(50)).toBe(1);
    expect(gesture(50)).toBe(0.8);
    expect(gesture(50)).toBe(0.65);
    for (let i = 0; i < 4; i++) gesture(50);
    expect(gesture(16)).toBe(AUTO_MIN_PIXEL_RATIO);
    for (let i = 0; i < 6; i++) gesture(16);
    expect(gesture(16)).toBe(2);
    // Rest frames stay at full ratio whatever Auto learned.
    expect(policy.pixelRatio("auto", 2, false)).toBe(2);
  });

  it("ignores the frame that paid for a resize", () => {
    const policy = new PixelRatioPolicy();
    policy.skip();
    feed(policy, 1, 50, 10);
    expect(policy.autoInteractionRatio).toBeNull();
    feed(policy, 1, 50, 1);
    expect(policy.autoInteractionRatio).toBe(0.8);
  });

  it("Auto ignores pauses in the input and does nothing for fixed profiles", () => {
    const policy = new PixelRatioPolicy();
    feed(policy, 1, 1500, 30);
    expect(policy.pixelRatio("auto", 1, true)).toBe(1);
    const fixed = new PixelRatioPolicy();
    for (let i = 0; i < 30; i++) fixed.sample("balanced", 1, 80);
    expect(fixed.autoInteractionRatio).toBeNull();
    expect(fixed.pixelRatio("balanced", 1, true)).toBe(1);
  });
});
