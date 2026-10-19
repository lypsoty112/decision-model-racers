/*
 * Tournaments: a fixed grid racing several rounds for F1-style points.
 *
 * `createTournament` freezes the menu settings and picks every round's track up front: round 1 on
 * the selected track and each later round on a fresh random track with the settings' length and
 * complexity. `roundSettings` is the race settings for the next round, `recordRound` stores a
 * finished race's places (null for a racer that did not finish) along with the entrants' names and
 * colours, and `isComplete` tells when every round is in. `scorecard` ranks the entrants by points
 * from POINTS (nothing below tenth or for a DNF), then by wins, then by best place. `readTournament`
 * and `saveTournament` keep the running tournament in localStorage so a reload doesn't lose it.
 */
import type { Race } from '../sim/race';
import { newSeed, type RaceSettings } from './setup';

type RoundTrack = Pick<RaceSettings, 'circuit' | 'randomTrack'>;
type Entrant = { id: string; name: string; color: string };

export type Tournament = {
  settings: RaceSettings;
  tracks: RoundTrack[];
  entrants: Entrant[];
  results: Record<string, number | null>[];
};

export type ScorecardRow = Entrant & { places: (number | null)[]; points: number };

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const TOURNAMENT_ROUNDS = { min: 3, max: 8 };

const STORAGE_KEY = 'decision-model-racers.tournament';

export const pointsFor = (place: number | null) => (place === null ? 0 : (POINTS[place - 1] ?? 0));

export function createTournament(settings: RaceSettings): Tournament {
  const later = Array.from({ length: settings.rounds - 1 }, (): RoundTrack => ({ circuit: 'random', randomTrack: { ...settings.randomTrack, seed: newSeed() } }));
  return { settings, tracks: [{ circuit: settings.circuit, randomTrack: settings.randomTrack }, ...later], entrants: [], results: [] };
}

export const isComplete = (tournament: Tournament) => tournament.results.length >= tournament.tracks.length;

export const roundSettings = (tournament: Tournament): RaceSettings => ({ ...tournament.settings, ...tournament.tracks[tournament.results.length] });

export function recordRound(tournament: Tournament, race: Race): Tournament {
  return {
    ...tournament,
    entrants: race.racers.map(({ id, name, color }) => ({ id, name, color })),
    results: [...tournament.results, Object.fromEntries(race.racers.map((racer) => [racer.id, racer.finishTime === null ? null : racer.position]))],
  };
}

export function scorecard(tournament: Tournament): ScorecardRow[] {
  const best = (row: ScorecardRow) => Math.min(...row.places.map((place) => place ?? Infinity));
  const wins = (row: ScorecardRow) => row.places.filter((place) => place === 1).length;
  return tournament.entrants
    .map((entrant) => {
      const places = tournament.results.map((round) => round[entrant.id] ?? null);
      return { ...entrant, places, points: places.reduce((sum: number, place) => sum + pointsFor(place), 0) };
    })
    .sort((a, b) => b.points - a.points || wins(b) - wins(a) || best(a) - best(b));
}

export function readTournament(): Tournament | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? (JSON.parse(stored) as Tournament) : null;
}

export function saveTournament(tournament: Tournament | null): void {
  if (tournament) localStorage.setItem(STORAGE_KEY, JSON.stringify(tournament));
  else localStorage.removeItem(STORAGE_KEY);
}
