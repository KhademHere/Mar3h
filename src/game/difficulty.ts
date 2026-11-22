import type { DifficultyId } from './types';

export interface DifficultyConfig {
  id: DifficultyId;
  label: string;
  preview: string;
  startMach: number;
  machRampPerSec: number;
  maxBaseMach: number;
  boostMachBonus: number;
  scoreRateMultiplier: number;
  /** Multiplier on canyon bend amplitude (1.0 gentle -> 1.46 sharp twists) */
  curveScale: number;
  /** Multiplier on corridor half-width (1.0 wide -> 0.84 narrow high-speed gaps) */
  widthScale: number;
  /** Multiplier on scrape graze forgiveness buffer (1.0 forgiving -> 0.36 razor-tight) */
  scrapeForgiveness: number;
  /** Max consecutive scrapes before a graze turns lethal */
  scrapeCooldownSec: number;
  /** Risk bias for Speed Gate lateral/vertical placement (0 easy -> 0.85 bold) */
  gateRiskBias: number;
  /** Wind streak intensity multiplier */
  windStreakMultiplier: number;
}

export const DIFFICULTY_ORDER: readonly DifficultyId[] = ['easy', 'medium', 'hard'] as const;

export const DIFFICULTY_CONFIGS: Record<DifficultyId, DifficultyConfig> = {
  easy: {
    id: 'easy',
    label: 'EASY',
    preview: 'Wide canyons & normal obstacle flow',
    startMach: 1.25,
    machRampPerSec: 0.0115,
    maxBaseMach: 2.35,
    boostMachBonus: 0.92,
    scoreRateMultiplier: 1.0,
    curveScale: 1.0,
    widthScale: 1.0,
    scrapeForgiveness: 1.0,
    scrapeCooldownSec: 1.15,
    gateRiskBias: 0.0,
    windStreakMultiplier: 1.0,
  },
  medium: {
    id: 'medium',
    label: 'MEDIUM',
    preview: 'Faster pace & crowded canyon hazards',
    startMach: 1.55,
    machRampPerSec: 0.0185,
    maxBaseMach: 2.85,
    boostMachBonus: 1.04,
    scoreRateMultiplier: 1.45,
    curveScale: 1.26,
    widthScale: 0.91,
    scrapeForgiveness: 0.68,
    scrapeCooldownSec: 1.55,
    gateRiskBias: 0.52,
    windStreakMultiplier: 1.24,
  },
  hard: {
    id: 'hard',
    label: 'HARD',
    preview: 'Extreme speed & relentless obstacles',
    startMach: 1.92,
    machRampPerSec: 0.0255,
    maxBaseMach: 3.45,
    boostMachBonus: 1.18,
    scoreRateMultiplier: 2.15,
    curveScale: 1.44,
    widthScale: 0.85,
    scrapeForgiveness: 0.34,
    scrapeCooldownSec: 2.1,
    gateRiskBias: 0.82,
    windStreakMultiplier: 1.55,
  },
};

export function getDifficultyConfig(difficulty: DifficultyId): DifficultyConfig {
  return DIFFICULTY_CONFIGS[difficulty] ?? DIFFICULTY_CONFIGS.easy;
}
