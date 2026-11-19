const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const host = '507f1f77bcf86cd799439011';
const firstGuest = '507f1f77bcf86cd799439012';
const secondGuest = '507f1f77bcf86cd799439013';
const roomId = '507f1f77bcf86cd799439020';
let guests, contributors;
const writes = [];
const model = {
  async updateOne(filter, update) {
    writes.push({ filter, update });
    if (update.$push?.guests) {
      const maximum = filter.$expr?.$lt?.[1] ?? Infinity;
      const duplicate = filter['guests.user']?.$ne;
      if (guests.length >= maximum || (duplicate && guests.some(guest => String(guest.user) === String(duplicate)))) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
      guests.push(update.$push.guests);
      return { matchedCount: 1, modifiedCount: 1 };
    }
    if (update.$inc) {
      const row = contributors.find(item => String(item.user) === String(filter['topContributors.user']));
      if (!row) return { matchedCount: 0, modifiedCount: 0 };
      row.amount += update.$inc['topContributors.$.amount'];
      return { matchedCount: 1, modifiedCount: 1 };
    }
    const push = update.$push.topContributors;
    if (push.$each) {
      contributors.sort((left, right) => right.amount - left.amount);
      contributors = contributors.slice(0, push.$slice);
      return { matchedCount: 1, modifiedCount: 1 };
    }
    if (contributors.some(item => String(item.user) === String(filter['topContributors.user'].$ne))) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    contributors.push({ ...push });
    return { matchedCount: 1, modifiedCount: 1 };
  },
};
const original = Module._load;
Module._load = function (name, parent, isMain) {
  if (name.endsWith('/models/liveBroadcast.model')) return { __esModule: true, default: model };
  return original.call(this, name, parent, isMain);
};
const { reserveLiveGuest, incrementLiveSupporter } = require('../services/liveBroadcastState');
Module._load = original;

test.beforeEach(() => { guests = []; contributors = []; writes.length = 0; });

test('simultaneous approvals cannot consume the same final box or duplicate a guest', async () => {
  guests.push({ user: 'existing-1' }, { user: 'existing-2' });
  const results = await Promise.all([
    reserveLiveGuest(roomId, host, firstGuest, 20, 3),
    reserveLiveGuest(roomId, host, secondGuest, 21, 3),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(guests.length, 3);
  const winner = String(guests[2].user);
  assert.equal(await reserveLiveGuest(roomId, host, winner, 20, 4), false);
  assert.equal(guests.length, 3);
  for (const write of writes) {
    assert.equal(write.filter.host, host);
    assert.equal(write.filter.status, 'live');
    assert.ok(write.filter.$expr);
  }
});

test('concurrent first gifts accumulate in one supporter row and return the correct order', async () => {
  contributors.push({ user: host, amount: 30 });
  await Promise.all([
    incrementLiveSupporter(roomId, firstGuest, 20),
    incrementLiveSupporter(roomId, firstGuest, 20),
  ]);
  assert.equal(contributors.length, 2);
  assert.equal(String(contributors[0].user), firstGuest);
  assert.equal(contributors[0].amount, 40);
  assert.equal(contributors[1].amount, 30);
});
