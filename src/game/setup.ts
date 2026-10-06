/*
 * Turns between-races menu settings into a ready-to-start `Race`.
 *
 * `RaceSettings` is everything the menu configures. `MEADOW_RING` is the hand-made circuit, built
 * once; `trackFor` returns it or the random track the settings describe, generated once and kept
 * while the settings stay the same, so every caller gets the same `Track` object. The random
 * track's length and complexity stay within the TRACK_LENGTH and MAX_COMPLEXITY ranges, where the
 * generator always finds a layout, and `newSeed` picks a fresh seed. `createRace` races on
 * `trackFor` and fills the grid with the chosen CPU type: `BotDriver`s from
 * the BOTS roster, whose grip and pace rise evenly across the difficulty range from the first
 * bot to the last and are then nudged by each bot's personality along with its braking, room
 * given to cars alongside, line-change, and apex style (unset knobs take STYLE_DEFAULTS), or one
 * `ModelDriver` per `ModelEntry` (up to MAX_MODELS entries, at most MAX_COPIES of one model),
 * named "<model> · <style>" with a number added when the same model and style repeat. When
 * `participate` is set, it adds the keyboard racer, and `shuffle` then gives every racer a
 * random grid slot. `canStart` refuses an empty grid and, while the
 * OpenRouter key is invalid or out of credits, any decision-model race; `lapsFor` caps
 * decision-model races at MODEL_MAX_LAPS. `demoSettings` describes the bots-only race that runs
 * behind the menu, on the track the settings select.
 */
import type { TimeOfDay } from '../render/environment';
import { Keyboard, KeyboardDriver } from '../input/keyboard';
import type { DrivingStyle } from '../models/decisionState';
import { type DecisionModelInfo, type KeyStatus, keyUsable, ModelDriver } from '../models/modelDriver';
import { BotDriver } from '../sim/botDriver';
import { Race, type RacerSetup } from '../sim/race';
import { DEFAULT_TRACK, Track, TRACK_HALF_WIDTH } from '../sim/track';
import { generateTrack, randomTrackId, type RandomTrackParams } from '../sim/trackGenerator';

export type Difficulty = 'rookie' | 'pro' | 'legend';
export type ModelEntry = DecisionModelInfo & { style: DrivingStyle };

export type RaceSettings = {
  laps: number;
  cpu: 'bots' | 'models';
  bots: number;
  models: ModelEntry[];
  circuit: 'meadow' | 'random';
  randomTrack: RandomTrackParams;
  participate: boolean;
  playerName: string;
  playerColor: string;
  difficulty: Difficulty;
  timeOfDay: TimeOfDay;
};

export const PLAYER_ID = 'player';
export const MAX_BOTS = 11;
export const MAX_MODELS = 5;
export const MAX_COPIES = 3;
export const MODEL_MAX_LAPS = 1;
export const PLAYER_COLORS = ['#e63946', '#ff9f1c', '#2ec4b6', '#3a86ff', '#8338ec', '#ffbe0b', '#f15bb5', '#f1faee'];
export const MEADOW_RING = new Track(DEFAULT_TRACK, TRACK_HALF_WIDTH, { id: 'meadow-ring', name: 'Meadow Ring' });
export const TRACK_LENGTH = { min: 1.5, max: 2.7 };
export const MAX_COMPLEXITY = 5;

export const newSeed = () => Math.floor(Math.random() * 1_000_000);

let generated: Track | null = null;

const STYLE_DEFAULTS = { grip: 1, pace: 1, brake: 0.7, berth: 1, lineShift: 7, apex: 1 };
const BOTS: ({ name: string; color: string; personality: string } & Partial<typeof STYLE_DEFAULTS>)[] = [
  { name: 'Nova', color: '#ef476f', personality: 'Smooth operator', lineShift: 5, brake: 0.66 },
  { name: 'Blitz', color: '#ffd166', personality: 'Late braker', brake: 0.8 },
  { name: 'Pixel', color: '#06d6a0', personality: 'Apex hunter', apex: 1.25 },
  { name: 'Comet', color: '#118ab2', personality: 'Straight-line rocket', pace: 1.03, grip: 0.97 },
  { name: 'Echo', color: '#f78c6b', personality: 'Slipstream shadow', berth: 0.6 },
  { name: 'Turbo', color: '#9b5de5', personality: 'Hothead', lineShift: 10, berth: 0.7 },
  { name: 'Zephyr', color: '#00bbf9', personality: 'Wide-line flier', apex: 0.75 },
  { name: 'Quark', color: '#8ac926', personality: 'Corner carver', grip: 1.03, pace: 0.97 },
  { name: 'Rally', color: '#ff924c', personality: 'Elbows out', berth: 0.75 },
  { name: 'Sprocket', color: '#4cc9f0', personality: 'Careful veteran', brake: 0.62, berth: 1.4 },
  { name: 'Vex', color: '#c77dff', personality: 'Perfectionist', grip: 1.02, brake: 0.74 },
];
const DIFFICULTY: Record<Difficulty, { grip: [number, number]; pace: [number, number] }> = {
  rookie: { grip: [0.6, 0.72], pace: [0.78, 0.85] },
  pro: { grip: [0.8, 0.92], pace: [0.88, 0.95] },
  legend: { grip: [0.94, 1.04], pace: [0.96, 1] },
};

export const DEFAULT_SETTINGS: RaceSettings = {
  laps: 3,
  cpu: 'bots',
  bots: 7,
  models: [{ id: 'typesafe/jev-1.13', name: 'Jev 1.13', promptPrice: 0.042, style: 'balanced' }],
  circuit: 'meadow',
  randomTrack: { seed: newSeed(), length: 2, complexity: 3 },
  participate: true,
  playerName: 'You',
  playerColor: PLAYER_COLORS[0],
  difficulty: 'pro',
  timeOfDay: 'morning',
};

export const demoSettings = (settings: RaceSettings): RaceSettings => ({
  ...DEFAULT_SETTINGS,
  laps: 99,
  participate: false,
  circuit: settings.circuit,
  randomTrack: settings.randomTrack,
});

export function trackFor(settings: RaceSettings): Track {
  if (settings.circuit === 'meadow') return MEADOW_RING;
  if (generated?.id !== randomTrackId(settings.randomTrack)) generated = generateTrack(settings.randomTrack);
  return generated;
}

export function canStart(settings: RaceSettings, keyStatus: KeyStatus): boolean {
  const gridSize = (settings.cpu === 'models' ? settings.models.length : settings.bots) + (settings.participate ? 1 : 0);
  return gridSize > 0 && (settings.cpu === 'bots' || keyUsable(keyStatus));
}

export const lapsFor = (settings: RaceSettings) => (settings.cpu === 'models' ? Math.min(settings.laps, MODEL_MAX_LAPS) : settings.laps);

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function createRace(settings: RaceSettings, keyboard: Keyboard): Race {
  const range = DIFFICULTY[settings.difficulty];
  const lerp = ([from, to]: [number, number], t: number) => from + (to - from) * t;
  const bots = (): RacerSetup[] =>
    BOTS.slice(0, settings.bots).map((bot, i) => {
      const t = settings.bots > 1 ? i / (settings.bots - 1) : 0.5;
      const { name, color, personality, grip, pace, ...style } = { ...STYLE_DEFAULTS, ...bot };
      return {
        id: `bot-${i + 1}`,
        name,
        color,
        driver: new BotDriver({ ...style, grip: lerp(range.grip, t) * grip, pace: lerp(range.pace, t) * pace, lane: ((i % 3) - 1) * 2 }, personality),
      };
    });
  const models = (): RacerSetup[] =>
    settings.models.map((model, i) => {
      const twins = settings.models.slice(0, i).filter((other) => other.id === model.id && other.style === model.style).length;
      return {
        id: `model-${i + 1}`,
        name: `${model.name} · ${model.style}${twins ? ` ${twins + 1}` : ''}`,
        color: BOTS[i].color,
        driver: new ModelDriver(model.id, model.style),
      };
    });
  const setups = settings.cpu === 'models' ? models() : bots();
  if (settings.participate) {
    setups.push({
      id: PLAYER_ID,
      name: settings.playerName.trim() || 'You',
      color: settings.playerColor,
      driver: new KeyboardDriver(keyboard),
    });
  }
  return new Race(trackFor(settings), shuffle(setups), lapsFor(settings));
}
