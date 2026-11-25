import { RoomCalculatorService } from '../services/roomCalculator.service';

async function runTests() {
  console.log('--- Room Calculator Test Suite ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${msg}`);
      failed++;
    }
  }

  const mockIo = {
    to: (channel: string) => ({
      emit: (event: string, payload: any) => {
        // mock emit
      },
    }),
  };

  // Test 1: Validation - empty theme
  try {
    await RoomCalculatorService.startCalculator('1000000002', { id: 'u1' }, '', 10, mockIo);
    assert(false, 'Should throw error for empty theme');
  } catch (err: any) {
    assert(err.message.includes('Activity theme'), 'Rejects empty activity theme');
  }

  // Test 2: Validation - theme longer than 30 chars
  try {
    await RoomCalculatorService.startCalculator('1000000002', { id: 'u1' }, 'a'.repeat(31), 10, mockIo);
    assert(false, 'Should throw error for theme > 30 chars');
  } catch (err: any) {
    assert(err.message.includes('Activity theme'), 'Rejects theme > 30 characters');
  }

  // Test 3: Record Gift calculations
  const mockState: any = {
    roomId: '1000000002',
    canonicalRoomId: '1000000002',
    theme: 'Best Singer',
    durationMins: 10,
    startedAt: Date.now(),
    endsAt: Date.now() + 600000,
    status: 'active',
    startedBy: { userId: 'u1', name: 'Host' },
    totalScore: 0,
    totalPeople: 0,
    topSupporter: null,
    topCharming: null,
    supporterMap: {},
    charmingMap: {},
  };

  (RoomCalculatorService as any)['activeCalculators'] = new Map();
  // Register in active map
  const activeMap: Map<string, any> = (RoomCalculatorService as any)['activeCalculators'] || new Map();
  // Let's test recordGift directly
  await RoomCalculatorService.recordGift(
    '1000000002',
    { userId: 'sup1', name: 'Alice', avatar: 'alice.png' },
    [{ userId: 'charm1', name: 'Bob', avatar: 'bob.png' }],
    500,
    mockIo
  );

  console.log(`Tests completed. Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test error:', e);
  process.exit(1);
});
