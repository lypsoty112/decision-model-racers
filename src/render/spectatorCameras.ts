/*
 * The spectator cameras: a whole-track overhead view and a TV director.
 *
 * `OverheadCamera` frames the entire circuit from high above, tilted OVERHEAD_TILT radians
 * towards the viewer for depth; `resize` moves it so the track fits any aspect ratio and records
 * that `distance` to the track's centre. On a
 * portrait screen it turns a quarter and widens the vertical field of view, so the track's long
 * side runs down the screen at the same distance as in landscape, well inside the fog.
 * `TvCamera` films from trackside posts placed every POST_SPACING metres on the outside of the
 * next bend, raised above the hedges. Every DIRECTOR_INTERVAL seconds `pickSubject` chooses the
 * chasing car of the closest battle under BATTLE_GAP metres, or else the leader. The active post
 * is the nearest one the subject has not passed by more than CUT_AFTER metres, so the view cuts
 * from post to post while the camera pans after the subject and zooms to keep FRAME_WIDTH metres
 * in shot. `TvCamera.update` returns the id of the racer it is filming.
 */
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { Race, Racer } from '../sim/race';
import type { Track } from '../sim/track';

const OVERHEAD_FOV = 35;
const OVERHEAD_TILT = 0.3;
const OVERHEAD_MARGIN = 1.3;
const POST_SPACING = 110;
const POST_OFFSET = 4;
const POST_HEIGHT = 6;
const DIRECTOR_INTERVAL = 4;
const BATTLE_GAP = 25;
const CUT_AFTER = 30;
const FRAME_WIDTH = 16;

type Post = { s: number; position: Vector3 };

export class OverheadCamera {
  readonly camera = new PerspectiveCamera(OVERHEAD_FOV, 1, 10, 8000);
  distance = 0;
  private readonly center: Vector3;
  private readonly width: number;
  private readonly depth: number;

  constructor(track: Track) {
    const xs = track.samples.map((sample) => sample.x);
    const zs = track.samples.map((sample) => sample.z);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    this.center = new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.width = maxX - minX + track.wallOffset * 2;
    this.depth = maxZ - minZ + track.wallOffset * 2;
  }

  resize(width: number, height: number): void {
    const aspect = width / height;
    const portrait = aspect < 1;
    const stretch = portrait ? 1 / aspect : aspect;
    const tanHalf = Math.tan(MathUtils.degToRad(OVERHEAD_FOV / 2));
    const distance = (Math.max(this.depth, this.width / stretch) * OVERHEAD_MARGIN) / (2 * tanHalf);
    const lean = distance * Math.sin(OVERHEAD_TILT);
    this.distance = distance;
    this.camera.aspect = aspect;
    this.camera.fov = portrait ? MathUtils.radToDeg(2 * Math.atan(tanHalf * stretch)) : OVERHEAD_FOV;
    this.camera.position.set(this.center.x + (portrait ? lean : 0), distance * Math.cos(OVERHEAD_TILT), this.center.z + (portrait ? 0 : lean));
    this.camera.lookAt(this.center);
    this.camera.updateProjectionMatrix();
  }
}

function pickSubject(race: Race): Racer {
  const standings = race.standings();
  const running = standings.filter((racer) => racer.finishTime === null);
  let subject = running[0] ?? standings[0];
  let closest = BATTLE_GAP;
  for (let i = 1; i < running.length; i++) {
    const gap = running[i - 1].progress - running[i].progress;
    if (gap < closest) {
      closest = gap;
      subject = running[i];
    }
  }
  return subject;
}

export class TvCamera {
  readonly camera = new PerspectiveCamera(30, 1, 0.5, 5000);
  private readonly track: Track;
  private readonly posts: Post[];
  private readonly look = new Vector3();
  private readonly target = new Vector3();
  private post: Post | null = null;
  private subjectId = '';
  private sinceDecision = Infinity;

  constructor(track: Track) {
    this.track = track;
    this.posts = Array.from({ length: Math.floor(track.length / POST_SPACING) }, (_, i) => {
      const s = i * POST_SPACING;
      const side = track.sampleAt(s + 50).curvature > 0 ? -1 : 1;
      const point = track.pointAt(s, side * (track.wallOffset + POST_OFFSET));
      return { s, position: new Vector3(point.x, point.y + POST_HEIGHT, point.z) };
    });
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(race: Race, dt: number): string {
    this.sinceDecision += dt;
    let subject = race.racers.find((racer) => racer.id === this.subjectId);
    if (!subject || this.sinceDecision >= DIRECTOR_INTERVAL) {
      subject = pickSubject(race);
      this.subjectId = subject.id;
      this.sinceDecision = 0;
    }
    const { car } = subject;
    const post = this.posts.reduce((best, candidate) => {
      const ahead = this.track.signedDistance(car.s, candidate.s);
      const bestAhead = this.track.signedDistance(car.s, best.s);
      if (ahead < -CUT_AFTER) return best;
      return bestAhead < -CUT_AFTER || ahead < bestAhead ? candidate : best;
    });
    this.target.set(car.x, car.y + 1, car.z);
    const fov = MathUtils.clamp(MathUtils.radToDeg(2 * Math.atan(FRAME_WIDTH / 2 / post.position.distanceTo(this.target))), 6, 55);
    if (post !== this.post) {
      this.post = post;
      this.camera.position.copy(post.position);
      this.look.copy(this.target);
      this.camera.fov = fov;
    }
    this.look.lerp(this.target, 1 - Math.exp(-dt * 8));
    this.camera.lookAt(this.look);
    this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 4));
    this.camera.updateProjectionMatrix();
    return subject.id;
  }
}
