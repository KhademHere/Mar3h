import React from 'react';

interface TitleOverlayProps {
  bestScore: number;
  bestMach: number;
  muted: boolean;
  onStart: () => void;
  onToggleMute: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  bestScore,
  bestMach,
  muted,
  onStart,
  onToggleMute,
}) => {
  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-6 sm:p-10">
      {/* Top row: subtle audio toggle in top-right */}
      <div className="flex items-start justify-between">
        <div className="max-w-xl pt-2 sm:pt-4">
          {/* Bespoke inline SVG supersonic title lockup positioned over calm upper Martian sky */}
          <svg
            viewBox="0 0 540 132"
            className="w-[300px] sm:w-[440px] md:w-[500px] h-auto drop-shadow-[0_6px_18px_rgba(22,6,3,0.75)]"
            role="img"
            aria-label="Ares Mach"
          >
            {/* Supersonic Mach-cone chevron emblem */}
            <g transform="translate(8, 16)">
              <polygon
                points="46,4 88,92 64,92 46,50 28,92 4,92"
                fill="#fff6ee"
                stroke="#260c06"
                strokeWidth="3"
                strokeLinejoin="miter"
              />
              <polygon
                points="46,28 60,64 46,54 32,64"
                fill="#38bdf8"
              />
              <line
                x1="46"
                y1="62"
                x2="46"
                y2="98"
                stroke="#7dd3fc"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M14,76 Q46,62 78,76"
                fill="none"
                stroke="#f97316"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>

            {/* Primary title lettering */}
            <text
              x="114"
              y="72"
              fill="#fff7f0"
              stroke="#240b05"
              strokeWidth="6"
              paintOrder="stroke fill"
              fontFamily="'Chakra Petch', sans-serif"
              fontWeight="700"
              fontSize="64"
              letterSpacing="5"
            >
              ARES MACH
            </text>

            {/* Clean speed-rule underline & subtitle inside lockup */}
            <rect x="116" y="84" width="156" height="3.5" fill="#38bdf8" />
            <rect x="278" y="84" width="64" height="3.5" fill="#fb923c" />
            <text
              x="116"
              y="112"
              fill="#fde6d2"
              stroke="#240b05"
              strokeWidth="3.5"
              paintOrder="stroke fill"
              fontFamily="'Plus Jakarta Sans', sans-serif"
              fontWeight="600"
              fontSize="16"
              letterSpacing="3.4"
            >
              SUPERSONIC MARTIAN CANYON FLIGHT
            </text>
          </svg>

          {/* Primary Start CTA + optional quiet personal record */}
          <div className="mt-6 flex flex-wrap items-center gap-5 pl-2">
            <button
              type="button"
              data-start="true"
              onClick={onStart}
              className="pointer-events-auto font-display inline-flex items-center gap-3 rounded-sm border border-[#ffd7b5]/50 bg-[#e85622] px-8 py-3.5 text-lg font-bold tracking-[0.14em] text-[#fff8f3] uppercase shadow-[0_10px_28px_rgba(22,6,3,0.6)] transition-transform duration-150 hover:scale-[1.02] hover:bg-[#f26430] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7dd3fc] cursor-pointer whitespace-nowrap"
            >
              <span>Launch Flight</span>
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
                <path
                  d="M4 10h11m0 0-4.5-4.5M15 10l-4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {bestScore > 0 && (
              <div className="hud-text-shadow font-telemetry flex items-center gap-2.5 text-sm font-medium text-[#ffead8]">
                <span>Best Mach {bestMach.toFixed(1)}</span>
                <span aria-hidden="true" className="text-[#fb923c]">·</span>
                <span>{bestScore.toLocaleString()} pts</span>
              </div>
            )}
          </div>
        </div>

        {/* Top-right Mute toggle */}
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleMute();
          }}
          aria-label={muted ? 'Unmute audio' : 'Mute audio'}
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-sm border border-[#ffd8bc]/25 bg-[#1d0a06]/80 text-[#fff1e6] transition-colors duration-150 hover:border-[#ffd8bc]/55 hover:bg-[#2d110a]/90 focus-visible:outline-2 focus-visible:outline-[#7dd3fc] cursor-pointer"
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
              <path
                d="m16 9 5 6m0-6-5 6"
                stroke="#f87171"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
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
      </div>

      {/* Bottom safe margin: single flat borderless control hint line */}
      <div className="flex justify-center pb-1">
        <p className="hud-text-shadow text-center text-xs sm:text-sm font-medium tracking-[0.06em] text-[#ffead8]/90">
          Arrows / WASD / Mouse Steer · Hold Space Afterburner · P Pause
        </p>
      </div>
    </div>
  );
};
