import {
  CHUNK_LENGTH,
  getCanyonCenterX,
  getCanyonHalfWidth,
  getDustDevilX,
  getObstaclesForChunk,
  getTerrainHeight,
  getZoneInfoAtZ,
} from './terrainMath';
import type {
  CanyonObstacle,
  ControlInput,
  MartianZoneId,
  MartianZoneInfo,
  ObstacleKind,
} from './types';

export const MIN_ALTITUDE_OFFSET = 2.6;
/** High ceiling so players can climb and soar cleanly OVER giant natural stone arches */
export const MAX_ALTITUDE = 76;
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
  currentZoneId: MartianZoneId;
  triggeredObstacleIds: string[];
  crashed: boolean;
  crashReason: 'terrain' | 'obstacle' | null;
}

export interface FlightStepEvents {
  nearMiss: {
    bonusScore: number;
    machGain: number;
    source: 'wall' | ObstacleKind;
  } | null;
  scrape: {
    source: 'terrain' | 'obstacle';
  } | null;
  milestoneMach: number | null;
  zoneChanged: MartianZoneInfo | null;
  crashed: boolean;
  boostStarted: boolean;
}

export function createInitialFlightState(): FlightState {
  const startX = getCanyonCenterX(0);
  const startY = 20.5;
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
    currentZoneId: getZoneInfoAtZ(0).id,
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
    // Funnel tapers narrower at ground, widens subtly toward top
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
    // Smooth elliptical box distance matching the towering central rock wedge
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
    // Tower leans laterally along X according to obs.yaw
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
    // Heavy central support stem
    const stemDist = Math.hypot(px - obs.x, dz) - 2.6;
    // Wide tilted photovoltaic wing panel (spans from y=9 to y=obs.height)
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
    // Cantilevered rock shelf anchored deep into `side` cliff wall and extending across valley
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

  // 8. Abandoned Colony Broken Bridge Span (twin piers + broken elevated viaduct deck with center gap)
  if (obs.kind === 'broken-bridge') {
    const halfDepth = obs.thickness * 1.05;
    const zExcess = Math.max(0, Math.abs(lz) - halfDepth);

    // Twin concrete/steel viaduct piers at +/- obs.radius
    const leftPier = Math.hypot(Math.max(0, Math.abs(lx + obs.radius) - 4.2), zExcess);
    const rightPier = Math.hypot(Math.max(0, Math.abs(lx - obs.radius) - 4.2), zExcess);
    const pierClearance =
      py <= obs.y + obs.height + obs.thickness + 4
        ? Math.min(leftPier, rightPier) - craftRadius
        : Infinity;

    // Broken elevated deck halves leaving a dramatic snapped gap in the middle (|lx| < 10.5)
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

  // Two towering rock pillars at lx = +/- obs.radius
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

  // Curved rock arch bridge span across the top (parabolic arch profile)
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
 * Predictive smart Autoplay pilot that smoothly centers in the canyon, weaves around
 * split pillars, leaning comm towers, tilted solar panels, and moving dust devils,
 * dives under overhanging cliffs and broken bridges, climbs over jagged low ridges,
 * threads giant stone arches (under or over), and fires afterburners on open stretches.
 */
export function computeAutoplayInput(
  state: FlightState,
  obstacles: CanyonObstacle[],
  isGameplayAutoplay: boolean,
  worldTime = 0,
): ControlInput {
  const speed = computeSpeedFromMach(state.mach);
  const lookAheadDist = Math.max(120, Math.min(265, speed * 0.96));
  const nearZ = state.z - lookAheadDist * 0.52;
  const farZ = state.z - lookAheadDist;

  // Blend canyon center between near & far lookahead for silky anticipation of curves
  const centerNear = getCanyonCenterX(nearZ);
  const centerFar = getCanyonCenterX(farZ);
  const canyonCenter = centerNear * 0.64 + centerFar * 0.36;
  const hw = getCanyonHalfWidth(nearZ);

  let targetX =
    canyonCenter + Math.sin(state.survivalSeconds * 0.36) * (isGameplayAutoplay ? 6.5 : 8.0);
  let targetY = 22 + Math.sin(state.survivalSeconds * 0.29) * 3.5;
  let clearAhead = true;

  // Sort upcoming obstacles so closer obstacles override farther ones cleanly
  const upcoming: { obs: CanyonObstacle; distAhead: number }[] = [];
  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];
    const distAhead = state.z - obs.z; // positive when ahead (-Z)
    if (distAhead < -18 || distAhead > 380) continue;
    upcoming.push({ obs, distAhead });
  }
  // Process farthest first so closest obstacle always gets final priority
  upcoming.sort((a, b) => b.distAhead - a.distAhead);

  for (let i = 0; i < upcoming.length; i++) {
    const { obs, distAhead } = upcoming[i];
    const clampedDist = Math.max(0, distAhead);
    const urgency = Math.max(0, Math.min(1, 1 - clampedDist / 340));
    const strongUrgency = Math.min(1, urgency * 1.35);
    const obsCenter = getCanyonCenterX(obs.z);
    const obsHw = getCanyonHalfWidth(obs.z);

    if (obs.kind === 'arch') {
      // Smoothly thread through the wide center under the arch (or glide over crown if already very high)
      targetX = targetX * (1 - strongUrgency) + obs.x * strongUrgency;
      const crownTop = obs.y + obs.height + obs.thickness * 1.25;
      if (state.y > crownTop + 4 && crownTop + 10 < MAX_ALTITUDE - 4) {
        const overY = crownTop + 10;
        targetY = targetY * (1 - strongUrgency) + overY * strongUrgency;
      } else {
        const underY = Math.max(15, Math.min(obs.y + obs.height * 0.5, 24));
        targetY = targetY * (1 - strongUrgency) + underY * strongUrgency;
      }
    } else if (obs.kind === 'split-pillar') {
      // Pick the left or right tunnel side decisively and hold a clean bank through it
      clearAhead = false;
      const side = state.x >= obs.x ? 1 : -1;
      const safeOffset = Math.min(obsHw * 0.64, obs.radius + 17.5);
      const tunnelX = obs.x + side * safeOffset;
      targetX = targetX * (1 - strongUrgency) + tunnelX * strongUrgency;
      targetY = targetY * (1 - urgency * 0.5) + 23 * (urgency * 0.5);
    } else if (obs.kind === 'overhang') {
      // Dive smoothly underneath the overhanging red cliff ledge
      clearAhead = false;
      const floorAtObs = getTerrainHeight(obsCenter, obs.z);
      const diveY = Math.max(floorAtObs + 9.5, obs.y + obs.height - 11.5);
      targetY = targetY * (1 - strongUrgency) + diveY * strongUrgency;
      // Also bias slightly away from the anchored canyon wall side
      const awayBias = -(obs.side ?? 1) * Math.min(14, obsHw * 0.22);
      targetX = targetX * (1 - urgency * 0.7) + (obsCenter + awayBias) * (urgency * 0.7);
    } else if (obs.kind === 'low-ridge') {
      // Climb cleanly high over the jagged ridge crest!
      clearAhead = false;
      const climbY = Math.min(MAX_ALTITUDE - 12, obs.y + obs.height + 12.5);
      targetY = targetY * (1 - strongUrgency) + climbY * strongUrgency;
    } else if (obs.kind === 'broken-bridge') {
      // Fly cleanly beneath the elevated broken viaduct span between its twin piers
      targetX = targetX * (1 - strongUrgency) + obs.x * strongUrgency;
      const floorAtObs = getTerrainHeight(obs.x, obs.z);
      const underBridgeY = Math.max(floorAtObs + 9.5, obs.y + obs.height - 11);
      targetY = targetY * (1 - strongUrgency) + underBridgeY * strongUrgency;
    } else if (obs.kind === 'dust-devil') {
      // Predict where the drifting red dust devil will be when the craft reaches obs.z!
      const timeToReach = clampedDist / Math.max(70, speed);
      const futureX = getDustDevilX(obs, worldTime + timeToReach);
      const safeRadius = obs.radius + 18;
      if (Math.abs(targetX - futureX) < safeRadius) {
        clearAhead = false;
        const preferRight = futureX <= obsCenter;
        const passX = futureX + (preferRight ? safeRadius : -safeRadius);
        const clampedPassX = Math.max(
          obsCenter - obsHw * 0.62,
          Math.min(obsCenter + obsHw * 0.62, passX),
        );
        targetX = targetX * (1 - strongUrgency) + clampedPassX * strongUrgency;
      }
    } else {
      // Spire, buttress, leaning comm-tower, or giant tilted solar-array
      const effectiveObsX =
        obs.kind === 'comm-tower'
          ? obs.x + Math.sin(obs.yaw) * Math.max(0, state.y - obs.y)
          : obs.x;
      const safeRadius = obs.radius + 17;
      if (Math.abs(targetX - effectiveObsX) < safeRadius) {
        clearAhead = false;
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

  // Keep targetX comfortably inside the safe inner canyon corridor
  targetX = Math.max(canyonCenter - hw * 0.62, Math.min(canyonCenter + hw * 0.62, targetX));

  // Ensure safe altitude clearance over valley terrain ahead and beneath
  const groundHere = getTerrainHeight(state.x, state.z);
  const groundAhead = getTerrainHeight(targetX, nearZ);
  const minSafeY = Math.max(groundHere, groundAhead) + 9.5;
  targetY = Math.max(minSafeY, Math.min(MAX_ALTITUDE - 10, targetY));

  const steerX = Math.max(-0.96, Math.min(0.96, (targetX - state.x) * 0.082 - state.vx * 0.0042));
  const steerY = Math.max(-0.92, Math.min(0.92, (targetY - state.y) * 0.135 - state.vy * 0.0055));

  // In gameplay Autoplay, periodically fire Afterburner on clear stretches to reach thrilling high Mach!
  let boost = false;
  if (isGameplayAutoplay) {
    const wantsSurge = state.boostCharge > 0.52 || (state.isBoosting && state.boostCharge > 0.22);
    const aligned = Math.abs(targetX - state.x) < 16 && Math.abs(targetY - state.y) < 10;
    boost = clearAhead && aligned && wantsSurge;
  }

  return { steerX, steerY, boost };
}

/**
 * Pure simulation step for Ares Mach.
 * Advances position, velocity, banking, Mach progression, boost fuel, Martian zone tracking,
 * forgiving grazes, near-misses, solid-hit collisions, and smooth Autoplay piloting.
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
    zoneChanged: null,
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
    const ai = computeAutoplayInput(prev, obstacles, gameplayAutoplay, prev.survivalSeconds);
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
  const lateralAuthority = 66 + (next.mach - 1) * 16;
  const verticalAuthority = 46 + (next.mach - 1) * 9;

  const targetVx = steerX * lateralAuthority;
  const targetVy = steerY * verticalAuthority;

  next.vx = damp(next.vx, targetVx, 9.6, dt);
  next.vy = damp(next.vy, targetVy, 9.4, dt);

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

  const worldTime = next.survivalSeconds;

  // Title showcase and active Autoplay mode guarantee smooth, crash-free canyon carving
  if (titleAutopilot || gameplayAutoplay) {
    const floorNow = getTerrainHeight(next.x, next.z);
    if (next.y < floorNow + 7.5) {
      next.y = floorNow + 7.5;
      if (next.vy < 0) next.vy = 0;
    }
    const canyonCenterNow = getCanyonCenterX(next.z);
    const hwNow = getCanyonHalfWidth(next.z);
    const maxOffset = hwNow * 0.72;
    if (Math.abs(next.x - canyonCenterNow) > maxOffset) {
      next.x = canyonCenterNow + Math.sign(next.x - canyonCenterNow) * maxOffset;
    }

    // Extra safety envelope push so Autoplay never clips any obstacle even during extreme Mach turns
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

  // --- Forgiving Collision, Warning-Spark Scrape & Near-Miss Evaluation ---
  const solidCoreRadius = 1.15;
  const grazeMargin = 2.15;
  const nearMissBand = 7.8;

  // 1. Check terrain floor & canyon ramp edges
  const canyonCenterNow = getCanyonCenterX(next.z);
  const groundCenter = getTerrainHeight(next.x, next.z);
  const groundLeft = getTerrainHeight(next.x - 2.2, next.z);
  const groundRight = getTerrainHeight(next.x + 2.2, next.z);
  const groundWingMax = Math.max(groundCenter, groundLeft, groundRight);
  const terrainPenetration = groundWingMax - next.y;

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

    // Direct solid core impact
    if (solidClearance <= -1.1 || (solidClearance <= 0 && next.scrapeWarningTimer > 0)) {
      next.crashed = true;
      next.crashReason = 'obstacle';
      events.crashed = true;
      return { state: next, events };
    }

    // Slight brush on obstacle edge -> forgiving warning spark + directional deflection!
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
        next.scrapeWarningTimer = 0.85;
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
