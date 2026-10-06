/*
 * Race orchestration: grid, countdown, fixed-step simulation, laps, standings, and respawns.
 *
 * `Race` places racers on a staggered grid behind the line and advances in fixed SIM_STEP
 * increments from `update(frameDt)`. Each `step` sets every car's slipstream from cars close
 * ahead of it (`updateDrafts`), asks every driver for controls from its own observation, moves
 * the cars, resolves car-to-car contact as a damped impulse along the contact
 * normal, then folds the change in track position into `progress` (metres since the start line,
 * negative on the grid). Lap times and finish times come from `progress` crossing multiples of
 * the lap length. `standings` ranks finishers by time and everyone else by progress. Non-human
 * racers that stay slow or face backwards for STUCK_LIMIT seconds are respawned on the
 * centreline. The race ends when everyone finishes or FINISH_GRACE seconds after the winner.
 */
import { CAR_SPEC, type CarState, createCar, stepCar } from './car';
import { observe } from './observation';
import { type Track, wrapAngle } from './track';
import type { Controls, Driver, RacePhase, RacerObservation } from './types';

export const SIM_STEP = 1 / 120;
export const PROFILE_BIN = 10;
const COUNTDOWN = 3;
const FINISH_GRACE = 30;
const STUCK_LIMIT = 3;
const GRID_SPACING = 5;
const DRAFT_RANGE = 30;
const DRAFT_WIDTH = 2.2;

export type RacerSetup = { id: string; name: string; color: string; driver: Driver };

export type Racer = RacerSetup & {
  car: CarState;
  progress: number;
  lapsCompleted: number;
  lapStart: number;
  lastLap: number | null;
  bestLap: number | null;
  finishTime: number | null;
  position: number;
  respawns: number;
  stuckTime: number;
  controls: Controls;
  speedProfile: Float32Array;
};

export class Race {
  readonly track: Track;
  readonly totalLaps: number;
  readonly racers: Racer[];
  phase: RacePhase = 'grid';
  time = -COUNTDOWN;
  tick = 0;
  private accumulator = 0;
  private winnerTime: number | null = null;

  constructor(track: Track, setups: RacerSetup[], totalLaps: number) {
    this.track = track;
    this.totalLaps = totalLaps;
    this.racers = setups.map((setup, i) => {
      const s = -GRID_SPACING * (i + 1);
      return {
        ...setup,
        car: createCar(track, track.wrap(s), i % 2 === 0 ? -3.5 : 3.5),
        progress: s,
        lapsCompleted: -1,
        lapStart: 0,
        lastLap: null,
        bestLap: null,
        finishTime: null,
        position: i + 1,
        respawns: 0,
        stuckTime: 0,
        controls: { throttle: 0, brake: 0, steer: 0 },
        speedProfile: new Float32Array(Math.ceil(track.length / PROFILE_BIN)),
      };
    });
  }

  start(): void {
    if (this.phase === 'grid') this.phase = 'countdown';
  }

  update(frameDt: number): void {
    if (this.phase === 'grid') return;
    this.accumulator = Math.min(this.accumulator + frameDt, 0.25);
    while (this.accumulator >= SIM_STEP) {
      this.step();
      this.accumulator -= SIM_STEP;
    }
  }

  step(): void {
    this.tick++;
    this.time += SIM_STEP;
    if (this.phase === 'countdown' && this.time >= 0) this.phase = 'racing';
    const released = this.phase !== 'countdown';
    this.updateDrafts();
    for (const racer of this.racers) {
      const decided = racer.driver.decide(this.observe(racer), SIM_STEP);
      racer.controls = released ? sanitize(decided) : { throttle: 0, brake: 0, steer: 0 };
      const previousS = racer.car.s;
      stepCar(racer.car, racer.controls, this.track, SIM_STEP);
      racer.progress += this.track.signedDistance(previousS, racer.car.s);
    }
    this.resolveContacts();
    for (const racer of this.racers) {
      this.updateLaps(racer);
      this.updateStuck(racer);
      if (released) racer.speedProfile[Math.floor(racer.car.s / PROFILE_BIN)] = racer.car.speed;
    }
    this.standings().forEach((racer, i) => (racer.position = i + 1));
    const everyoneDone = this.racers.every((racer) => racer.finishTime !== null);
    const graceOver = this.winnerTime !== null && this.time > this.winnerTime + FINISH_GRACE;
    if (this.phase === 'racing' && (everyoneDone || graceOver)) this.phase = 'finished';
  }

  observe(racer: Racer): RacerObservation {
    return observe(this, racer);
  }

  standings(): Racer[] {
    return [...this.racers].sort(
      (a, b) => (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity) || b.progress - a.progress,
    );
  }

  respawn(racer: Racer): void {
    Object.assign(racer.car, createCar(this.track, racer.car.s, 0));
    racer.stuckTime = 0;
    racer.respawns++;
  }

  private updateLaps(racer: Racer): void {
    if (racer.finishTime !== null || this.phase !== 'racing') return;
    const completed = Math.floor(racer.progress / this.track.length);
    if (completed <= racer.lapsCompleted) return;
    if (completed >= 1) {
      racer.lastLap = this.time - racer.lapStart;
      racer.bestLap = Math.min(racer.bestLap ?? Infinity, racer.lastLap);
    }
    racer.lapStart = this.time;
    racer.lapsCompleted = completed;
    if (completed >= this.totalLaps) {
      racer.finishTime = this.time;
      this.winnerTime ??= this.time;
    }
  }

  private updateStuck(racer: Racer): void {
    if (this.phase !== 'racing' || racer.driver.kind === 'human') return;
    const sample = this.track.sampleAt(racer.car.s);
    const facingBack = Math.cos(wrapAngle(Math.atan2(sample.tx, sample.tz) - racer.car.yaw)) < -0.3;
    racer.stuckTime = Math.abs(racer.car.speed) < 2 || facingBack ? racer.stuckTime + SIM_STEP : 0;
    if (racer.stuckTime > STUCK_LIMIT) this.respawn(racer);
  }

  private updateDrafts(): void {
    for (const racer of this.racers) {
      const { car } = racer;
      const forwardX = Math.sin(car.yaw);
      const forwardZ = Math.cos(car.yaw);
      car.draft = this.racers.reduce((strongest, other) => {
        const dx = other.car.x - car.x;
        const dz = other.car.z - car.z;
        const ahead = dx * forwardX + dz * forwardZ;
        const side = Math.abs(-dx * forwardZ + dz * forwardX);
        if (other === racer || ahead < 3 || ahead > DRAFT_RANGE || side > DRAFT_WIDTH) return strongest;
        return Math.max(strongest, 1 - ahead / DRAFT_RANGE);
      }, 0);
    }
  }

  private resolveContacts(): void {
    const minDistance = CAR_SPEC.radius * 2;
    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i].car;
        const b = this.racers[j].car;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const distance = Math.hypot(dx, dz);
        if (distance >= minDistance || distance === 0) continue;
        const nx = dx / distance;
        const nz = dz / distance;
        const overlap = (minDistance - distance) / 2;
        a.x -= nx * overlap;
        a.z -= nz * overlap;
        b.x += nx * overlap;
        b.z += nz * overlap;
        const alongA = Math.sin(a.yaw) * nx + Math.cos(a.yaw) * nz;
        const alongB = Math.sin(b.yaw) * nx + Math.cos(b.yaw) * nz;
        const closing = a.speed * alongA - b.speed * alongB;
        if (closing <= 0) continue;
        const impulse = closing * 0.65;
        a.speed -= impulse * alongA;
        b.speed += impulse * alongB;
      }
    }
  }
}

function sanitize(controls: Controls): Controls {
  const clamp = (value: number, min: number) => (Number.isFinite(value) ? Math.max(min, Math.min(1, value)) : 0);
  return { throttle: clamp(controls.throttle, 0), brake: clamp(controls.brake, 0), steer: clamp(controls.steer, -1) };
}
