# Decision Model Racers

A cel-shaded 3D kart racer built with Bun, React, Vite, and three.js. It doubles as a testbed for
comparing decision models: every racer, human or bot, drives through the same observation and
controls contract.

## Running

```sh
bun install
bun run dev        # http://localhost:3991
bun run sim        # headless bots-only races, prints results, fails on DNFs
bun run typecheck
bun run lint
```

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Throttle |
| `S` / `↓` / `Space` | Brake, then reverse |
| `A` `D` / `←` `→` | Steer |
| `R` | Reset onto the track |
| `V` / `Shift+V` | Follow the next or previous racer |
| `T` | Toggle the telemetry panel |
| `Esc` | Pause and open the menu |
| `Enter` | Start a race from the menu, or leave the results screen |

The menu between races sets the lap count, the bot count, racing or spectating, bot skill, the
time of day, and your name and kart colour. The fastest lap ever driven is stored as the track
record.

## Decision-model interface

Each simulation step (120 Hz), every racer's driver receives a `RacerObservation` and returns
`Controls` (`throttle` and `brake` in 0..1, `steer` in -1..1, negative is left). The observation
holds race position, lap and progress, speed, heading error, lateral offset, off-track and
wrong-way flags, slipstream, timing, curvature every 10 m for 200 m, centreline points ahead in
car-local coordinates, the next corners (distance, direction, radius, angle), and every opponent
(race gap, car-local position, speed). `src/sim/types.ts` documents units and sign conventions.

In the browser, `window.racerAPI` exposes the live race:

```js
racerAPI.racers();                     // [{ id, name, driver }]
racerAPI.observe('player');            // RacerObservation
racerAPI.observeAll();
racerAPI.setController('bot-3', (obs, dt) => ({ throttle: 1, brake: 0, steer: 0 }));
racerAPI.setController('bot-3', null); // restore the original driver
```

Controllers belong to one race, so set them again after starting a new race. The simulation in
`src/sim` has no DOM dependency, so `src/game/headless.ts` shows how to run and score races
offline in Bun.

## Layout

- `src/sim`: track geometry, car physics, race rules, observations, and the bot driver.
- `src/game`: menu settings to `Race` setup, and the headless runner.
- `src/render`: three.js world, karts, chase camera, outlines, and speed effects.
- `src/ui`: React HUD, minimap, telemetry panel, and menu.
- `src/api`: `window.racerAPI`.
