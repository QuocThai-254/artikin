/**
 * Color temperature (Kelvin) → sRGB hex, using the Tanner Helland blackbody approximation.
 * Accurate enough for artistic lighting between 1000 K and 40000 K.
 */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592;
    g = 288.1221695283 * (t - 60) ** -0.0755148492;
    b = 255;
  }
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return [c(r), c(g), c(b)];
}

export function kelvinToHex(kelvin: number): string {
  return `#${kelvinToRgb(kelvin)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}
