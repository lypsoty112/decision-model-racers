/*
 * Runs bots-only races without a browser and prints the results, as a smoke test for the
 * simulation and a template for offline decision-model comparisons. Run with `bun run sim`.
 *
 * `runRace` steps a race at the fixed simulation rate until it finishes or hits the time limit.
 * The script runs one Meadow Ring race per difficulty and one pro race on each of the
 * RANDOM_TRACKS, prints track facts and a results table for each, and throws (non-zero exit) when
 * any bot fails to finish or needed more than two respawns.
 */
import { Keyboard } from '../input/keyboard';
import type { Race } from '../sim/race';
import type { RandomTrackParams } from '../sim/trackGenerator';
import { createRace, DEFAULT_SETTINGS, type Difficulty, type RaceSettings, trackFor } from './setup';

const TIME_LIMIT = 600;
const RANDOM_TRACKS: RandomTrackParams[] = [
  { seed: 1, length: 1.5, complexity: 5 },
  { seed: 2, length: 1.8, complexity: 1 },
  { seed: 3, length: 2, complexity: 3 },
  { seed: 4, length: 2.2, complexity: 4 },
  { seed: 5, length: 2.5, complexity: 2 },
  { seed: 6, length: 2.7, complexity: 5 },
];

function runRace(race: Race): void {
  race.start();
  while (race.phase !== 'finished' && race.time < TIME_LIMIT) race.step();
}

const base: RaceSettings = { ...DEFAULT_SETTINGS, participate: false, bots: 8 };
const races: [string, RaceSettings][] = [
  ...(['rookie', 'pro', 'legend'] as Difficulty[]).map((difficulty): [string, RaceSettings] => [difficulty, { ...base, difficulty }]),
  ...RANDOM_TRACKS.map((randomTrack): [string, RaceSettings] => ['pro', { ...base, circuit: 'random', randomTrack }]),
];

const failures: string[] = [];
for (const [label, settings] of races) {
  const track = trackFor(settings);
  const tightest = Math.min(...track.corners.map((corner) => corner.radius));
  const race = createRace(settings, new Keyboard());
  const started = performance.now();
  runRace(race);
  console.log(
    `\n${label}, ${track.name} (${track.id}): ${track.length.toFixed(0)} m, ${track.corners.length} corners, tightest radius ${tightest.toFixed(1)} m; ` +
      `simulated ${race.time.toFixed(1)} s in ${(performance.now() - started).toFixed(0)} ms`,
  );
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
    if (racer.finishTime === null) failures.push(`${label} ${track.name}/${racer.name} did not finish`);
    if (racer.respawns > 2) failures.push(`${label} ${track.name}/${racer.name} respawned ${racer.respawns} times`);
  }
}

if (failures.length > 0) throw new Error(`Simulation check failed:\n${failures.join('\n')}`);
console.log('\nSimulation check passed.');
