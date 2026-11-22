import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FlightAudioEngine } from './audio';
import { DIFFICULTY_CONFIGS, DIFFICULTY_ORDER, getDifficultyConfig } from './difficulty';
import { createMarsMaterialLibrary, type MarsMaterialLibrary } from './materials';
import { createMarsWorldRig, HORIZON_FOG_COLOR, SUN_DIRECTION, type MarsWorldRig } from './marsWorld';
import {
  computeSpeedFromMach,
  createInitialFlightState,
  damp,
  MAX_DT,
  stepFlightSimulation,
  type FlightState,
} from './simulation';
import { createSpacecraftRig, type SpacecraftRig } from './spacecraft';
import { getTerrainHeight, getZoneInfoAtZ } from './terrainMath';
import type {
  AllDifficultyRecords,
  CameraViewMode,
  ControlInput,
  DifficultyId,
  FlightTelemetry,
  GamePhase,
  HudBannerEvent,
  RunSummary,
} from './types';

const CAMERA_VIEW_ORDER: readonly CameraViewMode[] = ['chase', 'cockpit', 'wing', 'cinematic'];
const CAMERA_VIEW_LABELS: Record<CameraViewMode, { label: string; sublabel: string }> = {
  chase: { label: 'VIEW: CHASE CAM', sublabel: 'SUPERSONIC PURSUIT' },
  cockpit: { label: 'VIEW: COCKPIT', sublabel: 'FIRST-PERSON CANOPY' },
  wing: { label: 'VIEW: WING CAM', sublabel: 'WING-TIP ACTION MOUNT' },
  cinematic: { label: 'VIEW: CINEMATIC FLYBY', sublabel: 'DYNAMIC SHOWCASE CAM' },
};

const STORAGE_BEST_SCORE_LEGACY = 'ares_mach_best_score_v1';
const STORAGE_BEST_MACH_LEGACY = 'ares_mach_best_mach_v1';
const STORAGE_DIFFICULTY = 'ares_mach_difficulty_v1';
const STORAGE_RECORDS = 'ares_mach_records_v2';
const FX_TRAIL_CAPACITY = 54;

function createDefaultRecords(): AllDifficultyRecords {
  return {
    easy: { bestScore: 0, bestDistance: 0, bestMach: DIFFICULTY_CONFIGS.easy.startMach },
    medium: { bestScore: 0, bestDistance: 0, bestMach: DIFFICULTY_CONFIGS.medium.startMach },
    hard: { bestScore: 0, bestDistance: 0, bestMach: DIFFICULTY_CONFIGS.hard.startMach },
  };
}

interface WindStreak {
  angle: number;
  dist: number; // 0.35..1.15 normalized radial distance from center
  speed: number;
  length: number;
  alpha: number;
}

interface FxTrailSample {
  left: THREE.Vector3;
  right: THREE.Vector3;
  center: THREE.Vector3;
  valid: boolean;
}

export interface MarsFlightCallbacks {
  onPhaseChange: (phase: GamePhase) => void;
  onTelemetry: (telemetry: FlightTelemetry) => void;
  onBanner: (event: HudBannerEvent) => void;
  onGameOver: (summary: RunSummary) => void;
  onMuteChange: (muted: boolean) => void;
  onNearMissFlash: () => void;
  onScrapeFlash: () => void;
  onGateFlash: () => void;
  onAutoplayChange: (active: boolean) => void;
  onCameraViewChange: (view: CameraViewMode) => void;
  onDifficultyChange: (difficulty: DifficultyId, records: AllDifficultyRecords) => void;
}

/**
 * Self-contained Three.js supersonic Mars canyon flight engine.
 * Owns WebGLRenderer, software-WebGL pacing, 2D fxCanvas Mach-reactive aircraft trails +
 * rushing wind streaks, unified keyboard/mouse/touch controls, one-click Autoplay mode,
 * procedural audio, and throttled React telemetry hooks.
 */
export class MarsFlightEngine {
  private readonly mountEl: HTMLDivElement;
  private readonly fxCanvas: HTMLCanvasElement;
  private readonly fxCtx: CanvasRenderingContext2D | null;
  private readonly callbacks: MarsFlightCallbacks;

  private readonly isSoftwareGl: boolean;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly materials: MarsMaterialLibrary;
  private readonly spacecraft: SpacecraftRig;
  private readonly world: MarsWorldRig;
  private readonly audio: FlightAudioEngine;

  private phase: GamePhase = 'title';
  private difficulty: DifficultyId = 'easy';
  private flight: FlightState = createInitialFlightState('easy');
  private autoplayActive = false;
  private cameraView: CameraViewMode = 'chase';
  private cinematicClock = 0;
  private lastCinematicShotIdx = -1;
  private gateWindBurstTimer = 0;
  private records: AllDifficultyRecords = createDefaultRecords();

  private frameId = 0;
  private disposed = false;
  private lastTimeMs = 0;
  private titleOrbitClock = 0;
  private crashDelayTimer = 0;
  private hitstopTimer = 0;
  private cameraTrauma = 0;
  private nearMissFovKick = 0;
  private shockwaveFovKick = 0;
  private bannerSeq = 1;
  private telemetryAccum = 0;

  // Input state (separate held keys, mouse steering, touch drag, and boost button)
  private readonly keysHeld = new Set<string>();
  private inputMode: 'keyboard' | 'pointer' = 'keyboard';
  private pointerSteerX = 0;
  private pointerSteerY = 0;
  private touchActive = false;
  private touchOriginX = 0;
  private touchOriginY = 0;
  private uiBoostHeld = false;

  // Pre-allocated math helpers for zero-GC render loop & 3D->2D fxCanvas trail projection
  private readonly _craftPos = new THREE.Vector3();
  private readonly _craftEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly _craftQuat = new THREE.Quaternion();
  private readonly _camTargetPos = new THREE.Vector3();
  private readonly _camLookAt = new THREE.Vector3();
  private readonly _camUpScratch = new THREE.Vector3(0, 1, 0);
  private readonly _curCamLook = new THREE.Vector3(0, 20, -40);
  private readonly _controlInput: ControlInput = { steerX: 0, steerY: 0, boost: false };

  private readonly _leftEmitterLocal = new THREE.Vector3(-3.55, 0.02, 2.15);
  private readonly _rightEmitterLocal = new THREE.Vector3(3.55, 0.02, 2.15);
  private readonly _centerEmitterLocal = new THREE.Vector3(0, -0.02, 3.1);
  private readonly _projScratch = new THREE.Vector3();
  private readonly _trailRing: FxTrailSample[] = [];
  private trailHead = 0;
  private trailCount = 0;
  private readonly _projX = new Float32Array(FX_TRAIL_CAPACITY);
  private readonly _projY = new Float32Array(FX_TRAIL_CAPACITY);
  private readonly _projValid = new Uint8Array(FX_TRAIL_CAPACITY);
  private readonly _zoneFogColor = new THREE.Color(HORIZON_FOG_COLOR);

  // Speed-line particles for the 2D rushing wind streak & subtle motion-blur canvas
  private readonly windStreaks: WindStreak[] = [];
  private viewWidth = 1;
  private viewHeight = 1;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    mountEl: HTMLDivElement,
    fxCanvas: HTMLCanvasElement,
    callbacks: MarsFlightCallbacks,
    initialAutostart = false,
  ) {
    this.mountEl = mountEl;
    this.fxCanvas = fxCanvas;
    this.fxCtx = fxCanvas.getContext('2d');
    this.callbacks = callbacks;

    this.loadSavedRecords();

    // Pre-allocate ring buffer for Mach-reactive 2D fxCanvas aircraft trails
    for (let i = 0; i < FX_TRAIL_CAPACITY; i++) {
      this._trailRing.push({
        left: new THREE.Vector3(),
        right: new THREE.Vector3(),
        center: new THREE.Vector3(),
        valid: false,
      });
    }

    // Detect software WebGL (SwiftShader/llvmpipe/WARP) from GPU renderer string
    this.isSoftwareGl = (() => {
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.mountEl.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(HORIZON_FOG_COLOR);
    this.scene.fog = new THREE.FogExp2(HORIZON_FOG_COLOR, 0.0017);

    // Mandatory studio environment reflection map on every device
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Camera
    this.camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.4, 1300);
    this.camera.position.set(4.5, 24.5, 13.8);

    // Warm/cool Martian atmospheric lighting rig with dramatic raking shadows
    this.sunLight = new THREE.DirectionalLight(0xffbe7d, 2.25);
    this.sunLight.position.copy(SUN_DIRECTION).multiplyScalar(180);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 20;
    this.sunLight.shadow.camera.far = 420;
    const d = 115;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.04;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Cool sky / deep Martian shadow bounce hemisphere fill for strong relief contrast
    const hemiLight = new THREE.HemisphereLight(0x7c97bd, 0x4f1709, 0.56);
    this.scene.add(hemiLight);

    // Subtle rim backlight separating the metallic spacecraft from shadowed canyon walls
    const rimLight = new THREE.DirectionalLight(0xff8e52, 0.35);
    rimLight.position.set(-60, 35, 90);
    this.scene.add(rimLight);

    // Procedural materials, world & composite spacecraft
    this.materials = createMarsMaterialLibrary(this.renderer);
    this.world = createMarsWorldRig(this.materials);
    this.spacecraft = createSpacecraftRig(this.materials);
    this.scene.add(this.world.group);
    this.scene.add(this.spacecraft.group);
    this.scene.add(this.spacecraft.trailGroup);

    this.audio = new FlightAudioEngine();

    // Initialize radial edge wind streaks
    for (let i = 0; i < 64; i++) {
      this.windStreaks.push({
        angle: (i / 64) * Math.PI * 2 + (Math.random() - 0.5) * 0.08,
        dist: 0.42 + Math.random() * 0.72,
        speed: 0.85 + Math.random() * 1.15,
        length: 0.08 + Math.random() * 0.16,
        alpha: 0.3 + Math.random() * 0.55,
      });
    }

    this.handleResize();
    this.bindEvents();

    // Pre-warm shaders on GPU devices
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.flight = createInitialFlightState(this.difficulty);
    this.world.reset(this.difficulty);
    this.applyDifficultyLighting();
    this.syncCraftTransform(0.016);
    this.spacecraft.resetTrails(this._craftPos);
    this.resetFxTrails();
    this.world.update(0.016, this.flight.x, this.flight.y, this.flight.z, this.flight.survivalSeconds);
    this.updateZoneAtmosphere();
    this.updateSunShadowRig();

    this.callbacks.onDifficultyChange(this.difficulty, this.cloneRecords());

    if (initialAutostart) {
      this.startRun(false);
    } else {
      this.setPhase('title');
      this.camera.position.set(this.flight.x + 4.2, this.flight.y + 4.4, this.flight.z + 13.6);
      this._curCamLook.set(this.flight.x - 1.2, this.flight.y + 0.8, this.flight.z - 42);
      this.camera.lookAt(this._curCamLook);
    }

    this.lastTimeMs = performance.now();
    this.tick();
  }

  private cloneRecords(): AllDifficultyRecords {
    return {
      easy: { ...this.records.easy },
      medium: { ...this.records.medium },
      hard: { ...this.records.hard },
    };
  }

  private loadSavedRecords(): void {
    try {
      const savedDiff = window.localStorage.getItem(STORAGE_DIFFICULTY);
      if (savedDiff && (DIFFICULTY_ORDER as readonly string[]).includes(savedDiff)) {
        this.difficulty = savedDiff as DifficultyId;
      }

      const rawRecords = window.localStorage.getItem(STORAGE_RECORDS);
      if (rawRecords) {
        const parsed = JSON.parse(rawRecords) as Partial<AllDifficultyRecords>;
        for (const id of DIFFICULTY_ORDER) {
          const item = parsed[id];
          if (!item) continue;
          if (Number.isFinite(item.bestScore) && item.bestScore > 0) {
            this.records[id].bestScore = Math.round(item.bestScore);
          }
          if (Number.isFinite(item.bestDistance) && item.bestDistance > 0) {
            this.records[id].bestDistance = Math.round(item.bestDistance);
          }
          if (Number.isFinite(item.bestMach) && item.bestMach > this.records[id].bestMach) {
            this.records[id].bestMach = Number(item.bestMach.toFixed(2));
          }
        }
      } else {
        // Migrate legacy v1 records into Easy tier seamlessly
        const savedScore = Number(window.localStorage.getItem(STORAGE_BEST_SCORE_LEGACY));
        const savedMach = Number(window.localStorage.getItem(STORAGE_BEST_MACH_LEGACY));
        if (Number.isFinite(savedScore) && savedScore > 0) {
          this.records.easy.bestScore = Math.round(savedScore);
        }
        if (Number.isFinite(savedMach) && savedMach > this.records.easy.bestMach) {
          this.records.easy.bestMach = Number(savedMach.toFixed(2));
        }
      }
    } catch {
      // Ignore storage failures
    }
  }

  private saveRecords(): void {
    try {
      window.localStorage.setItem(STORAGE_DIFFICULTY, this.difficulty);
      window.localStorage.setItem(STORAGE_RECORDS, JSON.stringify(this.records));
    } catch {
      // Ignore storage failures
    }
  }

  private applyDifficultyLighting(): void {
    if (this.difficulty === 'hard') {
      this.sunLight.color.setHex(0xffa694);
      this.sunLight.intensity = 2.48;
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.density = 0.00205;
      }
    } else if (this.difficulty === 'medium') {
      this.sunLight.color.setHex(0xffb886);
      this.sunLight.intensity = 2.34;
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.density = 0.00182;
      }
    } else {
      this.sunLight.color.setHex(0xffbe7d);
      this.sunLight.intensity = 2.25;
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.density = 0.0017;
      }
    }
  }

  public setDifficulty(difficulty: DifficultyId): void {
    if (this.difficulty === difficulty) return;
    this.difficulty = difficulty;
    this.saveRecords();
    this.applyDifficultyLighting();
    this.world.setDifficulty(difficulty);

    if (this.phase === 'title') {
      this.flight = createInitialFlightState(difficulty);
      this.syncCraftTransform(0.016);
      this.spacecraft.resetTrails(this._craftPos);
      this.resetFxTrails();
    }

    this.updateZoneAtmosphere();
    this.callbacks.onDifficultyChange(this.difficulty, this.cloneRecords());
    this.emitTelemetryNow();
    if (!this.disposed) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase;
    document.body.dataset.state = phase;
    this.callbacks.onPhaseChange(phase);
    this.audio.setEngineActive(phase === 'playing');
  }

  private resetFxTrails(): void {
    this.trailHead = 0;
    this.trailCount = 0;
    for (let i = 0; i < FX_TRAIL_CAPACITY; i++) {
      this._trailRing[i].valid = false;
    }
  }

  private pushFxTrailSample(): void {
    const slot = this._trailRing[this.trailHead];
    slot.left.copy(this._leftEmitterLocal).applyQuaternion(this._craftQuat).add(this._craftPos);
    slot.right.copy(this._rightEmitterLocal).applyQuaternion(this._craftQuat).add(this._craftPos);
    slot.center.copy(this._centerEmitterLocal).applyQuaternion(this._craftQuat).add(this._craftPos);
    slot.valid = true;

    this.trailHead = (this.trailHead + 1) % FX_TRAIL_CAPACITY;
    if (this.trailCount < FX_TRAIL_CAPACITY) {
      this.trailCount += 1;
    }
  }

  public setAutoplay(active: boolean): void {
    this.autoplayActive = active;
    if (!active) {
      // Seamless handoff back to player steering without stale pointer offsets
      this.pointerSteerX = 0;
      this.pointerSteerY = 0;
    }
    this.callbacks.onAutoplayChange(active);
    this.emitTelemetryNow();
  }

  public toggleAutoplay(): boolean {
    this.audio.unlock();
    const next = !this.autoplayActive;
    if (this.phase === 'title' && next) {
      this.startRun(true);
      return true;
    }
    this.setAutoplay(next);
    return next;
  }

  public setCameraView(view: CameraViewMode, announce = true): void {
    this.cameraView = view;
    this.cinematicClock = 0;
    this.lastCinematicShotIdx = -1;
    this.spacecraft.setCockpitMode(view === 'cockpit' && this.phase === 'playing');
    if (view !== 'cockpit') {
      this.camera.up.set(0, 1, 0);
    }
    // Snap camera immediately and repaint so switching feels crisp with zero stale frame
    if (this.phase === 'playing') {
      this.applyCameraSnapForCurrentView();
      this.renderer.render(this.scene, this.camera);
    }
    this.callbacks.onCameraViewChange(view);
    if (announce && this.phase === 'playing') {
      const meta = CAMERA_VIEW_LABELS[view];
      this.callbacks.onBanner({
        id: this.bannerSeq++,
        kind: 'camera',
        label: meta.label,
        sublabel: meta.sublabel,
      });
    }
    this.emitTelemetryNow();
  }

  public cycleCameraView(): CameraViewMode {
    this.audio.unlock();
    this.audio.playCameraSwitch();
    const idx = CAMERA_VIEW_ORDER.indexOf(this.cameraView);
    const next = CAMERA_VIEW_ORDER[(idx + 1) % CAMERA_VIEW_ORDER.length];
    this.setCameraView(next, true);
    return next;
  }

  private applyCameraSnapForCurrentView(): void {
    if (this.cameraView === 'cockpit') {
      this._camTargetPos.set(0, 0.74, -1.35).applyQuaternion(this._craftQuat).add(this._craftPos);
      this._camLookAt.set(0, 0.35, -72).applyQuaternion(this._craftQuat).add(this._craftPos);
      this.camera.position.copy(this._camTargetPos);
      this._curCamLook.copy(this._camLookAt);
      this._camUpScratch.set(0, 1, 0).applyQuaternion(this._craftQuat);
      this.camera.up.copy(this._camUpScratch);
      this.camera.lookAt(this._curCamLook);
    } else if (this.cameraView === 'wing') {
      this.camera.up.set(0, 1, 0);
      this._camTargetPos.set(4.85, 0.76, 4.45).applyQuaternion(this._craftQuat).add(this._craftPos);
      this._camLookAt.set(-0.35, 0.14, -30).applyQuaternion(this._craftQuat).add(this._craftPos);
      this.camera.position.copy(this._camTargetPos);
      this._curCamLook.copy(this._camLookAt);
      this.camera.lookAt(this._curCamLook);
    } else if (this.cameraView === 'cinematic') {
      this.camera.up.set(0, 1, 0);
      this.lastCinematicShotIdx = 0;
      const desiredX = this.flight.x + 14;
      const desiredZ = this.flight.z - 18;
      const safeY = Math.max(getTerrainHeight(desiredX, desiredZ, this.difficulty) + 5.0, this.flight.y + 4.2);
      this.camera.position.set(desiredX, safeY, desiredZ);
      this._curCamLook.set(this.flight.x, this.flight.y + 0.5, this.flight.z);
      this.camera.lookAt(this._curCamLook);
    } else {
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(this.flight.x, this.flight.y + 3.8, this.flight.z + 11.8);
      this._curCamLook.set(this.flight.x, this.flight.y + 1.0, this.flight.z - 54);
      this.camera.lookAt(this._curCamLook);
    }
  }

  public startRun(withAutoplay?: boolean): void {
    this.audio.unlock();
    this.keysHeld.clear();
    this.uiBoostHeld = false;
    this.touchActive = false;
    this.pointerSteerX = 0;
    this.pointerSteerY = 0;
    this.inputMode = 'keyboard';
    this.crashDelayTimer = 0;
    this.hitstopTimer = 0;
    this.cameraTrauma = 0;
    this.nearMissFovKick = 0;
    this.shockwaveFovKick = 0;
    this.gateWindBurstTimer = 0;
    this.cinematicClock = 0;

    if (typeof withAutoplay === 'boolean') {
      this.autoplayActive = withAutoplay;
      this.callbacks.onAutoplayChange(this.autoplayActive);
    }

    this.flight = createInitialFlightState(this.difficulty);
    this.world.reset(this.difficulty);
    this.applyDifficultyLighting();
    this.spacecraft.setVisible(true);
    this.spacecraft.setCockpitMode(this.cameraView === 'cockpit');
    this.syncCraftTransform(0.016);
    this.spacecraft.resetTrails(this._craftPos);
    this.resetFxTrails();

    this.applyCameraSnapForCurrentView();
    this.camera.fov = 65;
    this.camera.updateProjectionMatrix();

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    this.setPhase('playing');
    this.emitTelemetryNow();
  }

  public pause(): void {
    if (this.phase !== 'playing') return;
    this.keysHeld.clear();
    this.uiBoostHeld = false;
    this.setPhase('paused');
  }

  public resume(): void {
    if (this.phase !== 'paused') return;
    this.audio.unlock();
    this.keysHeld.clear();
    this.uiBoostHeld = false;
    this.lastTimeMs = performance.now();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    this.setPhase('playing');
  }

  public returnToTitle(): void {
    this.keysHeld.clear();
    this.uiBoostHeld = false;
    this.crashDelayTimer = 0;
    this.autoplayActive = false;
    this.callbacks.onAutoplayChange(false);
    this.flight = createInitialFlightState(this.difficulty);
    this.world.reset(this.difficulty);
    this.applyDifficultyLighting();
    this.spacecraft.setVisible(true);
    this.spacecraft.setCockpitMode(false);
    this.camera.up.set(0, 1, 0);
    this.syncCraftTransform(0.016);
    this.spacecraft.resetTrails(this._craftPos);
    this.resetFxTrails();
    this.setPhase('title');
  }

  public setBoostButtonHeld(held: boolean): void {
    if (held) this.audio.unlock();
    this.uiBoostHeld = held;
  }

  public toggleMute(): boolean {
    this.audio.unlock();
    const muted = this.audio.toggleMute();
    this.callbacks.onMuteChange(muted);
    return muted;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;

    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    if (code === 'KeyM' && !e.repeat) {
      this.toggleMute();
      return;
    }

    if (this.phase === 'title') {
      if ((code === 'Enter' || code === 'Space') && !e.repeat) {
        this.startRun(false);
      }
      return;
    }

    if (this.phase === 'gameover') {
      if ((code === 'Enter' || code === 'Space' || code === 'KeyR') && !e.repeat) {
        this.startRun(false);
      }
      return;
    }

    if (code === 'Escape' || code === 'KeyP') {
      if (!e.repeat) {
        if (this.phase === 'playing') this.pause();
        else if (this.phase === 'paused') this.resume();
      }
      return;
    }

    if (code === 'KeyR' && !e.repeat && (this.phase === 'playing' || this.phase === 'paused')) {
      this.startRun(this.autoplayActive);
      return;
    }

    if (code === 'KeyC' && !e.repeat && this.phase === 'playing') {
      this.cycleCameraView();
      return;
    }

    if (
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'KeyA' ||
      code === 'KeyD' ||
      code === 'KeyW' ||
      code === 'KeyS'
    ) {
      this.inputMode = 'keyboard';
    }

    this.keysHeld.add(code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keysHeld.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (this.phase !== 'playing' || this.touchActive || this.autoplayActive) return;
    const rect = this.mountEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

    const applyDeadzone = (v: number) => {
      const abs = Math.abs(v);
      if (abs < 0.08) return 0;
      return Math.sign(v) * Math.min(1, (abs - 0.08) / 0.72);
    };

    this.pointerSteerX = applyDeadzone(nx);
    this.pointerSteerY = applyDeadzone(ny);
    this.inputMode = 'pointer';
  };

  private readonly onTouchStart = (e: TouchEvent): void => {
    if (this.phase !== 'playing' || this.autoplayActive) return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest('button')) return;
    if (e.touches.length === 0) return;
    this.audio.unlock();
    const t = e.touches[0];
    this.touchActive = true;
    this.touchOriginX = t.clientX;
    this.touchOriginY = t.clientY;
    this.inputMode = 'pointer';
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    if (!this.touchActive || this.phase !== 'playing' || this.autoplayActive || e.touches.length === 0) return;
    const t = e.touches[0];
    const maxDrag = Math.max(55, Math.min(115, this.viewWidth * 0.16));
    const dx = (t.clientX - this.touchOriginX) / maxDrag;
    const dy = -(t.clientY - this.touchOriginY) / maxDrag;
    this.pointerSteerX = Math.max(-1, Math.min(1, dx));
    this.pointerSteerY = Math.max(-1, Math.min(1, dy));
  };

  private readonly onTouchEnd = (): void => {
    this.touchActive = false;
    this.pointerSteerX = 0;
    this.pointerSteerY = 0;
  };

  private readonly onWindowBlur = (): void => {
    this.keysHeld.clear();
    this.uiBoostHeld = false;
    this.touchActive = false;
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.keysHeld.clear();
      this.uiBoostHeld = false;
    }
  };

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
  };

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove, { passive: true });
    window.addEventListener('touchstart', this.onTouchStart, { passive: true });
    window.addEventListener('touchmove', this.onTouchMove, { passive: true });
    window.addEventListener('touchend', this.onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', this.onTouchEnd, { passive: true });
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.mountEl);
  }

  private handleResize(): void {
    const rect = this.mountEl.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width || window.innerWidth));
    const h = Math.max(1, Math.floor(rect.height || window.innerHeight));
    this.viewWidth = w;
    this.viewHeight = h;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);

    const fxDpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 1.5);
    this.fxCanvas.width = Math.floor(w * fxDpr);
    this.fxCanvas.height = Math.floor(h * fxDpr);
    if (this.fxCtx) {
      this.fxCtx.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
    }

    if (this.world && !this.disposed) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private readControlInput(): ControlInput {
    let kx = 0;
    let ky = 0;
    if (this.keysHeld.has('ArrowLeft') || this.keysHeld.has('KeyA')) kx -= 1;
    if (this.keysHeld.has('ArrowRight') || this.keysHeld.has('KeyD')) kx += 1;
    if (this.keysHeld.has('ArrowUp') || this.keysHeld.has('KeyW')) ky += 1;
    if (this.keysHeld.has('ArrowDown') || this.keysHeld.has('KeyS')) ky -= 1;

    if (kx !== 0 || ky !== 0) {
      this.inputMode = 'keyboard';
    }

    this._controlInput.steerX = this.inputMode === 'keyboard' ? kx : this.pointerSteerX;
    this._controlInput.steerY = this.inputMode === 'keyboard' ? ky : this.pointerSteerY;
    this._controlInput.boost = this.keysHeld.has('Space') || this.uiBoostHeld;
    return this._controlInput;
  }

  private syncCraftTransform(dt: number): void {
    this._craftPos.set(this.flight.x, this.flight.y, this.flight.z);
    this._craftEuler.set(this.flight.pitch, this.flight.yaw, this.flight.roll, 'YXZ');
    this._craftQuat.setFromEuler(this._craftEuler);

    this.spacecraft.group.position.copy(this._craftPos);
    this.spacecraft.group.quaternion.copy(this._craftQuat);

    // Subtle high-speed aerodynamic airframe rattle when pushing extreme Mach or afterburner
    const speedExcess = Math.max(0, this.flight.mach - 1.65);
    const rattleAmp =
      (speedExcess * 0.03 + (this.flight.isBoosting ? 0.036 : 0)) *
      (this.phase === 'playing' && !this.flight.crashed ? 1 : 0);
    if (rattleAmp > 0.002) {
      this.spacecraft.hullRoot.position.set(
        (Math.random() - 0.5) * rattleAmp,
        (Math.random() - 0.5) * rattleAmp,
        0,
      );
    } else {
      this.spacecraft.hullRoot.position.set(0, 0, 0);
    }

    if (!this.flight.crashed) {
      this.spacecraft.updateVisuals(
        dt,
        this.flight.mach,
        this.flight.isBoosting,
        this.flight.roll,
        this._craftPos,
        this._craftQuat,
      );
      this.pushFxTrailSample();
    }
  }

  private updateZoneAtmosphere(): void {
    this.world.getZoneFogColor(this.flight.z, this._zoneFogColor);
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this._zoneFogColor);
    }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(this._zoneFogColor);
    }
  }

  private updateSunShadowRig(): void {
    const targetX = this.flight.x;
    const targetZ = this.flight.z - 55;
    this.sunLight.target.position.set(targetX, 12, targetZ);
    this.sunLight.position.set(
      targetX + SUN_DIRECTION.x * 190,
      12 + SUN_DIRECTION.y * 190,
      targetZ + SUN_DIRECTION.z * 190,
    );
  }

  private updateCamera(dt: number): void {
    if (this.phase === 'title') {
      this.camera.up.set(0, 1, 0);
      this.titleOrbitClock += dt;
      const swayX = Math.sin(this.titleOrbitClock * 0.36) * 5.8;
      const swayY = 4.6 + Math.cos(this.titleOrbitClock * 0.28) * 1.4;
      this._camTargetPos.set(
        this.flight.x + swayX,
        this.flight.y + swayY,
        this.flight.z + 13.8,
      );
      this.camera.position.x = damp(this.camera.position.x, this._camTargetPos.x, 4.5, dt);
      this.camera.position.y = damp(this.camera.position.y, this._camTargetPos.y, 4.5, dt);
      this.camera.position.z = this._camTargetPos.z;

      this._camLookAt.set(this.flight.x - swayX * 0.3, this.flight.y + 0.8, this.flight.z - 42);
      this._curCamLook.lerp(this._camLookAt, 1 - Math.exp(-6 * dt));
      this.camera.lookAt(this._curCamLook);
      this.camera.rotation.z = damp(this.camera.rotation.z, this.flight.roll * 0.12, 4, dt);
      return;
    }

    // Decaying trauma*trauma shake + extreme-Mach aerodynamic vibration
    this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.85);
    const shakeMag = this.cameraTrauma * this.cameraTrauma;
    const speedRattle =
      !this.flight.crashed
        ? Math.max(0, this.flight.mach - 1.75) * 0.026 + (this.flight.isBoosting ? 0.042 : 0)
        : 0;

    if (this.cameraView === 'cockpit' && !this.flight.crashed) {
      // 2. First-Person Cockpit View: inside glass canopy looking cleanly over the tapered needle nose
      this._camTargetPos.set(0, 0.74, -1.35).applyQuaternion(this._craftQuat).add(this._craftPos);
      this._camLookAt.set(0, 0.35, -72).applyQuaternion(this._craftQuat).add(this._craftPos);
      this.camera.position.copy(this._camTargetPos);
      this._curCamLook.copy(this._camLookAt);

      // Subtle aerodynamic rattle inside the cockpit at extreme Mach / afterburners
      if (shakeMag > 0.001 || speedRattle > 0.001) {
        const amp = shakeMag * 0.22 + speedRattle * 0.42;
        this.camera.position.x += (Math.random() - 0.5) * amp;
        this.camera.position.y += (Math.random() - 0.5) * amp;
      }

      // Authentic roll tilt from spacecraft orientation
      this._camUpScratch.set(0, 1, 0).applyQuaternion(this._craftQuat);
      this.camera.up.lerp(this._camUpScratch, 1 - Math.exp(-16 * dt));
      this.camera.lookAt(this._curCamLook);
    } else if (this.cameraView === 'wing' && !this.flight.crashed) {
      // 3. Wing-Tip Action View: dramatic starboard wing mount showcasing glowing blue-and-red thruster plume + needle nose!
      this.camera.up.set(0, 1, 0);
      const boostBack = this.flight.isBoosting ? 0.72 : 0;
      this._camTargetPos
        .set(4.85, 0.76, 4.45 + boostBack)
        .applyQuaternion(this._craftQuat)
        .add(this._craftPos);
      this._camLookAt.set(-0.35, 0.14, -30).applyQuaternion(this._craftQuat).add(this._craftPos);

      this.camera.position.x = damp(this.camera.position.x, this._camTargetPos.x, 18, dt);
      this.camera.position.y = damp(this.camera.position.y, this._camTargetPos.y, 18, dt);
      this.camera.position.z = this._camTargetPos.z;

      this._curCamLook.x = damp(this._curCamLook.x, this._camLookAt.x, 16, dt);
      this._curCamLook.y = damp(this._curCamLook.y, this._camLookAt.y, 16, dt);
      this._curCamLook.z = this._camLookAt.z;
      this.camera.lookAt(this._curCamLook);

      const amp = shakeMag * 0.45 + speedRattle * 0.75;
      if (amp > 0.001) {
        this.camera.position.x += (Math.random() - 0.5) * amp;
        this.camera.position.y += (Math.random() - 0.5) * amp;
      }
      this.camera.rotation.z += this.flight.roll * 0.42;
    } else if (this.cameraView === 'cinematic') {
      // 4. Cinematic Flyby View: sweeping filmic camera cutting cleanly every ~6s across 4 heroic angles!
      this.camera.up.set(0, 1, 0);
      this.cinematicClock += dt;
      const shotDuration = 6.0;
      const shotIdx = Math.floor(this.cinematicClock / shotDuration) % 4;
      const shotT = (this.cinematicClock % shotDuration) / shotDuration; // 0..1

      let offX = 0;
      let offY = 4;
      let offZ = 14;
      let lookZ = -18;

      if (shotIdx === 0) {
        // Shot 0: Heroic low front-quarter tracking angle looking back at the roaring jet & towering cliffs
        offX = 14 - shotT * 8.5;
        offY = 4.2 + Math.sin(shotT * Math.PI) * 2.5;
        offZ = -18 + shotT * 5.0;
        lookZ = 0.5;
      } else if (shotIdx === 1) {
        // Shot 1: Wide dramatic side-tracking flyby gliding alongside the banking supersonic jet
        offX = -21 + shotT * 5;
        offY = 4.6 + Math.cos(shotT * Math.PI) * 2.2;
        offZ = -3 + shotT * 11;
        lookZ = -10;
      } else if (shotIdx === 2) {
        // Shot 2: Sweeping high canyon overview looking down as the jet threads arches & Speed Gates
        offX = -10 + shotT * 20;
        offY = 17.5 - shotT * 4;
        offZ = 18.5;
        lookZ = -34;
      } else {
        // Shot 3: Dramatic low rear-quarter hero chase skimming close to the Martian floor
        offX = 9.5 - shotT * 19;
        offY = 2.4 + shotT * 2.4;
        offZ = 13.5 + (this.flight.isBoosting ? 2.5 : 0);
        lookZ = -38;
      }

      const desiredX = this.flight.x + offX;
      const desiredZ = this.flight.z + offZ;
      const minSafeCamY = getTerrainHeight(desiredX, desiredZ, this.difficulty) + 5.0;
      const desiredY = Math.max(minSafeCamY, this.flight.y + offY);

      if (shotIdx !== this.lastCinematicShotIdx) {
        this.lastCinematicShotIdx = shotIdx;
        this.camera.position.set(desiredX, desiredY, desiredZ);
        this._curCamLook.set(this.flight.x, this.flight.y + 0.6, this.flight.z + lookZ);
      } else {
        this.camera.position.x = damp(this.camera.position.x, desiredX, 6.0, dt);
        this.camera.position.y = damp(this.camera.position.y, desiredY, 6.0, dt);
        this.camera.position.z = damp(this.camera.position.z, desiredZ, 8.5, dt);
        this._camLookAt.set(this.flight.x, this.flight.y + 0.6, this.flight.z + lookZ);
        this._curCamLook.x = damp(this._curCamLook.x, this._camLookAt.x, 9.0, dt);
        this._curCamLook.y = damp(this._curCamLook.y, this._camLookAt.y, 9.0, dt);
        this._curCamLook.z = damp(this._curCamLook.z, this._camLookAt.z, 11.0, dt);
      }
      this.camera.lookAt(this._curCamLook);
    } else {
      // 1. Chase View (Default): energetic behind-the-craft chase that pulls smoothly back when afterburners roar
      this.camera.up.set(0, 1, 0);
      const boostPull = this.flight.isBoosting ? 2.6 : 0;
      const desiredCamX = this.flight.x - this.flight.vx * 0.046;
      const desiredCamY = Math.max(this.flight.y + 3.65 - this.flight.vy * 0.032, 4.8);
      const desiredCamZ = this.flight.z + 11.4 + boostPull;

      this.camera.position.x = damp(this.camera.position.x, desiredCamX, 11, dt);
      this.camera.position.y = damp(this.camera.position.y, desiredCamY, 10, dt);
      this.camera.position.z = damp(this.camera.position.z, desiredCamZ, 7.5, dt);

      this._camLookAt.set(
        this.flight.x + this.flight.vx * 0.12,
        this.flight.y + 0.95 + this.flight.vy * 0.06,
        this.flight.z - 56,
      );
      this._curCamLook.x = damp(this._curCamLook.x, this._camLookAt.x, 12, dt);
      this._curCamLook.y = damp(this._curCamLook.y, this._camLookAt.y, 12, dt);
      this._curCamLook.z = this._camLookAt.z;
      this.camera.lookAt(this._curCamLook);

      const camRoll = this.flight.roll * 0.24;
      if (shakeMag > 0.001 || speedRattle > 0.001) {
        const amp = shakeMag * 0.75 + speedRattle;
        this.camera.position.x += (Math.random() - 0.5) * amp * 1.4;
        this.camera.position.y += (Math.random() - 0.5) * amp * 1.4;
        this.camera.rotation.z += camRoll + (Math.random() - 0.5) * amp * 0.08;
      } else {
        this.camera.rotation.z += camRoll;
      }
    }

    // Dynamic FOV widening with Mach speed, afterburner, near-miss, gate burst, and shockwave kicks
    this.nearMissFovKick = damp(this.nearMissFovKick, 0, 4.2, dt);
    this.shockwaveFovKick = damp(this.shockwaveFovKick, 0, 3.5, dt);
    const baseFov =
      this.cameraView === 'cockpit'
        ? 72
        : this.cameraView === 'wing'
          ? 70
          : this.cameraView === 'cinematic'
            ? 58
            : 62;
    const targetFov = Math.min(
      96,
      baseFov +
        Math.max(0, this.flight.mach - 1.0) * 6.8 +
        (this.flight.isBoosting ? 8.2 : 0) +
        this.nearMissFovKick +
        this.shockwaveFovKick,
    );
    const nextFov = damp(this.camera.fov, targetFov, 7.5, dt);
    if (Math.abs(nextFov - this.camera.fov) > 0.02) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Projects a 3D trail ring buffer onto the 2D fxCanvas and draws glowing Mach-reactive
   * paths whose length, width, opacity, and plasma color intensity scale smoothly with Mach speed.
   */
  private drawFxAircraftTrails(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    mach: number,
    boosting: boolean,
  ): void {
    if (this.trailCount < 2) return;

    // Ensure camera matrices reflect the latest frame transform before projecting 3D -> 2D
    this.camera.updateMatrixWorld();

    // Normalized Mach speed factor 0 (Mach 1.1) -> 1 (Mach 3.4+)
    const machNorm = Math.max(0, Math.min(1, (mach - 1.1) / 2.3 + (boosting ? 0.25 : 0)));

    // Trail length dynamically grows with Mach speed (from 14 samples up to full 54 samples!)
    const desiredSegments = Math.max(
      12,
      Math.min(this.trailCount, Math.round(14 + machNorm * (FX_TRAIL_CAPACITY - 14))),
    );

    // Dynamic color palette:
    // Wingtips stay crisp supersonic cyan-blue; during Afterburner Boost, the center engine exhaust
    // blazes with a fiery crimson-red outer plasma halo and vivid electric-blue inner core!
    const wingOuterR = Math.round(48 + machNorm * 95);
    const wingOuterG = Math.round(205 + (1 - Math.abs(machNorm - 0.5)) * 35);
    const wingOuterB = 255;

    const wingCoreR = 224;
    const wingCoreG = 248;
    const wingCoreB = 255;

    const centerOuterR = boosting ? 255 : wingOuterR;
    const centerOuterG = boosting ? 26 : wingOuterG;
    const centerOuterB = boosting ? 48 : wingOuterB;

    const centerCoreR = boosting ? 46 : wingCoreR;
    const centerCoreG = boosting ? 226 : wingCoreG;
    const centerCoreB = 255;

    const baseOpacity = (0.34 + machNorm * 0.54) * (boosting ? 1.24 : 1.0);
    const baseOuterWidth = (3.2 + machNorm * 6.8) * (boosting ? 1.38 : 1.0);
    const baseCoreWidth = (1.1 + machNorm * 2.4) * (boosting ? 1.32 : 1.0);

    const drawRibbon = (
      channel: 'left' | 'right' | 'center',
      widthScale: number,
      alphaScale: number,
    ) => {
      const isCenter = channel === 'center';
      const outerR = isCenter ? centerOuterR : wingOuterR;
      const outerG = isCenter ? centerOuterG : wingOuterG;
      const outerB = isCenter ? centerOuterB : wingOuterB;
      const coreR = isCenter ? centerCoreR : wingCoreR;
      const coreG = isCenter ? centerCoreG : wingCoreG;
      const coreB = isCenter ? centerCoreB : wingCoreB;

      let validCount = 0;
      for (let step = 0; step < desiredSegments; step++) {
        const ringIdx = (this.trailHead - 1 - step + FX_TRAIL_CAPACITY) % FX_TRAIL_CAPACITY;
        const sample = this._trailRing[ringIdx];
        if (!sample.valid) {
          this._projValid[step] = 0;
          continue;
        }
        const worldPt = sample[channel];
        this._projScratch.copy(worldPt).project(this.camera);

        // Guard against behind-camera NDC inversion
        if (this._projScratch.z < -1 || this._projScratch.z > 1) {
          this._projValid[step] = 0;
          continue;
        }

        this._projX[step] = (this._projScratch.x * 0.5 + 0.5) * w;
        this._projY[step] = (-this._projScratch.y * 0.5 + 0.5) * h;
        this._projValid[step] = 1;
        validCount++;
      }

      if (validCount < 2) return;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Draw tapered glowing segments from newest (near wingtip/nozzle) to oldest (trailing fade)
      for (let step = 0; step < desiredSegments - 1; step++) {
        if (!this._projValid[step] || !this._projValid[step + 1]) continue;

        const x1 = this._projX[step];
        const y1 = this._projY[step];
        const x2 = this._projX[step + 1];
        const y2 = this._projY[step + 1];

        // Skip huge jump if a point wrapped offscreen near clip plane
        const segLenSq = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
        if (segLenSq > w * w * 0.35) continue;

        const t = step / (desiredSegments - 1); // 0 at craft -> 1 at tail tip
        const fade = Math.pow(1 - t, 1.6);

        // Pass 1: Luminous plasma glow halo (fiery crimson-red on center exhaust during boost, cool Mach cyan on wingtips)
        const outerAlpha = Math.min(0.92, baseOpacity * alphaScale * fade * (boosting && isCenter ? 0.86 : 0.6));
        if (outerAlpha > 0.01) {
          ctx.strokeStyle = `rgba(${outerR}, ${outerG}, ${outerB}, ${outerAlpha.toFixed(3)})`;
          ctx.lineWidth = Math.max(0.6, baseOuterWidth * widthScale * (0.2 + 0.8 * fade));
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        // Pass 2: Vivid electric-blue / white-hot supersonic filament core
        const coreAlpha = Math.min(0.96, baseOpacity * alphaScale * fade * 0.92);
        if (coreAlpha > 0.015) {
          ctx.strokeStyle = `rgba(${coreR}, ${coreG}, ${coreB}, ${coreAlpha.toFixed(3)})`;
          ctx.lineWidth = Math.max(0.4, baseCoreWidth * widthScale * (0.18 + 0.82 * fade));
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }

      ctx.restore();
    };

    // Draw port & starboard Mach wingtip trails + intense center thruster slipstream path
    drawRibbon('left', 0.95, 0.95);
    drawRibbon('right', 0.95, 0.95);
    drawRibbon('center', boosting ? 1.85 : 1.15, boosting ? 1.05 : 0.68);
  }

  /**
   * Renders Mach-reactive 2D aircraft contrail paths, rushing white wind streaks,
   * and subtle high-speed peripheral radial motion-blur vignette onto fxCanvasRef.
   */
  private renderSpeedOverlay(dt: number): void {
    const ctx = this.fxCtx;
    if (!ctx) return;

    const w = this.viewWidth;
    const h = this.viewHeight;
    ctx.clearRect(0, 0, w, h);

    if (this.phase === 'paused' || this.flight.crashed) {
      return;
    }

    if (this.gateWindBurstTimer > 0) {
      this.gateWindBurstTimer = Math.max(0, this.gateWindBurstTimer - dt);
    }
    const diffCfg = getDifficultyConfig(this.difficulty);
    const mach = this.flight.mach;
    const boostExtra = this.flight.isBoosting ? 0.38 : 0;
    const gateExtra = this.gateWindBurstTimer > 0 ? 0.42 * Math.min(1, this.gateWindBurstTimer) : 0;
    const rawIntensity = Math.max(
      0,
      Math.min(1, ((mach - 1.0) / 2.2) * diffCfg.windStreakMultiplier + boostExtra + gateExtra),
    );
    const intensity = this.phase === 'title' ? rawIntensity * 0.45 : rawIntensity;

    // 1. Draw Mach-reactive luminous aircraft trails projected onto fxCanvasRef (hidden in cockpit view for crisp glass)
    if (this.cameraView !== 'cockpit' || this.phase === 'title') {
      this.drawFxAircraftTrails(ctx, w, h, mach, this.flight.isBoosting);
    }

    const cx = w * 0.5;
    const cy = h * 0.48;
    const maxRadius = Math.hypot(cx, cy);

    // 2. Subtle high-speed radial peripheral motion-blur edge vignette (deep crimson edge pulse on Hard / Boost)
    if (intensity > 0.08) {
      const grad = ctx.createRadialGradient(
        cx,
        cy,
        maxRadius * (0.58 - intensity * 0.12),
        cx,
        cy,
        maxRadius * 1.03,
      );
      grad.addColorStop(0, 'rgba(255, 196, 150, 0)');
      if (this.difficulty === 'hard' || this.flight.isBoosting) {
        grad.addColorStop(0.75, `rgba(220, 42, 46, ${(intensity * 0.095).toFixed(3)})`);
      } else {
        grad.addColorStop(0.75, `rgba(232, 118, 56, ${(intensity * 0.075).toFixed(3)})`);
      }
      grad.addColorStop(1, `rgba(18, 5, 4, ${(intensity * 0.25).toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    // 3. Rushing wind streaks along the screen periphery (intensifies on Hard, afterburners & Speed Gate surges!)
    const activeCount = Math.min(
      this.windStreaks.length,
      Math.floor((18 + intensity * (this.windStreaks.length - 18)) * Math.min(1.25, diffCfg.windStreakMultiplier)),
    );
    const travelRate =
      (1.45 +
        mach * 0.85 +
        (this.flight.isBoosting ? 1.25 : 0) +
        (this.gateWindBurstTimer > 0 ? 1.35 : 0)) *
      (0.85 + diffCfg.windStreakMultiplier * 0.22);

    ctx.lineCap = 'round';
    for (let i = 0; i < activeCount; i++) {
      const s = this.windStreaks[i];
      s.dist += s.speed * travelRate * dt;
      if (s.dist > 1.22) {
        s.dist = 0.42 + Math.random() * 0.26;
        s.angle = Math.random() * Math.PI * 2;
      }

      const innerR = Math.max(0.46, s.dist - s.length * (0.65 + intensity * 0.95));
      const outerR = s.dist;
      if (outerR <= 0.48) continue;

      const cos = Math.cos(s.angle);
      const sin = Math.sin(s.angle);
      const x1 = cx + cos * innerR * maxRadius;
      const y1 = cy + sin * innerR * maxRadius;
      const x2 = cx + cos * outerR * maxRadius;
      const y2 = cy + sin * outerR * maxRadius;

      const edgeFade = Math.min(1, (outerR - 0.48) * 3.0);
      const alpha = s.alpha * edgeFade * (0.24 + intensity * 0.56);

      ctx.strokeStyle =
        this.gateWindBurstTimer > 0
          ? `rgba(195, 252, 255, ${Math.min(0.95, alpha * 1.2).toFixed(3)})`
          : this.flight.isBoosting
            ? i % 3 === 0
              ? `rgba(255, 118, 128, ${Math.min(0.92, alpha * 1.1).toFixed(3)})`
              : `rgba(186, 240, 255, ${alpha.toFixed(3)})`
            : this.difficulty === 'hard'
              ? `rgba(255, 224, 214, ${Math.min(0.92, alpha * 1.12).toFixed(3)})`
              : `rgba(255, 245, 236, ${alpha.toFixed(3)})`;
      ctx.lineWidth =
        this.flight.isBoosting || this.gateWindBurstTimer > 0
          ? 2.0
          : this.difficulty === 'hard'
            ? 1.6
            : 1.35;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  private emitTelemetryNow(): void {
    const mach = this.flight.mach;
    const intensity = Math.max(
      0,
      Math.min(1, (mach - 1.05) / 2.2 + (this.flight.isBoosting ? 0.3 : 0)),
    );
    const zone = getZoneInfoAtZ(this.flight.z);
    const rec = this.records[this.difficulty];
    this.callbacks.onTelemetry({
      difficulty: this.difficulty,
      mach,
      speedMetersPerSec: computeSpeedFromMach(mach),
      altitude: Math.max(0, Math.round(this.flight.y)),
      distance: Math.round(this.flight.distance),
      score: Math.round(this.flight.score),
      bestScore: Math.round(Math.max(rec.bestScore, this.flight.score)),
      bestDistance: Math.round(Math.max(rec.bestDistance, this.flight.distance)),
      bestMach: Math.max(rec.bestMach, this.flight.peakMach),
      nearMissCount: this.flight.nearMissCount,
      boostCharge: this.flight.boostCharge,
      isBoosting: this.flight.isBoosting,
      boostOverheated: this.flight.boostLockout,
      speedIntensity: intensity,
      autoplayActive: this.autoplayActive,
      zoneId: zone.id,
      zoneName: zone.name,
      gateStreak: this.flight.gateStreak,
      gateMultiplier: 1 + this.flight.gateStreak,
      gatesPassed: this.flight.gatesPassed,
      cameraView: this.cameraView,
      roll: this.flight.roll,
      pitch: this.flight.pitch,
    });
  }

  private finishGameOver(): void {
    const finalScore = Math.round(this.flight.score);
    const finalDistance = Math.round(this.flight.distance);
    const peakMach = Number(this.flight.peakMach.toFixed(2));
    const rec = this.records[this.difficulty];

    const isNewBestScore = finalScore > rec.bestScore;
    const isNewBestMach = peakMach > rec.bestMach;
    const isNewBestDistance = finalDistance > rec.bestDistance;

    if (isNewBestScore) rec.bestScore = finalScore;
    if (isNewBestMach) rec.bestMach = peakMach;
    if (isNewBestDistance) rec.bestDistance = finalDistance;
    if (isNewBestScore || isNewBestMach || isNewBestDistance) {
      this.saveRecords();
      this.callbacks.onDifficultyChange(this.difficulty, this.cloneRecords());
    }

    const summary: RunSummary = {
      difficulty: this.difficulty,
      score: finalScore,
      bestScore: Math.round(rec.bestScore),
      peakMach,
      bestMach: Number(rec.bestMach.toFixed(2)),
      distance: finalDistance,
      bestDistance: Math.round(rec.bestDistance),
      nearMissCount: this.flight.nearMissCount,
      gatesPassed: this.flight.gatesPassed,
      survivalSeconds: Math.round(this.flight.survivalSeconds),
      isNewBestScore,
      isNewBestMach,
      isNewBestDistance,
    };

    this.setPhase('gameover');
    this.callbacks.onGameOver(summary);
  }

  private scheduleNextFrame(): void {
    if (this.disposed) return;

    if (this.isSoftwareGl) {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(this.tick, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private readonly tick = (): void => {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = (now - this.lastTimeMs) / 1000;
    this.lastTimeMs = now;
    const dt = Math.min(Math.max(rawDt, 0.001), MAX_DT);

    if (this.phase === 'title') {
      const step = stepFlightSimulation(
        this.flight,
        { steerX: 0, steerY: 0, boost: false },
        dt,
        { autopilot: true },
      );
      this.flight = step.state;
      this.syncCraftTransform(dt);
      this.world.update(dt, this.flight.x, this.flight.y, this.flight.z, this.flight.survivalSeconds);
      this.updateZoneAtmosphere();
      this.updateSunShadowRig();
      this.updateCamera(dt);
      this.renderSpeedOverlay(dt);
    } else if (this.phase === 'playing') {
      if (this.hitstopTimer > 0) {
        this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      } else if (!this.flight.crashed) {
        const input = this.readControlInput();
        const { state: nextFlight, events } = stepFlightSimulation(this.flight, input, dt, {
          gameplayAutoplay: this.autoplayActive,
        });
        this.flight = nextFlight;

        if (events.boostStarted) {
          this.audio.playBoostIgnite();
          this.spacecraft.triggerShockwave(0.65);
          this.shockwaveFovKick = Math.max(this.shockwaveFovKick, 4.8);
        }

        if (events.boostOverheated) {
          this.audio.playBoostOverheat();
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.22);
          this.emitTelemetryNow();
        }

        if (events.gatePassed) {
          const gp = events.gatePassed;
          this.world.triggerGatePass(gp.gateId);
          this.world.spawnGateSparks(gp.x, gp.y, gp.z);
          this.audio.playSpeedGate(gp.multiplier - 1);
          this.gateWindBurstTimer = 1.35;
          this.nearMissFovKick = Math.max(this.nearMissFovKick, 6.8);
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.25);
          this.callbacks.onGateFlash();
          this.callbacks.onBanner({
            id: this.bannerSeq++,
            kind: 'gate',
            label: `SPEED GATE x${gp.multiplier}`,
            sublabel: `+${gp.bonusScore} · +${Math.round(gp.boostRefill * 100)}% BOOST`,
          });
          this.emitTelemetryNow();
        }

        if (events.scrape) {
          this.audio.playScrape();
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.52);
          this.world.spawnScrapeSparks(this.flight.x, this.flight.y, this.flight.z);
          this.callbacks.onScrapeFlash();
          this.callbacks.onBanner({
            id: this.bannerSeq++,
            kind: 'scrape',
            label: 'HULL GRAZE',
            sublabel: 'SHIELD DEFLECTED · PULL CLEAR',
          });
        }

        if (events.nearMiss) {
          this.audio.playNearMiss();
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.34);
          this.nearMissFovKick = 6.0;
          this.world.spawnNearMissSparks(this.flight.x, this.flight.y, this.flight.z);
          this.callbacks.onNearMissFlash();
          this.callbacks.onBanner({
            id: this.bannerSeq++,
            kind: 'near-miss',
            label: 'NEAR MISS',
            sublabel: `+${events.nearMiss.bonusScore} · +${events.nearMiss.machGain.toFixed(2)} MACH`,
          });
        }

        if (events.milestoneMach !== null) {
          this.audio.playShockwave();
          this.spacecraft.triggerShockwave(1.15);
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.42);
          this.shockwaveFovKick = 7.2;
          this.callbacks.onBanner({
            id: this.bannerSeq++,
            kind: 'shockwave',
            label: `MACH ${events.milestoneMach.toFixed(1)} BARRIER`,
            sublabel: 'SUPERSONIC SHOCKWAVE',
          });
        }

        if (events.zoneChanged) {
          this.callbacks.onBanner({
            id: this.bannerSeq++,
            kind: 'zone',
            label: events.zoneChanged.name.toUpperCase(),
            sublabel: events.zoneChanged.subtitle.toUpperCase(),
          });
          this.emitTelemetryNow();
        }

        if (events.crashed) {
          this.hitstopTimer = 0.055;
          this.crashDelayTimer = 0.58;
          this.cameraTrauma = 1.0;
          this.spacecraft.setVisible(false);
          this.world.spawnCrashExplosion(this.flight.x, this.flight.y, this.flight.z);
          this.audio.setEngineActive(false);
          this.audio.playCrash();
        }
      }

      if (this.flight.crashed && this.hitstopTimer <= 0) {
        this.crashDelayTimer -= dt;
        if (this.crashDelayTimer <= 0) {
          this.finishGameOver();
        }
      }

      this.syncCraftTransform(dt);
      this.world.update(dt, this.flight.x, this.flight.y, this.flight.z, this.flight.survivalSeconds);
      this.updateZoneAtmosphere();
      this.updateSunShadowRig();
      this.updateCamera(dt);
      this.renderSpeedOverlay(dt);

      if (!this.flight.crashed) {
        this.audio.updateEngine(this.flight.mach, this.flight.isBoosting);
      }

      this.telemetryAccum += dt;
      if (this.telemetryAccum >= 0.065) {
        this.telemetryAccum = 0;
        this.emitTelemetryNow();
      }
    } else if (this.phase === 'gameover') {
      this.world.update(dt, this.flight.x, this.flight.y, this.flight.z, this.flight.survivalSeconds);
      this.updateCamera(dt);
    }

    this.renderer.render(this.scene, this.camera);
    this.scheduleNextFrame();
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('touchend', this.onTouchEnd);
    window.removeEventListener('touchcancel', this.onTouchEnd);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);

    this.resizeObserver?.disconnect();
    this.audio.dispose();
    this.spacecraft.dispose();
    this.world.dispose();
    this.materials.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentNode === this.mountEl) {
      this.mountEl.removeChild(this.renderer.domElement);
    }
  }
}
