import type { CanyonObstacle } from './types';

export const CHUNK_LENGTH = 260;
export const TERRAIN_WIDTH = 420;
export const SAFE_START_DISTANCE = 480; // Straight, open canyon launch zone

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
 * Kept straight for the first ~480m so the craft flies safely on launch with zero input.
 */
export function getCanyonCenterX(z: number): number {
  const dist = Math.max(0, -z);
  const ramp = smoothstep(SAFE_START_DISTANCE * 0.72, SAFE_START_DISTANCE * 1.65, dist);
  const curve =
    Math.sin(dist * 0.0021) * 44 +
    Math.sin(dist * 0.0049 + 1.1) * 20 +
    Math.cos(dist * 0.0011 - 0.5) * 26;
  return curve * ramp;
}

/** Half-width of the flyable canyon corridor at world Z */
export function getCanyonHalfWidth(z: number): number {
  const dist = Math.max(0, -z);
  // Starts generous (~44m half-width => 88m canyon), gradually narrows toward ~31m
  const difficultyTighten = Math.min(13, dist * 0.00055);
  const organicBreath = Math.sin(dist * 0.0063 + 0.4) * 5.5;
  return 44 - difficultyTighten + organicBreath;
}

/** Gently rolling dusty valley floor elevation */
export function getValleyFloorHeight(x: number, z: number): number {
  const dist = Math.max(0, -z);
  const dune = (fbm2D(x * 0.018, z * 0.018) - 0.5) * 4.2;
  const swell = Math.sin(dist * 0.0042) * 2.2;
  return 1.5 + dune + swell;
}

/** Smoothstep helper */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Shared exact terrain height function at world (x, z).
 * Used identically by both the 3D terrain mesh and collision/near-miss checks.
 */
export function getTerrainHeight(x: number, z: number): number {
  const centerX = getCanyonCenterX(z);
  const halfWidth = getCanyonHalfWidth(z);
  const dx = Math.abs(x - centerX);

  const floorY = getValleyFloorHeight(x, z);

  // Inner valley stays low and flyable
  const wallT = smoothstep(halfWidth * 0.68, halfWidth * 1.42, dx);
  if (wallT <= 0.0001) {
    return floorY;
  }

  // Dramatic canyon wall rise + terraced strata + jagged Martian mountain peaks
  const outerT = smoothstep(halfWidth * 1.15, halfWidth * 2.6, dx);
  const ridge = ridgedNoise2D(x * 0.012, z * 0.012);
  const detail = fbm2D(x * 0.035, z * 0.035);

  // Steep canyon cliffs rising to 50-145m
  const rawCliff = wallT * (48 + ridge * 58) + outerT * (38 + ridge * 54) + detail * 10 * wallT;

  // Add realistic Martian sedimentary rock terracing on the steep walls
  const terraceStep = 14;
  const terraced =
    Math.floor(rawCliff / terraceStep) * terraceStep +
    smoothstep(0.18, 0.85, (rawCliff % terraceStep) / terraceStep) * terraceStep;

  const cliffHeight = rawCliff * 0.55 + terraced * 0.45;
  return floorY + cliffHeight;
}

/**
 * Deterministic canyon landmarks & obstacles for chunk index k (chunk covers z in [-k*L, -(k+1)*L]).
 * Chunk 0 & 1 establish the dramatic opening vista with a grand rock arch you fly directly beneath.
 */
export function getObstaclesForChunk(chunkIndex: number): CanyonObstacle[] {
  if (chunkIndex < 0) return [];
  const obstacles: CanyonObstacle[] = [];
  const zStart = -chunkIndex * CHUNK_LENGTH;

  // Chunk 0: Iconic opening landmark — massive natural Martian rock arch framed dead ahead!
  // Craft spawns at (0, 18, 0) and flies right under the arch (crown clearance 42m, span ±36m).
  if (chunkIndex === 0) {
    const archZ = -215;
    const cx = getCanyonCenterX(archZ);
    obstacles.push({
      id: `arch-0`,
      kind: 'arch',
      x: cx,
      y: getValleyFloorHeight(cx, archZ) - 2,
      z: archZ,
      radius: 35,
      height: 44,
      thickness: 8.5,
      yaw: 0.08,
      tint: 0.45,
    });
    return obstacles;
  }

  // Chunk 1: Safe opening canyon with flanking buttresses and a second grand arch
  if (chunkIndex === 1) {
    const z1 = zStart - 110;
    const cx1 = getCanyonCenterX(z1);
    const hw1 = getCanyonHalfWidth(z1);
    obstacles.push({
      id: `spire-1-a`,
      kind: 'spire',
      x: cx1 + hw1 * 0.56,
      y: getValleyFloorHeight(cx1 + hw1 * 0.56, z1) - 3,
      z: z1,
      radius: 10.5,
      height: 62,
      thickness: 10.5,
      yaw: 0.4,
      tint: 0.3,
    });

    const z2 = zStart - 210;
    const cx2 = getCanyonCenterX(z2);
    const hw2 = getCanyonHalfWidth(z2);
    obstacles.push({
      id: `spire-1-b`,
      kind: 'spire',
      x: cx2 - hw2 * 0.54,
      y: getValleyFloorHeight(cx2 - hw2 * 0.54, z2) - 3,
      z: z2,
      radius: 11,
      height: 68,
      thickness: 11,
      yaw: 1.7,
      tint: 0.7,
    });
    return obstacles;
  }

  // Subsequent chunks: smooth difficulty ramp of spires, towering rock arches, and wall buttresses
  const difficulty = Math.min(1, (chunkIndex - 1) / 22);
  const seedBase = chunkIndex * 37.19;

  // Every 2nd or 3rd chunk features a giant canyon rock arch
  if (chunkIndex % 2 === 0 || hash1D(seedBase + 1) > 0.62) {
    const archZ = zStart - (75 + hash1D(seedBase + 2) * 110);
    const cx = getCanyonCenterX(archZ);
    const hw = getCanyonHalfWidth(archZ);
    const archSpan = Math.max(24, hw * (0.82 - difficulty * 0.14));
    const archHeight = 32 + hash1D(seedBase + 3) * 15 - difficulty * 4;
    const offset = (hash1D(seedBase + 4) - 0.5) * hw * 0.24;
    obstacles.push({
      id: `arch-${chunkIndex}`,
      kind: 'arch',
      x: cx + offset,
      y: getValleyFloorHeight(cx + offset, archZ) - 2,
      z: archZ,
      radius: archSpan,
      height: archHeight,
      thickness: 7.5 + hash1D(seedBase + 5) * 3.5,
      yaw: (hash1D(seedBase + 6) - 0.5) * 0.34,
      tint: hash1D(seedBase + 7),
    });
  }

  // Jagged rock spires rising out of the canyon floor (2 to 4 per chunk)
  const spireCount = 2 + Math.floor(difficulty * 2.2);
  for (let i = 0; i < spireCount; i++) {
    const s = seedBase + 10 + i * 13.7;
    const frac = (i + 0.35 + hash1D(s) * 0.35) / spireCount;
    const sz = zStart - frac * CHUNK_LENGTH;
    const cx = getCanyonCenterX(sz);
    const hw = getCanyonHalfWidth(sz);

    // Avoid spawning a spire dead-center on top of an arch's Z plane
    const tooCloseToArch = obstacles.some(
      (o) => o.kind === 'arch' && Math.abs(o.z - sz) < 34,
    );
    if (tooCloseToArch) continue;

    // Distribute spires across left, right, and staggered inner-valley lanes while always keeping >= 22m clear pass
    const lanePick = (chunkIndex + i) % 3;
    let lateralNorm = 0;
    if (lanePick === 0) {
      lateralNorm = -0.58 + hash1D(s + 1) * 0.38;
    } else if (lanePick === 1) {
      lateralNorm = 0.2 + hash1D(s + 1) * 0.38;
    } else {
      lateralNorm = (hash1D(s + 1) - 0.5) * 0.72;
    }

    const sx = cx + lateralNorm * hw;
    const radius = 7.5 + hash1D(s + 2) * 6.5;
    const height = 42 + hash1D(s + 3) * 48;

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

  // Protruding canyon wall buttresses on alternating flanks
  const buttressSide = chunkIndex % 2 === 0 ? -1 : 1;
  const bz = zStart - (45 + hash1D(seedBase + 99) * 165);
  const bcx = getCanyonCenterX(bz);
  const bhw = getCanyonHalfWidth(bz);
  const bx = bcx + buttressSide * (bhw * 0.78);
  obstacles.push({
    id: `buttress-${chunkIndex}`,
    kind: 'buttress',
    x: bx,
    y: getValleyFloorHeight(bx, bz) - 4,
    z: bz,
    radius: 13 + hash1D(seedBase + 101) * 6,
    height: 55 + hash1D(seedBase + 102) * 35,
    thickness: 14,
    yaw: hash1D(seedBase + 103) * Math.PI,
    tint: hash1D(seedBase + 104),
  });

  return obstacles;
}
