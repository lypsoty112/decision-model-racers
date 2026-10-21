/*
 * Crash physics: a crashed car becomes a tumbling rigid box until the race respawns it.
 *
 * `startCrash` turns a driving car into a `CrashBody` (centre of mass, velocity, orientation, and
 * angular velocity; mass 1) that keeps the car's velocity and yaw rate. `hit` applies an impulse
 * at a world point, so a push below the centre of mass rolls the box and a lift at its nose
 * pitches it. `stepCrash` advances one fixed step: gravity and spin damping, then each of the
 * box's CORNERS bounces off the ground (`collide`: restitution plus friction, which grass grips
 * hard enough to trip a sliding box into a roll) and off the hedges up to HEDGE_HEIGHT, unless the
 * box has already passed the hedge line. It records the hardest impact speed of the step in
 * `impact`, counts steps with an impact above HARD_IMPACT in `hits`, writes position, heading,
 * and ground speed back to the car, and times how long the box has rested. `crashOver` ends the
 * crash once the box has rested for REST_TIME, has tumbled for MAX_TIME, or has landed beyond the
 * hedges. `liftOf` is how far a car's centre of mass sits above its driving height.
 */
import { Euler, Quaternion, Vector3 } from 'three';
import type { CarState } from './car';
import type { Track } from './track';

export type CrashBody = {
  position: Vector3;
  velocity: Vector3;
  orientation: Quaternion;
  spin: Vector3;
  time: number;
  rest: number;
  impact: number;
  hits: number;
  outside: boolean;
};

export const CENTRE_HEIGHT = 0.7;
const SIZE = new Vector3(2.1, 1.45, 4.3);
const INERTIA = new Vector3(SIZE.y ** 2 + SIZE.z ** 2, SIZE.x ** 2 + SIZE.z ** 2, SIZE.x ** 2 + SIZE.y ** 2).divideScalar(12);
const CORNERS = [-1.05, 1.05].flatMap((x) => [-CENTRE_HEIGHT, 0.75].flatMap((y) => [-1.9, 2.4].map((z) => new Vector3(x, y, z))));
const UP = new Vector3(0, 1, 0);
const GRAVITY = 14;
const SPIN_DAMPING = 0.4;
const RESTITUTION = 0.3;
const BOUNCE_SPEED = 2;
const ROAD_FRICTION = 0.5;
const GRASS_FRICTION = 1.8;
const HEDGE_FRICTION = 0.3;
const HEDGE_FACE = 0.2;
const HEDGE_LINE = 1.1;
const HEDGE_OUTER = 2.3;
const HEDGE_HEIGHT = 1.1;
const HARD_IMPACT = 5;
const REST_SPEED = 1.5;
const REST_TIME = 1;
const MAX_TIME = 6;

export function startCrash(car: CarState): CrashBody {
  const forward = new Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
  car.crash = {
    position: new Vector3(car.x, car.y + CENTRE_HEIGHT, car.z),
    velocity: forward.multiplyScalar(car.speed),
    orientation: new Quaternion().setFromEuler(new Euler(-Math.atan(car.grade), car.yaw, 0, 'YXZ')),
    spin: new Vector3(0, -car.latAccel / (Math.abs(car.speed) > 1 ? car.speed : 1), 0),
    time: 0,
    rest: 0,
    impact: 0,
    hits: 0,
    outside: false,
  };
  return car.crash;
}

export function hit(body: CrashBody, point: Vector3, impulse: Vector3): void {
  push(body, point.clone().sub(body.position), impulse);
}

export function stepCrash(body: CrashBody, car: CarState, track: Track, dt: number): void {
  body.time += dt;
  body.impact = 0;
  body.velocity.y -= GRAVITY * dt;
  body.spin.multiplyScalar(Math.exp(-SPIN_DAMPING * dt));
  body.position.addScaledVector(body.velocity, dt);
  const turn = new Quaternion(body.spin.x * dt * 0.5, body.spin.y * dt * 0.5, body.spin.z * dt * 0.5, 0).multiply(body.orientation);
  body.orientation.set(body.orientation.x + turn.x, body.orientation.y + turn.y, body.orientation.z + turn.z, body.orientation.w + turn.w).normalize();

  const { s, lateral } = track.project(body.position.x, body.position.z, car.s);
  const sample = track.sampleAt(s);
  const right = new Vector3(-sample.tz, 0, sample.tx);
  const side = Math.sign(lateral) || 1;
  const inward = right.clone().multiplyScalar(-side);
  const pastHedge = Math.abs(lateral) > track.wallOffset + HEDGE_LINE;
  let sink = 0;
  let squeeze = 0;
  for (const corner of CORNERS) {
    const offset = corner.clone().applyQuaternion(body.orientation);
    const height = body.position.y + offset.y - sample.y;
    const cornerLateral = lateral + offset.dot(right);
    if (height < 0) {
      sink = Math.max(sink, -height);
      const friction = Math.abs(cornerLateral) > track.halfWidth + 0.8 ? GRASS_FRICTION : ROAD_FRICTION;
      body.impact = Math.max(body.impact, collide(body, offset, UP, friction));
    }
    const intoHedge = side * cornerLateral - track.wallOffset - HEDGE_FACE;
    if (!pastHedge && intoHedge > 0 && height < HEDGE_HEIGHT) {
      squeeze = Math.max(squeeze, intoHedge);
      body.impact = Math.max(body.impact, collide(body, offset, inward, HEDGE_FRICTION));
    }
  }
  body.position.y += sink;
  body.position.addScaledVector(inward, squeeze);
  if (body.impact > HARD_IMPACT) body.hits++;
  const grounded = sink > 0;
  const resting = grounded && body.velocity.length() < REST_SPEED && body.spin.length() < REST_SPEED;
  body.rest = resting ? body.rest + dt : 0;
  body.outside = grounded && Math.abs(lateral) > track.wallOffset + HEDGE_OUTER;

  const forward = new Vector3(0, 0, 1).applyQuaternion(body.orientation);
  if (Math.hypot(forward.x, forward.z) > 0.2) car.yaw = Math.atan2(forward.x, forward.z);
  car.x = body.position.x;
  car.z = body.position.z;
  car.y = sample.y;
  car.s = s;
  car.lateral = lateral;
  car.onRoad = Math.abs(lateral) <= track.halfWidth + 0.8;
  car.speed = Math.hypot(body.velocity.x, body.velocity.z);
  car.steer = car.slip = car.latAccel = car.longAccel = car.grade = car.wallImpact = 0;
}

export const crashOver = (body: CrashBody) => body.rest > REST_TIME || body.time > MAX_TIME || body.outside;

export const liftOf = (car: CarState) => (car.crash ? car.crash.position.y - CENTRE_HEIGHT - car.y : 0);

function collide(body: CrashBody, offset: Vector3, normal: Vector3, friction: number): number {
  const closing = -pointVelocity(body, offset).dot(normal);
  if (closing <= 0) return 0;
  const normalImpulse = ((1 + (closing > BOUNCE_SPEED ? RESTITUTION : 0)) * closing) / response(body, offset, normal);
  push(body, offset, normal.clone().multiplyScalar(normalImpulse));
  const velocity = pointVelocity(body, offset);
  const slide = velocity.addScaledVector(normal, -velocity.dot(normal));
  const slideSpeed = slide.length();
  if (slideSpeed > 1e-6) {
    const against = slide.divideScalar(-slideSpeed);
    push(body, offset, against.multiplyScalar(Math.min(slideSpeed / response(body, offset, against), friction * normalImpulse)));
  }
  return closing;
}

function push(body: CrashBody, offset: Vector3, impulse: Vector3): void {
  body.velocity.add(impulse);
  body.spin.add(angularResponse(body, offset.clone().cross(impulse)));
}

function pointVelocity(body: CrashBody, offset: Vector3): Vector3 {
  return body.spin.clone().cross(offset).add(body.velocity);
}

function response(body: CrashBody, offset: Vector3, direction: Vector3): number {
  return 1 + direction.dot(angularResponse(body, offset.clone().cross(direction)).cross(offset));
}

function angularResponse(body: CrashBody, torque: Vector3): Vector3 {
  return torque.applyQuaternion(body.orientation.clone().invert()).divide(INERTIA).applyQuaternion(body.orientation);
}
