/*
 * Runs bots-only races without a browser and prints the results, as a smoke test for the
 * simulation and a template for offline decision-model comparisons. Run with `bun run sim`.
 *
 * `runRace` steps a race at the fixed simulation rate until it finishes or hits the time limit.
 * The script runs one race per difficulty, prints track facts and a results table, and throws
 * (non-zero exit) when any bot fails to finish or needed more than two respawns.
 */
import { Keyboard } from '../input/keyboard';
import type { Race } from '../sim/race';
import { createRace, DEFAULT_SETTINGS, type Difficulty, TRACK } from './setup';

const TIME_LIMIT = 600;

function runRace(race: Race): void {
  race.start();
  while (race.phase !== 'finished' && race.time < TIME_LIMIT) race.step();
}

const tightest = TRACK.corners.reduce((a, b) => (a.radius < b.radius ? a : b));
console.log(`Track: ${TRACK.length.toFixed(0)} m, ${TRACK.samples.length} samples, ${TRACK.corners.length} corners, tightest radius ${tightest.radius.toFixed(1)} m`);

const failures: string[] = [];
for (const difficulty of ['rookie', 'pro', 'legend'] as Difficulty[]) {
  const race = createRace({ ...DEFAULT_SETTINGS, participate: false, bots: 8, difficulty }, new Keyboard());
  const started = performance.now();
  runRace(race);
  console.log(`\n${difficulty}: simulated ${race.time.toFixed(1)} s in ${(performance.now() - started).toFixed(0)} ms`);
  console.table(
    race.standings().map((racer) => ({
      pos: racer.position,
      name: racer.name,
      finish: racer.finishTime?.toFixed(2) ?? 'DNF',
      bestLap: racer.bestLap?.toFixed(2) ?? '-',
      respawns: racer.respawns,
      progress: racer.progress.toFixed(0),
    })),
  );
  for (const racer of race.racers) {
    if (racer.finishTime === null) failures.push(`${difficulty}/${racer.name} did not finish`);
    if (racer.respawns > 2) failures.push(`${difficulty}/${racer.name} respawned ${racer.respawns} times`);
  }
}

if (failures.length > 0) throw new Error(`Simulation check failed:\n${failures.join('\n')}`);
console.log('\nSimulation check passed.');
