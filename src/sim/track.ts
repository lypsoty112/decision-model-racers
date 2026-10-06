/*
 * The circuit: a closed centripetal Catmull-Rom centreline resampled every ~2 m, plus the
 * geometric queries the simulation and renderer share.
 *
 * `Track` builds `samples` (position, unit tangent, smoothed signed curvature) from control
 * points and detects `corners` as runs of same-direction samples tighter than CORNER_RADIUS. Its
 * `id` keys stored records and its `name` is shown to players.
 * `sampleAt` interpolates any distance along the lap, `pointAt` offsets that sample sideways,
 * `signedDistance` gives the shortest along-track step between two positions, and `project` maps a world x/z to distance-along and lateral offset by searching a window of
 * samples around a hint, falling back to a full scan when the hint is stale. `wrapAngle` folds
 * an angle into [-PI, PI]. `DEFAULT_TRACK` holds the control points of the race circuit.
 *
 * Conventions: yaw 0 faces +z, forward is (sin yaw, cos yaw), right is (-cos yaw, sin yaw),
 * and positive curvature turns right.
 */
import { CatmullRomCurve3, Vector3 } from 'three';

export type TrackSample = { x: number; y: number; z: number; tx: number; tz: number; curvature: number };

export type Corner = {
  start: number;
  end: number;
  apex: number;
  direction: 'left' | 'right';
  radius: number;
  angleDeg: number;
};

export type TrackProjection = { s: number; lateral: number };

export const TRACK_HALF_WIDTH = 9;
const SAMPLE_SPACING = 2;
const CORNER_RADIUS = 160;
const MIN_CORNER_ANGLE = 20;
const SEARCH_WINDOW = 40;
const CURVATURE_SMOOTHING = 3;

export const DEFAULT_TRACK: [number, number, number][] = [
  [0, 0, 0],
  [140, 0, 0],
  [250, 2, -15],
  [315, 5, -75],
  [300, 9, -150],
  [235, 11, -185],
  [160, 9, -165],
  [105, 7, -200],
  [45, 5, -255],
  [-55, 3, -265],
  [-120, 2, -225],
  [-115, 3, -160],
  [-45, 6, -140],
  [0, 7, -125],
  [25, 8, -95],
  [12, 8, -62],
  [-30, 9, -50],
  [-80, 10, -62],
  [-165, 8, -65],
  [-215, 6, -50],
  [-240, 4, -12],
  [-225, 3, 25],
  [-180, 1, 40],
  [-100, 0, 4],
];

export const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export class Track {
  readonly id: string;
  readonly name: string;
  readonly halfWidth: number;
  readonly wallOffset: number;
  readonly length: number;
  readonly spacing: number;
  readonly samples: TrackSample[];
  readonly corners: Corner[];

  constructor(controlPoints: [number, number, number][], halfWidth: number, label: { id: string; name: string }) {
    this.id = label.id;
    this.name = label.name;
    const curve = new CatmullRomCurve3(
      controlPoints.map(([x, y, z]) => new Vector3(x, y, z)),
      true,
      'centripetal',
    );
    curve.arcLengthDivisions = 5000;
    this.length = curve.getLength();
    const count = Math.round(this.length / SAMPLE_SPACING);
    this.spacing = this.length / count;
    this.halfWidth = halfWidth;
    this.wallOffset = halfWidth + 7;
    this.samples = buildSamples(curve.getSpacedPoints(count).slice(0, count), this.spacing);
    this.corners = findCorners(this.samples, this.spacing);
  }

  wrap(s: number): number {
    return ((s % this.length) + this.length) % this.length;
  }

  signedDistance(fromS: number, toS: number): number {
    const ahead = this.wrap(toS - fromS);
    return ahead > this.length / 2 ? ahead - this.length : ahead;
  }

  sampleAt(s: number): TrackSample {
    const n = this.samples.length;
    const f = this.wrap(s) / this.spacing;
    const i = Math.floor(f);
    const t = f - i;
    const a = this.samples[i % n];
    const b = this.samples[(i + 1) % n];
    const tx = a.tx + (b.tx - a.tx) * t;
    const tz = a.tz + (b.tz - a.tz) * t;
    const norm = Math.hypot(tx, tz);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      tx: tx / norm,
      tz: tz / norm,
      curvature: a.curvature + (b.curvature - a.curvature) * t,
    };
  }

  pointAt(s: number, lateral: number): { x: number; y: number; z: number } {
    const sample = this.sampleAt(s);
    return { x: sample.x - sample.tz * lateral, y: sample.y, z: sample.z + sample.tx * lateral };
  }

  project(x: number, z: number, hintS?: number): TrackProjection {
    const n = this.samples.length;
    let best = 0;
    let bestDistance = Infinity;
    const scan = (from: number, to: number) => {
      for (let k = from; k <= to; k++) {
        const i = ((k % n) + n) % n;
        const sample = this.samples[i];
        const d = (x - sample.x) ** 2 + (z - sample.z) ** 2;
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
    };
    if (hintS !== undefined) {
      const center = Math.round(this.wrap(hintS) / this.spacing);
      scan(center - SEARCH_WINDOW, center + SEARCH_WINDOW);
    }
    if (bestDistance > (this.wallOffset * 2) ** 2) scan(0, n - 1);
    const sample = this.samples[best];
    const dx = x - sample.x;
    const dz = z - sample.z;
    return {
      s: this.wrap(best * this.spacing + dx * sample.tx + dz * sample.tz),
      lateral: -dx * sample.tz + dz * sample.tx,
    };
  }
}

function buildSamples(points: Vector3[], spacing: number): TrackSample[] {
  const n = points.length;
  const at = (i: number) => ((i % n) + n) % n;
  const yaws = points.map((_, i) => {
    const prev = points[at(i - 1)];
    const next = points[at(i + 1)];
    return Math.atan2(next.x - prev.x, next.z - prev.z);
  });
  const raw = yaws.map((_, i) => -wrapAngle(yaws[at(i + 1)] - yaws[at(i - 1)]) / (2 * spacing));
  return points.map((p, i) => {
    let sum = 0;
    for (let k = -CURVATURE_SMOOTHING; k <= CURVATURE_SMOOTHING; k++) sum += raw[at(i + k)];
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      tx: Math.sin(yaws[i]),
      tz: Math.cos(yaws[i]),
      curvature: sum / (2 * CURVATURE_SMOOTHING + 1),
    };
  });
}

function findCorners(samples: TrackSample[], spacing: number): Corner[] {
  const n = samples.length;
  const isTight = (i: number) => Math.abs(samples[i].curvature) > 1 / CORNER_RADIUS;
  const first = samples.findIndex((_, i) => !isTight(i));
  const corners: Corner[] = [];
  let run: number[] = [];
  for (let k = 1; k <= n; k++) {
    const i = (first + k) % n;
    const sameDirection =
      run.length === 0 || Math.sign(samples[i].curvature) === Math.sign(samples[run[0]].curvature);
    if (isTight(i) && sameDirection) {
      run.push(i);
      continue;
    }
    if (run.length > 0) corners.push(toCorner(samples, run, spacing));
    run = isTight(i) ? [i] : [];
  }
  return corners.filter((corner) => corner.angleDeg >= MIN_CORNER_ANGLE);
}

function toCorner(samples: TrackSample[], run: number[], spacing: number): Corner {
  const apex = run.reduce((a, b) => (Math.abs(samples[b].curvature) > Math.abs(samples[a].curvature) ? b : a));
  const turned = run.reduce((sum, i) => sum + Math.abs(samples[i].curvature) * spacing, 0);
  const start = run[0] * spacing;
  return {
    start,
    end: start + run.length * spacing,
    apex: apex * spacing,
    direction: samples[apex].curvature > 0 ? 'right' : 'left',
    radius: 1 / Math.abs(samples[apex].curvature),
    angleDeg: (turned * 180) / Math.PI,
  };
}
