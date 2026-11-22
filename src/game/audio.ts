/**
 * Procedural Web Audio synthesizer for supersonic jet engine, wind rush,
 * near-miss Doppler whoosh, Mach shockwave sonic boom, and impact explosion.
 */
export class FlightAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private turbineOsc: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private running = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.42, this.ctx.currentTime, 0.04);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Lazily unlocks AudioContext on first user gesture */
  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      try {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.muted ? 0 : 0.42;
        this.masterGain.connect(this.ctx.destination);

        // Shared 2-second white noise buffer for wind, whoosh, boom, and crash
        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * 2;
        this.noiseBuffer = this.ctx.createBuffer(1, length, sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
          data[i] = Math.random() * 2 - 1;
        }

        this.setupContinuousEngine();
      } catch {
        // Gracefully ignore if browser blocks audio
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private setupContinuousEngine(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.masterGain);

    // High-tech jet turbine hum
    this.turbineOsc = this.ctx.createOscillator();
    this.turbineOsc.type = 'sawtooth';
    this.turbineOsc.frequency.value = 110;
    const turbineFilter = this.ctx.createBiquadFilter();
    turbineFilter.type = 'lowpass';
    turbineFilter.frequency.value = 420;
    const turbineLevel = this.ctx.createGain();
    turbineLevel.gain.value = 0.14;
    this.turbineOsc.connect(turbineFilter);
    turbineFilter.connect(turbineLevel);
    turbineLevel.connect(this.engineGain);
    this.turbineOsc.start();

    // Deep sub-harmonic thruster rumble
    this.subOsc = this.ctx.createOscillator();
    this.subOsc.type = 'triangle';
    this.subOsc.frequency.value = 54;
    const subLevel = this.ctx.createGain();
    subLevel.gain.value = 0.22;
    this.subOsc.connect(subLevel);
    subLevel.connect(this.engineGain);
    this.subOsc.start();

    // Continuous supersonic canyon wind rush
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;
    noiseSource.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 520;
    this.windFilter.Q.value = 0.85;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.26;

    noiseSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.engineGain);
    noiseSource.start();
  }

  public setEngineActive(active: boolean): void {
    this.running = active;
    if (!this.ctx || !this.engineGain) return;
    this.engineGain.gain.setTargetAtTime(active ? 0.85 : 0, this.ctx.currentTime, 0.08);
  }

  public updateEngine(mach: number, boosting: boolean): void {
    if (!this.ctx || !this.running || !this.turbineOsc || !this.subOsc || !this.windFilter || !this.windGain) {
      return;
    }
    const now = this.ctx.currentTime;
    const speedFactor = Math.max(0, Math.min(3.5, mach - 0.8));
    const turbineFreq = 105 + speedFactor * 48 + (boosting ? 46 : 0);
    const subFreq = 48 + speedFactor * 16 + (boosting ? 18 : 0);
    const windCutoff = 480 + speedFactor * 520 + (boosting ? 750 : 0);
    const windVol = 0.2 + Math.min(0.32, speedFactor * 0.09) + (boosting ? 0.16 : 0);

    this.turbineOsc.frequency.setTargetAtTime(turbineFreq, now, 0.06);
    this.subOsc.frequency.setTargetAtTime(subFreq, now, 0.06);
    this.windFilter.frequency.setTargetAtTime(windCutoff, now, 0.06);
    this.windGain.gain.setTargetAtTime(windVol, now, 0.06);
  }

  /** Dramatic rushing Doppler wind whoosh + crisp high-tech confirmation ping */
  public playNearMiss(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.6;
    filter.frequency.setValueAtTime(1900, now);
    filter.frequency.exponentialRampToValueAtTime(240, now + 0.36);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.68, now + 0.055);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.4);

    // Subtle crisp avionics reward chime
    const chime = this.ctx.createOscillator();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(880, now + 0.02);
    chime.frequency.exponentialRampToValueAtTime(1320, now + 0.14);

    const chimeGain = this.ctx.createGain();
    chimeGain.gain.setValueAtTime(0.001, now);
    chimeGain.gain.linearRampToValueAtTime(0.14, now + 0.03);
    chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    chime.connect(chimeGain);
    chimeGain.connect(this.masterGain);
    chime.start(now);
    chime.stop(now + 0.24);
  }

  /** Supersonic sonic boom shockwave thump + crisp air crack */
  public playShockwave(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;

    // Sub-bass pressure wave drop
    const boom = this.ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(145, now);
    boom.frequency.exponentialRampToValueAtTime(34, now + 0.45);

    const boomGain = this.ctx.createGain();
    boomGain.gain.setValueAtTime(0.001, now);
    boomGain.gain.linearRampToValueAtTime(0.75, now + 0.018);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    boom.connect(boomGain);
    boomGain.connect(this.masterGain);
    boom.start(now);
    boom.stop(now + 0.52);

    // Sharp supersonic crack burst
    const crack = this.ctx.createBufferSource();
    crack.buffer = this.noiseBuffer;

    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(950, now);

    const crackGain = this.ctx.createGain();
    crackGain.gain.setValueAtTime(0.42, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    crack.connect(hp);
    hp.connect(crackGain);
    crackGain.connect(this.masterGain);
    crack.start(now);
    crack.stop(now + 0.18);
  }

  /** Afterburner ignition punch */
  public playBoostIgnite(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(210, now + 0.18);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.24, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /** Heavy Martian rock impact explosion */
  public playCrash(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, now);
    lp.frequency.exponentialRampToValueAtTime(110, now + 0.72);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.85, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.78);

    src.connect(lp);
    lp.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.8);

    const impactOsc = this.ctx.createOscillator();
    impactOsc.type = 'sawtooth';
    impactOsc.frequency.setValueAtTime(98, now);
    impactOsc.frequency.exponentialRampToValueAtTime(26, now + 0.42);
    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.55, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    impactOsc.connect(oscGain);
    oscGain.connect(this.masterGain);
    impactOsc.start(now);
    impactOsc.stop(now + 0.48);
  }

  public dispose(): void {
    this.setEngineActive(false);
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
