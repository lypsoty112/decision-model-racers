/*
 * Display formatting shared by the HUD, menu, and telemetry panels, plus the stored track record.
 *
 * `formatTime` renders seconds as m:ss.mmm, or a dash when there is no time. `ordinal` turns
 * 1, 2, 3 into 1st, 2nd, 3rd. `readTrackRecord` returns the fastest lap ever stored in
 * localStorage for a track, and `submitLap` stores a lap when it beats that record. `recordKey`
 * keeps Meadow Ring on the original key, so records set before random tracks existed survive.
 */
export type TrackRecord = { time: number; name: string; driver: string };

const RECORD_KEY = 'decision-model-racers.track-record';

const recordKey = (trackId: string) => (trackId === 'meadow-ring' ? RECORD_KEY : `${RECORD_KEY}.${trackId}`);

export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '–';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, '0')}`;
}

export function ordinal(position: number): string {
  const suffix = position % 100 >= 11 && position % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][position % 10] ?? 'th');
  return `${position}${suffix}`;
}

export function readTrackRecord(trackId: string): TrackRecord | null {
  const stored = localStorage.getItem(recordKey(trackId));
  return stored ? (JSON.parse(stored) as TrackRecord) : null;
}

export function submitLap(trackId: string, lap: TrackRecord): void {
  const record = readTrackRecord(trackId);
  if (!record || lap.time < record.time) localStorage.setItem(recordKey(trackId), JSON.stringify(lap));
}
