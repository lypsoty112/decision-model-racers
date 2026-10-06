/*
 * Display formatting shared by the HUD, menu, and telemetry panels, plus the stored track record.
 *
 * `formatTime` renders seconds as m:ss.mmm, or a dash when there is no time. `ordinal` turns
 * 1, 2, 3 into 1st, 2nd, 3rd. `readTrackRecord` returns the fastest lap ever stored in
 * localStorage, and `submitLap` stores a lap when it beats that record.
 */
export type TrackRecord = { time: number; name: string; driver: string };

const RECORD_KEY = 'decision-model-racers.track-record';

export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '–';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, '0')}`;
}

export function ordinal(position: number): string {
  const suffix = position % 100 >= 11 && position % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][position % 10] ?? 'th');
  return `${position}${suffix}`;
}

export function readTrackRecord(): TrackRecord | null {
  const stored = localStorage.getItem(RECORD_KEY);
  return stored ? (JSON.parse(stored) as TrackRecord) : null;
}

export function submitLap(lap: TrackRecord): void {
  const record = readTrackRecord();
  if (!record || lap.time < record.time) localStorage.setItem(RECORD_KEY, JSON.stringify(lap));
}
