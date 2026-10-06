/*
 * Cel-shading helpers shared by every mesh.
 *
 * `bakeGradient` builds a 256-texel ramp with three soft-edged bands (shade, half-light, lit)
 * that MeshToonMaterial samples by N·L, which gives the soft painted look instead of hard
 * steps. `toonMaterial` creates a toon material on that ramp and sets the ink-outline thickness
 * that three's OutlineEffect reads from `userData.outlineParameters`; a thickness of 0 hides the
 * outline. `paint` bakes a transform and a flat vertex colour into a geometry so many props can
 * be merged into one vertex-coloured mesh with `mergeGeometries`.
 */
import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  type ColorRepresentation,
  DataTexture,
  type Matrix4,
  MeshToonMaterial,
  type MeshToonMaterialParameters,
  NearestFilter,
  RedFormat,
} from 'three';

const OUTLINE_COLOR = [0.09, 0.1, 0.16];

function bakeGradient(): DataTexture {
  const size = 256;
  const data = new Uint8Array(size);
  const smooth = (from: number, to: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - from) / (to - from)));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < size; i++) {
    const u = i / (size - 1);
    data[i] = Math.round((0.42 + 0.28 * smooth(0.44, 0.5, u) + 0.3 * smooth(0.62, 0.7, u)) * 255);
  }
  const texture = new DataTexture(data, size, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

const gradient = bakeGradient();

export function toonMaterial(parameters: MeshToonMaterialParameters, outline = 0): MeshToonMaterial {
  const material = new MeshToonMaterial({ gradientMap: gradient, ...parameters });
  material.userData.outlineParameters = { thickness: outline, color: OUTLINE_COLOR, visible: outline > 0 };
  return material;
}

export function paint(geometry: BufferGeometry, color: ColorRepresentation, transform: Matrix4): BufferGeometry {
  geometry.applyMatrix4(transform);
  const { r, g, b } = new Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}
