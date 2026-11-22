import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FlightAudioEngine } from './audio';
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
import type { ControlInput, FlightTelemetry, GamePhase, HudBannerEvent, RunSummary } from './types';

const STORAGE_BEST_SCORE = 'ares_mach_best_score_v1';
const STORAGE_BEST_MACH = 'ares_mach_best_mach_v1';

interface WindStreak {
  angle: number;
  dist: number; // 0.35..1.15 normalized radial distance from center
  speed: number;
  length: number;
  alpha: number;
}

export interface MarsFlightCallbacks {
  onPhaseChange: (phase: GamePhase) => void;
  onTelemetry: (telemetry: FlightTelemetry) => void;
  onBanner: (event: HudBannerEvent) => void;
  onGameOver: (summary: RunSummary) => void;
  onMuteChange: (muted: boolean) => void;
  onNearMissFlash: () => void;
}

/**
 * Self-contained Three.js supersonic Mars canyon flight engine.
 * Owns WebGLRenderer, software-WebGL pacing, 2D rushing wind streaks/motion blur overlay,
 * unified keyboard/mouse/touch controls, procedural audio, and throttled React telemetry hooks.
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
  private flight: FlightState = createInitialFlightState();
  private bestScore = 0;
  private bestMach = 1.15;

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

  // Pre-allocated math helpers for zero-GC render loop
  private readonly _craftPos = new THREE.Vector3();
  private readonly _craftEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly _craftQuat = new THREE.Quaternion();
  private readonly _camTargetPos = new THREE.Vector3();
  private readonly _camLookAt = new THREE.Vector3();
  private readonly _curCamLook = new THREE.Vector3(0, 18, -40);
  private readonly _controlInput: ControlInput = { steerX: 0, steerY: 0, boost: false };

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
    this.scene.fog = new THREE.FogExp2(HORIZON_FOG_COLOR, 0.00185);

    // Mandatory studio environment reflection map on every device
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Camera
    this.camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.4, 1200);
    this.camera.position.set(4.5, 22.5, 13.8);

    // Warm/cool Martian atmospheric lighting rig with dramatic raking shadows
    this.sunLight = new THREE.DirectionalLight(0xffbe7d, 2.25);
    this.sunLight.position.copy(SUN_DIRECTION).multiplyScalar(180);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 20;
    this.sunLight.shadow.camera.far = 420;
    const d = 105;
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

    this.syncCraftTransform(0.016);
    this.spacecraft.resetTrails(this._craftPos);
    this.world.update(0.016, this.flight.x, this.flight.y, this.flight.z);
    this.updateSunShadowRig();

    if (initialAutostart) {
      this.startRun();
    } else {
      this.setPhase('title');
      this.camera.position.set(this.flight.x + 4.2, this.flight.y + 4.4, this.flight.z + 13.6);
      this._curCamLook.set(this.flight.x - 1.2, this.flight.y + 0.8, this.flight.z - 42);
      this.camera.lookAt(this._curCamLook);
    }

    this.lastTimeMs = performance.now();
    this.tick();
  }

  private loadSavedRecords(): void {
    try {
      const savedScore = Number(window.localStorage.getItem(STORAGE_BEST_SCORE));
      const savedMach = Number(window.localStorage.getItem(STORAGE_BEST_MACH));
      if (Number.isFinite(savedScore) && savedScore > 0) this.bestScore = savedScore;
      if (Number.isFinite(savedMach) && savedMach > 1.15) this.bestMach = savedMach;
    } catch {
      // Ignore storage failures
    }
  }

  private saveRecords(): void {
    try {
      window.localStorage.setItem(STORAGE_BEST_SCORE, String(Math.round(this.bestScore)));
      window.localStorage.setItem(STORAGE_BEST_MACH, this.bestMach.toFixed(2));
    } catch {
      // Ignore storage failures
    }
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase;
    document.body.dataset.state = phase;
    this.callbacks.onPhaseChange(phase);
    this.audio.setEngineActive(phase === 'playing');
  }

  public startRun(): void {
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

    this.flight = createInitialFlightState();
    this.world.reset();
    this.spacecraft.setVisible(true);
    this.syncCraftTransform(0.016);
    this.spacecraft.resetTrails(this._craftPos);

    // Snap chase camera cleanly right behind the craft for immediate zero-disorientation launch
    this.camera.position.set(this.flight.x, this.flight.y + 4.4, this.flight.z + 12.8);
    this._curCamLook.set(this.flight.x, this.flight.y + 1.2, this.flight.z - 42);
    this.camera.lookAt(this._curCamLook);
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
    this.flight = createInitialFlightState();
    this.world.reset();
    this.spacecraft.setVisible(true);
    this.syncCraftTransform(0.016);
    this.spacecraft.resetTrails(this._craftPos);
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

    // Prevent browser scrolling on game keys
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
        this.startRun();
      }
      return;
    }

    if (this.phase === 'gameover') {
      if ((code === 'Enter' || code === 'Space' || code === 'KeyR') && !e.repeat) {
        this.startRun();
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
      this.startRun();
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
    if (this.phase !== 'playing' || this.touchActive) return;
    const rect = this.mountEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1; // -1..1
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1); // +1 up, -1 down

    // Smooth deadzone in the center so tiny cursor drift feels calm
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
    if (this.phase !== 'playing') return;
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
    if (!this.touchActive || this.phase !== 'playing' || e.touches.length === 0) return;
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
    const speedExcess = Math.max(0, this.flight.mach - 1.55);
    const rattleAmp =
      (speedExcess * 0.032 + (this.flight.isBoosting ? 0.038 : 0)) *
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
    }
  }

  private updateSunShadowRig(): void {
    // Keep directional sun light & shadow frustum locked smoothly around the spacecraft
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
      // Atmospheric sweeping showcase camera gliding behind and slightly off-quarter of the jet
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

    // Intense close-behind supersonic chase camera
    const boostPull = this.flight.isBoosting ? 1.85 : 0;
    const desiredCamX = this.flight.x - this.flight.vx * 0.048;
    const desiredCamY = Math.max(this.flight.y + 3.65 - this.flight.vy * 0.032, 4.5);
    const desiredCamZ = this.flight.z + 11.4 + boostPull;

    this.camera.position.x = damp(this.camera.position.x, desiredCamX, 11, dt);
    this.camera.position.y = damp(this.camera.position.y, desiredCamY, 10, dt);
    this.camera.position.z = desiredCamZ;

    this._camLookAt.set(
      this.flight.x + this.flight.vx * 0.12,
      this.flight.y + 0.95 + this.flight.vy * 0.06,
      this.flight.z - 56,
    );
    this._curCamLook.x = damp(this._curCamLook.x, this._camLookAt.x, 12, dt);
    this._curCamLook.y = damp(this._curCamLook.y, this._camLookAt.y, 12, dt);
    this._curCamLook.z = this._camLookAt.z;
    this.camera.lookAt(this._curCamLook);

    // Subtle chase camera roll into turns for thrilling visceral canyon carving
    const camRoll = this.flight.roll * 0.24;

    // Decaying trauma*trauma shake + extreme-Mach aerodynamic vibration
    this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.85);
    const shakeMag = this.cameraTrauma * this.cameraTrauma;
    const speedRattle =
      !this.flight.crashed
        ? Math.max(0, this.flight.mach - 1.65) * 0.028 + (this.flight.isBoosting ? 0.042 : 0)
        : 0;

    if (shakeMag > 0.001 || speedRattle > 0.001) {
      const amp = shakeMag * 0.75 + speedRattle;
      this.camera.position.x += (Math.random() - 0.5) * amp * 1.4;
      this.camera.position.y += (Math.random() - 0.5) * amp * 1.4;
      this.camera.rotation.z += camRoll + (Math.random() - 0.5) * amp * 0.08;
    } else {
      this.camera.rotation.z += camRoll;
    }

    // Dynamic FOV widening with Mach speed, afterburner, near-miss, and shockwave kicks
    this.nearMissFovKick = damp(this.nearMissFovKick, 0, 4.2, dt);
    this.shockwaveFovKick = damp(this.shockwaveFovKick, 0, 3.5, dt);
    const targetFov = Math.min(
      92,
      62 +
        Math.max(0, this.flight.mach - 1.0) * 7.2 +
        (this.flight.isBoosting ? 7.5 : 0) +
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
   * Draws rushing white wind streaks along the edges of the viewport and a subtle
   * radial peripheral motion-blur vignette that intensifies as Mach increases.
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

    const mach = this.flight.mach;
    const boostExtra = this.flight.isBoosting ? 0.35 : 0;
    const rawIntensity = Math.max(0, Math.min(1, (mach - 1.0) / 2.2 + boostExtra));
    const intensity = this.phase === 'title' ? rawIntensity * 0.42 : rawIntensity;

    const cx = w * 0.5;
    const cy = h * 0.48;
    const maxRadius = Math.hypot(cx, cy);

    // 1. Subtle high-speed radial peripheral motion-blur edge vignette
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
      grad.addColorStop(0.75, `rgba(232, 118, 56, ${(intensity * 0.075).toFixed(3)})`);
      grad.addColorStop(1, `rgba(18, 7, 4, ${(intensity * 0.24).toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    // 2. Rushing white wind streaks along the screen periphery
    const activeCount = Math.floor(18 + intensity * (this.windStreaks.length - 18));
    const travelRate = 1.45 + mach * 0.85 + (this.flight.isBoosting ? 1.15 : 0);

    ctx.lineCap = 'round';
    for (let i = 0; i < activeCount; i++) {
      const s = this.windStreaks[i];
      s.dist += s.speed * travelRate * dt;
      if (s.dist > 1.22) {
        s.dist = 0.42 + Math.random() * 0.26;
        s.angle = Math.random() * Math.PI * 2;
      }

      // Keep center 55% of viewport completely crystal-clear
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

      ctx.strokeStyle = this.flight.isBoosting
        ? `rgba(216, 246, 255, ${alpha.toFixed(3)})`
        : `rgba(255, 245, 236, ${alpha.toFixed(3)})`;
      ctx.lineWidth = this.flight.isBoosting ? 1.85 : 1.35;
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
    this.callbacks.onTelemetry({
      mach,
      speedMetersPerSec: computeSpeedFromMach(mach),
      altitude: Math.max(0, Math.round(this.flight.y)),
      distance: Math.round(this.flight.distance),
      score: Math.round(this.flight.score),
      bestScore: Math.round(Math.max(this.bestScore, this.flight.score)),
      bestMach: Math.max(this.bestMach, this.flight.peakMach),
      nearMissCount: this.flight.nearMissCount,
      boostCharge: this.flight.boostCharge,
      isBoosting: this.flight.isBoosting,
      speedIntensity: intensity,
    });
  }

  private finishGameOver(): void {
    const finalScore = Math.round(this.flight.score);
    const peakMach = Number(this.flight.peakMach.toFixed(2));
    const isNewBestScore = finalScore > this.bestScore;
    const isNewBestMach = peakMach > this.bestMach;

    if (isNewBestScore) this.bestScore = finalScore;
    if (isNewBestMach) this.bestMach = peakMach;
    if (isNewBestScore || isNewBestMach) this.saveRecords();

    const summary: RunSummary = {
      score: finalScore,
      bestScore: Math.round(this.bestScore),
      peakMach,
      bestMach: Number(this.bestMach.toFixed(2)),
      distance: Math.round(this.flight.distance),
      nearMissCount: this.flight.nearMissCount,
      survivalSeconds: Math.round(this.flight.survivalSeconds),
      isNewBestScore,
      isNewBestMach,
    };

    this.setPhase('gameover');
    this.callbacks.onGameOver(summary);
  }

  private scheduleNextFrame(): void {
    if (this.disposed) return;

    if (this.isSoftwareGl) {
      // Wait for CPU WebGL draw completion, then pause 80ms so the main thread & browser never starve
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
      this.world.update(dt, this.flight.x, this.flight.y, this.flight.z);
      this.updateSunShadowRig();
      this.updateCamera(dt);
      this.renderSpeedOverlay(dt);
    } else if (this.phase === 'playing') {
      // Handle brief sim-level hitstop on heavy crash impact while camera shake & particles tick
      if (this.hitstopTimer > 0) {
        this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      } else if (!this.flight.crashed) {
        const input = this.readControlInput();
        const { state: nextFlight, events } = stepFlightSimulation(this.flight, input, dt);
        this.flight = nextFlight;

        if (events.boostStarted) {
          this.audio.playBoostIgnite();
          this.spacecraft.triggerShockwave(0.65);
          this.shockwaveFovKick = Math.max(this.shockwaveFovKick, 4.5);
        }

        if (events.nearMiss) {
          this.audio.playNearMiss();
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.36);
          this.nearMissFovKick = 6.2;
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
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.45);
          this.shockwaveFovKick = 7.5;
          this.callbacks.onBanner({
            id: this.bannerSeq++,
            kind: 'shockwave',
            label: `MACH ${events.milestoneMach.toFixed(1)} BARRIER`,
            sublabel: 'SUPERSONIC SHOCKWAVE',
          });
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
      this.world.update(dt, this.flight.x, this.flight.y, this.flight.z);
      this.updateSunShadowRig();
      this.updateCamera(dt);
      this.renderSpeedOverlay(dt);

      if (!this.flight.crashed) {
        this.audio.updateEngine(this.flight.mach, this.flight.isBoosting);
      }

      // Throttle React HUD telemetry updates to ~15Hz (never 60Hz setState)
      this.telemetryAccum += dt;
      if (this.telemetryAccum >= 0.065) {
        this.telemetryAccum = 0;
        this.emitTelemetryNow();
      }
    } else if (this.phase === 'gameover') {
      // Keep explosion particles gently settling behind the Game Over modal
      this.world.update(dt, this.flight.x, this.flight.y, this.flight.z);
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
