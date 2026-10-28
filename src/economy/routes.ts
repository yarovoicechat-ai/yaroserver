import { Router } from 'express';
import { verifyToken, requireRoles, AuthRequest } from '../middlewares/authorize.middleware';
import { EconomyAccount, EconomyRollout, EconomyVersion } from './models';
import { NEW_ECONOMY } from './rules';
import { availableAccount, atomic, changeRollout, createVersion, effectiveEconomy, getVersion, holdWithdrawal, reverseOperation, settleSalary } from './service';
import { reconciliationReport } from './reconciliation';
import { User } from '../models/user.model';
import { Withdrawal, WithdrawalMethod, WithdrawalStatus } from '../models/withdrawal.model';
import { VerificationSettings } from '../models/verification.model';

const router = Router();
router.use(verifyToken);
// No endpoint can mint earnings or convert purchased Diamonds into withdrawable Beans.
router.get('/wallet', async (req: AuthRequest, res) => {
  try {
    const accounts = await EconomyAccount.find({ key: new RegExp('^user:' + String(req.user!.id) + ':earned:') }).lean();
    const economy = await effectiveEconomy();
    const buckets = await Promise.all(accounts.map(async account => {
      const version = account.key.split(':').slice(-1)[0];
      const pinned = await getVersion(version);
      return { version, earnedBeans: account.balance, beansPerInr: pinned.rules.beansPerInr,
        feeBps: pinned.rules.withdrawal.feeBps, minimumPaise: pinned.rules.withdrawal.minimumPaise };
    }));
    return res.json({ success: true, data: { buckets, economyVersion: economy?.version || 'legacy', legacyBeansUnchanged: true } });
  } catch (e: any) { return res.status(503).json({ success: false, message: e.message }); }
});
router.post('/withdrawals', async (req: AuthRequest, res) => {
  try {
    const { beans, requestId, method, details: rawDetails, version } = req.body;
    if (![WithdrawalMethod.BANK, WithdrawalMethod.UPI].includes(method)) throw new Error('Invalid payout method');
    if (!rawDetails || typeof rawDetails !== 'object') throw new Error('Payout details required');
    const keys = method === WithdrawalMethod.UPI ? ['upiId'] : ['bankName', 'accountNumber', 'ifscCode', 'accountHolderName'];
    const details: Record<string, string> = {};
    for (const key of keys) {
      const value = rawDetails[key] ?? '';
      if (typeof value !== 'string' || value.length > 200) throw new Error('Invalid payout details');
      details[key] = value.trim();
    }
    if (method === WithdrawalMethod.UPI ? !details.upiId : !details.accountNumber || !details.ifscCode || !details.accountHolderName) throw new Error('Payout details required');
    const economy = await getVersion(version); // Accrued liabilities remain withdrawable after a prospective rollback.
    const data = await atomic(async session => {
      const user = await User.findById(req.user!.id).session(session);
      if (!user || user.isBlocked || user.isDeleted) throw new Error('Wallet unavailable');
      const gates = await VerificationSettings.findOne({ singletonKey: 'default' }).session(session).lean();
      if ((gates?.faceVerificationEnabled && gates.rolesRequiringFaceVerification?.includes(String(user.role)) && user.faceVerificationStatus !== 'APPROVED') ||
        (gates?.kycVerificationEnabled && gates.rolesRequiringKycVerification?.includes(String(user.role)) && user.kycVerificationStatus !== 'APPROVED')) throw new Error('Required verification is incomplete');
      const replay: any = await Withdrawal.findOne({ economyRequestKey: `${user._id}:${requestId}` }).session(session);
      if (replay) {
        if (replay.economyVersion !== version || replay.economyRequestedBeans !== beans || replay.method !== method || JSON.stringify(replay.details?.toObject?.() || replay.details) !== JSON.stringify(details)) throw new Error('Withdrawal idempotency conflict');
        return replay;
      }
      const quote = await holdWithdrawal(String(user._id), beans, requestId, economy, session);
      const [withdrawal] = await Withdrawal.create([{
        userId: user.userId, method, details, status: WithdrawalStatus.PENDING, amount: quote.netPaise / 100,
        grossAmount: quote.grossPaise / 100, platformFee: quote.feePaise / 100,
        platformFeePercent: economy.rules.withdrawal.feeBps / 100, coinsDeducted: quote.beansToHold,
        economyVersion: economy.version, economyRequestKey: `${user._id}:${requestId}`, economyRequestedBeans: beans,
        economyUserId: String(user._id), economyRequestId: requestId, economyQuote: quote,
      }], { session });
      return withdrawal;
    });
    return res.json({ success: true, data });
  } catch (e: any) { return res.status(400).json({ success: false, message: e.message }); }
});

router.use(requireRoles('owner'));
router.get('/settings', async (_req, res) => {
  try {
    const [versions, rollout] = await Promise.all([EconomyVersion.find({}).sort({ createdAt: -1 }).lean(), EconomyRollout.findOne({ key: 'economy' }).lean()]);
    return res.json({ success: true, data: { defaults: NEW_ECONOMY, versions, rollout: rollout || { enabled: false, revision: 0 },
      production: process.env.NODE_ENV === 'production', stagingAllowed: process.env.ECONOMY_V2_STAGING === 'true' } });
  } catch (e: any) { return res.status(500).json({ success: false, message: e.message }); }
});
router.post('/versions', async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await createVersion(req.body, String(req.user!.id)) }); }
  catch (e: any) { return res.status(400).json({ success: false, message: e.message }); }
});
router.post('/rollout', async (req: AuthRequest, res) => {
  try {
    const { version, enabled, revision, reason, releaseDecision } = req.body;
    if (typeof enabled !== 'boolean' || typeof reason !== 'string') throw new Error('Explicit boolean flag and reason required');
    return res.json({ success: true, data: await changeRollout(version, enabled, revision, String(req.user!.id), reason, releaseDecision) });
  } catch (e: any) { return res.status(409).json({ success: false, message: e.message }); }
});
router.get('/reconciliation', async (_req, res) => {
  try { return res.json({ success: true, data: await reconciliationReport() }); }
  catch (e: any) { return res.status(500).json({ success: false, message: e.message }); }
});
router.post('/salary/settle', async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await settleSalary(req.body.hostId, req.body.month, await getVersion(req.body.version), String(req.user!.id)) }); }
  catch (e: any) { return res.status(409).json({ success: false, message: e.message }); }
});
router.post('/reverse', async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await reverseOperation(req.body.key, String(req.user!.id), req.body.reason || '') }); }
  catch (e: any) { return res.status(409).json({ success: false, message: e.message }); }
});
export default router;
