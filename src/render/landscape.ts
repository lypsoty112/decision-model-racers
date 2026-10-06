/*
 * The countryside around the circuit: rolling meadows, puffy trees, boulders, wildflowers, a ring
 * of snow-capped peaks, and clouds, all cel-shaded with soft rounded shapes.
 *
 * `buildLandscape` returns one group holding a few large meshes. `groundHeight` eases from the
 * nearest road height (flat run-off beside the track, found by `nearestTrack`) to `hills`, which
 * rises into a jagged mountain ridge from RIDGE_START metres out, or RIDGE_MARGIN beyond the
 * track's furthest point when the track reaches further. The terrain grid takes its height from
 * `groundHeight` and its vertex colours from `groundColor` (sandy verge, varied grass, rock, and
 * snow by altitude). Props are scattered with the seeded `mulberry32` generator from
 * `src/sim/trackGenerator.ts`, kept off the run-off, merged per kind with `paint`, and drawn with
 * one toon material each.
 */
import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Track } from '../sim/track';
import { mulberry32 } from '../sim/trackGenerator';
import { paint, toonMaterial } from './toon';

const TERRAIN_SIZE = 3000;
const TERRAIN_SEGMENTS = 256;
const RIDGE_START = 560;
const RIDGE_MARGIN = 80;
const FLAT_MARGIN = 10;
const BLEND_WIDTH = 55;
const UP = new Vector3(0, 1, 0);

const GRASS = new Color('#7fb24a');
const GRASS_LIGHT = new Color('#b4cf5c');
const GRASS_DARK = new Color('#5c9443');
const VERGE = new Color('#d9c690');
const ROCK = new Color('#9a9f8e');
const SNOW = new Color('#f2f6f8');

function place(x: number, y: number, z: number, scale: [number, number, number], yaw = 0): Matrix4 {
  return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, yaw), new Vector3(...scale));
}

function smoothstep(from: number, to: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

export function buildLandscape(track: Track): Group {
  const center = track.samples.reduce((sum, s) => sum.add(new Vector3(s.x, 0, s.z)), new Vector3()).divideScalar(track.samples.length);
  const ridgeStart = Math.max(RIDGE_START, ...track.samples.map((s) => Math.hypot(s.x - center.x, s.z - center.z) + RIDGE_MARGIN));

  const nearestTrack = (x: number, z: number) => {
    let best = Infinity;
    let height = 0;
    for (let i = 0; i < track.samples.length; i += 2) {
      const sample = track.samples[i];
      const d = (x - sample.x) ** 2 + (z - sample.z) ** 2;
      if (d < best) {
        best = d;
        height = sample.y;
      }
    }
    return { distance: Math.sqrt(best), height };
  };

  const ridgeAt = (x: number, z: number) => {
    const angle = Math.atan2(z - center.z, x - center.x);
    const reach = Math.max(0, Math.hypot(x - center.x, z - center.z) - ridgeStart);
    return reach * 0.28 * (0.55 + 0.45 * Math.sin(angle * 7 + 1.3 * Math.sin(angle * 3)));
  };

  const hills = (x: number, z: number) =>
    4 +
    6 * Math.sin(x * 0.011 + 0.7) * Math.cos(z * 0.013 - 0.4) +
    3.5 * Math.sin(x * 0.027 + z * 0.021) +
    2 * Math.cos(x * 0.05 - z * 0.043) +
    ridgeAt(x, z);

  const groundHeight = (x: number, z: number) => {
    const { distance, height } = nearestTrack(x, z);
    const blend = smoothstep(track.halfWidth + FLAT_MARGIN, track.halfWidth + FLAT_MARGIN + BLEND_WIDTH, distance);
    return { y: height - 0.12 + (hills(x, z) - height + 0.12) * blend, distance };
  };

  const groundColor = (x: number, y: number, z: number, distance: number, target: Color) => {
    const patch = 0.5 + 0.5 * Math.sin(x * 0.045 + Math.sin(z * 0.03) * 2) * Math.cos(z * 0.052 - x * 0.012);
    target.copy(GRASS).lerp(patch > 0.5 ? GRASS_LIGHT : GRASS_DARK, Math.abs(patch - 0.5) * 1.6);
    if (distance < track.halfWidth + 4) target.lerp(VERGE, smoothstep(track.halfWidth + 4, track.halfWidth + 1.5, distance));
    target.lerp(ROCK, smoothstep(45, 90, y));
    return target.lerp(SNOW, smoothstep(150, 185, y));
  };

  const terrain = new PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  terrain.rotateX(-Math.PI / 2);
  terrain.translate(center.x, 0, center.z);
  const positions = terrain.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const color = new Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const { y, distance } = groundHeight(x, z);
    positions.setY(i, y);
    groundColor(x, y, z, distance, color).toArray(colors, i * 3);
  }
  terrain.setAttribute('color', new BufferAttribute(colors, 3));
  terrain.computeVertexNormals();

  const random = mulberry32(7);
  const scatter = (count: number, radius: number, minDistance: number, keep: (distance: number) => boolean) => {
    const spots: { x: number; y: number; z: number; distance: number }[] = [];
    for (let i = 0; i < count; i++) {
      const x = center.x + (random() * 2 - 1) * radius;
      const z = center.z + (random() * 2 - 1) * radius;
      const ground = groundHeight(x, z);
      if (ground.distance > minDistance && keep(ground.distance)) spots.push({ x, y: ground.y, z, distance: ground.distance });
    }
    return spots;
  };
  const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)];

  const trees: BufferGeometry[] = [];
  const leafColors = ['#5f9e3a', '#72b043', '#4f8a35', '#8cbf4a', '#679f3e'];
  for (const spot of scatter(1400, 650, track.wallOffset + 5, (d) => random() < (d < 70 ? 0.85 : 0.3))) {
    const height = 2.5 + random() * 2.5;
    const size = 2.4 + random() * 1.8;
    const yaw = random() * Math.PI * 2;
    trees.push(paint(new CylinderGeometry(0.32, 0.5, height + 1, 7), '#7a5236', place(spot.x, spot.y + (height + 1) / 2 - 0.5, spot.z, [1, 1, 1])));
    if (random() < 0.3) {
      const pine = pick(['#3f7a43', '#4b8a4c', '#36693c']);
      for (let tier = 0; tier < 3; tier++) {
        const tierSize = size * (1.1 - tier * 0.25);
        trees.push(paint(new ConeGeometry(tierSize, tierSize * 1.5, 9), pine, place(spot.x, spot.y + height + tier * size * 0.75, spot.z, [1, 1, 1], yaw)));
      }
      continue;
    }
    const leaves = pick(leafColors);
    trees.push(paint(new SphereGeometry(size, 12, 9), leaves, place(spot.x, spot.y + height + size * 0.6, spot.z, [1, 0.9, 1], yaw)));
    trees.push(paint(new SphereGeometry(size * 0.7, 10, 8), leaves, place(spot.x + size * 0.6, spot.y + height + size * 0.2, spot.z + size * 0.3, [1, 0.9, 1])));
    trees.push(paint(new SphereGeometry(size * 0.6, 10, 8), leaves, place(spot.x - size * 0.5, spot.y + height + size * 0.35, spot.z - size * 0.4, [1, 0.9, 1])));
  }

  const rocks = scatter(260, 600, track.wallOffset + 2, () => random() < 0.5).map((spot) => {
    const size = 0.8 + random() * 2.2;
    return paint(new SphereGeometry(1, 10, 7), pick(['#a7a69a', '#8f9188', '#b8b3a3']), place(spot.x, spot.y + size * 0.25, spot.z, [size * 1.5, size * 0.85, size * 1.15], random() * Math.PI));
  });

  const flowers = scatter(2600, 500, track.halfWidth + 5, () => true).map((spot) =>
    paint(new SphereGeometry(0.28, 6, 4), pick(['#ffffff', '#ffe066', '#ff9ebb', '#c9a7ff', '#ffffff']), place(spot.x, spot.y + 0.25, spot.z, [1, 0.8, 1])),
  );

  const clouds: BufferGeometry[] = [];
  for (let i = 0; i < 26; i++) {
    const angle = random() * Math.PI * 2;
    const distance = 250 + random() * 1100;
    const x = center.x + Math.cos(angle) * distance;
    const z = center.z + Math.sin(angle) * distance;
    const y = 200 + random() * 140;
    const size = 22 + random() * 22;
    for (let puff = 0; puff < 5; puff++) {
      const offset = (puff - 2) * size * 0.75;
      const puffSize = size * (1 - Math.abs(puff - 2) * 0.22);
      clouds.push(paint(new SphereGeometry(puffSize, 14, 10), '#ffffff', place(x + offset, y + random() * size * 0.3, z + (random() - 0.5) * size, [1, 0.62, 0.85])));
    }
  }

  const mesh = (geometry: BufferGeometry, material: ReturnType<typeof toonMaterial>, shadows: { cast: boolean; receive: boolean }) => {
    const result = new Mesh(geometry, material);
    result.castShadow = shadows.cast;
    result.receiveShadow = shadows.receive;
    return result;
  };

  const group = new Group();
  group.add(
    mesh(terrain, toonMaterial({ vertexColors: true }), { cast: false, receive: true }),
    mesh(mergeGeometries(trees), toonMaterial({ vertexColors: true }, 0.0028), { cast: true, receive: true }),
    mesh(mergeGeometries(rocks), toonMaterial({ vertexColors: true }, 0.0025), { cast: true, receive: true }),
    mesh(mergeGeometries(flowers), toonMaterial({ vertexColors: true, emissive: '#ffffff', emissiveIntensity: 0.15 }), { cast: false, receive: true }),
    mesh(mergeGeometries(clouds), toonMaterial({ vertexColors: true, emissive: '#cddcff', emissiveIntensity: 0.45 }), { cast: false, receive: false }),
  );
  return group;
}
