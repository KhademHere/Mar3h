import * as THREE from 'three';
import type { MarsMaterialLibrary } from './materials';

const TRAIL_SEGMENTS = 38;

export interface SpacecraftRig {
  group: THREE.Group;
  hullRoot: THREE.Group;
  trailGroup: THREE.Group;
  updateVisuals: (
    dt: number,
    mach: number,
    boosting: boolean,
    roll: number,
    worldPos: THREE.Vector3,
    worldQuat: THREE.Quaternion,
  ) => void;
  triggerShockwave: (intensity?: number) => void;
  resetTrails: (worldPos: THREE.Vector3) => void;
  setVisible: (visible: boolean) => void;
  setCockpitMode: (isCockpit: boolean) => void;
  dispose: () => void;
}

/**
 * Helper that creates an in-place updated glowing wingtip ribbon trail (zero per-frame GC).
 */
class WingtipTrail {
  public readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly points: THREE.Vector3[];

  constructor() {
    this.points = Array.from({ length: TRAIL_SEGMENTS }, () => new THREE.Vector3());
    // 2 vertices per segment (ribbon width)
    this.positions = new Float32Array(TRAIL_SEGMENTS * 2 * 3);
    this.colors = new Float32Array(TRAIL_SEGMENTS * 2 * 3);

    const indices: number[] = [];
    for (let i = 0; i < TRAIL_SEGMENTS - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setIndex(indices);

    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  public reset(anchor: THREE.Vector3): void {
    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
      this.points[i].copy(anchor);
    }
    this.rebuildGeometry(0.18, 0.7);
  }

  public pushPoint(anchor: THREE.Vector3, width: number, brightness: number): void {
    // Shift trail points backward in-place (zero allocation)
    for (let i = TRAIL_SEGMENTS - 1; i > 0; i--) {
      this.points[i].copy(this.points[i - 1]);
    }
    this.points[0].copy(anchor);
    this.rebuildGeometry(width, brightness);
  }

  private rebuildGeometry(baseWidth: number, brightness: number): void {
    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
      const t = i / (TRAIL_SEGMENTS - 1);
      const fade = Math.pow(1 - t, 1.85);
      const halfW = baseWidth * (0.28 + 0.72 * fade);
      const p = this.points[i];

      const vIdx = i * 6;
      // Ribbon aligned horizontally/slightly angled for crisp rear visibility
      this.positions[vIdx] = p.x - halfW;
      this.positions[vIdx + 1] = p.y;
      this.positions[vIdx + 2] = p.z;

      this.positions[vIdx + 3] = p.x + halfW;
      this.positions[vIdx + 4] = p.y;
      this.positions[vIdx + 5] = p.z;

      // Bright white-cyan core fading into electric sky-blue tail
      const r = (0.45 + 0.55 * fade) * fade * brightness;
      const g = (0.82 + 0.18 * fade) * fade * brightness;
      const b = 1.0 * fade * brightness;

      this.colors[vIdx] = r;
      this.colors[vIdx + 1] = g;
      this.colors[vIdx + 2] = b;

      this.colors[vIdx + 3] = r;
      this.colors[vIdx + 4] = g;
      this.colors[vIdx + 5] = b;
    }

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Builds the composite 12-part futuristic needle-nosed supersonic Martian space jet
 * facing -Z (forward into the canyon).
 */
export function createSpacecraftRig(materials: MarsMaterialLibrary): SpacecraftRig {
  const group = new THREE.Group();
  const hullRoot = new THREE.Group();
  group.add(hullRoot);

  const disposables: THREE.BufferGeometry[] = [];
  const customMaterials: THREE.Material[] = [];

  // 1. Needle nose cone (LatheGeometry rotated to point toward -Z)
  const noseProfile = [
    new THREE.Vector2(0.0, 3.6),
    new THREE.Vector2(0.14, 2.7),
    new THREE.Vector2(0.36, 1.5),
    new THREE.Vector2(0.56, 0.2),
    new THREE.Vector2(0.62, -0.5),
  ];
  const noseGeo = new THREE.LatheGeometry(noseProfile, 20);
  noseGeo.rotateX(-Math.PI / 2);
  noseGeo.scale(1.15, 0.74, 1.0);
  noseGeo.translate(0, 0.0, -1.6);
  disposables.push(noseGeo);
  const noseMesh = new THREE.Mesh(noseGeo, materials.hullMaterial);
  noseMesh.castShadow = true;
  noseMesh.receiveShadow = true;
  hullRoot.add(noseMesh);

  // 2. Dark carbon-ceramic thermal nose tip & pitot needle spike (open-ended so cockpit view never sees flat base cap)
  const noseTipGeo = new THREE.ConeGeometry(0.145, 1.32, 16, 1, true);
  noseTipGeo.rotateX(-Math.PI / 2);
  noseTipGeo.translate(0, 0, -5.08);
  disposables.push(noseTipGeo);
  const noseTipMesh = new THREE.Mesh(noseTipGeo, materials.wingMaterial);
  hullRoot.add(noseTipMesh);

  const pitotGeo = new THREE.CylinderGeometry(0.018, 0.04, 0.9, 8);
  pitotGeo.rotateX(-Math.PI / 2);
  pitotGeo.translate(0, 0, -5.9);
  disposables.push(pitotGeo);
  const pitotMesh = new THREE.Mesh(pitotGeo, materials.metalIntakeMaterial);
  hullRoot.add(pitotMesh);

  // 3. Sculpted main supersonic fuselage spine (beveled ExtrudeGeometry)
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(0, -1.8);
  bodyShape.lineTo(0.86, -0.4);
  bodyShape.lineTo(0.78, 2.35);
  bodyShape.lineTo(0.38, 2.85);
  bodyShape.lineTo(-0.38, 2.85);
  bodyShape.lineTo(-0.78, 2.35);
  bodyShape.lineTo(-0.86, -0.4);
  bodyShape.closePath();

  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth: 0.44,
    bevelEnabled: true,
    bevelThickness: 0.16,
    bevelSize: 0.14,
    bevelSegments: 2,
  });
  bodyGeo.rotateX(Math.PI / 2);
  bodyGeo.translate(0, 0.24, 0);
  disposables.push(bodyGeo);
  const bodyMesh = new THREE.Mesh(bodyGeo, materials.hullMaterial);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  hullRoot.add(bodyMesh);

  // 4. Sleek obsidian-glass cockpit canopy
  const canopyGeo = new THREE.SphereGeometry(0.46, 20, 14);
  canopyGeo.scale(0.95, 0.62, 3.05);
  canopyGeo.translate(0, 0.38, -0.95);
  disposables.push(canopyGeo);
  const canopyMesh = new THREE.Mesh(canopyGeo, materials.canopyMaterial);
  canopyMesh.castShadow = true;
  hullRoot.add(canopyMesh);

  // Dorsal spine fairing running behind canopy
  const spineGeo = new THREE.BoxGeometry(0.38, 0.32, 2.55);
  spineGeo.translate(0, 0.34, 1.15);
  disposables.push(spineGeo);
  const spineMesh = new THREE.Mesh(spineGeo, materials.hullMaterial);
  hullRoot.add(spineMesh);

  // 5. Razor-sharp swept delta main wings (port + starboard)
  const makeWingGeo = (side: 1 | -1) => {
    const s = new THREE.Shape();
    s.moveTo(0.5 * side, -1.35);
    s.lineTo(3.45 * side, 1.65);
    s.lineTo(3.65 * side, 2.15);
    s.lineTo(2.45 * side, 2.35);
    s.lineTo(0.55 * side, 2.15);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.04,
      bevelSegments: 1,
    });
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.04, 0.2);
    disposables.push(g);
    return g;
  };

  const leftWing = new THREE.Mesh(makeWingGeo(-1), materials.wingMaterial);
  leftWing.castShadow = true;
  leftWing.receiveShadow = true;
  const rightWing = new THREE.Mesh(makeWingGeo(1), materials.wingMaterial);
  rightWing.castShadow = true;
  rightWing.receiveShadow = true;
  hullRoot.add(leftWing, rightWing);

  // 6. Vermilion-amber supersonic wing leading-edge racing trim stripes
  const makeStripeGeo = (side: 1 | -1) => {
    const s = new THREE.Shape();
    s.moveTo(0.85 * side, -0.95);
    s.lineTo(3.18 * side, 1.48);
    s.lineTo(2.9 * side, 1.62);
    s.lineTo(0.82 * side, -0.58);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false });
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.095, 0.2);
    disposables.push(g);
    return g;
  };
  hullRoot.add(
    new THREE.Mesh(makeStripeGeo(-1), materials.accentTrimMaterial),
    new THREE.Mesh(makeStripeGeo(1), materials.accentTrimMaterial),
  );

  // 7. Forward supersonic canards near the needle nose
  const makeCanardGeo = (side: 1 | -1) => {
    const s = new THREE.Shape();
    s.moveTo(0.32 * side, -2.55);
    s.lineTo(1.22 * side, -1.78);
    s.lineTo(1.12 * side, -1.52);
    s.lineTo(0.42 * side, -1.85);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 1,
    });
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.02, 0);
    disposables.push(g);
    return g;
  };
  hullRoot.add(
    new THREE.Mesh(makeCanardGeo(-1), materials.hullMaterial),
    new THREE.Mesh(makeCanardGeo(1), materials.hullMaterial),
  );

  // 8. Twin canted V-tail vertical stabilizers
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(1.35, 0);
  finShape.lineTo(1.78, 1.15);
  finShape.lineTo(1.32, 1.24);
  finShape.lineTo(0.28, 0.25);
  finShape.closePath();

  const finGeo = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.055,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.018,
    bevelSegments: 1,
  });
  finGeo.rotateY(Math.PI / 2);
  disposables.push(finGeo);

  const leftFin = new THREE.Mesh(finGeo, materials.wingMaterial);
  leftFin.position.set(-0.78, 0.18, 2.42);
  leftFin.rotation.z = 0.42;
  leftFin.castShadow = true;

  const rightFin = new THREE.Mesh(finGeo, materials.wingMaterial);
  rightFin.position.set(0.78, 0.18, 2.42);
  rightFin.rotation.z = -0.42;
  rightFin.castShadow = true;
  hullRoot.add(leftFin, rightFin);

  // 9. Twin supersonic side engine nacelles & metallic exhaust nozzles
  const nacelleGeo = new THREE.CylinderGeometry(0.32, 0.38, 2.95, 14);
  nacelleGeo.rotateX(Math.PI / 2);
  disposables.push(nacelleGeo);

  const nozzleRingGeo = new THREE.TorusGeometry(0.27, 0.055, 10, 20);
  disposables.push(nozzleRingGeo);

  const nozzleGlowMat = new THREE.MeshBasicMaterial({
    color: 0xd8f8ff,
  });
  customMaterials.push(nozzleGlowMat);

  // Inner intense electric-blue jet core right out of both nozzles
  const plumeCoreMat = new THREE.MeshBasicMaterial({
    color: 0xe6f9ff,
    transparent: true,
    opacity: 0.94,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // Secondary electric blue-cyan cruise / boost inner sheath
  const plumeOuterMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.62,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // Fiery crimson-red outer plasma envelope (NormalBlending preserves vivid crimson against bright Mars dust!)
  const plumeRedSheathMat = new THREE.MeshBasicMaterial({
    color: 0xf01830,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Long blazing crimson-red trailing plasma tail flare (AdditiveBlending for luminous outer glow)
  const plumeRedFlareMat = new THREE.MeshBasicMaterial({
    color: 0xff2238,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // Pulsing shock-diamond flame rings flickering down the afterburner exhaust stream
  const shockDiamondBlueMat = new THREE.MeshBasicMaterial({
    color: 0x38e8ff,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const shockDiamondRedMat = new THREE.MeshBasicMaterial({
    color: 0xff263e,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  customMaterials.push(
    plumeCoreMat,
    plumeOuterMat,
    plumeRedSheathMat,
    plumeRedFlareMat,
    shockDiamondBlueMat,
    shockDiamondRedMat,
  );

  const coreConeGeo = new THREE.ConeGeometry(0.185, 2.55, 14, 1, true);
  coreConeGeo.rotateX(Math.PI / 2);
  coreConeGeo.translate(0, 0, 1.28);
  disposables.push(coreConeGeo);

  const outerConeGeo = new THREE.ConeGeometry(0.31, 3.65, 14, 1, true);
  outerConeGeo.rotateX(Math.PI / 2);
  outerConeGeo.translate(0, 0, 1.82);
  disposables.push(outerConeGeo);

  const redSheathGeo = new THREE.ConeGeometry(0.45, 5.4, 16, 1, true);
  redSheathGeo.rotateX(Math.PI / 2);
  redSheathGeo.translate(0, 0, 3.35);
  disposables.push(redSheathGeo);

  const redFlareGeo = new THREE.ConeGeometry(0.58, 6.8, 14, 1, true);
  redFlareGeo.rotateX(Math.PI / 2);
  redFlareGeo.translate(0, 0, 3.95);
  disposables.push(redFlareGeo);

  const shockDiamondGeo = new THREE.TorusGeometry(0.24, 0.055, 8, 18);
  disposables.push(shockDiamondGeo);

  const enginePlumes: THREE.Group[] = [];
  const redSheathCones: THREE.Mesh[] = [];
  const redFlareCones: THREE.Mesh[] = [];
  const shockDiamondSets: THREE.Mesh[][] = [];
  const engineHaloSprites: THREE.Sprite[] = [];
  const engineRedHaloSprites: THREE.Sprite[] = [];

  const haloBlueMat = new THREE.SpriteMaterial({
    map: materials.glowTexture,
    color: 0x38d9ff,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const haloRedMat = new THREE.SpriteMaterial({
    map: materials.glowTexture,
    color: 0xff2238,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  customMaterials.push(haloBlueMat, haloRedMat);

  for (const side of [-1, 1] as const) {
    const nx = 0.58 * side;
    const nacelle = new THREE.Mesh(nacelleGeo, materials.metalIntakeMaterial);
    nacelle.position.set(nx, -0.02, 1.48);
    nacelle.castShadow = true;
    hullRoot.add(nacelle);

    const ring = new THREE.Mesh(nozzleRingGeo, nozzleGlowMat);
    ring.position.set(nx, -0.02, 2.96);
    hullRoot.add(ring);

    const plumeGroup = new THREE.Group();
    plumeGroup.position.set(nx, -0.02, 2.94);

    // Explicit render order: crimson outer plasma sheath -> crimson flare -> electric-blue sheath -> electric-blue core -> shock diamonds
    const redSheath = new THREE.Mesh(redSheathGeo, plumeRedSheathMat);
    redSheath.renderOrder = 1;
    plumeGroup.add(redSheath);
    redSheathCones.push(redSheath);

    const redFlare = new THREE.Mesh(redFlareGeo, plumeRedFlareMat);
    redFlare.renderOrder = 2;
    plumeGroup.add(redFlare);
    redFlareCones.push(redFlare);

    const outerCone = new THREE.Mesh(outerConeGeo, plumeOuterMat);
    outerCone.renderOrder = 3;
    plumeGroup.add(outerCone);

    const coreCone = new THREE.Mesh(coreConeGeo, plumeCoreMat);
    coreCone.renderOrder = 4;
    plumeGroup.add(coreCone);

    // 4 pulsing shock-diamond flame rings spaced down the exhaust stream
    const diamonds: THREE.Mesh[] = [];
    for (let d = 0; d < 4; d++) {
      const dm = new THREE.Mesh(
        shockDiamondGeo,
        d < 2 ? shockDiamondBlueMat : shockDiamondRedMat,
      );
      dm.position.z = 0.78 + d * 0.96;
      const baseRadius = 1.0 - d * 0.14;
      dm.scale.set(baseRadius, baseRadius, 1);
      dm.visible = false;
      plumeGroup.add(dm);
      diamonds.push(dm);
    }
    shockDiamondSets.push(diamonds);

    hullRoot.add(plumeGroup);
    enginePlumes.push(plumeGroup);

    const blueSprite = new THREE.Sprite(haloBlueMat);
    blueSprite.position.set(nx, -0.02, 3.06);
    blueSprite.scale.set(1.08, 1.08, 1);
    hullRoot.add(blueSprite);
    engineHaloSprites.push(blueSprite);

    const redSprite = new THREE.Sprite(haloRedMat);
    redSprite.position.set(nx, -0.02, 3.7);
    redSprite.scale.set(1.85, 1.85, 1);
    hullRoot.add(redSprite);
    engineRedHaloSprites.push(redSprite);
  }

  // Dual flickering thruster PointLights:
  // 1) Electric blue right at nozzles illuminating tail fins & wings
  // 2) Blazing crimson-red aft & slightly lower casting rich flickering glow across wings & Martian canyon floor
  const engineLightBlue = new THREE.PointLight(0x38d9ff, 9, 22, 1.8);
  engineLightBlue.position.set(0, 0.35, 3.35);
  hullRoot.add(engineLightBlue);

  const engineLightRed = new THREE.PointLight(0xff2036, 0, 42, 1.5);
  engineLightRed.position.set(0, -0.45, 5.2);
  hullRoot.add(engineLightRed);

  // 10. Crisp Expanding Supersonic Mach Shockwave Double-Ring around the wings
  const shockwaveGroup = new THREE.Group();
  shockwaveGroup.position.set(0, 0.05, 0.85);
  shockwaveGroup.visible = false;
  group.add(shockwaveGroup);

  const shockRingGeo = new THREE.TorusGeometry(2.7, 0.085, 12, 52);
  disposables.push(shockRingGeo);
  const shockRingMat = new THREE.MeshBasicMaterial({
    color: 0xdff7ff,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  customMaterials.push(shockRingMat);
  const shockRingMesh = new THREE.Mesh(shockRingGeo, shockRingMat);
  shockwaveGroup.add(shockRingMesh);

  const outerRingGeo = new THREE.TorusGeometry(3.2, 0.045, 10, 52);
  disposables.push(outerRingGeo);
  const vaporConeMat = new THREE.MeshBasicMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  customMaterials.push(vaporConeMat);
  const vaporConeMesh = new THREE.Mesh(outerRingGeo, vaporConeMat);
  vaporConeMesh.position.z = 0.45;
  shockwaveGroup.add(vaporConeMesh);

  // 11. World-space wingtip plasma ribbon trails + pooled Blue-and-Red Afterburner Spark Wisps
  const trailGroup = new THREE.Group();
  const leftTrail = new WingtipTrail();
  const rightTrail = new WingtipTrail();
  trailGroup.add(leftTrail.mesh, rightTrail.mesh);

  const SPARK_COUNT = 44;
  const sparkGeo = new THREE.BoxGeometry(0.11, 0.11, 1.35);
  disposables.push(sparkGeo);
  const sparkMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  customMaterials.push(sparkMat);
  const sparkMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, SPARK_COUNT);
  sparkMesh.frustumCulled = false;
  trailGroup.add(sparkMesh);

  interface ExhaustSpark {
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
    isBlue: boolean;
  }
  const sparks: ExhaustSpark[] = Array.from({ length: SPARK_COUNT }, () => ({
    active: false,
    x: 0,
    y: -999,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    maxLife: 0.3,
    scale: 1,
    isBlue: false,
  }));
  const _sparkDummy = new THREE.Object3D();
  const _sparkBlueColor = new THREE.Color(0x38e2ff);
  const _sparkRedColor = new THREE.Color(0xff2238);
  for (let i = 0; i < SPARK_COUNT; i++) {
    _sparkDummy.position.set(0, -999, 0);
    _sparkDummy.scale.set(0.001, 0.001, 0.001);
    _sparkDummy.updateMatrix();
    sparkMesh.setMatrixAt(i, _sparkDummy.matrix);
    sparkMesh.setColorAt(i, i % 3 === 0 ? _sparkBlueColor : _sparkRedColor);
  }
  sparkMesh.instanceMatrix.needsUpdate = true;
  if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;

  // Pre-allocated scratch vectors & colors for zero-GC update
  const _leftTipLocal = new THREE.Vector3(-3.52, 0.02, 2.05);
  const _rightTipLocal = new THREE.Vector3(3.52, 0.02, 2.05);
  const _leftNozzleLocal = new THREE.Vector3(-0.58, -0.02, 3.35);
  const _rightNozzleLocal = new THREE.Vector3(0.58, -0.02, 3.35);
  const _leftTipWorld = new THREE.Vector3();
  const _rightTipWorld = new THREE.Vector3();
  const _nozzleWorld = new THREE.Vector3();
  const _aftDirWorld = new THREE.Vector3();

  const _cruiseCoreColor = new THREE.Color(0xe6f9ff);
  const _boostCoreColor = new THREE.Color(0x2cd4ff);
  const _cruiseOuterColor = new THREE.Color(0x38bdf8);
  const _boostOuterColor = new THREE.Color(0x0ea5ff);
  const _cruiseNozzleColor = new THREE.Color(0xd8f8ff);
  const _boostNozzleColor = new THREE.Color(0x4de8ff);
  const _tmpColor = new THREE.Color();

  let shockwaveTimer = 0;
  let shockwaveDuration = 0.65;
  let shockwavePeakScale = 2.6;
  let flickerClock = 0;
  let boostVisual = 0; // 0 (normal cruising light-blue) -> 1 (full blazing electric-blue + crimson-red!)
  let ignitionFlash = 0; // crisp burst flash when afterburner engages
  let wasBoosting = false;
  let sparkSpawnAccum = 0;
  let sparkCursor = 0;

  return {
    group,
    hullRoot,
    trailGroup,
    triggerShockwave: (intensity = 1.0) => {
      shockwaveDuration = 0.48;
      shockwaveTimer = shockwaveDuration;
      shockwavePeakScale = 2.0 + intensity * 0.85;
      shockwaveGroup.visible = true;
    },
    resetTrails: (worldPos: THREE.Vector3) => {
      _leftTipWorld.copy(worldPos).add(_leftTipLocal);
      _rightTipWorld.copy(worldPos).add(_rightTipLocal);
      leftTrail.reset(_leftTipWorld);
      rightTrail.reset(_rightTipWorld);
      boostVisual = 0;
      ignitionFlash = 0;
      wasBoosting = false;
      for (let i = 0; i < SPARK_COUNT; i++) {
        sparks[i].active = false;
        _sparkDummy.position.set(0, -999, 0);
        _sparkDummy.scale.set(0.001, 0.001, 0.001);
        _sparkDummy.updateMatrix();
        sparkMesh.setMatrixAt(i, _sparkDummy.matrix);
      }
      sparkMesh.instanceMatrix.needsUpdate = true;
    },
    setVisible: (visible: boolean) => {
      group.visible = visible;
      trailGroup.visible = visible;
    },
    setCockpitMode: (isCockpit: boolean) => {
      // Hide opaque canopy dome & rear spine when camera sits inside the glass cockpit
      canopyMesh.visible = !isCockpit;
      spineMesh.visible = !isCockpit;
    },
    updateVisuals: (dt, mach, boosting, _roll, worldPos, worldQuat) => {
      flickerClock += dt;

      // Crisp ignition flash on boost start + smooth thermal ramp & cooldown back to normal cruising blue
      if (boosting && !wasBoosting) {
        ignitionFlash = 1.0;
      }
      wasBoosting = boosting;
      ignitionFlash = Math.max(0, ignitionFlash - dt * 4.4);

      const rampRate = boosting ? 14.0 : 5.2;
      boostVisual += ((boosting ? 1 : 0) - boostVisual) * (1 - Math.exp(-rampRate * dt));

      const machFactor = Math.max(0.45, (mach - 0.85) * 0.75);
      const boostLengthFactor = 1.0 + boostVisual * 1.18 + ignitionFlash * 0.35;
      const boostWidthFactor = 1.0 + boostVisual * 0.44 + ignitionFlash * 0.22;
      const flicker =
        0.91 + Math.sin(flickerClock * 64) * 0.09 + Math.cos(flickerClock * 103) * 0.06;
      const redPulse = 0.88 + Math.sin(flickerClock * 82) * 0.12;

      const plumeZ = (0.85 + machFactor * 0.34) * boostLengthFactor * flicker;
      const plumeXY = 0.88 * boostWidthFactor * (0.95 + Math.sin(flickerClock * 50) * 0.05);

      for (let i = 0; i < enginePlumes.length; i++) {
        enginePlumes[i].scale.set(plumeXY, plumeXY, plumeZ);

        // Fiery crimson-red outer plasma envelope & trailing tail stretch & shimmer fiercely during boost
        const shimmerX = 1 + Math.sin(flickerClock * 84 + i * 2.1) * 0.14 * boostVisual;
        const shimmerY = 1 + Math.cos(flickerClock * 73 + i * 1.7) * 0.14 * boostVisual;
        redSheathCones[i].visible = boostVisual > 0.02;
        redFlareCones[i].visible = boostVisual > 0.02;
        redSheathCones[i].scale.set(shimmerX, shimmerY, 0.55 + boostVisual * 0.72);
        redFlareCones[i].scale.set(
          shimmerX * (1.06 + ignitionFlash * 0.25),
          shimmerY * (1.06 + ignitionFlash * 0.25),
          0.62 + boostVisual * 0.85,
        );

        // Pulsing shock-diamond flame rings traveling & throbbing down the blue-and-red exhaust
        const diamonds = shockDiamondSets[i];
        const showDiamonds = boostVisual > 0.06;
        for (let d = 0; d < diamonds.length; d++) {
          const dm = diamonds[d];
          dm.visible = showDiamonds;
          if (showDiamonds) {
            const wave = Math.sin(flickerClock * 42 - d * 1.45 + i * 0.8) * 0.5 + 0.5;
            const ringScale = (0.76 - d * 0.11) * (0.88 + wave * 0.34 + ignitionFlash * 0.25);
            dm.scale.set(ringScale, ringScale, 1.0 + wave * 0.4);
            dm.position.z = 0.72 + d * 0.92 + Math.sin(flickerClock * 36 - d) * 0.08;
          }
        }

        const blueHaloScale = (1.0 + boostVisual * 0.85 + ignitionFlash * 0.75 + machFactor * 0.18) * flicker;
        engineHaloSprites[i].scale.set(blueHaloScale, blueHaloScale, 1);

        const redHaloScale = (1.45 + boostVisual * 1.75 + ignitionFlash * 1.1) * redPulse;
        engineRedHaloSprites[i].visible = boostVisual > 0.02;
        engineRedHaloSprites[i].scale.set(redHaloScale, redHaloScale, 1);
      }

      // Color blend: clean cruising light-blue -> vivid electric-blue core + blazing crimson-red plasma!
      plumeCoreMat.color.copy(_cruiseCoreColor).lerp(_boostCoreColor, boostVisual);
      plumeOuterMat.color.copy(_cruiseOuterColor).lerp(_boostOuterColor, boostVisual);
      nozzleGlowMat.color.copy(_cruiseNozzleColor).lerp(_boostNozzleColor, boostVisual);

      plumeRedSheathMat.opacity = Math.min(0.56, boostVisual * 0.48 * redPulse + ignitionFlash * 0.16);
      plumeRedFlareMat.opacity = Math.min(0.68, boostVisual * 0.56 * flicker + ignitionFlash * 0.28);
      shockDiamondBlueMat.opacity = Math.min(0.96, boostVisual * 0.9 * flicker + ignitionFlash * 0.22);
      shockDiamondRedMat.opacity = Math.min(0.92, boostVisual * 0.84 * redPulse + ignitionFlash * 0.2);
      haloBlueMat.opacity = 0.72 + boostVisual * 0.26 + ignitionFlash * 0.2;
      haloRedMat.opacity = Math.min(0.62, boostVisual * 0.48 * redPulse + ignitionFlash * 0.24);

      // Flickering blue-and-red dynamic lighting across rear V-tail fins, wings & dusty Martian ground
      engineLightBlue.intensity =
        (8 + machFactor * 3.5 + boostVisual * 18 + ignitionFlash * 16) * flicker;
      engineLightRed.intensity =
        (boostVisual * 34 + ignitionFlash * 22) * redPulse;

      // Spawn & update trailing glowing blue-and-red afterburner sparks & heat streaks
      if (boostVisual > 0.14) {
        sparkSpawnAccum += dt * (48 + boostVisual * 52);
        _aftDirWorld.set(0, 0, 1).applyQuaternion(worldQuat);
        while (sparkSpawnAccum >= 1) {
          sparkSpawnAccum -= 1;
          const sp = sparks[sparkCursor];
          sparkCursor = (sparkCursor + 1) % SPARK_COUNT;
          const nozzleLocal = sparkCursor % 2 === 0 ? _leftNozzleLocal : _rightNozzleLocal;
          _nozzleWorld.copy(nozzleLocal).applyQuaternion(worldQuat).add(worldPos);
          const isBlue = sparkCursor % 3 === 0;
          sp.active = true;
          sp.isBlue = isBlue;
          sp.x = _nozzleWorld.x + (Math.random() - 0.5) * 0.45;
          sp.y = _nozzleWorld.y + (Math.random() - 0.5) * 0.45;
          sp.z = _nozzleWorld.z + (Math.random() - 0.5) * 0.4;
          const ejectSpeed = 32 + Math.random() * 44;
          sp.vx = _aftDirWorld.x * ejectSpeed + (Math.random() - 0.5) * 9;
          sp.vy = _aftDirWorld.y * ejectSpeed + (Math.random() - 0.5) * 7;
          sp.vz = _aftDirWorld.z * ejectSpeed + 18;
          sp.maxLife = 0.18 + Math.random() * 0.22;
          sp.life = sp.maxLife;
          sp.scale = isBlue ? 0.9 + Math.random() * 0.5 : 1.05 + Math.random() * 0.65;
          sparkMesh.setColorAt(sparkCursor, isBlue ? _sparkBlueColor : _sparkRedColor);
        }
        if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;
      }

      let anySparksUpdated = false;
      for (let i = 0; i < SPARK_COUNT; i++) {
        const sp = sparks[i];
        if (!sp.active) continue;
        anySparksUpdated = true;
        sp.life -= dt;
        if (sp.life <= 0) {
          sp.active = false;
          _sparkDummy.position.set(0, -999, 0);
          _sparkDummy.scale.set(0.001, 0.001, 0.001);
          _sparkDummy.updateMatrix();
          sparkMesh.setMatrixAt(i, _sparkDummy.matrix);
          continue;
        }
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.z += sp.vz * dt;
        const lifeT = sp.life / sp.maxLife;
        _sparkDummy.position.set(sp.x, sp.y, sp.z);
        _sparkDummy.quaternion.copy(worldQuat);
        _sparkDummy.scale.set(
          sp.scale * lifeT,
          sp.scale * lifeT,
          sp.scale * (0.9 + lifeT * 1.6),
        );
        _sparkDummy.updateMatrix();
        sparkMesh.setMatrixAt(i, _sparkDummy.matrix);
      }
      if (anySparksUpdated) {
        sparkMesh.instanceMatrix.needsUpdate = true;
      }

      // Keep _tmpColor referenced cleanly if needed for future blending
      _tmpColor.copy(_cruiseCoreColor);

      // Update expanding supersonic shockwave double-ring halo
      if (shockwaveTimer > 0) {
        shockwaveTimer = Math.max(0, shockwaveTimer - dt);
        const p = 1 - shockwaveTimer / shockwaveDuration; // 0 -> 1
        const easeOut = 1 - Math.pow(1 - p, 2.4);
        const ringScale = 0.65 + easeOut * shockwavePeakScale;
        const alpha = Math.pow(1 - p, 1.55);

        shockRingMesh.scale.set(ringScale, ringScale, 1);
        shockRingMat.opacity = alpha * 0.85;

        const outerScale = 0.55 + easeOut * (shockwavePeakScale * 1.18);
        vaporConeMesh.scale.set(outerScale, outerScale, 1);
        vaporConeMat.opacity = alpha * 0.58;

        if (shockwaveTimer <= 0) {
          shockwaveGroup.visible = false;
        }
      }

      // Compute wingtip world positions and push to sleek glowing ribbon trails
      _leftTipWorld.copy(_leftTipLocal).applyQuaternion(worldQuat).add(worldPos);
      _rightTipWorld.copy(_rightTipLocal).applyQuaternion(worldQuat).add(worldPos);

      const trailWidth = boosting ? 0.16 : 0.09 + Math.min(0.05, (mach - 1) * 0.02);
      const trailBrightness = boosting ? 0.98 : 0.62 + Math.min(0.25, (mach - 1) * 0.1);
      leftTrail.pushPoint(_leftTipWorld, trailWidth, trailBrightness);
      rightTrail.pushPoint(_rightTipWorld, trailWidth, trailBrightness);
    },
    dispose: () => {
      for (const g of disposables) g.dispose();
      for (const m of customMaterials) m.dispose();
      leftTrail.dispose();
      rightTrail.dispose();
    },
  };
}
