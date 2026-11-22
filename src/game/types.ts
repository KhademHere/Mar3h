export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type MartianZoneId = 'plains' | 'canyon' | 'colony' | 'volcanic';

export interface MartianZoneInfo {
  id: MartianZoneId;
  name: string;
  subtitle: string;
}

export type ObstacleKind =
  | 'spire'
  | 'arch'
  | 'buttress'
  | 'split-pillar'
  | 'overhang'
  | 'low-ridge'
  | 'comm-tower'
  | 'broken-bridge'
  | 'solar-array'
  | 'dust-devil';

export interface CanyonObstacle {
  id: string;
  kind: ObstacleKind;
  x: number;
  y: number; // ground y at base
  z: number;
  /** Primary half-width / span / base radius depending on obstacle kind */
  radius: number;
  /** Primary height or clearance height above base */
  height: number;
  /** Thickness / depth / slab height */
  thickness: number;
  /** Y rotation or lean angle */
  yaw: number;
  /** Subtle rock/weathering tint factor 0..1 */
  tint: number;
  /** Optional side (-1 left, +1 right) for cantilevered overhangs / towers */
  side?: -1 | 1;
  /** Optional sideways drift parameters for moving dust devils */
  driftAmp?: number;
  driftSpeed?: number;
  driftPhase?: number;
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
  zoneId: MartianZoneId;
  zoneName: string;
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
  kind: 'near-miss' | 'shockwave' | 'scrape' | 'zone';
  label: string;
  sublabel: string;
}
