import {
  CHUNK_LENGTH,
  getCanyonCenterX,
  getCanyonHalfWidth,
  getObstaclesForChunk,
  getTerrainHeight,
} from './terrainMath';
import type { CanyonObstacle, ControlInput } from './types';

export const MIN_ALTITUDE_OFFSET = 2.6;
export const MAX_ALTITUDE = 60;
export const START_MACH = 1.25;
export const WORLD_UNITS_PER_MACH = 105; // 1.0 Mach -> 105 world m/s for crisp canyon rush feel
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
  /** Cooldown protecting slight grazes from turning into instant crashes; if hit again rapidly -> crash */
  scrapeCooldown: number;
  scrapeWarningTimer: number;
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
  scrape: {
    source: 'terrain' | 'obstacle';
  } | null;
  milestoneMach: number | null;
  crashed: boolean;
  boostStarted: boolean;
}

export function createInitialFlightState(): FlightState {
  const startX = getCanyonCenterX(0);
  const startY = 20;
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
    scrapeCooldown: 0,
    scrapeWarningTimer: 0,
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
 * Returns signed clearance: <= 0 means touching/inside envelope, > 0 means meters of air clearance.
 */
export function evaluateObstacleClearance(
  px: number,
  py: number,
  pz: number,
  obs: CanyonObstacle,
  craftRadius: number,
): number {
  const dz = pz - obs.z;
  const maxReachZ = obs.radius + obs.thickness + 14;
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
    const archUndersideY = obs.y + obs.height * (1 - 0.3 * normX * normX);
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
 * Predictive smart Autoplay pilot that smoothly centers in the canyon, weaves around
 * upcoming spires/buttresses, threads through giant rock arches, banks gracefully,
 * and fires afterburners on clean straights to build high Mach speeds without crashing.
 */
export function computeAutoplayInput(
  state: FlightState,
  obstacles: CanyonObstacle[],
  isGameplayAutoplay: boolean,
): ControlInput {
  const speed = computeSpeedFromMach(state.mach);
  const lookAheadDist = Math.max(110, Math.min(240, speed * 0.92));
  const nearZ = state.z - lookAheadDist * 0.55;
  const farZ = state.z - lookAheadDist;

  // Blend canyon center between near & far lookahead for silky anticipation of curves
  const centerNear = getCanyonCenterX(nearZ);
  const centerFar = getCanyonCenterX(farZ);
  const canyonCenter = centerNear * 0.62 + centerFar * 0.38;
  const hw = getCanyonHalfWidth(nearZ);

  let targetX = canyonCenter + Math.sin(state.survivalSeconds * 0.38) * (isGameplayAutoplay ? 7.5 : 8.5);
  let targetY = 20 + Math.sin(state.survivalSeconds * 0.31) * 4.5;
  let clearAhead = true;

  // Inspect upcoming obstacles within the next 360m and steer smoothly around or under them
  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];
    const distAhead = state.z - obs.z; // positive when obstacle is ahead (-Z)
    if (distAhead < -12 || distAhead > 340) continue;

    const urgency = Math.max(0, Math.min(1, 1 - distAhead / 340));

    if (obs.kind === 'arch') {
      // Smoothly align right through the wide center beneath the rock arch crown
      targetX = targetX * (1 - urgency * 0.85) + obs.x * (urgency * 0.85);
      const safeUnderArchY = Math.min(obs.y + obs.height * 0.52, 24);
      targetY = targetY * (1 - urgency * 0.85) + Math.max(15, safeUnderArchY) * (urgency * 0.85);
    } else {
      // Spire or buttress: evaluate lateral clearance and smoothly weave around the safer wide side
      const safeRadius = obs.radius + 17;
      const dx = targetX - obs.x;
      if (Math.abs(dx) < safeRadius) {
        clearAhead = false;
        // Prefer weaving toward canyon center so we never push toward the outer cliff wall
        const preferRight = obs.x <= canyonCenter;
        const passX = obs.x + (preferRight ? safeRadius : -safeRadius);
        const clampedPassX = Math.max(canyonCenter - hw * 0.58, Math.min(canyonCenter + hw * 0.58, passX));
        targetX = targetX * (1 - urgency) + clampedPassX * urgency;
      }
    }
  }

  // Always keep targetX well inside the safe inner canyon corridor
  targetX = Math.max(canyonCenter - hw * 0.56, Math.min(canyonCenter + hw * 0.56, targetX));

  // Ensure safe altitude clearance over valley terrain ahead and beneath
  const groundHere = getTerrainHeight(state.x, state.z);
  const groundAhead = getTerrainHeight(targetX, nearZ);
  const minSafeY = Math.max(groundHere, groundAhead) + 14;
  targetY = Math.max(minSafeY, Math.min(36, targetY));

  const steerX = Math.max(-0.92, Math.min(0.92, (targetX - state.x) * 0.068 - state.vx * 0.0045));
  const steerY = Math.max(-0.75, Math.min(0.75, (targetY - state.y) * 0.095 - state.vy * 0.005));

  // In gameplay Autoplay, periodically fire Afterburner on clear stretches to reach thrilling high Mach!
  let boost = false;
  if (isGameplayAutoplay) {
    const wantsSurge = state.boostCharge > 0.55 || (state.isBoosting && state.boostCharge > 0.24);
    const aligned = Math.abs(targetX - state.x) < 16;
    boost = clearAhead && aligned && wantsSurge;
  }

  return { steerX, steerY, boost };
}

/**
 * Pure simulation step for Ares Mach.
 * Advances position, velocity, banking, Mach progression, boost fuel, forgiving grazes,
 * near-misses, solid-hit collisions, and optional smooth Autoplay piloting.
 */
export function stepFlightSimulation(
  prev: FlightState,
  input: ControlInput,
  rawDt: number,
  options?: {
    /** Title screen showcase cruise (invulnerable, steady Mach, no scoring) */
    autopilot?: boolean;
    /** Active gameplay one-click Autoplay mode (scores, builds high Mach, dodges cleanly) */
    gameplayAutoplay?: boolean;
    obstaclesOverride?: CanyonObstacle[];
  },
): { state: FlightState; events: FlightStepEvents } {
  const dt = Math.min(Math.max(rawDt, 0), MAX_DT);
  const events: FlightStepEvents = {
    nearMiss: null,
    scrape: null,
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

  const titleAutopilot = Boolean(options?.autopilot);
  const gameplayAutoplay = Boolean(options?.gameplayAutoplay) && !titleAutopilot;

  // Gather nearby obstacles up front (used for both smart Autoplay lookahead & collision checks)
  const chunkIdx = Math.max(0, Math.floor(-prev.z / CHUNK_LENGTH));
  const obstacles =
    options?.obstaclesOverride ?? [
      ...getObstaclesForChunk(chunkIdx),
      ...(chunkIdx > 0 ? getObstaclesForChunk(chunkIdx - 1) : []),
      ...getObstaclesForChunk(chunkIdx + 1),
      ...getObstaclesForChunk(chunkIdx + 2),
    ];

  // Determine effective steering
  let steerX = Math.max(-1, Math.min(1, input.steerX));
  let steerY = Math.max(-1, Math.min(1, input.steerY));
  let wantsBoost = input.boost;

  if (titleAutopilot || gameplayAutoplay) {
    const ai = computeAutoplayInput(prev, obstacles, gameplayAutoplay);
    steerX = ai.steerX;
    steerY = ai.steerY;
    wantsBoost = ai.boost;
  }

  // Afterburner fuel & surge logic
  if (next.boostLockout && next.boostCharge >= 0.2) {
    next.boostLockout = false;
  }
  const canBoost = wantsBoost && !next.boostLockout && next.boostCharge > 0.01;
  if (canBoost) {
    if (!prev.isBoosting) {
      events.boostStarted = true;
    }
    next.isBoosting = true;
    next.boostCharge = Math.max(0, next.boostCharge - dt * 0.30);
    if (next.boostCharge <= 0.005) {
      next.boostLockout = true;
      next.isBoosting = false;
    }
  } else {
    next.isBoosting = false;
    next.boostCharge = Math.min(1, next.boostCharge + dt * 0.16);
  }

  // Exciting starting speed with a smoother, more gradual difficulty/speed ramp
  if (!titleAutopilot) {
    next.survivalSeconds += dt;
    const accelRate = 0.0145 / (1 + Math.max(0, next.baseMach - START_MACH) * 0.24);
    next.baseMach += accelRate * dt;
  } else {
    next.survivalSeconds += dt;
    next.baseMach = 1.4;
  }

  // Smooth boost Mach & decaying Near-Miss surge
  const targetBoostMach = next.isBoosting ? 0.82 : 0;
  next.boostMach = damp(next.boostMach, targetBoostMach, next.isBoosting ? 5.2 : 3.0, dt);
  next.nearMissMach = damp(next.nearMissMach, 0, 1.35, dt);

  next.mach = next.baseMach + next.boostMach + next.nearMissMach;
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

  // Forward travel speed & responsive comfortable steering authority
  const forwardSpeed = computeSpeedFromMach(next.mach);
  const lateralAuthority = 62 + (next.mach - 1) * 15;
  const verticalAuthority = 40 + (next.mach - 1) * 8;

  const targetVx = steerX * lateralAuthority;
  const targetVy = steerY * verticalAuthority;

  next.vx = damp(next.vx, targetVx, 9.2, dt);
  next.vy = damp(next.vy, targetVy, 8.8, dt);

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
  const targetRoll = -steerX * 0.86 - (next.vx / lateralAuthority) * 0.14;
  const targetPitch = steerY * 0.4 + (next.vy / verticalAuthority) * 0.08;
  const targetYaw = -steerX * 0.15;

  next.roll = damp(next.roll, targetRoll, 9.5, dt);
  next.pitch = damp(next.pitch, targetPitch, 9.0, dt);
  next.yaw = damp(next.yaw, targetYaw, 8.0, dt);

  // Distance & score accumulation
  if (!titleAutopilot) {
    const dz = forwardSpeed * dt;
    next.distance += dz;
    next.score += dz * (0.42 * next.mach) * (next.isBoosting ? 1.35 : 1.0);
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

  // Title showcase and active Autoplay mode guarantee smooth, crash-free canyon carving
  if (titleAutopilot || gameplayAutoplay) {
    const floorNow = getTerrainHeight(next.x, next.z);
    if (next.y < floorNow + 10) {
      next.y = floorNow + 10;
      if (next.vy < 0) next.vy = 0;
    }
    const canyonCenterNow = getCanyonCenterX(next.z);
    const hwNow = getCanyonHalfWidth(next.z);
    const maxOffset = hwNow * 0.7;
    if (Math.abs(next.x - canyonCenterNow) > maxOffset) {
      next.x = canyonCenterNow + Math.sign(next.x - canyonCenterNow) * maxOffset;
    }
    return { state: next, events };
  }

  // --- Forgiving Collision, Warning-Spark Scrape & Near-Miss Evaluation ---
  // Smaller solid core radius (1.15m) + forgiving outer brush/graze zone (1.15m..3.25m)
  const solidCoreRadius = 1.15;
  const grazeMargin = 2.15; // slight brushes spark & deflect safely instead of instant crash!
  const nearMissBand = 7.8;

  // 1. Check terrain floor & canyon ramp edges
  const canyonCenterNow = getCanyonCenterX(next.z);
  const groundCenter = getTerrainHeight(next.x, next.z);
  const groundLeft = getTerrainHeight(next.x - 2.2, next.z);
  const groundRight = getTerrainHeight(next.x + 2.2, next.z);
  const groundWingMax = Math.max(groundCenter, groundLeft, groundRight);
  const terrainPenetration = groundWingMax - next.y;

  // Direct solid hit: slamming hard/deep into rock wall or diving solidly into the floor
  const isDirectTerrainCrash =
    terrainPenetration > 2.2 ||
    (terrainPenetration > 0.25 && next.scrapeWarningTimer > 0);

  if (isDirectTerrainCrash) {
    next.crashed = true;
    next.crashReason = 'terrain';
    events.crashed = true;
    return { state: next, events };
  }

  // Slight brush against the sloping canyon ramp edge or valley floor -> forgiving spark + gentle push back!
  if (terrainPenetration > -1.35) {
    const pushDirX = next.x >= canyonCenterNow ? -1 : 1;
    // Gently lift & nudge back toward the open canyon center
    next.y = Math.max(next.y, groundWingMax + 1.5);
    next.vy = Math.max(next.vy, 9.5);
    if (Math.abs(next.x - canyonCenterNow) > getCanyonHalfWidth(next.z) * 0.65) {
      next.x += pushDirX * 1.4;
      next.vx = pushDirX * Math.max(16, Math.abs(next.vx) * 0.45);
    }

    if (next.scrapeCooldown <= 0) {
      next.scrapeCooldown = 0.42;
      next.scrapeWarningTimer = 0.85;
      events.scrape = { source: 'terrain' };
    }
  }

  // Measure proximity to canyon walls for rewarding Near Miss skims
  const wallProbeLeft = getTerrainHeight(next.x - 9.5, next.z);
  const wallProbeRight = getTerrainHeight(next.x + 9.5, next.z);
  const wallCloseLeft = wallProbeLeft > next.y - 1.5;
  const wallCloseRight = wallProbeRight > next.y - 1.5;
  const floorSkim = !events.scrape && next.y - groundCenter < 5.6;

  // 2. Check nearby chunk obstacles (spires, giant rock arches, wall buttresses)
  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];
    const solidClearance = evaluateObstacleClearance(next.x, next.y, next.z, obs, solidCoreRadius);

    // Direct solid core impact (deep hit into rock or repeated hit during graze warning)
    if (solidClearance <= -1.1 || (solidClearance <= 0 && next.scrapeWarningTimer > 0)) {
      next.crashed = true;
      next.crashReason = 'obstacle';
      events.crashed = true;
      return { state: next, events };
    }

    // Slight brush on the rock edge -> forgiving warning spark + gentle deflection!
    if (solidClearance <= grazeMargin * 0.55) {
      const deflectDir = next.x >= obs.x ? 1 : -1;
      next.x += deflectDir * 1.65;
      next.vx = deflectDir * Math.max(20, Math.abs(next.vx) * 0.5);
      if (next.scrapeCooldown <= 0) {
        next.scrapeCooldown = 0.45;
        next.scrapeWarningTimer = 0.85;
        events.scrape = { source: 'obstacle' };
      }
      break;
    }

    // Exciting clean Near Miss skim!
    if (
      solidClearance > grazeMargin * 0.55 &&
      solidClearance <= nearMissBand &&
      Math.abs(next.z - obs.z) < obs.thickness + 12 &&
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

  // 3. Canyon wall / cliff skim Near Miss
  if (
    !events.nearMiss &&
    !events.scrape &&
    next.wallNearMissCooldown <= 0 &&
    (wallCloseLeft || wallCloseRight || floorSkim)
  ) {
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
