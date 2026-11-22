import { getDifficultyConfig } from './difficulty';
import {
  CHUNK_LENGTH,
  getCanyonCenterX,
  getCanyonHalfWidth,
  getDustDevilX,
  getObstaclesForChunk,
  getSpeedGatesForChunk,
  getTerrainHeight,
  getZoneInfoAtZ,
} from './terrainMath';
import type {
  CanyonObstacle,
  ControlInput,
  DifficultyId,
  MartianZoneId,
  MartianZoneInfo,
  ObstacleKind,
  SpeedGate,
} from './types';

export const MIN_ALTITUDE_OFFSET = 2.6;
/** High ceiling so players can climb and soar cleanly OVER giant natural stone arches */
export const MAX_ALTITUDE = 76;
export const START_MACH = 1.25;
export const WORLD_UNITS_PER_MACH = 105; // 1.0 Mach -> 105 world m/s for crisp canyon rush feel
export const MAX_DT = 0.05;
/** Minimum boost energy required to recover after overheating the Boost Bar to empty */
export const BOOST_OVERHEAT_RECOVERY_THRESHOLD = 0.25;
export const BOOST_OVERHEAT_COOLDOWN_SEC = 2.0;

export interface FlightState {
  difficulty: DifficultyId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  roll: number;
  pitch: number;
  yaw: number;
  baseMach: number;
  boostMach: number;
  nearMissMach: number;
  gateMach: number;
  mach: number;
  peakMach: number;
  boostCharge: number; // 0..1
  isBoosting: boolean;
  boostLockout: boolean;
  boostCooldownTimer: number;
  survivalSeconds: number;
  distance: number;
  score: number;
  nearMissCount: number;
  gateStreak: number;
  gatesPassed: number;
  lastMilestoneMach: number;
  wallNearMissCooldown: number;
  /** Cooldown protecting slight grazes from turning into instant crashes; if hit again rapidly -> crash */
  scrapeCooldown: number;
  scrapeWarningTimer: number;
  currentZoneId: MartianZoneId;
  triggeredObstacleIds: string[];
  resolvedGateIds: string[];
  crashed: boolean;
  crashReason: 'terrain' | 'obstacle' | null;
}

export interface FlightStepEvents {
  nearMiss: {
    bonusScore: number;
    machGain: number;
    source: 'wall' | ObstacleKind;
  } | null;
  gatePassed: {
    gateId: string;
    multiplier: number;
    bonusScore: number;
    machGain: number;
    boostRefill: number;
    tier: 'flow' | 'bonus';
    x: number;
    y: number;
    z: number;
  } | null;
  gateMissed: boolean;
  scrape: {
    source: 'terrain' | 'obstacle';
  } | null;
  milestoneMach: number | null;
  zoneChanged: MartianZoneInfo | null;
  crashed: boolean;
  boostStarted: boolean;
  boostOverheated: boolean;
}

export function createInitialFlightState(difficulty: DifficultyId = 'easy'): FlightState {
  const cfg = getDifficultyConfig(difficulty);
  const startX = getCanyonCenterX(0, difficulty);
  const startY = 20.5;
  const initMilestone = Math.floor(cfg.startMach * 2) / 2;
  return {
    difficulty,
    x: startX,
    y: startY,
    z: 0,
    vx: 0,
    vy: 0,
    roll: 0,
    pitch: 0,
    yaw: 0,
    baseMach: cfg.startMach,
    boostMach: 0,
    nearMissMach: 0,
    gateMach: 0,
    mach: cfg.startMach,
    peakMach: cfg.startMach,
    boostCharge: 1.0,
    isBoosting: false,
    boostLockout: false,
    boostCooldownTimer: 0,
    survivalSeconds: 0,
    distance: 0,
    score: 0,
    nearMissCount: 0,
    gateStreak: 0,
    gatesPassed: 0,
    lastMilestoneMach: Math.max(1.0, initMilestone),
    wallNearMissCooldown: 0,
    scrapeCooldown: 0,
    scrapeWarningTimer: 0,
    currentZoneId: getZoneInfoAtZ(0).id,
    triggeredObstacleIds: [],
    resolvedGateIds: [],
    crashed: false,
    crashReason: null,
  };
}

/** Frame-rate independent exponential damping */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function computeSpeedFromMach(mach: number): number {
  return mach * WORLD_UNITS_PER_MACH;
}

/**
 * Evaluates closest signed air clearance from craft point (px, py, pz) to an obstacle's solid volume.
 * <= 0 means touching/inside solid envelope, > 0 means meters of open air clearance.
 */
export function evaluateObstacleClearance(
  px: number,
  py: number,
  pz: number,
  obs: CanyonObstacle,
  craftRadius: number,
  worldTime = 0,
): number {
  const dz = pz - obs.z;
  const maxReachZ = obs.radius + obs.thickness + 24;
  if (Math.abs(dz) > maxReachZ) return Infinity;

  // 1. Moving swirling red dust devil (drifts smoothly sideways across the valley)
  if (obs.kind === 'dust-devil') {
    const liveX = getDustDevilX(obs, worldTime);
    const relY = py - obs.y;
    if (relY > obs.height + craftRadius + 10) return Infinity;
    const hRatio = Math.max(0, Math.min(1, relY / Math.max(1, obs.height)));
    const funnelRadius = obs.radius * (0.76 + hRatio * 0.42);
    const horizDist = Math.hypot(px - liveX, dz);
    if (relY > obs.height) {
      return Math.hypot(Math.max(0, horizDist - funnelRadius), relY - obs.height) - craftRadius;
    }
    return horizDist - funnelRadius - craftRadius;
  }

  // 2. Jagged rock spires & wall buttresses
  if (obs.kind === 'spire' || obs.kind === 'buttress') {
    const relY = py - obs.y;
    if (relY > obs.height + craftRadius + 10) return Infinity;
    const hRatio = Math.max(0, Math.min(1, relY / Math.max(1, obs.height)));
    const radiusAtY = obs.radius * (1 - hRatio * 0.72);
    const horizDist = Math.hypot(px - obs.x, dz);
    if (relY > obs.height) {
      return Math.hypot(Math.max(0, horizDist - radiusAtY), relY - obs.height) - craftRadius;
    }
    return horizDist - radiusAtY - craftRadius;
  }

  // 3. Split Canyon Path: massive central monolith (choose left or right tunnel)
  if (obs.kind === 'split-pillar') {
    const relY = py - obs.y;
    if (relY > obs.height + craftRadius + 12) return Infinity;
    const hRatio = Math.max(0, Math.min(1, relY / Math.max(1, obs.height)));
    const rx = obs.radius * (1 - hRatio * 0.28);
    const rz = obs.thickness * (1 - hRatio * 0.25);
    const dx = Math.abs(px - obs.x);
    const adz = Math.abs(dz);
    const ex = Math.max(0, dx - rx);
    const ez = Math.max(0, adz - rz);
    const insideDepth = ex === 0 && ez === 0 ? -Math.min(rx - dx, rz - adz) : Math.hypot(ex, ez);
    if (relY > obs.height) {
      return Math.hypot(Math.max(0, insideDepth), relY - obs.height) - craftRadius;
    }
    return insideDepth - craftRadius;
  }

  // 4. Leaning Rusted Colony Communication Tower
  if (obs.kind === 'comm-tower') {
    const relY = py - obs.y;
    if (relY < -2 || relY > obs.height + craftRadius + 10) return Infinity;
    const clampedY = Math.max(0, Math.min(obs.height, relY));
    const hRatio = clampedY / Math.max(1, obs.height);
    const leanX = obs.x + Math.sin(obs.yaw) * clampedY;
    const towerRadius = obs.radius * (1 - hRatio * 0.52) + (Math.abs(hRatio - 0.74) < 0.08 ? 2.2 : 0);
    const horizDist = Math.hypot(px - leanX, dz);
    if (relY > obs.height) {
      return Math.hypot(Math.max(0, horizDist - towerRadius), relY - obs.height) - craftRadius;
    }
    return horizDist - towerRadius - craftRadius;
  }

  // 5. Giant Tilted Mars Colony Solar Panel Array
  if (obs.kind === 'solar-array') {
    const relY = py - obs.y;
    if (relY > obs.height + craftRadius + 10) return Infinity;
    const stemDist = Math.hypot(px - obs.x, dz) - 2.6;
    const cosY = Math.cos(-obs.yaw);
    const sinY = Math.sin(-obs.yaw);
    const dx = px - obs.x;
    const lx = dx * cosY - dz * sinY;
    const lz = dx * sinY + dz * cosY;

    let panelClearance = Infinity;
    const panelBottom = 8.5;
    const panelTop = obs.height;
    const ex = Math.max(0, Math.abs(lx) - obs.radius);
    const ez = Math.max(0, Math.abs(lz) - obs.thickness * 1.15);
    const ey = relY < panelBottom ? panelBottom - relY : relY > panelTop ? relY - panelTop : 0;
    if (ex === 0 && ez === 0 && ey === 0) {
      panelClearance = -Math.min(
        obs.radius - Math.abs(lx),
        obs.thickness * 1.15 - Math.abs(lz),
        relY - panelBottom,
        panelTop - relY,
      );
    } else {
      panelClearance = Math.hypot(ex, ey, ez);
    }
    return Math.min(stemDist, panelClearance) - craftRadius;
  }

  // Rotate into local coordinates for spanning canyon structures (arch, overhang, low-ridge, broken-bridge)
  const cosY = Math.cos(-obs.yaw);
  const sinY = Math.sin(-obs.yaw);
  const dx = px - obs.x;
  const lx = dx * cosY - dz * sinY;
  const lz = dx * sinY + dz * cosY;

  // 6. Overhanging Red Cliff Ledge (dive LOW underneath!)
  if (obs.kind === 'overhang') {
    const halfDepth = obs.thickness * 0.56;
    const zExcess = Math.max(0, Math.abs(lz) - halfDepth);
    const side = obs.side ?? 1;
    const minX = side > 0 ? -obs.radius * 0.62 : -obs.radius * 1.45;
    const maxX = side > 0 ? obs.radius * 1.45 : obs.radius * 0.62;
    const xExcess = lx < minX ? minX - lx : lx > maxX ? lx - maxX : 0;

    const undersideY = obs.y + obs.height;
    const topY = undersideY + 34;
    if (py >= undersideY && py <= topY && xExcess === 0 && zExcess === 0) {
      const innerDepth = Math.min(py - undersideY, topY - py, halfDepth - Math.abs(lz));
      return -innerDepth - craftRadius;
    }
    const yExcess = py < undersideY ? undersideY - py : py > topY ? py - topY : 0;
    return Math.hypot(xExcess, yExcess, zExcess) - craftRadius;
  }

  // 7. Low Jagged Ridge across valley floor (climb HIGH over!)
  if (obs.kind === 'low-ridge') {
    const halfDepth = obs.thickness * 0.52;
    const zExcess = Math.max(0, Math.abs(lz) - halfDepth);
    const xExcess = Math.max(0, Math.abs(lx) - obs.radius);
    const crestY = obs.y + obs.height;
    if (py <= crestY && xExcess === 0 && zExcess === 0) {
      const innerDepth = Math.min(crestY - py, halfDepth - Math.abs(lz));
      return -innerDepth - craftRadius;
    }
    const yExcess = Math.max(0, py - crestY);
    return Math.hypot(xExcess, yExcess, zExcess) - craftRadius;
  }

  // 8. Abandoned Colony Broken Bridge Span
  if (obs.kind === 'broken-bridge') {
    const halfDepth = obs.thickness * 1.05;
    const zExcess = Math.max(0, Math.abs(lz) - halfDepth);

    const leftPier = Math.hypot(Math.max(0, Math.abs(lx + obs.radius) - 4.2), zExcess);
    const rightPier = Math.hypot(Math.max(0, Math.abs(lx - obs.radius) - 4.2), zExcess);
    const pierClearance =
      py <= obs.y + obs.height + obs.thickness + 4
        ? Math.min(leftPier, rightPier) - craftRadius
        : Infinity;

    let deckClearance = Infinity;
    const gapHalf = 10.5;
    const deckBottom = obs.y + obs.height;
    const deckTop = deckBottom + obs.thickness;
    if (Math.abs(lx) <= obs.radius + 14) {
      const xExcessDeck = Math.abs(lx) < gapHalf ? gapHalf - Math.abs(lx) : 0;
      const yExcessDeck =
        py < deckBottom ? deckBottom - py : py > deckTop ? py - deckTop : 0;
      if (xExcessDeck === 0 && yExcessDeck === 0 && zExcess === 0) {
        deckClearance = -Math.min(py - deckBottom, deckTop - py, halfDepth - Math.abs(lz)) - craftRadius;
      } else {
        deckClearance = Math.hypot(xExcessDeck, yExcessDeck, zExcess) - craftRadius;
      }
    }

    return Math.min(pierClearance, deckClearance);
  }

  // 9. Giant Natural Stone Arch: open UNDER crown AND open OVER crown!
  const halfDepth = obs.thickness * 0.72;
  const zExcess = Math.max(0, Math.abs(lz) - halfDepth);

  const leftPillarDist = Math.hypot(
    Math.max(0, Math.abs(lx + obs.radius) - obs.thickness * 0.8),
    zExcess,
  );
  const rightPillarDist = Math.hypot(
    Math.max(0, Math.abs(lx - obs.radius) - obs.thickness * 0.8),
    zExcess,
  );
  const pillarClearance =
    py <= obs.y + obs.height + obs.thickness * 1.35
      ? Math.min(leftPillarDist, rightPillarDist) - craftRadius
      : Infinity;

  let crownClearance = Infinity;
  if (Math.abs(lx) <= obs.radius + obs.thickness) {
    const normX = Math.min(1, Math.abs(lx) / Math.max(1, obs.radius));
    const archUndersideY = obs.y + obs.height * (1 - 0.3 * normX * normX);
    const archTopY = archUndersideY + obs.thickness * 1.2;
    if (py >= archUndersideY && py <= archTopY) {
      crownClearance = zExcess - craftRadius;
    } else if (py < archUndersideY) {
      crownClearance = Math.hypot(zExcess, archUndersideY - py) - craftRadius;
    } else {
      crownClearance = Math.hypot(zExcess, py - archTopY) - craftRadius;
    }
  }

  return Math.min(pillarClearance, crownClearance);
}

/**
 * Predictive Elite Ace Autoplay pilot adapting seamlessly across EASY, MEDIUM, and HARD:
 * - EASY / MEDIUM: Actively hunts Glowing Speed Gates, banks gracefully, fires strategic boost bursts.
 * - HARD: Reads far ahead down the canyon (up to 540m), scores multi-obstacle lanes to thread
 *   twin-spire gauntlets & dense clusters cleanly, prioritizes safe dodging over risky Speed Gates,
 *   banks sharply & decisively, and saves afterburner bursts strictly for clean openings!
 */
export function computeAutoplayInput(
  state: FlightState,
  obstacles: CanyonObstacle[],
  isGameplayAutoplay: boolean,
  worldTime = 0,
  gates: SpeedGate[] = [],
): ControlInput {
  const diff = state.difficulty;
  const isHard = diff === 'hard';
  const isMedium = diff === 'medium';

  const speed = computeSpeedFromMach(state.mach);
  const lookAheadScale = isHard ? 1.32 : isMedium ? 1.12 : 0.96;
  const lookAheadMax = isHard ? 380 : isMedium ? 310 : 265;
  const lookAheadDist = Math.max(130, Math.min(lookAheadMax, speed * lookAheadScale));
  const nearZ = state.z - lookAheadDist * 0.46;
  const farZ = state.z - lookAheadDist;

  // Blend canyon center between near & far lookahead for crisp curve anticipation
  const centerNear = getCanyonCenterX(nearZ, diff);
  const centerFar = getCanyonCenterX(farZ, diff);
  const canyonCenter = centerNear * (isHard ? 0.56 : 0.64) + centerFar * (isHard ? 0.44 : 0.36);
  const hw = getCanyonHalfWidth(nearZ, diff);

  let targetX =
    canyonCenter +
    Math.sin(state.survivalSeconds * 0.36) * (isHard ? 2.0 : isGameplayAutoplay ? 5.5 : 7.5);
  let targetY = 22 + Math.sin(state.survivalSeconds * 0.29) * (isHard ? 1.6 : 3.2);

  const scanHorizon = isHard ? 540 : isMedium ? 440 : 380;

  // Gather upcoming obstacles ahead
  const upcoming: { obs: CanyonObstacle; distAhead: number }[] = [];
  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];
    const distAhead = state.z - obs.z; // positive when ahead (-Z)
    if (distAhead < -18 || distAhead > scanHorizon) continue;
    upcoming.push({ obs, distAhead });
  }
  upcoming.sort((a, b) => b.distAhead - a.distAhead);

  // Check if a tight dense cluster sits immediately ahead (used to prioritize dodging on Hard)
  const nearHazardCount = upcoming.filter((u) => u.distAhead > -6 && u.distAhead < (isHard ? 270 : 190)).length;

  // --- Phase 1: Active Speed Gate Hunting (prioritized on Easy/Medium; strictly safe-only on Hard!) ---
  let huntingGate: SpeedGate | null = null;
  let gateDist = Infinity;
  const gateHuntMaxDist = isHard ? 300 : 420;
  for (let i = 0; i < gates.length; i++) {
    const g = gates[i];
    if (state.resolvedGateIds.includes(g.id)) continue;
    const d = state.z - g.z;
    if (d < -6 || d > gateHuntMaxDist) continue;
    if (d < gateDist) {
      // On Hard, skip risky off-center gates if a dense hazard cluster is right beside us
      if (isHard && nearHazardCount >= 3 && Math.abs(g.x - state.x) > 18) continue;

      let gateClear = true;
      const tArrive = worldTime + Math.max(0, d) / Math.max(70, speed);
      for (let j = 0; j < obstacles.length; j++) {
        const obs = obstacles[j];
        if (Math.abs(obs.z - g.z) > (isHard ? 44 : 28)) continue;
        const clr = evaluateObstacleClearance(g.x, g.y, g.z, obs, isHard ? 6.5 : 4.5, tArrive);
        if (clr < (isHard ? 4.0 : 2.0)) {
          gateClear = false;
          break;
        }
      }
      if (gateClear) {
        gateDist = d;
        huntingGate = g;
      }
    }
  }

  let linedUpOnGate = false;
  if (huntingGate) {
    const maxWeight = isHard ? 0.55 : isMedium ? 0.85 : 1.0;
    const gateUrgency =
      Math.max(0.18, Math.min(1, 1 - Math.max(0, gateDist - 40) / 340)) * maxWeight;
    targetX = targetX * (1 - gateUrgency) + huntingGate.x * gateUrgency;
    targetY = targetY * (1 - gateUrgency) + huntingGate.y * gateUrgency;
    const distErr = Math.hypot(state.x - huntingGate.x, state.y - huntingGate.y);
    linedUpOnGate = gateDist > 35 && gateDist < 340 && distErr < 18;
  }

  // --- Phase 2: Safety-First Obstacle Avoidance (always strictly overrides Speed Gate hunting!) ---
  let tightObstacleAhead = false;
  const urgencyRange = isHard ? 440 : isMedium ? 380 : 340;
  const tightWindow = isHard ? 320 : isMedium ? 225 : 185;

  for (let i = 0; i < upcoming.length; i++) {
    const { obs, distAhead } = upcoming[i];
    const clampedDist = Math.max(0, distAhead);
    const urgency = Math.max(0, Math.min(1, 1 - clampedDist / urgencyRange));
    const strongUrgency = Math.min(1, urgency * (isHard ? 1.65 : 1.38));
    const obsCenter = getCanyonCenterX(obs.z, diff);
    const obsHw = getCanyonHalfWidth(obs.z, diff);

    if (obs.kind === 'arch') {
      targetX = targetX * (1 - strongUrgency) + obs.x * strongUrgency;
      const crownTop = obs.y + obs.height + obs.thickness * 1.25;
      if (state.y > crownTop + 4 && crownTop + 10 < MAX_ALTITUDE - 4 && !isHard) {
        const overY = crownTop + 10;
        targetY = targetY * (1 - strongUrgency) + overY * strongUrgency;
      } else {
        const underY = Math.max(15, Math.min(obs.y + obs.height * 0.5, 22));
        targetY = targetY * (1 - strongUrgency) + underY * strongUrgency;
      }
    } else if (obs.kind === 'split-pillar') {
      if (clampedDist < tightWindow) tightObstacleAhead = true;
      let side: -1 | 1 = state.x >= obs.x ? 1 : -1;
      if (!isHard && huntingGate && Math.abs(huntingGate.z - obs.z) < 40) {
        side = huntingGate.x >= obs.x ? 1 : -1;
      } else if (isHard) {
        // Pick whichever side has more open canyon width away from the pillar
        const rightRoom = obsCenter + obsHw * 0.68 - (obs.x + obs.radius);
        const leftRoom = obs.x - obs.radius - (obsCenter - obsHw * 0.68);
        if (Math.abs(rightRoom - leftRoom) > 5) {
          side = rightRoom >= leftRoom ? 1 : -1;
        }
      }
      const safeOffset = Math.min(obsHw * 0.62, obs.radius + (isHard ? 16.5 : 17.5));
      const tunnelX = obs.x + side * safeOffset;
      targetX = targetX * (1 - strongUrgency) + tunnelX * strongUrgency;
      targetY = targetY * (1 - urgency * 0.45) + 22 * (urgency * 0.45);
    } else if (obs.kind === 'overhang') {
      if (clampedDist < tightWindow) tightObstacleAhead = true;
      const floorAtObs = getTerrainHeight(obsCenter, obs.z, diff);
      const diveY = Math.max(floorAtObs + 9.2, obs.y + obs.height - 11.8);
      targetY = targetY * (1 - strongUrgency) + diveY * strongUrgency;
      const awayBias = -(obs.side ?? 1) * Math.min(13, obsHw * 0.22);
      targetX = targetX * (1 - urgency * 0.55) + (obsCenter + awayBias) * (urgency * 0.55);
    } else if (obs.kind === 'low-ridge') {
      if (clampedDist < tightWindow && state.y < obs.y + obs.height + 7) tightObstacleAhead = true;
      const climbY = Math.min(MAX_ALTITUDE - 12, obs.y + obs.height + 12.8);
      targetY = targetY * (1 - strongUrgency) + climbY * strongUrgency;
    } else if (obs.kind === 'broken-bridge') {
      if (clampedDist < tightWindow * 0.85) tightObstacleAhead = true;
      targetX = targetX * (1 - strongUrgency) + obs.x * strongUrgency;
      const floorAtObs = getTerrainHeight(obs.x, obs.z, diff);
      const underBridgeY = Math.max(floorAtObs + 9.5, obs.y + obs.height - 11.2);
      targetY = targetY * (1 - strongUrgency) + underBridgeY * strongUrgency;
    } else if (obs.kind === 'dust-devil') {
      const timeToReach = clampedDist / Math.max(70, speed);
      const futureX = getDustDevilX(obs, worldTime + timeToReach);
      const safeRadius = obs.radius + (isHard ? 16.5 : 18);
      if (Math.abs(targetX - futureX) < safeRadius) {
        if (clampedDist < tightWindow) tightObstacleAhead = true;
        const preferRight = futureX <= obsCenter;
        const passX = futureX + (preferRight ? safeRadius : -safeRadius);
        const clampedPassX = Math.max(
          obsCenter - obsHw * 0.62,
          Math.min(obsCenter + obsHw * 0.62, passX),
        );
        targetX = targetX * (1 - strongUrgency) + clampedPassX * strongUrgency;
      }
    } else {
      const effectiveObsX =
        obs.kind === 'comm-tower'
          ? obs.x + Math.sin(obs.yaw) * Math.max(0, state.y - obs.y)
          : obs.x;
      const safeRadius = obs.radius + (isHard ? 15.5 : 17);
      if (Math.abs(targetX - effectiveObsX) < safeRadius) {
        if (clampedDist < tightWindow) tightObstacleAhead = true;
        const preferRight = effectiveObsX <= obsCenter;
        const passX = effectiveObsX + (preferRight ? safeRadius : -safeRadius);
        const clampedPassX = Math.max(
          obsCenter - obsHw * 0.62,
          Math.min(obsCenter + obsHw * 0.62, passX),
        );
        targetX = targetX * (1 - strongUrgency) + clampedPassX * strongUrgency;
      }
    }
  }

  // --- Phase 2B: Multi-Obstacle Corridor Lane Scoring (Handles Twin Spire Gates & Dense Clusters!) ---
  if (isHard || isMedium) {
    const imminent = upcoming.filter((u) => u.distAhead > -6 && u.distAhead < (isHard ? 260 : 180));
    if (imminent.length >= 2) {
      let bestX = targetX;
      let bestScore = -Infinity;
      const samples = 13;
      for (let s = 0; s < samples; s++) {
        const frac = (s / (samples - 1)) * 2 - 1; // -1..+1
        const candX = canyonCenter + frac * hw * 0.64;
        let minWeightedClearance = Infinity;

        for (let k = 0; k < imminent.length; k++) {
          const { obs, distAhead } = imminent[k];
          if (obs.kind === 'overhang' || obs.kind === 'low-ridge' || obs.kind === 'arch' || obs.kind === 'broken-bridge') {
            continue;
          }
          const tReach = Math.max(0, distAhead) / Math.max(70, speed);
          const obsLocalCenter = getCanyonCenterX(obs.z, diff);
          const candAtObsX = obsLocalCenter + (candX - canyonCenter);
          const clr = evaluateObstacleClearance(
            candAtObsX,
            targetY,
            obs.z,
            obs,
            3.2,
            worldTime + tReach,
          );
          const distFactor = 0.55 + 0.45 * (Math.max(0, distAhead) / 260);
          const weighted = clr * distFactor;
          if (weighted < minWeightedClearance) minWeightedClearance = weighted;
        }

        const continuityPenalty = Math.abs(candX - state.x) * (isHard ? 0.08 : 0.12);
        const targetBias = Math.abs(candX - targetX) * 0.05;
        const score = Math.min(28, minWeightedClearance) - continuityPenalty - targetBias;
        if (score > bestScore) {
          bestScore = score;
          bestX = candX;
        }
      }
      targetX = bestX;
    }
  }

  // Keep targetX comfortably inside the safe inner canyon corridor
  targetX = Math.max(canyonCenter - hw * 0.64, Math.min(canyonCenter + hw * 0.64, targetX));

  // Ensure safe altitude clearance over valley terrain ahead and beneath
  const groundHere = getTerrainHeight(state.x, state.z, diff);
  const groundAhead = getTerrainHeight(targetX, nearZ, diff);
  const minSafeY = Math.max(groundHere, groundAhead) + 9.5;
  targetY = Math.max(minSafeY, Math.min(MAX_ALTITUDE - 10, targetY));

  // Sharper, decisive elite-ace banking on Hard mode
  const xGain = isHard ? 0.13 : isMedium ? 0.105 : 0.085;
  const xDamp = isHard ? 0.0038 : 0.0042;
  const yGain = isHard ? 0.18 : isMedium ? 0.16 : 0.14;
  const maxSteer = isHard ? 1.0 : 0.96;

  const steerX = Math.max(-maxSteer, Math.min(maxSteer, (targetX - state.x) * xGain - state.vx * xDamp));
  const steerY = Math.max(-0.96, Math.min(0.96, (targetY - state.y) * yGain - state.vy * 0.0052));

  // --- Phase 3: Intelligent Strategic Afterburner Bursts ---
  let boost = false;
  if (isGameplayAutoplay && !state.boostLockout) {
    const cNow = getCanyonCenterX(state.z, diff);
    const cMid = getCanyonCenterX(state.z - 150, diff);
    const cFar = getCanyonCenterX(state.z - 290, diff);
    const bendRate = Math.abs((cFar - cMid) - (cMid - cNow));
    const lateralSweep = Math.abs(cMid - cNow);

    const sharpBendAhead = bendRate > (isHard ? 15 : 16) || lateralSweep > (isHard ? 25 : 26);
    const straightOrExit = bendRate < (isHard ? 12.5 : 11) && lateralSweep < (isHard ? 22 : 20);
    const wellAligned = Math.abs(targetX - state.x) < (isHard ? 15 : 18) && Math.abs(targetY - state.y) < 12;

    // On Hard, verify our projected flight lane is genuinely clear over the next 165m before firing afterburners!
    let projectedLaneClear = true;
    if (isHard) {
      for (let i = 0; i < upcoming.length; i++) {
        const { obs, distAhead } = upcoming[i];
        if (distAhead < 0 || distAhead > 165) continue;
        const frac = distAhead / 165;
        const projX = state.x + (targetX - state.x) * Math.min(1, frac * 1.15);
        const projY = state.y + (targetY - state.y) * Math.min(1, frac * 1.15);
        const tReach = distAhead / Math.max(85, speed);
        const clr = evaluateObstacleClearance(projX, projY, obs.z, obs, 2.8, worldTime + tReach);
        if (clr < 7.5) {
          projectedLaneClear = false;
          break;
        }
      }
    }

    if (state.isBoosting) {
      const stopFloor = isHard ? 0.28 : 0.2;
      boost =
        state.boostCharge > stopFloor &&
        !sharpBendAhead &&
        (isHard ? projectedLaneClear : !tightObstacleAhead);
    } else {
      const healthyEnergy = state.boostCharge >= (isHard ? 0.58 : 0.56);
      const strongOpportunity = isHard
        ? straightOrExit && wellAligned && projectedLaneClear && !sharpBendAhead
        : (straightOrExit || linedUpOnGate) &&
          wellAligned &&
          !tightObstacleAhead &&
          !sharpBendAhead;
      boost = healthyEnergy && strongOpportunity;
    }
  }

  return { steerX, steerY, boost };
}

/**
 * Pure simulation step for Ares Mach.
 * Advances position, velocity, banking, Mach progression, Boost Bar with overheat cooldown,
 * Glowing Speed Gates (streak multiplier + Mach burst + boost refill), Martian zone tracking,
 * forgiving grazes, near-misses, solid-hit collisions, and smart Autoplay piloting.
 */
export function stepFlightSimulation(
  prev: FlightState,
  input: ControlInput,
  rawDt: number,
  options?: {
    /** Title screen showcase cruise (invulnerable, steady Mach, no scoring) */
    autopilot?: boolean;
    /** Active gameplay one-click Autoplay mode (uses real Boost Bar, hunts Speed Gates, dodges cleanly) */
    gameplayAutoplay?: boolean;
    obstaclesOverride?: CanyonObstacle[];
    gatesOverride?: SpeedGate[];
  },
): { state: FlightState; events: FlightStepEvents } {
  const dt = Math.min(Math.max(rawDt, 0), MAX_DT);
  const events: FlightStepEvents = {
    nearMiss: null,
    gatePassed: null,
    gateMissed: false,
    scrape: null,
    milestoneMach: null,
    zoneChanged: null,
    crashed: false,
    boostStarted: false,
    boostOverheated: false,
  };

  if (prev.crashed || dt <= 0) {
    return { state: prev, events };
  }

  const next: FlightState = {
    ...prev,
    triggeredObstacleIds: prev.triggeredObstacleIds,
    resolvedGateIds: prev.resolvedGateIds,
  };

  const titleAutopilot = Boolean(options?.autopilot);
  const gameplayAutoplay = Boolean(options?.gameplayAutoplay) && !titleAutopilot;

  const diff = prev.difficulty;
  const diffCfg = getDifficultyConfig(diff);

  // Gather nearby obstacles & Speed Gates up front (scan +3 chunks ahead on Hard for elite anticipation!)
  const chunkIdx = Math.max(0, Math.floor(-prev.z / CHUNK_LENGTH));
  const obstacles =
    options?.obstaclesOverride ?? [
      ...getObstaclesForChunk(chunkIdx, diff),
      ...(chunkIdx > 0 ? getObstaclesForChunk(chunkIdx - 1, diff) : []),
      ...getObstaclesForChunk(chunkIdx + 1, diff),
      ...getObstaclesForChunk(chunkIdx + 2, diff),
      ...(diff === 'hard' ? getObstaclesForChunk(chunkIdx + 3, diff) : []),
    ];

  const gates =
    options?.gatesOverride ?? [
      ...getSpeedGatesForChunk(chunkIdx, diff),
      ...(chunkIdx > 0 ? getSpeedGatesForChunk(chunkIdx - 1, diff) : []),
      ...getSpeedGatesForChunk(chunkIdx + 1, diff),
      ...getSpeedGatesForChunk(chunkIdx + 2, diff),
    ];

  // Determine effective steering & boost intent
  let steerX = Math.max(-1, Math.min(1, input.steerX));
  let steerY = Math.max(-1, Math.min(1, input.steerY));
  let wantsBoost = input.boost;

  if (titleAutopilot || gameplayAutoplay) {
    const ai = computeAutoplayInput(prev, obstacles, gameplayAutoplay, prev.survivalSeconds, gates);
    steerX = ai.steerX;
    steerY = ai.steerY;
    wantsBoost = ai.boost;
  }

  // --- Afterburner Boost Bar & Overheat Cooldown Rules (shared identically by Player & Autoplay) ---
  if (next.boostCooldownTimer > 0) {
    next.boostCooldownTimer = Math.max(0, next.boostCooldownTimer - dt);
  }
  if (
    next.boostLockout &&
    next.boostCooldownTimer <= 0 &&
    next.boostCharge >= BOOST_OVERHEAT_RECOVERY_THRESHOLD
  ) {
    next.boostLockout = false;
  }

  const canBoost = wantsBoost && !next.boostLockout && next.boostCharge > 0.008;
  if (canBoost) {
    if (!prev.isBoosting) {
      events.boostStarted = true;
    }
    next.isBoosting = true;
    next.boostCharge = Math.max(0, next.boostCharge - dt * 0.28);
    if (next.boostCharge <= 0.005) {
      next.boostCharge = 0;
      next.boostLockout = true;
      next.boostCooldownTimer = BOOST_OVERHEAT_COOLDOWN_SEC;
      next.isBoosting = false;
      events.boostOverheated = true;
    }
  } else {
    next.isBoosting = false;
    const rechargeRate = next.boostLockout ? 0.135 : 0.165;
    next.boostCharge = Math.min(1, next.boostCharge + dt * rechargeRate);
  }

  // Difficulty-scaled Mach progression (steady on Easy -> fast on Medium -> blistering on Hard)
  if (!titleAutopilot) {
    next.survivalSeconds += dt;
    const accelRate =
      diffCfg.machRampPerSec / (1 + Math.max(0, next.baseMach - diffCfg.startMach) * 0.24);
    next.baseMach = Math.min(diffCfg.maxBaseMach, next.baseMach + accelRate * dt);
  } else {
    next.survivalSeconds += dt;
    next.baseMach = 1.4;
  }

  // Smooth boost Mach surge, decaying Near-Miss surge, and Speed Gate Mach burst
  const targetBoostMach = next.isBoosting ? diffCfg.boostMachBonus : 0;
  next.boostMach = damp(next.boostMach, targetBoostMach, next.isBoosting ? 5.8 : 3.0, dt);
  next.nearMissMach = damp(next.nearMissMach, 0, 1.35, dt);
  next.gateMach = damp(next.gateMach, 0, 1.05, dt);

  next.mach = next.baseMach + next.boostMach + next.nearMissMach + next.gateMach;
  if (!titleAutopilot && next.mach > next.peakMach) {
    next.peakMach = next.mach;
  }

  // Check for supersonic milestone crossing (Mach 1.5, 2.0, 2.5, 3.0, 3.5, 4.0...)
  if (!titleAutopilot) {
    const nextMilestone = Math.round((next.lastMilestoneMach + 0.5) * 10) / 10;
    if (next.mach >= nextMilestone) {
      next.lastMilestoneMach = Math.floor(next.mach * 2) / 2;
      events.milestoneMach = next.lastMilestoneMach;
    }
  }

  // Forward travel speed & responsive steering authority (extra crisp agility at Hard/extreme Mach!)
  const forwardSpeed = computeSpeedFromMach(next.mach);
  const agilityScale = diff === 'hard' ? 1.18 : diff === 'medium' ? 1.08 : 1.0;
  const lateralAuthority = (66 + (next.mach - 1) * 16) * agilityScale;
  const verticalAuthority = (46 + (next.mach - 1) * 9) * agilityScale;

  const targetVx = steerX * lateralAuthority;
  const targetVy = steerY * verticalAuthority;

  const steeringResponse = diff === 'hard' ? 11.4 : diff === 'medium' ? 10.4 : 9.6;
  next.vx = damp(next.vx, targetVx, steeringResponse, dt);
  next.vy = damp(next.vy, targetVy, steeringResponse - 0.2, dt);

  // Advance world coordinates (flying toward -Z)
  next.x += next.vx * dt;
  next.y += next.vy * dt;
  next.z -= forwardSpeed * dt;

  // Soft altitude ceiling (76m: plenty of headroom to climb & soar over giant stone arches)
  if (next.y > MAX_ALTITUDE) {
    next.y = MAX_ALTITUDE;
    if (next.vy > 0) next.vy = 0;
  }

  // Detect Martian zone transitions every ~30-40 seconds of flight
  const zoneNow = getZoneInfoAtZ(next.z);
  if (zoneNow.id !== prev.currentZoneId) {
    next.currentZoneId = zoneNow.id;
    if (!titleAutopilot) {
      events.zoneChanged = zoneNow;
    }
  }

  // Natural supersonic banking & pitching into every turn
  const targetRoll = -steerX * 0.86 - (next.vx / lateralAuthority) * 0.14;
  const targetPitch = steerY * 0.4 + (next.vy / verticalAuthority) * 0.08;
  const targetYaw = -steerX * 0.15;

  next.roll = damp(next.roll, targetRoll, 9.5, dt);
  next.pitch = damp(next.pitch, targetPitch, 9.0, dt);
  next.yaw = damp(next.yaw, targetYaw, 8.0, dt);

  // --- Glowing Speed Gate Detection (Runs identically for both Human & Gameplay Autoplay!) ---
  if (!titleAutopilot) {
    for (let i = 0; i < gates.length; i++) {
      const gate = gates[i];
      if (next.resolvedGateIds.includes(gate.id)) continue;

      const crossedPlane = prev.z >= gate.z - 4 && next.z <= gate.z + 4;
      const radialDist = Math.hypot(next.x - gate.x, next.y - gate.y);

      if (crossedPlane && radialDist <= gate.radius + 2.6) {
        const updatedResolved =
          next.resolvedGateIds.length > 28
            ? [...next.resolvedGateIds.slice(-18), gate.id]
            : [...next.resolvedGateIds, gate.id];
        next.resolvedGateIds = updatedResolved;

        next.gateStreak += 1;
        next.gatesPassed += 1;
        const multiplier = 1 + next.gateStreak; // x2 on 1st gate, x3 on 2nd, x4 on 3rd...
        const basePoints = gate.tier === 'bonus' ? 500 : 350;
        const bonusScore = Math.round(basePoints * multiplier * diffCfg.scoreRateMultiplier);
        const machGain = gate.tier === 'bonus' ? 0.34 : 0.28;
        const boostRefill = gate.tier === 'bonus' ? 0.36 : 0.3;

        next.score += bonusScore;
        next.gateMach = Math.min(0.85, next.gateMach + machGain);
        next.mach = next.baseMach + next.boostMach + next.nearMissMach + next.gateMach;
        if (next.mach > next.peakMach) next.peakMach = next.mach;

        // Instant Boost Bar Refill Bonus!
        next.boostCharge = Math.min(1, next.boostCharge + boostRefill);
        if (next.boostLockout && next.boostCharge >= BOOST_OVERHEAT_RECOVERY_THRESHOLD) {
          next.boostCooldownTimer = Math.min(next.boostCooldownTimer, 0.35);
        }

        events.gatePassed = {
          gateId: gate.id,
          multiplier,
          bonusScore,
          machGain,
          boostRefill,
          tier: gate.tier,
          x: gate.x,
          y: gate.y,
          z: gate.z,
        };
        break;
      }

      // Gently reset Gate Streak back to x1 once craft passes cleanly beyond a missed gate
      if (next.z < gate.z - 18) {
        const updatedResolved =
          next.resolvedGateIds.length > 28
            ? [...next.resolvedGateIds.slice(-18), gate.id]
            : [...next.resolvedGateIds, gate.id];
        next.resolvedGateIds = updatedResolved;
        if (next.gateStreak > 0) {
          next.gateStreak = 0;
          events.gateMissed = true;
        }
      }
    }
  }

  // Distance & score accumulation (scaled by active Gate Streak Multiplier AND Difficulty Multiplier!)
  if (!titleAutopilot) {
    const dz = forwardSpeed * dt;
    const streakFactor = 1 + Math.min(3.5, next.gateStreak * 0.25);
    next.distance += dz;
    next.score +=
      dz *
      (0.42 * next.mach) *
      (next.isBoosting ? 1.35 : 1.0) *
      streakFactor *
      diffCfg.scoreRateMultiplier;
  }

  if (next.wallNearMissCooldown > 0) {
    next.wallNearMissCooldown = Math.max(0, next.wallNearMissCooldown - dt);
  }
  if (next.scrapeCooldown > 0) {
    next.scrapeCooldown = Math.max(0, next.scrapeCooldown - dt);
  }
  if (next.scrapeWarningTimer > 0) {
    next.scrapeWarningTimer = Math.max(0, next.scrapeWarningTimer - dt);
  }

  const worldTime = next.survivalSeconds;

  // Title showcase and active Autoplay mode guarantee smooth, crash-free canyon carving
  if (titleAutopilot || gameplayAutoplay) {
    const floorNow = getTerrainHeight(next.x, next.z, diff);
    if (next.y < floorNow + 7.5) {
      next.y = floorNow + 7.5;
      if (next.vy < 0) next.vy = 0;
    }
    const canyonCenterNow = getCanyonCenterX(next.z, diff);
    const hwNow = getCanyonHalfWidth(next.z, diff);
    const maxOffset = hwNow * 0.72;
    if (Math.abs(next.x - canyonCenterNow) > maxOffset) {
      next.x = canyonCenterNow + Math.sign(next.x - canyonCenterNow) * maxOffset;
    }

    // Extra safety envelope push so Autoplay never clips any obstacle even during Hard extreme Mach turns
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      const clr = evaluateObstacleClearance(next.x, next.y, next.z, obs, 2.4, worldTime);
      if (clr < 1.2) {
        if (obs.kind === 'low-ridge') {
          next.y = Math.max(next.y, obs.y + obs.height + 4.5);
        } else if (obs.kind === 'overhang') {
          next.y = Math.min(next.y, Math.max(floorNow + 7, obs.y + obs.height - 4.5));
        } else if (obs.kind === 'arch' || obs.kind === 'broken-bridge') {
          next.y = Math.min(next.y, obs.y + obs.height - 5.0);
        } else {
          const liveObsX = obs.kind === 'dust-devil' ? getDustDevilX(obs, worldTime) : obs.x;
          const pushDir = next.x >= liveObsX ? 1 : -1;
          next.x += pushDir * (2.6 - clr);
        }
      }
    }

    return { state: next, events };
  }

  // --- Difficulty-Scaled Collision, Warning-Spark Scrape & Near-Miss Evaluation ---
  const solidCoreRadius = diff === 'hard' ? 1.38 : diff === 'medium' ? 1.24 : 1.15;
  const grazeMargin = 2.15 * diffCfg.scrapeForgiveness;
  const directCrashDepth = 1.1 * diffCfg.scrapeForgiveness;
  const terrainCrashPen = 2.2 * diffCfg.scrapeForgiveness;
  const nearMissBand = 7.8;

  // 1. Check terrain floor & canyon ramp edges
  const canyonCenterNow = getCanyonCenterX(next.z, diff);
  const groundCenter = getTerrainHeight(next.x, next.z, diff);
  const groundLeft = getTerrainHeight(next.x - 2.2, next.z, diff);
  const groundRight = getTerrainHeight(next.x + 2.2, next.z, diff);
  const groundWingMax = Math.max(groundCenter, groundLeft, groundRight);
  const terrainPenetration = groundWingMax - next.y;

  const isDirectTerrainCrash =
    terrainPenetration > terrainCrashPen ||
    (terrainPenetration > -0.15 && next.scrapeWarningTimer > 0 && next.scrapeCooldown <= 0);

  if (isDirectTerrainCrash) {
    next.crashed = true;
    next.crashReason = 'terrain';
    events.crashed = true;
    return { state: next, events };
  }

  // Slight brush against the sloping canyon ramp edge or valley floor -> warning spark + gentle push back
  if (terrainPenetration > -1.35 * diffCfg.scrapeForgiveness) {
    if (next.scrapeWarningTimer <= 0) {
      const pushDirX = next.x >= canyonCenterNow ? -1 : 1;
      next.y = Math.max(next.y, groundWingMax + 1.15);
      next.vy = Math.max(next.vy, 7.5);
      if (Math.abs(next.x - canyonCenterNow) > getCanyonHalfWidth(next.z, diff) * 0.65) {
        next.x += pushDirX * 1.2;
        next.vx = pushDirX * Math.max(14, Math.abs(next.vx) * 0.4);
      }
      next.scrapeCooldown = 0.28;
      next.scrapeWarningTimer = diffCfg.scrapeCooldownSec;
      events.scrape = { source: 'terrain' };
    }
  }

  // Measure proximity to canyon walls for rewarding Near Miss skims
  const wallProbeLeft = getTerrainHeight(next.x - 9.5, next.z, diff);
  const wallProbeRight = getTerrainHeight(next.x + 9.5, next.z, diff);
  const wallCloseLeft = wallProbeLeft > next.y - 1.5;
  const wallCloseRight = wallProbeRight > next.y - 1.5;
  const floorSkim = !events.scrape && next.y - groundCenter < 5.6;

  // 2. Check all nearby varied Martian obstacles & landmarks
  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];
    const solidClearance = evaluateObstacleClearance(
      next.x,
      next.y,
      next.z,
      obs,
      solidCoreRadius,
      worldTime,
    );

    // Direct solid core impact (much less forgiving on Hard!)
    if (solidClearance <= -directCrashDepth || (solidClearance <= 0 && next.scrapeWarningTimer > 0)) {
      next.crashed = true;
      next.crashReason = 'obstacle';
      events.crashed = true;
      return { state: next, events };
    }

    // Slight brush on obstacle edge -> warning spark + directional deflection
    if (solidClearance <= grazeMargin * 0.55) {
      if (obs.kind === 'low-ridge') {
        next.y = Math.max(next.y, obs.y + obs.height + 1.8);
        next.vy = Math.max(next.vy, 14);
      } else if (obs.kind === 'overhang') {
        next.y = Math.min(next.y, obs.y + obs.height - 1.8);
        next.vy = Math.min(next.vy, -12);
      } else {
        const obsRefX = obs.kind === 'dust-devil' ? getDustDevilX(obs, worldTime) : obs.x;
        const deflectDir = next.x >= obsRefX ? 1 : -1;
        next.x += deflectDir * 1.65;
        next.vx = deflectDir * Math.max(20, Math.abs(next.vx) * 0.5);
      }

      if (next.scrapeCooldown <= 0) {
        next.scrapeCooldown = 0.45;
        next.scrapeWarningTimer = diffCfg.scrapeCooldownSec;
        events.scrape = { source: 'obstacle' };
      }
      break;
    }

    // Exciting clean Near Miss skim!
    if (
      solidClearance > grazeMargin * 0.55 &&
      solidClearance <= nearMissBand &&
      Math.abs(next.z - obs.z) < obs.thickness + 14 &&
      !next.triggeredObstacleIds.includes(obs.id)
    ) {
      const updatedIds =
        next.triggeredObstacleIds.length > 24
          ? [...next.triggeredObstacleIds.slice(-16), obs.id]
          : [...next.triggeredObstacleIds, obs.id];
      next.triggeredObstacleIds = updatedIds;

      const bonusScore = Math.round(250 * next.mach * diffCfg.scoreRateMultiplier);
      const machGain = 0.24;
      next.nearMissCount += 1;
      next.score += bonusScore;
      next.nearMissMach = Math.min(0.65, next.nearMissMach + machGain);
      next.mach = next.baseMach + next.boostMach + next.nearMissMach + next.gateMach;
      if (next.mach > next.peakMach) next.peakMach = next.mach;
      next.boostCharge = Math.min(1, next.boostCharge + 0.24);
      next.wallNearMissCooldown = 1.1;

      events.nearMiss = {
        bonusScore,
        machGain,
        source: obs.kind,
      };
      break;
    }
  }

  // 3. Canyon wall / cliff skim Near Miss
  if (
    !events.nearMiss &&
    !events.scrape &&
    next.wallNearMissCooldown <= 0 &&
    (wallCloseLeft || wallCloseRight || floorSkim)
  ) {
    const bonusScore = Math.round(200 * next.mach * diffCfg.scoreRateMultiplier);
    const machGain = 0.18;
    next.nearMissCount += 1;
    next.score += bonusScore;
    next.nearMissMach = Math.min(0.65, next.nearMissMach + machGain);
    next.mach = next.baseMach + next.boostMach + next.nearMissMach + next.gateMach;
    if (next.mach > next.peakMach) next.peakMach = next.mach;
    next.boostCharge = Math.min(1, next.boostCharge + 0.2);
    next.wallNearMissCooldown = 1.45;

    events.nearMiss = {
      bonusScore,
      machGain,
      source: 'wall',
    };
  }

  return { state: next, events };
}
