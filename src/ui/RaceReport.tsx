/*
 * The full-screen post-race report.
 *
 * `RaceReport` summarizes every racer once with `summarize`, adding `modelSummary` (model, driving
 * style, decisions, rate, latency, errors, cost) for racers driven by an OpenRouter model and the
 * personality of each bot. It lays out highlight
 * cards chosen by `leaderOf`, two `LineChart`s (race position over time, and speed around the
 * lap), the metrics grid where each row comes from METRICS and the best value is marked, and the
 * lap-times table. "Copy JSON" exports every summary; "Back to menu" closes it.
 */
import { useMemo, useState } from 'react';
import { ModelDriver } from '../models/modelDriver';
import { BotDriver } from '../sim/botDriver';
import { PROFILE_BIN, type Race, type Racer } from '../sim/race';
import { type RacerSummary, summarize } from '../sim/raceStats';
import { formatTime, ordinal } from './format';

type RaceReportProps = { race: Race; onClose: () => void };
type ModelSummary = ReturnType<typeof modelSummary>;
type Row = RacerSummary & { model: ModelSummary | null; personality: string | null };
type Metric = { group: string; label: string; value: (row: Row) => number | null; format: (value: number) => string; better?: 'high' | 'low' };
type Series = { color: string; points: [number, number][] };

const kmh = (value: number) => `${value.toFixed(0)} km/h`;
const pct = (value: number) => `${value.toFixed(1)}%`;
const count = (value: number) => value.toFixed(0);
const seconds = (value: number) => `${value.toFixed(2)} s`;

const METRICS: Metric[] = [
  { group: 'Result', label: 'Finish time', value: (r) => r.finishTime, format: formatTime, better: 'low' },
  { group: 'Result', label: 'Laps completed', value: (r) => r.lapsCompleted, format: count, better: 'high' },
  { group: 'Result', label: 'Best lap', value: (r) => r.bestLap, format: formatTime, better: 'low' },
  { group: 'Result', label: 'Average lap', value: (r) => r.averageLap, format: formatTime, better: 'low' },
  { group: 'Result', label: 'Lap spread (±)', value: (r) => r.lapSpread, format: seconds, better: 'low' },
  { group: 'Result', label: 'Distance driven', value: (r) => r.distance, format: (v) => `${(v / 1000).toFixed(2)} km` },
  { group: 'Pace', label: 'Top speed', value: (r) => r.topSpeedKmh, format: kmh, better: 'high' },
  { group: 'Pace', label: 'Average speed', value: (r) => r.averageSpeedKmh, format: kmh, better: 'high' },
  { group: 'Pace', label: 'Peak cornering load', value: (r) => r.peakLateralG, format: (v) => `${v.toFixed(2)} g`, better: 'high' },
  { group: 'Pace', label: 'Time at full throttle', value: (r) => r.fullThrottlePct, format: pct, better: 'high' },
  { group: 'Pace', label: 'Average throttle', value: (r) => r.averageThrottlePct, format: pct },
  { group: 'Driving', label: 'Time on track', value: (r) => r.onTrackPct, format: pct, better: 'high' },
  { group: 'Driving', label: 'Time off track', value: (r) => r.offTrackPct, format: pct, better: 'low' },
  { group: 'Driving', label: 'Time against walls', value: (r) => r.wallPct, format: pct, better: 'low' },
  { group: 'Driving', label: 'Wall hits', value: (r) => r.wallHits, format: count, better: 'low' },
  { group: 'Driving', label: 'Time facing backwards', value: (r) => r.wrongWayPct, format: pct, better: 'low' },
  { group: 'Driving', label: 'Time sliding', value: (r) => r.slidingPct, format: pct, better: 'low' },
  { group: 'Driving', label: 'Time braking', value: (r) => r.brakingPct, format: pct },
  { group: 'Driving', label: 'Brake applications', value: (r) => r.brakeApplications, format: count },
  { group: 'Driving', label: 'Brake pressure when braking', value: (r) => r.brakePressurePct, format: pct },
  { group: 'Driving', label: 'Steering effort', value: (r) => r.steeringEffortPct, format: pct },
  { group: 'Driving', label: 'Steering changes per second', value: (r) => r.steeringChangesPerSecond, format: (v) => v.toFixed(2), better: 'low' },
  { group: 'Driving', label: 'Time in slipstream', value: (r) => r.slipstreamPct, format: pct },
  { group: 'Racecraft', label: 'Start position', value: (r) => r.startPosition, format: ordinal },
  { group: 'Racecraft', label: 'Finish position', value: (r) => r.position, format: ordinal, better: 'low' },
  { group: 'Racecraft', label: 'Places gained', value: (r) => r.placesGained, format: (v) => (v > 0 ? `+${v}` : `${v}`), better: 'high' },
  { group: 'Racecraft', label: 'Overtakes', value: (r) => r.overtakes, format: count, better: 'high' },
  { group: 'Racecraft', label: 'Places lost', value: (r) => r.placesLost, format: count, better: 'low' },
  { group: 'Racecraft', label: 'Best position', value: (r) => r.bestPosition, format: ordinal, better: 'low' },
  { group: 'Racecraft', label: 'Worst position', value: (r) => r.worstPosition, format: ordinal, better: 'low' },
  { group: 'Racecraft', label: 'Time leading', value: (r) => r.leadingPct, format: pct, better: 'high' },
  { group: 'Racecraft', label: 'Car contacts', value: (r) => r.contacts, format: count, better: 'low' },
  { group: 'Racecraft', label: 'Respawns', value: (r) => r.respawns, format: count, better: 'low' },
  { group: 'Decision model', label: 'Decisions', value: (r) => r.model?.decisions ?? null, format: count },
  { group: 'Decision model', label: 'Decisions per second', value: (r) => r.model?.decisionsPerSecond ?? null, format: (v) => v.toFixed(2), better: 'high' },
  { group: 'Decision model', label: 'Average latency', value: (r) => r.model?.averageLatencyMs ?? null, format: (v) => `${v.toFixed(0)} ms`, better: 'low' },
  { group: 'Decision model', label: 'Worst latency', value: (r) => r.model?.maxLatencyMs ?? null, format: (v) => `${v.toFixed(0)} ms`, better: 'low' },
  { group: 'Decision model', label: 'Errors', value: (r) => r.model?.errors ?? null, format: count, better: 'low' },
  { group: 'Decision model', label: 'Cost', value: (r) => r.model?.cost ?? null, format: (v) => `$${v.toFixed(5)}`, better: 'low' },
];

function modelSummary(racer: Racer) {
  if (!(racer.driver instanceof ModelDriver)) return null;
  const { stats, model, style } = racer.driver;
  const answered = Math.max(1, stats.decisions + stats.errors);
  return {
    model,
    style,
    decisions: stats.decisions,
    decisionsPerSecond: stats.decisions / Math.max(racer.stats.racingTime, 1e-6),
    averageLatencyMs: stats.totalLatencyMs / answered,
    maxLatencyMs: stats.maxLatencyMs,
    errors: stats.errors,
    cost: stats.cost,
    lastError: stats.lastError,
  };
}

function bestOf(rows: Row[], metric: Metric): string | null {
  const values = rows.map(metric.value).filter((value): value is number => value !== null);
  const shown = values.map(metric.format);
  if (!metric.better || values.length < 2 || shown.every((text) => text === shown[0])) return null;
  return metric.format(metric.better === 'high' ? Math.max(...values) : Math.min(...values));
}

function leaderOf(rows: Row[], value: (row: Row) => number | null, better: 'high' | 'low'): Row | null {
  return rows.reduce<Row | null>((best, row) => {
    const candidate = value(row);
    if (candidate === null) return best;
    const current = best ? value(best) : null;
    return current === null || (better === 'high' ? candidate > current : candidate < current) ? row : best;
  }, null);
}

function LineChart({ series, xMax, yMin, yMax, invertY, xLabel, yLabel }: { series: Series[]; xMax: number; yMin: number; yMax: number; invertY?: boolean; xLabel: string; yLabel: string }) {
  const [width, height, left, bottom] = [640, 240, 44, 30];
  const x = (value: number) => left + (value / Math.max(xMax, 1e-6)) * (width - left - 10);
  const y = (value: number) => {
    const t = (value - yMin) / Math.max(yMax - yMin, 1e-6);
    return 10 + (invertY ? t : 1 - t) * (height - bottom - 10);
  };
  const ticks = [yMin, (yMin + yMax) / 2, yMax];
  return (
    <svg className="report-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${yLabel} against ${xLabel}`}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={left} x2={width - 10} y1={y(tick)} y2={y(tick)} className="chart-grid" />
          <text x={left - 6} y={y(tick) + 4} className="chart-tick" textAnchor="end">
            {Math.round(tick)}
          </text>
        </g>
      ))}
      <text x={width - 10} y={height - 8} className="chart-tick" textAnchor="end">
        {xLabel}
      </text>
      <text x={left} y={height - 8} className="chart-tick">
        0
      </text>
      {series.map((line, i) => (
        <polyline key={i} points={line.points.map(([px, py]) => `${x(px).toFixed(1)},${y(py).toFixed(1)}`).join(' ')} stroke={line.color} className="chart-line" />
      ))}
    </svg>
  );
}

export function RaceReport({ race, onClose }: RaceReportProps) {
  const [copied, setCopied] = useState(false);
  const rows = useMemo<Row[]>(
    () =>
      race.standings().map((racer) => ({
        ...summarize(racer, race),
        model: modelSummary(racer),
        personality: racer.driver instanceof BotDriver ? racer.driver.personality : null,
      })),
    [race],
  );
  const winner = rows[0];
  const laps = Math.max(1, ...rows.map((row) => row.lapTimes.length));
  const topSpeed = Math.max(1, ...rows.map((row) => row.topSpeedKmh));
  const traceLength = Math.max(1, ...rows.map((row) => row.positionTrace.length));
  const hasModels = rows.some((row) => row.model);
  const metrics = METRICS.filter((metric) => hasModels || metric.group !== 'Decision model');
  const groups = [...new Set(metrics.map((metric) => metric.group))];

  const highlights = [
    { title: 'Winner', row: winner, detail: winner.finishTime === null ? 'leading at the end' : formatTime(winner.finishTime) },
    { title: 'Fastest lap', row: leaderOf(rows, (r) => r.bestLap, 'low'), detail: (r: Row) => formatTime(r.bestLap) },
    { title: 'Top speed', row: leaderOf(rows, (r) => r.topSpeedKmh, 'high'), detail: (r: Row) => kmh(r.topSpeedKmh) },
    { title: 'Cleanest driver', row: leaderOf(rows, (r) => r.onTrackPct - r.wallHits, 'high'), detail: (r: Row) => `${pct(r.onTrackPct)} on track, ${r.wallHits} wall hits` },
    { title: 'Most overtakes', row: leaderOf(rows, (r) => r.overtakes, 'high'), detail: (r: Row) => `${r.overtakes} overtakes` },
    { title: 'Smoothest hands', row: leaderOf(rows, (r) => r.steeringChangesPerSecond, 'low'), detail: (r: Row) => `${r.steeringChangesPerSecond.toFixed(2)} steering changes/s` },
    ...(hasModels
      ? [
          { title: 'Quickest thinker', row: leaderOf(rows, (r) => r.model?.averageLatencyMs ?? null, 'low'), detail: (r: Row) => `${r.model?.averageLatencyMs.toFixed(0)} ms per decision` },
          { title: 'Cheapest model', row: leaderOf(rows, (r) => r.model?.cost ?? null, 'low'), detail: (r: Row) => `$${r.model?.cost.toFixed(5)}` },
        ]
      : []),
  ];

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify({ laps: race.totalLaps, trackLength: race.track.length, racers: rows }, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="report-backdrop">
      <article className="report" aria-label="Race report">
        <header className="report-header">
          <div>
            <p className="eyebrow">Race report</p>
            <h1>
              Meadow Ring · {race.totalLaps} {race.totalLaps === 1 ? 'lap' : 'laps'}
            </h1>
            <p className="muted">
              {rows.length} racers · {(race.track.length / 1000).toFixed(2)} km lap · {rows.filter((row) => row.finishTime !== null).length} finished
            </p>
          </div>
          <div className="report-actions">
            <button type="button" className="button secondary" onClick={copy}>
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
            <button type="button" className="button primary" onClick={onClose}>
              Back to menu
            </button>
          </div>
        </header>

        <section className="report-highlights">
          {highlights
            .filter((highlight) => highlight.row)
            .map((highlight) => (
              <div key={highlight.title} className="report-card">
                <span className="report-card-title">{highlight.title}</span>
                <strong>
                  <span className="swatch" style={{ background: highlight.row!.color }} /> {highlight.row!.name}
                </strong>
                <span className="muted">{typeof highlight.detail === 'string' ? highlight.detail : highlight.detail(highlight.row!)}</span>
              </div>
            ))}
        </section>

        <section className="report-charts">
          <figure>
            <figcaption>Race position over time</figcaption>
            <LineChart
              series={rows.map((row) => ({ color: row.color, points: row.positionTrace.map((position, second): [number, number] => [second, position]) }))}
              xMax={traceLength - 1}
              yMin={1}
              yMax={rows.length}
              invertY
              xLabel={`${traceLength - 1} s`}
              yLabel="position"
            />
          </figure>
          <figure>
            <figcaption>Speed around the lap (last lap, km/h)</figcaption>
            <LineChart
              series={rows.map((row) => ({
                color: row.color,
                points: row.speedProfileKmh.flatMap((speed, bin): [number, number][] => (speed > 0 ? [[bin * PROFILE_BIN, speed]] : [])),
              }))}
              xMax={race.track.length}
              yMin={0}
              yMax={topSpeed}
              xLabel={`${Math.round(race.track.length)} m`}
              yLabel="speed"
            />
          </figure>
        </section>

        <section className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Metric</th>
                {rows.map((row) => (
                  <th key={row.id}>
                    <span className="swatch" style={{ background: row.color }} /> {row.name}
                    {row.model && <small>{row.model.model}</small>}
                    {row.personality && <small>{row.personality}</small>}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group}>
                <tr className="report-group">
                  <th colSpan={rows.length + 1}>{group}</th>
                </tr>
                {metrics
                  .filter((metric) => metric.group === group)
                  .map((metric) => {
                    const best = bestOf(rows, metric);
                    return (
                      <tr key={metric.label}>
                        <th>{metric.label}</th>
                        {rows.map((row) => {
                          const value = metric.value(row);
                          const text = value === null ? '–' : metric.format(value);
                          return (
                            <td key={row.id} className={text === best ? 'best' : undefined}>
                              {text}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
              </tbody>
            ))}
          </table>
        </section>

        <section className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Lap times</th>
                {Array.from({ length: laps }, (_, lap) => (
                  <th key={lap}>Lap {lap + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th>
                    <span className="swatch" style={{ background: row.color }} /> {row.name}
                  </th>
                  {Array.from({ length: laps }, (_, lap) => {
                    const time = row.lapTimes[lap];
                    const fastest = Math.min(...rows.map((other) => other.lapTimes[lap] ?? Infinity));
                    return (
                      <td key={lap} className={time === fastest ? 'best' : undefined}>
                        {time === undefined ? '–' : formatTime(time)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </article>
    </div>
  );
}
