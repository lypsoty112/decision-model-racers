/*
 * The built-in algorithmic driver, which sees nothing but its `RacerObservation`.
 *
 * `BotDriver.decide` steers with pure pursuit towards a point ahead on the line from
 * `racingLine`, and lifts when a slower car sits right in its path instead of ramming it.
 * `racingLine` eases at `lineShift` metres per second towards a passing line, a defending line, or,
 * when there is nothing to pass or defend, the line `giveRoom` picks. `passTarget` starts a pass on
 * the nearest car up to PASS_START metres ahead that the bot is closing on (aggressive bots need
 * less closing speed, and every bot attacks a car it has followed for longer than its patience),
 * commits to the inside of the next corner (or the other side when the inside has no room), and
 * holds that side until the car is PASS_CLEAR metres
 * behind or has pulled away; a failed pass rules that car out for COOLDOWN seconds. `defendLine`
 * reacts once to each car closing in from behind: with a chance set by `defence` the bot moves to
 * cover the inside of the next corner and holds that line until the car drops back or comes
 * alongside. `giveRoom` scores lines by their distance from the preferred line (the bot's lane,
 * pulled to the inside of upcoming curvature by `apex`) plus their overlap with cars alongside,
 * weighted by `berth`, so a car being passed moves over rather than turning in. `steerFor` inverts
 * the car's steering model to get the input that produces the pursuit curvature.
 *
 * `targetSpeed` is the lowest of the bot's top speed and, for every curvature sample ahead, the
 * speed from which it can still brake, using the `brake` share of full braking, to that sample's
 * cornering speed at the grip `gripNow` allows. `gripNow` scales the profile's grip by the race's
 * form roll, a slow biorhythm whose dip grows as `consistency` falls, an easier pace on the middle
 * laps, extra grip while passing (more for higher `aggression`), and, on corners where
 * `cornerMistake` rolled a mistake (likelier for lower `composure`), an overestimate that makes the
 * bot brake late and run wide. `BotProfile` holds the grip and top speed a bot dares to use plus
 * those driving-style knobs, and `personality` names the style for the HUD and the race report.
 */
import { CAR_SPEC } from './car';
import type { Controls, Driver, OpponentState, RacerObservation, TrackPointAhead } from './types';

export type BotProfile = {
  grip: number;
  pace: number;
  lane: number;
  brake: number;
  berth: number;
  lineShift: number;
  apex: number;
  consistency: number;
  aggression: number;
  defence: number;
  composure: number;
};

const EDGE_MARGIN = 2.5;
const PASS_WIDTH = 4.4;
const PASS_START = 20;
const PASS_CLEAR = 4;
const CLOSING_SPEED = 0.5;
const ALONGSIDE = 4;
const BLOCK_RANGE = 6;
const BLOCK_WIDTH = 2.4;
const PATIENCE = 10;
const COOLDOWN = 3;
const DEFEND_RANGE = 14;
const DEFEND_LINE = 0.6;
const FORM_RANGE = 0.1;
const RHYTHM_SWING = 0.07;
const CRUISE = 0.985;
const PASS_PUSH = 0.12;
const MISTAKE_CHANCE = 0.5;
const MISTAKE_GRIP = 1.45;

export class BotDriver implements Driver {
  readonly kind = 'bot';
  readonly personality: string;
  private readonly profile: BotProfile;
  private readonly random: () => number;
  private readonly form: number;
  private readonly rhythm: { period: number; phase: number };
  private line = 0;
  private pass: { id: string; side: number } | null = null;
  private cooldown = { id: '', until: 0 };
  private following = { id: '', since: 0 };
  private defend: { id: string; line: number | null } | null = null;
  private corner = { index: 0, mistake: false };

  constructor(profile: BotProfile, personality: string, random: () => number) {
    this.profile = profile;
    this.personality = personality;
    this.random = random;
    this.form = 1 + (random() - 0.5) * FORM_RANGE;
    this.rhythm = { period: 40 + random() * 50, phase: random() * 2 * Math.PI };
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
    const defending = passing ? null : this.defendLine(observation, usable);
    const goal = passing
      ? clamp(passing.car.lateralOffset + passing.side * PASS_WIDTH)
      : (defending ?? this.giveRoom(observation, preferred, usable));
    const shift = this.profile.lineShift * dt;
    this.line += Math.max(-shift, Math.min(shift, goal - this.line));
    return this.line;
  }

  private passTarget(observation: RacerObservation, usable: number): { car: OpponentState; side: number } | null {
    const { opponents, raceTime } = observation;
    const room = (car: OpponentState, side: number) => usable - side * car.lateralOffset;
    const current = opponents.find((other) => other.id === this.pass?.id && other.z > -PASS_CLEAR && other.z < PASS_START);
    if (current && this.pass) return { car: current, side: this.pass.side };
    if (this.pass) this.cooldown = { id: this.pass.id, until: raceTime + COOLDOWN };
    const followed = opponents.find((other) => other.z > 0 && other.z < PASS_START && Math.abs(other.x) < PASS_WIDTH);
    if (followed?.id !== this.following.id) this.following = { id: followed?.id ?? '', since: raceTime };
    const impatient = raceTime - this.following.since > PATIENCE * (1 - this.profile.aggression);
    const next = opponents.find(
      (other) =>
        other.z > 0 &&
        other.z < PASS_START &&
        !(other.id === this.cooldown.id && raceTime < this.cooldown.until) &&
        (other.relativeSpeed < -CLOSING_SPEED * (1 - this.profile.aggression) || (other.id === this.following.id && impatient)),
    );
    if (!next) {
      this.pass = null;
      return null;
    }
    const inside = insideOf(observation);
    const side = room(next, inside) >= PASS_WIDTH ? inside : -inside;
    this.pass = { id: next.id, side };
    return { car: next, side };
  }

  private defendLine(observation: RacerObservation, usable: number): number | null {
    const behind = (other: OpponentState) => other.z < -ALONGSIDE && other.z > -DEFEND_RANGE;
    if (observation.opponents.some((other) => other.id === this.defend?.id && behind(other))) return this.defend?.line ?? null;
    const attacker = observation.opponents.find((other) => behind(other) && other.relativeSpeed > 0);
    this.defend = attacker ? { id: attacker.id, line: this.random() < this.profile.defence ? insideOf(observation) * usable * DEFEND_LINE : null } : null;
    return this.defend?.line ?? null;
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

  private gripNow(observation: RacerObservation): number {
    const { raceTime, lap, totalLaps } = observation;
    const wave = 0.5 + 0.5 * Math.sin((2 * Math.PI * raceTime) / this.rhythm.period + this.rhythm.phase);
    const rhythm = 1 - RHYTHM_SWING * (1 - this.profile.consistency) * wave;
    const effort = lap === 1 || lap === totalLaps ? 1 : CRUISE;
    const push = this.pass ? 1 + PASS_PUSH * this.profile.aggression : 1;
    const mistake = this.cornerMistake(observation) ? MISTAKE_GRIP : 1;
    return CAR_SPEC.grip * this.profile.grip * this.form * rhythm * effort * push * mistake;
  }

  private cornerMistake(observation: RacerObservation): boolean {
    const next = observation.track.corners[0];
    if (next && next.index !== this.corner.index) {
      this.corner = { index: next.index, mistake: this.random() < MISTAKE_CHANCE * (1 - this.profile.composure) };
    }
    return this.corner.mistake;
  }

  private targetSpeed(observation: RacerObservation): number {
    const { curvatureAhead, curvatureStep } = observation.track;
    const grip = this.gripNow(observation);
    return curvatureAhead.reduce((limit, curvature, i) => {
      const cornerSpeed = Math.sqrt(grip / Math.max(Math.abs(curvature), 1e-4));
      const brakingRoom = Math.max(0, i * curvatureStep - 6);
      return Math.min(limit, Math.sqrt(cornerSpeed ** 2 + 2 * CAR_SPEC.brakeDecel * this.profile.brake * brakingRoom));
    }, observation.maxSpeed * this.profile.pace * this.form);
  }
}

function insideOf(observation: RacerObservation): number {
  return observation.track.corners.find((corner) => corner.distance >= 0)?.direction === 'left' ? -1 : 1;
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
