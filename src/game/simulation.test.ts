import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_LENGTH,
  getCanyonCenterX,
  getCanyonHalfWidth,
  getObstaclesForChunk,
  getTerrainHeight,
} from './terrainMath';
import {
  createInitialFlightState,
  evaluateObstacleClearance,
  stepFlightSimulation,
} from './simulation';
import type { CanyonObstacle } from './types';

test('opening canyon launch path is wide and craft survives 4 seconds with zero input', () => {
  let state = createInitialFlightState();
  const neutralInput = { steerX: 0, steerY: 0, boost: false };

  for (let i = 0; i < 240; i++) {
    const res = stepFlightSimulation(state, neutralInput, 1 / 60);
    state = res.state;
    assert.equal(state.crashed, false, `Craft unexpectedly crashed at frame ${i} (z=${state.z.toFixed(1)})`);
  }

  assert.ok(state.distance > 500, 'Craft should travel over 500m in 4 seconds at exciting supersonic speed');
  assert.ok(state.mach > 1.25, 'Craft should gradually accelerate above starting Mach');
});

test('canyon flying ramp is noticeably wide with towering cliffs on both flanks', () => {
  const z = -600;
  const cx = getCanyonCenterX(z);
  const hw = getCanyonHalfWidth(z);

  assert.ok(hw >= 54, `Expected wide canyon half-width >= 54m, got ${hw}`);

  const floorHeight = getTerrainHeight(cx, z);
  const leftCliffHeight = getTerrainHeight(cx - hw * 1.85, z);
  const rightCliffHeight = getTerrainHeight(cx + hw * 1.85, z);

  assert.ok(floorHeight < 10, `Valley floor should be low, got ${floorHeight}`);
  assert.ok(leftCliffHeight > 45, `Left canyon cliff should tower high, got ${leftCliffHeight}`);
  assert.ok(rightCliffHeight > 45, `Right canyon cliff should tower high, got ${rightCliffHeight}`);
});

test('holding afterburner surges Mach speed, consumes charge, and recharges when released', () => {
  let state = createInitialFlightState();
  const initialMach = state.mach;

  let sawBoostStart = false;
  for (let i = 0; i < 60; i++) {
    const res = stepFlightSimulation(state, { steerX: 0, steerY: 0, boost: true }, 1 / 60);
    if (res.events.boostStarted) sawBoostStart = true;
    state = res.state;
  }

  assert.equal(sawBoostStart, true);
  assert.ok(state.mach > initialMach + 0.55, `Expected afterburner Mach surge, got ${state.mach}`);
  assert.ok(state.boostCharge < 0.78, `Expected boost charge to drain, got ${state.boostCharge}`);

  const drainedCharge = state.boostCharge;
  for (let i = 0; i < 60; i++) {
    const res = stepFlightSimulation(state, { steerX: 0, steerY: 0, boost: false }, 1 / 60);
    state = res.state;
  }
  assert.ok(state.boostCharge > drainedCharge + 0.08, 'Boost charge should recover when released');
});

test('breaking a 0.5 Mach milestone triggers a supersonic shockwave event', () => {
  let state = createInitialFlightState();
  let milestoneHit: number | null = null;

  for (let i = 0; i < 90; i++) {
    const res = stepFlightSimulation(state, { steerX: 0, steerY: 0, boost: true }, 1 / 60);
    state = res.state;
    if (res.events.milestoneMach !== null) {
      milestoneHit = res.events.milestoneMach;
      break;
    }
  }

  assert.equal(milestoneHit, 1.5, 'Crossing Mach 1.5 should trigger shockwave milestone');
});

test('slight brush near a rock triggers a forgiving warning scrape instead of instant crash', () => {
  let state = createInitialFlightState();
  state.x = 0;
  state.y = 20;
  state.z = -100;

  // Spire flank sits right in the outer brush zone (solidClearance ~ +0.5m)
  const brushSpire: CanyonObstacle = {
    id: 'brush-spire',
    kind: 'spire',
    x: 7.75,
    y: 0,
    z: -102,
    radius: 8,
    height: 60,
    thickness: 8,
    yaw: 0,
    tint: 0.5,
  };

  const res = stepFlightSimulation(state, { steerX: 0, steerY: 0, boost: false }, 1 / 60, {
    obstaclesOverride: [brushSpire],
  });

  assert.equal(res.state.crashed, false, 'Slight brush should deflect safely instead of instant crash');
  assert.ok(res.events.scrape !== null, 'Slight brush should emit a warning scrape event');
});

test('skimming close to a spire triggers Near Miss bonus and speed burst without crashing', () => {
  let state = createInitialFlightState();
  state.x = 0;
  state.y = 20;
  state.z = -100;

  const testSpire: CanyonObstacle = {
    id: 'test-spire',
    kind: 'spire',
    x: 11.5,
    y: 0,
    z: -102,
    radius: 8,
    height: 60,
    thickness: 8,
    yaw: 0,
    tint: 0.5,
  };

  const clearance = evaluateObstacleClearance(state.x, state.y, state.z, testSpire, 1.15);
  assert.ok(clearance > 1.2 && clearance < 7.8, `Expected near-miss clearance, got ${clearance}`);

  const machBefore = state.mach;
  const res = stepFlightSimulation(state, { steerX: 0, steerY: 0, boost: false }, 1 / 60, {
    obstaclesOverride: [testSpire],
  });

  assert.equal(res.state.crashed, false);
  assert.ok(res.events.nearMiss !== null, 'Should emit near-miss event');
  assert.equal(res.state.nearMissCount, 1);
  assert.ok(res.state.mach > machBefore + 0.1, 'Near miss should award a burst of extra Mach speed');
});

test('direct solid impact into canyon cliff or rock triggers crash', () => {
  let state = createInitialFlightState();

  // Fly hard right and down directly into the canyon cliff wall
  for (let i = 0; i < 360; i++) {
    const res = stepFlightSimulation(state, { steerX: 1, steerY: -0.5, boost: false }, 1 / 60);
    state = res.state;
    if (state.crashed) break;
  }

  assert.equal(state.crashed, true, 'Direct solid impact into Martian cliff must trigger crash');
  assert.ok(state.crashReason === 'terrain' || state.crashReason === 'obstacle');
});

test('Autoplay mode smoothly flies 20 seconds through canyons and arches, building high Mach without crashing', () => {
  let state = createInitialFlightState();
  let maxRoll = 0;

  // 20 seconds at 60Hz = 1200 frames across multiple curved chunks, arches, and spires
  for (let i = 0; i < 1200; i++) {
    const res = stepFlightSimulation(
      state,
      { steerX: 0, steerY: 0, boost: false },
      1 / 60,
      { gameplayAutoplay: true },
    );
    state = res.state;
    if (Math.abs(state.roll) > maxRoll) maxRoll = Math.abs(state.roll);
    assert.equal(state.crashed, false, `Autoplay crashed at frame ${i} (z=${state.z.toFixed(1)})`);
  }

  assert.ok(state.peakMach >= 1.9, `Autoplay should build high Mach speeds, got peakMach=${state.peakMach.toFixed(2)}`);
  assert.ok(state.distance > 3000, `Autoplay should cover >3km in 20s, got ${state.distance.toFixed(0)}m`);
  assert.ok(maxRoll > 0.12, 'Autoplay should bank naturally into turns');
});

test('opening chunk frames a wide grand rock arch that craft safely flies under', () => {
  const chunk0 = getObstaclesForChunk(0);
  const arch = chunk0.find((o) => o.kind === 'arch');
  assert.ok(arch, 'Chunk 0 should include an iconic opening rock arch');

  const clearance = evaluateObstacleClearance(arch.x, 20, arch.z, arch, 1.15);
  assert.ok(clearance > 18, `Craft at cruising altitude should pass cleanly beneath wide arch, got clearance ${clearance}`);
  assert.ok(CHUNK_LENGTH >= 300);
});
