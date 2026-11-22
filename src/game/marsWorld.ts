import * as THREE from 'three';
import type { MarsMaterialLibrary } from './materials';
import {
  CHUNK_LENGTH,
  TERRAIN_WIDTH,
  fbm2D,
  getCanyonCenterX,
  getCanyonHalfWidth,
  getObstaclesForChunk,
  getTerrainHeight,
  getValleyFloorHeight,
} from './terrainMath';
import type { CanyonObstacle } from './types';

const CHUNK_COUNT = 6;
const SEGMENTS_X = 46;
const SEGMENTS_Z = 28;
const DUST_CLOUD_COUNT = 32;
const PARTICLE_POOL_SIZE = 72;

export const SUN_DIRECTION = new THREE.Vector3(0.62, 0.25, -0.74).normalize();
export const HORIZON_FOG_COLOR = 0xc95a2b;

interface TerrainChunk {
  index: number;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  obstacleGroup: THREE.Group;
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
  update: (dt: number, craftX: number, craftY: number, craftZ: number) => void;
  spawnCrashExplosion: (x: number, y: number, z: number) => void;
  spawnNearMissSparks: (x: number, y: number, z: number) => void;
  spawnScrapeSparks: (x: number, y: number, z: number) => void;
  reset: () => void;
  dispose: () => void;
}

/**
 * Computes rich stratified Martian sandstone vertex color based on elevation & slope/noise.
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

  if (y < 7.5) {
    // Sunlit dusty Martian valley ochre-rust regolith (authored in sRGB, converted to linear)
    const t = Math.max(0, Math.min(1, y / 7.5));
    outColor
      .setRGB(
        0.74 - t * 0.1 + n * 0.08,
        0.34 - t * 0.07 + n * 0.04,
        0.17 - t * 0.04,
      )
      .convertSRGBToLinear();
  } else {
    // Rich stratified iron-oxide canyon walls: deep burnt rust, dark basalt crevices, sunlit terracotta crests
    const heightGlow = Math.min(1, (y - 7.5) / 90);
    const r = 0.52 + strata * 0.24 + heightGlow * 0.12 + band * 0.06;
    const g = 0.18 + strata * 0.12 + heightGlow * 0.07;
    const b = 0.09 + strata * 0.05 + band * 0.02;
    outColor.setRGB(r, g, b).convertSRGBToLinear();
  }
}

/**
 * Builds a custom craggy Martian rock spire geometry with jagged facets & stratified vertex colors.
 */
function createJaggedSpireGeometry(
  radius: number,
  height: number,
  seed: number,
  tint: number,
): THREE.BufferGeometry {
  const radialSegs = 9;
  const heightSegs = 7;
  const geo = new THREE.CylinderGeometry(radius * 0.14, radius * 1.15, height, radialSegs, heightSegs, false);
  // Pivot at bottom-center so it anchors cleanly into the Martian valley floor
  geo.translate(0, height * 0.5, 0);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tmpColor = new THREE.Color();

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
    // Slight rocky terrace ledges
    const ledge = 1 - Math.sin(hRatio * Math.PI * 5) * 0.06;

    vx *= crag * ledge;
    vz *= crag * ledge;

    // Slight dramatic spire lean
    vx += Math.sin(seed * 4.3) * hRatio * radius * 0.28;
    vz += Math.cos(seed * 3.1) * hRatio * radius * 0.22;

    if (hRatio > 0.96) {
      vy += Math.sin(angle * 2 + seed) * 2.2;
    }

    pos.setXYZ(i, vx, vy, vz);

    const strata = Math.sin(vy * 0.34 + seed * 3) * 0.5 + 0.5;
    tmpColor
      .setRGB(
        0.54 + strata * 0.24 + tint * 0.07,
        0.19 + strata * 0.1 + tint * 0.03,
        0.09 + strata * 0.045,
      )
      .convertSRGBToLinear();
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a monumental sculpted Martian natural rock arch spanning over the canyon
 * using a curved CatmullRom TubeGeometry with rugged rock displacement + anchored flanking pillars.
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

  // Curved natural sandstone bridge curve rooted deep below floor on both sides
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
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);

    // Sculpt craggy organic sandstone irregularity along the arch
    const jitter =
      1 +
      Math.sin(vx * 0.19 + vy * 0.25) * 0.16 +
      Math.cos(vy * 0.42 - vz * 0.31) * 0.11;
    // Thicker base pillars, sleeker high rock bridge crown
    const baseThick = vy < obs.height * 0.55 ? 1.24 : 0.96;

    pos.setXYZ(i, vx * (0.96 + 0.04 * jitter), vy + Math.sin(vx * 0.14) * 1.2, vz * jitter * baseThick);

    const strata = Math.sin(vy * 0.3 + vx * 0.06) * 0.5 + 0.5;
    c.setRGB(
      0.56 + strata * 0.24 + obs.tint * 0.06,
      0.2 + strata * 0.11 + obs.tint * 0.03,
      0.1 + strata * 0.045,
    ).convertSRGBToLinear();
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  tubeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  tubeGeo.computeVertexNormals();

  const archMesh = new THREE.Mesh(tubeGeo, rockMaterial);
  archMesh.castShadow = true;
  archMesh.receiveShadow = true;
  archGroup.add(archMesh);

  // Add jagged rock shoulder crags anchoring both arch footings
  for (const side of [-1, 1] as const) {
    const footingGeo = createJaggedSpireGeometry(
      obs.thickness * 1.25,
      obs.height * 0.52,
      obs.z * 0.01 + side * 3.1,
      obs.tint,
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
 * Custom Martian atmospheric sky dome shader with dusty orange-amber glow,
 * bright distant sun with halo, and warm ground-haze band.
 */
function createMartianSkyDome(): { mesh: THREE.Mesh; dispose: () => void } {
  const skyGeo = new THREE.SphereGeometry(920, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: SUN_DIRECTION.clone() },
      uZenithColor: { value: new THREE.Color('#3b1512') },
      uMidSkyColor: { value: new THREE.Color('#a63f1f') },
      uHorizonColor: { value: new THREE.Color('#e67b40') },
      uGroundHazeColor: { value: new THREE.Color('#cf5d2b') },
      uSunColor: { value: new THREE.Color('#fff5d6') },
    },
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

        // Vertical atmospheric Martian dust gradient
        vec3 col = mix(uHorizonColor, uMidSkyColor, smoothstep(0.0, 0.28, elev));
        col = mix(col, uZenithColor, smoothstep(0.24, 0.85, elev));

        // Warm dusty ground glow below horizon
        col = mix(col, uGroundHazeColor, smoothstep(0.02, -0.18, elev));

        // Bright distant Martian sun + wide dusty Mie amber scattering halo
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        float wideGlow = pow(sunDot, 5.0) * 0.42;
        float tightHalo = pow(sunDot, 42.0) * 0.72;
        float sunDisc = smoothstep(0.9986, 0.99945, sunDot);

        col += vec3(1.0, 0.62, 0.28) * wideGlow;
        col += vec3(1.0, 0.86, 0.58) * tightHalo;
        col = mix(col, uSunColor * 1.45, sunDisc);

        // Subtle sunlit horizon dust band
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

  // 2. Recycled Endless Terrain Chunks + Obstacles
  const chunks: TerrainChunk[] = [];
  const tmpColor = new THREE.Color();

  const clearChunkObstacles = (chunk: TerrainChunk) => {
    while (chunk.obstacleGroup.children.length > 0) {
      const child = chunk.obstacleGroup.children[0];
      chunk.obstacleGroup.remove(child);
      child.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          (obj as THREE.Mesh).geometry.dispose();
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
      const centerX = getCanyonCenterX(worldZ);

      for (let ix = 0; ix <= SEGMENTS_X; ix++) {
        const xFrac = ix / SEGMENTS_X - 0.5;
        // Denser vertex sampling near the canyon walls for crisp cliff silhouettes
        const shapedX = Math.sign(xFrac) * Math.pow(Math.abs(xFrac) * 2, 1.18) * 0.5;
        const worldX = centerX + shapedX * TERRAIN_WIDTH;
        const worldY = getTerrainHeight(worldX, worldZ);

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

    // Rebuild dramatic chunk spires, giant rock arches, and wall buttresses
    clearChunkObstacles(chunk);
    const obstacles = getObstaclesForChunk(chunkIndex);
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      if (obs.kind === 'arch') {
        const arch = createRockArchGroup(obs, materials.rockObstacleMaterial);
        chunk.obstacleGroup.add(arch);
      } else {
        const spireGeo = createJaggedSpireGeometry(
          obs.radius,
          obs.height,
          chunkIndex * 11 + i * 3.7,
          obs.tint,
        );
        const spireMesh = new THREE.Mesh(spireGeo, materials.rockObstacleMaterial);
        spireMesh.position.set(obs.x, obs.y, obs.z);
        spireMesh.rotation.y = obs.yaw;
        spireMesh.castShadow = true;
        spireMesh.receiveShadow = true;
        chunk.obstacleGroup.add(spireMesh);
      }
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

    const chunk: TerrainChunk = {
      index: c - 1,
      mesh,
      geometry: geo,
      obstacleGroup,
    };
    chunks.push(chunk);
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
  const dustClouds: { sprite: THREE.Sprite; driftSpeed: number; phase: number; offsetX: number }[] = [];
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
    for (let i = 0; i < dustClouds.length; i++) {
      const dc = dustClouds[i];
      const dz = craftZ - (i / dustClouds.length) * 680 + 30;
      const cx = getCanyonCenterX(dz);
      const hw = getCanyonHalfWidth(dz);
      const x = cx + dc.offsetX * hw * 0.85;
      const y = getValleyFloorHeight(x, dz) + 4.5 + (i % 3) * 3.2;
      dc.sprite.position.set(x, y, dz);
    }
  };

  // 4. Pooled Crash Explosion & Near-Miss Sparks (InstancedMesh, zero per-frame allocations)
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
    particleMesh.setColorAt(particleCursor === 0 ? PARTICLE_POOL_SIZE - 1 : particleCursor - 1, p.color);
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
    reset: () => {
      resetChunks();
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
    update: (dt, craftX, craftY, craftZ) => {
      // Keep sky dome centered on the player so horizon never clips
      sky.mesh.position.set(craftX, craftY * 0.2, craftZ);

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
      }

      // Drift & recycle swirling red Martian dust clouds near canyon floor
      dustClock += dt;
      for (let i = 0; i < dustClouds.length; i++) {
        const dc = dustClouds[i];
        const sp = dc.sprite;
        sp.position.x += Math.sin(dustClock * 0.7 + dc.phase) * dc.driftSpeed * dt;
        if (sp.position.z > craftZ + 55) {
          const newZ = craftZ - 610 - Math.random() * 140;
          const cx = getCanyonCenterX(newZ);
          const hw = getCanyonHalfWidth(newZ);
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
