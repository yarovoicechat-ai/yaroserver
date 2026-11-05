import { User } from '../models/user.model';
import { Referral } from '../models/referral.model';
import { RechargeHistory } from '../models/RechargeHistory';
import { RechargeType } from '../constants/user';
import { APP_ACCOUNT_ROLES } from '../utils/accountScope';
import { atomic } from '../economy/service';

export const INVITE_LOGIN_DIAMONDS = 3;
export const INVITE_RECHARGE_DIAMONDS = 2;

// Called only after authenticated app signup/login has bound a referral code.
// Balance, receipt and referral state commit together; a repeated claim cannot pay again.
export async function bindInviteAndRewardLogin(refereeId: string, referrerId: string, code: string) {
  if (refereeId === referrerId) throw Error('You cannot invite yourself');
  return atomic(async session => {
    const existing = await Referral.findOne({ referee: refereeId }).session(session).lean();
    if (existing) {
      if (String(existing.referrer) !== referrerId) throw Error('A referral is already linked to this account');
      return { duplicate: true, diamonds: Number(existing.loginDiamonds || 0) };
    }
    const referee = await User.findOne({ _id: refereeId, role: { $in: APP_ACCOUNT_ROLES }, isDeleted: false, isBlocked: false }).session(session).lean();
    const referrer = await User.findOne({ _id: referrerId, role: { $in: APP_ACCOUNT_ROLES }, isDeleted: false, isBlocked: false }).session(session).lean();
    if (!referee || !referrer) throw Error('Invite account is unavailable');
    if (referee.referralClaimed) throw Error('Referral already claimed');
    if (referee.device?.createdDeviceId && referee.device.createdDeviceId === referrer.device?.createdDeviceId) throw Error('Invites from the same registration device are not eligible');
    await Referral.create([{ referrer: referrerId, referee: refereeId, referralCode: code, rewardVersion: 2,
      loginDiamonds: INVITE_LOGIN_DIAMONDS, rechargeDiamonds: 0, referrerReward: INVITE_LOGIN_DIAMONDS, refereeReward: 0,
      step1Claimed: true, step1Coins: 0, step1RewardStatus: 'COMPLETED', step1ClaimedAt: new Date(),
      step2Claimed: false, step2Coins: 0, step2RewardStatus: 'NOT_STARTED', status: 'LOGIN_REWARDED',
    }], { session });
    await User.updateOne({ _id: refereeId }, { $set: { referredBy: referrerId, referralClaimed: true } }, { session });
    await User.updateOne({ _id: referrerId }, { $inc: { diamonds: INVITE_LOGIN_DIAMONDS, totalReferrals: 1 } }, { session });
    await RechargeHistory.create([{ userId: referrer.userId, type: RechargeType.REFERRAL_REGISTRATION_REWARD,
      transactionId: `INVITE_LOGIN_${refereeId}`, diamonds: INVITE_LOGIN_DIAMONDS, coins: 0, amount: 0,
      settlementStatus: 'SETTLED', status: 'COMPLETED', productId: 'INVITE_LOGIN_DIAMONDS',
      rawGoogleData: { rewardVersion: 2, refereeId, reason: 'First authenticated login with an invite' },
    }], { session });
    return { duplicate: false, diamonds: INVITE_LOGIN_DIAMONDS };
  });
}

export async function rewardInviteFirstRecharge(refereeId: string) {
  return atomic(async session => {
    const referral = await Referral.findOne({ referee: refereeId, rewardVersion: 2, firstRechargeId: { $exists: false } }).session(session).lean();
    if (!referral) return false;
    const referee = await User.findById(refereeId).session(session).lean();
    const referrer = await User.findOne({ _id: referral.referrer, isDeleted: false, isBlocked: false }).session(session).lean();
    if (!referee || !referrer) return false;
    // Promotional grants, failed/pending purchases and zero-value credits never qualify.
    const recharge = await RechargeHistory.findOne({ userId: referee.userId, amount: { $gt: 0 }, diamonds: { $gt: 0 },
      type: { $in: [RechargeType.ONLINE, RechargeType.OFFLINE, RechargeType.GOOGLE_PLAY] },
      status: 'COMPLETED', settlementStatus: 'SETTLED', createdAt: { $gte: referral.createdAt },
    }).sort({ createdAt: 1 }).session(session).lean();
    if (!recharge) return false;
    const claimed = await Referral.updateOne({ _id: referral._id, firstRechargeId: { $exists: false } }, {
      $set: { firstRechargeId: recharge._id, rechargeDiamonds: INVITE_RECHARGE_DIAMONDS, step2Claimed: true,
        step2ClaimedAt: new Date(), step2RewardStatus: 'COMPLETED', status: 'COMPLETED' },
      $inc: { referrerReward: INVITE_RECHARGE_DIAMONDS },
    }, { session });
    if (!claimed.modifiedCount) return false;
    await User.updateOne({ _id: referrer._id }, { $inc: { diamonds: INVITE_RECHARGE_DIAMONDS } }, { session });
    await RechargeHistory.create([{ userId: referrer.userId, type: RechargeType.REFERRAL_CALL_REWARD,
      transactionId: `INVITE_RECHARGE_${refereeId}`, diamonds: INVITE_RECHARGE_DIAMONDS, coins: 0, amount: 0,
      settlementStatus: 'SETTLED', status: 'COMPLETED', productId: 'INVITE_FIRST_RECHARGE_DIAMONDS',
      rawGoogleData: { rewardVersion: 2, refereeId, rechargeId: String(recharge._id) },
    }], { session });
    return true;
  });
}

export async function reconcileInviteRechargeRewards(referrerId?: string) {
  const pending = Referral.find({ rewardVersion: 2, firstRechargeId: { $exists: false }, ...(referrerId ? { referrer: referrerId } : {}) })
    .select('referee').lean().cursor();
  for await (const referral of pending) await rewardInviteFirstRecharge(String(referral.referee));
}
