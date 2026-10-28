import { Router } from 'express';
import { createHash, randomBytes } from 'crypto';
import * as XLSX from 'xlsx';
import { verifyToken, AuthRequest } from '../middlewares/authorize.middleware';
import { User } from '../models/user.model';
import { AuditLog } from '../models/auditLog.model';
import { atomic } from '../economy/service';
import { HostTeamTarget, TeamExport, TeamInvitation } from './models';
import { CHANNELS, csvCell, tsvCell, effectiveTeamRole, normalizeTeamRole, reportMonth, teamScope } from './rules';
import { assertTeamHost, teamReport } from './report';
import { readTeamInvitation, sendTeamInvitation, submitTeamInvitation } from './invitations';

const router = Router();
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
// Short-lived, capability-based snapshot for authorized report spreadsheets (.xlsx, .csv, .tsv)
router.get('/exports/:ticket', async (req, res) => {
  try {
    if (!/^[a-f0-9]{64}$/.test(req.params.ticket)) return res.sendStatus(404);
    const file = await TeamExport.findOne({ digest: hash(req.params.ticket), expiresAt: { $gt: new Date() } }).lean();
    if (!file) return res.sendStatus(404);
    const actor = await User.findById(file.actorId).lean();
    if (!actor || actor.isBlocked || actor.isDeleted || actor.role !== file.actorRole) return res.sendStatus(403);
    const stillVisible = await User.countDocuments({ $and: [teamScope(String(actor._id), effectiveTeamRole(actor)), { _id: { $in: file.hostIds } }] });
    if (stillVisible !== file.hostIds.length) return res.sendStatus(403);

    const format = String(req.query.format || '').toLowerCase();
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="yaro-team-targets-${file.month}.csv"`);
      return res.send('\uFEFF' + file.csv);
    }
    if (format === 'tsv') {
      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="yaro-team-targets-${file.month}.tsv"`);
      return res.send('\uFEFF' + (file.tsv || file.csv));
    }

    // Default to genuine .xlsx OpenXML workbook compatible with Google Sheets & Excel
    if (file.xlsxBase64) {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="yaro-team-targets-${file.month}.xlsx"`);
      return res.send(Buffer.from(file.xlsxBase64, 'base64'));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="yaro-team-targets-${file.month}.csv"`);
    return res.send('\uFEFF' + file.csv);
  } catch { return res.sendStatus(403); }
});
router.use(verifyToken);
router.use(async (req: AuthRequest, res, next) => {
  try {
    const principal = await User.findById(req.user!.id).lean();
    if (!principal || principal.isDeleted || principal.isBlocked) return res.sendStatus(403);
    (req as any).teamRole = effectiveTeamRole(principal);
    return next();
  } catch { return res.sendStatus(503); }
});
router.get('/report', async (req: AuthRequest, res) => {
  try {
    const data = await teamReport(String(req.user!.id), (req as any).teamRole, { month: String(req.query.month || '') || undefined,
      rootId: String(req.query.rootId || '') || undefined, role: String(req.query.role || '') || undefined,
      search: String(req.query.search || '').slice(0, 100), page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 30 });
    const { hosts, ...publicReport } = data;
    return res.json({ success: true, data: publicReport });
  } catch (e: any) { return res.status(403).json({ success: false, message: e.message }); }
});
router.put('/targets/:hostId', async (req: AuthRequest, res) => {
  try {
    const actor = req.user!; if (normalizeTeamRole((req as any).teamRole) === 'host') throw new Error('Managers assign targets');
    const { month: rawMonth, channels, revision = 0, reason } = req.body;
    const month = reportMonth(rawMonth).key;
    await assertTeamHost(String(actor.id), (req as any).teamRole, req.params.hostId);
    if (!Array.isArray(channels) || !channels.length || new Set(channels).size !== channels.length || channels.some(c => !CHANNELS.includes(c))) throw new Error('Choose voice, video and/or room hosting targets');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000 || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Target revision and change reason required');
    const update: Record<string, any> = { channels, updatedBy: actor.id };
    for (const c of CHANNELS) {
      const n = req.body[c];
      if (channels.includes(c) && (!Number.isSafeInteger(n) || n < 0 || n > 10000000000)) throw new Error(`${c} target must be integer Beans (0–10 billion)`);
      update[c] = channels.includes(c) ? n : undefined;
    }
    if (req.body.roomVolume != null && channels.includes('room')) {
      if (!Number.isSafeInteger(req.body.roomVolume) || req.body.roomVolume < 0 || req.body.roomVolume > 10000000000) throw new Error('Room gift-volume target must be integer Beans');
      update.roomVolume = req.body.roomVolume;
    }
    const data = await atomic(async session => {
      const previous = await HostTeamTarget.findOne({ hostId: req.params.hostId, month }).session(session);
      if ((previous?.revision || 0) !== revision) throw new Error('Target was updated; reload and retry');
      const unset: Record<string, string> = Object.fromEntries(CHANNELS.filter(c => !channels.includes(c)).map(c => [c, '']));
      if (!channels.includes('room') || req.body.roomVolume === null) unset.roomVolume = '';
      const clean = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined));
      const target = await HostTeamTarget.findOneAndUpdate({ hostId: req.params.hostId, month, ...(previous ? { revision } : {}) },
        { $set: clean, $unset: unset, $inc: { revision: 1 } }, { upsert: !previous, new: true, session });
      if (!target) throw new Error('Target update conflict');
      await AuditLog.create([{ adminId: actor.id, action: 'HOST_CHANNEL_TARGET_UPDATED', target: req.params.hostId,
        details: reason, oldValue: previous?.toObject(), newValue: target.toObject() }], { session });
      return target;
    });
    return res.json({ success: true, data });
  } catch (e: any) { return res.status(409).json({ success: false, message: e.message }); }
});
router.post('/invitations', async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await sendTeamInvitation(String(req.user!.id), Number(req.body.userId), req.body.role, req.body.requestKey) }); }
  catch (e: any) { return res.status(403).json({ success: false, message: e.message }); }
});
router.get('/invitations/:id', async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await readTeamInvitation(String(req.user!.id), req.params.id) }); }
  catch (e: any) { return res.status(404).json({ success: false, message: e.message }); }
});
router.post('/invitations/:id/submit', async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await submitTeamInvitation(String(req.user!.id), req.params.id, req.body) }); }
  catch (e: any) { return res.status(409).json({ success: false, message: e.message }); }
});
router.post('/invitations/:id/decline', async (req: AuthRequest, res) => {
  try {
    const invite = await TeamInvitation.findOneAndUpdate({ _id: req.params.id, recipientId: req.user!.id, state: 'pending' }, { $set: { state: 'declined' } }, { new: true });
    if (!invite) throw new Error('Pending invitation not found');
    return res.json({ success: true, data: { state: invite.state } });
  } catch (e: any) { return res.status(404).json({ success: false, message: e.message }); }
});
router.post('/exports', async (req: AuthRequest, res) => {
  try {
    const actor = req.user!;
    const report = await teamReport(String(actor.id), (req as any).teamRole, { month: req.body.month, rootId: req.body.rootId });
    const headers = [
      'Month',
      'Host YARO ID',
      'Host Name',
      'Active Channels',
      'Voice Target (Beans)',
      'Voice Earned (Beans)',
      'Voice Pending (Beans)',
      'Voice Progress %',
      'Voice Status',
      'Video Target (Beans)',
      'Video Earned (Beans)',
      'Video Pending (Beans)',
      'Video Progress %',
      'Video Status',
      'Calls Combined Target (Beans)',
      'Calls Combined Earned (Beans)',
      'Calls Combined Pending (Beans)',
      'Calls Combined Progress %',
      'Room Target (Beans)',
      'Room Earned (Beans)',
      'Room Pending (Beans)',
      'Room Progress %',
      'Room Status',
      'Grand Total Target (Beans)',
      'Grand Total Earned (Beans)',
      'Grand Total Pending (Beans)',
      'Grand Total Progress %',
      'Room Gift Volume (Beans)',
      'Room Gift Volume Target (Beans)',
      'Room Gift Volume Pending (Beans)',
    ];

    const rows = report.hosts.map(h => {
      const voice = (h.channels as any).voice;
      const video = (h.channels as any).video;
      const room = (h.channels as any).room;

      const activeList: string[] = [];
      if (voice?.enabled) activeList.push('Voice');
      if (video?.enabled) activeList.push('Video');
      if (room?.enabled) activeList.push('Room');
      const activeChannelsStr = activeList.length ? activeList.join(', ') : 'None';

      const voiceTarget = voice?.enabled && voice?.target != null ? voice.target : 0;
      const voiceAchieved = voice?.achieved || 0;
      const voicePending = voice?.enabled && voice?.pending != null ? voice.pending : 0;
      const voicePercent = voiceTarget > 0 ? Math.min(100, Math.round((voiceAchieved / voiceTarget) * 100)) : (voiceAchieved > 0 ? 100 : 0);
      const voiceStatus = !voice?.enabled ? 'Disabled' : (voice?.target == null ? 'Unassigned' : 'Active');

      const videoTarget = video?.enabled && video?.target != null ? video.target : 0;
      const videoAchieved = video?.achieved || 0;
      const videoPending = video?.enabled && video?.pending != null ? video.pending : 0;
      const videoPercent = videoTarget > 0 ? Math.min(100, Math.round((videoAchieved / videoTarget) * 100)) : (videoAchieved > 0 ? 100 : 0);
      const videoStatus = !video?.enabled ? 'Disabled' : (video?.target == null ? 'Unassigned' : 'Active');

      const callsTarget = voiceTarget + videoTarget;
      const callsAchieved = voiceAchieved + videoAchieved;
      const callsPending = voicePending + videoPending;
      const callsPercent = callsTarget > 0 ? Math.min(100, Math.round((callsAchieved / callsTarget) * 100)) : (callsAchieved > 0 ? 100 : 0);

      const roomTarget = room?.enabled && room?.target != null ? room.target : 0;
      const roomAchieved = room?.achieved || 0;
      const roomPending = room?.enabled && room?.pending != null ? room.pending : 0;
      const roomPercent = roomTarget > 0 ? Math.min(100, Math.round((roomAchieved / roomTarget) * 100)) : (roomAchieved > 0 ? 100 : 0);
      const roomStatus = !room?.enabled ? 'Disabled' : (room?.target == null ? 'Unassigned' : 'Active');

      const grandTarget = voiceTarget + videoTarget + roomTarget;
      const grandAchieved = h.earnedBeans || (voiceAchieved + videoAchieved + roomAchieved);
      const grandPending = voicePending + videoPending + roomPending;
      const grandPercent = grandTarget > 0 ? Math.min(100, Math.round((grandAchieved / grandTarget) * 100)) : (grandAchieved > 0 ? 100 : 0);

      const roomVolAchieved = h.giftVolumeBeans || 0;
      const roomVolTarget = room?.enabled && h.roomVolume?.target != null ? h.roomVolume.target : 0;
      const roomVolPending = room?.enabled && h.roomVolume?.pending != null ? h.roomVolume.pending : 0;

      return [
        report.month,
        h.userId,
        h.name,
        activeChannelsStr,
        voiceTarget,
        voiceAchieved,
        voicePending,
        `${voicePercent}%`,
        voiceStatus,
        videoTarget,
        videoAchieved,
        videoPending,
        `${videoPercent}%`,
        videoStatus,
        callsTarget,
        callsAchieved,
        callsPending,
        `${callsPercent}%`,
        roomTarget,
        roomAchieved,
        roomPending,
        `${roomPercent}%`,
        roomStatus,
        grandTarget,
        grandAchieved,
        grandPending,
        `${grandPercent}%`,
        roomVolAchieved,
        roomVolTarget,
        roomVolPending,
      ];
    });

    const sVoice = (report.summary.channels as any).voice;
    const sVideo = (report.summary.channels as any).video;
    const sRoom = (report.summary.channels as any).room;

    const sVoiceTarget = sVoice?.target || 0;
    const sVoiceAchieved = sVoice?.achieved || 0;
    const sVoicePending = sVoice?.pending || 0;
    const sVoicePercent = sVoiceTarget > 0 ? Math.min(100, Math.round((sVoiceAchieved / sVoiceTarget) * 100)) : (sVoiceAchieved > 0 ? 100 : 0);

    const sVideoTarget = sVideo?.target || 0;
    const sVideoAchieved = sVideo?.achieved || 0;
    const sVideoPending = sVideo?.pending || 0;
    const sVideoPercent = sVideoTarget > 0 ? Math.min(100, Math.round((sVideoAchieved / sVideoTarget) * 100)) : (sVideoAchieved > 0 ? 100 : 0);

    const sCallsTarget = sVoiceTarget + sVideoTarget;
    const sCallsAchieved = sVoiceAchieved + sVideoAchieved;
    const sCallsPending = sVoicePending + sVideoPending;
    const sCallsPercent = sCallsTarget > 0 ? Math.min(100, Math.round((sCallsAchieved / sCallsTarget) * 100)) : (sCallsAchieved > 0 ? 100 : 0);

    const sRoomTarget = sRoom?.target || 0;
    const sRoomAchieved = sRoom?.achieved || 0;
    const sRoomPending = sRoom?.pending || 0;
    const sRoomPercent = sRoomTarget > 0 ? Math.min(100, Math.round((sRoomAchieved / sRoomTarget) * 100)) : (sRoomAchieved > 0 ? 100 : 0);

    const sGrandTarget = (report.summary as any).totalTarget ?? (sVoiceTarget + sVideoTarget + sRoomTarget);
    const sGrandAchieved = report.summary.earnedBeans || (sVoiceAchieved + sVideoAchieved + sRoomAchieved);
    const sGrandPending = (report.summary as any).totalPending ?? (sVoicePending + sVideoPending + sRoomPending);
    const sGrandPercent = sGrandTarget > 0 ? Math.min(100, Math.round((sGrandAchieved / sGrandTarget) * 100)) : (sGrandAchieved > 0 ? 100 : 0);

    const sRoomVolAchieved = report.summary.giftVolumeBeans || 0;
    const sRoomVolTarget = report.summary.roomVolume?.target || 0;
    const sRoomVolPending = report.summary.roomVolume?.pending || 0;

    rows.push([
      report.month,
      '',
      'ALL HOSTS TOTAL',
      'All Configured Channels',
      sVoiceTarget,
      sVoiceAchieved,
      sVoicePending,
      `${sVoicePercent}%`,
      'TOTAL',
      sVideoTarget,
      sVideoAchieved,
      sVideoPending,
      `${sVideoPercent}%`,
      'TOTAL',
      sCallsTarget,
      sCallsAchieved,
      sCallsPending,
      `${sCallsPercent}%`,
      sRoomTarget,
      sRoomAchieved,
      sRoomPending,
      `${sRoomPercent}%`,
      'TOTAL',
      sGrandTarget,
      sGrandAchieved,
      sGrandPending,
      `${sGrandPercent}%`,
      sRoomVolAchieved,
      sRoomVolTarget,
      sRoomVolPending,
    ]);

    const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const tsv = [headers, ...rows].map(row => row.map(tsvCell).join('\t')).join('\r\n');
    if (Buffer.byteLength(csv, 'utf8') > 15000000) throw new Error('Choose a smaller branch for export');

    // Create authentic .xlsx OpenXML Workbook for Google Sheets & Excel
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 10 }, { wch: 14 }, { wch: 22 }, { wch: 24 },
      { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 12 },
      { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 12 },
      { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 16 },
      { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 12 },
      { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 16 },
      { wch: 24 }, { wch: 24 }, { wch: 24 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Hosting Targets');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const xlsxBase64 = Buffer.from(xlsxBuffer).toString('base64');

    const ticket = randomBytes(32).toString('hex');
    await TeamExport.create({
      digest: hash(ticket),
      actorId: actor.id,
      actorRole: actor.role,
      month: report.month,
      hostIds: report.hosts.map(h => h.id),
      csv,
      tsv,
      xlsxBase64,
      expiresAt: new Date(Date.now() + 120000),
    });

    await AuditLog.create({
      adminId: actor.id,
      action: 'TEAM_TARGET_SHEET_EXPORTED',
      target: report.root.id,
      details: `Month ${report.month}; ${report.hosts.length} hosts; XLSX/CSV`,
    });

    return res.json({
      success: true,
      data: {
        ticket,
        downloadPath: `/api/team/exports/${ticket}?format=xlsx`,
        xlsxDownloadPath: `/api/team/exports/${ticket}?format=xlsx`,
        csvDownloadPath: `/api/team/exports/${ticket}?format=csv`,
        tsvDownloadPath: `/api/team/exports/${ticket}?format=tsv`,
        filename: `yaro-team-targets-${report.month}.xlsx`,
        csvFilename: `yaro-team-targets-${report.month}.csv`,
        tsv,
        csv,
        googleSheetsUrl: 'https://sheets.new',
        expiresInSeconds: 120,
      },
    });
  } catch (e: any) {
    return res.status(403).json({ success: false, message: e.message });
  }
});
export default router;
