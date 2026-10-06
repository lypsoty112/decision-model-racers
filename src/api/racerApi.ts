/*
 * `window.racerAPI`: the browser entry point for decision models.
 *
 * `installRacerApi` publishes functions that always act on the race returned by `getRace`, so
 * the API keeps working when a new race starts. `racers` lists ids, names, and driver kinds;
 * `observe` and `observeAll` return `RacerObservation`s; `setController` replaces a racer's
 * driver with any `(observation, dt) => Controls` function, and passing null restores the driver
 * it replaced. Controllers belong to one race, so set them again after starting a new one. The
 * returned function removes the API.
 */
import type { Race, Racer } from '../sim/race';
import type { Controls, Driver, RacePhase, RacerObservation } from '../sim/types';

type Controller = (observation: RacerObservation, dt: number) => Controls;

export type RacerApi = {
  phase(): RacePhase;
  racers(): { id: string; name: string; driver: string }[];
  observe(id: string): RacerObservation;
  observeAll(): RacerObservation[];
  setController(id: string, controller: Controller | null): void;
};

declare global {
  interface Window {
    racerAPI?: RacerApi;
  }
}

export function installRacerApi(getRace: () => Race): () => void {
  const replaced = new WeakMap<Racer, Driver>();
  const find = (id: string) => {
    const racer = getRace().racers.find((candidate) => candidate.id === id);
    if (!racer) throw new Error(`Unknown racer "${id}". Call racerAPI.racers() for valid ids.`);
    return racer;
  };
  window.racerAPI = {
    phase: () => getRace().phase,
    racers: () => getRace().racers.map((racer) => ({ id: racer.id, name: racer.name, driver: racer.driver.kind })),
    observe: (id) => getRace().observe(find(id)),
    observeAll: () => getRace().racers.map((racer) => getRace().observe(racer)),
    setController: (id, controller) => {
      const racer = find(id);
      const original = replaced.get(racer) ?? racer.driver;
      if (controller === null) {
        racer.driver = original;
        replaced.delete(racer);
        return;
      }
      replaced.set(racer, original);
      racer.driver = { kind: 'external', decide: controller };
    },
  };
  return () => {
    delete window.racerAPI;
  };
}
