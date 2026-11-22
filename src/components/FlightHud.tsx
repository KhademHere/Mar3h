import React from 'react';
import { DIFFICULTY_CONFIGS } from '../game/difficulty';
import type { CameraViewMode, DifficultyId, FlightTelemetry, HudBannerEvent } from '../game/types';

interface FlightHudProps {
  telemetry: FlightTelemetry;
  banner: HudBannerEvent | null;
  nearMissFlash: boolean;
  scrapeFlash: boolean;
  gateFlash: boolean;
  autoplayActive: boolean;
  cameraView: CameraViewMode;
  muted: boolean;
  onPause: () => void;
  onToggleMute: () => void;
  onToggleAutoplay: () => void;
  onCycleCamera: () => void;
  onBoostStart: () => void;
  onBoostEnd: () => void;
}

const CAMERA_BUTTON_SHORT: Record<CameraViewMode, string> = {
  chase: 'Chase',
  cockpit: 'Cockpit',
  wing: 'Wing',
  cinematic: 'Flyby',
};

const DIFFICULTY_BADGE_STYLES: Record<DifficultyId, string> = {
  easy: 'border-[#38bdf8]/60 bg-[#0b3145]/85 text-[#7dd3fc]',
  medium: 'border-[#fbbf24]/65 bg-[#3b2007]/88 text-[#fcd34d]',
  hard: 'border-[#fb4b5c]/75 bg-[#440c14]/90 text-[#fda4af] shadow-[0_0_10px_rgba(244,63,94,0.45)]',
};

export const FlightHud: React.FC<FlightHudProps> = ({
  telemetry,
  banner,
  nearMissFlash,
  scrapeFlash,
  gateFlash,
  autoplayActive,
  cameraView,
  muted,
  onPause,
  onToggleMute,
  onToggleAutoplay,
  onCycleCamera,
  onBoostStart,
  onBoostEnd,
}) => {
  const boostPercent = Math.round(telemetry.boostCharge * 100);
  const isHighMach = telemetry.mach >= 2.0;
  const isExtremeMach = telemetry.mach >= 3.0;
  const isCockpit = cameraView === 'cockpit';
  const rollDeg = (-telemetry.roll * 180) / Math.PI;
  const pitchOffsetPx = Math.max(-44, Math.min(44, telemetry.pitch * 90));

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-4 sm:p-6">
      {/* Subtle amber edge flash triggered on bold canyon wall Near Miss */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 transition-opacity duration-200"
        style={{
          opacity: nearMissFlash ? 1 : 0,
          boxShadow:
            'inset 0 0 90px rgba(251, 191, 36, 0.55), inset 0 0 28px rgba(254, 240, 138, 0.45)',
        }}
      />

      {/* Luminous cyan-gold burst edge flash when blasting cleanly through a Speed Gate */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 transition-opacity duration-200"
        style={{
          opacity: gateFlash ? 1 : 0,
          boxShadow:
            'inset 0 0 115px rgba(56, 224, 255, 0.58), inset 0 0 42px rgba(253, 224, 71, 0.48)',
        }}
      />

      {/* Forgiving orange-red spark edge warning flash on slight ramp/rock graze */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 transition-opacity duration-200"
        style={{
          opacity: scrapeFlash ? 1 : 0,
          boxShadow:
            'inset 0 0 110px rgba(249, 115, 22, 0.65), inset 0 0 36px rgba(239, 68, 68, 0.52)',
        }}
      />

      {/* First-Person Cockpit Glass Canopy Frame & Subtle Holographic Horizon Reticle */}
      {isCockpit && (
        <div
          aria-hidden="true"
          data-testid="cockpit-overlay"
          className="pointer-events-none fixed inset-0 z-10 overflow-hidden"
        >
          {/* Sleek dark metallic canopy corner struts — keeps >= 90% viewport crystal clear */}
          <svg
            viewBox="0 0 1440 900"
            preserveAspectRatio="none"
            className="h-full w-full"
          >
            {/* Upper left & right canopy structural beams */}
            <path
              d="M0 0 L260 0 L120 118 L0 260 Z"
              fill="#110907"
              fillOpacity="0.72"
            />
            <path
              d="M1440 0 L1180 0 L1320 118 L1440 260 Z"
              fill="#110907"
              fillOpacity="0.72"
            />
            <path
              d="M0 0 L1440 0 L1440 16 L1180 16 L1315 124 L1328 118 L1195 0 L245 0 L112 118 L125 124 L260 16 L0 16 Z"
              fill="#38251f"
              fillOpacity="0.55"
            />
            {/* Subtle lower cockpit coaming arch */}
            <path
              d="M0 900 L0 740 L180 865 L1260 865 L1440 740 L1440 900 Z"
              fill="#110907"
              fillOpacity="0.68"
            />
            <path
              d="M0 740 L180 865 L1260 865 L1440 740"
              fill="none"
              stroke="#7dd3fc"
              strokeOpacity="0.22"
              strokeWidth="2"
            />
          </svg>

          {/* Subtle glowing artificial horizon line & center aim point */}
          <div className="fixed inset-0 flex items-center justify-center">
            <div
              className="relative flex items-center justify-center"
              style={{
                transform: `translateY(${pitchOffsetPx.toFixed(1)}px) rotate(${rollDeg.toFixed(1)}deg)`,
              }}
            >
              <div className="h-[1.5px] w-24 bg-[#7dd3fc]/40" />
              <div className="mx-7 h-[1.5px] w-24 bg-[#7dd3fc]/40" />
            </div>
            {/* Stationary crisp center nose-aim chevron */}
            <svg
              viewBox="0 0 40 40"
              className="absolute h-8 w-8 text-[#bae6fd]/70"
              fill="none"
            >
              <circle cx="20" cy="20" r="2.2" fill="currentColor" />
              <path
                d="M9 20h5M26 20h5M20 9v4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      )}

      {/* Top row: compact score + Gate Streak Multiplier cluster on left, Camera + Autoplay + Mute + Pause on right */}
      <div className="relative z-20 flex items-start justify-between gap-3">
        <div className="rounded-sm border border-[#ffd8bc]/20 bg-[#1a0905]/76 px-4 py-2.5 shadow-[0_6px_18px_rgba(15,5,2,0.45)]">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[11px] font-semibold tracking-[0.16em] text-[#f9b184] uppercase">
              Score
            </span>
            <span
              data-testid="hud-score"
              className="font-telemetry text-2xl sm:text-3xl font-bold leading-none text-[#fff7f0]"
            >
              {telemetry.score.toLocaleString()}
            </span>
            {/* Stacking Speed Gate Streak Multiplier (x2, x3, x4...) */}
            <span
              data-testid="hud-multiplier"
              className={`font-display rounded-[2px] px-1.5 py-0.5 text-xs sm:text-sm font-bold tracking-[0.08em] ${
                telemetry.gateMultiplier > 1
                  ? 'border border-[#67e8f9]/65 bg-[#0e3647]/85 text-[#fde047] shadow-[0_0_12px_rgba(56,224,255,0.45)]'
                  : 'border border-[#ffd8bc]/18 bg-[#2c120a]/70 text-[#f5cbb0]/70'
              }`}
            >
              x{telemetry.gateMultiplier}
            </span>
          </div>

          <div className="mt-1 flex items-center gap-2.5 font-telemetry text-xs text-[#f6cdb0]/85">
            <span>ALT {telemetry.altitude}m</span>
            <span aria-hidden="true" className="text-[#fb923c]/70">·</span>
            <span>DIST {telemetry.distance.toLocaleString()}m</span>
            {telemetry.gatesPassed > 0 && (
              <>
                <span aria-hidden="true" className="text-[#fb923c]/70">·</span>
                <span className="text-[#67e8f9]">GATES {telemetry.gatesPassed}</span>
              </>
            )}
            {telemetry.nearMissCount > 0 && (
              <>
                <span aria-hidden="true" className="text-[#fb923c]/70">·</span>
                <span className="text-[#fcd34d]">SKIMS {telemetry.nearMissCount}</span>
              </>
            )}
          </div>

          <div
            data-testid="hud-zone"
            className="mt-1 font-display text-[11px] font-semibold tracking-[0.14em] text-[#ffd4b4]/90 uppercase"
          >
            {telemetry.zoneName}
          </div>
        </div>

        {/* Top-right controls: Camera Switcher + One-Click Autoplay toggle + Mute + Pause */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            tabIndex={-1}
            data-testid="camera-toggle"
            title="Cycle Camera View (C)"
            onClick={(e) => {
              e.currentTarget.blur();
              onCycleCamera();
            }}
            className="pointer-events-auto font-display inline-flex h-11 items-center gap-2 rounded-sm border border-[#ffd8bc]/35 bg-[#1a0905]/82 px-3 sm:px-3.5 text-xs sm:text-sm font-bold tracking-[0.12em] text-[#fff1e6] uppercase transition-colors duration-150 hover:border-[#bae6fd]/75 hover:bg-[#2a120c]/92 focus-visible:outline-2 focus-visible:outline-[#7dd3fc] cursor-pointer whitespace-nowrap"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-[#fb923c]" fill="none" aria-hidden="true">
              <rect x="2.5" y="5.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
              <path d="m13.5 8.5 4-2.2v7.4l-4-2.2" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
            <span>Camera</span>
            <span className="hidden sm:inline font-telemetry text-[10px] font-medium text-[#f6cdb0]/80">
              {CAMERA_BUTTON_SHORT[cameraView]}
            </span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            aria-pressed={autoplayActive}
            data-testid="autoplay-toggle"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleAutoplay();
            }}
            className={`pointer-events-auto font-display inline-flex h-11 items-center gap-2 rounded-sm border px-3.5 sm:px-4 text-xs sm:text-sm font-bold tracking-[0.14em] uppercase transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[#7dd3fc] cursor-pointer whitespace-nowrap ${
              autoplayActive
                ? 'border-[#bae6fd] bg-[#0ea5e9] text-[#071520] shadow-[0_0_20px_rgba(56,189,248,0.48)]'
                : 'border-[#7dd3fc]/40 bg-[#1a0905]/80 text-[#dcf5ff] hover:border-[#bae6fd]/70 hover:bg-[#2a120c]/90'
            }`}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" aria-hidden="true">
              <path
                d="M10 2.5 16.5 16l-6.5-3.2L3.5 16 10 2.5Z"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinejoin="round"
              />
            </svg>
            <span>Autoplay</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            title="Mute (M)"
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-sm border border-[#ffd8bc]/22 bg-[#1a0905]/78 text-[#fff1e6] transition-colors duration-150 hover:border-[#ffd8bc]/50 hover:bg-[#2c1009]/90 focus-visible:outline-2 focus-visible:outline-[#7dd3fc] cursor-pointer"
          >
            {muted ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                <path
                  d="M11 5 6 9H3v6h3l5 4V5Z"
                  fill="currentColor"
                  fillOpacity="0.2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <path d="m16 9 5 6m0-6-5 6" stroke="#f87171" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                <path
                  d="M11 5 6 9H3v6h3l5 4V5Z"
                  fill="currentColor"
                  fillOpacity="0.2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <path
                  d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
                  stroke="#7dd3fc"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            aria-label="Pause flight"
            title="Pause (P)"
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-sm border border-[#ffd8bc]/22 bg-[#1a0905]/78 text-[#fff1e6] transition-colors duration-150 hover:border-[#ffd8bc]/50 hover:bg-[#2c1009]/90 focus-visible:outline-2 focus-visible:outline-[#7dd3fc] cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      {/* Transient center-upper flight callout (Speed Gate, Camera View, Near Miss, Shockwave, Zone, Graze) */}
      <div className="pointer-events-none fixed inset-x-0 top-[15%] z-20 flex justify-center px-4">
        {banner && (
          <div
            key={banner.id}
            data-testid="hud-banner"
            className="flex flex-col items-center text-center"
          >
            <span
              className={`font-display font-bold italic tracking-[0.14em] uppercase ${
                banner.kind === 'camera'
                  ? 'shockwave-glow text-xl sm:text-2xl text-[#e0f7ff]'
                  : banner.kind === 'gate'
                    ? 'gate-glow text-2xl sm:text-4xl text-[#67f2ff]'
                    : banner.kind === 'near-miss'
                      ? 'near-miss-glow text-2xl sm:text-4xl text-[#fde047]'
                      : banner.kind === 'scrape'
                        ? 'near-miss-glow text-2xl sm:text-4xl text-[#fb923c]'
                        : banner.kind === 'zone'
                          ? 'near-miss-glow text-2xl sm:text-4xl text-[#fff3e2]'
                          : 'shockwave-glow text-2xl sm:text-4xl text-[#bae6fd]'
              }`}
            >
              {banner.label}
            </span>
            <span className="hud-text-shadow font-telemetry mt-0.5 text-xs sm:text-sm font-bold tracking-[0.12em] text-[#fff6ee]">
              {banner.sublabel}
            </span>
          </div>
        )}
      </div>

      {/* Bottom row: glowing Mach Speed Display + Afterburner Boost Bar + Hold Boost button */}
      <div className="relative z-20 flex items-end justify-between gap-4">
        {/* Clean glowing Mach Flight Display & Afterburner Boost Bar */}
        <div
          className={`rounded-sm border bg-[#160805]/84 px-4 py-3 sm:px-5 sm:py-3.5 shadow-[0_8px_24px_rgba(12,4,2,0.55)] ${
            telemetry.boostOverheated
              ? 'border-[#f97316]/65'
              : telemetry.isBoosting
                ? 'border-[#fb4b5c]/80 shadow-[0_0_24px_rgba(255,44,72,0.35)]'
                : 'border-[#7dd3fc]/32'
          }`}
          style={{ minWidth: '256px' }}
        >
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <span
                data-testid="hud-difficulty"
                className={`font-display rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold tracking-[0.14em] uppercase ${DIFFICULTY_BADGE_STYLES[telemetry.difficulty]}`}
              >
                {DIFFICULTY_CONFIGS[telemetry.difficulty].label}
              </span>
              {autoplayActive ? (
                <span
                  data-testid="autoplay-indicator"
                  className="mach-glow font-display text-[11px] font-bold tracking-[0.16em] text-[#7dd3fc] uppercase"
                >
                  AUTOPLAY ON
                </span>
              ) : (
                <span className="font-display text-[11px] font-bold tracking-[0.16em] text-[#7dd3fc] uppercase">
                  Airspeed
                </span>
              )}
            </div>
            <span
              className={`font-telemetry text-[11px] font-semibold ${
                telemetry.boostOverheated
                  ? 'text-[#fb923c]'
                  : telemetry.isBoosting
                    ? 'text-[#ff7584]'
                    : 'text-[#f8cbb0]/85'
              }`}
            >
              {telemetry.boostOverheated
                ? 'COOLING DOWN'
                : telemetry.isBoosting
                  ? 'AFTERBURNER'
                  : isExtremeMach
                    ? 'HYPERSONIC'
                    : isHighMach
                      ? 'SUPERCRUISE'
                      : 'SUPERSONIC'}
            </span>
          </div>

          <div
            data-testid="hud-mach"
            className="mach-glow font-display mt-1 flex items-baseline gap-2.5 leading-none"
          >
            <span className="text-xl sm:text-2xl font-bold tracking-[0.12em] text-[#9adcf8]">
              MACH
            </span>
            <span className="font-telemetry text-4xl sm:text-5xl font-bold tracking-tight text-[#f0fbff]">
              {telemetry.mach.toFixed(1)}
            </span>
          </div>

          {/* Sleek Glowing Afterburner Boost Bar with 25% overheat recovery marker */}
          <div className="mt-2.5" data-testid="hud-boost-bar">
            <div className="flex items-center justify-between font-telemetry text-[10px] tracking-[0.12em] uppercase">
              <span
                className={
                  telemetry.boostOverheated
                    ? 'font-bold text-[#fb923c]'
                    : telemetry.isBoosting
                      ? 'font-bold text-[#ff8a96]'
                      : 'text-[#f5ccb0]/82'
                }
              >
                {telemetry.boostOverheated ? 'Afterburner Overheat' : 'Afterburner Boost'}
              </span>
              <span
                data-testid="hud-boost-pct"
                className={telemetry.boostOverheated ? 'font-bold text-[#fdba74]' : 'text-[#e0f6ff]'}
              >
                {boostPercent}%
              </span>
            </div>
            <div className="relative mt-1 h-2.5 w-full overflow-hidden rounded-[2px] border border-[#ffd8bc]/14 bg-[#31130b]">
              <div
                className={`h-full origin-left transition-transform duration-75 ${
                  telemetry.boostOverheated ? 'boost-overheat-pulse' : ''
                }`}
                style={{
                  transform: `scaleX(${Math.max(0, Math.min(1, telemetry.boostCharge))})`,
                  background: telemetry.boostOverheated
                    ? 'linear-gradient(90deg, #ea580c, #fb923c)'
                    : telemetry.isBoosting
                      ? 'linear-gradient(90deg, #0ea5ff, #38e8ff 46%, #ff2238)'
                      : 'linear-gradient(90deg, #0ea5e9, #67e8f9)',
                  boxShadow: telemetry.isBoosting
                    ? '0 0 14px rgba(255, 42, 68, 0.85)'
                    : telemetry.boostOverheated
                      ? '0 0 10px rgba(249, 115, 22, 0.75)'
                      : 'none',
                }}
              />
              {/* 25% minimum recovery marker visible while cooling down from overheat */}
              {telemetry.boostOverheated && (
                <div
                  aria-hidden="true"
                  className="absolute top-0 bottom-0 left-[25%] w-[2px] bg-[#fff7ed]/85"
                />
              )}
            </div>
          </div>
        </div>

        {/* Press-and-hold Afterburner Boost control (Spacebar or Mouse/Touch hold) */}
        <button
          type="button"
          tabIndex={-1}
          disabled={telemetry.boostOverheated}
          aria-label="Hold to fire afterburners"
          onPointerDown={(e) => {
            if (telemetry.boostOverheated) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            onBoostStart();
          }}
          onPointerUp={(e) => {
            e.currentTarget.blur();
            onBoostEnd();
          }}
          onPointerCancel={onBoostEnd}
          onLostPointerCapture={onBoostEnd}
          className={`pointer-events-auto font-display flex h-14 sm:h-16 min-w-[118px] sm:min-w-[148px] flex-col items-center justify-center rounded-sm border px-5 transition-transform duration-100 active:scale-[0.97] whitespace-nowrap ${
            telemetry.boostOverheated
              ? 'border-[#f97316]/60 bg-[#2d1007]/88 text-[#fdba74] cursor-not-allowed'
              : telemetry.isBoosting
                ? 'border-[#ff6b7a] bg-gradient-to-r from-[#0ea5e9] via-[#22d3ee] to-[#e11d48] text-[#fff8f8] shadow-[0_0_26px_rgba(255,44,72,0.62)] cursor-pointer'
                : 'border-[#7dd3fc]/45 bg-[#160805]/84 text-[#e0f6ff] hover:border-[#bae6fd]/75 hover:bg-[#1e100d]/92 cursor-pointer'
          }`}
        >
          <span className="text-sm sm:text-base font-bold tracking-[0.16em] uppercase">
            {telemetry.boostOverheated
              ? 'COOLING'
              : telemetry.isBoosting
                ? 'BOOSTING'
                : 'BOOST'}
          </span>
          <span
            className={`font-telemetry text-[10px] tracking-[0.1em] ${
              telemetry.boostOverheated
                ? 'text-[#fb923c]/90'
                : telemetry.isBoosting
                  ? 'text-[#081520]/80'
                  : 'text-[#9bdcf8]/80'
            }`}
          >
            {telemetry.boostOverheated ? 'WAIT 25%' : 'HOLD SPACE'}
          </span>
        </button>
      </div>
    </div>
  );
};
