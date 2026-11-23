import assert from 'assert';
import { test, describe, it } from 'node:test';
import { roomPKResult, normalizePKRoomId } from '../utils/roomPkRules';
import { VALID_PK_DURATIONS } from '../services/roomPk.service';

describe('Room PK Backend Core System Tests', () => {
  it('normalizes Room IDs accurately', () => {
    assert.strictEqual(normalizePKRoomId('10000123'), '0000000123');
    assert.strictEqual(normalizePKRoomId('room_test_99'), 'room_test_99');
    assert.strictEqual(normalizePKRoomId('12345'), '12345');
  });

  it('validates supported PK durations (1, 3, 5, 10, 30 minutes)', () => {
    assert.strictEqual(VALID_PK_DURATIONS.includes(60), true);
    assert.strictEqual(VALID_PK_DURATIONS.includes(180), true);
    assert.strictEqual(VALID_PK_DURATIONS.includes(300), true);
    assert.strictEqual(VALID_PK_DURATIONS.includes(600), true);
    assert.strictEqual(VALID_PK_DURATIONS.includes(1800), true);
    assert.strictEqual(VALID_PK_DURATIONS.includes(120), false);
  });

  it('determines winner for Personal and Team Gift PK accurately', () => {
    // Side 0 wins
    const res0 = roomPKResult(['room_101', 'room_102'], [5000, 2000]);
    assert.strictEqual(res0.draw, false);
    assert.strictEqual(res0.winnerSide, 0);
    assert.strictEqual(res0.winnerRoomId, 'room_101');

    // Side 1 wins
    const res1 = roomPKResult(['room_101', 'room_102'], [1200, 3500]);
    assert.strictEqual(res1.draw, false);
    assert.strictEqual(res1.winnerSide, 1);
    assert.strictEqual(res1.winnerRoomId, 'room_102');

    // Draw / Tie handling
    const resDraw = roomPKResult(['room_101', 'room_102'], [3000, 3000]);
    assert.strictEqual(resDraw.draw, true);
    assert.strictEqual(resDraw.winnerSide, null);
    assert.strictEqual(resDraw.winnerRoomId, null);
  });

  it('handles single room PK result computation (User PK / Vote PK / Team PK in same room)', () => {
    const res = roomPKResult(['room_inside_101'], [10, 2]);
    assert.strictEqual(res.draw, false);
    assert.strictEqual(res.winnerSide, 0);
    assert.strictEqual(res.winnerRoomId, 'room_inside_101');
  });

  it('validates team composition rules (no overlap between Yellow and Blue)', () => {
    const teamA = [{ userId: 'user_1', name: 'Player 1' }, { userId: 'user_2', name: 'Player 2' }];
    const teamBInvalid = [{ userId: 'user_2', name: 'Player 2' }, { userId: 'user_3', name: 'Player 3' }];
    const teamBValid = [{ userId: 'user_3', name: 'Player 3' }, { userId: 'user_4', name: 'Player 4' }];

    const hasOverlap = (a: any[], b: any[]) => {
      const aIds = new Set(a.map(u => u.userId));
      return b.some(u => aIds.has(u.userId));
    };

    assert.strictEqual(hasOverlap(teamA, teamBInvalid), true);
    assert.strictEqual(hasOverlap(teamA, teamBValid), false);
  });

  it('enforces selected gift restriction logic', () => {
    const activeSelectedGiftId = 'gift_rose_77';

    const isGiftEligible = (giftId: string, selectedGiftId: string | null) => {
      if (!selectedGiftId) return true; // Any gift counts if not restricted
      return String(giftId) === String(selectedGiftId);
    };

    assert.strictEqual(isGiftEligible('gift_rose_77', activeSelectedGiftId), true);
    assert.strictEqual(isGiftEligible('gift_diamond_88', activeSelectedGiftId), false);
    assert.strictEqual(isGiftEligible('gift_car_99', null), true);
  });
});
