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
| `C` | Cycle chase, bird's eye, and TV cameras while spectating |
| `T` | Toggle the telemetry panel |
| `Esc` | Pause and open the menu |
| `Enter` | Start a race from the menu, or leave the results screen |

On a touch screen the HUD switches to a compact layout with on-screen controls: steer left and
right under the left thumb, brake and gas under the right, and Menu, Reset, Camera, and Next
buttons at the top right.

The menu between races sets the track, the lap count, racing or spectating, the CPU type, the
time of day, and your name and kart colour. The track is Meadow Ring by default, or a random
track generated from a seed, a length (1.5–2.7 km), and a complexity (1–5). Each random track
gets a two-word name and its own lap record, and the race behind the menu previews it. New track
picks a fresh seed. The generator (`src/sim/trackGenerator.ts`) builds each lap from straights
and arcs, hairpins included, and rejects layouts with corners tighter than 24 m, sections that
come too close, a curved start, or a lap that leaves the valley. The fastest lap ever driven is stored as the track record. When a
race ends, a full-screen report compares every racer: result, pace, driving, racecraft, and
decision-model metrics, with position and speed charts, lap times, and a JSON export. The menu's
"Full report" button reopens it.

Every race starts from a random grid. Bots ride the slipstream of a car they are catching, then
commit to the inside of the next corner to pass, and the car being passed gives them room. Each
of the eleven bots has a personality, such as Blitz the late braker, Echo the slipstream shadow,
or Sprocket the careful veteran, that slightly tunes its braking, the room it gives cars
alongside, how fast it changes line, and how tightly it takes apexes (`src/game/setup.ts`).
Press `T` to see a bot's personality.

## Racing OpenRouter decision models

Put `OPENROUTER_API_KEY=...` in `.env` (gitignored), then set CPU to "Decision models" in the
menu and add up to five of the models OpenRouter lists with the `decisions` output modality,
such as `typesafe/jev-1.13`. You can add the same model up to three times, and give each entry a
driving style: safe, balanced, or aggressive. The style and its meaning go into the model's
state, and the style also scales the safe speed the state suggests for the curves ahead.
Decision-model races are one lap. If OpenRouter reports the key as
invalid or out of credits, the race stops and the menu blocks decision-model races until the key
works again. Each model races in real time: the dev server forwards its state to
OpenRouter's System One API (`server/decisionApi.ts`), so the key never reaches the browser. The
model answers a steering score and a pedal choice that map onto the same controls you use
(`src/models/decisionState.ts`). Press `T` to see a model's decisions, latency, cost, and
errors. Models that only accept yes/no questions, such as the Respan family, report an error
instead of driving.

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
