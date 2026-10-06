/*
 * Random circuits from a seed, a target lap length in kilometres, and a complexity from 1 to 5.
 *
 * `mulberry32` is a small seeded random number generator, also used to scatter the scenery.
 * `randomTrackId` is the id a generated track gets from its inputs; LAYOUT_VERSION changes when
 * the same inputs start producing a different layout, so old lap records don't carry over.
 * `generateTrack` names the track with one word from FIRST_WORDS and one from SECOND_WORDS, then
 * makes up to MAX_ATTEMPTS layouts, each seeded from the track seed and the attempt number so the
 * result depends only on the inputs, and returns the first one `isRaceable` accepts.
 *
 * `layout` builds the lap from straights and arcs: about (1.5 + complexity) turns per kilometre,
 * each an arc of at least MIN_ARC_RADIUS metres, some of them hairpins (more often at higher
 * complexity), with the turn angles evened out so they add up to one full circle and straights
 * sharing the rest of the length. `closeLoop` makes the lap end where it started by lengthening
 * the two straights whose directions best bracket the leftover gap (or gives up when none do),
 * `walk` traces the straights and arcs into points every PATH_STEP metres, and `layout` then adds
 * gentle hills, scales the loop to the requested length, and rotates the points so the start line
 * lands on the longest gap between corners. `isRaceable` rejects a layout with a curve tighter
 * than MIN_RADIUS, with two parts of the lap closer than the walls allow, without a straight run
 * around the start line, or reaching further than MAX_REACH from its centre.
 */
import { Track, TRACK_HALF_WIDTH } from './track';

export type RandomTrackParams = { seed: number; length: number; complexity: number };

type Label = { id: string; name: string };
type Point = [number, number, number];

const LAYOUT_VERSION = 'v2';
const MAX_ATTEMPTS = 100;
const MIN_ARC_RADIUS = 36;
const ARC_RADIUS_SPREAD = 55;
const MIN_STRAIGHT_SHARE = 0.2;
const MIN_BRACKET_SINE = 0.2;
const PATH_STEP = 12;
const MIN_RADIUS = 24;
const MAX_REACH = 600;
const MIN_SEPARATION = 80;
const STRAIGHT_BEFORE = 70;
const STRAIGHT_AFTER = 40;
const STRAIGHT_CURVATURE = 1 / 250;

const FIRST_WORDS = [
  'Amber', 'Aspen', 'Azure', 'Birch', 'Blaze', 'Bramble', 'Breeze', 'Cedar', 'Cinder', 'Clover',
  'Cobalt', 'Comet', 'Copper', 'Coral', 'Crystal', 'Dune', 'Ember', 'Falcon', 'Fern', 'Frost',
  'Golden', 'Granite', 'Harbor', 'Hazel', 'Heather', 'Iron', 'Ivy', 'Jade', 'Juniper', 'Lagoon',
  'Lunar', 'Maple', 'Marble', 'Meadow', 'Misty', 'Moss', 'Nectar', 'Oak', 'Onyx', 'Pebble',
  'Pine', 'Quartz', 'Raven', 'Ripple', 'Ruby', 'Saffron', 'Silver', 'Solar', 'Thunder', 'Willow',
];

const SECOND_WORDS = [
  'Arena', 'Bay', 'Bend', 'Bluff', 'Canyon', 'Circuit', 'Coast', 'Cove', 'Creek', 'Crest',
  'Crossing', 'Dale', 'Downs', 'Drift', 'Falls', 'Fields', 'Forest', 'Gardens', 'Glade', 'Glen',
  'Gorge', 'Grove', 'Heights', 'Hills', 'Hollow', 'Island', 'Lakes', 'Loop', 'Marsh', 'Mesa',
  'Mile', 'Orchard', 'Park', 'Pass', 'Peaks', 'Point', 'Raceway', 'Ridge', 'Ring', 'Run',
  'Sands', 'Speedway', 'Springs', 'Summit', 'Trail', 'Valley', 'Vista', 'Woods', 'Wharf', 'Wilds',
];

export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomTrackId = ({ seed, length, complexity }: RandomTrackParams) => `${LAYOUT_VERSION}-${seed}-${length}-${complexity}`;

export function generateTrack(params: RandomTrackParams): Track {
  const random = mulberry32(params.seed);
  const pick = (words: string[]) => words[Math.floor(random() * words.length)];
  const label = { id: randomTrackId(params), name: `${pick(FIRST_WORDS)} ${pick(SECOND_WORDS)}` };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const track = layout(params, mulberry32(params.seed + attempt * 7919), label);
    if (track && isRaceable(track)) return track;
  }
  throw new Error(`No raceable layout for track ${label.id} in ${MAX_ATTEMPTS} attempts`);
}

function layout({ length, complexity }: RandomTrackParams, random: () => number, label: Label): Track | null {
  const total = length * 1000;
  const count = Math.max(4, Math.round(length * (1.5 + complexity)));
  const hairpinChance = 0.08 + 0.04 * complexity;
  const raw = Array.from({ length: count }, () => (random() < 0.5 ? -1 : 1) * (random() < hairpinChance ? 2.3 + random() * 0.6 : 0.3 + random() * 1.1));
  const shift = (2 * Math.PI - raw.reduce((sum, turn) => sum + turn, 0)) / count;
  const turns = raw.map((turn) => turn + shift);
  const radii = turns.map(() => MIN_ARC_RADIUS + random() * ARC_RADIUS_SPREAD);
  const curved = turns.reduce((sum, turn, i) => sum + Math.abs(turn) * radii[i], 0);
  const weights = turns.map(() => 0.3 + random() * 1.4);
  const straight = Math.max(total * MIN_STRAIGHT_SHARE, total - curved) / weights.reduce((sum, weight) => sum + weight, 0);
  const start = random() * 2 * Math.PI;
  const headings = turns.map((_, i) => start + turns.slice(0, i).reduce((sum, turn) => sum + turn, 0));
  const straights = closeLoop(turns, radii, headings, weights.map((weight) => weight * straight));
  if (!straights) return null;
  const path = walk(turns, radii, straights, start);
  const [hill, swell] = [random() * Math.PI * 2, random() * Math.PI * 2];
  const outline: Point[] = path.map(([x, z], i) => {
    const angle = ((i + 1) / path.length) * 2 * Math.PI;
    return [x, 6 + 4 * Math.sin(angle + hill) + 3 * Math.sin(2 * angle + swell), z];
  });
  const perimeter = outline.reduce((sum, [x, , z], i) => {
    const [nextX, , nextZ] = outline[(i + 1) % outline.length];
    return sum + Math.hypot(x - nextX, z - nextZ);
  }, 0);
  const scaled = (points: Point[], factor: number): Point[] => points.map(([x, y, z]) => [x * factor, y, z * factor]);
  const rough = scaled(outline, (length * 1000) / perimeter);
  const sized = scaled(rough, (length * 1000) / new Track(rough, TRACK_HALF_WIDTH, label).length);
  const track = new Track(sized, TRACK_HALF_WIDTH, label);
  const first = startIndex(track, sized);
  return new Track([...sized.slice(first), ...sized.slice(0, first)], TRACK_HALF_WIDTH, label);
}

function closeLoop(turns: number[], radii: number[], headings: number[], straights: number[]): number[] | null {
  let [gapX, gapZ] = [0, 0];
  turns.forEach((turn, i) => {
    const side = Math.sign(turn) * radii[i];
    gapX += straights[i] * Math.cos(headings[i]) + side * (Math.sin(headings[i] + turn) - Math.sin(headings[i]));
    gapZ += straights[i] * Math.sin(headings[i]) + side * (Math.cos(headings[i]) - Math.cos(headings[i] + turn));
  });
  let best: { i: number; j: number; a: number; b: number } | null = null;
  for (let i = 0; i < turns.length; i++) {
    for (let j = i + 1; j < turns.length; j++) {
      const [ux, uz, vx, vz] = [Math.cos(headings[i]), Math.sin(headings[i]), Math.cos(headings[j]), Math.sin(headings[j])];
      const det = ux * vz - vx * uz;
      if (Math.abs(det) < MIN_BRACKET_SINE) continue;
      const a = (vx * gapZ - gapX * vz) / det;
      const b = (gapX * uz - ux * gapZ) / det;
      if (a >= 0 && b >= 0 && (!best || a + b < best.a + best.b)) best = { i, j, a, b };
    }
  }
  if (!best) return null;
  const { i, j, a, b } = best;
  return straights.map((length, k) => length + (k === i ? a : k === j ? b : 0));
}

function walk(turns: number[], radii: number[], straights: number[], heading: number): [number, number][] {
  const path: [number, number][] = [];
  let [x, z] = [0, 0];
  turns.forEach((turn, i) => {
    for (let d = PATH_STEP; d <= straights[i]; d += PATH_STEP) path.push([x + Math.cos(heading) * d, z + Math.sin(heading) * d]);
    x += Math.cos(heading) * straights[i];
    z += Math.sin(heading) * straights[i];
    const side = Math.sign(turn) * radii[i];
    const [centreX, centreZ] = [x - Math.sin(heading) * side, z + Math.cos(heading) * side];
    const steps = Math.max(2, Math.ceil((Math.abs(turn) * radii[i]) / PATH_STEP));
    for (let k = 1; k <= steps; k++) {
      const along = heading + (turn * k) / steps;
      path.push([centreX + Math.sin(along) * side, centreZ - Math.cos(along) * side]);
    }
    heading += turn;
    [x, z] = path[path.length - 1];
  });
  return path;
}

function startIndex(track: Track, points: Point[]): number {
  const { corners } = track;
  if (corners.length === 0) return 0;
  const gaps = corners.map((corner, i) => {
    const next = corners[(i + 1) % corners.length];
    return { from: corner.end, size: track.wrap(next.start - corner.end) };
  });
  const widest = gaps.reduce((a, b) => (b.size > a.size ? b : a));
  const target = track.wrap(widest.from + Math.min(widest.size * 0.6, STRAIGHT_BEFORE + 20));
  const distanceTo = ([x, , z]: Point) => Math.abs(track.signedDistance(target, track.project(x, z).s));
  return points.reduce((best, point, i) => (distanceTo(point) < distanceTo(points[best]) ? i : best), 0);
}

function isRaceable(track: Track): boolean {
  const { samples, spacing, wallOffset } = track;
  if (samples.some((sample) => Math.abs(sample.curvature) > 1 / MIN_RADIUS)) return false;
  for (let s = -STRAIGHT_BEFORE; s <= STRAIGHT_AFTER; s += spacing) {
    if (Math.abs(track.sampleAt(s).curvature) > STRAIGHT_CURVATURE) return false;
  }
  const centreX = samples.reduce((sum, sample) => sum + sample.x, 0) / samples.length;
  const centreZ = samples.reduce((sum, sample) => sum + sample.z, 0) / samples.length;
  if (samples.some((sample) => Math.hypot(sample.x - centreX, sample.z - centreZ) > MAX_REACH)) return false;
  const n = samples.length;
  const apart = MIN_SEPARATION / spacing;
  const clearance = (2 * wallOffset + 6) ** 2;
  for (let i = 0; i < n; i += 2) {
    for (let j = i + 2; j < n; j += 2) {
      if (Math.min(j - i, n - (j - i)) < apart) continue;
      if ((samples[i].x - samples[j].x) ** 2 + (samples[i].z - samples[j].z) ** 2 < clearance) return false;
    }
  }
  return true;
}
