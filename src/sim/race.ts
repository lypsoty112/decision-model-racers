/*
 * Race orchestration: grid, countdown, fixed-step simulation, laps, standings, and respawns.
 *
 * `Race` places racers on a staggered grid behind the line and advances in fixed SIM_STEP
 * increments from `update(frameDt)`. Each `step` sets every car's slipstream from cars close
 * ahead of it (`updateDrafts`), asks every driver for controls from its own observation, moves
 * the cars (`drive`, or `tumble` for a crashed car), resolves car-to-car contact as a damped
 * impulse along the contact normal (`collide`, counting each new contact for both racers, and
 * skipped when one car flies over the other), then folds the change in track position into `progress`
 * (metres since the start line, negative on the grid). Lap times and finish times come from
 * `progress` crossing multiples of the lap length. `standings` ranks finishers by time and
 * everyone else by progress, and every racer still racing then has its step recorded in its
 * `stats` for the post-race report. Non-human
 * racers that stay slow or face backwards for STUCK_LIMIT seconds are respawned on the
 * centreline. The race ends when everyone finishes or FINISH_GRACE seconds after the winner.
 *
 * With `damage` on, `harm` takes health from a racer still racing for every step it hits a wall
 * faster than WALL_SAFE metres per second, for every new car contact closing faster than
 * CONTACT_SAFE (cars rubbing side by side only take the first hit), and for every tumbling impact
 * faster than CRASH_SAFE. Health only slows the car down. Damage also turns on crashes: a racing
 * car crashes when a contact impulse beyond CRASH_HIT reaches it (`push`), when it hits a wall
 * faster than WALL_CRASH, or when it corners on the grass faster than GRASS_CRASH_SPEED (`trip`
 * slides it sideways so the grass rolls it). A crashed car gets no controls, tumbles as a rigid
 * body that still collides with walls and cars, and respawns, keeping its health, once
 * `crashOver` says so.
 */
import { Vector3 } from 'three';
import { CAR_SPEC, type CarState, createCar, isFacingBackwards, stepCar } from './car';
import { CENTRE_HEIGHT, crashOver, hit, liftOf, startCrash, stepCrash } from './crash';
import { observe } from './observation';
import { createStats, type RacerStats, recordStep } from './raceStats';
import type { Track } from './track';
import type { Controls, Driver, RacePhase, RacerObservation } from './types';

export const SIM_STEP = 1 / 120;
export const PROFILE_BIN = 10;
const COUNTDOWN = 3;
const FINISH_GRACE = 30;
const STUCK_LIMIT = 3;
const GRID_SPACING = 5;
const DRAFT_RANGE = 30;
const DRAFT_WIDTH = 2.2;
const WALL_SAFE = 4;
const WALL_DAMAGE = 3;
const CONTACT_SAFE = 3;
const CONTACT_DAMAGE = 3;
const CONTACT_MAX = 12;
const CONTACT_BOUNCE = 0.65;
const CRASH_SAFE = 6;
const CRASH_DAMAGE = 0.5;
const CRASH_HIT = 12;
const WALL_CRASH = 12;
const GRASS_CRASH_SPEED = 43;
const GRASS_CRASH_ACCEL = 12;
const GRASS_SLIDE = 0.3;
const RIDE_UP = 0.6;
const CONTACT_HEIGHT = 0.4;
const CLEARANCE = 1.3;

export type RacerSetup = { id: string; name: string; color: string; driver: Driver };

export type Racer = RacerSetup & {
  car: CarState;
  progress: number;
  lapsCompleted: number;
  lapStart: number;
  lastLap: number | null;
  bestLap: number | null;
  lapTimes: number[];
  finishTime: number | null;
  position: number;
  respawns: number;
  stuckTime: number;
  controls: Controls;
  speedProfile: Float32Array;
  stats: RacerStats;
};

export class Race {
  readonly track: Track;
  readonly totalLaps: number;
  readonly damage: boolean;
  readonly racers: Racer[];
  phase: RacePhase = 'grid';
  time = -COUNTDOWN;
  tick = 0;
  private accumulator = 0;
  private winnerTime: number | null = null;
  private touching = new Set<string>();

  constructor(track: Track, setups: RacerSetup[], totalLaps: number, damage: boolean) {
    this.track = track;
    this.totalLaps = totalLaps;
    this.damage = damage;
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
        lapTimes: [],
        finishTime: null,
        position: i + 1,
        respawns: 0,
        stuckTime: 0,
        controls: { throttle: 0, brake: 0, steer: 0 },
        speedProfile: new Float32Array(Math.ceil(track.length / PROFILE_BIN)),
        stats: createStats(i + 1),
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
      racer.controls = released && !racer.car.crash ? sanitize(decided) : { throttle: 0, brake: 0, steer: 0 };
      const previousS = racer.car.s;
      if (racer.car.crash) this.tumble(racer);
      else this.drive(racer);
      racer.progress += this.track.signedDistance(previousS, racer.car.s);
    }
    this.resolveContacts();
    for (const racer of this.racers) {
      this.updateLaps(racer);
      this.updateStuck(racer);
      if (released && racer.finishTime === null) racer.speedProfile[Math.floor(racer.car.s / PROFILE_BIN)] = racer.car.speed;
    }
    this.standings().forEach((racer, i) => (racer.position = i + 1));
    if (this.phase === 'racing') {
      for (const racer of this.racers) if (racer.finishTime === null) recordStep(racer, this, SIM_STEP);
    }
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
    Object.assign(racer.car, createCar(this.track, racer.car.s, 0), { health: racer.car.health });
    racer.stuckTime = 0;
    racer.respawns++;
  }

  private drive(racer: Racer): void {
    const { car } = racer;
    const speed = car.speed;
    stepCar(car, racer.controls, this.track, SIM_STEP);
    this.harm(racer, (car.wallImpact - WALL_SAFE) * WALL_DAMAGE);
    if (!this.canCrash(racer)) return;
    if (car.wallImpact > WALL_CRASH) {
      car.speed = speed;
      this.crash(racer);
    } else if (!car.onRoad && Math.abs(car.speed) > GRASS_CRASH_SPEED && Math.abs(car.latAccel) > GRASS_CRASH_ACCEL) {
      this.trip(racer);
    }
  }

  private trip(racer: Racer): void {
    const { car } = racer;
    const outward = new Vector3(Math.cos(car.yaw), 0, -Math.sin(car.yaw)).multiplyScalar(Math.sign(car.latAccel));
    this.crash(racer).velocity.addScaledVector(outward, Math.abs(car.latAccel) * GRASS_SLIDE);
  }

  private tumble(racer: Racer): void {
    const crash = racer.car.crash!;
    stepCrash(crash, racer.car, this.track, SIM_STEP);
    this.harm(racer, (crash.impact - CRASH_SAFE) * CRASH_DAMAGE);
    if (crashOver(crash)) this.respawn(racer);
  }

  private canCrash(racer: Racer): boolean {
    return this.damage && this.phase === 'racing' && racer.finishTime === null && !racer.car.crash;
  }

  private crash(racer: Racer) {
    racer.stats.crashes++;
    return startCrash(racer.car);
  }

  private harm(racer: Racer, amount: number): void {
    if (!this.damage || amount <= 0 || this.phase !== 'racing' || racer.finishTime !== null) return;
    const taken = Math.min(racer.car.health, amount);
    racer.car.health -= taken;
    racer.stats.damageTaken += taken;
  }

  private updateLaps(racer: Racer): void {
    if (racer.finishTime !== null || this.phase !== 'racing') return;
    const completed = Math.floor(racer.progress / this.track.length);
    if (completed <= racer.lapsCompleted) return;
    if (completed >= 1) {
      racer.lastLap = this.time - racer.lapStart;
      racer.bestLap = Math.min(racer.bestLap ?? Infinity, racer.lastLap);
      racer.lapTimes.push(racer.lastLap);
    }
    racer.lapStart = this.time;
    racer.lapsCompleted = completed;
    if (completed >= this.totalLaps) {
      racer.finishTime = this.time;
      this.winnerTime ??= this.time;
    }
  }

  private updateStuck(racer: Racer): void {
    if (this.phase !== 'racing' || racer.driver.kind === 'human' || racer.car.crash) return;
    const stuck = Math.abs(racer.car.speed) < 2 || isFacingBackwards(racer.car, this.track);
    racer.stuckTime = stuck ? racer.stuckTime + SIM_STEP : 0;
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
    const touching = new Set<string>();
    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i].car;
        const b = this.racers[j].car;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const distance = Math.hypot(dx, dz);
        if (distance >= minDistance || distance === 0 || Math.abs(liftOf(a) - liftOf(b)) > CLEARANCE) continue;
        const pair = `${i}:${j}`;
        touching.add(pair);
        if (!this.touching.has(pair) && this.phase === 'racing') {
          this.racers[i].stats.contacts++;
          this.racers[j].stats.contacts++;
        }
        const normal = new Vector3(dx / distance, 0, dz / distance);
        const overlap = (minDistance - distance) / 2;
        shift(a, normal, -overlap);
        shift(b, normal, overlap);
        const closing = velocityOf(a).sub(velocityOf(b)).dot(normal);
        if (closing <= 0) continue;
        if (!this.touching.has(pair)) {
          const damage = Math.min(CONTACT_MAX, (closing - CONTACT_SAFE) * CONTACT_DAMAGE);
          this.harm(this.racers[i], damage);
          this.harm(this.racers[j], damage);
        }
        this.collide(this.racers[i], this.racers[j], normal, closing);
      }
    }
    this.touching = touching;
  }

  private collide(a: Racer, b: Racer, normal: Vector3, closing: number): void {
    const impulse = normal.clone().multiplyScalar(closing * CONTACT_BOUNCE);
    const lift = new Vector3(0, closing * CONTACT_BOUNCE * RIDE_UP, 0);
    const aRides = velocityOf(a.car).dot(normal) > -velocityOf(b.car).dot(normal);
    const point = new Vector3(
      (a.car.x + b.car.x) / 2,
      (centreHeight(a.car) + centreHeight(b.car)) / 2 - CENTRE_HEIGHT + CONTACT_HEIGHT,
      (a.car.z + b.car.z) / 2,
    );
    this.push(a, impulse.clone().negate().add(aRides ? lift : new Vector3()), point);
    this.push(b, impulse.add(aRides ? new Vector3() : lift), point);
  }

  private push(racer: Racer, impulse: Vector3, point: Vector3): void {
    const { car } = racer;
    if (this.canCrash(racer) && impulse.length() > CRASH_HIT) this.crash(racer);
    if (car.crash) hit(car.crash, point, impulse);
    else car.speed += impulse.x * Math.sin(car.yaw) + impulse.z * Math.cos(car.yaw);
  }
}

function velocityOf(car: CarState): Vector3 {
  return car.crash ? car.crash.velocity.clone() : new Vector3(Math.sin(car.yaw) * car.speed, 0, Math.cos(car.yaw) * car.speed);
}

function centreHeight(car: CarState): number {
  return car.crash ? car.crash.position.y : car.y + CENTRE_HEIGHT;
}

function shift(car: CarState, normal: Vector3, distance: number): void {
  car.x += normal.x * distance;
  car.z += normal.z * distance;
  car.crash?.position.addScaledVector(normal, distance);
}

function sanitize(controls: Controls): Controls {
  const clamp = (value: number, min: number) => (Number.isFinite(value) ? Math.max(min, Math.min(1, value)) : 0);
  return { throttle: clamp(controls.throttle, 0), brake: clamp(controls.brake, 0), steer: clamp(controls.steer, -1) };
}
