import type { CanyonObstacle, MartianZoneId, MartianZoneInfo, SpeedGate } from './types';

export const CHUNK_LENGTH = 340;
export const TERRAIN_WIDTH = 560;
export const SAFE_START_DISTANCE = 540;
/** 18 chunks * 340m = 6,120m (~30-40 seconds at Mach 1.5-1.9) per distinct Martian zone */
export const CHUNKS_PER_ZONE = 18;
export const ZONE_LENGTH = CHUNKS_PER_ZONE * CHUNK_LENGTH;

export const MARTIAN_ZONES: readonly MartianZoneInfo[] = [
  {
    id: 'plains',
    name: 'Wide Open Red Plains',
    subtitle: 'Sun-scorched ochre basins & drifting dust funnels',
  },
  {
    id: 'canyon',
    name: 'Deep Winding Slot Canyons',
    subtitle: 'Towering crimson walls, split tunnels & overhangs',
  },
  {
    id: 'colony',
    name: 'Abandoned Colony Valley',
    subtitle: 'Rusted comm towers, broken viaducts & solar arrays',
  },
  {
    id: 'volcanic',
    name: 'Jagged Volcanic Peaks',
    subtitle: 'Dark basalt ridges, caldera spires & ash vortices',
  },
] as const;

export interface ZoneBlendWeights {
  plains: number;
  canyon: number;
  colony: number;
  volcanic: number;
}

/** Deterministic hash in [0, 1) */
export function hash2D(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/** Deterministic 1D hash in [0, 1) */
export function hash1D(n: number): number {
  const v = Math.sin(n * 91.3458 + 17.13) * 47453.5453;
  return v - Math.floor(v);
}

/** Smooth 2D value noise in [0, 1] */
export function valueNoise2D(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;

  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash2D(ix, iz);
  const b = hash2D(ix + 1, iz);
  const c = hash2D(ix, iz + 1);
  const d = hash2D(ix + 1, iz + 1);

  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** 3-octave fractional Brownian motion in [0, 1] */
export function fbm2D(x: number, z: number): number {
  let value = 0;
  let amp = 0.52;
  let freq = 1;
  for (let i = 0; i < 3; i++) {
    value += amp * valueNoise2D(x * freq, z * freq);
    freq *= 2.07;
    amp *= 0.48;
  }
  return value;
}

/** Ridged noise in [0, 1] for jagged Martian mountain crags */
export function ridgedNoise2D(x: number, z: number): number {
  let value = 0;
  let amp = 0.58;
  let freq = 1;
  for (let i = 0; i < 3; i++) {
    const n = valueNoise2D(x * freq + 19.3 * i, z * freq - 11.7 * i);
    const ridge = 1 - Math.abs(n * 2 - 1);
    value += amp * ridge * ridge;
    freq *= 2.13;
    amp *= 0.46;
  }
  return value;
}

/** Smoothstep helper */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Returns the active Martian Zone metadata for a given world Z (flight moves toward -Z). */
export function getZoneInfoAtZ(z: number): MartianZoneInfo {
  const dist = Math.max(0, -z);
  const zoneIdx = Math.floor(dist / ZONE_LENGTH) % MARTIAN_ZONES.length;
  return MARTIAN_ZONES[zoneIdx];
}

export function getZoneIdAtChunk(chunkIndex: number): MartianZoneId {
  const safeIdx = Math.max(0, chunkIndex);
  const zoneIdx = Math.floor(safeIdx / CHUNKS_PER_ZONE) % MARTIAN_ZONES.length;
  return MARTIAN_ZONES[zoneIdx].id;
}

/**
 * Smoothly blends between adjacent Martian zones over a 900m transition window
 * so canyon width, mountain silhouette, and palette morph seamlessly with zero seams.
 */
export function getZoneWeightsAtZ(z: number): ZoneBlendWeights {
  const dist = Math.max(0, -z);
  const exactZone = dist / ZONE_LENGTH;
  const idx = Math.floor(exactZone) % MARTIAN_ZONES.length;
  const nextIdx = (idx + 1) % MARTIAN_ZONES.length;
  const localDist = dist - Math.floor(exactZone) * ZONE_LENGTH;

  const transitionSpan = 900;
  const blend = smoothstep(ZONE_LENGTH - transitionSpan, ZONE_LENGTH, localDist);

  const weights: ZoneBlendWeights = {
    plains: 0,
    canyon: 0,
    colony: 0,
    volcanic: 0,
  };
  weights[MARTIAN_ZONES[idx].id] += 1 - blend;
  weights[MARTIAN_ZONES[nextIdx].id] += blend;
  return weights;
}

/**
 * Center X coordinate of the Martian flight route at world Z (moves toward -Z).
 * Sweeps gently on Open Plains / Colony Valley, winds more dramatically in Slot Canyons.
 */
export function getCanyonCenterX(z: number): number {
  const dist = Math.max(0, -z);
  const ramp = smoothstep(SAFE_START_DISTANCE * 0.72, SAFE_START_DISTANCE * 1.8, dist);
  const w = getZoneWeightsAtZ(z);
  const curveScale =
    w.plains * 0.72 + w.canyon * 1.24 + w.colony * 0.85 + w.volcanic * 1.05;

  const curve =
    Math.sin(dist * 0.0012) * 48 +
    Math.sin(dist * 0.0024 + 1.1) * 18 +
    Math.cos(dist * 0.0007 - 0.4) * 24;
  return curve * ramp * curveScale;
}

/**
 * Generously wide flyable corridor half-width adapted per Martian zone:
 * - Wide Open Red Plains: ~82m half-width (164m wide open basin!)
 * - Deep Winding Slot Canyons: ~56m half-width (112m dramatic canyon corridor)
 * - Abandoned Colony Valley: ~72m half-width (144m settlement basin)
 * - Jagged Volcanic Peaks: ~62m half-width (124m volcanic valley)
 */
export function getCanyonHalfWidth(z: number): number {
  const dist = Math.max(0, -z);
  const w = getZoneWeightsAtZ(z);
  const baseWidth =
    w.plains * 82 + w.canyon * 56 + w.colony * 72 + w.volcanic * 62;

  const gentleTighten = Math.min(7, dist * 0.00014);
  const organicBreath = Math.sin(dist * 0.0038 + 0.4) * 4.5;
  return Math.max(48, baseWidth - gentleTighten + organicBreath);
}

/** Smoothly rolling dusty Martian floor elevation */
export function getValleyFloorHeight(x: number, z: number): number {
  const dist = Math.max(0, -z);
  const w = getZoneWeightsAtZ(z);
  const duneAmp = w.plains * 3.4 + w.canyon * 2.4 + w.colony * 2.2 + w.volcanic * 3.6;
  const dune = (fbm2D(x * 0.014, z * 0.014) - 0.5) * duneAmp;
  const swell = Math.sin(dist * 0.0032) * 1.8;
  return 1.5 + dune + swell;
}

/**
 * Shared exact terrain height function at world (x, z).
 * Adapts smoothly across all 4 Martian zones (broad low-rim mesas on Red Plains,
 * steep towering walls in Slot Canyons, terraced colony valley, jagged volcanic peaks).
 */
export function getTerrainHeight(x: number, z: number): number {
  const centerX = getCanyonCenterX(z);
  const halfWidth = getCanyonHalfWidth(z);
  const dx = Math.abs(x - centerX);

  const floorY = getValleyFloorHeight(x, z);

  // Generous wide valley floor before flanking terrain rises
  const wallT = smoothstep(halfWidth * 0.78, halfWidth * 1.48, dx);
  if (wallT <= 0.0001) {
    return floorY;
  }

  const w = getZoneWeightsAtZ(z);
  const outerT = smoothstep(halfWidth * 1.15, halfWidth * 2.5, dx);
  const ridge = ridgedNoise2D(x * 0.011, z * 0.011);
  const detail = fbm2D(x * 0.032, z * 0.032);

  // Zone-specific mountain/cliff scale
  const cliffScale =
    w.plains * 0.68 + w.canyon * 1.28 + w.colony * 0.88 + w.volcanic * 1.32;
  const jaggedBoost = w.volcanic * 32 * ridge * ridge + w.canyon * 16 * ridge;

  const rawCliff =
    (wallT * (48 + ridge * 56) + outerT * (38 + ridge * 52) + jaggedBoost) * cliffScale +
    detail * 10 * wallT;

  // Realistic sedimentary terracing (stronger in Slot Canyons & Plains, sharper crags in Volcanic)
  const terraceWeight = w.plains * 0.45 + w.canyon * 0.52 + w.colony * 0.4 + w.volcanic * 0.16;
  const terraceStep = 14;
  const terraced =
    Math.floor(rawCliff / terraceStep) * terraceStep +
    smoothstep(0.18, 0.85, (rawCliff % terraceStep) / terraceStep) * terraceStep;

  const cliffHeight = rawCliff * (1 - terraceWeight) + terraced * terraceWeight;
  return floorY + cliffHeight;
}

/** Computes live sideways X coordinate of a drifting Martian dust devil at simulation time t */
export function getDustDevilX(obs: CanyonObstacle, worldTime: number): number {
  const amp = obs.driftAmp ?? 0;
  const speed = obs.driftSpeed ?? 0;
  const phase = obs.driftPhase ?? 0;
  return obs.x + Math.sin(worldTime * speed + phase) * amp;
}

/**
 * Returns true if a chunk is an intentional open-sky breather stretch (~4 seconds of clear sky
 * between intense obstacle clusters, plus right at zone entrances so transitions breathe naturally).
 */
export function isBreatherChunk(chunkIndex: number): boolean {
  if (chunkIndex < 3) return false;
  const posInZone = chunkIndex % CHUNKS_PER_ZONE;
  // Breather stretch on zone transitions (pos 0 & 17 -> ~680m ≈ 4s clear sky!) and every 4th-5th chunk inside a zone
  return posInZone === 0 || posInZone === 4 || posInZone === 9 || posInZone === 14;
}

/**
 * Deterministic handcrafted Martian landmarks & varied obstacles per 340m chunk.
 * Tailored to each of the 4 Martian zones with breathing stretches between intense clusters.
 */
export function getObstaclesForChunk(chunkIndex: number): CanyonObstacle[] {
  if (chunkIndex < 0) return [];
  const obstacles: CanyonObstacle[] = [];
  const zStart = -chunkIndex * CHUNK_LENGTH;

  // --- Opening Showcase Sequence (Chunks 0..2): Immediate excitement & variety right from launch! ---
  if (chunkIndex === 0) {
    // Iconic Giant Natural Stone Arch you can fly under OR climb over, plus a rusted colony comm tower on the flank
    const archZ = -235;
    const cx = getCanyonCenterX(archZ);
    const hw = getCanyonHalfWidth(archZ);
    obstacles.push({
      id: 'arch-0',
      kind: 'arch',
      x: cx,
      y: getValleyFloorHeight(cx, archZ) - 2,
      z: archZ,
      radius: 48,
      height: 44,
      thickness: 8.2,
      yaw: 0.04,
      tint: 0.45,
    });
    const towerZ = -135;
    const tcx = getCanyonCenterX(towerZ);
    obstacles.push({
      id: 'comm-0',
      kind: 'comm-tower',
      x: tcx + hw * 0.52,
      y: getValleyFloorHeight(tcx + hw * 0.52, towerZ) - 1,
      z: towerZ,
      radius: 4.4,
      height: 56,
      thickness: 4.4,
      yaw: -0.22,
      tint: 0.6,
      side: 1,
    });
    return obstacles;
  }

  if (chunkIndex === 1) {
    // Low jagged ridge (climb high!) + giant tilted solar array + drifting red dust devil
    const ridgeZ = zStart - 135;
    const rcx = getCanyonCenterX(ridgeZ);
    const rhw = getCanyonHalfWidth(ridgeZ);
    obstacles.push({
      id: 'ridge-1',
      kind: 'low-ridge',
      x: rcx,
      y: getValleyFloorHeight(rcx, ridgeZ) - 2,
      z: ridgeZ,
      radius: rhw * 0.85,
      height: 15.5,
      thickness: 14,
      yaw: 0.06,
      tint: 0.55,
    });

    const solarZ = zStart - 275;
    const scx = getCanyonCenterX(solarZ);
    const shw = getCanyonHalfWidth(solarZ);
    obstacles.push({
      id: 'solar-1',
      kind: 'solar-array',
      x: scx - shw * 0.42,
      y: getValleyFloorHeight(scx - shw * 0.42, solarZ) - 1,
      z: solarZ,
      radius: 13,
      height: 28,
      thickness: 3.5,
      yaw: 0.32,
      tint: 0.4,
      side: -1,
    });
    return obstacles;
  }

  if (chunkIndex === 2) {
    // Split Canyon Path (massive central pillar: pick left or right!) + drifting red dust devil
    const splitZ = zStart - 120;
    const scx = getCanyonCenterX(splitZ);
    obstacles.push({
      id: 'split-2',
      kind: 'split-pillar',
      x: scx,
      y: getValleyFloorHeight(scx, splitZ) - 3,
      z: splitZ,
      radius: 14.5,
      height: 82,
      thickness: 17,
      yaw: 0.2,
      tint: 0.5,
    });

    const devilZ = zStart - 275;
    const dcx = getCanyonCenterX(devilZ);
    const dhw = getCanyonHalfWidth(devilZ);
    obstacles.push({
      id: 'devil-2',
      kind: 'dust-devil',
      x: dcx,
      y: getValleyFloorHeight(dcx, devilZ) - 1,
      z: devilZ,
      radius: 7.5,
      height: 68,
      thickness: 7.5,
      yaw: 0,
      tint: 0.7,
      driftAmp: Math.min(34, dhw * 0.46),
      driftSpeed: 0.58,
      driftPhase: 0.7,
    });
    return obstacles;
  }

  // Open-sky breather stretches between clusters (~4 seconds of scenic clear sky!)
  if (isBreatherChunk(chunkIndex)) {
    return [];
  }

  const zoneId = getZoneIdAtChunk(chunkIndex);
  const seedBase = chunkIndex * 43.17;
  const pattern = chunkIndex % 4;

  // Helper to place an obstacle cleanly at chunk fraction
  const zAt = (frac: number) => zStart - frac * CHUNK_LENGTH;

  if (zoneId === 'plains') {
    // WIDE OPEN RED PLAINS: arches (under/over), low jagged ridges (climb high), dust devils, occasional tilted solar panel
    if (pattern === 1) {
      const z1 = zAt(0.38);
      const cx1 = getCanyonCenterX(z1);
      obstacles.push({
        id: `arch-${chunkIndex}`,
        kind: 'arch',
        x: cx1,
        y: getValleyFloorHeight(cx1, z1) - 2,
        z: z1,
        radius: 50,
        height: 40 + hash1D(seedBase + 1) * 8,
        thickness: 8.5,
        yaw: (hash1D(seedBase + 2) - 0.5) * 0.2,
        tint: hash1D(seedBase + 3),
      });

      const z2 = zAt(0.82);
      const cx2 = getCanyonCenterX(z2);
      const hw2 = getCanyonHalfWidth(z2);
      obstacles.push({
        id: `devil-${chunkIndex}`,
        kind: 'dust-devil',
        x: cx2,
        y: getValleyFloorHeight(cx2, z2) - 1,
        z: z2,
        radius: 7.8,
        height: 70,
        thickness: 7.8,
        yaw: 0,
        tint: 0.65,
        driftAmp: Math.min(38, hw2 * 0.46),
        driftSpeed: 0.52 + hash1D(seedBase + 4) * 0.25,
        driftPhase: hash1D(seedBase + 5) * Math.PI * 2,
      });
    } else if (pattern === 2) {
      const z1 = zAt(0.42);
      const cx1 = getCanyonCenterX(z1);
      const hw1 = getCanyonHalfWidth(z1);
      obstacles.push({
        id: `ridge-${chunkIndex}`,
        kind: 'low-ridge',
        x: cx1,
        y: getValleyFloorHeight(cx1, z1) - 2,
        z: z1,
        radius: hw1 * 0.84,
        height: 18 + hash1D(seedBase + 6) * 5,
        thickness: 14,
        yaw: (hash1D(seedBase + 7) - 0.5) * 0.16,
        tint: hash1D(seedBase + 8),
      });

      const z2 = zAt(0.84);
      const cx2 = getCanyonCenterX(z2);
      const hw2 = getCanyonHalfWidth(z2);
      const side: -1 | 1 = chunkIndex % 2 === 0 ? 1 : -1;
      obstacles.push({
        id: `solar-${chunkIndex}`,
        kind: 'solar-array',
        x: cx2 + side * hw2 * 0.36,
        y: getValleyFloorHeight(cx2 + side * hw2 * 0.36, z2) - 1,
        z: z2,
        radius: 13.5,
        height: 30,
        thickness: 3.6,
        yaw: side * 0.36,
        tint: hash1D(seedBase + 9),
        side,
      });
    } else {
      const z1 = zAt(0.36);
      const cx1 = getCanyonCenterX(z1);
      obstacles.push({
        id: `split-${chunkIndex}`,
        kind: 'split-pillar',
        x: cx1,
        y: getValleyFloorHeight(cx1, z1) - 3,
        z: z1,
        radius: 14 + hash1D(seedBase + 10) * 3,
        height: 78,
        thickness: 16,
        yaw: hash1D(seedBase + 11) * Math.PI,
        tint: hash1D(seedBase + 12),
      });

      const z2 = zAt(0.8);
      const cx2 = getCanyonCenterX(z2);
      const hw2 = getCanyonHalfWidth(z2);
      const side: -1 | 1 = hash1D(seedBase + 13) > 0.5 ? 1 : -1;
      obstacles.push({
        id: `comm-${chunkIndex}`,
        kind: 'comm-tower',
        x: cx2 + side * hw2 * 0.45,
        y: getValleyFloorHeight(cx2 + side * hw2 * 0.45, z2) - 1,
        z: z2,
        radius: 4.5,
        height: 58,
        thickness: 4.5,
        yaw: -side * 0.24,
        tint: 0.5,
        side,
      });
    }
    return obstacles;
  }

  if (zoneId === 'canyon') {
    // DEEP WINDING SLOT CANYONS: overhanging cliff ledges (dive low!), split canyon pillars, giant stone arches
    if (pattern === 1) {
      const z1 = zAt(0.4);
      const cx1 = getCanyonCenterX(z1);
      const hw1 = getCanyonHalfWidth(z1);
      const side: -1 | 1 = chunkIndex % 2 === 0 ? -1 : 1;
      obstacles.push({
        id: `overhang-${chunkIndex}`,
        kind: 'overhang',
        x: cx1,
        y: getValleyFloorHeight(cx1, z1),
        z: z1,
        radius: hw1 * 0.92,
        height: 29 + hash1D(seedBase + 1) * 5, // Clearance underside: dive below ~29-34m!
        thickness: 22,
        yaw: (hash1D(seedBase + 2) - 0.5) * 0.14,
        tint: hash1D(seedBase + 3),
        side,
      });

      const z2 = zAt(0.84);
      const cx2 = getCanyonCenterX(z2);
      obstacles.push({
        id: `split-${chunkIndex}`,
        kind: 'split-pillar',
        x: cx2,
        y: getValleyFloorHeight(cx2, z2) - 3,
        z: z2,
        radius: 13.5,
        height: 88,
        thickness: 16,
        yaw: hash1D(seedBase + 4) * Math.PI,
        tint: hash1D(seedBase + 5),
      });
    } else if (pattern === 2) {
      const z1 = zAt(0.36);
      const cx1 = getCanyonCenterX(z1);
      const hw1 = getCanyonHalfWidth(z1);
      obstacles.push({
        id: `arch-${chunkIndex}`,
        kind: 'arch',
        x: cx1,
        y: getValleyFloorHeight(cx1, z1) - 2,
        z: z1,
        radius: Math.max(36, hw1 * 0.78),
        height: 38 + hash1D(seedBase + 6) * 8,
        thickness: 8.5,
        yaw: (hash1D(seedBase + 7) - 0.5) * 0.2,
        tint: hash1D(seedBase + 8),
      });

      const z2 = zAt(0.82);
      const cx2 = getCanyonCenterX(z2);
      const hw2 = getCanyonHalfWidth(z2);
      obstacles.push({
        id: `ridge-${chunkIndex}`,
        kind: 'low-ridge',
        x: cx2,
        y: getValleyFloorHeight(cx2, z2) - 2,
        z: z2,
        radius: hw2 * 0.88,
        height: 20,
        thickness: 14,
        yaw: 0.05,
        tint: hash1D(seedBase + 9),
      });
    } else {
      const z1 = zAt(0.45);
      const cx1 = getCanyonCenterX(z1);
      const hw1 = getCanyonHalfWidth(z1);
      const side: -1 | 1 = hash1D(seedBase + 10) > 0.5 ? 1 : -1;
      obstacles.push({
        id: `overhang-${chunkIndex}`,
        kind: 'overhang',
        x: cx1,
        y: getValleyFloorHeight(cx1, z1),
        z: z1,
        radius: hw1 * 0.9,
        height: 30,
        thickness: 22,
        yaw: 0,
        tint: hash1D(seedBase + 11),
        side,
      });
    }
    return obstacles;
  }

  if (zoneId === 'colony') {
    // ABANDONED COLONY VALLEY: broken bridge spans, leaning rusted comm towers, giant tilted solar panels, drifting dust devils
    if (pattern === 1) {
      const z1 = zAt(0.38);
      const cx1 = getCanyonCenterX(z1);
      const hw1 = getCanyonHalfWidth(z1);
      obstacles.push({
        id: `bridge-${chunkIndex}`,
        kind: 'broken-bridge',
        x: cx1,
        y: getValleyFloorHeight(cx1, z1) - 1,
        z: z1,
        radius: Math.max(40, hw1 * 0.72),
        height: 33 + hash1D(seedBase + 1) * 5,
        thickness: 5.5,
        yaw: (hash1D(seedBase + 2) - 0.5) * 0.14,
        tint: hash1D(seedBase + 3),
      });

      const z2 = zAt(0.82);
      const cx2 = getCanyonCenterX(z2);
      const hw2 = getCanyonHalfWidth(z2);
      const side: -1 | 1 = chunkIndex % 2 === 0 ? 1 : -1;
      obstacles.push({
        id: `comm-${chunkIndex}`,
        kind: 'comm-tower',
        x: cx2 + side * hw2 * 0.28,
        y: getValleyFloorHeight(cx2 + side * hw2 * 0.28, z2) - 1,
        z: z2,
        radius: 4.8,
        height: 62,
        thickness: 4.8,
        yaw: -side * 0.26,
        tint: hash1D(seedBase + 4),
        side,
      });
    } else if (pattern === 2) {
      const z1 = zAt(0.35);
      const cx1 = getCanyonCenterX(z1);
      const hw1 = getCanyonHalfWidth(z1);
      obstacles.push({
        id: `solar-${chunkIndex}-a`,
        kind: 'solar-array',
        x: cx1 - hw1 * 0.34,
        y: getValleyFloorHeight(cx1 - hw1 * 0.34, z1) - 1,
        z: z1,
        radius: 14,
        height: 30,
        thickness: 3.6,
        yaw: 0.34,
        tint: 0.35,
        side: -1,
      });

      const z2 = zAt(0.76);
      const cx2 = getCanyonCenterX(z2);
      const hw2 = getCanyonHalfWidth(z2);
      obstacles.push({
        id: `solar-${chunkIndex}-b`,
        kind: 'solar-array',
        x: cx2 + hw2 * 0.34,
        y: getValleyFloorHeight(cx2 + hw2 * 0.34, z2) - 1,
        z: z2,
        radius: 14,
        height: 30,
        thickness: 3.6,
        yaw: -0.34,
        tint: 0.65,
        side: 1,
      });
    } else {
      const z1 = zAt(0.36);
      const cx1 = getCanyonCenterX(z1);
      const hw1 = getCanyonHalfWidth(z1);
      obstacles.push({
        id: `comm-${chunkIndex}`,
        kind: 'comm-tower',
        x: cx1 - hw1 * 0.22,
        y: getValleyFloorHeight(cx1 - hw1 * 0.22, z1) - 1,
        z: z1,
        radius: 4.8,
        height: 60,
        thickness: 4.8,
        yaw: 0.24,
        tint: 0.55,
        side: -1,
      });

      const z2 = zAt(0.8);
      const cx2 = getCanyonCenterX(z2);
      const hw2 = getCanyonHalfWidth(z2);
      obstacles.push({
        id: `devil-${chunkIndex}`,
        kind: 'dust-devil',
        x: cx2,
        y: getValleyFloorHeight(cx2, z2) - 1,
        z: z2,
        radius: 7.6,
        height: 68,
        thickness: 7.6,
        yaw: 0,
        tint: 0.72,
        driftAmp: Math.min(34, hw2 * 0.44),
        driftSpeed: 0.62,
        driftPhase: hash1D(seedBase + 10) * Math.PI * 2,
      });
    }
    return obstacles;
  }

  // JAGGED VOLCANIC PEAKS: dramatic volcanic spires, split caldera pillars, low jagged basalt ridges, overhangs, swirling ash devils
  if (pattern === 1) {
    const z1 = zAt(0.36);
    const cx1 = getCanyonCenterX(z1);
    const hw1 = getCanyonHalfWidth(z1);
    obstacles.push({
      id: `ridge-${chunkIndex}`,
      kind: 'low-ridge',
      x: cx1,
      y: getValleyFloorHeight(cx1, z1) - 2,
      z: z1,
      radius: hw1 * 0.88,
      height: 21,
      thickness: 15,
      yaw: 0.08,
      tint: 0.2,
    });

    const z2 = zAt(0.8);
    const cx2 = getCanyonCenterX(z2);
    const hw2 = getCanyonHalfWidth(z2);
    obstacles.push({
      id: `overhang-${chunkIndex}`,
      kind: 'overhang',
      x: cx2,
      y: getValleyFloorHeight(cx2, z2),
      z: z2,
      radius: hw2 * 0.88,
      height: 31,
      thickness: 22,
      yaw: -0.06,
      tint: 0.15,
      side: chunkIndex % 2 === 0 ? 1 : -1,
    });
  } else if (pattern === 2) {
    const z1 = zAt(0.38);
    const cx1 = getCanyonCenterX(z1);
    obstacles.push({
      id: `split-${chunkIndex}`,
      kind: 'split-pillar',
      x: cx1,
      y: getValleyFloorHeight(cx1, z1) - 3,
      z: z1,
      radius: 14.5,
      height: 92,
      thickness: 17,
      yaw: hash1D(seedBase + 2) * Math.PI,
      tint: 0.18,
    });

    const z2 = zAt(0.84);
    const cx2 = getCanyonCenterX(z2);
    const hw2 = getCanyonHalfWidth(z2);
    obstacles.push({
      id: `devil-${chunkIndex}`,
      kind: 'dust-devil',
      x: cx2,
      y: getValleyFloorHeight(cx2, z2) - 1,
      z: z2,
      radius: 8.2,
      height: 76,
      thickness: 8.2,
      yaw: 0,
      tint: 0.35,
      driftAmp: Math.min(30, hw2 * 0.44),
      driftSpeed: 0.68,
      driftPhase: hash1D(seedBase + 3) * Math.PI * 2,
    });
  } else {
    const z1 = zAt(0.38);
    const cx1 = getCanyonCenterX(z1);
    const hw1 = getCanyonHalfWidth(z1);
    obstacles.push({
      id: `arch-${chunkIndex}`,
      kind: 'arch',
      x: cx1,
      y: getValleyFloorHeight(cx1, z1) - 2,
      z: z1,
      radius: Math.max(38, hw1 * 0.78),
      height: 40,
      thickness: 8.8,
      yaw: 0.12,
      tint: 0.15,
    });

    const z2 = zAt(0.82);
    const cx2 = getCanyonCenterX(z2);
    const hw2 = getCanyonHalfWidth(z2);
    const side: -1 | 1 = chunkIndex % 2 === 0 ? 1 : -1;
    obstacles.push({
      id: `spire-${chunkIndex}`,
      kind: 'spire',
      x: cx2 + side * hw2 * 0.38,
      y: getValleyFloorHeight(cx2 + side * hw2 * 0.38, z2) - 3,
      z: z2,
      radius: 11,
      height: 82,
      thickness: 11,
      yaw: hash1D(seedBase + 6) * Math.PI * 2,
      tint: 0.2,
    });
  }

  return obstacles;
}

/**
 * Generates safe, risk-vs-reward Glowing Speed Gates for a 340m chunk.
 * Places 'flow' gates comfortably along the canyon rhythm and higher-reward 'bonus' gates
 * framed beneath giant stone arches, inside split canyon tunnels, along outer curves, or
 * hovering at inviting high/low altitudes — always strictly clear of terrain & solid rock.
 */
export function getSpeedGatesForChunk(chunkIndex: number): SpeedGate[] {
  if (chunkIndex < 0) return [];
  const gates: SpeedGate[] = [];
  const zStart = -chunkIndex * CHUNK_LENGTH;
  const obstacles = getObstaclesForChunk(chunkIndex);

  const clampSafeGate = (
    id: string,
    rawX: number,
    rawY: number,
    z: number,
    radius: number,
    tier: 'flow' | 'bonus',
  ): SpeedGate => {
    const cx = getCanyonCenterX(z);
    const hw = getCanyonHalfWidth(z);
    // Never place a gate anywhere near a cliff wall
    const maxLat = Math.max(14, hw * 0.58 - radius);
    const x = Math.max(cx - maxLat, Math.min(cx + maxLat, rawX));
    const groundY = getTerrainHeight(x, z);
    const minY = groundY + radius + 5.2;
    const maxY = 54;
    const y = Math.max(minY, Math.min(maxY, rawY));

    // Align ring gently perpendicular to the local canyon heading (-Z forward)
    const dxCurve = getCanyonCenterX(z - 20) - getCanyonCenterX(z + 20);
    const yaw = Math.atan2(-dxCurve, 40) * 0.45;
    return { id, x, y, z, radius, tier, yaw };
  };

  // Chunk 0: Iconic opening Speed Gate floating right inside the grand stone arch + welcoming flow gate ahead
  if (chunkIndex === 0) {
    const arch = obstacles.find((o) => o.kind === 'arch');
    if (arch) {
      gates.push(
        clampSafeGate(
          'gate-0-arch',
          arch.x,
          arch.y + arch.height * 0.52,
          arch.z,
          11.2,
          'bonus',
        ),
      );
    }
    return gates;
  }

  // Open-sky breather chunks: sweeping hero flow gate + optional outer-curve bonus gate to reward boosting!
  if (isBreatherChunk(chunkIndex)) {
    const z1 = zStart - CHUNK_LENGTH * 0.42;
    const cx1 = getCanyonCenterX(z1);
    const hw1 = getCanyonHalfWidth(z1);
    const curveSide = chunkIndex % 2 === 0 ? 1 : -1;
    gates.push(
      clampSafeGate(
        `gate-${chunkIndex}-breather`,
        cx1 + curveSide * Math.min(18, hw1 * 0.26),
        23 + (chunkIndex % 3) * 3.5,
        z1,
        11.0,
        'flow',
      ),
    );
    return gates;
  }

  // Obstacle-rich chunks: smartly pair gates with landmarks for exciting risk/reward lines!
  const seed = chunkIndex * 29.73;
  const primaryObs = obstacles[0];

  if (primaryObs) {
    if (primaryObs.kind === 'arch') {
      // Bonus gate glowing squarely beneath the giant stone arch!
      gates.push(
        clampSafeGate(
          `gate-${chunkIndex}-arch`,
          primaryObs.x,
          primaryObs.y + primaryObs.height * 0.52,
          primaryObs.z,
          11.0,
          'bonus',
        ),
      );
    } else if (primaryObs.kind === 'split-pillar') {
      // Bonus gate tucked cleanly inside one of the two split canyon tunnels
      const tunnelSide: -1 | 1 = hash1D(seed + 1) > 0.5 ? 1 : -1;
      const hw = getCanyonHalfWidth(primaryObs.z);
      const offset = Math.min(hw * 0.56, primaryObs.radius + 18.5);
      gates.push(
        clampSafeGate(
          `gate-${chunkIndex}-split`,
          primaryObs.x + tunnelSide * offset,
          23,
          primaryObs.z,
          10.5,
          'bonus',
        ),
      );
    } else if (primaryObs.kind === 'overhang') {
      // Bonus gate floating safely in the sunlit dive-low gap underneath the overhang
      const awayBias = -(primaryObs.side ?? 1) * 10;
      gates.push(
        clampSafeGate(
          `gate-${chunkIndex}-under`,
          primaryObs.x + awayBias,
          Math.max(15, primaryObs.y + primaryObs.height * 0.54),
          primaryObs.z,
          9.5,
          'bonus',
        ),
      );
    } else if (primaryObs.kind === 'low-ridge') {
      // Bonus gate hovering invitingly right above the jagged low ridge crest!
      const sideBias = (hash1D(seed + 2) - 0.5) * 24;
      gates.push(
        clampSafeGate(
          `gate-${chunkIndex}-crest`,
          primaryObs.x + sideBias,
          primaryObs.y + primaryObs.height + 13.5,
          primaryObs.z,
          10.5,
          'bonus',
        ),
      );
    } else if (primaryObs.kind === 'broken-bridge') {
      // Bonus gate framed right beneath the elevated broken viaduct span
      gates.push(
        clampSafeGate(
          `gate-${chunkIndex}-bridge`,
          primaryObs.x,
          Math.max(15.5, primaryObs.y + primaryObs.height * 0.55),
          primaryObs.z,
          10.2,
          'bonus',
        ),
      );
    } else {
      // Flow/bonus gate placed cleanly in open sky on the clear side of a comm-tower / solar-array / spire
      const cx = getCanyonCenterX(primaryObs.z);
      const hw = getCanyonHalfWidth(primaryObs.z);
      const clearSide = primaryObs.x >= cx ? -1 : 1;
      gates.push(
        clampSafeGate(
          `gate-${chunkIndex}-weave`,
          cx + clearSide * Math.min(20, hw * 0.3),
          22 + hash1D(seed + 3) * 8,
          primaryObs.z,
          10.8,
          'flow',
        ),
      );
    }
  }

  // On alternating chunks, add a crisp rhythm flow gate tucked along the approach/exit curve
  if (chunkIndex % 2 === 1) {
    const zFlow = zStart - CHUNK_LENGTH * 0.62;
    // Ensure it doesn't crowd any obstacle in Z
    const tooCloseToObstacle = obstacles.some((o) => Math.abs(o.z - zFlow) < 48);
    if (!tooCloseToObstacle) {
      const cx = getCanyonCenterX(zFlow);
      const hw = getCanyonHalfWidth(zFlow);
      const offSign = hash1D(seed + 7) > 0.5 ? 1 : -1;
      const isBonus = hash1D(seed + 8) > 0.55;
      const latOffset = isBonus ? offSign * Math.min(24, hw * 0.36) : offSign * 6;
      const alt = isBonus ? 18 + hash1D(seed + 9) * 16 : 22;
      gates.push(
        clampSafeGate(
          `gate-${chunkIndex}-curve`,
          cx + latOffset,
          alt,
          zFlow,
          isBonus ? 10.2 : 11.2,
          isBonus ? 'bonus' : 'flow',
        ),
      );
    }
  }

  return gates;
}

