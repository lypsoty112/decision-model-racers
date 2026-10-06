/*
 * Turns between-races menu settings into a ready-to-start `Race`.
 *
 * `RaceSettings` is everything the menu configures. `TRACK` is the single circuit, built once and
 * shared by every race. `createRace` fills the grid with `BotDriver`s whose grip and pace rise
 * evenly across the chosen difficulty range from pole to the back row, so the strongest bots
 * have to fight through the field and results stay deterministic. When `participate` is set, it
 * slots the keyboard racer into the middle of the grid. `DEMO_SETTINGS` describes the bots-only race that runs behind the menu.
 */
import type { TimeOfDay } from '../render/environment';
import { Keyboard, KeyboardDriver } from '../input/keyboard';
import { BotDriver } from '../sim/botDriver';
import { Race, type RacerSetup } from '../sim/race';
import { DEFAULT_TRACK, Track } from '../sim/track';

export type Difficulty = 'rookie' | 'pro' | 'legend';

export type RaceSettings = {
  laps: number;
  bots: number;
  participate: boolean;
  playerName: string;
  playerColor: string;
  difficulty: Difficulty;
  timeOfDay: TimeOfDay;
};

export const PLAYER_ID = 'player';
export const MAX_BOTS = 11;
export const PLAYER_COLORS = ['#e63946', '#ff9f1c', '#2ec4b6', '#3a86ff', '#8338ec', '#ffbe0b', '#f15bb5', '#f1faee'];
export const TRACK = new Track(DEFAULT_TRACK, 9);

const BOT_NAMES = ['Nova', 'Blitz', 'Pixel', 'Comet', 'Echo', 'Turbo', 'Zephyr', 'Quark', 'Rally', 'Sprocket', 'Vex', 'Byte'];
const BOT_COLORS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f78c6b', '#9b5de5', '#00bbf9', '#8ac926', '#ff924c', '#4cc9f0', '#c77dff', '#e9c46a'];
const DIFFICULTY: Record<Difficulty, { grip: [number, number]; pace: [number, number] }> = {
  rookie: { grip: [0.6, 0.72], pace: [0.78, 0.85] },
  pro: { grip: [0.8, 0.92], pace: [0.88, 0.95] },
  legend: { grip: [0.94, 1.04], pace: [0.96, 1] },
};

export const DEFAULT_SETTINGS: RaceSettings = {
  laps: 3,
  bots: 7,
  participate: true,
  playerName: 'You',
  playerColor: PLAYER_COLORS[0],
  difficulty: 'pro',
  timeOfDay: 'morning',
};

export const DEMO_SETTINGS: RaceSettings = { ...DEFAULT_SETTINGS, laps: 99, participate: false };

export function createRace(settings: RaceSettings, keyboard: Keyboard): Race {
  const range = DIFFICULTY[settings.difficulty];
  const lerp = ([from, to]: [number, number], t: number) => from + (to - from) * t;
  const setups: RacerSetup[] = Array.from({ length: settings.bots }, (_, i) => {
    const t = settings.bots > 1 ? i / (settings.bots - 1) : 0.5;
    return {
      id: `bot-${i + 1}`,
      name: BOT_NAMES[i],
      color: BOT_COLORS[i],
      driver: new BotDriver({ grip: lerp(range.grip, t), pace: lerp(range.pace, t), lane: ((i % 3) - 1) * 2 }),
    };
  });
  if (settings.participate) {
    setups.splice(Math.floor(setups.length / 2), 0, {
      id: PLAYER_ID,
      name: settings.playerName.trim() || 'You',
      color: settings.playerColor,
      driver: new KeyboardDriver(keyboard),
    });
  }
  return new Race(TRACK, setups, settings.laps);
}
