/*
 * The in-race heads-up display, refreshed 20 times a second from the mutable race.
 *
 * `Hud` lays out the standings tower, the lap and timing panel, the countdown, warnings (wrong
 * way, off track, slipstream), the big position read-out with the `Speedometer` arc gauge, a
 * spectating banner naming the camera mode and the racer it follows, and the full-screen
 * `RaceReport` once the race is over. `gapText` estimates each racer's gap to the leader from the leader's
 * average pace. The fastest lap of the session is offered to the stored track record.
 */
import { useEffect, useState } from 'react';
import { PLAYER_ID } from '../game/setup';
import type { CameraMode } from '../render/engine';
import { CAR_SPEC } from '../sim/car';
import type { Race, Racer } from '../sim/race';
import { formatTime, ordinal, readTrackRecord, submitLap } from './format';
import { RaceReport } from './RaceReport';
import { useTick } from './useTick';

type HudProps = { race: Race; focusId: string; cameraMode: CameraMode; onMenu: () => void };

const CAMERA_LABELS: Record<CameraMode, string> = { chase: 'Chase cam', overhead: "Bird's eye", tv: 'TV' };

const lapOf = (race: Race, racer: Racer) => Math.min(race.totalLaps, Math.max(1, racer.lapsCompleted + 1));

function gapText(race: Race, racer: Racer, leader: Racer): string {
  if (racer.finishTime !== null && leader.finishTime !== null) {
    return racer === leader ? formatTime(racer.finishTime) : `+${(racer.finishTime - leader.finishTime).toFixed(2)}s`;
  }
  if (racer === leader) return `Lap ${lapOf(race, racer)}`;
  const behind = leader.progress - racer.progress;
  if (behind >= race.track.length) return `+${Math.floor(behind / race.track.length)} lap`;
  return `+${(behind / Math.max(20, leader.progress / Math.max(race.time, 1))).toFixed(1)}s`;
}

function Speedometer({ speed }: { speed: number }) {
  const ratio = Math.min(1, Math.abs(speed) / (CAR_SPEC.maxSpeed * 1.08));
  const arc = 'M 24.6 112 A 64 64 0 1 1 135.4 112';
  return (
    <svg className="speedometer" viewBox="0 0 160 140" role="img" aria-label={`${Math.round(Math.abs(speed) * 3.6)} kilometres per hour`}>
      <defs>
        <linearGradient id="speed-gradient" x1="0" x2="1">
          <stop offset="0%" stopColor="#7ee8fa" />
          <stop offset="60%" stopColor="#ffe66d" />
          <stop offset="100%" stopColor="#ff5d73" />
        </linearGradient>
      </defs>
      <path d={arc} className="speedometer-track" pathLength={1} />
      <path d={arc} className="speedometer-fill" pathLength={1} strokeDasharray={`${ratio} 1`} stroke="url(#speed-gradient)" />
      <text x="80" y="88" className="speedometer-value">{Math.round(Math.abs(speed) * 3.6)}</text>
      <text x="80" y="110" className="speedometer-unit">km/h</text>
    </svg>
  );
}

export function Hud({ race, focusId, cameraMode, onMenu }: HudProps) {
  useTick(50);
  const [stored] = useState(readTrackRecord);
  const spectating = !race.racers.some((racer) => racer.id === PLAYER_ID);
  const standings = race.standings();
  const leader = standings[0];
  const focused = standings.find((racer) => racer.id === focusId) ?? leader;
  const observation = race.observe(focused);
  const fastest = race.racers.reduce<Racer | null>((best, racer) => (racer.bestLap !== null && racer.bestLap < (best?.bestLap ?? Infinity) ? racer : best), null);
  const record =
    fastest?.bestLap && fastest.bestLap < (stored?.time ?? Infinity)
      ? { time: fastest.bestLap, name: fastest.name, driver: fastest.driver.kind }
      : stored;

  useEffect(() => {
    if (record && record !== stored) submitLap(record);
  });

  return (
    <div className="hud">
      <ol className="panel standings">
        {standings.map((racer) => (
          <li key={racer.id} className={racer.id === focused.id ? 'focused' : undefined}>
            <span className="standings-position">{racer.position}</span>
            <span className="swatch" style={{ background: racer.color }} />
            <span className="standings-name">{racer.name}</span>
            <span className="standings-gap">{gapText(race, racer, leader)}</span>
          </li>
        ))}
      </ol>

      <div className="panel lap-panel">
        <div className="lap-count">
          LAP <strong>{lapOf(race, focused)}</strong>/{race.totalLaps}
        </div>
        <dl>
          <dt>Time</dt>
          <dd>{formatTime(observation.timing.finishTime ?? observation.timing.currentLap)}</dd>
          <dt>Last</dt>
          <dd>{formatTime(focused.lastLap)}</dd>
          <dt>Best</dt>
          <dd>{formatTime(focused.bestLap)}</dd>
          <dt>Record</dt>
          <dd>{record ? `${formatTime(record.time)} · ${record.name}` : '–'}</dd>
        </dl>
      </div>

      {race.phase === 'countdown' && (
        <div key={Math.ceil(-race.time)} className="countdown">
          {Math.ceil(-race.time)}
        </div>
      )}
      {race.phase === 'racing' && race.time < 1 && <div className="countdown go">GO!</div>}

      <div className="warnings">
        {observation.wrongWay && observation.speed > 2 && <span className="warning danger">Wrong way</span>}
        {observation.offTrack && !observation.finished && <span className="warning">Off track</span>}
        {observation.slipstream > 0.25 && observation.speed > 10 && <span className="warning boost">Slipstream</span>}
      </div>

      <div className="dash">
        <div className="position-readout">
          <strong>{ordinal(focused.position)}</strong>
          <span>/{race.racers.length}</span>
        </div>
        <Speedometer speed={focused.car.speed} />
      </div>

      {focused.id !== PLAYER_ID && (
        <div className="spectating">
          {CAMERA_LABELS[cameraMode]} · {cameraMode === 'tv' ? 'director on' : 'following'} <strong style={{ color: focused.color }}>{focused.name}</strong>
          {cameraMode !== 'tv' && (
            <>
              {' '}
              · <kbd>V</kbd> next racer
            </>
          )}
          {spectating && (
            <>
              {' '}
              · <kbd>C</kbd> camera
            </>
          )}
        </div>
      )}

      {race.phase === 'finished' && <RaceReport race={race} onClose={onMenu} />}

      <div className="hints">
        <kbd>W</kbd>/<kbd>↑</kbd> throttle · <kbd>S</kbd>/<kbd>↓</kbd> brake · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>R</kbd> reset ·{' '}
        <kbd>V</kbd> camera · <kbd>T</kbd> telemetry · <kbd>Esc</kbd> menu
      </div>
    </div>
  );
}
