/*
 * Root component: wires the 3D engine, the race, the menu, and the HUD together.
 *
 * `App` owns the current session (a `Race`, and whether it is the bots-only demo that runs
 * behind the menu), the menu settings, the visible screen, which racer the camera follows, the
 * camera mode, and whether telemetry or the race report is open. `startRace` builds a race from
 * the settings and begins its countdown when `canStart` allows it; `openMenu` pauses a running
 * race behind the menu and `resume` continues it. If the OpenRouter key turns invalid or runs out
 * of credits during a decision-model race, that race is stopped and replaced by the demo race.
 * Global keys: R respawns the player, V and Shift+V cycle the followed racer, C cycles the
 * camera mode while spectating, T toggles telemetry, Escape opens or closes the menu (or the
 * report), and Enter leaves a finished race or starts one from the menu. `installRacerApi` keeps
 * `window.racerAPI` pointed at the live race.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { installRacerApi } from './api/racerApi';
import { canStart, createRace, DEFAULT_SETTINGS, DEMO_SETTINGS, PLAYER_ID, type RaceSettings } from './game/setup';
import { Keyboard } from './input/keyboard';
import { getKeyStatus, keyUsable, ModelDriver, subscribeKeyStatus } from './models/modelDriver';
import { type CameraMode, GameEngine } from './render/engine';
import type { Race } from './sim/race';
import { Hud } from './ui/Hud';
import { Menu } from './ui/Menu';
import { Minimap } from './ui/Minimap';
import { RaceReport } from './ui/RaceReport';
import { Telemetry } from './ui/Telemetry';

type Session = { race: Race; demo: boolean };

const keyboard = new Keyboard();
const CAMERA_MODES: CameraMode[] = ['chase', 'overhead', 'tv'];

function startDemo(): Session {
  const race = createRace(DEMO_SETTINGS, keyboard);
  race.start();
  return { race, demo: true };
}

export default function App() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [session, setSession] = useState(startDemo);
  const sessionRef = useRef(session);
  const [settings, setSettings] = useState<RaceSettings>(DEFAULT_SETTINGS);
  const [screen, setScreen] = useState<'menu' | 'race'>('menu');
  const [paused, setPaused] = useState(false);
  const [focusId, setFocusId] = useState('');
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [reportOpen, setReportOpen] = useState(false);
  const keyStatus = useSyncExternalStore(subscribeKeyStatus, getKeyStatus);
  const { race } = session;

  useEffect(() => keyboard.attach(window), []);
  useEffect(() => installRacerApi(() => sessionRef.current.race), []);
  useEffect(() => {
    const engine = new GameEngine(viewportRef.current!, sessionRef.current.race);
    engine.onFocusChange = setFocusId;
    engineRef.current = engine;
    return () => engine.dispose();
  }, []);
  useEffect(() => {
    sessionRef.current = session;
    engineRef.current?.setRace(session.race);
  }, [session]);
  useEffect(() => engineRef.current?.setFocus(focusId), [focusId]);
  useEffect(() => engineRef.current?.setCameraMode(cameraMode), [cameraMode]);
  useEffect(() => engineRef.current?.setTimeOfDay(settings.timeOfDay), [settings.timeOfDay]);
  useEffect(() => {
    if (engineRef.current) engineRef.current.paused = paused;
  }, [paused]);
  useEffect(
    () =>
      subscribeKeyStatus(() => {
        const { race: current, demo } = sessionRef.current;
        const usesModels = current.racers.some((racer) => racer.driver instanceof ModelDriver);
        if (keyUsable(getKeyStatus()) || demo || !usesModels || current.phase === 'finished') return;
        setSession(startDemo());
        setPaused(false);
        setFocusId('');
        setScreen('menu');
      }),
    [],
  );

  const startRace = () => {
    if (!canStart(settings, getKeyStatus())) return;
    const next = createRace(settings, keyboard);
    next.start();
    setSession({ race: next, demo: false });
    setFocusId(settings.participate ? PLAYER_ID : '');
    if (settings.participate) setCameraMode('chase');
    setPaused(false);
    setReportOpen(false);
    setScreen('race');
  };

  const openMenu = () => {
    const finished = race.phase === 'finished';
    setPaused(!session.demo && !finished);
    if (finished) setFocusId('');
    setScreen('menu');
  };

  const resume = () => {
    setPaused(false);
    setScreen('race');
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.repeat) return;
      if (screen === 'menu') {
        if (event.code === 'Escape' && reportOpen) setReportOpen(false);
        else if (event.code === 'Escape' && paused) resume();
        if (event.code === 'Enter' && event.target === document.body) startRace();
        return;
      }
      const spectating = !race.racers.some((racer) => racer.id === PLAYER_ID);
      if (event.code === 'KeyC' && spectating) setCameraMode((mode) => CAMERA_MODES[(CAMERA_MODES.indexOf(mode) + 1) % CAMERA_MODES.length]);
      if (event.code === 'Escape' || (event.code === 'Enter' && race.phase === 'finished')) {
        event.preventDefault();
        openMenu();
      }
      if (event.code === 'KeyT') setTelemetryOpen((open) => !open);
      const player = race.racers.find((racer) => racer.id === PLAYER_ID);
      if (event.code === 'KeyR' && player && race.phase === 'racing') race.respawn(player);
      if (event.code === 'KeyV') {
        const order = race.standings();
        const current = Math.max(0, order.findIndex((racer) => racer.id === focusId));
        setFocusId(order[(current + (event.shiftKey ? -1 : 1) + order.length) % order.length].id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="app">
      <div className="viewport" ref={viewportRef} />
      {screen === 'race' && (
        <>
          <Hud race={race} focusId={focusId} cameraMode={cameraMode} onMenu={openMenu} />
          {cameraMode !== 'overhead' && <Minimap race={race} focusId={focusId} />}
          {telemetryOpen && <Telemetry race={race} focusId={focusId} />}
        </>
      )}
      {screen === 'menu' && (
        <Menu
          settings={settings}
          keyStatus={keyStatus}
          onChange={setSettings}
          onStart={startRace}
          onResume={paused ? resume : null}
          onReport={() => setReportOpen(true)}
          results={!session.demo && race.phase === 'finished' ? race.standings() : null}
        />
      )}
      {screen === 'menu' && reportOpen && <RaceReport race={race} onClose={() => setReportOpen(false)} />}
    </div>
  );
}
