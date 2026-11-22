import React from 'react';
import { DIFFICULTY_CONFIGS, DIFFICULTY_ORDER } from '../game/difficulty';
import type { AllDifficultyRecords, DifficultyId } from '../game/types';

interface TitleOverlayProps {
  difficulty: DifficultyId;
  records: AllDifficultyRecords;
  muted: boolean;
  onSelectDifficulty: (difficulty: DifficultyId) => void;
  onStart: () => void;
  onStartAutoplay: () => void;
  onToggleMute: () => void;
}

const DIFFICULTY_CARD_STYLES: Record<
  DifficultyId,
  {
    activeBorder: string;
    activeBg: string;
    activeShadow: string;
    labelColor: string;
    accentBar: string;
  }
> = {
  easy: {
    activeBorder: 'border-[#38bdf8]',
    activeBg: 'bg-[#082534]/92',
    activeShadow: 'shadow-[0_0_24px_rgba(56,189,248,0.45)]',
    labelColor: 'text-[#67e8f9]',
    accentBar: 'bg-[#38bdf8]',
  },
  medium: {
    activeBorder: 'border-[#fbbf24]',
    activeBg: 'bg-[#331a06]/92',
    activeShadow: 'shadow-[0_0_24px_rgba(251,191,36,0.45)]',
    labelColor: 'text-[#fcd34d]',
    accentBar: 'bg-[#f59e0b]',
  },
  hard: {
    activeBorder: 'border-[#fb4b5c]',
    activeBg: 'bg-[#380b10]/94',
    activeShadow: 'shadow-[0_0_26px_rgba(244,63,94,0.52)]',
    labelColor: 'text-[#fda4af]',
    accentBar: 'bg-[#f43f5e]',
  },
};

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  difficulty,
  records,
  muted,
  onSelectDifficulty,
  onStart,
  onStartAutoplay,
  onToggleMute,
}) => {
  const activeRecord = records[difficulty];

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-6 sm:p-10">
      {/* Top row: Title lockup, 3-tier glowing difficulty selector, Launch CTA, and subtle audio toggle */}
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-2xl pt-1 sm:pt-3">
          {/* Bespoke inline SVG supersonic title lockup positioned over calm upper Martian sky */}
          <svg
            viewBox="0 0 540 132"
            className="w-[290px] sm:w-[420px] md:w-[470px] h-auto drop-shadow-[0_6px_18px_rgba(22,6,3,0.75)]"
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
              <polygon points="46,28 60,64 46,54 32,64" fill="#38bdf8" />
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

          {/* 3-Tier Glowing Difficulty Selector right above Launch button */}
          <div
            role="radiogroup"
            aria-label="Flight difficulty"
            className="mt-5 grid max-w-[600px] grid-cols-3 gap-2.5 pl-2"
          >
            {DIFFICULTY_ORDER.map((id) => {
              const cfg = DIFFICULTY_CONFIGS[id];
              const style = DIFFICULTY_CARD_STYLES[id];
              const selected = difficulty === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`difficulty-${id}`}
                  onClick={() => onSelectDifficulty(id)}
                  className={`pointer-events-auto group relative flex flex-col items-start overflow-hidden rounded-sm border px-3 py-2.5 text-left transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7dd3fc] cursor-pointer ${
                    selected
                      ? `${style.activeBorder} ${style.activeBg} ${style.activeShadow} scale-[1.015]`
                      : 'border-[#ffd8bc]/22 bg-[#170805]/80 hover:border-[#ffd8bc]/50 hover:bg-[#230d08]/90'
                  }`}
                >
                  {/* Top glowing accent bar */}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-0 top-0 h-[3px] transition-opacity duration-150 ${style.accentBar} ${
                      selected ? 'opacity-100' : 'opacity-35 group-hover:opacity-70'
                    }`}
                  />
                  <div className="flex w-full items-center justify-between gap-1.5">
                    <span
                      className={`font-display text-sm sm:text-base font-bold tracking-[0.14em] uppercase ${
                        selected ? style.labelColor : 'text-[#fff1e6]/90'
                      }`}
                    >
                      {cfg.label}
                    </span>
                    <span className="font-telemetry text-[10px] font-semibold text-[#f5cbb0]/75">
                      {cfg.scoreRateMultiplier % 1 === 0
                        ? `${cfg.scoreRateMultiplier}.0x`
                        : `${cfg.scoreRateMultiplier}x`}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] sm:text-xs leading-snug text-[#f7d8c2]/88">
                    {cfg.preview}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Primary Start CTA + One-Click Autoplay launch + selected tier personal record */}
          <div className="mt-4 flex flex-wrap items-center gap-3.5 pl-2">
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

            <button
              type="button"
              onClick={onStartAutoplay}
              className="pointer-events-auto font-display inline-flex items-center gap-2.5 rounded-sm border border-[#7dd3fc]/45 bg-[#160805]/82 px-5 py-3.5 text-sm sm:text-base font-bold tracking-[0.14em] text-[#d8f5ff] uppercase shadow-[0_10px_24px_rgba(22,6,3,0.45)] transition-colors duration-150 hover:border-[#bae6fd]/80 hover:bg-[#1f110d]/92 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7dd3fc] cursor-pointer whitespace-nowrap"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4 text-[#7dd3fc]" fill="none" aria-hidden="true">
                <path
                  d="M10 2.5 16.5 16l-6.5-3.2L3.5 16 10 2.5Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Autoplay</span>
            </button>

            {(activeRecord.bestDistance > 0 || activeRecord.bestScore > 0) && (
              <div className="hud-text-shadow font-telemetry flex items-center gap-2.5 pl-1 text-xs sm:text-sm font-medium text-[#ffead8]">
                <span className={DIFFICULTY_CARD_STYLES[difficulty].labelColor}>
                  {DIFFICULTY_CONFIGS[difficulty].label} BEST
                </span>
                <span aria-hidden="true" className="text-[#fb923c]">·</span>
                <span>Mach {activeRecord.bestMach.toFixed(1)}</span>
                {activeRecord.bestDistance > 0 && (
                  <>
                    <span aria-hidden="true" className="text-[#fb923c]">·</span>
                    <span>{activeRecord.bestDistance.toLocaleString()}m</span>
                  </>
                )}
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
          Arrows / WASD / Mouse Steer · Hold Space Afterburner · C Camera · P Pause
        </p>
      </div>
    </div>
  );
};
