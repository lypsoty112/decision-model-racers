/*
 * Random circuits from a seed, a target lap length in kilometres, and a complexity from 1 to 5.
 *
 * `mulberry32` is a small seeded random number generator, also used to scatter the scenery.
 * `randomTrackId` is the id a generated track gets from its inputs. `generateTrack` names the track with one word from FIRST_WORDS and one from SECOND_WORDS, then
 * makes up to MAX_ATTEMPTS layouts, each seeded from the track seed and the attempt number so the
 * result depends only on the inputs, and returns the first one `isRaceable` accepts. `layout`
 * places 5 + 2 × complexity control points around a circle, jittering their angles and their
 * radii in proportion to the gap between points, and less when that gap is shorter than about
 * SHARP_GAP metres so short tracks don't zigzag (sorting the points by angle keeps the outline
 * from crossing itself). It then adds gentle hills, scales the loop to
 * the requested length, and rotates the points so the start line lands on the longest gap between
 * corners. `isRaceable` rejects a layout with a curve tighter than MIN_RADIUS, with two parts of
 * the lap closer than the walls allow, without a straight run around the start line, or reaching
 * further than MAX_REACH from its centre, where the landscape's mountain ridge begins.
 */
import { Track, TRACK_HALF_WIDTH } from './track';

export type RandomTrackParams = { seed: number; length: number; complexity: number };

type Label = { id: string; name: string };
type Point = [number, number, number];

const MAX_ATTEMPTS = 100;
const SHARP_GAP = 260;
const MIN_RADIUS = 24;
const MAX_REACH = 480;
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

export const randomTrackId = ({ seed, length, complexity }: RandomTrackParams) => `${seed}-${length}-${complexity}`;

export function generateTrack(params: RandomTrackParams): Track {
  const random = mulberry32(params.seed);
  const pick = (words: string[]) => words[Math.floor(random() * words.length)];
  const label = { id: randomTrackId(params), name: `${pick(FIRST_WORDS)} ${pick(SECOND_WORDS)}` };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const track = layout(params, mulberry32(params.seed + attempt * 7919), label);
    if (isRaceable(track)) return track;
  }
  throw new Error(`No raceable layout for track ${label.id} in ${MAX_ATTEMPTS} attempts`);
}

function layout({ length, complexity }: RandomTrackParams, random: () => number, label: Label): Track {
  const count = 5 + 2 * complexity;
  const share = Math.min(0.22 + 0.05 * complexity, (length * 1000) / count / SHARP_GAP);
  const wobble = Math.min(0.3, (share * 2 * Math.PI) / count);
  const [hill, swell] = [random() * Math.PI * 2, random() * Math.PI * 2];
  const outline: Point[] = Array.from({ length: count }, (_, i) => ({
    angle: ((i + (random() - 0.5) * 0.5) / count) * Math.PI * 2,
    radius: 1 + (random() * 2 - 1) * wobble,
  }))
    .sort((a, b) => a.angle - b.angle)
    .map(({ angle, radius }) => [Math.cos(angle) * radius, 6 + 4 * Math.sin(angle + hill) + 3 * Math.sin(2 * angle + swell), Math.sin(angle) * radius]);
  const perimeter = outline.reduce((sum, [x, , z], i) => sum + Math.hypot(x - outline[(i + 1) % count][0], z - outline[(i + 1) % count][2]), 0);
  const scaled = (points: Point[], factor: number): Point[] => points.map(([x, y, z]) => [x * factor, y, z * factor]);
  const rough = scaled(outline, (length * 1000) / perimeter);
  const sized = scaled(rough, (length * 1000) / new Track(rough, TRACK_HALF_WIDTH, label).length);
  const track = new Track(sized, TRACK_HALF_WIDTH, label);
  const first = startIndex(track, sized);
  return new Track([...sized.slice(first), ...sized.slice(0, first)], TRACK_HALF_WIDTH, label);
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
