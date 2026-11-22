import {
  CHUNK_LENGTH,
  getCanyonCenterX,
  getObstaclesForChunk,
  getTerrainHeight,
} from './terrainMath';
import type { CanyonObstacle, ControlInput } from './types';

export const MIN_ALTITUDE_OFFSET = 2.6;
export const MAX_ALTITUDE = 58;
export const START_MACH = 1.15;
export const WORLD_UNITS_PER_MACH = 105; // 1.0 Mach -> 105 world m/s for intense canyon rush feel
export const MAX_DT = 0.05;

export interface FlightState {
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
  mach: number;
  peakMach: number;
  boostCharge: number; // 0..1
  isBoosting: boolean;
  boostLockout: boolean;
  survivalSeconds: number;
  distance: number;
  score: number;
  nearMissCount: number;
  lastMilestoneMach: number;
  wallNearMissCooldown: number;
  triggeredObstacleIds: string[];
  crashed: boolean;
  crashReason: 'terrain' | 'obstacle' | null;
}

export interface FlightStepEvents {
  nearMiss: {
    bonusScore: number;
    machGain: number;
    source: 'wall' | 'spire' | 'arch' | 'buttress';
  } | null;
  milestoneMach: number | null;
  crashed: boolean;
  boostStarted: boolean;
}

export function createInitialFlightState(): FlightState {
  const startX = getCanyonCenterX(0);
  const startY = 18;
  return {
    x: startX,
    y: startY,
    z: 0,
    vx: 0,
    vy: 0,
    roll: 0,
    pitch: 0,
    yaw: 0,
    baseMach: START_MACH,
    boostMach: 0,
    nearMissMach: 0,
    mach: START_MACH,
    peakMach: START_MACH,
    boostCharge: 1.0,
    isBoosting: false,
    boostLockout: false,
    survivalSeconds: 0,
    distance: 0,
    score: 0,
    nearMissCount: 0,
    lastMilestoneMach: 1.0,
    wallNearMissCooldown: 0,
    triggeredObstacleIds: [],
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
 * Evaluates closest distance from craft point (px, py, pz) to an obstacle's solid rock volume.
 * Returns signed clearance: <= 0 means impact, > 0 means meters of air clearance.
 */
export function evaluateObstacleClearance(
  px: number,
  py: number,
  pz: number,
  obs: CanyonObstacle,
  craftRadius: number,
): number {
  const dz = pz - obs.z;
  const maxReachZ = obs.radius + obs.thickness + 12;
  if (Math.abs(dz) > maxReachZ) return Infinity;

  if (obs.kind === 'spire' || obs.kind === 'buttress') {
    const relY = py - obs.y;
    if (relY > obs.height + craftRadius + 10) return Infinity;
    const hRatio = Math.max(0, Math.min(1, relY / Math.max(1, obs.height)));
    // Tapered jagged cone silhouette: wider at base, sharp peak at top
    const radiusAtY = obs.radius * (1 - hRatio * 0.72);
    const horizDist = Math.hypot(px - obs.x, dz);
    if (relY > obs.height) {
      return Math.hypot(Math.max(0, horizDist - radiusAtY), relY - obs.height) - craftRadius;
    }
    return horizDist - radiusAtY - craftRadius;
  }

  // Natural Rock Arch: rotated into arch local coordinates
  const cosY = Math.cos(-obs.yaw);
  const sinY = Math.sin(-obs.yaw);
  const dx = px - obs.x;
  const lx = dx * cosY - dz * sinY;
  const lz = dx * sinY + dz * cosY;

  const halfDepth = obs.thickness * 0.72;
  const zExcess = Math.max(0, Math.abs(lz) - halfDepth);

  // Two towering rock pillars at lx = +/- obs.radius
  const leftPillarDist = Math.hypot(Math.max(0, Math.abs(lx + obs.radius) - obs.thickness * 0.8), zExcess);
  const rightPillarDist = Math.hypot(Math.max(0, Math.abs(lx - obs.radius) - obs.thickness * 0.8), zExcess);
  const pillarClearance =
    py <= obs.y + obs.height + obs.thickness * 1.4
      ? Math.min(leftPillarDist, rightPillarDist) - craftRadius
      : Infinity;

  // Curved rock arch bridge span across the top (parabolic arch profile)
  let crownClearance = Infinity;
  if (Math.abs(lx) <= obs.radius + obs.thickness) {
    const normX = Math.min(1, Math.abs(lx) / Math.max(1, obs.radius));
    // Arch bottom rises smoothly in the middle, curves down into pillars
    const archUndersideY = obs.y + obs.height * (1 - 0.32 * normX * normX);
    const archTopY = archUndersideY + obs.thickness * 1.25;
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
 * Pure simulation step for Ares Mach.
 * Advances position, velocity, banking, Mach progression, boost fuel, collisions, and near-misses.
 */
export function stepFlightSimulation(
  prev: FlightState,
  input: ControlInput,
  rawDt: number,
  options?: { autopilot?: boolean; obstaclesOverride?: CanyonObstacle[] },
): { state: FlightState; events: FlightStepEvents } {
  const dt = Math.min(Math.max(rawDt, 0), MAX_DT);
  const events: FlightStepEvents = {
    nearMiss: null,
    milestoneMach: null,
    crashed: false,
    boostStarted: false,
  };

  if (prev.crashed || dt <= 0) {
    return { state: prev, events };
  }

  const next: FlightState = {
    ...prev,
    triggeredObstacleIds: prev.triggeredObstacleIds,
  };

  const autopilot = Boolean(options?.autopilot);

  // Determine effective steering
  let steerX = Math.max(-1, Math.min(1, input.steerX));
  let steerY = Math.max(-1, Math.min(1, input.steerY));
  let wantsBoost = input.boost;

  if (autopilot) {
    // Graceful title-screen canyon cruise following canyon center & gentle wave altitude
    const lookAheadZ = prev.z - 85;
    const targetX = getCanyonCenterX(lookAheadZ) + Math.sin(prev.survivalSeconds * 0.55) * 9;
    const floorAhead = getTerrainHeight(targetX, lookAheadZ);
    const targetY = Math.max(floorAhead + 15, 20 + Math.sin(prev.survivalSeconds * 0.4) * 5);
    steerX = Math.max(-0.85, Math.min(0.85, (targetX - prev.x) * 0.055));
    steerY = Math.max(-0.65, Math.min(0.65, (targetY - prev.y) * 0.08));
    wantsBoost = false;
  }

  // Afterburner fuel & surge logic
  if (next.boostLockout && next.boostCharge >= 0.22) {
    next.boostLockout = false;
  }
  const canBoost = wantsBoost && !next.boostLockout && next.boostCharge > 0.01;
  if (canBoost) {
    if (!prev.isBoosting) {
      events.boostStarted = true;
    }
    next.isBoosting = true;
    next.boostCharge = Math.max(0, next.boostCharge - dt * 0.34);
    if (next.boostCharge <= 0.005) {
      next.boostLockout = true;
      next.isBoosting = false;
    }
  } else {
    next.isBoosting = false;
    next.boostCharge = Math.min(1, next.boostCharge + dt * 0.14);
  }

  // Gradual passive Mach acceleration the longer you stay alive
  if (!autopilot) {
    next.survivalSeconds += dt;
    // Accelerates steadily: ~1.15 -> ~1.6 at 20s -> ~2.2 at 50s -> ~3.0+ at 95s -> keeps climbing
    const accelRate = 0.024 / (1 + Math.max(0, next.baseMach - 1.15) * 0.22);
    next.baseMach += accelRate * dt;
  } else {
    next.survivalSeconds += dt;
    next.baseMach = 1.35;
  }

  // Smooth boost Mach & decaying Near-Miss surge
  const targetBoostMach = next.isBoosting ? 0.78 : 0;
  next.boostMach = damp(next.boostMach, targetBoostMach, next.isBoosting ? 5.5 : 3.2, dt);
  next.nearMissMach = damp(next.nearMissMach, 0, 1.35, dt);

  next.mach = next.baseMach + next.boostMach + next.nearMissMach;
  if (!autopilot && next.mach > next.peakMach) {
    next.peakMach = next.mach;
  }

  // Check for supersonic milestone crossing (Mach 1.5, 2.0, 2.5, 3.0, 3.5, 4.0...)
  if (!autopilot) {
    const nextMilestone = Math.round((next.lastMilestoneMach + 0.5) * 10) / 10;
    if (next.mach >= nextMilestone) {
      next.lastMilestoneMach = Math.floor(next.mach * 2) / 2;
      events.milestoneMach = next.lastMilestoneMach;
    }
  }

  // Forward travel speed
  const forwardSpeed = computeSpeedFromMach(next.mach);
  const lateralAuthority = 56 + (next.mach - 1) * 14;
  const verticalAuthority = 38 + (next.mach - 1) * 8;

  const targetVx = steerX * lateralAuthority;
  const targetVy = steerY * verticalAuthority;

  // Fluid, snappy aerospace damping
  next.vx = damp(next.vx, targetVx, 8.8, dt);
  next.vy = damp(next.vy, targetVy, 8.5, dt);

  // Advance world coordinates (flying toward -Z)
  next.x += next.vx * dt;
  next.y += next.vy * dt;
  next.z -= forwardSpeed * dt;

  // Soft altitude ceiling so player stays inside the dramatic canyon walls
  if (next.y > MAX_ALTITUDE) {
    next.y = MAX_ALTITUDE;
    if (next.vy > 0) next.vy = 0;
  }

  // Natural supersonic banking & pitching into every turn
  const targetRoll = -steerX * 0.88 - (next.vx / lateralAuthority) * 0.14;
  const targetPitch = steerY * 0.42 + (next.vy / verticalAuthority) * 0.08;
  const targetYaw = -steerX * 0.16;

  next.roll = damp(next.roll, targetRoll, 9.5, dt);
  next.pitch = damp(next.pitch, targetPitch, 9.0, dt);
  next.yaw = damp(next.yaw, targetYaw, 8.0, dt);

  // Distance & score accumulation
  if (!autopilot) {
    const dz = forwardSpeed * dt;
    next.distance += dz;
    next.score += dz * (0.42 * next.mach) * (next.isBoosting ? 1.35 : 1.0);
  }

  if (next.wallNearMissCooldown > 0) {
    next.wallNearMissCooldown = Math.max(0, next.wallNearMissCooldown - dt);
  }

  // Autopilot stays invulnerable for the live title showcase
  if (autopilot) {
    const floorNow = getTerrainHeight(next.x, next.z);
    if (next.y < floorNow + 8) {
      next.y = floorNow + 8;
    }
    return { state: next, events };
  }

  // --- Collision & Near-Miss Evaluation ---
  const craftRadius = 1.65;
  const nearMissBand = 6.2;

  // 1. Check terrain directly under and immediately flanking the wings
  const groundCenter = getTerrainHeight(next.x, next.z);
  const groundLeft = getTerrainHeight(next.x - 2.6, next.z);
  const groundRight = getTerrainHeight(next.x + 2.6, next.z);
  const groundWingMax = Math.max(groundCenter, groundLeft, groundRight);

  if (next.y <= groundWingMax + 1.15) {
    next.crashed = true;
    next.crashReason = 'terrain';
    events.crashed = true;
    return { state: next, events };
  }

  // Also measure horizontal proximity to canyon walls left & right for wall-skimming Near Misses!
  const wallProbeLeft = getTerrainHeight(next.x - 8.5, next.z);
  const wallProbeRight = getTerrainHeight(next.x + 8.5, next.z);
  const wallCloseLeft = wallProbeLeft > next.y - 1.5;
  const wallCloseRight = wallProbeRight > next.y - 1.5;
  const floorSkim = next.y - groundCenter < 5.4;

  // 2. Check nearby chunk obstacles (spires, giant rock arches, wall buttresses)
  const chunkIdx = Math.max(0, Math.floor(-next.z / CHUNK_LENGTH));
  const obstacles =
    options?.obstaclesOverride ?? [
      ...getObstaclesForChunk(chunkIdx),
      ...(chunkIdx > 0 ? getObstaclesForChunk(chunkIdx - 1) : []),
      ...getObstaclesForChunk(chunkIdx + 1),
    ];

  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];
    const clearance = evaluateObstacleClearance(next.x, next.y, next.z, obs, craftRadius);

    if (clearance <= 0) {
      next.crashed = true;
      next.crashReason = 'obstacle';
      events.crashed = true;
      return { state: next, events };
    }

    if (
      clearance > 0 &&
      clearance <= nearMissBand &&
      Math.abs(next.z - obs.z) < obs.thickness + 10 &&
      !next.triggeredObstacleIds.includes(obs.id)
    ) {
      const updatedIds =
        next.triggeredObstacleIds.length > 24
          ? [...next.triggeredObstacleIds.slice(-16), obs.id]
          : [...next.triggeredObstacleIds, obs.id];
      next.triggeredObstacleIds = updatedIds;

      const bonusScore = Math.round(250 * next.mach);
      const machGain = 0.24;
      next.nearMissCount += 1;
      next.score += bonusScore;
      next.nearMissMach = Math.min(0.65, next.nearMissMach + machGain);
      next.mach = next.baseMach + next.boostMach + next.nearMissMach;
      if (next.mach > next.peakMach) next.peakMach = next.mach;
      next.boostCharge = Math.min(1, next.boostCharge + 0.26);
      next.wallNearMissCooldown = 1.1;

      events.nearMiss = {
        bonusScore,
        machGain,
        source: obs.kind,
      };
      break;
    }
  }

  // 3. Canyon wall / cliff skim Near Miss (when hugging towering cliffs or skimming valley floor at high speed)
  if (!events.nearMiss && next.wallNearMissCooldown <= 0 && (wallCloseLeft || wallCloseRight || floorSkim)) {
    const bonusScore = Math.round(200 * next.mach);
    const machGain = 0.18;
    next.nearMissCount += 1;
    next.score += bonusScore;
    next.nearMissMach = Math.min(0.65, next.nearMissMach + machGain);
    next.mach = next.baseMach + next.boostMach + next.nearMissMach;
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
