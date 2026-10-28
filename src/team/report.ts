import { Types } from 'mongoose';
import { User } from '../models/user.model';
import { CoinsTransaction } from '../models/spentCoinModel';
import { GiftTransaction } from '../gift/gift.model';
import { EconomyJournal } from '../economy/models';
import { HostTeamTarget } from './models';
import { CHANNELS, Channel, effectiveTeamRole, hostChannels, normalizeTeamRole, progress, reportMonth, scopeFields, TEAM_ROLES, teamScope } from './rules';
import { integer } from '../economy/rules';

const fields = 'appRole hasAppOption hasAppAccess isAgency isAgencyOwner isBD isBd isBdLeader isApprovedHost isHostApproved _id userId name image role employeeCode parentId parentUserId hierarchyPath ownerId operatorId superAdminId adminId bdLeaderId bdId agencyId hostTypes canVoiceCall canVideoCall isActive status';
export async function scopedTeam(actorId: string, role: string) {
  const users = await User.find(teamScope(actorId, role)).select(fields).limit(20001).lean();
  if (users.length > 20000) throw new Error('Choose a smaller branch for this report (maximum 20,000 team records)');
  return users.map(u => ({ ...u, role: effectiveTeamRole(u) })).filter(u => TEAM_ROLES.includes(u.role as any));
}
export async function assertTeamHost(actorId: string, role: string, hostId: string) {
  if (!Types.ObjectId.isValid(hostId)) throw new Error('Invalid host ID');
  const host = await User.findOne({ $and: [teamScope(actorId, role), { _id: hostId }] }).select(fields).lean();
  if (!host || effectiveTeamRole(host) !== 'host') throw new Error('Host is outside your team');
  return host;
}
type Metrics = Record<Channel, number> & { giftVolumeBeans: number };
export async function hostProduction(hostIds: string[], month: string): Promise<Map<string, Metrics>> {
  const range = reportMonth(month), map = new Map(hostIds.map(id => [id, { voice: 0, video: 0, room: 0, giftVolumeBeans: 0 }]));
  if (!hostIds.length) return map;
  const add = (id: string, channel: keyof Metrics, n: number) => {
    if (!Number.isSafeInteger(n)) throw new Error('A noninteger historical Beans record needs reconciliation');
    const entry = map.get(id); if (!entry) return;
    const next = entry[channel] + n;
    if (!Number.isSafeInteger(next)) throw new Error('Report integer overflow');
    entry[channel] = next;
  };
  const ids = hostIds.map(id => new Types.ObjectId(id));
  const calls = await CoinsTransaction.aggregate([
    { $match: { hostId: { $in: ids }, type: 'voice_call', status: 'ended', createdAt: { $gte: range.from, $lt: range.to }, 'meta.economyVersion': { $in: [null, ''] } } },
    { $group: { _id: { host: '$hostId', video: { $or: [{ $eq: ['$meta.isVideo', true] }, { $eq: ['$meta.callType', 'video'] }] } }, beans: { $sum: '$hostEarning' } } },
  ]);
  for (const row of calls) add(String(row._id.host), row._id.video === true ? 'video' : 'voice', row.beans || 0);
  // Room gifts only: in-call gifts, salary and recruitment bonuses do not complete a room target.
  for await (const gift of GiftTransaction.find({ $or: [{ receiverIds: { $in: ids } }, { receiverId: { $in: ids } }], status: { $in: ['SUCCESS', 'COMPLETED'] },
    roomId: { $type: 'string', $ne: '' }, 'meta.economyVersion': { $in: [null, ''] }, createdAt: { $gte: range.from, $lt: range.to } })
    .select('receiverId receiverIds hostEarning totalDiamonds totalPrice').lean().cursor()) {
    const receivers = [...new Set((gift.receiverIds?.length ? gift.receiverIds : [gift.receiverId]).filter(Boolean).map(String))];
    for (const id of receivers) {
      add(id, 'room', (gift.hostEarning || 0) / receivers.length);
      // Display/reference volume only. It is never credited to a wallet or used as earned Beans.
      add(id, 'giftVolumeBeans', Math.round((gift.totalDiamonds || gift.totalPrice || 0) * 100 / receivers.length));
    }
  }
  const accountPattern = new RegExp(`^user:(${hostIds.join('|')}):earned:`);
  for await (const entry of EconomyJournal.find({ createdAt: { $gte: range.from, $lt: range.to },
    kind: { $in: ['CALL_MINUTE', 'ROOM_GIFT', 'REVERSAL'] }, 'postings.account': accountPattern }).select('kind metadata postings result').lean().cursor()) {
    let original: any = entry;
    const reversed = entry.kind === 'REVERSAL';
    if (reversed) original = await EconomyJournal.findOne({ key: entry.metadata.key }).select('kind metadata result').lean();
    if (!original) throw new Error('Reversal source is missing');
    const channel: Channel = original.kind === 'CALL_MINUTE' ? (original.metadata.video ? 'video' : 'voice') : 'room';
    for (const p of entry.postings) {
      const match = /^user:([a-f\d]{24}):earned:/.exec(p.account);
      if (p.asset === 'BEAN' && match) add(match[1], channel, p.delta);
    }
    if (original.kind === 'ROOM_GIFT') for (const a of original.result.allocations) add(String(a.host), 'giftVolumeBeans', (reversed ? -1 : 1) * a.baseBeans);
  }
  return map;
}
export async function teamReport(actorId: string, role: string, query: { month?: string; rootId?: string; role?: string; page?: number; limit?: number; search?: string }) {
  const month = reportMonth(query.month).key, users = await scopedTeam(actorId, role);
  const byId = new Map(users.map(u => [String(u._id), u]));
  const rootId = query.rootId || actorId;
  const root = byId.get(rootId);
  if (!root) throw new Error('Selected branch is outside your team');
  const rootRole = normalizeTeamRole(root.role);
  const ancestors = (user: any) => {
    const found = new Set<string>(), pending = [String(user._id)];
    while (pending.length) {
      const id = pending.pop()!; if (found.has(id)) continue; found.add(id);
      const node = byId.get(id); if (!node) continue;
      const parents = [
        node.parentId,
        node.parentUserId,
        node.referredBy,
        node.referrerId,
        ...(rootRole === 'owner' ? [node.ownerId] : []),
        ...Object.values(scopeFields).map(f => (node as any)[f]),
        ...String(node.hierarchyPath || '').split('/')
      ];
      for (const p of parents) if (p && byId.has(String(p)) && !found.has(String(p))) pending.push(String(p));
    }
    return found;
  };
  const tree = new Map(users.map(u => [String(u._id), ancestors(u)]));
  const branch = users.filter(u => (rootRole === 'owner' || tree.get(String(u._id))!.has(rootId)) && (u.role !== 'owner' || String(u._id) === rootId));
  const hosts = branch.filter(u => u.role === 'host'), hostIds = hosts.map(h => String(h._id));
  const [production, targets] = await Promise.all([hostProduction(hostIds, month), HostTeamTarget.find({ hostId: { $in: hostIds }, month }).lean()]);
  const targetMap = new Map(targets.map(t => [String(t.hostId), t]));
  const hostRows = hosts.map(host => {
    const id = String(host._id), target = targetMap.get(id), metrics = production.get(id)!;
    const enabled = target ? target.channels : hostChannels(host);
    const channels = Object.fromEntries(CHANNELS.map(channel => [channel, { enabled: enabled.includes(channel), ...progress(metrics[channel], enabled.includes(channel) ? target?.[channel] : undefined) }]));
    const totalTarget = enabled.reduce((acc: number, c: Channel) => acc + (target?.[c] ?? 0), 0);
    const totalPending = enabled.reduce((acc: number, c: Channel) => acc + ((channels as any)[c]?.pending ?? 0), 0);
    const totalCalls = {
      achieved: metrics.voice + metrics.video,
      target: (enabled.includes('voice') ? (target?.voice ?? 0) : 0) + (enabled.includes('video') ? (target?.video ?? 0) : 0),
      pending: (enabled.includes('voice') ? ((channels as any).voice?.pending ?? 0) : 0) + (enabled.includes('video') ? ((channels as any).video?.pending ?? 0) : 0),
    };
    return { id, name: host.name, userId: host.userId, role: 'host', channels, targetRevision: target?.revision || 0,
      earnedBeans: metrics.voice + metrics.video + metrics.room, totalTarget, totalPending, totalCalls, giftVolumeBeans: metrics.giftVolumeBeans,
      roomVolume: progress(metrics.giftVolumeBeans, enabled.includes('room') ? target?.roomVolume : undefined) };
  });
  const summary = (list: typeof hostRows) => {
    let totalTarget = 0, totalPending = 0;
    const channelsSummary = Object.fromEntries(CHANNELS.map(channel => {
      let achieved = 0, target = 0, pending = 0, configuredHosts = 0;
      for (const h of list) {
        const p: any = h.channels[channel]; achieved += p.achieved;
        if (p.enabled && p.target !== null) { target += p.target; pending += p.pending; configuredHosts++; }
      }
      totalTarget += target;
      totalPending += pending;
      return [channel, { achieved, target, pending, configuredHosts, unassignedHosts: list.filter(h => (h.channels[channel] as any).enabled).length - configuredHosts }];
    }));
    const voiceSummary = (channelsSummary as any).voice;
    const videoSummary = (channelsSummary as any).video;
    const totalCalls = {
      achieved: (voiceSummary?.achieved || 0) + (videoSummary?.achieved || 0),
      target: (voiceSummary?.target || 0) + (videoSummary?.target || 0),
      pending: (voiceSummary?.pending || 0) + (videoSummary?.pending || 0),
    };
    return {
      hostCount: list.length,
      earnedBeans: list.reduce((n, h) => n + h.earnedBeans, 0),
      totalTarget,
      totalPending,
      totalCalls,
      giftVolumeBeans: list.reduce((n, h) => n + h.giftVolumeBeans, 0),
      roomVolume: { achieved: list.reduce((n, h) => n + h.giftVolumeBeans, 0), target: list.reduce((n, h) => n + (h.roomVolume.target || 0), 0), pending: list.reduce((n, h) => n + (h.roomVolume.pending || 0), 0) },
      channels: channelsSummary as Record<Channel, any>
    };
  };
  const counts = Object.fromEntries(TEAM_ROLES.map(r => [r, branch.filter(u => normalizeTeamRole(u.role) === r && String(u._id) !== rootId).length]));
  const defaultSubordinateRole = !query.role
    ? (rootRole === 'bd' ? 'agency' : rootRole === 'agency' ? 'host' : undefined)
    : undefined;
  const effectiveRoleFilter = query.role || defaultSubordinateRole;
  let members = branch.filter(u => String(u._id) !== rootId && (!effectiveRoleFilter || normalizeTeamRole(u.role) === effectiveRoleFilter));
  if (query.search) { const text = query.search.toLowerCase(); members = members.filter(u => `${u.name} ${u.userId} ${u.employeeCode || ''}`.toLowerCase().includes(text)); }
  const page = Math.max(1, query.page || 1), limit = Math.max(1, Math.min(100, query.limit || 30));
  const rows = members.slice((page - 1) * limit, page * limit).map(member => {
    const id = String(member._id), host = hostRows.find(h => h.id === id);
    return host || { id, name: member.name, userId: member.userId, role: normalizeTeamRole(member.role), ...summary(hostRows.filter(h => tree.get(h.id)!.has(id))) };
  });

  const breadcrumbs: { id: string; name: string; role: string; userId?: number }[] = [];
  let currNode: any = root;
  const visitedBreadcrumbs = new Set<string>();
  while (currNode && !visitedBreadcrumbs.has(String(currNode._id))) {
    visitedBreadcrumbs.add(String(currNode._id));
    breadcrumbs.unshift({ id: String(currNode._id), name: currNode.name || String(currNode.userId), role: normalizeTeamRole(currNode.role), userId: currNode.userId });
    const parentId = currNode.parentId || currNode.parentUserId || currNode.agencyId || currNode.bdId || currNode.bdLeaderId || currNode.adminId || currNode.superAdminId || currNode.operatorId || currNode.ownerId;
    if (parentId && byId.has(String(parentId)) && String(parentId) !== String(currNode._id)) {
      currNode = byId.get(String(parentId));
    } else {
      break;
    }
  }

  return { month, root: { id: rootId, name: root.name, role: normalizeTeamRole(root.role), userId: root.userId }, breadcrumbs, counts, summary: summary(hostRows),
    members: rows, hosts: hostRows, pagination: { page, limit, total: members.length },
    basis: 'Host production earned Beans; voice, video and room remain separate. Current team membership, Asia/Calcutta month. Gift volume is a 100 Beans/Diamond reporting reference, not withdrawable earnings.' };
}
