import * as THREE from 'three';
import type { MarsMaterialLibrary } from './materials';
import {
  CHUNK_LENGTH,
  TERRAIN_WIDTH,
  fbm2D,
  getCanyonCenterX,
  getCanyonHalfWidth,
  getDustDevilX,
  getObstaclesForChunk,
  getSpeedGatesForChunk,
  getTerrainHeight,
  getValleyFloorHeight,
  getZoneWeightsAtZ,
} from './terrainMath';
import type { CanyonObstacle, DifficultyId, SpeedGate } from './types';

const CHUNK_COUNT = 6;
const SEGMENTS_X = 46;
const SEGMENTS_Z = 28;
const DUST_CLOUD_COUNT = 32;
const PARTICLE_POOL_SIZE = 72;

export const SUN_DIRECTION = new THREE.Vector3(0.62, 0.25, -0.74).normalize();
export const HORIZON_FOG_COLOR = 0xc95a2b;

interface LiveDustDevil {
  obs: CanyonObstacle;
  group: THREE.Group;
  rings: THREE.Mesh[];
}

interface LiveSpeedGate {
  gate: SpeedGate;
  group: THREE.Group;
  outerSpinner: THREE.Group;
  innerSpinner: THREE.Group;
  rippleRing: THREE.Mesh;
  rippleMat: THREE.MeshBasicMaterial;
  outerRingMat: THREE.MeshBasicMaterial;
  passed: boolean;
  rippleProgress: number; // 0..1 when triggered
}

interface TerrainChunk {
  index: number;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  obstacleGroup: THREE.Group;
  dustDevils: LiveDustDevil[];
  speedGates: LiveSpeedGate[];
}

interface BurstParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  color: THREE.Color;
}

export interface MarsWorldRig {
  group: THREE.Group;
  setDifficulty: (difficulty: DifficultyId) => void;
  update: (dt: number, craftX: number, craftY: number, craftZ: number, worldTime: number) => void;
  getZoneFogColor: (z: number, outColor: THREE.Color) => THREE.Color;
  triggerGatePass: (gateId: string) => void;
  spawnGateSparks: (x: number, y: number, z: number) => void;
  spawnCrashExplosion: (x: number, y: number, z: number) => void;
  spawnNearMissSparks: (x: number, y: number, z: number) => void;
  spawnScrapeSparks: (x: number, y: number, z: number) => void;
  reset: (difficulty?: DifficultyId) => void;
  dispose: () => void;
}

// Distinct Martian zone sky & fog palettes (authored in hex -> linear THREE.Color)
const ZONE_PALETTES = {
  plains: {
    zenith: new THREE.Color('#3b1512'),
    mid: new THREE.Color('#a84220'),
    horizon: new THREE.Color('#ea8244'),
    fog: new THREE.Color('#cc5f2e'),
  },
  canyon: {
    zenith: new THREE.Color('#2c0e0c'),
    mid: new THREE.Color('#8f2b16'),
    horizon: new THREE.Color('#d86230'),
    fog: new THREE.Color('#ba4a21'),
  },
  colony: {
    zenith: new THREE.Color('#331a16'),
    mid: new THREE.Color('#9a4d2c'),
    horizon: new THREE.Color('#e29258'),
    fog: new THREE.Color('#c46c3b'),
  },
  volcanic: {
    zenith: new THREE.Color('#1d0b0d'),
    mid: new THREE.Color('#6e2114'),
    horizon: new THREE.Color('#c94e26'),
    fog: new THREE.Color('#9c381c'),
  },
};

// Intense crimson dust-storm lighting overlay for HARD mode
const HARD_CRIMSON_PALETTE = {
  zenith: new THREE.Color('#22040a'),
  mid: new THREE.Color('#7f131b'),
  horizon: new THREE.Color('#d92c28'),
  fog: new THREE.Color('#a61d1c'),
};

/**
 * Computes rich stratified Martian sandstone/basalt vertex color adapted to the 4 Martian zones.
 */
function sampleMarsRockColor(
  x: number,
  y: number,
  z: number,
  outColor: THREE.Color,
): void {
  const n = fbm2D(x * 0.025, z * 0.025);
  const strata = Math.sin(y * 0.36 + n * 4.2) * 0.5 + 0.5;
  const band = Math.sin(y * 0.14 - n * 2.1) * 0.5 + 0.5;
  const w = getZoneWeightsAtZ(z);

  // Subtle zone-driven color shifts in sRGB before converting to linear
  const rShift = w.plains * 0.04 + w.canyon * 0.02 + w.colony * 0.01 - w.volcanic * 0.22;
  const gShift = w.plains * 0.03 - w.canyon * 0.03 + w.colony * 0.04 - w.volcanic * 0.1;
  const bShift = w.plains * 0.01 - w.canyon * 0.02 + w.colony * 0.03 - w.volcanic * 0.04;

  if (y < 7.5) {
    const t = Math.max(0, Math.min(1, y / 7.5));
    const r = Math.max(0.14, Math.min(0.95, 0.74 - t * 0.1 + n * 0.08 + rShift * 0.75));
    const g = Math.max(0.08, Math.min(0.75, 0.34 - t * 0.07 + n * 0.04 + gShift * 0.75));
    const b = Math.max(0.05, Math.min(0.55, 0.17 - t * 0.04 + bShift * 0.75));
    outColor.setRGB(r, g, b).convertSRGBToLinear();
  } else {
    const heightGlow = Math.min(1, (y - 7.5) / 90);
    // Volcanic zone introduces dramatic dark basalt rock with hot rust-crimson mineral veins
    const emberVein = w.volcanic * Math.pow(strata, 3) * 0.18;
    const r = Math.max(0.14, Math.min(0.96, 0.52 + strata * 0.24 + heightGlow * 0.12 + band * 0.06 + rShift + emberVein));
    const g = Math.max(0.07, Math.min(0.72, 0.18 + strata * 0.12 + heightGlow * 0.07 + gShift));
    const b = Math.max(0.05, Math.min(0.52, 0.09 + strata * 0.05 + band * 0.02 + bShift));
    outColor.setRGB(r, g, b).convertSRGBToLinear();
  }
}

/** Helper to paint stratified Martian rock vertex colors on any sculpted BufferGeometry */
function applyRockVertexColors(
  geo: THREE.BufferGeometry,
  worldZ: number,
  tint: number,
  seed: number,
): void {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const w = getZoneWeightsAtZ(worldZ);
  const volcanicDark = w.volcanic * 0.2;

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const strata = Math.sin(vy * 0.32 + vx * 0.05 + seed * 3) * 0.5 + 0.5;
    c.setRGB(
      Math.max(0.16, 0.55 + strata * 0.24 + tint * 0.07 - volcanicDark),
      Math.max(0.08, 0.2 + strata * 0.11 + tint * 0.03 - volcanicDark * 0.48),
      Math.max(0.05, 0.095 + strata * 0.045 - volcanicDark * 0.22),
    ).convertSRGBToLinear();
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Builds a custom craggy Martian rock spire geometry with jagged facets & stratified vertex colors.
 */
function createJaggedSpireGeometry(
  radius: number,
  height: number,
  seed: number,
  tint: number,
  worldZ = 0,
): THREE.BufferGeometry {
  const radialSegs = 9;
  const heightSegs = 7;
  const geo = new THREE.CylinderGeometry(
    radius * 0.14,
    radius * 1.15,
    height,
    radialSegs,
    heightSegs,
    false,
  );
  geo.translate(0, height * 0.5, 0);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let vx = pos.getX(i);
    let vy = pos.getY(i);
    let vz = pos.getZ(i);

    const hRatio = Math.max(0, Math.min(1, vy / Math.max(1, height)));
    const angle = Math.atan2(vz, vx);
    const crag =
      1 +
      Math.sin(angle * 3 + seed * 5.1 + hRatio * 3.2) * 0.22 +
      Math.cos(angle * 5 - hRatio * 6.4 + seed * 2.7) * 0.14;
    const ledge = 1 - Math.sin(hRatio * Math.PI * 5) * 0.06;

    vx *= crag * ledge;
    vz *= crag * ledge;
    vx += Math.sin(seed * 4.3) * hRatio * radius * 0.26;
    vz += Math.cos(seed * 3.1) * hRatio * radius * 0.2;

    if (hRatio > 0.96) {
      vy += Math.sin(angle * 2 + seed) * 2.2;
    }
    pos.setXYZ(i, vx, vy, vz);
  }

  applyRockVertexColors(geo, worldZ, tint, seed);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 1. Giant Natural Stone Arch (fly UNDER or soar OVER!)
 */
function createRockArchGroup(
  obs: CanyonObstacle,
  rockMaterial: THREE.MeshStandardMaterial,
): THREE.Group {
  const archGroup = new THREE.Group();
  archGroup.position.set(obs.x, obs.y, obs.z);
  archGroup.rotation.y = obs.yaw;

  const span = obs.radius;
  const crownY = obs.height + obs.thickness * 0.62;

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-span * 1.18, -14, 0),
    new THREE.Vector3(-span * 1.02, obs.height * 0.48, 0.8),
    new THREE.Vector3(-span * 0.62, obs.height * 0.96, -0.5),
    new THREE.Vector3(0, crownY, 0),
    new THREE.Vector3(span * 0.62, obs.height * 0.96, 0.5),
    new THREE.Vector3(span * 1.02, obs.height * 0.48, -0.8),
    new THREE.Vector3(span * 1.18, -14, 0),
  ]);

  const tubeGeo = new THREE.TubeGeometry(curve, 26, obs.thickness * 0.78, 8, false);
  const pos = tubeGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const jitter =
      1 +
      Math.sin(vx * 0.19 + vy * 0.25) * 0.16 +
      Math.cos(vy * 0.42 - vz * 0.31) * 0.11;
    const baseThick = vy < obs.height * 0.55 ? 1.24 : 0.96;
    pos.setXYZ(
      i,
      vx * (0.96 + 0.04 * jitter),
      vy + Math.sin(vx * 0.14) * 1.2,
      vz * jitter * baseThick,
    );
  }

  applyRockVertexColors(tubeGeo, obs.z, obs.tint, obs.z * 0.01);
  tubeGeo.computeVertexNormals();

  const archMesh = new THREE.Mesh(tubeGeo, rockMaterial);
  archMesh.castShadow = true;
  archMesh.receiveShadow = true;
  archGroup.add(archMesh);

  for (const side of [-1, 1] as const) {
    const footingGeo = createJaggedSpireGeometry(
      obs.thickness * 1.25,
      obs.height * 0.52,
      obs.z * 0.01 + side * 3.1,
      obs.tint,
      obs.z,
    );
    const footing = new THREE.Mesh(footingGeo, rockMaterial);
    footing.position.set(side * span * 1.06, -4, 0);
    footing.castShadow = true;
    footing.receiveShadow = true;
    archGroup.add(footing);
  }

  return archGroup;
}

/**
 * 2. Split Canyon Path: Massive Central Rock Monolith dividing left & right tunnels.
 */
function createSplitPillarGroup(
  obs: CanyonObstacle,
  rockMaterial: THREE.MeshStandardMaterial,
  seed: number,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(obs.x, obs.y, obs.z);

  // Towering central monolith core
  const coreGeo = createJaggedSpireGeometry(obs.radius * 0.98, obs.height, seed, obs.tint, obs.z);
  coreGeo.scale(1.0, 1.0, obs.thickness / Math.max(1, obs.radius));
  const core = new THREE.Mesh(coreGeo, rockMaterial);
  core.castShadow = true;
  core.receiveShadow = true;
  g.add(core);

  // Twin jagged flanking rock shoulders creating a monumental split wedge silhouette
  for (const side of [-1, 1] as const) {
    const shoulderGeo = createJaggedSpireGeometry(
      obs.radius * 0.62,
      obs.height * (side > 0 ? 0.68 : 0.58),
      seed + side * 4.3,
      obs.tint * 0.85,
      obs.z,
    );
    const shoulder = new THREE.Mesh(shoulderGeo, rockMaterial);
    shoulder.position.set(side * obs.radius * 0.42, -2, side * obs.thickness * 0.25);
    shoulder.rotation.y = side * 0.7;
    shoulder.castShadow = true;
    shoulder.receiveShadow = true;
    g.add(shoulder);
  }

  // Forward prow ridge slicing the approaching airstream cleanly into left / right tunnels
  const prowGeo = createJaggedSpireGeometry(
    obs.radius * 0.55,
    obs.height * 0.44,
    seed + 9.2,
    obs.tint,
    obs.z,
  );
  const prow = new THREE.Mesh(prowGeo, rockMaterial);
  prow.position.set(0, -2, obs.thickness * 0.65);
  prow.castShadow = true;
  prow.receiveShadow = true;
  g.add(prow);

  return g;
}

/**
 * 3. Overhanging Red Cliff Ledge: Cantilevered Martian rock shelf forcing players to DIVE LOW!
 */
function createOverhangGroup(
  obs: CanyonObstacle,
  rockMaterial: THREE.MeshStandardMaterial,
  seed: number,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(obs.x, obs.y, obs.z);
  g.rotation.y = obs.yaw;

  const side = obs.side ?? 1;
  const spanWidth = obs.radius * 2.08;
  const shelfThickness = 26;
  const shelfDepth = obs.thickness * 1.15;

  const shelfGeo = new THREE.BoxGeometry(spanWidth, shelfThickness, shelfDepth, 12, 4, 4);
  const pos = shelfGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let vx = pos.getX(i);
    let vy = pos.getY(i);
    let vz = pos.getZ(i);

    // Taper the free cantilevered tip slightly upward so the dive gap reads sharply
    const tipRatio = side > 0 ? (spanWidth * 0.5 - vx) / spanWidth : (vx + spanWidth * 0.5) / spanWidth;
    if (vy < 0) {
      vy += tipRatio * 4.5 + Math.sin(vx * 0.14 + seed) * 2.1;
    } else {
      vy += Math.cos(vx * 0.1 + seed) * 4.8 - tipRatio * 6.5;
    }
    vz *= 1 + Math.sin(vx * 0.12 + vy * 0.15) * 0.16;
    pos.setXYZ(i, vx, vy, vz);
  }
  applyRockVertexColors(shelfGeo, obs.z, obs.tint, seed);
  shelfGeo.computeVertexNormals();

  const shelf = new THREE.Mesh(shelfGeo, rockMaterial);
  // Shift shelf toward the anchored canyon wall side (`side * obs.radius * 0.42`)
  shelf.position.set(side * obs.radius * 0.42, obs.height + shelfThickness * 0.5 + 1.5, 0);
  shelf.castShadow = true;
  shelf.receiveShadow = true;
  g.add(shelf);

  // Heavy cliff buttress anchoring the overhang cleanly into the side wall
  const anchorGeo = createJaggedSpireGeometry(
    obs.thickness * 1.1,
    obs.height + 36,
    seed + 5.1,
    obs.tint,
    obs.z,
  );
  const anchor = new THREE.Mesh(anchorGeo, rockMaterial);
  anchor.position.set(side * obs.radius * 1.15, -6, 0);
  anchor.castShadow = true;
  anchor.receiveShadow = true;
  g.add(anchor);

  // Sculpted underside brow crags for intense sense of scale while diving beneath
  for (let k = -1; k <= 1; k++) {
    const browGeo = new THREE.ConeGeometry(5.5 + Math.abs(k), 9.5, 6);
    browGeo.rotateX(Math.PI);
    applyRockVertexColors(browGeo, obs.z, obs.tint * 0.9, seed + k * 2.3);
    browGeo.computeVertexNormals();
    const brow = new THREE.Mesh(browGeo, rockMaterial);
    brow.position.set(side * obs.radius * 0.15 + k * 15, obs.height + 2.8, k * 2.5);
    g.add(brow);
  }

  return g;
}

/**
 * 4. Low Jagged Ridge: Serrated wall of Martian crags across the valley floor forcing players to CLIMB HIGH!
 */
function createLowRidgeGroup(
  obs: CanyonObstacle,
  rockMaterial: THREE.MeshStandardMaterial,
  seed: number,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(obs.x, obs.y, obs.z);
  g.rotation.y = obs.yaw;

  // Base rocky berm spanning across the valley floor
  const bermGeo = new THREE.BoxGeometry(obs.radius * 2.02, obs.height * 0.68, obs.thickness * 1.05, 14, 3, 3);
  bermGeo.translate(0, obs.height * 0.34, 0);
  const pos = bermGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    let vy = pos.getY(i);
    let vz = pos.getZ(i);
    const hRatio = vy / Math.max(1, obs.height * 0.68);
    // Narrow toward the crest into a sharp jagged spine
    vz *= 1.12 - hRatio * 0.62;
    if (hRatio > 0.7) {
      vy += Math.abs(Math.sin(vx * 0.16 + seed)) * obs.height * 0.38;
    }
    pos.setXYZ(i, vx, vy, vz);
  }
  applyRockVertexColors(bermGeo, obs.z, obs.tint, seed);
  bermGeo.computeVertexNormals();

  const berm = new THREE.Mesh(bermGeo, rockMaterial);
  berm.castShadow = true;
  berm.receiveShadow = true;
  g.add(berm);

  // Staggered serrated jagged teeth along the ridge crest
  const toothCount = 7;
  for (let i = 0; i < toothCount; i++) {
    const frac = (i / (toothCount - 1)) * 2 - 1; // -1..1
    const toothH = obs.height * (0.82 + 0.24 * Math.sin(i * 2.1 + seed));
    const toothGeo = createJaggedSpireGeometry(
      obs.thickness * 0.44,
      toothH,
      seed + i * 2.7,
      obs.tint,
      obs.z,
    );
    const tooth = new THREE.Mesh(toothGeo, rockMaterial);
    tooth.position.set(frac * obs.radius * 0.84, -1.5, ((i % 2) * 2 - 1) * 1.8);
    tooth.castShadow = true;
    tooth.receiveShadow = true;
    g.add(tooth);
  }

  return g;
}

/**
 * 5. Abandoned Mars Colony: Leaning Rusted Communication Tower (truss legs + relay pod + parabolic dish + warning beacon).
 */
function createCommTowerGroup(
  obs: CanyonObstacle,
  materials: MarsMaterialLibrary,
): THREE.Group {
  const root = new THREE.Group();
  root.position.set(obs.x, obs.y, obs.z);

  // Weathered concrete base pad rooted level into the Martian dirt
  const padGeo = new THREE.CylinderGeometry(obs.radius * 1.45, obs.radius * 1.75, 4.2, 8);
  padGeo.translate(0, 1.5, 0);
  const pad = new THREE.Mesh(padGeo, materials.concreteMaterial);
  pad.receiveShadow = true;
  root.add(pad);

  // Leaning tower superstructure tilting along Z rotation matching obs.yaw lateral lean
  const mast = new THREE.Group();
  mast.rotation.z = -obs.yaw;
  root.add(mast);

  const h = obs.height;
  const baseR = obs.radius * 0.92;
  const topR = obs.radius * 0.24;

  // 4 slanted rusted steel corner truss legs
  for (let k = 0; k < 4; k++) {
    const angle = (k / 4) * Math.PI * 2 + Math.PI * 0.25;
    const bx = Math.cos(angle) * baseR;
    const bz = Math.sin(angle) * baseR;
    const tx = Math.cos(angle) * topR;
    const tz = Math.sin(angle) * topR;

    const legStart = new THREE.Vector3(bx, 2, bz);
    const legEnd = new THREE.Vector3(tx, h * 0.92, tz);
    const dir = new THREE.Vector3().subVectors(legEnd, legStart);
    const len = dir.length();

    const legGeo = new THREE.CylinderGeometry(0.42, 0.65, len, 6);
    const leg = new THREE.Mesh(legGeo, materials.rustedSteelMaterial);
    leg.position.copy(legStart).addScaledVector(dir, 0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    leg.castShadow = true;
    mast.add(leg);
  }

  // Horizontal steel lattice cross-bracing rings
  const ringLevels = [0.22, 0.44, 0.66, 0.86];
  for (const lvl of ringLevels) {
    const rAtLvl = baseR * (1 - lvl) + topR * lvl;
    const ringGeo = new THREE.TorusGeometry(rAtLvl * 0.98, 0.34, 5, 8);
    ringGeo.rotateX(Math.PI * 0.5);
    const ring = new THREE.Mesh(ringGeo, materials.rustedSteelMaterial);
    ring.position.y = h * lvl;
    mast.add(ring);
  }

  // Battered octagonal colony relay equipment pod
  const podGeo = new THREE.CylinderGeometry(baseR * 0.65, baseR * 0.72, 6.2, 8);
  const pod = new THREE.Mesh(podGeo, materials.rustedSteelMaterial);
  pod.position.y = h * 0.72;
  pod.castShadow = true;
  mast.add(pod);

  // Giant tilted parabolic deep-space dish (LatheGeometry)
  const dishPoints = [
    new THREE.Vector2(0.05, 0),
    new THREE.Vector2(2.4, 0.4),
    new THREE.Vector2(5.2, 1.45),
    new THREE.Vector2(7.0, 2.95),
    new THREE.Vector2(6.8, 3.25),
    new THREE.Vector2(2.2, 0.8),
    new THREE.Vector2(0.05, 0.3),
  ];
  const dishGeo = new THREE.LatheGeometry(dishPoints, 14);
  const dish = new THREE.Mesh(dishGeo, materials.concreteMaterial);
  dish.position.set(-(obs.side ?? 1) * 3.8, h * 0.74, 2.2);
  dish.rotation.x = Math.PI * 0.42;
  dish.rotation.z = (obs.side ?? 1) * 0.45;
  dish.castShadow = true;
  mast.add(dish);

  // Spire needle & glowing amber-red aviation beacon
  const needleGeo = new THREE.CylinderGeometry(0.14, 0.32, h * 0.14, 6);
  const needle = new THREE.Mesh(needleGeo, materials.metalIntakeMaterial);
  needle.position.y = h * 0.96;
  mast.add(needle);

  const beaconGeo = new THREE.SphereGeometry(0.95, 10, 8);
  const beacon = new THREE.Mesh(beaconGeo, materials.beaconMaterial);
  beacon.position.y = h * 1.03;
  mast.add(beacon);

  return root;
}

/**
 * 6. Abandoned Mars Colony: Broken Bridge / Viaduct Span (twin piers + snapped cantilevered road deck + rusted trusses).
 */
function createBrokenBridgeGroup(
  obs: CanyonObstacle,
  materials: MarsMaterialLibrary,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(obs.x, obs.y, obs.z);
  g.rotation.y = obs.yaw;

  const span = obs.radius;
  const deckY = obs.height;
  const deckH = obs.thickness;
  const deckDepth = obs.thickness * 2.1;
  const gapHalf = 10.5;

  // Twin heavy reinforced colony viaduct piers
  for (const side of [-1, 1] as const) {
    const pierGeo = new THREE.BoxGeometry(7.2, deckY + 8, deckDepth * 0.9);
    const pier = new THREE.Mesh(pierGeo, materials.concreteMaterial);
    pier.position.set(side * span, (deckY - 4) * 0.5, 0);
    pier.castShadow = true;
    pier.receiveShadow = true;
    g.add(pier);

    // Flared steel capital bracket supporting the road deck
    const capGeo = new THREE.BoxGeometry(11.5, 4.2, deckDepth * 1.06);
    const cap = new THREE.Mesh(capGeo, materials.rustedSteelMaterial);
    cap.position.set(side * span, deckY - 1.2, 0);
    g.add(cap);

    // Broken cantilevered road deck half reaching inward toward the snapped center gap
    const halfLen = span + 18 - gapHalf;
    const deckGeo = new THREE.BoxGeometry(halfLen, deckH * 0.65, deckDepth);
    const deck = new THREE.Mesh(deckGeo, materials.concreteMaterial);
    const centerX = side * (gapHalf + halfLen * 0.5);
    // Slight structural sag toward the snapped center fracture
    deck.position.set(centerX, deckY + deckH * 0.45, 0);
    deck.rotation.z = side * 0.045;
    deck.castShadow = true;
    deck.receiveShadow = true;
    g.add(deck);

    // Rusted under-deck box truss girder
    const girderGeo = new THREE.BoxGeometry(halfLen * 0.94, deckH * 0.48, deckDepth * 0.58);
    const girder = new THREE.Mesh(girderGeo, materials.rustedSteelMaterial);
    girder.position.set(centerX, deckY - deckH * 0.08, 0);
    girder.rotation.z = side * 0.045;
    g.add(girder);

    // Side safety guardrails along both edges of the broken bridge deck
    for (const zSide of [-1, 1] as const) {
      const railGeo = new THREE.BoxGeometry(halfLen * 0.92, 1.8, 0.75);
      const rail = new THREE.Mesh(railGeo, materials.rustedSteelMaterial);
      rail.position.set(centerX, deckY + deckH * 0.95, zSide * (deckDepth * 0.46));
      rail.rotation.z = side * 0.045;
      g.add(rail);
    }

    // Snapped exposed rebar steel beams jutting into the broken center gap
    for (let b = -1; b <= 1; b++) {
      const rebarGeo = new THREE.BoxGeometry(5.5, 0.65, 0.65);
      const rebar = new THREE.Mesh(rebarGeo, materials.rustedSteelMaterial);
      rebar.position.set(side * (gapHalf - 1.8), deckY + deckH * 0.25 + b * 0.5, b * 3.1);
      rebar.rotation.z = -side * (0.28 + Math.abs(b) * 0.12);
      g.add(rebar);
    }
  }

  return g;
}

/**
 * 7. Abandoned Mars Colony: Giant Tilted Solar Panel Array (deep-cobalt reflective photovoltaic wing on steel truss pylon).
 */
function createSolarArrayGroup(
  obs: CanyonObstacle,
  materials: MarsMaterialLibrary,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(obs.x, obs.y, obs.z);
  g.rotation.y = obs.yaw;

  // Heavy concrete footing
  const baseGeo = new THREE.CylinderGeometry(3.8, 5.2, 3.6, 8);
  baseGeo.translate(0, 1.4, 0);
  const base = new THREE.Mesh(baseGeo, materials.concreteMaterial);
  base.receiveShadow = true;
  g.add(base);

  // Rusted main support pylon + twin diagonal steel stabilizer struts
  const stemH = obs.height * 0.66;
  const stemGeo = new THREE.CylinderGeometry(1.25, 1.85, stemH, 8);
  stemGeo.translate(0, stemH * 0.5, 0);
  const stem = new THREE.Mesh(stemGeo, materials.rustedSteelMaterial);
  stem.castShadow = true;
  g.add(stem);

  for (const s of [-1, 1] as const) {
    const strutGeo = new THREE.CylinderGeometry(0.45, 0.55, stemH * 0.85, 6);
    const strut = new THREE.Mesh(strutGeo, materials.rustedSteelMaterial);
    strut.position.set(s * 3.2, stemH * 0.42, 0);
    strut.rotation.z = s * 0.34;
    g.add(strut);
  }

  // Giant tilted photovoltaic wing assembly catching Martian sunlight
  const wingPivot = new THREE.Group();
  wingPivot.position.set(0, obs.height * 0.68, 0);
  // Dramatic battered tilt toward the low Martian sun
  wingPivot.rotation.x = 0.42;
  wingPivot.rotation.z = (obs.side ?? 1) * 0.22;
  g.add(wingPivot);

  const panelW = obs.radius * 2.05;
  const panelH = obs.height * 0.58;

  // Outer rusted structural frame around the giant solar array
  const frameGeo = new THREE.BoxGeometry(panelW + 1.4, panelH + 1.2, 1.1);
  const frame = new THREE.Mesh(frameGeo, materials.rustedSteelMaterial);
  frame.castShadow = true;
  frame.receiveShadow = true;
  wingPivot.add(frame);

  // Gleaming deep-cobalt silicon solar cell face on front & back
  const cellGeo = new THREE.BoxGeometry(panelW - 0.6, panelH - 0.6, 1.35);
  const cells = new THREE.Mesh(cellGeo, materials.solarPanelMaterial);
  wingPivot.add(cells);

  // Center structural crossbar bisecting the giant wing
  const barGeo = new THREE.BoxGeometry(1.1, panelH + 1.4, 1.65);
  const bar = new THREE.Mesh(barGeo, materials.metalIntakeMaterial);
  wingPivot.add(bar);

  return g;
}

/**
 * 8. Moving Hazard: Tall Swirling Red Dust Devil drifting sideways across the valley.
 */
function createDustDevilGroup(
  obs: CanyonObstacle,
  materials: MarsMaterialLibrary,
): LiveDustDevil {
  const g = new THREE.Group();
  g.position.set(obs.x, obs.y, obs.z);

  const rings: THREE.Mesh[] = [];
  const tierCount = 8;

  // Tall swirling inner translucent vortex core
  const coreGeo = new THREE.CylinderGeometry(
    obs.radius * 1.18,
    obs.radius * 0.56,
    obs.height,
    12,
    6,
    true,
  );
  coreGeo.translate(0, obs.height * 0.5, 0);
  const coreMesh = new THREE.Mesh(coreGeo, materials.dustDevilMaterial);
  g.add(coreMesh);
  rings.push(coreMesh);

  // Stacked tilted swirling dust ribbons creating dramatic cyclone motion
  for (let i = 0; i < tierCount; i++) {
    const t = i / (tierCount - 1);
    const tierR = obs.radius * (0.68 + t * 0.62);
    const ringGeo = new THREE.TorusGeometry(tierR, 1.25 + t * 1.45, 5, 14);
    ringGeo.rotateX(Math.PI * 0.5);
    const ring = new THREE.Mesh(ringGeo, materials.dustDevilMaterial);
    ring.position.set(
      Math.sin(i * 1.4) * 1.4,
      3.2 + t * (obs.height - 5),
      Math.cos(i * 1.4) * 1.4,
    );
    ring.rotation.x = 0.16 * Math.sin(i * 1.7);
    ring.rotation.z = 0.16 * Math.cos(i * 1.3);
    g.add(ring);
    rings.push(ring);
  }

  return { obs, group: g, rings };
}

/**
 * 9. Luminous Cyan-and-Gold Holographic Speed Gate floating above the Martian canyon
 * with rotating segmented light arcs, soft energy halo, and expanding pass-through ripple!
 */
function createSpeedGateGroup(
  gate: SpeedGate,
  materials: MarsMaterialLibrary,
): LiveSpeedGate {
  const g = new THREE.Group();
  g.position.set(gate.x, gate.y, gate.z);
  g.rotation.y = gate.yaw;

  const isBonus = gate.tier === 'bonus';
  const r = gate.radius;

  // Primary luminous holographic cyan ring (NormalBlending keeps vivid electric cyan against orange Mars sky)
  const outerGeo = new THREE.TorusGeometry(r, 0.42, 12, 48);
  const outerRingMat = new THREE.MeshBasicMaterial({
    color: isBonus ? 0x38f2ff : 0x22d3ee,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
  });
  g.add(new THREE.Mesh(outerGeo, outerRingMat));

  // Soft wide outer cyan glow aura torus so gates read unmistakably from 400m against rusty red cliffs
  const haloGeo = new THREE.TorusGeometry(r, 1.05, 8, 40);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x38e8ff,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  g.add(new THREE.Mesh(haloGeo, haloMat));

  // Rotating outer holographic gold light arc segments orbiting the cyan ring
  const outerSpinner = new THREE.Group();
  const arcMatGold = new THREE.MeshBasicMaterial({
    color: isBonus ? 0xffd54a : 0xfbbf24,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
  });
  for (let i = 0; i < 4; i++) {
    const segGeo = new THREE.TorusGeometry(r * 1.11, 0.34, 8, 16, Math.PI * 0.3);
    const seg = new THREE.Mesh(segGeo, arcMatGold);
    seg.rotation.z = (i * Math.PI) / 2;
    outerSpinner.add(seg);
  }
  g.add(outerSpinner);

  // Counter-rotating inner electric ice-cyan light segments
  const innerSpinner = new THREE.Group();
  const arcMatCyan = new THREE.MeshBasicMaterial({
    color: 0xbef8ff,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });
  for (let i = 0; i < 3; i++) {
    const innerArcGeo = new THREE.TorusGeometry(r * 0.86, 0.2, 6, 14, Math.PI * 0.34);
    const innerSeg = new THREE.Mesh(innerArcGeo, arcMatCyan);
    innerSeg.rotation.z = (i * Math.PI * 2) / 3;
    innerSpinner.add(innerSeg);
  }
  g.add(innerSpinner);

  // Subtle translucent holographic field sheen inside the ring
  const glowSpriteMat = new THREE.SpriteMaterial({
    map: materials.glowTexture,
    color: isBonus ? 0x67e8f9 : 0x38bdf8,
    transparent: true,
    opacity: 0.2,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glowSprite = new THREE.Sprite(glowSpriteMat);
  glowSprite.scale.set(r * 2.4, r * 2.4, 1);
  g.add(glowSprite);

  // Expanding pass-through energy ripple ring (activates when aircraft blasts through!)
  const rippleGeo = new THREE.TorusGeometry(r, 0.6, 8, 44);
  const rippleMat = new THREE.MeshBasicMaterial({
    color: 0xa5f3fc,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const rippleRing = new THREE.Mesh(rippleGeo, rippleMat);
  rippleRing.visible = false;
  g.add(rippleRing);

  return {
    gate,
    group: g,
    outerSpinner,
    innerSpinner,
    rippleRing,
    rippleMat,
    outerRingMat,
    passed: false,
    rippleProgress: 0,
  };
}

/**
 * Custom Martian atmospheric sky dome shader with dynamic zone-blended sky colors,
 * bright distant sun with halo, and warm ground-haze band.
 */
function createMartianSkyDome(): {
  mesh: THREE.Mesh;
  uniforms: {
    uZenithColor: { value: THREE.Color };
    uMidSkyColor: { value: THREE.Color };
    uHorizonColor: { value: THREE.Color };
    uGroundHazeColor: { value: THREE.Color };
  };
  dispose: () => void;
} {
  const skyGeo = new THREE.SphereGeometry(920, 32, 20);
  const uniforms = {
    uSunDir: { value: SUN_DIRECTION.clone() },
    uZenithColor: { value: ZONE_PALETTES.plains.zenith.clone() },
    uMidSkyColor: { value: ZONE_PALETTES.plains.mid.clone() },
    uHorizonColor: { value: ZONE_PALETTES.plains.horizon.clone() },
    uGroundHazeColor: { value: ZONE_PALETTES.plains.fog.clone() },
    uSunColor: { value: new THREE.Color('#fff5d6') },
  };
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDir;
      uniform vec3 uZenithColor;
      uniform vec3 uMidSkyColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uGroundHazeColor;
      uniform vec3 uSunColor;
      varying vec3 vWorldDir;

      void main() {
        vec3 dir = normalize(vWorldDir);
        float elev = dir.y;

        vec3 col = mix(uHorizonColor, uMidSkyColor, smoothstep(0.0, 0.28, elev));
        col = mix(col, uZenithColor, smoothstep(0.24, 0.85, elev));
        col = mix(col, uGroundHazeColor, smoothstep(0.02, -0.18, elev));

        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        float wideGlow = pow(sunDot, 5.0) * 0.42;
        float tightHalo = pow(sunDot, 42.0) * 0.72;
        float sunDisc = smoothstep(0.9986, 0.99945, sunDot);

        col += vec3(1.0, 0.62, 0.28) * wideGlow;
        col += vec3(1.0, 0.86, 0.58) * tightHalo;
        col = mix(col, uSunColor * 1.45, sunDisc);

        float horizonBand = exp(-abs(elev - 0.01) * 14.0) * 0.24;
        col += vec3(1.0, 0.66, 0.36) * horizonBand;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(skyGeo, skyMat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return {
    mesh,
    uniforms,
    dispose: () => {
      skyGeo.dispose();
      skyMat.dispose();
    },
  };
}

export function createMarsWorldRig(materials: MarsMaterialLibrary): MarsWorldRig {
  const group = new THREE.Group();

  // 1. Martian Sky Dome
  const sky = createMartianSkyDome();
  group.add(sky.mesh);

  // 2. Recycled Endless Terrain Chunks + Varied Landmarks & Moving Dust Devils
  const chunks: TerrainChunk[] = [];
  const tmpColor = new THREE.Color();

  let activeDifficulty: DifficultyId = 'easy';

  const blendZoneColor = (
    z: number,
    key: 'zenith' | 'mid' | 'horizon' | 'fog',
    out: THREE.Color,
  ): THREE.Color => {
    const w = getZoneWeightsAtZ(z);
    out.setRGB(
      ZONE_PALETTES.plains[key].r * w.plains +
        ZONE_PALETTES.canyon[key].r * w.canyon +
        ZONE_PALETTES.colony[key].r * w.colony +
        ZONE_PALETTES.volcanic[key].r * w.volcanic,
      ZONE_PALETTES.plains[key].g * w.plains +
        ZONE_PALETTES.canyon[key].g * w.canyon +
        ZONE_PALETTES.colony[key].g * w.colony +
        ZONE_PALETTES.volcanic[key].g * w.volcanic,
      ZONE_PALETTES.plains[key].b * w.plains +
        ZONE_PALETTES.canyon[key].b * w.canyon +
        ZONE_PALETTES.colony[key].b * w.colony +
        ZONE_PALETTES.volcanic[key].b * w.volcanic,
    );
    if (activeDifficulty === 'hard') {
      out.lerp(HARD_CRIMSON_PALETTE[key], 0.56);
    } else if (activeDifficulty === 'medium') {
      out.lerp(HARD_CRIMSON_PALETTE[key], 0.16);
    }
    return out;
  };

  const clearChunkObstacles = (chunk: TerrainChunk) => {
    chunk.dustDevils.length = 0;
    chunk.speedGates.length = 0;
    while (chunk.obstacleGroup.children.length > 0) {
      const child = chunk.obstacleGroup.children[0];
      chunk.obstacleGroup.remove(child);
      child.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry.dispose();
          // Dispose per-gate additive materials (shared library materials stay alive)
          const mat = mesh.material as THREE.Material;
          if (
            mat !== materials.rockObstacleMaterial &&
            mat !== materials.rustedSteelMaterial &&
            mat !== materials.concreteMaterial &&
            mat !== materials.solarPanelMaterial &&
            mat !== materials.beaconMaterial &&
            mat !== materials.metalIntakeMaterial &&
            mat !== materials.dustDevilMaterial
          ) {
            mat.dispose();
          }
        } else if ((obj as THREE.Sprite).isSprite) {
          (obj as THREE.Sprite).material.dispose();
        }
      });
    }
  };

  const populateChunk = (chunk: TerrainChunk, chunkIndex: number) => {
    chunk.index = chunkIndex;
    const zStart = -chunkIndex * CHUNK_LENGTH;
    const posAttr = chunk.geometry.attributes.position as THREE.BufferAttribute;
    const colAttr = chunk.geometry.attributes.color as THREE.BufferAttribute;

    let vIdx = 0;
    for (let iz = 0; iz <= SEGMENTS_Z; iz++) {
      const zFrac = iz / SEGMENTS_Z;
      const worldZ = zStart - zFrac * CHUNK_LENGTH;
      const centerX = getCanyonCenterX(worldZ, activeDifficulty);

      for (let ix = 0; ix <= SEGMENTS_X; ix++) {
        const xFrac = ix / SEGMENTS_X - 0.5;
        const shapedX = Math.sign(xFrac) * Math.pow(Math.abs(xFrac) * 2, 1.18) * 0.5;
        const worldX = centerX + shapedX * TERRAIN_WIDTH;
        const worldY = getTerrainHeight(worldX, worldZ, activeDifficulty);

        posAttr.setXYZ(vIdx, worldX, worldY, worldZ);
        sampleMarsRockColor(worldX, worldY, worldZ, tmpColor);
        colAttr.setXYZ(vIdx, tmpColor.r, tmpColor.g, tmpColor.b);
        vIdx++;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    chunk.geometry.computeVertexNormals();
    chunk.geometry.computeBoundingSphere();

    // Rebuild varied handcrafted landmarks & hazards for this chunk
    clearChunkObstacles(chunk);
    const obstacles = getObstaclesForChunk(chunkIndex, activeDifficulty);
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      const seed = chunkIndex * 11.3 + i * 3.7;

      if (obs.kind === 'arch') {
        chunk.obstacleGroup.add(createRockArchGroup(obs, materials.rockObstacleMaterial));
      } else if (obs.kind === 'split-pillar') {
        chunk.obstacleGroup.add(createSplitPillarGroup(obs, materials.rockObstacleMaterial, seed));
      } else if (obs.kind === 'overhang') {
        chunk.obstacleGroup.add(createOverhangGroup(obs, materials.rockObstacleMaterial, seed));
      } else if (obs.kind === 'low-ridge') {
        chunk.obstacleGroup.add(createLowRidgeGroup(obs, materials.rockObstacleMaterial, seed));
      } else if (obs.kind === 'comm-tower') {
        chunk.obstacleGroup.add(createCommTowerGroup(obs, materials));
      } else if (obs.kind === 'broken-bridge') {
        chunk.obstacleGroup.add(createBrokenBridgeGroup(obs, materials));
      } else if (obs.kind === 'solar-array') {
        chunk.obstacleGroup.add(createSolarArrayGroup(obs, materials));
      } else if (obs.kind === 'dust-devil') {
        const devil = createDustDevilGroup(obs, materials);
        chunk.obstacleGroup.add(devil.group);
        chunk.dustDevils.push(devil);
      } else {
        const spireGeo = createJaggedSpireGeometry(obs.radius, obs.height, seed, obs.tint, obs.z);
        const spireMesh = new THREE.Mesh(spireGeo, materials.rockObstacleMaterial);
        spireMesh.position.set(obs.x, obs.y, obs.z);
        spireMesh.rotation.y = obs.yaw;
        spireMesh.castShadow = true;
        spireMesh.receiveShadow = true;
        chunk.obstacleGroup.add(spireMesh);
      }
    }

    // Spawn luminous Glowing Speed Gates for this chunk
    const gates = getSpeedGatesForChunk(chunkIndex, activeDifficulty);
    for (let i = 0; i < gates.length; i++) {
      const liveGate = createSpeedGateGroup(gates[i], materials);
      chunk.obstacleGroup.add(liveGate.group);
      chunk.speedGates.push(liveGate);
    }
  };

  // Pre-build 6 reusable terrain chunk meshes (counter-clockwise upward-facing winding for +X / -Z grid)
  const cols = SEGMENTS_X + 1;
  const rows = SEGMENTS_Z + 1;
  const sharedIndices: number[] = [];
  for (let iz = 0; iz < SEGMENTS_Z; iz++) {
    for (let ix = 0; ix < SEGMENTS_X; ix++) {
      const a = iz * cols + ix;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      sharedIndices.push(a, b, c, b, d, c);
    }
  }

  const sharedUvs = new Float32Array(cols * rows * 2);
  let uIdx = 0;
  for (let iz = 0; iz <= SEGMENTS_Z; iz++) {
    for (let ix = 0; ix <= SEGMENTS_X; ix++) {
      sharedUvs[uIdx++] = (ix / SEGMENTS_X) * 6;
      sharedUvs[uIdx++] = (iz / SEGMENTS_Z) * 4;
    }
  }

  for (let c = 0; c < CHUNK_COUNT; c++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cols * rows * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols * rows * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(sharedUvs.slice(), 2));
    geo.setIndex(sharedIndices);

    const mesh = new THREE.Mesh(geo, materials.terrainMaterial);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.frustumCulled = false;

    const obstacleGroup = new THREE.Group();
    group.add(mesh, obstacleGroup);

    chunks.push({
      index: c - 1,
      mesh,
      geometry: geo,
      obstacleGroup,
      dustDevils: [],
      speedGates: [],
    });
  }

  // 3. Swirling Low-Altitude Martian Red Dust Haze Plumes (pooled sprites)
  const dustMat = new THREE.SpriteMaterial({
    map: materials.dustTexture,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
    fog: true,
  });

  const dustGroup = new THREE.Group();
  const dustClouds: { sprite: THREE.Sprite; driftSpeed: number; phase: number; offsetX: number }[] =
    [];
  for (let i = 0; i < DUST_CLOUD_COUNT; i++) {
    const sprite = new THREE.Sprite(dustMat);
    const scaleX = 28 + (i % 5) * 12;
    const scaleY = 10 + (i % 4) * 4;
    sprite.scale.set(scaleX, scaleY, 1);
    dustGroup.add(sprite);
    dustClouds.push({
      sprite,
      driftSpeed: 4 + (i % 6) * 2.2,
      phase: i * 1.37,
      offsetX: ((i % 7) / 6 - 0.5) * 2,
    });
  }
  group.add(dustGroup);

  const initDustAround = (craftZ: number) => {
    dustMat.color.setHex(activeDifficulty === 'hard' ? 0xff705a : 0xffffff);
    dustMat.opacity = activeDifficulty === 'hard' ? 0.56 : 0.44;
    for (let i = 0; i < dustClouds.length; i++) {
      const dc = dustClouds[i];
      const dz = craftZ - (i / dustClouds.length) * 680 + 30;
      const cx = getCanyonCenterX(dz, activeDifficulty);
      const hw = getCanyonHalfWidth(dz, activeDifficulty);
      const x = cx + dc.offsetX * hw * 0.85;
      const y = getValleyFloorHeight(x, dz) + 4.5 + (i % 3) * 3.2;
      dc.sprite.position.set(x, y, dz);
    }
  };

  // 4. Pooled Crash Explosion, Scrape & Near-Miss Sparks (InstancedMesh, zero per-frame allocations)
  const particleGeo = new THREE.OctahedronGeometry(0.45, 0);
  const particleMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, PARTICLE_POOL_SIZE);
  particleMesh.frustumCulled = false;
  particleMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(PARTICLE_POOL_SIZE * 3),
    3,
  );
  group.add(particleMesh);

  const particles: BurstParticle[] = Array.from({ length: PARTICLE_POOL_SIZE }, () => ({
    active: false,
    x: 0,
    y: -999,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    maxLife: 1,
    scale: 1,
    color: new THREE.Color(0xffaa44),
  }));

  const _dummy = new THREE.Object3D();
  let particleCursor = 0;

  const hideAllParticles = () => {
    _dummy.position.set(0, -999, 0);
    _dummy.scale.set(0.001, 0.001, 0.001);
    _dummy.updateMatrix();
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      particles[i].active = false;
      particleMesh.setMatrixAt(i, _dummy.matrix);
    }
    particleMesh.instanceMatrix.needsUpdate = true;
  };

  const emitParticle = (
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    maxLife: number,
    scale: number,
    hexColor: number,
  ) => {
    const p = particles[particleCursor];
    particleCursor = (particleCursor + 1) % PARTICLE_POOL_SIZE;
    p.active = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = maxLife;
    p.maxLife = maxLife;
    p.scale = scale;
    p.color.setHex(hexColor);
    particleMesh.setColorAt(
      particleCursor === 0 ? PARTICLE_POOL_SIZE - 1 : particleCursor - 1,
      p.color,
    );
  };

  const resetChunks = () => {
    for (let c = 0; c < CHUNK_COUNT; c++) {
      populateChunk(chunks[c], c);
    }
    initDustAround(0);
    hideAllParticles();
  };

  resetChunks();
  let dustClock = 0;

  return {
    group,
    getZoneFogColor: (z, outColor) => blendZoneColor(z, 'fog', outColor),
    setDifficulty: (difficulty) => {
      if (activeDifficulty === difficulty) return;
      activeDifficulty = difficulty;
      resetChunks();
      blendZoneColor(0, 'zenith', sky.uniforms.uZenithColor.value);
      blendZoneColor(0, 'mid', sky.uniforms.uMidSkyColor.value);
      blendZoneColor(0, 'horizon', sky.uniforms.uHorizonColor.value);
      blendZoneColor(0, 'fog', sky.uniforms.uGroundHazeColor.value);
    },
    triggerGatePass: (gateId) => {
      for (let c = 0; c < chunks.length; c++) {
        const gates = chunks[c].speedGates;
        for (let g = 0; g < gates.length; g++) {
          const lg = gates[g];
          if (lg.gate.id === gateId) {
            lg.passed = true;
            lg.rippleProgress = 0.001;
            lg.rippleRing.visible = true;
            lg.rippleRing.scale.set(1, 1, 1);
            lg.rippleMat.opacity = 1.0;
            lg.outerRingMat.color.setHex(0xffffff);
            return;
          }
        }
      }
    },
    spawnGateSparks: (x, y, z) => {
      const palette = [0xffffff, 0x67e8f9, 0xfde047, 0x38bdf8];
      for (let i = 0; i < 28; i++) {
        const angle = (i / 28) * Math.PI * 2 + Math.random() * 0.2;
        const radialSpd = 18 + Math.random() * 28;
        emitParticle(
          x + Math.cos(angle) * 3.5,
          y + Math.sin(angle) * 3.5,
          z,
          Math.cos(angle) * radialSpd,
          Math.sin(angle) * radialSpd,
          16 + Math.random() * 34,
          0.32 + Math.random() * 0.3,
          0.45 + Math.random() * 0.65,
          palette[i % palette.length],
        );
      }
      if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
    },
    reset: (difficulty) => {
      if (difficulty) {
        activeDifficulty = difficulty;
      }
      resetChunks();
      blendZoneColor(0, 'zenith', sky.uniforms.uZenithColor.value);
      blendZoneColor(0, 'mid', sky.uniforms.uMidSkyColor.value);
      blendZoneColor(0, 'horizon', sky.uniforms.uHorizonColor.value);
      blendZoneColor(0, 'fog', sky.uniforms.uGroundHazeColor.value);
    },
    spawnCrashExplosion: (x, y, z) => {
      const palette = [0xfff3c4, 0xff9a3c, 0xff521b, 0x7dd3fc];
      for (let i = 0; i < 48; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const spd = 16 + Math.random() * 52;
        emitParticle(
          x,
          y,
          z,
          Math.sin(phi) * Math.cos(theta) * spd,
          Math.abs(Math.cos(phi)) * spd * 0.9 + 6,
          Math.sin(phi) * Math.sin(theta) * spd,
          0.45 + Math.random() * 0.65,
          0.8 + Math.random() * 1.9,
          palette[i % palette.length],
        );
      }
      if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
    },
    spawnNearMissSparks: (x, y, z) => {
      const palette = [0xfef08a, 0xfbbf24, 0x7dd3fc];
      for (let i = 0; i < 16; i++) {
        emitParticle(
          x + (Math.random() - 0.5) * 4,
          y + (Math.random() - 0.5) * 2,
          z + 1.5,
          (Math.random() - 0.5) * 26,
          (Math.random() - 0.3) * 14,
          28 + Math.random() * 32,
          0.26 + Math.random() * 0.28,
          0.35 + Math.random() * 0.55,
          palette[i % palette.length],
        );
      }
      if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
    },
    spawnScrapeSparks: (x, y, z) => {
      const palette = [0xfff4c2, 0xffa726, 0xff5722, 0xffd54f];
      for (let i = 0; i < 24; i++) {
        emitParticle(
          x + (Math.random() - 0.5) * 4.5,
          y + (Math.random() - 0.5) * 1.6,
          z + 1.0,
          (Math.random() - 0.5) * 34,
          4 + Math.random() * 18,
          22 + Math.random() * 38,
          0.3 + Math.random() * 0.32,
          0.42 + Math.random() * 0.65,
          palette[i % palette.length],
        );
      }
      if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
    },
    update: (dt, craftX, craftY, craftZ, worldTime) => {
      // Keep sky dome centered & smoothly blend sky palette across Martian zones
      sky.mesh.position.set(craftX, craftY * 0.2, craftZ);
      blendZoneColor(craftZ, 'zenith', sky.uniforms.uZenithColor.value);
      blendZoneColor(craftZ, 'mid', sky.uniforms.uMidSkyColor.value);
      blendZoneColor(craftZ, 'horizon', sky.uniforms.uHorizonColor.value);
      blendZoneColor(craftZ, 'fog', sky.uniforms.uGroundHazeColor.value);

      // Recycle chunks that have passed behind the camera
      const currentChunkIdx = Math.max(0, Math.floor(-craftZ / CHUNK_LENGTH));
      let highestIndex = -1;
      for (let i = 0; i < chunks.length; i++) {
        if (chunks[i].index > highestIndex) highestIndex = chunks[i].index;
      }

      for (let i = 0; i < chunks.length; i++) {
        const ch = chunks[i];
        if (ch.index < currentChunkIdx - 1) {
          highestIndex += 1;
          populateChunk(ch, highestIndex);
        }

        // Animate drifting swirling red dust devils in sync with simulation clock!
        for (let d = 0; d < ch.dustDevils.length; d++) {
          const dd = ch.dustDevils[d];
          dd.group.position.x = getDustDevilX(dd.obs, worldTime);
          for (let r = 0; r < dd.rings.length; r++) {
            dd.rings[r].rotation.y += dt * (3.2 + r * 0.55) * (r % 2 === 0 ? 1 : -1);
          }
        }

        // Animate holographic rotating Speed Gate segments & pass-through flash ripples
        for (let g = 0; g < ch.speedGates.length; g++) {
          const lg = ch.speedGates[g];
          lg.outerSpinner.rotation.z += dt * (lg.passed ? 4.2 : 1.05);
          lg.innerSpinner.rotation.z -= dt * (lg.passed ? 5.6 : 1.65);

          if (lg.rippleProgress > 0 && lg.rippleProgress < 1) {
            lg.rippleProgress = Math.min(1, lg.rippleProgress + dt * 2.4);
            const ease = 1 - Math.pow(1 - lg.rippleProgress, 2.5);
            const s = 1 + ease * 1.45;
            lg.rippleRing.scale.set(s, s, 1);
            lg.rippleMat.opacity = (1 - lg.rippleProgress) * 0.95;
            lg.outerRingMat.opacity = Math.max(0.22, 0.95 - lg.rippleProgress * 0.72);
            if (lg.rippleProgress >= 1) {
              lg.rippleRing.visible = false;
            }
          }
        }
      }

      // Drift & recycle swirling red Martian dust clouds near canyon floor
      dustClock += dt;
      for (let i = 0; i < dustClouds.length; i++) {
        const dc = dustClouds[i];
        const sp = dc.sprite;
        sp.position.x += Math.sin(dustClock * 0.7 + dc.phase) * dc.driftSpeed * dt;
        if (sp.position.z > craftZ + 55) {
          const newZ = craftZ - 610 - Math.random() * 140;
          const cx = getCanyonCenterX(newZ, activeDifficulty);
          const hw = getCanyonHalfWidth(newZ, activeDifficulty);
          const newX = cx + dc.offsetX * hw * 0.85;
          sp.position.set(newX, getValleyFloorHeight(newX, newZ) + 4.5 + (i % 3) * 3.5, newZ);
        }
      }

      // Update pooled particles in-place
      let anyActive = false;
      for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
        const p = particles[i];
        if (!p.active) continue;
        anyActive = true;
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          _dummy.position.set(0, -999, 0);
          _dummy.scale.set(0.001, 0.001, 0.001);
          _dummy.updateMatrix();
          particleMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }

        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vy -= 18 * dt;

        const ratio = p.life / p.maxLife;
        const s = p.scale * ratio;
        _dummy.position.set(p.x, p.y, p.z);
        _dummy.rotation.set(p.life * 6, p.life * 4, 0);
        _dummy.scale.set(s, s, s);
        _dummy.updateMatrix();
        particleMesh.setMatrixAt(i, _dummy.matrix);
      }

      if (anyActive) {
        particleMesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose: () => {
      sky.dispose();
      for (const ch of chunks) {
        clearChunkObstacles(ch);
        ch.geometry.dispose();
      }
      dustMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
    },
  };
}
