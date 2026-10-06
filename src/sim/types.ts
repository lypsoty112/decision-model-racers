/*
 * Shared simulation types, including the decision-model contract.
 *
 * Contains no functions. `Driver` is anything that turns a `RacerObservation` into `Controls`
 * once per simulation step: throttle and brake in [0, 1], steer in [-1, 1] where negative is
 * left. `RacerObservation` is the complete per-racer state handed to a driver.
 *
 * Units are metres, seconds, and radians. Lateral values and car-local `x` are positive to the
 * right of the centreline or car; car-local `z` is positive straight ahead. Curvature is 1/radius
 * in 1/m and positive for right turns. `headingError` is positive when the car points to the
 * right of the track direction. An opponent's `gap` is race distance (laps included) and positive
 * when they are ahead; their `lateralOffset` is their own offset from the centreline.
 * `slipstream` runs from 0 (clean air) to 1 (tucked right behind another car). Corners are
 * numbered from 1 in racing order after the start line, and a corner's `distance` is negative
 * while the racer is inside it. `curvatureAhead[i]` is the curvature
 * `i * curvatureStep` metres ahead.
 */

export type Controls = { throttle: number; brake: number; steer: number };

export type RacePhase = 'grid' | 'countdown' | 'racing' | 'finished';

export type Driver = {
  readonly kind: string;
  decide(observation: RacerObservation, dt: number): Controls;
};

export type CornerAhead = {
  index: number;
  distance: number;
  length: number;
  direction: 'left' | 'right';
  radius: number;
  angleDeg: number;
};

export type TrackPointAhead = { distance: number; x: number; z: number; curvature: number };

export type OpponentState = {
  id: string;
  name: string;
  position: number;
  gap: number;
  distance: number;
  x: number;
  z: number;
  lateralOffset: number;
  speed: number;
  relativeSpeed: number;
};

export type RacerObservation = {
  id: string;
  name: string;
  driver: string;
  tick: number;
  raceTime: number;
  phase: RacePhase;
  position: number;
  racerCount: number;
  lap: number;
  totalLaps: number;
  lapProgress: number;
  raceProgress: number;
  finished: boolean;
  speed: number;
  maxSpeed: number;
  headingError: number;
  lateralOffset: number;
  trackHalfWidth: number;
  offTrack: boolean;
  slipstream: number;
  wrongWay: boolean;
  respawns: number;
  world: { x: number; y: number; z: number; yaw: number };
  timing: { currentLap: number; lastLap: number | null; bestLap: number | null; finishTime: number | null };
  track: {
    length: number;
    distanceAlong: number;
    curvatureStep: number;
    curvatureAhead: number[];
    pointsAhead: TrackPointAhead[];
    corners: CornerAhead[];
  };
  opponents: OpponentState[];
  controls: Controls;
};
