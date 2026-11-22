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

  // 2. Dark carbon-ceramic thermal nose tip & pitot needle spike
  const noseTipGeo = new THREE.ConeGeometry(0.16, 1.25, 16);
  noseTipGeo.rotateX(-Math.PI / 2);
  noseTipGeo.translate(0, 0, -5.05);
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

  const plumeCoreMat = new THREE.MeshBasicMaterial({
    color: 0xe6fbff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const plumeOuterMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.48,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  customMaterials.push(plumeCoreMat, plumeOuterMat);

  const coreConeGeo = new THREE.ConeGeometry(0.16, 1.9, 14, 1, true);
  coreConeGeo.rotateX(Math.PI / 2);
  coreConeGeo.translate(0, 0, 0.95);
  disposables.push(coreConeGeo);

  const outerConeGeo = new THREE.ConeGeometry(0.26, 3.1, 14, 1, true);
  outerConeGeo.rotateX(Math.PI / 2);
  outerConeGeo.translate(0, 0, 1.55);
  disposables.push(outerConeGeo);

  const enginePlumes: THREE.Group[] = [];
  const engineHaloSprites: THREE.Sprite[] = [];
  const haloMat = new THREE.SpriteMaterial({
    map: materials.glowTexture,
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.62,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  customMaterials.push(haloMat);

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
    plumeGroup.add(new THREE.Mesh(coreConeGeo, plumeCoreMat));
    plumeGroup.add(new THREE.Mesh(outerConeGeo, plumeOuterMat));
    hullRoot.add(plumeGroup);
    enginePlumes.push(plumeGroup);

    const sprite = new THREE.Sprite(haloMat);
    sprite.position.set(nx, -0.02, 3.04);
    sprite.scale.set(1.05, 1.05, 1);
    hullRoot.add(sprite);
    engineHaloSprites.push(sprite);
  }

  // Subtle thruster PointLight illuminating wings & canyon nearby
  const engineLight = new THREE.PointLight(0x67e8f9, 8, 18, 2);
  engineLight.position.set(0, 0.2, 3.6);
  hullRoot.add(engineLight);

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

  // 11. World-space wingtip plasma ribbon trails (kept outside craft transform so they curve smoothly in world space)
  const trailGroup = new THREE.Group();
  const leftTrail = new WingtipTrail();
  const rightTrail = new WingtipTrail();
  trailGroup.add(leftTrail.mesh, rightTrail.mesh);

  // Pre-allocated scratch vectors for zero-GC update
  const _leftTipLocal = new THREE.Vector3(-3.52, 0.02, 2.05);
  const _rightTipLocal = new THREE.Vector3(3.52, 0.02, 2.05);
  const _leftTipWorld = new THREE.Vector3();
  const _rightTipWorld = new THREE.Vector3();

  let shockwaveTimer = 0;
  let shockwaveDuration = 0.65;
  let shockwavePeakScale = 2.6;
  let flickerClock = 0;

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
    },
    setVisible: (visible: boolean) => {
      group.visible = visible;
      trailGroup.visible = visible;
    },
    updateVisuals: (dt, mach, boosting, _roll, worldPos, worldQuat) => {
      flickerClock += dt;

      // Dynamic thruster plume length, flicker, and blue-white glow intensity
      const machFactor = Math.max(0.45, (mach - 0.85) * 0.75);
      const boostFactor = boosting ? 1.55 : 1.0;
      const flicker = 0.93 + Math.sin(flickerClock * 55) * 0.07 + Math.cos(flickerClock * 89) * 0.04;
      const plumeZ = (0.8 + machFactor * 0.35) * boostFactor * flicker;
      const plumeXY = (0.85 + (boosting ? 0.25 : 0)) * (0.96 + Math.sin(flickerClock * 42) * 0.04);

      for (let i = 0; i < enginePlumes.length; i++) {
        enginePlumes[i].scale.set(plumeXY, plumeXY, plumeZ);
        const haloScale = (0.95 + (boosting ? 0.65 : 0) + machFactor * 0.18) * flicker;
        engineHaloSprites[i].scale.set(haloScale, haloScale, 1);
      }

      engineLight.intensity = (7 + machFactor * 4 + (boosting ? 10 : 0)) * flicker;
      plumeOuterMat.color.setHex(boosting ? 0x7dd3fc : 0x38bdf8);

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

      const trailWidth = boosting ? 0.15 : 0.09 + Math.min(0.05, (mach - 1) * 0.02);
      const trailBrightness = boosting ? 0.95 : 0.62 + Math.min(0.25, (mach - 1) * 0.1);
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
