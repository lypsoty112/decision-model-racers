/*
 * A racer driven in real time by an OpenRouter decision model, the model catalogue, and the
 * health of the OpenRouter key.
 *
 * `ModelDriver.decide` runs every simulation step like any driver. It returns the controls from
 * the model's latest answer and, when no request is in flight, the key is usable, and at least
 * MIN_INTERVAL seconds of race time have passed, starts `ask`, a `POST /api/decide` with the
 * current state, so the race keeps running while the model thinks. Once the racer finishes it
 * stops asking and coasts. Every request carries the driver's `DrivingStyle`. `stats` holds
 * decisions, errors, latency (last, total, worst), and cost for the telemetry panel and the
 * race report.
 *
 * The key status is a tiny store: `getKeyStatus` and `subscribeKeyStatus` back React's
 * `useSyncExternalStore`, `refreshKeyStatus` asks `GET /api/key-status`, and any decision that
 * fails with 401 (invalid key) or 402 (no credits) marks the key unusable, which stops every
 * model from asking. `listDecisionModels` fetches the catalogue once and reuses it.
 */
import type { DecisionsResponse } from '@openrouter/sdk/models';
import type { Controls, Driver, RacerObservation } from '../sim/types';
import { DECISION_QUESTIONS, type DecisionAction, describeState, type DrivingStyle, toControls } from './decisionState';

export type DecisionModelInfo = { id: string; name: string; promptPrice: number };
export type KeyStatus = { state: 'checking' | 'ok' | 'invalid' | 'no-credits'; message: string; remaining: number | null };

const MIN_INTERVAL = 0.2;
const COAST: Controls = { throttle: 0, brake: 0, steer: 0 };
const KEY_FAILURES: Record<number, KeyStatus['state']> = { 401: 'invalid', 402: 'no-credits' };

let catalogue: Promise<DecisionModelInfo[]> | null = null;
let keyStatus: KeyStatus = { state: 'checking', message: 'Checking the OpenRouter key…', remaining: null };
const keyListeners = new Set<() => void>();

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new HttpError(response.status, body.error ?? `${url} answered ${response.status}`);
  return body as T;
}

function setKeyStatus(next: KeyStatus): void {
  keyStatus = next;
  for (const listener of keyListeners) listener();
}

export const getKeyStatus = (): KeyStatus => keyStatus;

export const keyUsable = (status: KeyStatus): boolean => status.state === 'ok' || status.state === 'checking';

export function subscribeKeyStatus(listener: () => void): () => void {
  keyListeners.add(listener);
  return () => keyListeners.delete(listener);
}

export function refreshKeyStatus(): void {
  fetchJson<KeyStatus>('/api/key-status').then(setKeyStatus, (error: unknown) =>
    setKeyStatus({ state: 'invalid', message: `Could not check the OpenRouter key: ${String(error)}`, remaining: null }),
  );
}

export function listDecisionModels(): Promise<DecisionModelInfo[]> {
  catalogue ??= fetchJson<DecisionModelInfo[]>('/api/decision-models').catch((error: unknown) => {
    catalogue = null;
    throw error;
  });
  return catalogue;
}

export class ModelDriver implements Driver {
  readonly kind = 'model';
  readonly model: string;
  readonly style: DrivingStyle;
  readonly stats = { decisions: 0, errors: 0, latencyMs: 0, totalLatencyMs: 0, maxLatencyMs: 0, cost: 0, lastError: '' };
  private readonly history: DecisionAction[] = [];
  private controls = COAST;
  private inFlight = false;
  private lastAsked = -Infinity;

  constructor(model: string, style: DrivingStyle) {
    this.model = model;
    this.style = style;
  }

  decide(observation: RacerObservation): Controls {
    if (observation.finished || !keyUsable(keyStatus)) return COAST;
    if (observation.phase === 'racing' && !this.inFlight && observation.raceTime - this.lastAsked >= MIN_INTERVAL) this.ask(observation);
    return this.controls;
  }

  private ask(observation: RacerObservation): void {
    this.inFlight = true;
    this.lastAsked = observation.raceTime;
    const started = performance.now();
    const body = JSON.stringify({ model: this.model, state: describeState(observation, this.history, this.style), questions: DECISION_QUESTIONS });
    fetchJson<DecisionsResponse>('/api/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then((result) => {
        this.controls = toControls(result.answers);
        this.history.push({ ...this.controls, raceTime: observation.raceTime, speed: observation.speed });
        this.stats.decisions++;
        this.stats.cost += result.usage.cost ?? 0;
      })
      .catch((error: unknown) => {
        this.stats.errors++;
        this.stats.lastError = String(error);
        const failure = error instanceof HttpError ? KEY_FAILURES[error.status] : undefined;
        if (failure) setKeyStatus({ state: failure, message: error instanceof Error ? error.message : String(error), remaining: null });
      })
      .finally(() => {
        const latency = performance.now() - started;
        this.stats.latencyMs = latency;
        this.stats.totalLatencyMs += latency;
        this.stats.maxLatencyMs = Math.max(this.stats.maxLatencyMs, latency);
        this.inFlight = false;
      });
  }
}
