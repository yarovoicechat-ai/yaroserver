import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RoomContributionService } from '../services/roomContribution.service';
import { GiftTransaction } from '../gift/gift.model';
import { User } from '../models/user.model';

test('all contribution periods read successful room gifts even without counters', async () => {
  const originalAggregate = GiftTransaction.aggregate;
  const originalFind = User.find;
  const sender = '507f1f77bcf86cd799439011';
  try {
    (User as any).find = () => ({ select: () => ({ lean: async () => [
      { _id: sender, userId: 123, name: 'Sender' },
    ] }) });
    for (const period of ['daily', 'weekly', 'monthly'] as const) {
      let pipeline: any[] = [];
      (GiftTransaction as any).aggregate = async (stages: any[]) => {
        pipeline = stages;
        return [{ _id: sender, totalDiamonds: 500 }];
      };
      const result = await RoomContributionService.getRoomContributors('room-a', sender, period);
      assert.equal(result.myContribution, 500);
      assert.equal(result.myRank, 1);
      assert.deepEqual(pipeline[0].$match.status, { $in: ['SUCCESS', 'COMPLETED'] });
      assert.deepEqual(pipeline[0].$match.roomId, { $in: ['room-a'] });
      const range = pipeline[0].$match.createdAt;
      assert.ok(range.$gte < range.$lt);
      assert.equal(range.$gte.toISOString().slice(11), '18:30:00.000Z');
      assert.equal(range.$lt.toISOString().slice(11), '18:30:00.000Z');
    }
    (GiftTransaction as any).aggregate = async () => [];
    const empty = await RoomContributionService.getRoomContributors('room-empty', sender);
    assert.deepEqual(empty.contributors, []);
    assert.equal(empty.myContribution, 0);
    assert.equal(empty.myRank, '99+');
  } finally {
    GiftTransaction.aggregate = originalAggregate;
    User.find = originalFind;
  }
});
