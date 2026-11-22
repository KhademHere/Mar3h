import React from 'react';
import type { FlightTelemetry, HudBannerEvent } from '../game/types';

interface FlightHudProps {
  telemetry: FlightTelemetry;
  banner: HudBannerEvent | null;
  nearMissFlash: boolean;
  muted: boolean;
  onPause: () => void;
  onToggleMute: () => void;
  onBoostStart: () => void;
  onBoostEnd: () => void;
}

export const FlightHud: React.FC<FlightHudProps> = ({
  telemetry,
  banner,
  nearMissFlash,
  muted,
  onPause,
  onToggleMute,
  onBoostStart,
  onBoostEnd,
}) => {
  const boostPercent = Math.round(telemetry.boostCharge * 100);
  const isHighMach = telemetry.mach >= 2.0;
  const isExtremeMach = telemetry.mach >= 3.0;

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-4 sm:p-6">
      {/* Subtle amber edge flash triggered on bold canyon wall Near Miss */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 transition-opacity duration-200"
        style={{
          opacity: nearMissFlash ? 1 : 0,
          boxShadow: 'inset 0 0 90px rgba(251, 191, 36, 0.55), inset 0 0 28px rgba(254, 240, 138, 0.45)',
        }}
      />

      {/* Top row: compact score cluster on left, Mute & Pause icon buttons on right */}
      <div className="flex items-start justify-between gap-4">
        <div className="rounded-sm border border-[#ffd8bc]/20 bg-[#1a0905]/72 px-4 py-2.5 shadow-[0_6px_18px_rgba(15,5,2,0.45)]">
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
          </div>
          <div className="mt-1 flex items-center gap-2.5 font-telemetry text-xs text-[#f6cdb0]/85">
            <span>ALT {telemetry.altitude}m</span>
            <span aria-hidden="true" className="text-[#fb923c]/70">·</span>
            <span>DIST {telemetry.distance.toLocaleString()}m</span>
            {telemetry.nearMissCount > 0 && (
              <>
                <span aria-hidden="true" className="text-[#fb923c]/70">·</span>
                <span className="text-[#fcd34d]">SKIMS {telemetry.nearMissCount}</span>
              </>
            )}
          </div>
        </div>

        {/* Top-right compact utility square icon buttons */}
        <div className="flex items-center gap-2">
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

      {/* Transient center-upper flight callout (Near Miss or Mach Shockwave) */}
      <div className="pointer-events-none fixed inset-x-0 top-[15%] flex justify-center px-4">
        {banner && (
          <div
            key={banner.id}
            data-testid="hud-banner"
            className="flex flex-col items-center text-center"
          >
            <span
              className={`font-display text-2xl sm:text-4xl font-bold italic tracking-[0.14em] uppercase ${
                banner.kind === 'near-miss'
                  ? 'near-miss-glow text-[#fde047]'
                  : 'shockwave-glow text-[#bae6fd]'
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

      {/* Bottom row: glowing Mach Speed Display + Afterburner gauge + Hold Boost button */}
      <div className="flex items-end justify-between gap-4">
        {/* Clean glowing Mach Flight Display */}
        <div
          className="rounded-sm border border-[#7dd3fc]/32 bg-[#160805]/82 px-4 py-3 sm:px-5 sm:py-3.5 shadow-[0_8px_24px_rgba(12,4,2,0.55)]"
          style={{ minWidth: '224px' }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-display text-[11px] font-bold tracking-[0.18em] text-[#7dd3fc] uppercase">
              Airspeed
            </span>
            <span className="font-telemetry text-[11px] font-medium text-[#f8cbb0]/85">
              {telemetry.isBoosting ? 'AFTERBURNER' : isExtremeMach ? 'HYPERSONIC' : isHighMach ? 'SUPERCRUISE' : 'SUPERSONIC'}
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

          {/* Afterburner energy bar */}
          <div className="mt-2.5">
            <div className="flex items-center justify-between font-telemetry text-[10px] tracking-[0.12em] text-[#f5ccb0]/80 uppercase">
              <span>Thrust Reserve</span>
              <span>{boostPercent}%</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-[2px] bg-[#3b180e]">
              <div
                className="h-full origin-left transition-transform duration-75"
                style={{
                  transform: `scaleX(${Math.max(0, Math.min(1, telemetry.boostCharge))})`,
                  backgroundColor: telemetry.isBoosting
                    ? '#bae6fd'
                    : telemetry.boostCharge < 0.22
                      ? '#f97316'
                      : '#38bdf8',
                }}
              />
            </div>
          </div>
        </div>

        {/* Press-and-hold Afterburner Boost control (Spacebar or Mouse/Touch hold) */}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Hold to fire afterburners"
          onPointerDown={(e) => {
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
          className={`pointer-events-auto font-display flex h-14 sm:h-16 min-w-[116px] sm:min-w-[144px] flex-col items-center justify-center rounded-sm border px-5 transition-transform duration-100 active:scale-[0.97] cursor-pointer whitespace-nowrap ${
            telemetry.isBoosting
              ? 'border-[#bae6fd] bg-[#0ea5e9] text-[#081520] shadow-[0_0_24px_rgba(56,189,248,0.6)]'
              : 'border-[#7dd3fc]/45 bg-[#160805]/84 text-[#e0f6ff] hover:border-[#bae6fd]/75 hover:bg-[#1e100d]/92'
          }`}
        >
          <span className="text-sm sm:text-base font-bold tracking-[0.16em] uppercase">
            {telemetry.isBoosting ? 'BOOSTING' : 'BOOST'}
          </span>
          <span
            className={`font-telemetry text-[10px] tracking-[0.1em] ${
              telemetry.isBoosting ? 'text-[#081520]/80' : 'text-[#9bdcf8]/80'
            }`}
          >
            HOLD SPACE
          </span>
        </button>
      </div>
    </div>
  );
};
