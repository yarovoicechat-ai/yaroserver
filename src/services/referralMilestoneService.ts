import { ClientSession } from 'mongoose';
import { User } from '../models/user.model';
import { Referral } from '../models/referral.model';
import { ReferralCallCredit } from '../models/referralCallCredit.model';
import { ReferralOutbox } from '../models/referralOutbox.model';
import { RechargeHistory } from '../models/RechargeHistory';
import { RechargeType } from '../constants/user';
import { reconcilePendingOutbox } from './referralReconciliationService';

/**
 * Evaluates 2-Step Referral Call Milestone:
 * Crash-consistent, recoverable, and financially idempotent implementation.
 * 
 * Supports MongoDB session transactions when active and un-expired.
 * Integrates CallCredit state machine (PENDING -> PROCESSING -> APPLIED)
 * and Step 2 Reward state machine (NOT_STARTED -> PROCESSING -> COMPLETED).
 */
export const evaluateReferralCallMilestone = async (
  refereeUserId: any,
  callDurationSec: number,
  callTransactionId?: any,
  session?: ClientSession
) => {
  try {
    if (!refereeUserId || callDurationSec <= 0) return;

    // Verify session is valid and active before passing to Mongoose queries
    const activeSession = (session && !session.hasEnded && session.inTransaction()) ? session : undefined;

    // Find referee user document
    const refereeUser = await User.findById(refereeUserId).session(activeSession || null).lean();
    if (!refereeUser) return;

    // Find active referral record for referee
    const referral = await Referral.findOne({ referee: refereeUser._id }).session(activeSession || null);
    if (!referral) return;

    let callCreditDoc: any = null;

    // 1. Call Credit Idempotency State Machine
    if (callTransactionId) {
      console.log(`[REFERRAL_CALL_CREDIT_PROCESSING] Processing call ${callTransactionId} (+${callDurationSec}s) for referral ${referral._id}`);
      try {
        const createOptions = activeSession ? { session: activeSession } : undefined;
        const [newCredit] = await ReferralCallCredit.create(
          [
            {
              referralId: referral._id,
              callId: String(callTransactionId),
              refereeUserId: refereeUser._id,
              durationSeconds: callDurationSec,
              status: 'PROCESSING',
              processedAt: new Date(),
            },
          ],
          createOptions
        );
        callCreditDoc = newCredit;
      } catch (creditErr: any) {
        if (creditErr.code === 11000 || creditErr.message?.includes('E11000') || creditErr.name === 'MongoServerError') {
          // Check existing record state
          const existingCredit = await ReferralCallCredit.findOne({
            referralId: referral._id,
            callId: String(callTransactionId),
          }).session(activeSession || null);

          if (existingCredit) {
            if (existingCredit.status === 'APPLIED') {
              console.log(`[REFERRAL_CALL_CREDIT_DUPLICATE] Call credit ${callTransactionId} already APPLIED for referral ${referral._id}. Skipping.`);
              return;
            } else {
              console.log(`[REFERRAL_CALL_CREDIT_PENDING] Resuming crashed call credit ${callTransactionId} in state ${existingCredit.status}`);
              callCreditDoc = existingCredit;
            }
          } else {
            return;
          }
        } else {
          console.warn("ReferralCallCredit error:", creditErr.message);
        }
      }
    }

    // 2. Increment totalCallSeconds & transition CallCredit status to APPLIED
    const updatedReferral = await Referral.findByIdAndUpdate(
      referral._id,
      { $inc: { totalCallSeconds: callDurationSec } },
      { new: true, session: activeSession || undefined }
    );

    if (!updatedReferral) return;

    if (callCreditDoc) {
      await ReferralCallCredit.updateOne(
        { _id: callCreditDoc._id },
        { $set: { status: 'APPLIED', appliedAt: new Date() } },
        { session: activeSession || undefined }
      );
      console.log(`[REFERRAL_CALL_CREDIT_APPLIED] Applied call credit ${callTransactionId} (+${callDurationSec}s) -> Total: ${updatedReferral.totalCallSeconds}s / 300s`);
    } else {
      console.log(`[REFERRAL_CALL_DURATION_APPLIED] Applied duration (+${callDurationSec}s) -> Total: ${updatedReferral.totalCallSeconds}s / 300s`);
    }

    // 3. Evaluate Step 2 Milestone (300s cumulative call time)
    if (updatedReferral.totalCallSeconds >= 300 && updatedReferral.step2RewardStatus !== 'COMPLETED') {
      console.log(`[REFERRAL_STEP2_THRESHOLD_REACHED] Referee ${refereeUser.userId} reached 300s threshold! Total: ${updatedReferral.totalCallSeconds}s`);

      // Atomic state machine transition: NOT_STARTED/PENDING/FAILED -> PROCESSING
      const claimResult = await Referral.findOneAndUpdate(
        { _id: updatedReferral._id, step2RewardStatus: { $ne: 'COMPLETED' } },
        { $set: { step2RewardStatus: 'PROCESSING' } },
        { new: true, session: activeSession || undefined }
      );

      if (claimResult) {
        console.log(`[REFERRAL_STEP2_REWARD_PROCESSING] Claimed Step 2 reward lock for referral ${claimResult._id}`);

        const referrerUser = await User.findById(claimResult.referrer).session(activeSession || null);
        const expectedTxId = `REF_STEP2_${claimResult._id}`;

        if (referrerUser) {
          const txData = {
            userId: referrerUser.userId,
            type: RechargeType.REFERRAL_CALL_REWARD,
            coins: 25,
            diamonds: 0,
            amount: 0,
            currency: 'COIN',
            status: 'COMPLETED',
            settlementStatus: activeSession ? ('SETTLED' as const) : ('PENDING' as const),
            settledAt: activeSession ? new Date() : undefined,
            date: new Date(),
            processedAt: new Date(),
            productId: 'REFERRAL_STEP2_REWARD',
            transactionId: expectedTxId,
            rawGoogleData: {
              type: 'REFERRAL_CALL_REWARD',
              amount: 25,
              currency: 'COIN',
              referralId: String(claimResult._id),
              referredUserId: refereeUser.userId,
              requiredCallSeconds: 300,
              note: `Step 2 Referral Reward: 25 Coins (5 Min Call Milestone) for referee user ${refereeUser.userId}`,
            },
          };

          let ledgerDoc: any = null;
          let shouldCreditCoins = true;

          try {
            if (activeSession) {
              const [newTx] = await RechargeHistory.create([txData], { session: activeSession });
              ledgerDoc = newTx;
            } else {
              ledgerDoc = await RechargeHistory.create(txData);
            }
          } catch (txErr: any) {
            if (txErr.code === 11000 || txErr.message?.includes('E11000')) {
              const existingTx = await RechargeHistory.findOne({ transactionId: expectedTxId }).session(activeSession || null);
              if (existingTx) {
                if (existingTx.settlementStatus === 'SETTLED') {
                  console.log(`[REFERRAL_STEP2_REWARD_DUPLICATE_BLOCKED] Reward ${expectedTxId} already SETTLED. Skipping balance credit.`);
                  shouldCreditCoins = false;
                } else {
                  ledgerDoc = existingTx;
                }
              }
            } else {
              console.log("RechargeHistory creation notice (Step 2):", txErr.message);
            }
          }

          // Credit Referrer 25 COINS only if not already settled
          if (shouldCreditCoins) {
            await User.updateOne(
              { _id: claimResult.referrer },
              { $inc: { coins: 25 } },
              { session: activeSession || undefined }
            );

            if (ledgerDoc && ledgerDoc.settlementStatus !== 'SETTLED') {
              await RechargeHistory.updateOne(
                { _id: ledgerDoc._id },
                { $set: { settlementStatus: 'SETTLED', settledAt: new Date() } },
                { session: activeSession || undefined }
              );
            }
          }

          // Complete Step 2 reward state in Referral
          await Referral.updateOne(
            { _id: claimResult._id },
            {
              $set: {
                step2RewardStatus: 'COMPLETED',
                step2Claimed: true,
                step2Coins: 25,
                step2ClaimedAt: new Date(),
                referrerReward: (claimResult.step1Coins || 25) + 25,
                status: 'COMPLETED',
              },
            },
            { session: activeSession || undefined }
          );

          console.log(`[REFERRAL_STEP2_REWARD_COMPLETED] Referrer ${referrerUser.userId} credited +25 Coins for referee ${refereeUser.userId}`);

          // Enqueue side-effect notification into ReferralOutbox
          try {
            const outboxData = {
              referralId: claimResult._id,
              type: 'STEP2_NOTIFICATION',
              payload: {
                referrerUserId: referrerUser.userId,
                refereeUserId: refereeUser.userId,
                referrerMongoId: String(referrerUser._id),
                fcmToken: referrerUser.fcmToken,
              },
              status: 'PENDING',
            };

            if (activeSession) {
              await ReferralOutbox.create([outboxData], { session: activeSession });
            } else {
              await ReferralOutbox.create(outboxData);
            }
          } catch (outboxErr: any) {
            console.warn("ReferralOutbox creation warning:", outboxErr.message);
          }

          // Trigger outbox processing asynchronously (post-commit)
          if (!activeSession) {
            reconcilePendingOutbox().catch(() => {});
          }
        }
      } else {
        console.log(`[REFERRAL_STEP2_REWARD_DUPLICATE_BLOCKED] Concurrent Step 2 claim lock prevented for referral ${updatedReferral._id}`);
      }
    }
  } catch (err: any) {
    console.error("Error in evaluateReferralCallMilestone:", err.message);
  }
};

/**
 * Evaluates Referral Registration/Login Milestone:
 * For every 10 invited users who register and log in, the referrer receives 3 Diamonds!
 */
export const evaluateReferralLoginMilestone = async (referrerUserId: any, refereeUser: any) => {
  try {
    if (!referrerUserId) return;
    const referrer = await User.findById(referrerUserId);
    if (!referrer) return;

    const totalReferrals = Number(referrer.totalReferrals || 0);
    // Every 10 referrals milestone: 10, 20, 30, ...
    if (totalReferrals > 0 && totalReferrals % 10 === 0) {
      const milestoneDiamonds = 3;
      await User.findByIdAndUpdate(referrer._id, { $inc: { diamonds: milestoneDiamonds } });

      const txId = `REF_10MILESTONE_${referrer._id}_${totalReferrals}`;
      await RechargeHistory.create({
        userId: referrer.userId,
        type: RechargeType.REFERRAL_REGISTRATION_REWARD,
        diamonds: milestoneDiamonds,
        coins: 0,
        amount: 0,
        currency: 'DIAMOND',
        status: 'COMPLETED',
        productId: 'REFERRAL_10_USERS_MILESTONE',
        transactionId: txId,
        date: new Date(),
        processedAt: new Date(),
        rawGoogleData: {
          note: `🎉 10-User Referral Milestone: 3 Diamonds awarded for reaching ${totalReferrals} successful invites!`,
          totalReferrals,
          latestRefereeUserId: refereeUser?.userId,
        },
      }).catch((e: any) => console.warn('[MilestoneTx] Warning:', e.message));

      try {
        const { getIO, getUserRoom } = require('../sockets');
        const { sendCallNotification } = require('../utils/pushNotification');
        const io = getIO();
        if (io) {
          io.to(getUserRoom(String(referrer._id))).emit('referralReward:milestone', {
            diamonds: milestoneDiamonds,
            totalReferrals,
            message: `🎉 Congratulations! You invited ${totalReferrals} users to Yaro. You received 3 Diamonds!`,
          });
        }
        if (referrer.fcmToken) {
          await sendCallNotification(
            referrer.fcmToken,
            '🎉 3 Diamonds Milestone Reward!',
            `Congratulations! You invited ${totalReferrals} users to Yaro. 3 Diamonds have been added to your wallet!`,
            '',
            false
          ).catch(() => {});
        }
      } catch (notifErr: any) {
        console.warn('Milestone notification warning:', notifErr?.message);
      }
    }
  } catch (err: any) {
    console.error('Error in evaluateReferralLoginMilestone:', err.message);
  }
};

/**
 * Evaluates Referral Recharge Reward:
 * If an invited user recharges, their referrer receives 2 Diamonds!
 */
export const evaluateReferralRechargeReward = async (
  refereeUserIdOrDocId: any,
  rechargeAmount: number = 0,
  rechargeHistoryId?: any
) => {
  try {
    if (!refereeUserIdOrDocId) return;

    // Find referee user
    let referee = await User.findOne({
      $or: [
        { _id: typeof refereeUserIdOrDocId === 'string' && refereeUserIdOrDocId.length === 24 ? refereeUserIdOrDocId : null },
        { userId: Number(refereeUserIdOrDocId) || -1 },
      ],
    }).lean();

    if (!referee) return;

    // Find active referral record where referee is this user
    const referral = await Referral.findOne({ referee: referee._id });
    if (!referral) return;

    // Check if recharge diamond reward was already claimed for this referee
    if (referral.rechargeDiamonds && referral.rechargeDiamonds > 0) {
      return; // Already granted
    }

    const referrer = await User.findById(referral.referrer);
    if (!referrer) return;

    const rewardDiamonds = 2;
    await User.findByIdAndUpdate(referrer._id, { $inc: { diamonds: rewardDiamonds } });

    referral.rechargeDiamonds = rewardDiamonds;
    referral.step2Claimed = true;
    referral.step2ClaimedAt = new Date();
    referral.step2RewardStatus = 'COMPLETED';
    referral.status = 'COMPLETED';
    if (rechargeHistoryId) referral.firstRechargeId = rechargeHistoryId;
    await referral.save();

    const txId = `REF_RECHARGE_REWARD_${referee._id}`;
    await RechargeHistory.create({
      userId: referrer.userId,
      type: RechargeType.REFERRAL_REGISTRATION_REWARD,
      diamonds: rewardDiamonds,
      coins: 0,
      amount: 0,
      currency: 'DIAMOND',
      status: 'COMPLETED',
      productId: 'REFERRAL_RECHARGE_BONUS',
      transactionId: txId,
      date: new Date(),
      processedAt: new Date(),
      rawGoogleData: {
        note: `🎉 Referral Recharge Bonus: 2 Diamonds awarded because your invited friend (ID: ${referee.userId}) recharged!`,
        refereeUserId: referee.userId,
        rechargeAmount,
      },
    }).catch((e: any) => console.warn('[RechargeRewardTx] Warning:', e.message));

    try {
      const { getIO, getUserRoom } = require('../sockets');
      const { sendCallNotification } = require('../utils/pushNotification');
      const io = getIO();
      if (io) {
        io.to(getUserRoom(String(referrer._id))).emit('referralReward:recharge', {
          diamonds: rewardDiamonds,
          refereeUserId: referee.userId,
          message: `🎉 2 Diamonds Earned! Your invited friend (ID: ${referee.userId}) recharged. You received 2 Diamonds!`,
        });
      }
      if (referrer.fcmToken) {
        await sendCallNotification(
          referrer.fcmToken,
          '🎉 2 Diamonds Referral Recharge Reward!',
          `Your invited friend (ID: ${referee.userId}) recharged their account. 2 Diamonds have been added to your wallet!`,
          '',
          false
        ).catch(() => {});
      }
    } catch (notifErr: any) {
      console.warn('Recharge reward notification warning:', notifErr?.message);
    }
  } catch (err: any) {
    console.error('Error in evaluateReferralRechargeReward:', err.message);
  }
};
