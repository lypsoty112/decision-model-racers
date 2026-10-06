/*
 * Between-races menu: race configuration, the stored track record, and the last race's results.
 *
 * `Menu` edits `RaceSettings`: lap count, bot count, racing or spectating, bot skill, time of
 * day, and, when racing, driver name and kart colour. It keeps at least one racer on the grid
 * when spectating, offers Resume while a race is paused behind it, and shows the final
 * standings after a race. `Segmented` renders a row of mutually exclusive choices as a radio
 * group.
 */
import { MAX_BOTS, PLAYER_COLORS, PLAYER_ID, type RaceSettings, TRACK } from '../game/setup';
import { TIME_PRESETS, type TimeOfDay } from '../render/environment';
import type { Racer } from '../sim/race';
import { formatTime, ordinal, readTrackRecord } from './format';

type MenuProps = {
  settings: RaceSettings;
  onChange: (settings: RaceSettings) => void;
  onStart: () => void;
  onResume: (() => void) | null;
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

export function Menu({ settings, onChange, onStart, onResume, results }: MenuProps) {
  const update = (patch: Partial<RaceSettings>) => {
    const next = { ...settings, ...patch };
    onChange(next.participate ? next : { ...next, bots: Math.max(1, next.bots) });
  };
  const record = readTrackRecord();
  const timeOptions = (Object.keys(TIME_PRESETS) as TimeOfDay[]).map((time): [TimeOfDay, string] => [time, TIME_PRESETS[time].label]);

  return (
    <div className="menu-backdrop">
      <div className="panel menu">
        <header className="menu-title">
          <p className="eyebrow">Decision Model Racers</p>
          <h1>Meadow Ring</h1>
          <p>
            {(TRACK.length / 1000).toFixed(2)} km · {TRACK.corners.length} corners · Record{' '}
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
            <label className="field">
              <span>
                Laps <strong>{settings.laps}</strong>
              </span>
              <input type="range" min={1} max={10} value={settings.laps} onChange={(event) => update({ laps: Number(event.target.value) })} />
            </label>
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
            <button type="submit" className="button primary" autoFocus>
              {settings.participate ? 'Start race' : 'Start spectating'}
            </button>
          </div>
        </form>

        <p className="hint">
          Decision models: every racer streams a <code>RacerObservation</code>. Swap any driver from the console with{' '}
          <code>racerAPI.setController(id, obs =&gt; controls)</code>, or run races headless with <code>bun run sim</code>.
        </p>
      </div>

      {results && (
        <aside className="panel menu-results">
          <h2>Last race</h2>
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
