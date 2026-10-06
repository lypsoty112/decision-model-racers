/*
 * Live view of the `RacerObservation` the focused racer's driver receives, which is exactly what
 * a decision model gets through `window.racerAPI`.
 *
 * `Telemetry` refreshes ten times a second and lists the core state (plus a bot's personality,
 * or model id, driving style, decisions, latency, cost, and errors for an OpenRouter decision
 * model), the controls as bars, the corners
 * ahead, and the nearest opponents. "Copy JSON" puts the full observation on the
 * clipboard. `Bar` draws a signed or unsigned value as a filled track.
 */
import { useState } from 'react';
import { ModelDriver } from '../models/modelDriver';
import { BotDriver } from '../sim/botDriver';
import type { Race } from '../sim/race';
import { formatTime } from './format';
import { useTick } from './useTick';

type TelemetryProps = { race: Race; focusId: string };

function Bar({ value, signed = false }: { value: number; signed?: boolean }) {
  const clamped = Math.max(-1, Math.min(1, value));
  const style = signed
    ? { left: `${50 + Math.min(0, clamped) * 50}%`, width: `${Math.abs(clamped) * 50}%` }
    : { left: '0%', width: `${Math.max(0, clamped) * 100}%` };
  return (
    <span className={`bar${signed ? ' signed' : ''}`}>
      <span className="bar-fill" style={style} />
    </span>
  );
}

export function Telemetry({ race, focusId }: TelemetryProps) {
  useTick(100);
  const [copied, setCopied] = useState(false);
  const racer = race.racers.find((candidate) => candidate.id === focusId) ?? race.standings()[0];
  const observation = race.observe(racer);
  const degrees = (radians: number) => `${((radians * 180) / Math.PI).toFixed(1)}°`;

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(race.observe(racer), null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <aside className="panel telemetry" aria-label="Decision model telemetry">
      <header>
        <h3>
          <span className="swatch" style={{ background: racer.color }} /> {observation.name} <small>{observation.driver}</small>
        </h3>
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy JSON'}
        </button>
      </header>
      <dl className="telemetry-grid">
        <dt>tick</dt>
        <dd>{observation.tick}</dd>
        <dt>position</dt>
        <dd>
          {observation.position}/{observation.racerCount}
        </dd>
        <dt>lap</dt>
        <dd>
          {observation.lap}/{observation.totalLaps} · {(observation.lapProgress * 100).toFixed(0)}%
        </dd>
        <dt>speed</dt>
        <dd>{observation.speed.toFixed(1)} m/s</dd>
        <dt>lateral</dt>
        <dd>
          {observation.lateralOffset.toFixed(2)} m of ±{observation.trackHalfWidth}
        </dd>
        <dt>heading err</dt>
        <dd>{degrees(observation.headingError)}</dd>
        <dt>slipstream</dt>
        <dd>{observation.slipstream.toFixed(2)}</dd>
        <dt>flags</dt>
        <dd>{[observation.offTrack && 'off-track', observation.wrongWay && 'wrong-way'].filter(Boolean).join(', ') || '–'}</dd>
        <dt>lap time</dt>
        <dd>{formatTime(observation.timing.currentLap)}</dd>
        <dt>respawns</dt>
        <dd>{observation.respawns}</dd>
        {racer.driver instanceof BotDriver && (
          <>
            <dt>personality</dt>
            <dd>{racer.driver.personality}</dd>
          </>
        )}
        {racer.driver instanceof ModelDriver && (
          <>
            <dt>model</dt>
            <dd>
              <code>{racer.driver.model}</code>
            </dd>
            <dt>style</dt>
            <dd>{racer.driver.style}</dd>
            <dt>decisions</dt>
            <dd>
              {racer.driver.stats.decisions} · last {racer.driver.stats.latencyMs.toFixed(0)} ms
            </dd>
            <dt>cost</dt>
            <dd>${racer.driver.stats.cost.toFixed(5)}</dd>
            <dt>errors</dt>
            <dd title={racer.driver.stats.lastError}>{racer.driver.stats.errors}</dd>
          </>
        )}
      </dl>
      {racer.driver instanceof ModelDriver && racer.driver.stats.lastError && <p className="model-error">{racer.driver.stats.lastError}</p>}

      <h4>Controls</h4>
      <div className="telemetry-controls">
        <span>throttle</span>
        <Bar value={observation.controls.throttle} />
        <span>brake</span>
        <Bar value={observation.controls.brake} />
        <span>steer</span>
        <Bar value={observation.controls.steer} signed />
      </div>

      <h4>Corners ahead</h4>
      <ul className="telemetry-list">
        {observation.track.corners.map((corner) => (
          <li key={`${corner.distance.toFixed(0)}-${corner.direction}`}>
            {corner.distance < 0 ? 'in corner' : `${corner.distance.toFixed(0)} m`} · {corner.direction} · r {corner.radius.toFixed(0)} m ·{' '}
            {corner.angleDeg.toFixed(0)}°
          </li>
        ))}
      </ul>

      <h4>Nearest opponents</h4>
      <ul className="telemetry-list">
        {observation.opponents.slice(0, 4).map((opponent) => (
          <li key={opponent.id}>
            {opponent.name} · gap {opponent.gap.toFixed(1)} m · at ({opponent.x.toFixed(1)}, {opponent.z.toFixed(1)}) · Δv{' '}
            {opponent.relativeSpeed.toFixed(1)}
          </li>
        ))}
      </ul>
      <p className="hint">
        Also available as <code>window.racerAPI.observe(&quot;{observation.id}&quot;)</code>
      </p>
    </aside>
  );
}
