import { useCallback, useEffect, useRef, useState } from 'react';
import { FlightHud } from './components/FlightHud';
import { GameOverModal, PauseModal } from './components/StatusModal';
import { TitleOverlay } from './components/TitleOverlay';
import { MarsFlightEngine } from './game/MarsFlightEngine';
import { START_MACH } from './game/simulation';
import type { FlightTelemetry, GamePhase, HudBannerEvent, RunSummary } from './game/types';

const INITIAL_TELEMETRY: FlightTelemetry = {
  mach: START_MACH,
  speedMetersPerSec: 120,
  altitude: 18,
  distance: 0,
  score: 0,
  bestScore: 0,
  bestMach: START_MACH,
  nearMissCount: 0,
  boostCharge: 1,
  isBoosting: false,
  speedIntensity: 0,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<MarsFlightEngine | null>(null);
  const bannerTimerRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<GamePhase>('title');
  const [telemetry, setTelemetry] = useState<FlightTelemetry>(INITIAL_TELEMETRY);
  const [banner, setBanner] = useState<HudBannerEvent | null>(null);
  const [nearMissFlash, setNearMissFlash] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [muted, setMuted] = useState(false);

  // Mount Three.js WebGL engine exactly once so React HUD updates never tear down the canvas
  useEffect(() => {
    const mountEl = canvasMountRef.current;
    const fxEl = fxCanvasRef.current;
    if (!mountEl || !fxEl) return;

    const params = new URLSearchParams(window.location.search);
    const autostart = params.get('autostart') === '1';

    const engine = new MarsFlightEngine(
      mountEl,
      fxEl,
      {
        onPhaseChange: (nextPhase) => {
          setPhase(nextPhase);
          if (nextPhase !== 'playing') {
            setBanner(null);
            setNearMissFlash(false);
          }
        },
        onTelemetry: (nextTelemetry) => {
          setTelemetry(nextTelemetry);
        },
        onBanner: (ev) => {
          setBanner(ev);
          if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
          bannerTimerRef.current = window.setTimeout(() => {
            setBanner(null);
          }, 1250);
        },
        onNearMissFlash: () => {
          setNearMissFlash(true);
          if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
          flashTimerRef.current = window.setTimeout(() => {
            setNearMissFlash(false);
          }, 260);
        },
        onGameOver: (runSummary) => {
          setSummary(runSummary);
        },
        onMuteChange: (isMuted) => {
          setMuted(isMuted);
        },
      },
      autostart,
    );

    engineRef.current = engine;

    return () => {
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleStart = useCallback(() => {
    engineRef.current?.startRun();
  }, []);

  const handlePause = useCallback(() => {
    engineRef.current?.pause();
  }, []);

  const handleResume = useCallback(() => {
    engineRef.current?.resume();
  }, []);

  const handleTitle = useCallback(() => {
    engineRef.current?.returnToTitle();
  }, []);

  const handleToggleMute = useCallback(() => {
    engineRef.current?.toggleMute();
  }, []);

  const handleBoostStart = useCallback(() => {
    engineRef.current?.setBoostButtonHeld(true);
  }, []);

  const handleBoostEnd = useCallback(() => {
    engineRef.current?.setBoostButtonHeld(false);
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-gradient-to-b from-[#3d1510] via-[#9e3b1d] to-[#c95a2b]">
      {/* Dedicated isolated WebGL canvas container (never re-created on HUD updates) */}
      <div
        ref={canvasMountRef}
        data-testid="mars-webgl-canvas"
        className="fixed inset-0 z-0 h-full w-full"
      />

      {/* Lightweight 2D overlay canvas for rushing white wind streaks & high-speed radial vignette */}
      <canvas
        ref={fxCanvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-10 h-full w-full"
      />

      {phase === 'title' && (
        <TitleOverlay
          bestScore={telemetry.bestScore}
          bestMach={telemetry.bestMach}
          muted={muted}
          onStart={handleStart}
          onToggleMute={handleToggleMute}
        />
      )}

      {phase === 'playing' && (
        <FlightHud
          telemetry={telemetry}
          banner={banner}
          nearMissFlash={nearMissFlash}
          muted={muted}
          onPause={handlePause}
          onToggleMute={handleToggleMute}
          onBoostStart={handleBoostStart}
          onBoostEnd={handleBoostEnd}
        />
      )}

      {phase === 'paused' && (
        <PauseModal
          onResume={handleResume}
          onRestart={handleStart}
          onTitle={handleTitle}
        />
      )}

      {phase === 'gameover' && summary && (
        <GameOverModal
          summary={summary}
          onRestart={handleStart}
          onTitle={handleTitle}
        />
      )}
    </main>
  );
}
