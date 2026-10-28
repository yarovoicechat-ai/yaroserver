import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { User } from '../models/user.model';
import Notification from '../models/notification.model';
import { CoinsTransaction } from '../models/spentCoinModel';
import { GiftTransaction } from '../gift/gift.model';
import { RecruitmentApplication } from '../models/recruitmentApplication.model';
import { Request as RequestModel } from '../models/request.model';
import { AuditLog } from '../models/auditLog.model';
import { HostTeamTarget, TeamInvitation } from '../team/models';
import { effectiveTeamRole, reportMonth } from '../team/rules';
import { teamReport } from '../team/report';
import { readTeamInvitation, sendTeamInvitation, submitTeamInvitation } from '../team/invitations';
import { invitationSponsor } from '../team/approval';

const uri = process.env.ECONOMY_TEST_URI;
test('real replica-set team reporting, independent hosting targets, isolation and invitation approval binding', { skip: !uri && 'Set local ECONOMY_TEST_URI' }, async () => {
  const parsed = new URL(uri!);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/yaro_economy_test') throw new Error('Only an isolated local test database is allowed');
  await mongoose.connect(uri!);
  const ids = Array.from({ length: 11 }, () => new mongoose.Types.ObjectId());
  const [owner, operator, sa, admin, leader, bd, agency, voice, dual, foreign, recipient] = ids;
  const seed = Date.now(), month = reportMonth().key;
  const base = { ownerId: owner, operatorId: operator, superAdminId: sa, adminId: admin, bdLeaderId: leader, bdId: bd, agencyId: agency };
  const make = (index: number, role: string, extra: any = {}) => ({ _id: ids[index], userId: seed + index, name: `Team fixture ${role} ${index}`, role, isDeleted: false, isBlocked: false, diamonds: 1000, coins: 0, ...extra });
  const callIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()], giftId = new mongoose.Types.ObjectId();
  try {
    await Promise.all([User.init(), HostTeamTarget.init(), TeamInvitation.init(), RecruitmentApplication.init(), RequestModel.init(), Notification.init(), AuditLog.init(), CoinsTransaction.init(), GiftTransaction.init()]);
    await User.collection.insertMany([
      make(0, 'owner'), make(1, 'operator', { ownerId: owner }), make(2, 'superAdmin', { ownerId: owner, operatorId: operator }),
      make(3, 'admin', { ownerId: owner, operatorId: operator, superAdminId: sa }),
      make(4, 'bdLeader', { ownerId: owner, operatorId: operator, superAdminId: sa, adminId: admin }),
      make(5, 'user', { ...base, bdId: undefined, agencyId: undefined, hasAppOption: true, hasAppAccess: true, appRole: 'bd', isBD: true }),
      make(6, 'agency', { ...base, agencyId: undefined }), make(7, 'host', { ...base, hostTypes: ['voice'] }),
      make(8, 'host', { ...base, hostTypes: ['video', 'room'] }), make(9, 'agency'), make(10, 'user'),
    ]);
    await CoinsTransaction.collection.insertMany([
      { _id: callIds[0], userId: recipient, hostId: voice, type: 'voice_call', status: 'ended', hostEarning: 300, createdAt: new Date(), meta: { isVideo: false } },
      { _id: callIds[1], userId: recipient, hostId: dual, type: 'voice_call', status: 'ended', hostEarning: 500, createdAt: new Date(), meta: { callType: 'video' } },
    ]);
    await GiftTransaction.collection.insertOne({ _id: giftId, requestId: `team-fixture-${seed}`, senderId: recipient, receiverId: dual,
      receiverIds: [dual], roomId: 'team-fixture-room', giftId: new mongoose.Types.ObjectId(), hostEarning: 700, totalDiamonds: 100, totalPrice: 100, status: 'SUCCESS', createdAt: new Date() });
    await HostTeamTarget.create([{ hostId: voice, month, channels: ['voice'], voice: 1000 }, { hostId: dual, month, channels: ['video', 'room'], video: 1000, room: 10000 }]);
    const report = await teamReport(String(operator), 'operator', { month });
    assert.equal(report.counts.superAdmin, 1); assert.equal(report.counts.bdLeader, 1); assert.equal(report.counts.bd, 1);
    assert.equal(report.summary.hostCount, 2); assert.equal(report.summary.earnedBeans, 1500);
    assert.equal(report.summary.channels.voice.achieved, 300); assert.equal(report.summary.channels.voice.pending, 700);
    assert.equal(report.summary.channels.video.achieved, 500); assert.equal(report.summary.channels.video.pending, 500);
    assert.equal(report.summary.channels.room.achieved, 700); assert.equal(report.summary.channels.room.pending, 9300);
    assert.equal(report.hosts.find(h => h.id === String(voice))!.channels.room.enabled, false);
    assert.equal(report.hosts.find(h => h.id === String(dual))!.channels.voice.enabled, false);
    await assert.rejects(teamReport(String(operator), 'operator', { rootId: String(foreign), month }), /outside your team/);
    const bdUser = await User.findById(bd).lean(); assert.equal(effectiveTeamRole(bdUser), 'bd');
    assert.equal((await teamReport(String(bd), 'bd', { month })).summary.hostCount, 2);
    const invite = await sendTeamInvitation(String(bd), seed + 10, 'host', `fixture_${seed}`);
    await sendTeamInvitation(String(bd), seed + 10, 'host', `fixture_${seed}`);
    assert.equal(await Notification.countDocuments({ userId: recipient, 'data.invitationId': String(invite._id) }), 1);
    await assert.rejects(readTeamInvitation(String(foreign), String(invite._id)), /not found/);
    const submission = await submitTeamInvitation(String(recipient), String(invite._id), { name: 'Self applicant', email: 'team-fixture@example.invalid', phone: '+919876543210', hostTypes: ['voice', 'room'], ownerId: foreign, role: 'owner', password: 'ignored' });
    assert.equal(submission.state, 'submitted');
    assert.equal((await User.findById(recipient).lean())!.role, 'user');
    const request = await RequestModel.findById(submission.requestId).lean();
    assert.equal(String(request!.data.bdId), String(bd)); assert.equal(String(request!.data.ownerId), String(owner));
    assert.equal(request!.data.password, undefined); assert.equal(request!.status, 'pending');
    const sponsor = await invitationSponsor(request); assert.equal(String(sponsor!._id), String(bd)); assert.equal(sponsor!.role, 'bd');
    await assert.rejects(invitationSponsor({ ...request, _id: new mongoose.Types.ObjectId() }), /binding is invalid/);
    await submitTeamInvitation(String(recipient), String(invite._id), { name: 'Self applicant', email: 'team-fixture@example.invalid', phone: '+919876543210', hostTypes: ['voice', 'room'] });
    assert.equal(await RecruitmentApplication.countDocuments({ 'applicant.userId': seed + 10 }), 1);
  } finally {
    await HostTeamTarget.deleteMany({ hostId: { $in: ids } }); await TeamInvitation.deleteMany({ inviterId: { $in: ids } });
    await Notification.deleteMany({ userId: { $in: ids } }); await AuditLog.deleteMany({ adminId: { $in: ids } });
    await RecruitmentApplication.deleteMany({ 'applicant.userId': seed + 10 }); await RequestModel.deleteMany({ generatedUserId: seed + 10 });
    await CoinsTransaction.deleteMany({ _id: { $in: callIds } }); await GiftTransaction.deleteMany({ _id: giftId });
    await User.deleteMany({ _id: { $in: ids } }); await mongoose.disconnect();
  }
});
