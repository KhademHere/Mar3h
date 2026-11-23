export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type DifficultyId = 'easy' | 'medium' | 'hard';

export interface DifficultyRecord {
  bestScore: number;
  bestDistance: number;
  bestMach: number;
}

export type AllDifficultyRecords = Record<DifficultyId, DifficultyRecord>;

export type MartianZoneId = 'plains' | 'canyon' | 'colony' | 'volcanic';

export type CameraViewMode = 'chase' | 'cockpit' | 'wing' | 'cinematic';

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

export interface SpeedGate {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Inner passable ring radius in meters */
  radius: number;
  /** 'flow' sits comfortably along the route; 'bonus' is tucked off-center / under arches / high-low for extra reward */
  tier: 'flow' | 'bonus';
  /** Subtle yaw alignment following the canyon curve */
  yaw: number;
}

export interface ControlInput {
  /** -1 (left) to +1 (right) */
  steerX: number;
  /** -1 (down) to +1 (up) */
  steerY: number;
  /** True while Spacebar or Boost button is held */
  boost: boolean;
  /** One-shot Snap Barrel Roll trigger: -1 left, +1 right, 0/undefined none */
  barrelRoll?: -1 | 0 | 1;
}

export interface FlightTelemetry {
  difficulty: DifficultyId;
  mach: number;
  speedMetersPerSec: number;
  altitude: number;
  distance: number;
  score: number;
  bestScore: number;
  bestDistance: number;
  bestMach: number;
  nearMissCount: number;
  boostCharge: number; // 0..1
  isBoosting: boolean;
  boostOverheated: boolean;
  /** 0..1 intensity of peripheral motion blur & wind streaks */
  speedIntensity: number;
  autoplayActive: boolean;
  zoneId: MartianZoneId;
  zoneName: string;
  /** Consecutive speed gates hit; displayed multiplier is gateMultiplier (x1, x2, x3...) */
  gateStreak: number;
  gateMultiplier: number;
  gatesPassed: number;
  cameraView: CameraViewMode;
  /** Craft roll & pitch in radians for subtle live cockpit horizon line */
  roll: number;
  pitch: number;
  /** 0..1 barrel roll readiness (1 = ready, glows bright white) */
  barrelRollCharge: number;
  /** True while mid-spin in a Snap Barrel Roll */
  barrelRollActive: boolean;
  barrelRollDir: -1 | 0 | 1;
}

export interface RunSummary {
  difficulty: DifficultyId;
  score: number;
  bestScore: number;
  peakMach: number;
  bestMach: number;
  distance: number;
  bestDistance: number;
  nearMissCount: number;
  gatesPassed: number;
  survivalSeconds: number;
  isNewBestScore: boolean;
  isNewBestMach: boolean;
  isNewBestDistance: boolean;
}

export interface HudBannerEvent {
  id: number;
  kind: 'near-miss' | 'shockwave' | 'scrape' | 'zone' | 'gate' | 'camera' | 'roll';
  label: string;
  sublabel: string;
}
