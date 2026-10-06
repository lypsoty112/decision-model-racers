/*
 * The protocol between a racer's observation and an OpenRouter decision model.
 *
 * `describeState` turns a `RacerObservation` plus the driver's recent `DecisionAction`s into
 * compact state: placement, lap and lap progress, the current track section and next corner,
 * speed and travel direction, position on the road, the road ahead in car-local metres, nearby
 * cars, a safe speed for the curves ahead, and the last HISTORY_LENGTH actions.
 * `DECISION_QUESTIONS` asks for steering as an ordered score and the pedal as a choice, because a
 * score answer is a probability-weighted mean that never reaches full throttle or zero brake.
 * `toControls` maps the answers onto the same throttle, brake, and steer a human uses.
 */
import type { DecisionsChoiceQuestion, DecisionsResponse, DecisionsScoreQuestion } from '@openrouter/sdk/models';
import { CAR_SPEC } from '../sim/car';
import type { Controls, RacerObservation } from '../sim/types';

export type DecisionAction = Controls & { raceTime: number; speed: number };

const HISTORY_LENGTH = 4;
const SAFE_GRIP = CAR_SPEC.grip * 0.83;
const STEER_LEVELS = ['hard left', 'left', 'slight left', 'straight', 'slight right', 'right', 'hard right'];
const STEER_CENTRE = (STEER_LEVELS.length - 1) / 2;
const PEDALS: Record<string, { throttle: number; brake: number; meaning: string }> = {
  full_throttle: { throttle: 1, brake: 0, meaning: 'Accelerate hard. The road ahead is straight or gently curved and the car is below a safe speed.' },
  part_throttle: { throttle: 0.5, brake: 0, meaning: 'Accelerate gently to hold speed through a curve.' },
  coast: { throttle: 0, brake: 0, meaning: 'Lift off to scrub a little speed before a corner.' },
  brake: {
    throttle: 0,
    brake: 0.5,
    meaning: 'Brake moderately because the car is moving forward faster than is safe for the corner ahead. Never brake when stopped or slow: the brake pedal then drives the car backwards.',
  },
  hard_brake: { throttle: 0, brake: 1, meaning: 'Brake hard because the car is moving forward far too fast for a tight corner close ahead. Never when stopped or slow.' },
};

export const DECISION_QUESTIONS: Record<'steer' | 'pedal', DecisionsScoreQuestion | DecisionsChoiceQuestion> = {
  steer: {
    type: 'score',
    instructions:
      'Steer to follow the road. path_ahead lists road centre points; positive right_m means the road is to the right, negative to the left. Steer towards the points 20-30 m ahead and keep heading_error_deg near 0.',
    criteria: STEER_LEVELS,
  },
  pedal: {
    type: 'choice',
    instructions: 'Which pedal action gets the car around the track fastest without leaving the road?',
    criteria: Object.fromEntries(Object.entries(PEDALS).map(([key, pedal]) => [key, pedal.meaning])),
  },
};

export function describeState(observation: RacerObservation, history: DecisionAction[]) {
  const o = observation;
  const degrees = (radians: number) => Math.round((radians * 180) / Math.PI);
  const inside = o.track.corners.find((corner) => corner.distance < 0);
  const next = o.track.corners.find((corner) => corner.distance >= 0);
  const sharpest = Math.max(...o.track.curvatureAhead.slice(0, 10).map(Math.abs), 1e-4);
  return {
    race: { position: `${o.position} of ${o.racerCount}`, lap: `${o.lap} of ${o.totalLaps}`, lap_progress_pct: Math.round(o.lapProgress * 100) },
    track_section: {
      now: inside
        ? `in corner ${inside.index}, a ${inside.direction} turn of radius ${Math.round(inside.radius)} m, ${Math.round((-inside.distance / inside.length) * 100)}% through`
        : 'on a straight',
      next_corner: next
        ? { number: next.index, in_m: Math.round(next.distance), direction: next.direction, radius_m: Math.round(next.radius), turn_deg: Math.round(next.angleDeg) }
        : null,
    },
    car: {
      speed_kmh: Math.round(Math.abs(o.speed) * 3.6),
      moving: o.speed > 0.5 ? 'forward' : o.speed < -0.5 ? 'backwards' : 'stopped',
      top_speed_kmh: Math.round(o.maxSpeed * 3.6),
      lateral_offset_m: +o.lateralOffset.toFixed(1),
      road_half_width_m: o.trackHalfWidth,
      heading_error_deg: degrees(o.headingError),
      off_track: o.offTrack,
      wrong_way: o.wrongWay,
      slipstream: +o.slipstream.toFixed(2),
    },
    path_ahead: o.track.pointsAhead.map((point) => ({ ahead_m: +point.z.toFixed(1), right_m: +point.x.toFixed(1) })),
    nearby_cars: o.opponents
      .filter((other) => other.distance < 40)
      .slice(0, 3)
      .map((other) => ({ ahead_m: +other.z.toFixed(1), right_m: +other.x.toFixed(1), speed_diff_kmh: Math.round(other.relativeSpeed * 3.6) })),
    guidance: { safe_speed_kmh_for_upcoming_curves: Math.round(Math.sqrt(SAFE_GRIP / sharpest) * 3.6) },
    previous_actions: history.slice(-HISTORY_LENGTH).map((action) => ({
      seconds_ago: +(o.raceTime - action.raceTime).toFixed(1),
      steer: +action.steer.toFixed(2),
      throttle: action.throttle,
      brake: action.brake,
      speed_kmh: Math.round(Math.abs(action.speed) * 3.6),
    })),
  };
}

export function toControls(answers: DecisionsResponse['answers']): Controls {
  const { steer, pedal } = answers;
  const chosen = pedal?.type === 'choice' ? PEDALS[pedal.choice] : undefined;
  if (steer?.type !== 'score' || !chosen) throw new Error(`Unexpected answers: ${JSON.stringify(answers)}`);
  return { throttle: chosen.throttle, brake: chosen.brake, steer: (steer.score - STEER_CENTRE) / STEER_CENTRE };
}
