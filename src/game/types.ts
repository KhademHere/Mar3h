export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type ObstacleKind = 'spire' | 'arch' | 'buttress';

export interface CanyonObstacle {
  id: string;
  kind: ObstacleKind;
  x: number;
  y: number; // ground y at base
  z: number;
  /** For spire / buttress: base radius; for arch: half-span between pillars */
  radius: number;
  /** For spire / buttress: height above base; for arch: clearance height under arch crown */
  height: number;
  /** For arch: thickness of pillars and crown */
  thickness: number;
  /** For arch: angle rotation around Y */
  yaw: number;
  /** Subtle rock tint factor 0..1 */
  tint: number;
}

export interface ControlInput {
  /** -1 (left) to +1 (right) */
  steerX: number;
  /** -1 (down) to +1 (up) */
  steerY: number;
  /** True while Spacebar or Boost button is held */
  boost: boolean;
}

export interface FlightTelemetry {
  mach: number;
  speedMetersPerSec: number;
  altitude: number;
  distance: number;
  score: number;
  bestScore: number;
  bestMach: number;
  nearMissCount: number;
  boostCharge: number; // 0..1
  isBoosting: boolean;
  /** 0..1 intensity of peripheral motion blur & wind streaks */
  speedIntensity: number;
  autoplayActive: boolean;
}

export interface RunSummary {
  score: number;
  bestScore: number;
  peakMach: number;
  bestMach: number;
  distance: number;
  nearMissCount: number;
  survivalSeconds: number;
  isNewBestScore: boolean;
  isNewBestMach: boolean;
}

export interface HudBannerEvent {
  id: number;
  kind: 'near-miss' | 'shockwave' | 'scrape';
  label: string;
  sublabel: string;
}
