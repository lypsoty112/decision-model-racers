/*
 * Per-racer performance statistics for the post-race report.
 *
 * `createStats` starts an empty record for a racer starting from a grid position. The race calls
 * `recordStep` once per simulation step for every racer still racing: it integrates time spent on
 * the road, at the walls, facing backwards, sliding, in slipstream, and leading; pedal and
 * steering use; distance; and peak speed and cornering load. It counts wall hits, brake
 * applications, overtakes, and places lost on their rising edge, and samples the race position
 * once per second. Car-to-car contacts, respawns, and lap times are counted by the race itself.
 * `summarize` turns a racer's record into the display-ready `RacerSummary` (speeds in km/h,
 * shares in percent) used by the report and its JSON export.
 */
import { isFacingBackwards } from './car';
import type { Race, Racer } from './race';

export type RacerStats = {
  startPosition: number;
  racingTime: number;
  distance: number;
  topSpeed: number;
  peakLateralG: number;
  roadTime: number;
  wallTime: number;
  wrongWayTime: number;
  slideTime: number;
  slipstreamTime: number;
  leadTime: number;
  throttleTotal: number;
  fullThrottleTime: number;
  brakeTotal: number;
  brakingTime: number;
  steerTotal: number;
  steerTravel: number;
  wallHits: number;
  brakeApplications: number;
  overtakes: number;
  placesLost: number;
  contacts: number;
  bestPosition: number;
  worstPosition: number;
  positionTrace: number[];
  previous: { atWall: boolean; braking: boolean; position: number; steer: number };
};

export type RacerSummary = ReturnType<typeof summarize>;

export function createStats(startPosition: number): RacerStats {
  return {
    startPosition,
    racingTime: 0,
    distance: 0,
    topSpeed: 0,
    peakLateralG: 0,
    roadTime: 0,
    wallTime: 0,
    wrongWayTime: 0,
    slideTime: 0,
    slipstreamTime: 0,
    leadTime: 0,
    throttleTotal: 0,
    fullThrottleTime: 0,
    brakeTotal: 0,
    brakingTime: 0,
    steerTotal: 0,
    steerTravel: 0,
    wallHits: 0,
    brakeApplications: 0,
    overtakes: 0,
    placesLost: 0,
    contacts: 0,
    bestPosition: startPosition,
    worstPosition: startPosition,
    positionTrace: [startPosition],
    previous: { atWall: false, braking: false, position: startPosition, steer: 0 },
  };
}

export function recordStep(racer: Racer, race: Race, dt: number): void {
  const { stats, car, controls, position } = racer;
  const atWall = Math.abs(car.lateral) >= race.track.wallOffset - 0.01;
  const braking = controls.brake > 0.05;
  stats.racingTime += dt;
  stats.distance += Math.max(0, car.speed) * dt;
  stats.topSpeed = Math.max(stats.topSpeed, car.speed);
  stats.peakLateralG = Math.max(stats.peakLateralG, Math.abs(car.latAccel) / 9.81);
  if (car.onRoad) stats.roadTime += dt;
  if (atWall) stats.wallTime += dt;
  if (isFacingBackwards(car, race.track)) stats.wrongWayTime += dt;
  if (car.slip > 0.25) stats.slideTime += dt;
  if (car.draft > 0.25) stats.slipstreamTime += dt;
  if (position === 1) stats.leadTime += dt;
  stats.throttleTotal += controls.throttle * dt;
  if (controls.throttle >= 0.99) stats.fullThrottleTime += dt;
  stats.brakeTotal += controls.brake * dt;
  if (braking) stats.brakingTime += dt;
  stats.steerTotal += Math.abs(controls.steer) * dt;
  stats.steerTravel += Math.abs(controls.steer - stats.previous.steer);
  if (atWall && !stats.previous.atWall) stats.wallHits++;
  if (braking && !stats.previous.braking) stats.brakeApplications++;
  stats.overtakes += Math.max(0, stats.previous.position - position);
  stats.placesLost += Math.max(0, position - stats.previous.position);
  stats.bestPosition = Math.min(stats.bestPosition, position);
  stats.worstPosition = Math.max(stats.worstPosition, position);
  if (race.time >= stats.positionTrace.length) stats.positionTrace.push(position);
  stats.previous = { atWall, braking, position, steer: controls.steer };
}

export function summarize(racer: Racer, race: Race) {
  const { stats } = racer;
  const time = Math.max(stats.racingTime, 1e-6);
  const share = (seconds: number) => (seconds / time) * 100;
  const laps = racer.lapTimes;
  const averageLap = laps.length > 0 ? laps.reduce((sum, lap) => sum + lap, 0) / laps.length : null;
  const lapSpread = averageLap === null || laps.length < 2 ? null : Math.sqrt(laps.reduce((sum, lap) => sum + (lap - averageLap) ** 2, 0) / laps.length);
  return {
    id: racer.id,
    name: racer.name,
    color: racer.color,
    driver: racer.driver.kind,
    position: racer.position,
    finishTime: racer.finishTime,
    raceTime: racer.finishTime ?? stats.racingTime,
    lapsCompleted: Math.max(0, Math.min(race.totalLaps, racer.lapsCompleted)),
    lapTimes: laps,
    bestLap: racer.bestLap,
    averageLap,
    lapSpread,
    distance: stats.distance,
    topSpeedKmh: stats.topSpeed * 3.6,
    averageSpeedKmh: (stats.distance / time) * 3.6,
    peakLateralG: stats.peakLateralG,
    onTrackPct: share(stats.roadTime),
    offTrackPct: share(stats.racingTime - stats.roadTime),
    wallPct: share(stats.wallTime),
    wallHits: stats.wallHits,
    wrongWayPct: share(stats.wrongWayTime),
    slidingPct: share(stats.slideTime),
    slipstreamPct: share(stats.slipstreamTime),
    leadingPct: share(stats.leadTime),
    averageThrottlePct: share(stats.throttleTotal),
    fullThrottlePct: share(stats.fullThrottleTime),
    brakingPct: share(stats.brakingTime),
    brakePressurePct: stats.brakingTime > 0 ? (stats.brakeTotal / stats.brakingTime) * 100 : 0,
    brakeApplications: stats.brakeApplications,
    steeringEffortPct: share(stats.steerTotal),
    steeringChangesPerSecond: stats.steerTravel / time,
    startPosition: stats.startPosition,
    placesGained: stats.startPosition - racer.position,
    overtakes: stats.overtakes,
    placesLost: stats.placesLost,
    bestPosition: stats.bestPosition,
    worstPosition: stats.worstPosition,
    contacts: stats.contacts,
    respawns: racer.respawns,
    positionTrace: stats.positionTrace,
    speedProfileKmh: Array.from(racer.speedProfile, (speed) => speed * 3.6),
  };
}
