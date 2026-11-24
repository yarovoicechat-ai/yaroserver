import { Response } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { User } from '../models/user.model';
import { AuditLog } from '../models/auditLog.model';
import { AuthRequest } from '../middlewares/authorize.middleware';
import sendResponse from '../utils/reponse';

/**
 * Owner-only: Create a Test ID or Fake ID.
 * Strictly no public numeric User ID assigned.
 */
export const createTestOrFakeUser = async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user;
    if (!owner || owner.role !== 'owner') {
      return sendResponse(res, 403, false, 'Forbidden: Only the Owner can create Test or Fake IDs.');
    }

    const {
      accountType, // 'test' | 'fake'
      name,
      phoneNumber,
      password = 'password123',
      gender = 'male',
      bio = '',
      image = '',
      diamonds = 1000,
      coins = 10000,
    } = req.body || {};

    if (!['test', 'fake'].includes(accountType)) {
      return sendResponse(res, 400, false, 'Invalid accountType. Must be either "test" or "fake".');
    }

    if (!name || !String(name).trim()) {
      return sendResponse(res, 400, false, 'Name is required.');
    }

    // Optional phone number; if provided, ensure uniqueness
    let normalizedPhone: string | undefined;
    if (phoneNumber && String(phoneNumber).trim()) {
      const cleanDigits = String(phoneNumber).trim().replace(/\D/g, '');
      if (cleanDigits.length < 6) {
        return sendResponse(res, 400, false, 'Phone number must have at least 6 digits.');
      }
      normalizedPhone = String(phoneNumber).trim().startsWith('+')
        ? `+${cleanDigits}`
        : (cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`);

      const existingPhone = await User.findOne({ phoneNumber: normalizedPhone, isDeleted: false }).select('_id name').lean();
      if (existingPhone) {
        return sendResponse(res, 409, false, `Phone number ${normalizedPhone} is already in use.`);
      }
    } else {
      // Generate unique dummy phone for internal auth if needed
      normalizedPhone = `+999${accountType === 'test' ? '88' : '77'}${Date.now().toString().slice(-6)}`;
    }

    const hashedPassword = await bcrypt.hash(String(password).trim(), 10);

    const newUser = await User.create({
      name: String(name).trim(),
      phoneNumber: normalizedPhone,
      password: hashedPassword,
      gender: ['male', 'female', 'other'].includes(gender) ? gender : 'male',
      bio: String(bio || '').trim(),
      image: String(image || '').trim(),
      coins: Math.max(0, Number(coins) || 0),
      diamonds: Math.max(0, Number(diamonds) || 0),
      accountType,
      isTestAccount: accountType === 'test',
      isFake: accountType === 'fake',
      // Explicitly NO public numeric userId
      userId: undefined,
      role: 'user',
      createdBy: owner.id,
      isBlocked: false,
      isDeleted: false,
      device: {
        createdDeviceId: `OWNER_${accountType.toUpperCase()}_ID`,
        currentDeviceId: `OWNER_${accountType.toUpperCase()}_ID`,
        loggedInDeviceIds: [`OWNER_${accountType.toUpperCase()}_ID`],
      },
    });

    // Audit log
    await AuditLog.create({
      adminId: owner.id,
      action: `CREATE_${accountType.toUpperCase()}_ID`,
      target: String(newUser._id),
      details: `Created ${accountType} account: "${newUser.name}" (Internal ID: ${newUser._id})`,
      ipAddress: req.ip || '127.0.0.1',
      newValue: {
        _id: newUser._id,
        name: newUser.name,
        accountType: newUser.accountType,
        phoneNumber: newUser.phoneNumber,
      },
    });

    return sendResponse(res, 201, true, `${accountType === 'test' ? 'Test' : 'Fake'} ID created successfully.`, {
      user: {
        _id: newUser._id,
        name: newUser.name,
        accountType: newUser.accountType,
        isTestAccount: newUser.isTestAccount,
        isFake: newUser.isFake,
        phoneNumber: newUser.phoneNumber,
        gender: newUser.gender,
        bio: newUser.bio,
        image: newUser.image,
        coins: newUser.coins,
        diamonds: newUser.diamonds,
        createdAt: newUser.createdAt,
      },
    });
  } catch (error: any) {
    console.error('[createTestOrFakeUser] error:', error);
    return sendResponse(res, 500, false, error.message || 'Internal server error');
  }
};

/**
 * Owner-only: List and filter Test and Fake accounts.
 */
export const getTestFakeUsers = async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user;
    if (!owner || owner.role !== 'owner') {
      return sendResponse(res, 403, false, 'Forbidden: Only the Owner can view Test or Fake IDs.');
    }

    const {
      page = 1,
      limit = 20,
      search = '',
      type = 'all', // 'all' | 'test' | 'fake'
    } = req.query as any;

    const query: any = {
      isDeleted: { $ne: true },
    };

    if (type === 'test') {
      query.$or = [{ accountType: 'test' }, { isTestAccount: true }];
    } else if (type === 'fake') {
      query.$or = [{ accountType: 'fake' }, { isFake: true }];
    } else {
      query.$or = [
        { accountType: { $in: ['test', 'fake'] } },
        { isTestAccount: true },
        { isFake: true },
      ];
    }

    if (search && String(search).trim()) {
      const searchStr = String(search).trim();
      const searchConditions: any[] = [
        { name: { $regex: searchStr, $options: 'i' } },
        { phoneNumber: { $regex: searchStr, $options: 'i' } },
      ];
      if (mongoose.Types.ObjectId.isValid(searchStr)) {
        searchConditions.push({ _id: new mongoose.Types.ObjectId(searchStr) });
      }
      query.$and = [{ $or: query.$or }, { $or: searchConditions }];
      delete query.$or;
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(query)
        .select('_id name phoneNumber gender bio image coins diamonds accountType isTestAccount isFake isBlocked createdAt lastActiveAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(query),
    ]);

    const formattedUsers = users.map(u => ({
      _id: u._id,
      name: u.name,
      phoneNumber: u.phoneNumber,
      gender: u.gender,
      bio: u.bio,
      image: u.image,
      coins: u.coins || 0,
      diamonds: u.diamonds || 0,
      accountType: u.accountType || (u.isTestAccount ? 'test' : u.isFake ? 'fake' : 'regular'),
      isBlocked: Boolean(u.isBlocked),
      createdAt: u.createdAt,
      lastActiveAt: u.lastActiveAt,
    }));

    return sendResponse(res, 200, true, 'Test/Fake users fetched successfully', {
      users: formattedUsers,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('[getTestFakeUsers] error:', error);
    return sendResponse(res, 500, false, error.message || 'Internal server error');
  }
};

/**
 * Owner-only: Edit permitted profile details of Test/Fake account.
 */
export const updateTestFakeUser = async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user;
    if (!owner || owner.role !== 'owner') {
      return sendResponse(res, 403, false, 'Forbidden: Only the Owner can update Test or Fake IDs.');
    }

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(res, 400, false, 'Invalid User ID.');
    }

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return sendResponse(res, 404, false, 'Account not found.');
    }

    if (targetUser.accountType !== 'test' && targetUser.accountType !== 'fake' && !targetUser.isTestAccount && !targetUser.isFake) {
      return sendResponse(res, 400, false, 'Operation rejected: Target is a regular user. Only Test or Fake accounts can be modified here.');
    }

    const { name, gender, bio, image, coins, diamonds, password } = req.body || {};
    const oldValue = {
      name: targetUser.name,
      gender: targetUser.gender,
      bio: targetUser.bio,
      image: targetUser.image,
      coins: targetUser.coins,
      diamonds: targetUser.diamonds,
    };

    if (name && String(name).trim()) targetUser.name = String(name).trim();
    if (gender && ['male', 'female', 'other'].includes(gender)) targetUser.gender = gender as any;
    if (typeof bio === 'string') targetUser.bio = bio.trim();
    if (typeof image === 'string') targetUser.image = image.trim();
    if (coins !== undefined) targetUser.coins = Math.max(0, Number(coins) || 0);
    if (diamonds !== undefined) targetUser.diamonds = Math.max(0, Number(diamonds) || 0);
    if (password && String(password).trim().length >= 4) {
      targetUser.password = await bcrypt.hash(String(password).trim(), 10);
    }

    await targetUser.save();

    await AuditLog.create({
      adminId: owner.id,
      action: 'UPDATE_TEST_FAKE_PROFILE',
      target: String(targetUser._id),
      details: `Updated ${targetUser.accountType || 'test/fake'} user profile: "${targetUser.name}"`,
      ipAddress: req.ip || '127.0.0.1',
      oldValue,
      newValue: {
        name: targetUser.name,
        gender: targetUser.gender,
        bio: targetUser.bio,
        image: targetUser.image,
        coins: targetUser.coins,
        diamonds: targetUser.diamonds,
      },
    });

    return sendResponse(res, 200, true, 'Profile updated successfully.', {
      user: {
        _id: targetUser._id,
        name: targetUser.name,
        accountType: targetUser.accountType,
        gender: targetUser.gender,
        bio: targetUser.bio,
        image: targetUser.image,
        coins: targetUser.coins,
        diamonds: targetUser.diamonds,
      },
    });
  } catch (error: any) {
    console.error('[updateTestFakeUser] error:', error);
    return sendResponse(res, 500, false, error.message || 'Internal server error');
  }
};

/**
 * Owner-only: Activate or Deactivate Test/Fake account.
 */
export const toggleTestFakeUserStatus = async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user;
    if (!owner || owner.role !== 'owner') {
      return sendResponse(res, 403, false, 'Forbidden: Only the Owner can toggle Test or Fake ID status.');
    }

    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(res, 400, false, 'Invalid User ID.');
    }

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return sendResponse(res, 404, false, 'Account not found.');
    }

    if (targetUser.accountType !== 'test' && targetUser.accountType !== 'fake' && !targetUser.isTestAccount && !targetUser.isFake) {
      return sendResponse(res, 400, false, 'Operation rejected: Target is a regular user.');
    }

    const nextBlockedState = !targetUser.isBlocked;
    targetUser.isBlocked = nextBlockedState;
    await targetUser.save();

    await AuditLog.create({
      adminId: owner.id,
      action: nextBlockedState ? 'DEACTIVATE_TEST_FAKE_USER' : 'ACTIVATE_TEST_FAKE_USER',
      target: String(targetUser._id),
      details: `${nextBlockedState ? 'Deactivated' : 'Activated'} ${targetUser.accountType || 'test/fake'} user: "${targetUser.name}"`,
      ipAddress: req.ip || '127.0.0.1',
    });

    return sendResponse(res, 200, true, `Account ${nextBlockedState ? 'deactivated' : 'activated'} successfully.`, {
      _id: targetUser._id,
      isBlocked: targetUser.isBlocked,
    });
  } catch (error: any) {
    console.error('[toggleTestFakeUserStatus] error:', error);
    return sendResponse(res, 500, false, error.message || 'Internal server error');
  }
};

/**
 * Owner-only: Delete or Archive a Test/Fake account with data safety checks.
 */
export const deleteOrArchiveTestFakeUser = async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user;
    if (!owner || owner.role !== 'owner') {
      return sendResponse(res, 403, false, 'Forbidden: Only the Owner can delete Test or Fake IDs.');
    }

    const { id } = req.params;
    const mode = (req.body?.mode || (req.query as any)?.mode || 'archive') as 'archive' | 'delete';

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(res, 400, false, 'Invalid User ID.');
    }

    const targetUser = await User.findById(id);
    if (!targetUser) {
      return sendResponse(res, 404, false, 'Account not found.');
    }

    // Strict safety check: Never delete regular users
    if (targetUser.accountType !== 'test' && targetUser.accountType !== 'fake' && !targetUser.isTestAccount && !targetUser.isFake) {
      return sendResponse(res, 403, false, 'Safety Check Blocked: You cannot delete regular user accounts through this endpoint.');
    }

    if (mode === 'delete') {
      await User.findByIdAndDelete(id);
    } else {
      targetUser.isDeleted = true;
      targetUser.isBlocked = true;
      await targetUser.save();
    }

    await AuditLog.create({
      adminId: owner.id,
      action: mode === 'delete' ? 'DELETE_TEST_FAKE_USER' : 'ARCHIVE_TEST_FAKE_USER',
      target: String(targetUser._id),
      details: `${mode === 'delete' ? 'Permanently deleted' : 'Archived'} ${targetUser.accountType || 'test/fake'} account: "${targetUser.name}"`,
      ipAddress: req.ip || '127.0.0.1',
    });

    return sendResponse(res, 200, true, `Account ${mode === 'delete' ? 'deleted' : 'archived'} successfully.`);
  } catch (error: any) {
    console.error('[deleteOrArchiveTestFakeUser] error:', error);
    return sendResponse(res, 500, false, error.message || 'Internal server error');
  }
};
