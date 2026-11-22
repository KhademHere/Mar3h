import React from 'react';
import { DIFFICULTY_CONFIGS, DIFFICULTY_ORDER } from '../game/difficulty';
import type { DifficultyId, RunSummary } from '../game/types';

interface PauseModalProps {
  onResume: () => void;
  onRestart: () => void;
  onTitle: () => void;
}

const SUMMARY_DIFFICULTY_STYLES: Record<DifficultyId, string> = {
  easy: 'border-[#38bdf8]/65 bg-[#0a2f42]/90 text-[#7dd3fc]',
  medium: 'border-[#fbbf24]/65 bg-[#3b1f06]/90 text-[#fcd34d]',
  hard: 'border-[#fb4b5c]/75 bg-[#450c14]/92 text-[#fda4af]',
};

export const PauseModal: React.FC<PauseModalProps> = ({ onResume, onRestart, onTitle }) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-title"
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#120502]/65 p-4"
    >
      <div className="w-full max-w-sm rounded-sm border border-[#ffd5b6]/28 bg-[#190905]/95 p-7 shadow-[0_24px_60px_rgba(10,3,1,0.8)]">
        <p className="font-telemetry text-xs font-medium tracking-[0.2em] text-[#fb923c] uppercase">
          Flight Hold
        </p>
        <h2
          id="pause-title"
          className="font-display mt-1 text-3xl font-bold tracking-[0.08em] text-[#fff6ee] uppercase"
        >
          Paused
        </h2>

        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={onResume}
            className="font-display w-full rounded-sm border border-[#ffd7b5]/45 bg-[#e85622] px-5 py-3 text-base font-bold tracking-[0.14em] text-[#fff8f3] uppercase transition-colors duration-150 hover:bg-[#f26430] focus-visible:outline-2 focus-visible:outline-[#7dd3fc] cursor-pointer"
          >
            Resume Flight
          </button>

          <button
            type="button"
            onClick={onRestart}
            className="font-display w-full rounded-sm border border-[#ffd8bc]/25 bg-[#291009] px-5 py-2.5 text-sm font-semibold tracking-[0.14em] text-[#ffe9d8] uppercase transition-colors duration-150 hover:border-[#ffd8bc]/50 hover:bg-[#38160d] focus-visible:outline-2 focus-visible:outline-[#7dd3fc] cursor-pointer"
          >
            Restart Run
          </button>

          <button
            type="button"
            onClick={onTitle}
            className="font-display w-full rounded-sm border border-transparent px-5 py-2 text-sm font-medium tracking-[0.12em] text-[#e5baa0] uppercase transition-colors duration-150 hover:text-[#fff4eb] focus-visible:outline-2 focus-visible:outline-[#7dd3fc] cursor-pointer"
          >
            Title Screen
          </button>
        </div>
      </div>
    </div>
  );
};

interface GameOverModalProps {
  summary: RunSummary;
  selectedDifficulty: DifficultyId;
  onSelectDifficulty: (difficulty: DifficultyId) => void;
  onRestart: () => void;
  onTitle: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({
  summary,
  selectedDifficulty,
  onSelectDifficulty,
  onRestart,
  onTitle,
}) => {
  const formatDistance = (d: number) =>
    d >= 1000 ? `${(d / 1000).toFixed(1)}k` : `${d}m`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gameover-title"
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#120502]/72 p-4"
    >
      <div className="w-full max-w-md rounded-sm border border-[#ffd5b6]/28 bg-[#190905]/96 p-7 shadow-[0_24px_64px_rgba(10,3,1,0.85)]">
        <div className="flex items-center justify-between gap-2">
          <p className="font-telemetry text-xs font-medium tracking-[0.2em] text-[#f97316] uppercase">
            Hull Impact · Flight Complete
          </p>
          <span
            data-testid="summary-difficulty"
            className={`font-display rounded-[2px] border px-2 py-0.5 text-[11px] font-bold tracking-[0.14em] uppercase ${SUMMARY_DIFFICULTY_STYLES[summary.difficulty]}`}
          >
            {DIFFICULTY_CONFIGS[summary.difficulty].label}
          </span>
        </div>
        <h2
          id="gameover-title"
          className="font-display mt-1 text-3xl sm:text-4xl font-bold tracking-[0.06em] text-[#fff6ee] uppercase"
        >
          Run Terminated
        </h2>

        {/* 3 crisp tabular-nums flight telemetry readouts */}
        <div className="mt-5 grid grid-cols-3 gap-3 border-y border-[#ffd8bc]/14 py-4">
          <div>
            <div className="font-telemetry text-[11px] tracking-[0.14em] text-[#7dd3fc] uppercase">
              Peak Mach
            </div>
            <div
              data-testid="summary-peak-mach"
              className="font-telemetry mt-1 text-2xl sm:text-3xl font-bold text-[#f0fbff]"
            >
              {summary.peakMach.toFixed(1)}
            </div>
            <div className="font-telemetry mt-0.5 text-[11px] text-[#f5cbb0]/70">
              {summary.isNewBestMach ? 'New Record' : `Best ${summary.bestMach.toFixed(1)}`}
            </div>
          </div>

          <div>
            <div className="font-telemetry text-[11px] tracking-[0.14em] text-[#fb923c] uppercase">
              Distance
            </div>
            <div className="font-telemetry mt-1 text-2xl sm:text-3xl font-bold text-[#fff6ee]">
              {formatDistance(summary.distance)}
            </div>
            <div className="font-telemetry mt-0.5 text-[11px] text-[#f5cbb0]/70">
              {summary.isNewBestDistance
                ? 'New Record'
                : `Best ${formatDistance(summary.bestDistance)}`}
            </div>
          </div>

          <div>
            <div className="font-telemetry text-[11px] tracking-[0.14em] text-[#67e8f9] uppercase">
              Speed Gates
            </div>
            <div className="font-telemetry mt-1 text-2xl sm:text-3xl font-bold text-[#fff6ee]">
              {summary.gatesPassed}
            </div>
            <div className="font-telemetry mt-0.5 text-[11px] text-[#f5cbb0]/70">
              {summary.nearMissCount} canyon skims
            </div>
          </div>
        </div>

        {/* Final score row */}
        <div className="mt-4 flex items-baseline justify-between">
          <span className="font-display text-sm font-semibold tracking-[0.14em] text-[#f7c9aa] uppercase">
            Final Score
          </span>
          <div className="text-right">
            <span
              data-testid="summary-score"
              className="font-telemetry text-2xl font-bold text-[#fff7f0]"
            >
              {summary.score.toLocaleString()}
            </span>
            <span className="font-telemetry ml-2 text-xs text-[#f5cbb0]/75">
              {summary.isNewBestScore ? 'New Best' : `Best ${summary.bestScore.toLocaleString()}`}
            </span>
          </div>
        </div>

        {/* Instant Change Difficulty toggle right before Fly Again */}
        <div className="mt-5 border-t border-[#ffd8bc]/12 pt-4">
          <div className="flex items-center justify-between">
            <span className="font-telemetry text-[11px] font-medium tracking-[0.16em] text-[#f5cbb0]/80 uppercase">
              Change Difficulty
            </span>
            <span className="font-telemetry text-[10px] text-[#f5cbb0]/60">
              {DIFFICULTY_CONFIGS[selectedDifficulty].preview}
            </span>
          </div>
          <div
            role="radiogroup"
            aria-label="Change difficulty for next flight"
            className="mt-2 grid grid-cols-3 gap-2"
          >
            {DIFFICULTY_ORDER.map((id) => {
              const selected = selectedDifficulty === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`gameover-difficulty-${id}`}
                  onClick={() => onSelectDifficulty(id)}
                  className={`font-display rounded-sm border py-1.5 text-xs font-bold tracking-[0.14em] uppercase transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[#7dd3fc] cursor-pointer ${
                    selected
                      ? SUMMARY_DIFFICULTY_STYLES[id]
                      : 'border-[#ffd8bc]/18 bg-[#240d07] text-[#f5cbb0]/70 hover:border-[#ffd8bc]/40 hover:text-[#fff6ee]'
                  }`}
                >
                  {DIFFICULTY_CONFIGS[id].label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Primary actions */}
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            data-start="true"
            onClick={onRestart}
            className="font-display flex-1 rounded-sm border border-[#ffd7b5]/45 bg-[#e85622] px-6 py-3 text-base font-bold tracking-[0.14em] text-[#fff8f3] uppercase transition-colors duration-150 hover:bg-[#f26430] focus-visible:outline-2 focus-visible:outline-[#7dd3fc] cursor-pointer whitespace-nowrap"
          >
            Fly Again
          </button>

          <button
            type="button"
            onClick={onTitle}
            className="font-display rounded-sm border border-[#ffd8bc]/24 bg-[#291009] px-5 py-3 text-sm font-semibold tracking-[0.12em] text-[#ffe9d8] uppercase transition-colors duration-150 hover:border-[#ffd8bc]/50 hover:bg-[#38160d] focus-visible:outline-2 focus-visible:outline-[#7dd3fc] cursor-pointer whitespace-nowrap"
          >
            Menu
          </button>
        </div>
      </div>
    </div>
  );
};
