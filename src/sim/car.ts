/*
 * Arcade car physics on the track surface.
 *
 * `createCar` places a stationary car at a distance along the track, facing the racing
 * direction. `isFacingBackwards` tells whether a car points against the racing direction.
 * `stepCar` advances one fixed step: speed responds to throttle, brake, reverse,
 * drag, slope, and grass, and `draft` (slipstream, 0 to 1, set by the race) lowers drag and
 * raises top speed; the smoothed steer input turns the car at whichever is smaller of the
 * wheel-angle yaw rate and a steer-proportional share of grip, and steering past the grip limit
 * becomes `slip`, which scrubs speed. `settleOnTrack` then re-projects the car, holds it inside
 * the walls (bleeding speed by impact angle), and sets its height and road grade. `CAR_SPEC`
 * holds the tuning shared with the bot driver.
 */
import { type Track, wrapAngle } from './track';
import type { Controls } from './types';

export const CAR_SPEC = {
  maxSpeed: 64,
  grassMaxSpeed: 22,
  engineAccel: 17,
  brakeDecel: 30,
  reverseAccel: 9,
  reverseSpeed: 10,
  grip: 24,
  grassGrip: 0.7,
  steerGrip: 1.15,
  slipScrub: 6,
  draftBoost: 0.08,
  wheelbase: 2.6,
  maxSteer: 0.55,
  steerRate: 5,
  radius: 1.4,
};

export type CarState = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  steer: number;
  s: number;
  lateral: number;
  grade: number;
  onRoad: boolean;
  slip: number;
  draft: number;
  longAccel: number;
  latAccel: number;
};

export function createCar(track: Track, s: number, lateral: number): CarState {
  const point = track.pointAt(s, lateral);
  const sample = track.sampleAt(s);
  return {
    ...point,
    yaw: Math.atan2(sample.tx, sample.tz),
    speed: 0,
    steer: 0,
    s: track.wrap(s),
    lateral,
    grade: 0,
    onRoad: true,
    slip: 0,
    draft: 0,
    longAccel: 0,
    latAccel: 0,
  };
}

export function isFacingBackwards(car: CarState, track: Track): boolean {
  const sample = track.sampleAt(car.s);
  return Math.cos(wrapAngle(Math.atan2(sample.tx, sample.tz) - car.yaw)) < -0.3;
}

export function stepCar(car: CarState, controls: Controls, track: Track, dt: number): void {
  const spec = CAR_SPEC;
  const startSpeed = car.speed;
  const topSpeed = (car.onRoad ? spec.maxSpeed : spec.grassMaxSpeed) * (1 + spec.draftBoost * car.draft);
  const forward = Math.max(0, car.speed);

  let accel = controls.throttle * spec.engineAccel * Math.max(0, 1 - (forward / topSpeed) ** 2);
  if (controls.brake > 0 && car.speed > 0.5) accel -= spec.brakeDecel * controls.brake;
  else if (controls.brake > 0 && car.speed > -spec.reverseSpeed) accel -= spec.reverseAccel * controls.brake;
  accel -= Math.sign(car.speed) * (0.8 + 0.00035 * (1 - 0.5 * car.draft) * car.speed * car.speed);
  if (forward > topSpeed) accel -= 14;
  accel -= 9.81 * car.grade * 0.7;
  car.speed += accel * dt;
  if (controls.throttle === 0 && controls.brake === 0 && Math.abs(car.speed) < 0.3) car.speed = 0;

  car.steer += Math.max(-spec.steerRate * dt, Math.min(spec.steerRate * dt, controls.steer - car.steer));
  const speedAbs = Math.abs(car.speed);
  const grip = spec.grip * (car.onRoad ? 1 : spec.grassGrip);
  const wheelYaw = (speedAbs * Math.tan(Math.abs(car.steer) * spec.maxSteer)) / spec.wheelbase;
  const gripYaw = (grip * spec.steerGrip * Math.abs(car.steer)) / Math.max(speedAbs, 1);
  const turnRate = Math.min(wheelYaw, gripYaw, grip / Math.max(speedAbs, 1));
  car.slip = gripYaw < wheelYaw ? Math.max(0, (spec.steerGrip * Math.abs(car.steer) - 1) / (spec.steerGrip - 1)) : 0;
  const yawRate = Math.sign(car.steer) * Math.sign(car.speed) * turnRate;
  car.speed -= Math.sign(car.speed) * car.slip * spec.slipScrub * dt;

  car.yaw = wrapAngle(car.yaw - yawRate * dt);
  car.x += Math.sin(car.yaw) * car.speed * dt;
  car.z += Math.cos(car.yaw) * car.speed * dt;
  car.latAccel = yawRate * car.speed;
  car.longAccel = (car.speed - startSpeed) / dt;
  settleOnTrack(car, track);
}

function settleOnTrack(car: CarState, track: Track): void {
  const { s, lateral } = track.project(car.x, car.z, car.s);
  let sample = track.sampleAt(s);
  const trackYaw = Math.atan2(sample.tx, sample.tz);
  if (Math.abs(lateral) > track.wallOffset) {
    const push = lateral - Math.sign(lateral) * track.wallOffset;
    car.x += sample.tz * push;
    car.z -= sample.tx * push;
    let alignError = wrapAngle(trackYaw - car.yaw);
    if (Math.abs(alignError) > Math.PI / 2) alignError = wrapAngle(alignError + Math.PI);
    car.speed *= 1 - 0.5 * Math.abs(Math.sin(alignError)) - 0.002;
    car.yaw = wrapAngle(car.yaw + alignError * 0.2);
  }
  car.s = s;
  car.lateral = Math.max(-track.wallOffset, Math.min(track.wallOffset, lateral));
  car.onRoad = Math.abs(car.lateral) <= track.halfWidth + 0.8;
  sample = track.sampleAt(s);
  car.y = sample.y;
  const slope = (track.sampleAt(s + 2).y - track.sampleAt(s - 2).y) / 4;
  car.grade = slope * Math.cos(trackYaw - car.yaw);
}
