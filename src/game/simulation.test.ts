import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_LENGTH,
  CHUNKS_PER_ZONE,
  ZONE_LENGTH,
  getCanyonCenterX,
  getCanyonHalfWidth,
  getDustDevilX,
  getObstaclesForChunk,
  getTerrainHeight,
  getZoneInfoAtZ,
  isBreatherChunk,
} from './terrainMath';
import {
  MAX_ALTITUDE,
  createInitialFlightState,
  evaluateObstacleClearance,
  stepFlightSimulation,
} from './simulation';
import type { CanyonObstacle, MartianZoneId } from './types';

test('opening canyon launch path is wide and craft survives 4 seconds with zero input', () => {
  let state = createInitialFlightState();
  const neutralInput = { steerX: 0, steerY: 0, boost: false };

  for (let i = 0; i < 240; i++) {
    const res = stepFlightSimulation(state, neutralInput, 1 / 60);
    state = res.state;
    assert.equal(
      state.crashed,
      false,
      `Craft unexpectedly crashed at frame ${i} (z=${state.z.toFixed(1)}, y=${state.y.toFixed(1)})`,
    );
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
  assert.ok(leftCliffHeight > 35, `Left canyon cliff should rise high, got ${leftCliffHeight}`);
  assert.ok(rightCliffHeight > 35, `Right canyon cliff should rise high, got ${rightCliffHeight}`);
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

  for (let i = 0; i < 360; i++) {
    const res = stepFlightSimulation(state, { steerX: 1, steerY: -0.5, boost: false }, 1 / 60);
    state = res.state;
    if (state.crashed) break;
  }

  assert.equal(state.crashed, true, 'Direct solid impact into Martian cliff must trigger crash');
  assert.ok(state.crashReason === 'terrain' || state.crashReason === 'obstacle');
});

test('giant stone arch allows flying cleanly both UNDER and OVER the crown', () => {
  const chunk0 = getObstaclesForChunk(0);
  const arch = chunk0.find((o) => o.kind === 'arch');
  assert.ok(arch, 'Chunk 0 should include an iconic opening rock arch');

  const underClearance = evaluateObstacleClearance(arch.x, 20, arch.z, arch, 1.15);
  const overClearance = evaluateObstacleClearance(arch.x, MAX_ALTITUDE - 8, arch.z, arch, 1.15);
  const crownHit = evaluateObstacleClearance(arch.x, arch.y + arch.height + 3, arch.z, arch, 1.15);

  assert.ok(underClearance > 15, `Should fly cleanly under arch, got ${underClearance}`);
  assert.ok(overClearance > 10, `Should soar cleanly OVER arch within MAX_ALTITUDE, got ${overClearance}`);
  assert.ok(crownHit < 0, `Arch rock crown itself should be solid, got ${crownHit}`);
  assert.ok(CHUNK_LENGTH >= 300);
});

test('varied obstacles enforce distinct steering moves (split tunnels, dive-low overhangs, climb-high ridges, moving dust devils)', () => {
  // Split canyon central pillar: solid center, open left and right tunnels
  const splitPillar: CanyonObstacle = {
    id: 'split-test',
    kind: 'split-pillar',
    x: 0,
    y: 0,
    z: -400,
    radius: 14,
    height: 82,
    thickness: 16,
    yaw: 0,
    tint: 0.5,
  };
  assert.ok(evaluateObstacleClearance(0, 22, -400, splitPillar, 1.15) < 0, 'Split pillar center must be solid');
  assert.ok(evaluateObstacleClearance(-30, 22, -400, splitPillar, 1.15) > 10, 'Left split tunnel must be wide open');
  assert.ok(evaluateObstacleClearance(30, 22, -400, splitPillar, 1.15) > 10, 'Right split tunnel must be wide open');

  // Overhanging red cliff ledge: solid up high, clear low underneath
  const overhang: CanyonObstacle = {
    id: 'overhang-test',
    kind: 'overhang',
    x: 0,
    y: 2,
    z: -500,
    radius: 52,
    height: 29,
    thickness: 22,
    yaw: 0,
    tint: 0.5,
    side: 1,
  };
  assert.ok(evaluateObstacleClearance(0, 14, -500, overhang, 1.15) > 12, 'Diving low under overhang must be open');
  assert.ok(evaluateObstacleClearance(0, 42, -500, overhang, 1.15) < 0, 'Flying high into overhang ledge must hit');

  // Low jagged ridge: solid down low, open high above
  const lowRidge: CanyonObstacle = {
    id: 'ridge-test',
    kind: 'low-ridge',
    x: 0,
    y: 1,
    z: -600,
    radius: 58,
    height: 20,
    thickness: 14,
    yaw: 0,
    tint: 0.5,
  };
  assert.ok(evaluateObstacleClearance(0, 10, -600, lowRidge, 1.15) < 0, 'Flying low into jagged ridge must hit');
  assert.ok(evaluateObstacleClearance(0, 34, -600, lowRidge, 1.15) > 10, 'Climbing high over ridge must be clear');

  // Drifting swirling red dust devil moves sideways over time
  const devil: CanyonObstacle = {
    id: 'devil-test',
    kind: 'dust-devil',
    x: 0,
    y: 0,
    z: -700,
    radius: 7.5,
    height: 68,
    thickness: 7.5,
    yaw: 0,
    tint: 0.7,
    driftAmp: 30,
    driftSpeed: 0.7,
    driftPhase: 0,
  };
  const xAt0 = getDustDevilX(devil, 0);
  const xAtPeak = getDustDevilX(devil, Math.PI / (2 * 0.7));
  assert.ok(Math.abs(xAtPeak - xAt0) > 25, 'Dust devil should drift sideways smoothly across the valley');
  assert.ok(evaluateObstacleClearance(xAtPeak, 20, -700, devil, 1.15, Math.PI / (2 * 0.7)) < 0);
  assert.ok(evaluateObstacleClearance(xAtPeak - 25, 20, -700, devil, 1.15, Math.PI / (2 * 0.7)) > 10);
});

test('distinct 4 Martian zones cycle smoothly with periodic open-sky breather stretches and varied landmarks', () => {
  const seenZones = new Set<MartianZoneId>();
  const seenKinds = new Set<string>();
  let breatherCount = 0;

  for (let c = 0; c < CHUNKS_PER_ZONE * 4; c++) {
    const zMid = -(c * CHUNK_LENGTH + CHUNK_LENGTH * 0.5);
    seenZones.add(getZoneInfoAtZ(zMid).id);
    if (isBreatherChunk(c)) {
      breatherCount++;
      assert.equal(getObstaclesForChunk(c).length, 0, `Breather chunk ${c} should have clear open sky`);
    }
    for (const obs of getObstaclesForChunk(c)) {
      seenKinds.add(obs.kind);
    }
  }

  assert.equal(seenZones.size, 4, 'All 4 distinct Martian zones must appear across a full cycle');
  assert.ok(breatherCount >= 12, `Expected regular open-sky breather stretches, got ${breatherCount}`);
  for (const requiredKind of [
    'arch',
    'split-pillar',
    'overhang',
    'low-ridge',
    'comm-tower',
    'broken-bridge',
    'solar-array',
    'dust-devil',
  ]) {
    assert.ok(seenKinds.has(requiredKind), `Expected obstacle kind "${requiredKind}" to spawn across zones`);
  }
  assert.ok(ZONE_LENGTH >= 5500 && ZONE_LENGTH <= 7500, 'Each zone should span ~30-40s of supersonic flight');
});

test('Autoplay cleanly navigates all 4 Martian zones and every new obstacle type for 140s without crashing', () => {
  let state = createInitialFlightState();
  let maxRoll = 0;
  const visitedZones = new Set<MartianZoneId>([state.currentZoneId]);
  let zoneTransitions = 0;

  // 140 seconds at 60Hz = 8400 frames spanning all 4 Martian zones (>24 km)
  for (let i = 0; i < 8400; i++) {
    const res = stepFlightSimulation(
      state,
      { steerX: 0, steerY: 0, boost: false },
      1 / 60,
      { gameplayAutoplay: true },
    );
    state = res.state;
    if (Math.abs(state.roll) > maxRoll) maxRoll = Math.abs(state.roll);
    if (res.events.zoneChanged) {
      zoneTransitions++;
      visitedZones.add(res.events.zoneChanged.id);
    }
    assert.equal(
      state.crashed,
      false,
      `Autoplay crashed at frame ${i} (zone=${state.currentZoneId}, z=${state.z.toFixed(1)})`,
    );
  }

  assert.equal(visitedZones.size, 4, `Autoplay should visit all 4 zones, visited: ${[...visitedZones].join(', ')}`);
  assert.ok(zoneTransitions >= 3, `Expected >= 3 zone transition events, got ${zoneTransitions}`);
  assert.ok(state.peakMach >= 2.2, `Autoplay should build high Mach speeds, got peakMach=${state.peakMach.toFixed(2)}`);
  assert.ok(maxRoll > 0.14, 'Autoplay should bank naturally into turns');
});
