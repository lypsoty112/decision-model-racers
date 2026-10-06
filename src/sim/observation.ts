/*
 * Builds the `RacerObservation` that a decision model receives for one racer.
 *
 * `observe` expresses everything relative to the racer. `toLocal` converts world points into
 * car-local coordinates (x right, z ahead), `cornersAhead` reports the next corners by distance
 * from the racer, and opponents are sorted nearest first by straight-line distance. Drivers, the
 * telemetry panel, and `window.racerAPI` all read this same structure.
 */
import { CAR_SPEC } from './car';
import type { Race, Racer } from './race';
import { type Track, wrapAngle } from './track';
import type { CornerAhead, RacerObservation } from './types';

const CURVATURE_STEP = 10;
const CURVATURE_SAMPLES = 21;
const POINT_DISTANCES = [5, 10, 20, 30, 45, 60, 80, 100];
const CORNER_HORIZON = 500;
const CORNER_COUNT = 3;
const WRONG_WAY_ANGLE = 1.9;

export function observe(race: Race, racer: Racer): RacerObservation {
  const { track } = race;
  const { car } = racer;
  const sample = track.sampleAt(car.s);
  const headingError = wrapAngle(Math.atan2(sample.tx, sample.tz) - car.yaw);
  const sin = Math.sin(car.yaw);
  const cos = Math.cos(car.yaw);
  const toLocal = (x: number, z: number) => {
    const dx = x - car.x;
    const dz = z - car.z;
    return { x: -dx * cos + dz * sin, z: dx * sin + dz * cos };
  };
  const raceDistance = race.totalLaps * track.length;
  const finished = racer.finishTime !== null;

  return {
    id: racer.id,
    name: racer.name,
    driver: racer.driver.kind,
    tick: race.tick,
    raceTime: Math.max(0, race.time),
    phase: race.phase,
    position: racer.position,
    racerCount: race.racers.length,
    lap: Math.min(race.totalLaps, Math.max(1, racer.lapsCompleted + 1)),
    totalLaps: race.totalLaps,
    lapProgress: Math.max(0, racer.progress % track.length) / track.length,
    raceProgress: Math.max(0, Math.min(1, racer.progress / raceDistance)),
    finished,
    speed: car.speed,
    maxSpeed: CAR_SPEC.maxSpeed,
    headingError,
    lateralOffset: car.lateral,
    trackHalfWidth: track.halfWidth,
    offTrack: !car.onRoad,
    slipstream: car.draft,
    wrongWay: Math.abs(headingError) > WRONG_WAY_ANGLE,
    respawns: racer.respawns,
    world: { x: car.x, y: car.y, z: car.z, yaw: car.yaw },
    timing: {
      currentLap: finished || race.time < 0 ? 0 : race.time - racer.lapStart,
      lastLap: racer.lastLap,
      bestLap: racer.bestLap,
      finishTime: racer.finishTime,
    },
    track: {
      length: track.length,
      distanceAlong: car.s,
      curvatureStep: CURVATURE_STEP,
      curvatureAhead: Array.from({ length: CURVATURE_SAMPLES }, (_, i) => track.sampleAt(car.s + i * CURVATURE_STEP).curvature),
      pointsAhead: POINT_DISTANCES.map((distance) => {
        const point = track.sampleAt(car.s + distance);
        return { distance, ...toLocal(point.x, point.z), curvature: point.curvature };
      }),
      corners: cornersAhead(track, car.s),
    },
    opponents: race.racers
      .filter((other) => other !== racer)
      .map((other) => {
        const local = toLocal(other.car.x, other.car.z);
        return {
          id: other.id,
          name: other.name,
          position: other.position,
          gap: other.progress - racer.progress,
          distance: Math.hypot(local.x, local.z),
          x: local.x,
          z: local.z,
          lateralOffset: other.car.lateral,
          speed: other.car.speed,
          relativeSpeed: other.car.speed - car.speed,
        };
      })
      .sort((a, b) => a.distance - b.distance),
    controls: { ...racer.controls },
  };
}

function cornersAhead(track: Track, s: number): CornerAhead[] {
  return track.corners
    .map((corner) => {
      const length = corner.end - corner.start;
      return {
        distance: track.wrap(corner.end - s) - length,
        length,
        direction: corner.direction,
        radius: corner.radius,
        angleDeg: corner.angleDeg,
      };
    })
    .filter((corner) => corner.distance < CORNER_HORIZON)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, CORNER_COUNT);
}
