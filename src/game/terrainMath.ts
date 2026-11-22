import type { CanyonObstacle } from './types';

export const CHUNK_LENGTH = 340;
export const TERRAIN_WIDTH = 520;
export const SAFE_START_DISTANCE = 620; // Wide, gentle opening canyon runway

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

/**
 * Center X coordinate of the winding Martian canyon at world Z (flight moves toward -Z).
 * Uses broad, sweeping, enjoyable curves instead of sharp sudden turns.
 */
export function getCanyonCenterX(z: number): number {
  const dist = Math.max(0, -z);
  const ramp = smoothstep(SAFE_START_DISTANCE * 0.78, SAFE_START_DISTANCE * 1.9, dist);
  const curve =
    Math.sin(dist * 0.00125) * 46 +
    Math.sin(dist * 0.0026 + 1.1) * 18 +
    Math.cos(dist * 0.00072 - 0.4) * 24;
  return curve * ramp;
}

/**
 * Generously wide flyable canyon ramp half-width at world Z.
 * Starts at ~66m half-width (132m wide canyon!) and narrows very gently to ~52m (104m wide).
 */
export function getCanyonHalfWidth(z: number): number {
  const dist = Math.max(0, -z);
  const difficultyTighten = Math.min(14, dist * 0.00028);
  const organicBreath = Math.sin(dist * 0.0042 + 0.4) * 4.5;
  return 66 - difficultyTighten + organicBreath;
}

/** Smoothly rolling dusty Martian canyon floor elevation */
export function getValleyFloorHeight(x: number, z: number): number {
  const dist = Math.max(0, -z);
  const dune = (fbm2D(x * 0.014, z * 0.014) - 0.5) * 3.0;
  const swell = Math.sin(dist * 0.0032) * 1.8;
  return 1.5 + dune + swell;
}

/** Smoothstep helper */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Shared exact terrain height function at world (x, z).
 * Wide flat-to-gently-sloped ramp in the center, rising into towering stratified Martian canyon cliffs.
 */
export function getTerrainHeight(x: number, z: number): number {
  const centerX = getCanyonCenterX(z);
  const halfWidth = getCanyonHalfWidth(z);
  const dx = Math.abs(x - centerX);

  const floorY = getValleyFloorHeight(x, z);

  // Generous wide canyon floor & smooth banked ramp apron before the steep cliffs rise
  const wallT = smoothstep(halfWidth * 0.78, halfWidth * 1.48, dx);
  if (wallT <= 0.0001) {
    return floorY;
  }

  // Towering Martian cliff walls rising to 55-150m on both flanks
  const outerT = smoothstep(halfWidth * 1.18, halfWidth * 2.55, dx);
  const ridge = ridgedNoise2D(x * 0.011, z * 0.011);
  const detail = fbm2D(x * 0.032, z * 0.032);

  const rawCliff = wallT * (52 + ridge * 58) + outerT * (40 + ridge * 54) + detail * 10 * wallT;

  // Realistic sedimentary Martian rock terracing
  const terraceStep = 14;
  const terraced =
    Math.floor(rawCliff / terraceStep) * terraceStep +
    smoothstep(0.18, 0.85, (rawCliff % terraceStep) / terraceStep) * terraceStep;

  const cliffHeight = rawCliff * 0.55 + terraced * 0.45;
  return floorY + cliffHeight;
}

/**
 * Deterministic canyon landmarks & obstacles for chunk index k (chunk covers z in [-k*L, -(k+1)*L]).
 * Generously spaced so players have wide sightlines and comfortable maneuvering corridors.
 */
export function getObstaclesForChunk(chunkIndex: number): CanyonObstacle[] {
  if (chunkIndex < 0) return [];
  const obstacles: CanyonObstacle[] = [];
  const zStart = -chunkIndex * CHUNK_LENGTH;

  // Chunk 0: Iconic grand Martian rock arch framed dead ahead with wide open clearance
  if (chunkIndex === 0) {
    const archZ = -255;
    const cx = getCanyonCenterX(archZ);
    obstacles.push({
      id: `arch-0`,
      kind: 'arch',
      x: cx,
      y: getValleyFloorHeight(cx, archZ) - 2,
      z: archZ,
      radius: 48,
      height: 50,
      thickness: 8.5,
      yaw: 0.05,
      tint: 0.45,
    });
    return obstacles;
  }

  // Chunk 1: Wide scenic opening canyon with two distant flanking rock monoliths
  if (chunkIndex === 1) {
    const z1 = zStart - 135;
    const cx1 = getCanyonCenterX(z1);
    const hw1 = getCanyonHalfWidth(z1);
    obstacles.push({
      id: `spire-1-a`,
      kind: 'spire',
      x: cx1 + hw1 * 0.62,
      y: getValleyFloorHeight(cx1 + hw1 * 0.62, z1) - 3,
      z: z1,
      radius: 10.5,
      height: 66,
      thickness: 10.5,
      yaw: 0.4,
      tint: 0.35,
    });

    const z2 = zStart - 275;
    const cx2 = getCanyonCenterX(z2);
    const hw2 = getCanyonHalfWidth(z2);
    obstacles.push({
      id: `spire-1-b`,
      kind: 'spire',
      x: cx2 - hw2 * 0.62,
      y: getValleyFloorHeight(cx2 - hw2 * 0.62, z2) - 3,
      z: z2,
      radius: 11,
      height: 70,
      thickness: 11,
      yaw: 1.7,
      tint: 0.68,
    });
    return obstacles;
  }

  // Very gradual difficulty ramp across 40+ chunks (~13+ km)
  const difficulty = Math.min(1, (chunkIndex - 1) / 40);
  const seedBase = chunkIndex * 37.19;

  // Every 2nd chunk features a wide, monumental natural rock arch to fly through
  if (chunkIndex % 2 === 0) {
    const archZ = zStart - (115 + hash1D(seedBase + 2) * 110);
    const cx = getCanyonCenterX(archZ);
    const hw = getCanyonHalfWidth(archZ);
    const archSpan = Math.max(36, hw * (0.76 - difficulty * 0.1));
    const archHeight = 40 + hash1D(seedBase + 3) * 14 - difficulty * 4;
    const offset = (hash1D(seedBase + 4) - 0.5) * hw * 0.16;
    obstacles.push({
      id: `arch-${chunkIndex}`,
      kind: 'arch',
      x: cx + offset,
      y: getValleyFloorHeight(cx + offset, archZ) - 2,
      z: archZ,
      radius: archSpan,
      height: archHeight,
      thickness: 7.5 + hash1D(seedBase + 5) * 3.0,
      yaw: (hash1D(seedBase + 6) - 0.5) * 0.24,
      tint: hash1D(seedBase + 7),
    });
  }

  // Farther-apart jagged rock spires (1 to 2 per 340m chunk, always leaving wide open lanes!)
  const spireCount = difficulty > 0.55 ? 2 : 1 + (chunkIndex % 2);
  for (let i = 0; i < spireCount; i++) {
    const s = seedBase + 10 + i * 13.7;
    const frac = (i + 0.35 + hash1D(s) * 0.3) / spireCount;
    const sz = zStart - frac * CHUNK_LENGTH;
    const cx = getCanyonCenterX(sz);
    const hw = getCanyonHalfWidth(sz);

    // Keep plenty of breathing room around arches
    const tooCloseToArch = obstacles.some(
      (o) => o.kind === 'arch' && Math.abs(o.z - sz) < 75,
    );
    if (tooCloseToArch) continue;

    // Place spires cleanly off-center or alternating sides so there's always a huge open flying corridor
    const sidePick = (chunkIndex + i) % 3;
    let lateralNorm = 0;
    if (sidePick === 0) {
      lateralNorm = -0.58 + hash1D(s + 1) * 0.28;
    } else if (sidePick === 1) {
      lateralNorm = 0.3 + hash1D(s + 1) * 0.28;
    } else {
      // Occasional scenic valley-center spire only after chunk 4, with 40m+ room on BOTH sides
      lateralNorm = chunkIndex >= 4 ? (hash1D(s + 1) - 0.5) * 0.36 : 0.52;
    }

    const sx = cx + lateralNorm * hw;
    const radius = 7.5 + hash1D(s + 2) * 5.2;
    const height = 46 + hash1D(s + 3) * 44;

    obstacles.push({
      id: `spire-${chunkIndex}-${i}`,
      kind: 'spire',
      x: sx,
      y: getValleyFloorHeight(sx, sz) - 3,
      z: sz,
      radius,
      height,
      thickness: radius,
      yaw: hash1D(s + 4) * Math.PI * 2,
      tint: hash1D(s + 5),
    });
  }

  // Scenic outer canyon wall buttress tucked near the wall edge (every other chunk)
  if (chunkIndex % 2 === 1) {
    const buttressSide = (chunkIndex >> 1) % 2 === 0 ? -1 : 1;
    const bz = zStart - (70 + hash1D(seedBase + 99) * 190);
    const bcx = getCanyonCenterX(bz);
    const bhw = getCanyonHalfWidth(bz);
    const bx = bcx + buttressSide * (bhw * 0.88);
    obstacles.push({
      id: `buttress-${chunkIndex}`,
      kind: 'buttress',
      x: bx,
      y: getValleyFloorHeight(bx, bz) - 4,
      z: bz,
      radius: 13 + hash1D(seedBase + 101) * 5,
      height: 58 + hash1D(seedBase + 102) * 32,
      thickness: 14,
      yaw: hash1D(seedBase + 103) * Math.PI,
      tint: hash1D(seedBase + 104),
    });
  }

  return obstacles;
}
