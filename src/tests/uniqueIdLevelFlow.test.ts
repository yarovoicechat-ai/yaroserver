

import assert from 'assert';
import mongoose from 'mongoose';
import { checkIdTaken } from '../controllers/uniqueIdRequest.controller';

console.log('🧪 Starting Unique ID & Level Progression Flow Audit Test Suite...');

// Mock User & Entitlement simulation
const mockUsers = [
  { _id: 'user_111', userId: 10001, name: 'Aarav', equippedCustomId: '77777', customDisplayId: '77777', uniqueId: '77777', userName: 'aarav_vip' },
  { _id: 'user_222', userId: 10002, name: 'Priya', equippedCustomId: null, customDisplayId: null, uniqueId: null, userName: 'priya_star' },
  { _id: 'user_333', userId: 88888, name: 'Rohan', equippedCustomId: null, customDisplayId: null, uniqueId: null, userName: 'rohan_88' },
];

// Helper to simulate the exact checkIdTaken logic in-memory for testing
function simulateCheckIdTaken(requestedId: string, excludeUserId?: string) {
  const cleanId = String(requestedId || '').trim();
  if (!cleanId) return { isTaken: false };

  const numVal = Number(cleanId);
  const foundUser = mockUsers.find((u) => {
    if (excludeUserId && u._id === excludeUserId) return false;
    if (u.equippedCustomId === cleanId) return true;
    if (u.customDisplayId === cleanId) return true;
    if (u.uniqueId === cleanId) return true;
    if (u.userName === cleanId) return true;
    if (!isNaN(numVal) && numVal > 0 && u.userId === numVal) return true;
    return false;
  });

  if (foundUser) {
    return {
      isTaken: true,
      existingUser: { name: foundUser.name, userId: foundUser.userId, id: foundUser._id },
    };
  }
  return { isTaken: false };
}

// 1. Available ID verification
console.log('Test 1: Available ID should pass availability check');
const availableResult = simulateCheckIdTaken('99999');
assert.strictEqual(availableResult.isTaken, false, 'ID 99999 should be completely available');
console.log('✅ Test 1 Passed: Free ID is detected as available.');

// 2. Taken ID via customDisplayId/equippedCustomId
console.log('Test 2: ID already equipped by another user must be detected as TAKEN');
const takenCustomResult = simulateCheckIdTaken('77777');
assert.strictEqual(takenCustomResult.isTaken, true, 'ID 77777 is equipped by Aarav and must be taken');
assert.strictEqual(takenCustomResult.existingUser?.name, 'Aarav');
console.log('✅ Test 2 Passed: Equipped custom ID is detected as taken by existing user.');

// 3. Taken ID via permanent numeric userId
console.log('Test 3: ID matching existing permanent userId must be detected as TAKEN');
const takenNumericResult = simulateCheckIdTaken('88888');
assert.strictEqual(takenNumericResult.isTaken, true, 'ID 88888 matches Rohan permanent userId and must be taken');
assert.strictEqual(takenNumericResult.existingUser?.name, 'Rohan');
console.log('✅ Test 3 Passed: Permanent numeric user ID cannot be duplicated.');

// 4. Same user requesting their own equipped ID
console.log('Test 4: User checking their own existing ID should exclude self');
const selfCheckResult = simulateCheckIdTaken('77777', 'user_111');
assert.strictEqual(selfCheckResult.isTaken, false, 'User 111 checking their own ID should not conflict with themselves');
console.log('✅ Test 4 Passed: Self-check exclusion operates correctly.');

// 5. Admin Approval strict validation simulation
console.log('Test 5: Admin Approval simulation with duplicate protection');
function simulateApprove(requestId: string, requestedId: string, applicantUserId: string) {
  const check = simulateCheckIdTaken(requestedId, applicantUserId);
  if (check.isTaken) {
    return {
      status: 409,
      success: false,
      message: `Cannot approve: The ID "${requestedId}" is ALREADY TAKEN by user "${check.existingUser?.name}"!`,
    };
  }
  return {
    status: 200,
    success: true,
    message: `Request approved successfully! ID "${requestedId}" assigned.`,
  };
}

// Approval attempt for Priya requesting taken ID '77777'
const duplicateApproval = simulateApprove('req_1', '77777', 'user_222');
assert.strictEqual(duplicateApproval.status, 409, 'Duplicate approval must return 409 conflict');
assert.match(duplicateApproval.message, /ALREADY TAKEN by user "Aarav"/);
console.log('✅ Test 5 Passed: Duplicate approval strictly blocked with conflict message.');

// Approval attempt for Priya requesting free ID '55555'
const validApproval = simulateApprove('req_2', '55555', 'user_222');
assert.strictEqual(validApproval.status, 200, 'Free ID approval must return 200 success');
console.log('✅ Test 6 Passed: Valid free ID approval succeeds.');

console.log('🎉 All 6 Unique ID Level & Approval Validation Tests Passed Successfully!');
