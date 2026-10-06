/*
 * Meshes that make up the circuit itself.
 *
 * `buildTrackMesh` returns a group with the road, curbs, hedges, marker posts, and the start
 * gantry. `sweep` extrudes a cross-section profile (lateral offset, height) along every track
 * sample into a closed ribbon, with u across the profile and v in metres divided by `vScale`;
 * the road, the red-and-white curbs, and the rounded hedges that mark the walls are all sweeps.
 * `canvasTexture` paints the asphalt (speckles, edge lines, dashed centre line) and the
 * chequered start banner. Marker posts every POST_SPACING metres give a strong sense of speed.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DataTexture,
  Group,
  Matrix4,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Track } from '../sim/track';
import { paint, toonMaterial } from './toon';

const POST_SPACING = 25;
const CURB_WIDTH = 1.4;

function sweep(track: Track, profile: [number, number][], vScale: number): BufferGeometry {
  const rings = track.samples.length + 1;
  const width = profile.length;
  const positions = new Float32Array(rings * width * 3);
  const uvs = new Float32Array(rings * width * 2);
  const indices: number[] = [];
  for (let i = 0; i < rings; i++) {
    const sample = track.samples[i % track.samples.length];
    for (let j = 0; j < width; j++) {
      const [lateral, height] = profile[j];
      const k = i * width + j;
      positions.set([sample.x - sample.tz * lateral, sample.y + height, sample.z + sample.tx * lateral], k * 3);
      uvs.set([j / (width - 1), (i * track.spacing) / vScale], k * 2);
      if (i < rings - 1 && j < width - 1) indices.push(k, k + 1, k + width, k + 1, k + width + 1, k + width);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function roadTexture(): Texture {
  return canvasTexture(256, 512, (context) => {
    context.fillStyle = '#6a7180';
    context.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 2600; i++) {
      context.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(20,24,40,0.08)';
      context.fillRect(Math.random() * 256, Math.random() * 512, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    context.fillStyle = '#f4f1e8';
    context.fillRect(8, 0, 7, 512);
    context.fillRect(241, 0, 7, 512);
    context.fillRect(125, 0, 6, 256);
  });
}

function checkerTexture(columns: number, rows: number): Texture {
  return canvasTexture(columns * 16, rows * 16, (context) => {
    for (let x = 0; x < columns; x++) {
      for (let y = 0; y < rows; y++) {
        context.fillStyle = (x + y) % 2 === 0 ? '#1d2233' : '#f7f5ef';
        context.fillRect(x * 16, y * 16, 16, 16);
      }
    }
  });
}

function stripeTexture(): Texture {
  const texture = new DataTexture(new Uint8Array([230, 57, 70, 255, 247, 245, 239, 255]), 1, 2, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function hedgeProfile(center: number, radius: number): [number, number][] {
  return Array.from({ length: 9 }, (_, k) => {
    const angle = (Math.PI * k) / 8;
    return [center - radius * Math.cos(angle), radius * 0.95 * Math.sin(angle)];
  });
}

export function buildTrackMesh(track: Track): Group {
  const group = new Group();
  const hw = track.halfWidth;

  const road = new Mesh(sweep(track, [[-hw, 0.02], [hw, 0.02]], 12), toonMaterial({ map: roadTexture() }));
  road.receiveShadow = true;

  const curbProfile = (side: number): [number, number][] =>
    side < 0
      ? [[-hw - CURB_WIDTH, 0.02], [-hw - CURB_WIDTH * 0.5, 0.12], [-hw, 0.08]]
      : [[hw, 0.08], [hw + CURB_WIDTH * 0.5, 0.12], [hw + CURB_WIDTH, 0.02]];
  const curbMaterial = toonMaterial({ map: stripeTexture() });
  const curbs = [-1, 1].map((side) => new Mesh(sweep(track, curbProfile(side), 6), curbMaterial));

  const hedgeMaterial = toonMaterial({ color: '#4f8f3c' }, 0.002);
  const hedges = [-1, 1].map((side) => {
    const hedge = new Mesh(sweep(track, hedgeProfile(side * (track.wallOffset + 1.1), 1.2), 4), hedgeMaterial);
    hedge.castShadow = true;
    hedge.receiveShadow = true;
    return hedge;
  });

  const posts: BufferGeometry[] = [];
  for (let s = 0; s < track.length; s += POST_SPACING) {
    for (const side of [-1, 1]) {
      const point = track.pointAt(s, side * (hw + CURB_WIDTH + 1.6));
      posts.push(paint(new CylinderGeometry(0.16, 0.2, 1.3, 8), '#f7f5ef', new Matrix4().makeTranslation(point.x, point.y + 0.65, point.z)));
      posts.push(paint(new CylinderGeometry(0.17, 0.17, 0.25, 8), side < 0 ? '#e63946' : '#ffb703', new Matrix4().makeTranslation(point.x, point.y + 1.1, point.z)));
    }
  }
  const postMesh = new Mesh(mergeGeometries(posts), toonMaterial({ vertexColors: true }, 0.003));
  postMesh.castShadow = true;

  const start = track.sampleAt(0);
  const startYaw = Math.atan2(start.tx, start.tz);
  const startLine = new Mesh(new PlaneGeometry(hw * 2, 2.4), toonMaterial({ map: checkerTexture(16, 2), polygonOffset: true, polygonOffsetFactor: -2 }));
  startLine.rotation.set(-Math.PI / 2, startYaw, 0, 'YXZ');
  startLine.position.set(start.x, start.y + 0.04, start.z);

  const gantry = new Group();
  const pillarMaterial = toonMaterial({ color: '#f7f5ef' }, 0.004);
  for (const side of [-1, 1]) {
    const pillar = new Mesh(new RoundedBoxGeometry(1.2, 8, 1.2, 3, 0.4), pillarMaterial);
    pillar.position.set(side * (hw + 2.2), 4, 0);
    pillar.castShadow = true;
    gantry.add(pillar);
  }
  const banner = new Mesh(new RoundedBoxGeometry(hw * 2 + 6, 1.8, 0.8, 3, 0.35), toonMaterial({ map: checkerTexture(24, 2) }, 0.004));
  banner.position.y = 8;
  banner.castShadow = true;
  gantry.add(banner);
  gantry.position.set(start.x, start.y, start.z);
  gantry.rotation.y = startYaw;

  group.add(road, ...curbs, ...hedges, postMesh, startLine, gantry);
  return group;
}
