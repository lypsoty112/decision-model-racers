/*
 * The built-in algorithmic driver, which sees nothing but its `RacerObservation`.
 *
 * `BotDriver.decide` steers with pure pursuit towards a point ahead on a racing line from
 * `racingLine`, which scores candidate lines across the road by their distance from the bot's
 * preferred line (its own lane, pulled to the inside of upcoming curvature) plus their overlap
 * with slower cars ahead, and eases towards the cheapest one. `steerFor` inverts the car's steering model to get the input
 * that produces the pursuit curvature. `targetSpeed` is the lowest of the bot's top speed and,
 * for every curvature sample ahead, the speed from which it can still brake to that sample's
 * grip-limited cornering speed. `BotProfile` scales the grip and top speed a bot dares to use.
 */
import { CAR_SPEC } from './car';
import type { Controls, Driver, RacerObservation, TrackPointAhead } from './types';

export type BotProfile = { grip: number; pace: number; lane: number };

const EDGE_MARGIN = 2.5;
const PASS_WIDTH = 3.6;
const TRAFFIC_RANGE = 30;
const LINE_SHIFT_RATE = 7;

export class BotDriver implements Driver {
  readonly kind = 'bot';
  private readonly profile: BotProfile;
  private line = 0;

  constructor(profile: BotProfile) {
    this.profile = profile;
  }

  decide(observation: RacerObservation, dt: number): Controls {
    const speed = Math.max(observation.speed, 0);
    const lookahead = Math.min(45, 9 + speed * 0.5);
    const target = pointAhead(observation.track.pointsAhead, lookahead);
    const aimX = target.x + this.racingLine(observation, target.curvature, dt);
    const curvature = (2 * aimX) / (aimX * aimX + target.z * target.z);
    const excess = speed - this.targetSpeed(observation);
    return {
      throttle: excess < 0 ? 1 : excess < 1.5 ? 0.4 : 0,
      brake: excess > 2.5 ? Math.min(1, excess / 8) : 0,
      steer: steerFor(curvature, speed),
    };
  }

  private racingLine(observation: RacerObservation, curvature: number, dt: number): number {
    const usable = observation.trackHalfWidth - EDGE_MARGIN;
    const preferred = Math.max(-usable, Math.min(usable, this.profile.lane + curvature * 700));
    const traffic = observation.opponents.filter(
      (other) => other.z > -2 && other.z < TRAFFIC_RANGE && other.relativeSpeed < 2,
    );
    let best = preferred;
    let bestCost = Infinity;
    for (let line = -usable; line <= usable; line += 0.5) {
      const cost = traffic.reduce(
        (sum, other) => sum + Math.max(0, PASS_WIDTH - Math.abs(other.lateralOffset - line)) * (TRAFFIC_RANGE - other.z) / 10,
        Math.abs(line - preferred) * 0.3,
      );
      if (cost < bestCost) {
        bestCost = cost;
        best = line;
      }
    }
    this.line += Math.max(-LINE_SHIFT_RATE * dt, Math.min(LINE_SHIFT_RATE * dt, best - this.line));
    return this.line;
  }

  private targetSpeed(observation: RacerObservation): number {
    const { curvatureAhead, curvatureStep } = observation.track;
    const grip = CAR_SPEC.grip * this.profile.grip;
    return curvatureAhead.reduce((limit, curvature, i) => {
      const cornerSpeed = Math.sqrt(grip / Math.max(Math.abs(curvature), 1e-4));
      const brakingRoom = Math.max(0, i * curvatureStep - 6);
      return Math.min(limit, Math.sqrt(cornerSpeed ** 2 + 2 * CAR_SPEC.brakeDecel * 0.7 * brakingRoom));
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
