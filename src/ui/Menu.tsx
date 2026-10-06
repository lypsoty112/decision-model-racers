/*
 * Between-races menu: race configuration, the stored track record, and the last race's results.
 *
 * `Menu` edits `RaceSettings`: the track (Meadow Ring, or a random track with a length,
 * complexity, and a New track button for a fresh seed; the title shows the selected track's name,
 * length, corners, seed, and record), lap count, racing or spectating, the CPU type (bots with a
 * count and skill, or OpenRouter decision models), time of day, and, when racing, driver name and
 * kart colour. Decision-model races are capped at MODEL_MAX_LAPS laps. Each time the menu opens it
 * re-checks the OpenRouter key and blocks decision-model races while the key is invalid or out of
 * credits. It offers Resume while a race is paused behind it, and after a race it shows the final
 * standings with a button to reopen the full report, and it links the source on GitHub.
 * `Segmented` renders a row of mutually exclusive choices as a radio group. `ModelPicker` loads
 * the decision-model catalogue and lets the player add up to MAX_MODELS entries, at most
 * MAX_COPIES of one model, each with its own driving style.
 */
import { useEffect, useState } from 'react';
import {
  canStart,
  lapsFor,
  MAX_BOTS,
  MAX_COMPLEXITY,
  MAX_COPIES,
  MAX_MODELS,
  type ModelEntry,
  MODEL_MAX_LAPS,
  newSeed,
  PLAYER_COLORS,
  PLAYER_ID,
  type RaceSettings,
  TRACK_LENGTH,
  trackFor,
} from '../game/setup';
import { DRIVING_STYLES, type DrivingStyle } from '../models/decisionState';
import { type DecisionModelInfo, type KeyStatus, keyUsable, listDecisionModels, refreshKeyStatus } from '../models/modelDriver';
import { TIME_PRESETS, type TimeOfDay } from '../render/environment';
import type { Racer } from '../sim/race';
import { formatTime, ordinal, readTrackRecord } from './format';

type MenuProps = {
  settings: RaceSettings;
  keyStatus: KeyStatus;
  onChange: (settings: RaceSettings) => void;
  onStart: () => void;
  onResume: (() => void) | null;
  onReport: () => void;
  results: Racer[] | null;
};

type SegmentedProps<T> = { label: string; value: T; options: [T, string][]; onSelect: (value: T) => void };

function Segmented<T extends string | boolean>({ label, value, options, onSelect }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([option, text]) => (
        <button
          key={String(option)}
          type="button"
          role="radio"
          aria-checked={option === value}
          className={option === value ? 'active' : undefined}
          onClick={() => onSelect(option)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

type ModelPickerProps = { selected: ModelEntry[]; onChange: (models: ModelEntry[]) => void };

const STYLE_OPTIONS = (Object.keys(DRIVING_STYLES) as DrivingStyle[]).map((style): [DrivingStyle, string] => [style, style[0].toUpperCase() + style.slice(1)]);

function ModelPicker({ selected, onChange }: ModelPickerProps) {
  const [catalogue, setCatalogue] = useState<DecisionModelInfo[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    listDecisionModels().then(setCatalogue, (reason: unknown) => setError(String(reason)));
  }, []);
  const copiesOf = (model: DecisionModelInfo) => selected.filter((entry) => entry.id === model.id).length;
  const setStyle = (index: number, style: DrivingStyle) => onChange(selected.map((entry, i) => (i === index ? { ...entry, style } : entry)));

  if (error) return <p className="model-error">Couldn't load decision models: {error}</p>;
  if (!catalogue) return <p className="hint">Loading decision models from OpenRouter…</p>;
  return (
    <>
      {selected.length > 0 && (
        <ol className="model-grid">
          {selected.map((entry, i) => (
            <li key={i}>
              <span className="model-name">{entry.name}</span>
              <Segmented label={`${entry.name} driving style`} value={entry.style} options={STYLE_OPTIONS} onSelect={(style) => setStyle(i, style)} />
              <button type="button" className="button secondary small" onClick={() => onChange(selected.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      <ul className="model-list">
        {catalogue.map((model) => (
          <li key={model.id}>
            <span className="model-name">{model.name}</span>
            <code>{model.id}</code>
            <span className="muted">${model.promptPrice.toFixed(3)}/M</span>
            <button
              type="button"
              className="button secondary small"
              disabled={copiesOf(model) >= MAX_COPIES || selected.length >= MAX_MODELS}
              onClick={() => onChange([...selected, { ...model, style: 'balanced' }])}
            >
              Add
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Menu({ settings, keyStatus, onChange, onStart, onResume, onReport, results }: MenuProps) {
  useEffect(() => refreshKeyStatus(), []);
  const update = (patch: Partial<RaceSettings>) => {
    const next = { ...settings, ...patch };
    onChange(next.participate ? next : { ...next, bots: Math.max(1, next.bots) });
  };
  const updateTrack = (patch: Partial<RaceSettings['randomTrack']>) => update({ randomTrack: { ...settings.randomTrack, ...patch } });
  const track = trackFor(settings);
  const record = readTrackRecord(track.id);
  const timeOptions = (Object.keys(TIME_PRESETS) as TimeOfDay[]).map((time): [TimeOfDay, string] => [time, TIME_PRESETS[time].label]);

  return (
    <div className="menu-backdrop">
      <div className="panel menu">
        <header className="menu-title">
          <p className="eyebrow">Decision Model Racers</p>
          <h1>{track.name}</h1>
          <p>
            {(track.length / 1000).toFixed(2)} km · {track.corners.length} corners ·{' '}
            {settings.circuit === 'random' && `seed ${settings.randomTrack.seed} · `}Record{' '}
            {record ? `${formatTime(record.time)} by ${record.name}` : 'not set yet'}
          </p>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onStart();
          }}
        >
          <div className="menu-grid">
            <div className="field wide">
              <span>Track</span>
              <div className="track-picker">
                <Segmented
                  label="Track"
                  value={settings.circuit}
                  options={[
                    ['meadow', 'Meadow Ring'],
                    ['random', 'Random'],
                  ]}
                  onSelect={(circuit) => update({ circuit })}
                />
                {settings.circuit === 'random' && (
                  <button type="button" className="button secondary small" onClick={() => updateTrack({ seed: newSeed() })}>
                    New track
                  </button>
                )}
              </div>
            </div>
            {settings.circuit === 'random' && (
              <>
                <label className="field">
                  <span>
                    Length <strong>{settings.randomTrack.length.toFixed(1)} km</strong>
                  </span>
                  <input
                    type="range"
                    min={TRACK_LENGTH.min}
                    max={TRACK_LENGTH.max}
                    step={0.1}
                    value={settings.randomTrack.length}
                    onChange={(event) => updateTrack({ length: Math.round(Number(event.target.value) * 10) / 10 })}
                  />
                </label>
                <label className="field">
                  <span>
                    Complexity <strong>{settings.randomTrack.complexity}</strong>
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={MAX_COMPLEXITY}
                    value={settings.randomTrack.complexity}
                    onChange={(event) => updateTrack({ complexity: Number(event.target.value) })}
                  />
                </label>
              </>
            )}
            <label className="field">
              <span>
                Laps {settings.cpu === 'models' && <em className="muted">decision models race {MODEL_MAX_LAPS}</em>}
                <strong>{lapsFor(settings)}</strong>
              </span>
              <input
                type="range"
                min={1}
                max={10}
                value={lapsFor(settings)}
                disabled={settings.cpu === 'models'}
                onChange={(event) => update({ laps: Number(event.target.value) })}
              />
            </label>
            <div className="field">
              <span>You</span>
              <Segmented
                label="Participation"
                value={settings.participate}
                options={[
                  [true, 'Race'],
                  [false, 'Spectate'],
                ]}
                onSelect={(participate) => update({ participate })}
              />
            </div>
            <div className="field wide">
              <span>CPU</span>
              <Segmented
                label="CPU type"
                value={settings.cpu}
                options={[
                  ['bots', 'Bots'],
                  ['models', 'Decision models'],
                ]}
                onSelect={(cpu) => update({ cpu })}
              />
            </div>
            {settings.cpu === 'bots' ? (
              <>
                <label className="field">
                  <span>
                    Bots <strong>{settings.bots}</strong>
                  </span>
                  <input
                    type="range"
                    min={settings.participate ? 0 : 1}
                    max={MAX_BOTS}
                    value={settings.bots}
                    onChange={(event) => update({ bots: Number(event.target.value) })}
                  />
                </label>
                <div className="field">
                  <span>Bot skill</span>
                  <Segmented
                    label="Bot skill"
                    value={settings.difficulty}
                    options={[
                      ['rookie', 'Rookie'],
                      ['pro', 'Pro'],
                      ['legend', 'Legend'],
                    ]}
                    onSelect={(difficulty) => update({ difficulty })}
                  />
                </div>
              </>
            ) : (
              <div className="field wide">
                <span>
                  Decision models on OpenRouter{' '}
                  <strong>
                    {settings.models.length}/{MAX_MODELS}
                  </strong>
                </span>
                <ModelPicker selected={settings.models} onChange={(models) => update({ models })} />
                {keyUsable(keyStatus) ? (
                  <p className="hint">
                    {keyStatus.message}
                    {keyStatus.remaining !== null && ` $${keyStatus.remaining.toFixed(2)} of credit left.`}
                  </p>
                ) : (
                  <p className="model-error">Decision-model races are blocked. {keyStatus.message}</p>
                )}
              </div>
            )}
            <div className="field wide">
              <span>Time of day</span>
              <Segmented label="Time of day" value={settings.timeOfDay} options={timeOptions} onSelect={(timeOfDay) => update({ timeOfDay })} />
            </div>
            {settings.participate && (
              <>
                <label className="field">
                  <span>Driver name</span>
                  <input type="text" maxLength={12} value={settings.playerName} onChange={(event) => update({ playerName: event.target.value })} />
                </label>
                <div className="field">
                  <span>Kart colour</span>
                  <div className="swatches" role="radiogroup" aria-label="Kart colour">
                    {PLAYER_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        role="radio"
                        aria-checked={color === settings.playerColor}
                        aria-label={color}
                        className={color === settings.playerColor ? 'active' : undefined}
                        style={{ background: color }}
                        onClick={() => update({ playerColor: color })}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="menu-actions">
            {onResume && (
              <button type="button" className="button secondary" onClick={onResume}>
                Resume
              </button>
            )}
            <button type="submit" className="button primary" autoFocus disabled={!canStart(settings, keyStatus)}>
              {settings.participate ? 'Start race' : 'Start spectating'}
            </button>
          </div>
        </form>

        <p className="hint">
          Decision models: every racer streams a <code>RacerObservation</code>. Swap any driver from the console with{' '}
          <code>racerAPI.setController(id, obs =&gt; controls)</code>, or run races headless with <code>bun run sim</code>.{' '}
          <a href="https://github.com/lypsoty112/decision-model-racers" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </p>
      </div>

      {results && (
        <aside className="panel menu-results">
          <header className="menu-results-header">
            <h2>Last race</h2>
            <button type="button" className="button secondary small" onClick={onReport}>
              Full report
            </button>
          </header>
          <ol>
            {results.map((racer) => (
              <li key={racer.id} className={racer.id === PLAYER_ID ? 'focused' : undefined}>
                <span>{ordinal(racer.position)}</span>
                <span className="swatch" style={{ background: racer.color }} />
                <span className="standings-name">{racer.name}</span>
                <span>{racer.finishTime === null ? 'DNF' : formatTime(racer.finishTime)}</span>
                <span className="muted">best {formatTime(racer.bestLap)}</span>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  );
}
