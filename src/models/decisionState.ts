/*
 * The protocol between a racer's observation and an OpenRouter decision model.
 *
 * An answer lands about 300 ms after the state is read, so `predict` first dead-reckons the
 * observation to the moment the answer takes effect, holding the controls the car has now: it
 * integrates speed and yaw with the car's steering model in the car's own frame, then re-expresses
 * the road points, curvature, corners, position, heading, and opponents from that pose.
 * `describeState` writes that future as short sentences of named buckets, because decision models
 * judge categories well and compare numbers poorly: where the road goes relative to the kart's
 * nose in half a second and in one second, position and facing on the road, speed against the safe
 * speed for the bends ahead (from the share of grip the `DrivingStyle` allows), the current or next
 * corner, the kart's own health, nearby cars with their health, the style and its meaning, and the
 * last HISTORY_LENGTH decisions. `DECISION_QUESTIONS` asks for steering and pedal as choices whose
 * descriptions point at those sentences, and `toControls` maps the chosen steering level through
 * STEER_VALUES and the chosen pedal through PEDALS onto the same controls a human uses, returning
 * the named decision alongside for the history.
 */
import type { DecisionsChoiceQuestion, DecisionsResponse } from '@openrouter/sdk/models';
import { CAR_SPEC } from '../sim/car';
import type { Controls, RacerObservation } from '../sim/types';

export type Decision = { steer: string; pedal: string };
export type DrivingStyle = 'safe' | 'balanced' | 'aggressive';

export const DRIVING_STYLES: Record<DrivingStyle, { grip: number; meaning: string }> = {
  safe: { grip: 0.75, meaning: 'Finish cleanly. Brake early, keep a margin to the road edge, and avoid contact with other cars.' },
  balanced: { grip: 0.83, meaning: 'Race hard but tidy. Take normal racing lines and only pass when there is room.' },
  aggressive: {
    grip: 0.92,
    meaning: 'Win at all costs. Carry maximum speed, brake late, take tight lines, and attack every car ahead even at the risk of running wide.',
  },
};

const HISTORY_LENGTH = 2;
const NEARBY = 30;
const STEER_VALUES: Record<string, number> = { 'hard left': -1, left: -2 / 3, 'slight left': -1 / 3, straight: 0, 'slight right': 1 / 3, right: 2 / 3, 'hard right': 1 };
const PEDALS: Record<string, { throttle: number; brake: number; meaning: string }> = {
  full_throttle: { throttle: 1, brake: 0, meaning: 'The speed is below the safe speed, or you are stopped.' },
  part_throttle: { throttle: 0.5, brake: 0, meaning: 'The speed is at the safe speed while you are turning.' },
  coast: { throttle: 0, brake: 0, meaning: 'The speed is at the safe speed and a bend is coming.' },
  brake: { throttle: 0, brake: 0.5, meaning: 'The speed is too fast for the bend ahead.' },
  hard_brake: { throttle: 0, brake: 1, meaning: 'The speed is far too fast for the bend ahead. Never when stopped or slow.' },
};

export const DECISION_QUESTIONS: Record<'steer' | 'pedal', DecisionsChoiceQuestion> = {
  steer: {
    type: 'choice',
    instructions: 'Pick the steering to hold for the next 0.3 seconds, based on the road ahead, your position, and where you face.',
    criteria: {
      'hard left': 'The road ahead is sharply left, or you are off the road on the right or facing well right of the road.',
      left: 'The road ahead is left.',
      'slight left': 'The road ahead is slightly left, or you are drifting towards the right edge.',
      straight: 'The road ahead is straight ahead and you face along the road.',
      'slight right': 'The road ahead is slightly right, or you are drifting towards the left edge.',
      right: 'The road ahead is right.',
      'hard right': 'The road ahead is sharply right, or you are off the road on the left or facing well left of the road.',
    },
  },
  pedal: {
    type: 'choice',
    instructions: 'Pick the pedal to hold for the next 0.3 seconds, based on the speed.',
    criteria: Object.fromEntries(Object.entries(PEDALS).map(([key, pedal]) => [key, pedal.meaning])),
  },
};

const degrees = (radians: number) => (radians * 180) / Math.PI;

export function predict(o: RacerObservation, controls: Controls, seconds: number): RacerObservation {
  const dt = 1 / 60;
  let x = 0;
  let z = 0;
  let heading = 0;
  let speed = Math.max(0, o.speed);
  for (let t = 0; t < seconds; t += dt) {
    const accel = controls.throttle * CAR_SPEC.engineAccel * Math.max(0, 1 - (speed / o.maxSpeed) ** 2) - controls.brake * CAR_SPEC.brakeDecel - 0.8 - 0.00035 * speed * speed;
    speed = Math.max(0, speed + accel * dt);
    const wheelYaw = (speed * Math.tan(Math.abs(controls.steer) * CAR_SPEC.maxSteer)) / CAR_SPEC.wheelbase;
    const gripYaw = (CAR_SPEC.grip * CAR_SPEC.steerGrip * Math.abs(controls.steer)) / Math.max(speed, 1);
    heading += Math.sign(controls.steer) * Math.min(wheelYaw, gripYaw, CAR_SPEC.grip / Math.max(speed, 1)) * dt;
    x += Math.sin(heading) * speed * dt;
    z += Math.cos(heading) * speed * dt;
  }
  const travelled = Math.hypot(x, z);
  const fromPose = (px: number, pz: number) => ({
    x: (px - x) * Math.cos(heading) - (pz - z) * Math.sin(heading),
    z: (px - x) * Math.sin(heading) + (pz - z) * Math.cos(heading),
  });
  const { curvatureAhead, curvatureStep } = o.track;
  const shift = Math.min(curvatureAhead.length - 1, Math.round(travelled / curvatureStep));
  const turned = curvatureAhead.slice(0, Math.max(1, shift)).reduce((sum, curvature) => sum + curvature, 0) * curvatureStep;
  const headingError = o.headingError + heading - turned;
  return {
    ...o,
    speed,
    headingError,
    lateralOffset: o.lateralOffset + travelled * Math.sin((o.headingError + headingError) / 2),
    track: {
      ...o.track,
      curvatureAhead: [...curvatureAhead.slice(shift), ...Array<number>(shift).fill(curvatureAhead[curvatureAhead.length - 1])],
      pointsAhead: o.track.pointsAhead.map((point) => ({ ...point, ...fromPose(point.x, point.z) })).filter((point) => point.z > 0),
      corners: o.track.corners.map((corner) => ({ ...corner, distance: corner.distance - travelled })),
    },
    opponents: o.opponents.map((other) => {
      const moved = fromPose(other.x, other.z + other.speed * seconds);
      return { ...other, ...moved, distance: Math.hypot(moved.x, moved.z), relativeSpeed: other.speed - speed };
    }),
  };
}

function roadAt(o: RacerObservation, seconds: number): string {
  const points = o.track.pointsAhead;
  const point = points.find((p) => p.z >= Math.max(o.speed, 8) * seconds) ?? points[points.length - 1];
  if (!point) return 'out of sight';
  const angle = degrees(Math.atan2(point.x, point.z));
  const side = angle > 0 ? 'right' : 'left';
  const size = Math.abs(angle);
  return size < 3 ? 'straight ahead' : size < 10 ? `slightly ${side}` : size < 25 ? side : `sharply ${side}`;
}

function safeSpeed(o: RacerObservation, grip: number): number {
  return o.track.curvatureAhead.reduce((limit, curvature, i) => {
    const cornerSpeed = Math.sqrt((CAR_SPEC.grip * grip) / Math.max(Math.abs(curvature), 1e-4));
    return Math.min(limit, Math.sqrt(cornerSpeed ** 2 + 2 * CAR_SPEC.brakeDecel * 0.7 * Math.max(0, i * o.track.curvatureStep - 6)));
  }, o.maxSpeed);
}

function speedOf(o: RacerObservation, grip: number): string {
  if (o.speed < -0.5) return 'rolling backwards';
  if (o.speed < 1) return 'stopped';
  const margin = (safeSpeed(o, grip) - o.speed) * 3.6;
  if (margin > 25) return 'well below the safe speed, with room to accelerate';
  if (margin > 6) return 'a little below the safe speed';
  if (margin > -6) return 'at the safe speed for the bends ahead';
  return margin > -20 ? 'too fast for the bend ahead' : 'far too fast for the bend ahead, so brake hard';
}

function positionOf(o: RacerObservation): string {
  const share = o.lateralOffset / o.trackHalfWidth;
  if (o.offTrack) return share < 0 ? 'off the road on the left' : 'off the road on the right';
  if (share < -0.7) return 'at the left edge';
  if (share < -0.25) return 'left of centre';
  if (share <= 0.25) return 'in the middle of the road';
  return share <= 0.7 ? 'right of centre' : 'at the right edge';
}

function facingOf(o: RacerObservation): string {
  const angle = degrees(o.headingError);
  const side = angle > 0 ? 'right' : 'left';
  if (Math.abs(angle) > 110) return 'facing backwards';
  if (Math.abs(angle) > 45) return `sideways with the nose pointing ${side}`;
  if (Math.abs(angle) < 3) return 'facing along the road';
  return Math.abs(angle) < 12 ? `facing slightly ${side} of the road` : `facing well ${side} of the road`;
}

const healthOf = (health: number) => (health >= 70 ? 'healthy' : health >= 45 ? 'damaged' : health >= 20 ? 'badly damaged' : 'barely holding together');

function cornerOf(o: RacerObservation): string {
  const sharpness = (radius: number) => (radius < 35 ? 'sharp' : radius < 70 ? 'medium' : 'gentle');
  const inside = o.track.corners.find((corner) => corner.distance < 0);
  if (inside) return `in a ${sharpness(inside.radius)} ${inside.direction} turn, ${Math.round((-inside.distance / inside.length) * 100)}% through`;
  const next = o.track.corners.find((corner) => corner.distance >= 0);
  if (!next) return 'on a long straight';
  return `a ${sharpness(next.radius)} ${next.direction} turn comes in ${(next.distance / Math.max(o.speed, 5)).toFixed(1)} s`;
}

function carOf(other: RacerObservation['opponents'][number]): string {
  const where = other.z > 4 ? 'ahead' : other.z < -4 ? 'behind' : 'alongside';
  const lane = Math.abs(other.x) < 1.6 ? (where === 'alongside' ? 'touching you' : 'in your lane') : other.x < 0 ? 'on your left' : 'on your right';
  const pace = other.relativeSpeed < -1.5 ? 'slower than you' : other.relativeSpeed > 1.5 ? 'faster than you' : 'at your speed';
  return `${other.name} ${where} ${Math.round(Math.abs(other.z))} m ${lane}, ${pace}, ${healthOf(other.health)}`;
}

export function describeState(o: RacerObservation, history: Decision[], style: DrivingStyle): string {
  const cars = o.opponents.filter((other) => other.distance < NEARBY).slice(0, 3);
  const recent = history.slice(-HISTORY_LENGTH);
  return [
    `Road ahead: ${roadAt(o, 0.5)} in half a second, ${roadAt(o, 1)} in one second.`,
    `You are ${positionOf(o)}, ${facingOf(o)}${o.wrongWay ? ', going the wrong way' : ''}.`,
    `Speed: ${speedOf(o, DRIVING_STYLES[style].grip)}. Track: ${cornerOf(o)}.`,
    `Race: ${o.position} of ${o.racerCount}, lap ${o.lap} of ${o.totalLaps}. Your kart is ${healthOf(o.health)}.`,
    cars.length ? `Cars: ${cars.map(carOf).join('; ')}.` : 'No cars nearby.',
    `Driving style: ${style}. ${DRIVING_STYLES[style].meaning}`,
    recent.length ? `Your last decisions: ${recent.map((d) => `${d.steer}, ${d.pedal.replace('_', ' ')}`).join('; ')}.` : '',
  ].join(' ');
}

export function toControls(answers: DecisionsResponse['answers']): { controls: Controls; decision: Decision } {
  const { steer, pedal } = answers;
  const decision = { steer: steer?.type === 'choice' ? steer.choice : '', pedal: pedal?.type === 'choice' ? pedal.choice : '' };
  if (!(decision.steer in STEER_VALUES) || !(decision.pedal in PEDALS)) throw new Error(`Unexpected answers: ${JSON.stringify(answers)}`);
  return { controls: { throttle: PEDALS[decision.pedal].throttle, brake: PEDALS[decision.pedal].brake, steer: STEER_VALUES[decision.steer] }, decision };
}
