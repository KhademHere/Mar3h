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

test('opening canyon launch path is clear and craft survives 4 seconds with zero input', () => {
  let state = createInitialFlightState();
  const neutralInput = { steerX: 0, steerY: 0, boost: false };

  // Simulate 4 full seconds at 60Hz (240 frames) without any player input
  for (let i = 0; i < 240; i++) {
    const res = stepFlightSimulation(state, neutralInput, 1 / 60);
    state = res.state;
    assert.equal(state.crashed, false, `Craft unexpectedly crashed at frame ${i} (z=${state.z.toFixed(1)})`);
  }

  assert.ok(state.distance > 450, 'Craft should travel over 450m in 4 seconds at supersonic speed');
  assert.ok(state.mach > 1.2, 'Craft should gradually accelerate above starting Mach');
});

test('canyon terrain creates lower valley floor and towering walls on both flanks', () => {
  const z = -600;
  const cx = getCanyonCenterX(z);
  const hw = getCanyonHalfWidth(z);

  const floorHeight = getTerrainHeight(cx, z);
  const leftCliffHeight = getTerrainHeight(cx - hw * 1.8, z);
  const rightCliffHeight = getTerrainHeight(cx + hw * 1.8, z);

  assert.ok(floorHeight < 10, `Valley floor should be low, got ${floorHeight}`);
  assert.ok(leftCliffHeight > 45, `Left canyon cliff should tower high, got ${leftCliffHeight}`);
  assert.ok(rightCliffHeight > 45, `Right canyon cliff should tower high, got ${rightCliffHeight}`);
});

test('holding afterburner surges Mach speed, consumes charge, and recharges when released', () => {
  let state = createInitialFlightState();
  const initialMach = state.mach;

  // Hold boost for 1 second
  let sawBoostStart = false;
  for (let i = 0; i < 60; i++) {
    const res = stepFlightSimulation(state, { steerX: 0, steerY: 0, boost: true }, 1 / 60);
    if (res.events.boostStarted) sawBoostStart = true;
    state = res.state;
  }

  assert.equal(sawBoostStart, true);
  assert.ok(state.mach > initialMach + 0.55, `Expected afterburner Mach surge, got ${state.mach}`);
  assert.ok(state.boostCharge < 0.75, `Expected boost charge to drain, got ${state.boostCharge}`);

  const drainedCharge = state.boostCharge;
  // Release boost for 1 second and verify recharge
  for (let i = 0; i < 60; i++) {
    const res = stepFlightSimulation(state, { steerX: 0, steerY: 0, boost: false }, 1 / 60);
    state = res.state;
  }
  assert.ok(state.boostCharge > drainedCharge + 0.08, 'Boost charge should recover when released');
});

test('breaking a 0.5 Mach milestone triggers a supersonic shockwave event', () => {
  let state = createInitialFlightState();
  let milestoneHit: number | null = null;

  // Hold boost to rapidly cross Mach 1.5
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

test('skimming close to a spire triggers Near Miss bonus and speed burst without crashing', () => {
  let state = createInitialFlightState();
  state.x = 0;
  state.y = 20;
  state.z = -100;

  const testSpire: CanyonObstacle = {
    id: 'test-spire',
    kind: 'spire',
    x: 11.5, // Base radius 8, at y=20 (~1/3 height) radius ~6.1 -> distance 11.5 - 6.1 - 1.65 = ~3.75m clearance (inside 6.2m near-miss band!)
    y: 0,
    z: -102,
    radius: 8,
    height: 60,
    thickness: 8,
    yaw: 0,
    tint: 0.5,
  };

  const clearance = evaluateObstacleClearance(state.x, state.y, state.z, testSpire, 1.65);
  assert.ok(clearance > 0 && clearance < 6.2, `Expected near-miss clearance, got ${clearance}`);

  const machBefore = state.mach;
  const res = stepFlightSimulation(state, { steerX: 0, steerY: 0, boost: false }, 1 / 60, {
    obstaclesOverride: [testSpire],
  });

  assert.equal(res.state.crashed, false);
  assert.ok(res.events.nearMiss !== null, 'Should emit near-miss event');
  assert.equal(res.state.nearMissCount, 1);
  assert.ok(res.state.mach > machBefore + 0.1, 'Near miss should award a burst of extra Mach speed');
});

test('steering directly into canyon wall or spire triggers crash', () => {
  let state = createInitialFlightState();

  // Fly hard right into canyon cliff wall
  for (let i = 0; i < 240; i++) {
    const res = stepFlightSimulation(state, { steerX: 1, steerY: -0.2, boost: false }, 1 / 60);
    state = res.state;
    if (state.crashed) break;
  }

  assert.equal(state.crashed, true, 'Hard steering into Martian canyon wall must trigger crash');
  assert.ok(state.crashReason === 'terrain' || state.crashReason === 'obstacle');
});

test('opening chunk frames a grand rock arch that craft safely flies under', () => {
  const chunk0 = getObstaclesForChunk(0);
  const arch = chunk0.find((o) => o.kind === 'arch');
  assert.ok(arch, 'Chunk 0 should include an iconic opening rock arch');

  // Craft at center x, y=18 passing directly under the arch should have huge clearance
  const clearance = evaluateObstacleClearance(arch.x, 18, arch.z, arch, 1.65);
  assert.ok(clearance > 10, `Craft at cruising altitude should pass cleanly beneath arch, got clearance ${clearance}`);
  assert.ok(CHUNK_LENGTH >= 200);
});
