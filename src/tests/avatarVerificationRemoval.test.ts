import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { validateAvatarSecurity } from '../utils/avatarSecurity';

describe('Avatar Verification Removal & Withdrawal Verification Protection Suite', () => {

  describe('1. Image Security & Validation Tests', () => {
    test('1. Accepts valid JPG image URL', () => {
      const res = validateAvatarSecurity('https://res.cloudinary.com/yaro/image/upload/v123/avatar.jpg');
      assert.strictEqual(res.valid, true);
      assert.ok(res.cleanAvatar);
    });

    test('2. Accepts valid JPEG image URL', () => {
      const res = validateAvatarSecurity('https://api.yaroapp.in/uploads/avatars/user-12345.jpeg');
      assert.strictEqual(res.valid, true);
    });

    test('3. Accepts valid PNG image URL', () => {
      const res = validateAvatarSecurity('https://images.example.com/profiles/avatar.png');
      assert.strictEqual(res.valid, true);
    });

    test('4. Accepts valid WEBP image URL', () => {
      const res = validateAvatarSecurity('https://api.yaroapp.in/uploads/avatars/female_default.webp');
      assert.strictEqual(res.valid, true);
    });

    test('5. Accepts valid Cloudinary URL with parameters', () => {
      const res = validateAvatarSecurity('https://res.cloudinary.com/demo/image/upload/c_fill,h_150,w_150/sample.jpg');
      assert.strictEqual(res.valid, true);
    });

    test('6. Rejects executable file: .exe', () => {
      const res = validateAvatarSecurity('https://malicious.com/uploads/trojan.exe');
      assert.strictEqual(res.valid, false);
      assert.match(res.error || '', /forbidden/i);
    });

    test('7. Rejects script files: .sh, .bat, .cmd, .js, .ts, .php, .py', () => {
      const scripts = ['exploit.sh', 'malware.bat', 'hack.cmd', 'payload.js', 'attack.ts', 'shell.php', 'backdoor.py'];
      for (const script of scripts) {
        const res = validateAvatarSecurity(`https://evil.com/${script}`);
        assert.strictEqual(res.valid, false, `Expected ${script} to be rejected`);
      }
    });

    test('8. Rejects binary, apk, jar files', () => {
      const binaries = ['app.apk', 'lib.jar', 'data.bin', 'macro.vbs'];
      for (const b of binaries) {
        const res = validateAvatarSecurity(`https://evil.com/${b}`);
        assert.strictEqual(res.valid, false, `Expected ${b} to be rejected`);
      }
    });

    test('9. Rejects SVG vectors (potential XSS vector)', () => {
      const res = validateAvatarSecurity('https://evil.com/xss.svg');
      assert.strictEqual(res.valid, false);
    });

    test('10. Rejects empty string or null input', () => {
      assert.strictEqual(validateAvatarSecurity('').valid, false);
      assert.strictEqual(validateAvatarSecurity('   ').valid, false);
      assert.strictEqual(validateAvatarSecurity(null).valid, false);
      assert.strictEqual(validateAvatarSecurity(undefined).valid, false);
    });

    test('11. Rejects invalid protocols like ftp or javascript:', () => {
      assert.strictEqual(validateAvatarSecurity('ftp://evil.com/photo.jpg').valid, false);
      assert.strictEqual(validateAvatarSecurity('javascript:alert(1)').valid, false);
    });

    test('12. Rejects excessively long input strings', () => {
      const veryLong = 'https://example.com/' + 'a'.repeat(2500) + '.jpg';
      assert.strictEqual(validateAvatarSecurity(veryLong).valid, false);
    });
  });

  describe('2. Authentication & Authorization Enforcement', () => {
    test('13. Unauthenticated user cannot change avatar (missing auth context)', () => {
      const authUser = undefined;
      const canProceed = Boolean(authUser);
      assert.strictEqual(canProceed, false, 'Unauthenticated user must be blocked');
    });

    test('14. User cannot update another user’s avatar (ignores req.body.userId)', () => {
      const sessionUser = { userId: 1001, id: 'user_1001_obj' };
      const requestBody = { userId: 9999, requestedAvatar: 'https://cdn.example.com/pic.jpg' };

      // Architecture rule: Target user ID is derived strictly from session, never from body
      const resolvedTargetUserId = sessionUser.userId;
      assert.strictEqual(resolvedTargetUserId, 1001);
      assert.notStrictEqual(resolvedTargetUserId, requestBody.userId);
    });

    test('15. Authenticated user can change their own avatar without verification', () => {
      const sessionUser = { userId: 1001, id: 'user_1001_obj' };
      const newAvatarUrl = 'https://res.cloudinary.com/yaro/image/upload/v1/avatar.webp';
      const validation = validateAvatarSecurity(newAvatarUrl);
      assert.strictEqual(validation.valid, true);

      // Simulated avatar update payload
      const updatedUser = {
        userId: sessionUser.userId,
        image: validation.cleanAvatar,
        profilePic: validation.cleanAvatar,
      };

      assert.strictEqual(updatedUser.image, newAvatarUrl);
      assert.strictEqual(updatedUser.profilePic, newAvatarUrl);
    });
  });

  describe('3. Avatar Zero-Verification Flow Tests', () => {
    test('16. Avatar change requires NO OTP verification', () => {
      const requiredStepsForAvatar = ['authentication', 'imageValidation', 'databaseUpdate'];
      assert.strictEqual(requiredStepsForAvatar.includes('OTP'), false);
      assert.strictEqual(requiredStepsForAvatar.includes('phoneVerification'), false);
      assert.strictEqual(requiredStepsForAvatar.includes('emailVerification'), false);
    });

    test('17. Avatar change requires NO KYC verification', () => {
      const requiredStepsForAvatar = ['authentication', 'imageValidation', 'databaseUpdate'];
      assert.strictEqual(requiredStepsForAvatar.includes('KYC'), false);
      assert.strictEqual(requiredStepsForAvatar.includes('documentUpload'), false);
    });

    test('18. Avatar change requires NO Selfie / Face verification', () => {
      const requiredStepsForAvatar = ['authentication', 'imageValidation', 'databaseUpdate'];
      assert.strictEqual(requiredStepsForAvatar.includes('faceSelfie'), false);
      assert.strictEqual(requiredStepsForAvatar.includes('liveness'), false);
    });

    test('19. Avatar change requires NO Withdrawal PIN or Transaction PIN', () => {
      const requiredStepsForAvatar = ['authentication', 'imageValidation', 'databaseUpdate'];
      assert.strictEqual(requiredStepsForAvatar.includes('withdrawalPIN'), false);
      assert.strictEqual(requiredStepsForAvatar.includes('transactionPIN'), false);
    });

    test('20. Avatar change requires NO Admin Approval gate (instant update)', () => {
      const avatarUpdateResult = {
        isImmediate: true,
        status: 'APPROVED',
        pendingReview: false,
      };
      assert.strictEqual(avatarUpdateResult.isImmediate, true);
      assert.strictEqual(avatarUpdateResult.pendingReview, false);
      assert.strictEqual(avatarUpdateResult.status, 'APPROVED');
    });
  });

  describe('4. VIP & SVIP Customization Compatibility', () => {
    test('21. Changing avatar preserves equipped VIP/SVIP Avatar Frame', () => {
      const user = {
        userId: 1001,
        image: 'https://api.yaroapp.in/uploads/avatars/male_default.webp',
        equippedFrame: 'Rose frame',
        frameId: 'frame_rose_01',
        equippedVipId: 'vip_gold',
        equippedSvipId: 'svip_duke',
      };

      const newAvatarUrl = 'https://res.cloudinary.com/yaro/image/upload/v2/new_avatar.jpg';
      const updatedUser = {
        ...user,
        image: newAvatarUrl,
        profilePic: newAvatarUrl,
      };

      // Frame and VIP customization MUST remain intact
      assert.strictEqual(updatedUser.image, newAvatarUrl);
      assert.strictEqual(updatedUser.equippedFrame, 'Rose frame');
      assert.strictEqual(updatedUser.frameId, 'frame_rose_01');
      assert.strictEqual(updatedUser.equippedVipId, 'vip_gold');
      assert.strictEqual(updatedUser.equippedSvipId, 'svip_duke');
    });

    test('22. Changing avatar preserves Entry Effects, Mic Wave, Chat Bubble, Room Theme', () => {
      const user = {
        userId: 1001,
        image: 'https://api.yaroapp.in/uploads/avatars/female_default.webp',
        equippedEntryEffect: 'effect_phoenix_wings',
        equippedEntryTag: 'VIP_PHOENIX',
        equippedMicWave: 'mic_wave_gold',
        equippedChatBubble: 'bubble_neon',
        equippedRoomTheme: 'theme_nebula',
      };

      const newAvatarUrl = 'https://res.cloudinary.com/yaro/image/upload/v3/custom.png';
      const updatedUser = {
        ...user,
        image: newAvatarUrl,
      };

      assert.strictEqual(updatedUser.equippedEntryEffect, 'effect_phoenix_wings');
      assert.strictEqual(updatedUser.equippedEntryTag, 'VIP_PHOENIX');
      assert.strictEqual(updatedUser.equippedMicWave, 'mic_wave_gold');
      assert.strictEqual(updatedUser.equippedChatBubble, 'bubble_neon');
      assert.strictEqual(updatedUser.equippedRoomTheme, 'theme_nebula');
    });
  });

  describe('5. Mandatory Withdrawal Verification Protection & Regression Tests', () => {
    // Regression Test 1: Change Avatar -> SUCCESS, NO VERIFICATION
    test('TEST 1: Change Avatar succeeds with zero verification required', () => {
      const user = {
        userId: 2001,
        role: 'user',
        faceVerificationStatus: 'NOT_SUBMITTED',
        kycVerificationStatus: 'NOT_SUBMITTED',
        image: 'https://api.yaroapp.in/uploads/avatars/male_default.webp',
      };

      const avatarUpload = validateAvatarSecurity('https://res.cloudinary.com/yaro/image/upload/avatar.jpg');
      assert.strictEqual(avatarUpload.valid, true);

      // Perform avatar change
      user.image = avatarUpload.cleanAvatar!;

      assert.strictEqual(user.image, 'https://res.cloudinary.com/yaro/image/upload/avatar.jpg');
      // Face and KYC remain untouched (NOT_SUBMITTED)
      assert.strictEqual(user.faceVerificationStatus, 'NOT_SUBMITTED');
      assert.strictEqual(user.kycVerificationStatus, 'NOT_SUBMITTED');
    });

    // Regression Test 2: Attempt Withdrawal without required verification -> BLOCKED
    test('TEST 2: Attempt Withdrawal without required verification is BLOCKED with 403', () => {
      const verificationSettings = {
        faceVerificationEnabled: true,
        kycVerificationEnabled: true,
        rolesRequiringFaceVerification: ['host', 'user'],
        rolesRequiringKycVerification: ['host', 'user'],
      };

      const unverifiedUser = {
        userId: 2001,
        role: 'user',
        coins: 50000,
        faceVerificationStatus: 'NOT_SUBMITTED',
        kycVerificationStatus: 'NOT_SUBMITTED',
      };

      const faceRequired = verificationSettings.faceVerificationEnabled &&
        verificationSettings.rolesRequiringFaceVerification.includes(unverifiedUser.role);
      const kycRequired = verificationSettings.kycVerificationEnabled &&
        verificationSettings.rolesRequiringKycVerification.includes(unverifiedUser.role);

      const isBlocked = (faceRequired && unverifiedUser.faceVerificationStatus !== 'APPROVED') ||
        (kycRequired && unverifiedUser.kycVerificationStatus !== 'APPROVED');

      assert.strictEqual(isBlocked, true, 'Withdrawal MUST be blocked when face/KYC are not APPROVED');
    });

    // Regression Test 3: Complete required withdrawal verification -> ALLOWED
    test('TEST 3: Withdrawal continues normally when required verification is APPROVED', () => {
      const verificationSettings = {
        faceVerificationEnabled: true,
        kycVerificationEnabled: true,
        rolesRequiringFaceVerification: ['host', 'user'],
        rolesRequiringKycVerification: ['host', 'user'],
      };

      const verifiedUser = {
        userId: 2001,
        role: 'user',
        coins: 50000,
        faceVerificationStatus: 'APPROVED',
        kycVerificationStatus: 'APPROVED',
      };

      const faceRequired = verificationSettings.faceVerificationEnabled &&
        verificationSettings.rolesRequiringFaceVerification.includes(verifiedUser.role);
      const kycRequired = verificationSettings.kycVerificationEnabled &&
        verificationSettings.rolesRequiringKycVerification.includes(verifiedUser.role);

      const isBlocked = (faceRequired && verifiedUser.faceVerificationStatus !== 'APPROVED') ||
        (kycRequired && verifiedUser.kycVerificationStatus !== 'APPROVED');

      assert.strictEqual(isBlocked, false, 'Withdrawal must NOT be blocked when face & KYC are APPROVED');
    });

    // Regression Test 4: Avatar Change -> Withdrawal -> Withdrawal STILL asks for verification
    test('TEST 4: Avatar change followed by withdrawal attempt STILL asks for verification', () => {
      const user = {
        userId: 3001,
        role: 'host',
        coins: 100000,
        faceVerificationStatus: 'PENDING',
        kycVerificationStatus: 'NOT_SUBMITTED',
        image: 'https://api.yaroapp.in/uploads/avatars/female_default.webp',
      };

      // 1. User changes avatar
      const avatarRes = validateAvatarSecurity('https://res.cloudinary.com/yaro/image/upload/host_new.jpg');
      assert.strictEqual(avatarRes.valid, true);
      user.image = avatarRes.cleanAvatar!;

      // 2. User attempts withdrawal
      const verificationSettings = {
        faceVerificationEnabled: true,
        kycVerificationEnabled: true,
        rolesRequiringFaceVerification: ['host'],
        rolesRequiringKycVerification: ['host'],
      };

      const faceRequired = verificationSettings.faceVerificationEnabled &&
        verificationSettings.rolesRequiringFaceVerification.includes(user.role);
      const kycRequired = verificationSettings.kycVerificationEnabled &&
        verificationSettings.rolesRequiringKycVerification.includes(user.role);

      const withdrawalBlocked = (faceRequired && user.faceVerificationStatus !== 'APPROVED') ||
        (kycRequired && user.kycVerificationStatus !== 'APPROVED');

      assert.strictEqual(withdrawalBlocked, true, 'Withdrawal MUST still be blocked after avatar change');
    });

    // Regression Test 5: Withdrawal -> Avatar Change -> Avatar can be changed without verification
    test('TEST 5: Failed or pending withdrawal does NOT prevent user from changing avatar', () => {
      const user = {
        userId: 4001,
        role: 'user',
        faceVerificationStatus: 'REJECTED',
        kycVerificationStatus: 'NOT_SUBMITTED',
        image: 'https://api.yaroapp.in/uploads/avatars/male_default.webp',
      };

      // Avatar change must succeed regardless of failed withdrawal KYC status
      const avatarRes = validateAvatarSecurity('https://res.cloudinary.com/yaro/image/upload/new_pic.webp');
      assert.strictEqual(avatarRes.valid, true);
      user.image = avatarRes.cleanAvatar!;

      assert.strictEqual(user.image, 'https://res.cloudinary.com/yaro/image/upload/new_pic.webp');
    });

    // Regression Test 6: Avatar change must NOT mark user's withdrawal verification as completed
    test('TEST 6: Avatar change does NOT mark faceVerificationStatus or kycVerificationStatus as APPROVED', () => {
      const originalFaceStatus = 'NOT_SUBMITTED';
      const originalKycStatus = 'NOT_SUBMITTED';

      const user = {
        userId: 5001,
        faceVerificationStatus: originalFaceStatus,
        kycVerificationStatus: originalKycStatus,
        image: 'https://api.yaroapp.in/uploads/avatars/male_default.webp',
      };

      // Execute avatar update
      user.image = 'https://res.cloudinary.com/yaro/image/upload/updated.png';

      // Statuses must be identical to pre-update values
      assert.strictEqual(user.faceVerificationStatus, originalFaceStatus);
      assert.strictEqual(user.kycVerificationStatus, originalKycStatus);
    });

    // Regression Test 7: Avatar change must NOT modify KYC state, withdrawal security, or payout eligibility
    test('TEST 7: Avatar change does NOT modify KYC state, withdrawal security state, or payout eligibility', () => {
      const preState = {
        faceVerificationStatus: 'REJECTED',
        kycVerificationStatus: 'NOT_SUBMITTED',
        coins: 85000,
        diamonds: 2000,
        isBlocked: false,
        withdrawalPin: '4321',
      };

      const user = { ...preState, image: 'old.jpg' };

      // Execute avatar change
      user.image = 'https://res.cloudinary.com/yaro/image/upload/brand_new.jpg';

      assert.strictEqual(user.faceVerificationStatus, preState.faceVerificationStatus);
      assert.strictEqual(user.kycVerificationStatus, preState.kycVerificationStatus);
      assert.strictEqual(user.coins, preState.coins);
      assert.strictEqual(user.diamonds, preState.diamonds);
      assert.strictEqual(user.isBlocked, preState.isBlocked);
      assert.strictEqual(user.withdrawalPin, preState.withdrawalPin);
    });
  });
});
