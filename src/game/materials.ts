import * as THREE from 'three';

export interface MarsMaterialLibrary {
  terrainMaterial: THREE.MeshStandardMaterial;
  rockObstacleMaterial: THREE.MeshStandardMaterial;
  hullMaterial: THREE.MeshStandardMaterial;
  wingMaterial: THREE.MeshStandardMaterial;
  canopyMaterial: THREE.MeshPhysicalMaterial;
  accentTrimMaterial: THREE.MeshStandardMaterial;
  metalIntakeMaterial: THREE.MeshStandardMaterial;
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

  // Horizontal sedimentary rock strata bands
  for (let y = 0; y < size; y++) {
    const wave =
      Math.sin(y * 0.14) * 26 +
      Math.sin(y * 0.37 + 1.3) * 14 +
      Math.cos(y * 0.05) * 18;
    const v = Math.max(25, Math.min(230, Math.round(128 + wave)));
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, y, size, 1);
  }

  // Fine wind-eroded rock grain & pitting
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

  // Fine brushed streaks along flight axis
  for (let i = 0; i < 700; i++) {
    const x = ((i * 53) % size);
    const v = 132 + ((i * 17) % 28);
    ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
    ctx.fillRect(x, 0, 1, size);
  }

  // Subtle recessed fuselage panel seams
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

  // Vertex-colored stratified Martian canyon rock (matte, rugged sandstone)
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

  // Dramatic spires & giant rock arches with sharper rock facets
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

  // Spacecraft satin brushed ceramic-titanium hull
  const hullMaterial = new THREE.MeshStandardMaterial({
    color: 0xe9eef4,
    roughness: 0.24,
    metalness: 0.78,
    bumpMap: hullBump,
    bumpScale: 0.04,
  });

  // Spacecraft matte dark graphite delta wings (strong roughness contrast >= 0.4 against hull)
  const wingMaterial = new THREE.MeshStandardMaterial({
    color: 0x262c36,
    roughness: 0.68,
    metalness: 0.28,
    bumpMap: hullBump,
    bumpScale: 0.025,
  });

  // Glossy dark smoked-gold/obsidian cockpit canopy
  const canopyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x101824,
    roughness: 0.07,
    metalness: 0.88,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
  });

  // Martian aerospace racing orange-vermilion accent trim
  const accentTrimMaterial = new THREE.MeshStandardMaterial({
    color: 0xf9572a,
    roughness: 0.28,
    metalness: 0.35,
  });

  // Brushed dark gunmetal intake & thruster nacelles
  const metalIntakeMaterial = new THREE.MeshStandardMaterial({
    color: 0x454e5c,
    roughness: 0.36,
    metalness: 0.86,
  });

  return {
    terrainMaterial,
    rockObstacleMaterial,
    hullMaterial,
    wingMaterial,
    canopyMaterial,
    accentTrimMaterial,
    metalIntakeMaterial,
    dustTexture,
    glowTexture,
    dispose: () => {
      sandstoneBump.dispose();
      hullBump.dispose();
      dustTexture.dispose();
      glowTexture.dispose();
      terrainMaterial.dispose();
      rockObstacleMaterial.dispose();
      hullMaterial.dispose();
      wingMaterial.dispose();
      canopyMaterial.dispose();
      accentTrimMaterial.dispose();
      metalIntakeMaterial.dispose();
    },
  };
}
