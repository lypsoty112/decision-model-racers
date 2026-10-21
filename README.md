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

Set the mode to Tournament to race the same grid over 3–8 rounds: the first on the selected
track, the rest on fresh random tracks of the same length and complexity. Every round awards F1
points (25, 18, 15, 12, 10, 8, 6, 4, 2, 1 for the top ten, nothing for a DNF), and the
scorecard beside the menu ranks racers by points, then wins, then best finish. The tournament is
saved in the browser, so a reload picks up at the next round; Abandon ends it early.

Turn Damage on to give every kart 100 HP and to turn on crashes. Hitting a wall faster than 4 m/s,
or another kart at a closing speed above 3 m/s (at most 12 HP per contact), costs health, and a
damaged kart loses up to a fifth of its top speed and some grip; health never wrecks it. The kart
shows it: the paint scorches, the spoiler bends below 70 HP, the spoiler and front wing fly off
below 45 HP and it trails smoke, and below 20 HP it burns. A kart crashes when it is hit hard by
another kart, hits a wall faster than 12 m/s, or corners on the grass faster than 43 m/s. A crashed
kart becomes a tumbling rigid body: it rolls, flips, and flies according to where it was hit,
grass grips it hard enough to roll it, it bounces off the road and the hedges (or clears them),
and it can crash into other karts and take them down too. Once it has rested for a second, or
after 6 s, it respawns on the racing line with the health it had. Over 96 bot races of 8 karts
there are about 1.8 crashes per race, and the median kart loses about 20 HP. The HUD shows the
followed kart's health, the standings mark crashed karts, and the report adds damage taken and
crashes. Decision models see `health` for themselves and every opponent.

Every race starts from a random grid. Bots ride the slipstream of a car they are catching, then
commit to the inside of the next corner to pass, braking later while they attack, and the car
being passed gives them room. A bot stuck behind the same car for too long attacks anyway, and a
bot with a car closing in behind may move over once to cover the inside. Each bot rolls a form
for the race, its pace ebbs and flows over a slow cycle, and now and then it misjudges a corner
and runs wide. Each of the eleven bots has a personality, such as Blitz the late braker, Turbo
the hothead, or Sprocket the careful veteran, that sets its braking, the room it gives cars
alongside, how fast it changes line, how tightly it takes apexes, and how consistent, aggressive,
defensive, and composed it is (`src/game/setup.ts`). Press `T` to see a bot's personality.
`bun run sim` prints overtakes, lead changes, and the finish spread for every race.

## Racing OpenRouter decision models

Put `OPENROUTER_API_KEY=...` in `.env` (gitignored), then set CPU to "Decision models" in the
menu and add up to five of the models OpenRouter lists with the `decisions` output modality,
such as `typesafe/jev-1.13`. You can add the same model up to three times, and give each entry a
driving style: safe, balanced, or aggressive. The style and its meaning go into the model's
state, and the style also scales the safe speed the state compares your speed against.
Decision-model races are one lap. If OpenRouter reports the key as
invalid or out of credits, the race stops and the menu blocks decision-model races until the key
works again. Each model races in real time: the dev server forwards its state to
OpenRouter's System One API (`server/decisionApi.ts`), so the key never reaches the browser.

An answer takes about 300 ms, so every model sends a new request every 150 ms with up to two in
flight, and an answer that arrives after a newer one is dropped. Each state describes where the
kart will be when the answer lands, predicted from its current controls over the model's average
latency, as short sentences of named categories rather than raw numbers: where the road goes
relative to the kart's nose in half a second and one second, position and facing on the road,
speed against the safe speed for the bends ahead, the current or next corner, race position, the
kart's health, nearby cars with their health, the driving style, and the last two decisions. The
model answers a steering choice (seven levels from hard left to hard right) and a pedal choice
that map onto the same controls you use (`src/models/decisionState.ts`). In headless tests this
took solo Meadow Ring laps from about 67 s to 46–49 s (bots lap it in about 40 s). Press `T` to
see a model's decisions, latency, cost, and errors. Models that only accept chat messages, such as
the Respan span-01 family, report an error instead of driving.

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
