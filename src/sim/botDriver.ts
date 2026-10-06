/*
 * The built-in algorithmic driver, which sees nothing but its `RacerObservation`.
 *
 * `BotDriver.decide` steers with pure pursuit towards a point ahead on the line from
 * `racingLine`, and lifts when a slower car sits right in its path instead of ramming it.
 * `racingLine` eases at `lineShift` metres per second towards either a passing line or, when
 * there is nothing to pass, the line `giveRoom` picks. `passTarget` starts a pass on the nearest
 * car up to PASS_START metres ahead that the bot is closing on, commits to the inside of the next
 * corner (or the other side when the inside has no room), and holds that side until the car is
 * PASS_CLEAR metres behind or has pulled away; until then the bot drives in its slipstream on the
 * racing line. `giveRoom` scores lines by their distance from the preferred line (the bot's lane,
 * pulled to the inside of upcoming curvature by `apex`) plus their overlap with cars alongside,
 * weighted by `berth`, so a car being passed moves over rather than turning in. `steerFor`
 * inverts the car's steering model to get the input that produces the pursuit curvature.
 * `targetSpeed` is the lowest of the bot's top speed and, for every curvature sample ahead, the
 * speed from which it can still brake, using the `brake` share of full braking, to that sample's
 * grip-limited cornering speed. `BotProfile` holds the grip and top speed a bot dares to use plus
 * those driving-style knobs, and `personality` names the style for the HUD and the race report.
 */
import { CAR_SPEC } from './car';
import type { Controls, Driver, OpponentState, RacerObservation, TrackPointAhead } from './types';

export type BotProfile = { grip: number; pace: number; lane: number; brake: number; berth: number; lineShift: number; apex: number };

const EDGE_MARGIN = 2.5;
const PASS_WIDTH = 4.4;
const PASS_START = 20;
const PASS_CLEAR = 4;
const CLOSING_SPEED = 0.5;
const ALONGSIDE = 4;
const BLOCK_RANGE = 6;
const BLOCK_WIDTH = 2.4;

export class BotDriver implements Driver {
  readonly kind = 'bot';
  readonly personality: string;
  private readonly profile: BotProfile;
  private line = 0;
  private pass: { id: string; side: number } | null = null;

  constructor(profile: BotProfile, personality: string) {
    this.profile = profile;
    this.personality = personality;
  }

  decide(observation: RacerObservation, dt: number): Controls {
    const speed = Math.max(observation.speed, 0);
    const lookahead = Math.min(45, 9 + speed * 0.5);
    const target = pointAhead(observation.track.pointsAhead, lookahead);
    const aimX = target.x + this.racingLine(observation, target.curvature, dt);
    const curvature = (2 * aimX) / (aimX * aimX + target.z * target.z);
    const blocker = observation.opponents.find((other) => other.z > 0 && other.z < BLOCK_RANGE && Math.abs(other.x) < BLOCK_WIDTH && other.relativeSpeed < 0);
    const excess = speed - Math.min(this.targetSpeed(observation), blocker ? speed + blocker.relativeSpeed : Infinity);
    return {
      throttle: excess < 0 ? 1 : excess < 1.5 ? 0.4 : 0,
      brake: excess > 2.5 ? Math.min(1, excess / 8) : 0,
      steer: steerFor(curvature, speed),
    };
  }

  private racingLine(observation: RacerObservation, curvature: number, dt: number): number {
    const usable = observation.trackHalfWidth - EDGE_MARGIN;
    const clamp = (line: number) => Math.max(-usable, Math.min(usable, line));
    const preferred = clamp(this.profile.lane + curvature * 700 * this.profile.apex);
    const passing = this.passTarget(observation, usable);
    const goal = passing ? clamp(passing.car.lateralOffset + passing.side * PASS_WIDTH) : this.giveRoom(observation, preferred, usable);
    const shift = this.profile.lineShift * dt;
    this.line += Math.max(-shift, Math.min(shift, goal - this.line));
    return this.line;
  }

  private passTarget(observation: RacerObservation, usable: number): { car: OpponentState; side: number } | null {
    const current = observation.opponents.find((other) => other.id === this.pass?.id && other.z > -PASS_CLEAR && other.z < PASS_START);
    if (current && this.pass) return { car: current, side: this.pass.side };
    const next = observation.opponents.find((other) => other.z > 0 && other.z < PASS_START && other.relativeSpeed < -CLOSING_SPEED);
    if (!next) {
      this.pass = null;
      return null;
    }
    const inside = observation.track.corners.find((corner) => corner.distance >= 0)?.direction === 'left' ? -1 : 1;
    const side = usable - inside * next.lateralOffset >= PASS_WIDTH ? inside : -inside;
    this.pass = { id: next.id, side };
    return { car: next, side };
  }

  private giveRoom(observation: RacerObservation, preferred: number, usable: number): number {
    const alongside = observation.opponents.filter((other) => other.z > -ALONGSIDE && other.z < ALONGSIDE);
    let best = preferred;
    let bestCost = Infinity;
    for (let line = -usable; line <= usable; line += 0.5) {
      const cost = alongside.reduce(
        (sum, other) => sum + Math.max(0, PASS_WIDTH - Math.abs(other.lateralOffset - line)) * this.profile.berth,
        Math.abs(line - preferred) * 0.3,
      );
      if (cost < bestCost) {
        bestCost = cost;
        best = line;
      }
    }
    return best;
  }

  private targetSpeed(observation: RacerObservation): number {
    const { curvatureAhead, curvatureStep } = observation.track;
    const grip = CAR_SPEC.grip * this.profile.grip;
    return curvatureAhead.reduce((limit, curvature, i) => {
      const cornerSpeed = Math.sqrt(grip / Math.max(Math.abs(curvature), 1e-4));
      const brakingRoom = Math.max(0, i * curvatureStep - 6);
      return Math.min(limit, Math.sqrt(cornerSpeed ** 2 + 2 * CAR_SPEC.brakeDecel * this.profile.brake * brakingRoom));
    }, observation.maxSpeed * this.profile.pace);
  }
}

function steerFor(curvature: number, speed: number): number {
  const byWheelAngle = Math.atan(Math.abs(curvature) * CAR_SPEC.wheelbase) / CAR_SPEC.maxSteer;
  const byGrip = (Math.abs(curvature) * speed * speed) / (CAR_SPEC.grip * CAR_SPEC.steerGrip);
  return Math.sign(curvature) * Math.min(1, Math.max(byWheelAngle, byGrip));
}

function pointAhead(points: TrackPointAhead[], distance: number): TrackPointAhead {
  const nextIndex = points.findIndex((point) => point.distance >= distance);
  if (nextIndex <= 0) return points[nextIndex === 0 ? 0 : points.length - 1];
  const a = points[nextIndex - 1];
  const b = points[nextIndex];
  const t = (distance - a.distance) / (b.distance - a.distance);
  return {
    distance,
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    curvature: a.curvature + (b.curvature - a.curvature) * t,
  };
}
