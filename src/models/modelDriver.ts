/*
 * A racer driven in real time by an OpenRouter decision model, the model catalogue, and the
 * health of the OpenRouter key.
 *
 * `ModelDriver.decide` runs every simulation step like any driver. It returns the controls from
 * the model's latest answer and, when fewer than MAX_IN_FLIGHT requests are out, the key is usable,
 * and REQUEST_INTERVAL seconds of race time have passed since the last request, starts `ask`, a
 * `POST /api/decide`, so the race keeps running while the model thinks and overlapping requests
 * bring answers in more often than one round trip allows. `ask` describes the state predicted
 * `lookahead` seconds ahead (the model's average latency so far, DEFAULT_LATENCY before the first
 * answer), when its answer should land, and an answer that arrives after a newer one is counted but
 * not applied. Once the racer finishes it stops asking and coasts. Every request carries the
 * driver's `DrivingStyle`. `stats` holds decisions, errors, latency (last, total, worst), and cost
 * for the telemetry panel and the race report.
 *
 * The key status is a tiny store: `getKeyStatus` and `subscribeKeyStatus` back React's
 * `useSyncExternalStore`, `refreshKeyStatus` asks `GET /api/key-status`, and any decision that
 * fails with 401 (invalid key) or 402 (no credits) marks the key unusable, which stops every
 * model from asking. `listDecisionModels` fetches the catalogue once and reuses it.
 */
import type { DecisionsResponse } from '@openrouter/sdk/models';
import type { Controls, Driver, RacerObservation } from '../sim/types';
import { type Decision, DECISION_QUESTIONS, describeState, type DrivingStyle, predict, toControls } from './decisionState';

export type DecisionModelInfo = { id: string; name: string; promptPrice: number };
export type KeyStatus = { state: 'checking' | 'ok' | 'invalid' | 'no-credits'; message: string; remaining: number | null };

const REQUEST_INTERVAL = 0.15;
const MAX_IN_FLIGHT = 2;
const DEFAULT_LATENCY = 0.3;
const MAX_LOOKAHEAD = 1;
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
  private readonly history: Decision[] = [];
  private controls = COAST;
  private inFlight = 0;
  private lastAsked = -Infinity;
  private asked = 0;
  private applied = -1;

  constructor(model: string, style: DrivingStyle) {
    this.model = model;
    this.style = style;
  }

  decide(observation: RacerObservation): Controls {
    if (observation.finished || !keyUsable(keyStatus)) return COAST;
    if (observation.phase === 'racing' && this.inFlight < MAX_IN_FLIGHT && observation.raceTime - this.lastAsked >= REQUEST_INTERVAL) this.ask(observation);
    return this.controls;
  }

  private ask(observation: RacerObservation): void {
    const sequence = this.asked++;
    this.inFlight++;
    this.lastAsked = observation.raceTime;
    const started = performance.now();
    const answered = this.stats.decisions + this.stats.errors;
    const lookahead = answered > 0 ? Math.min(MAX_LOOKAHEAD, this.stats.totalLatencyMs / answered / 1000) : DEFAULT_LATENCY;
    const state = describeState(predict(observation, this.controls, lookahead), this.history, this.style);
    const body = JSON.stringify({ model: this.model, state, questions: DECISION_QUESTIONS });
    fetchJson<DecisionsResponse>('/api/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then((result) => {
        this.stats.decisions++;
        this.stats.cost += result.usage.cost ?? 0;
        if (sequence < this.applied) return;
        const { controls, decision } = toControls(result.answers);
        this.applied = sequence;
        this.controls = controls;
        this.history.push(decision);
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
        this.inFlight--;
      });
  }
}
