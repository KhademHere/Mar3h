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
  getSpeedGatesForChunk,
  getTerrainHeight,
  getZoneInfoAtZ,
  isBreatherChunk,
} from './terrainMath';
import {
  BOOST_OVERHEAT_RECOVERY_THRESHOLD,
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

test('all Glowing Speed Gates across all 4 Martian zones are safely inside canyon walls and clear of solid obstacles', () => {
  let totalGates = 0;
  let flowCount = 0;
  let bonusCount = 0;

  for (let c = 0; c < CHUNKS_PER_ZONE * 4; c++) {
    const gates = getSpeedGatesForChunk(c);
    const obstacles = getObstaclesForChunk(c);
    for (const gate of gates) {
      totalGates++;
      if (gate.tier === 'flow') flowCount++;
      else bonusCount++;

      const cx = getCanyonCenterX(gate.z);
      const hw = getCanyonHalfWidth(gate.z);
      const wallOffset = Math.abs(gate.x - cx);
      assert.ok(
        wallOffset <= hw - gate.radius - 2,
        `Gate ${gate.id} too close to canyon wall: offset=${wallOffset.toFixed(1)}, hw=${hw.toFixed(1)}`,
      );

      const groundY = getTerrainHeight(gate.x, gate.z);
      assert.ok(
        gate.y >= groundY + 8,
        `Gate ${gate.id} too close to Martian terrain: y=${gate.y.toFixed(1)}, ground=${groundY.toFixed(1)}`,
      );
      assert.ok(gate.y <= MAX_ALTITUDE - 12, `Gate ${gate.id} above comfortable flight ceiling`);
      assert.ok(
        Math.abs(gate.yaw) < 0.55,
        `Gate ${gate.id} must face the approaching flight path, got yaw=${gate.yaw.toFixed(2)} rad`,
      );

      for (const obs of obstacles) {
        if (obs.kind === 'dust-devil') continue;
        const clearance = evaluateObstacleClearance(gate.x, gate.y, gate.z, obs, 1.15);
        assert.ok(
          clearance > 4.0,
          `Gate ${gate.id} conflicts with obstacle ${obs.id} (${obs.kind}): clearance=${clearance.toFixed(1)}`,
        );
      }
    }
  }

  assert.ok(totalGates >= 36, `Expected rich distribution of Speed Gates across 4 zones, got ${totalGates}`);
  assert.ok(flowCount >= 10 && bonusCount >= 10, `Expected both flow (${flowCount}) and bonus (${bonusCount}) gates`);
});

test('passing Speed Gates stacks x2->x3 multiplier, surges Mach, refills Boost Bar, and missing resets gently to x1', () => {
  let state = createInitialFlightState();
  state.x = 0;
  state.y = 22;
  state.z = -50;
  state.boostCharge = 0.35;

  const testGates = [
    { id: 'gate-1', x: 0, y: 22, z: -53, radius: 13, tier: 'flow' as const, yaw: 0 },
    { id: 'gate-2', x: 0, y: 22, z: -60, radius: 13, tier: 'bonus' as const, yaw: 0 },
    { id: 'gate-3-miss', x: 42, y: 22, z: -68, radius: 13, tier: 'bonus' as const, yaw: 0 },
  ];

  const machBefore = state.mach;
  let hit1 = false;
  let hit2 = false;
  let missed3 = false;
  let maxMult = 1;
  let boostAfterHit1 = 0;

  for (let i = 0; i < 45; i++) {
    const res = stepFlightSimulation(state, { steerX: 0, steerY: 0, boost: false }, 1 / 60, {
      obstaclesOverride: [],
      gatesOverride: testGates,
    });
    state = res.state;
    if (res.events.gatePassed?.gateId === 'gate-1') {
      hit1 = true;
      boostAfterHit1 = state.boostCharge;
      assert.equal(res.events.gatePassed.multiplier, 2, 'First gate should set multiplier to x2');
    }
    if (res.events.gatePassed?.gateId === 'gate-2') {
      hit2 = true;
      assert.equal(res.events.gatePassed.multiplier, 3, 'Second consecutive gate should stack to x3');
    }
    if (res.events.gatePassed) {
      maxMult = Math.max(maxMult, res.events.gatePassed.multiplier);
    }
    if (res.events.gateMissed) {
      missed3 = true;
    }
  }

  assert.equal(hit1, true, 'Should cleanly pass through first Speed Gate');
  assert.equal(hit2, true, 'Should cleanly pass through second Speed Gate');
  assert.equal(maxMult, 3, 'Streak multiplier should stack to x3');
  assert.ok(boostAfterHit1 >= 0.62, `Passing gate should refill Boost Bar significantly, got ${boostAfterHit1.toFixed(2)}`);
  assert.ok(state.peakMach > machBefore + 0.5, 'Consecutive Speed Gates should grant strong Mach surge');
  assert.equal(missed3, true, 'Passing far off-center from gate 3 should register a miss');
  assert.equal(state.gateStreak, 0, 'Missing a Speed Gate should gently reset streak back to x1 (streak 0)');
  assert.equal(state.gatesPassed, 2);
});

test('draining Boost Bar triggers overheat lockout and blocks re-ignition until recharged past 25%', () => {
  let state = createInitialFlightState();
  state.boostCharge = 0.08;

  let sawOverheat = false;
  for (let i = 0; i < 40; i++) {
    const res = stepFlightSimulation(state, { steerX: 0, steerY: 0, boost: true }, 1 / 60, {
      obstaclesOverride: [],
      gatesOverride: [],
    });
    state = res.state;
    if (res.events.boostOverheated) {
      sawOverheat = true;
      break;
    }
  }

  assert.equal(sawOverheat, true, 'Draining Boost Bar to empty must trigger overheat event');
  assert.equal(state.boostLockout, true, 'Overheat must activate boost lockout');
  assert.equal(state.isBoosting, false, 'Overheat must immediately cut afterburners');

  // Trying to hold boost during cooldown & below 25% must stay locked out
  for (let i = 0; i < 60; i++) {
    const res = stepFlightSimulation(state, { steerX: 0, steerY: 0, boost: true }, 1 / 60, {
      obstaclesOverride: [],
      gatesOverride: [],
    });
    state = res.state;
    assert.equal(state.isBoosting, false, 'Afterburners must stay locked out during overheat cooldown');
  }

  // Let it finish cooling and recharge past BOOST_OVERHEAT_RECOVERY_THRESHOLD (25%)
  let recovered = false;
  for (let i = 0; i < 240; i++) {
    const res = stepFlightSimulation(state, { steerX: 0, steerY: 0, boost: true }, 1 / 60, {
      obstaclesOverride: [],
      gatesOverride: [],
    });
    state = res.state;
    if (state.isBoosting) {
      assert.ok(
        state.boostCharge >= BOOST_OVERHEAT_RECOVERY_THRESHOLD - 0.02,
        `Re-ignition should only happen after recharging past 25%, got ${state.boostCharge.toFixed(2)}`,
      );
      recovered = true;
      break;
    }
  }

  assert.equal(recovered, true, 'Boost should re-ignite cleanly once cooldown ends and charge recovers past 25%');
});

test('Smart Autoplay navigates all 4 zones, uses strategic boost bursts without overheating, and hunts Speed Gates', () => {
  let state = createInitialFlightState();
  let maxRoll = 0;
  const visitedZones = new Set<MartianZoneId>([state.currentZoneId]);
  let zoneTransitions = 0;
  let boostBursts = 0;
  let boostFrames = 0;
  let overheatCount = 0;
  let maxMultiplier = 1;

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
    if (res.events.boostStarted) boostBursts++;
    if (state.isBoosting) boostFrames++;
    if (res.events.boostOverheated) overheatCount++;
    if (res.events.gatePassed) {
      maxMultiplier = Math.max(maxMultiplier, res.events.gatePassed.multiplier);
    }
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
  assert.ok(state.peakMach >= 2.4, `Autoplay should reach high Mach with strategic boosts & gates, got peakMach=${state.peakMach.toFixed(2)}`);
  assert.ok(maxRoll > 0.14, 'Autoplay should bank naturally into turns');
  assert.ok(boostBursts >= 5, `Autoplay should fire deliberate strategic boost bursts, got ${boostBursts}`);
  assert.ok(
    boostFrames > 400 && boostFrames < 7800,
    `Autoplay should burst strategically rather than never or nonstop, got ${boostFrames}/8400 frames`,
  );
  assert.equal(overheatCount, 0, `Smart Autoplay should manage Boost Bar cleanly without overheating, got ${overheatCount}`);
  assert.ok(state.gatesPassed >= 16, `Autoplay should actively hunt Speed Gates safely, passed ${state.gatesPassed}`);
  assert.ok(maxMultiplier >= 3, `Autoplay should chain consecutive Speed Gates for x3+ multiplier, got x${maxMultiplier}`);
});

test('3-tier difficulty scales obstacle density, breathers, Mach speed, score multiplier, and keeps all Speed Gates safe', () => {
  const counts = { easy: 0, medium: 0, hard: 0 };
  const breathers = { easy: 0, medium: 0, hard: 0 };

  for (const diff of ['easy', 'medium', 'hard'] as const) {
    for (let c = 0; c < CHUNKS_PER_ZONE * 2; c++) {
      if (isBreatherChunk(c, diff)) breathers[diff]++;
      const obs = getObstaclesForChunk(c, diff);
      counts[diff] += obs.length;

      const gates = getSpeedGatesForChunk(c, diff);
      for (const gate of gates) {
        const cx = getCanyonCenterX(gate.z, diff);
        const hw = getCanyonHalfWidth(gate.z, diff);
        assert.ok(
          Math.abs(gate.x - cx) <= hw - gate.radius - 1.5,
          `${diff} gate ${gate.id} too close to canyon wall`,
        );
        const groundY = getTerrainHeight(gate.x, gate.z, diff);
        assert.ok(gate.y >= groundY + 7.5, `${diff} gate ${gate.id} too close to terrain`);
        for (const o of obs) {
          if (o.kind === 'dust-devil') continue;
          const clr = evaluateObstacleClearance(gate.x, gate.y, gate.z, o, 1.15);
          assert.ok(
            clr > 3.5,
            `${diff} gate ${gate.id} overlaps obstacle ${o.id} (${o.kind}): clr=${clr.toFixed(1)}`,
          );
        }
      }
    }
  }

  assert.ok(
    counts.medium > counts.easy * 1.45,
    `Medium should pack noticeably more hazards than Easy (${counts.medium} vs ${counts.easy})`,
  );
  assert.ok(
    counts.hard > counts.medium * 1.3,
    `Hard should be a dense gauntlet far exceeding Medium (${counts.hard} vs ${counts.medium})`,
  );
  assert.ok(breathers.easy > breathers.medium, `Easy breathers (${breathers.easy}) should exceed Medium (${breathers.medium})`);
  assert.equal(breathers.hard, 0, 'Hard mode should have relentless obstacles with 0 empty breathers');

  // Verify Mach start & score multiplier progression across tiers
  let easyState = createInitialFlightState('easy');
  let medState = createInitialFlightState('medium');
  let hardState = createInitialFlightState('hard');
  assert.ok(hardState.mach > medState.mach && medState.mach > easyState.mach);

  for (let i = 0; i < 120; i++) {
    easyState = stepFlightSimulation(easyState, { steerX: 0, steerY: 0, boost: false }, 1 / 60, {
      obstaclesOverride: [],
      gatesOverride: [],
    }).state;
    medState = stepFlightSimulation(medState, { steerX: 0, steerY: 0, boost: false }, 1 / 60, {
      obstaclesOverride: [],
      gatesOverride: [],
    }).state;
    hardState = stepFlightSimulation(hardState, { steerX: 0, steerY: 0, boost: false }, 1 / 60, {
      obstaclesOverride: [],
      gatesOverride: [],
    }).state;
  }
  assert.ok(hardState.score > medState.score && medState.score > easyState.score);
  assert.ok(hardState.mach > medState.mach && medState.mach > easyState.mach);
});

test('Elite Autoplay cleanly survives 60s Medium and 90s relentless Hard gauntlets with 0 crashes and strategic boost', () => {
  // Medium 60s verification
  let med = createInitialFlightState('medium');
  let medOverheats = 0;
  for (let i = 0; i < 3600; i++) {
    const res = stepFlightSimulation(med, { steerX: 0, steerY: 0, boost: false }, 1 / 60, {
      gameplayAutoplay: true,
    });
    med = res.state;
    if (res.events.boostOverheated) medOverheats++;
    assert.equal(med.crashed, false, `Medium Autoplay crashed at frame ${i} (z=${med.z.toFixed(1)})`);
  }
  assert.equal(medOverheats, 0, 'Medium Autoplay must not overheat');
  assert.ok(med.peakMach >= 2.7, `Medium Autoplay should reach high Mach, got ${med.peakMach.toFixed(2)}`);

  // Hard 90s relentless multi-zone gauntlet verification (5400 frames)
  let hard = createInitialFlightState('hard');
  let hardOverheats = 0;
  let hardBoostBursts = 0;
  let maxHardRoll = 0;
  const hardZones = new Set<MartianZoneId>([hard.currentZoneId]);

  for (let i = 0; i < 5400; i++) {
    const res = stepFlightSimulation(hard, { steerX: 0, steerY: 0, boost: false }, 1 / 60, {
      gameplayAutoplay: true,
    });
    hard = res.state;
    if (res.events.boostOverheated) hardOverheats++;
    if (res.events.boostStarted) hardBoostBursts++;
    if (Math.abs(hard.roll) > maxHardRoll) maxHardRoll = Math.abs(hard.roll);
    if (res.events.zoneChanged) hardZones.add(res.events.zoneChanged.id);
    assert.equal(
      hard.crashed,
      false,
      `Hard Autoplay crashed at frame ${i} (zone=${hard.currentZoneId}, z=${hard.z.toFixed(1)}, x=${hard.x.toFixed(1)}, y=${hard.y.toFixed(1)})`,
    );
  }

  assert.equal(hardOverheats, 0, 'Elite Hard Autoplay must never overheat');
  assert.ok(hard.peakMach >= 3.0, `Hard Autoplay should push extreme Mach >= 3.0, got ${hard.peakMach.toFixed(2)}`);
  assert.ok(hardBoostBursts >= 2, `Hard Autoplay should fire strategic boost bursts in clean openings, got ${hardBoostBursts}`);
  assert.ok(maxHardRoll > 0.2, 'Hard Autoplay should bank decisively through tight gauntlets');
  assert.ok(hardZones.size >= 3, `Hard Autoplay should blast through multiple Martian zones, visited ${[...hardZones].join(', ')}`);
});

