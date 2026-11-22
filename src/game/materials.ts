import * as THREE from 'three';

export interface MarsMaterialLibrary {
  terrainMaterial: THREE.MeshStandardMaterial;
  rockObstacleMaterial: THREE.MeshStandardMaterial;
  hullMaterial: THREE.MeshStandardMaterial;
  wingMaterial: THREE.MeshStandardMaterial;
  canopyMaterial: THREE.MeshPhysicalMaterial;
  accentTrimMaterial: THREE.MeshStandardMaterial;
  metalIntakeMaterial: THREE.MeshStandardMaterial;
  rustedSteelMaterial: THREE.MeshStandardMaterial;
  concreteMaterial: THREE.MeshStandardMaterial;
  solarPanelMaterial: THREE.MeshStandardMaterial;
  beaconMaterial: THREE.MeshStandardMaterial;
  dustDevilMaterial: THREE.MeshStandardMaterial;
  dustTexture: THREE.CanvasTexture;
  glowTexture: THREE.CanvasTexture;
  dispose: () => void;
}

/**
 * Generates a tileable sedimentary Martian rock bump & roughness map on an offscreen canvas.
 */
function createSandstoneBumpTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y++) {
    const wave =
      Math.sin(y * 0.14) * 26 +
      Math.sin(y * 0.37 + 1.3) * 14 +
      Math.cos(y * 0.05) * 18;
    const v = Math.max(25, Math.min(230, Math.round(128 + wave)));
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, y, size, 1);
  }

  for (let i = 0; i < 4200; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 24634.6345) % 1;
    const px = Math.abs(x) * size;
    const py = Math.abs(y) * size;
    const w = 1 + (i % 5);
    const bright = i % 2 === 0 ? 185 : 70;
    ctx.fillStyle = `rgba(${bright},${bright},${bright},0.22)`;
    ctx.fillRect(px, py, w, 1.5);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Generates subtle brushed aerospace titanium panel lines for the spacecraft fuselage.
 */
function createAerospaceHullBumpTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#909090';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 700; i++) {
    const x = (i * 53) % size;
    const v = 132 + ((i * 17) % 28);
    ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
    ctx.fillRect(x, 0, 1, size);
  }

  ctx.strokeStyle = 'rgba(40,40,40,0.55)';
  ctx.lineWidth = 2;
  for (let y = 32; y < size; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  for (let x = 64; x < size; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 3);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Generates oxidized, wind-scoured Martian colony steel albedo texture (rusted orange-brown + weathered dark iron).
 */
function createRustedSteelTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#6f3723';
  ctx.fillRect(0, 0, size, size);

  // Oxidized rust patches & faded steel paint flakes
  for (let i = 0; i < 240; i++) {
    const x = Math.abs((Math.sin(i * 41.3) * 43758.5) % 1) * size;
    const y = Math.abs((Math.cos(i * 19.7) * 28411.2) % 1) * size;
    const r = 6 + (i % 24);
    ctx.fillStyle =
      i % 3 === 0
        ? 'rgba(162, 68, 32, 0.42)'
        : i % 3 === 1
          ? 'rgba(66, 56, 52, 0.36)'
          : 'rgba(196, 98, 48, 0.25)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Structural girder panel seams & rivets
  ctx.strokeStyle = 'rgba(34, 18, 12, 0.6)';
  ctx.lineWidth = 2;
  for (let p = 32; p < size; p += 64) {
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Generates crisp photovoltaic cell grid texture for abandoned Martian giant solar panels.
 */
function createSolarPanelTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Deep silicon cobalt-indigo photovoltaic base
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#0f2747');
  grad.addColorStop(0.5, '#173b6c');
  grad.addColorStop(1, '#0b1e38');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Photovoltaic silicon cell grid lines
  ctx.strokeStyle = 'rgba(148, 197, 255, 0.42)';
  ctx.lineWidth = 1.5;
  for (let x = 0; x <= size; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = 0; y <= size; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // Bright silver collector busbars
  ctx.strokeStyle = 'rgba(220, 238, 255, 0.72)';
  ctx.lineWidth = 2.5;
  for (let x = 64; x < size; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }

  // Subtle Martian dust drifts along panel corners so it feels authentically abandoned on Mars
  const dustGrad = ctx.createLinearGradient(0, size * 0.65, 0, size);
  dustGrad.addColorStop(0, 'rgba(186, 86, 44, 0)');
  dustGrad.addColorStop(1, 'rgba(186, 86, 44, 0.32)');
  ctx.fillStyle = dustGrad;
  ctx.fillRect(0, size * 0.65, size, size * 0.35);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/** Soft radial dust plume texture for Martian ground haze */
function createSoftRadialTexture(
  innerRgba: string,
  midRgba: string,
  outerRgba: string,
): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(
    size * 0.5,
    size * 0.5,
    2,
    size * 0.5,
    size * 0.5,
    size * 0.5,
  );
  grad.addColorStop(0, innerRgba);
  grad.addColorStop(0.45, midRgba);
  grad.addColorStop(1, outerRgba);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createMarsMaterialLibrary(renderer: THREE.WebGLRenderer): MarsMaterialLibrary {
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const sandstoneBump = createSandstoneBumpTexture(maxAniso);
  const hullBump = createAerospaceHullBumpTexture(maxAniso);
  const rustedSteelMap = createRustedSteelTexture(maxAniso);
  const solarPanelMap = createSolarPanelTexture(maxAniso);

  const dustTexture = createSoftRadialTexture(
    'rgba(232, 126, 72, 0.52)',
    'rgba(196, 86, 44, 0.22)',
    'rgba(160, 62, 30, 0.0)',
  );

  const glowTexture = createSoftRadialTexture(
    'rgba(240, 252, 255, 1.0)',
    'rgba(105, 224, 255, 0.55)',
    'rgba(56, 189, 248, 0.0)',
  );

  const terrainMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.02,
    envMapIntensity: 0.18,
    bumpMap: sandstoneBump,
    bumpScale: 1.9,
    flatShading: false,
  });

  const rockObstacleMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.04,
    envMapIntensity: 0.2,
    bumpMap: sandstoneBump,
    bumpScale: 2.3,
    flatShading: true,
  });

  const hullMaterial = new THREE.MeshStandardMaterial({
    color: 0xe9eef4,
    roughness: 0.24,
    metalness: 0.78,
    bumpMap: hullBump,
    bumpScale: 0.04,
  });

  const wingMaterial = new THREE.MeshStandardMaterial({
    color: 0x262c36,
    roughness: 0.68,
    metalness: 0.28,
    bumpMap: hullBump,
    bumpScale: 0.025,
  });

  const canopyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x101824,
    roughness: 0.07,
    metalness: 0.88,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
  });

  const accentTrimMaterial = new THREE.MeshStandardMaterial({
    color: 0xf9572a,
    roughness: 0.28,
    metalness: 0.35,
  });

  const metalIntakeMaterial = new THREE.MeshStandardMaterial({
    color: 0x454e5c,
    roughness: 0.36,
    metalness: 0.86,
  });

  // Abandoned Mars Colony rusted weathered structural steel
  const rustedSteelMaterial = new THREE.MeshStandardMaterial({
    map: rustedSteelMap,
    bumpMap: hullBump,
    bumpScale: 0.16,
    roughness: 0.74,
    metalness: 0.52,
    envMapIntensity: 0.55,
  });

  // Dust-scoured abandoned colony regolith-concrete piers & viaduct road decks
  const concreteMaterial = new THREE.MeshStandardMaterial({
    color: 0x9b7968,
    bumpMap: sandstoneBump,
    bumpScale: 0.65,
    roughness: 0.92,
    metalness: 0.05,
    envMapIntensity: 0.22,
  });

  // Reflective deep-cobalt photovoltaic solar array panels contrasting cleanly against Martian red
  const solarPanelMaterial = new THREE.MeshStandardMaterial({
    map: solarPanelMap,
    roughness: 0.16,
    metalness: 0.68,
    envMapIntensity: 0.95,
  });

  // Dim warning aviation beacon atop abandoned communication towers
  const beaconMaterial = new THREE.MeshStandardMaterial({
    color: 0xff6b2b,
    emissive: 0xff4511,
    emissiveIntensity: 2.2,
    roughness: 0.2,
    metalness: 0.1,
  });

  // Swirling translucent red-amber Martian dust devil vortex rings
  const dustDevilMaterial = new THREE.MeshStandardMaterial({
    color: 0xe2743e,
    emissive: 0x7c280f,
    emissiveIntensity: 0.45,
    roughness: 0.96,
    metalness: 0.0,
    envMapIntensity: 0.12,
    transparent: true,
    opacity: 0.58,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  return {
    terrainMaterial,
    rockObstacleMaterial,
    hullMaterial,
    wingMaterial,
    canopyMaterial,
    accentTrimMaterial,
    metalIntakeMaterial,
    rustedSteelMaterial,
    concreteMaterial,
    solarPanelMaterial,
    beaconMaterial,
    dustDevilMaterial,
    dustTexture,
    glowTexture,
    dispose: () => {
      sandstoneBump.dispose();
      hullBump.dispose();
      rustedSteelMap.dispose();
      solarPanelMap.dispose();
      dustTexture.dispose();
      glowTexture.dispose();
      terrainMaterial.dispose();
      rockObstacleMaterial.dispose();
      hullMaterial.dispose();
      wingMaterial.dispose();
      canopyMaterial.dispose();
      accentTrimMaterial.dispose();
      metalIntakeMaterial.dispose();
      rustedSteelMaterial.dispose();
      concreteMaterial.dispose();
      solarPanelMaterial.dispose();
      beaconMaterial.dispose();
      dustDevilMaterial.dispose();
    },
  };
}
