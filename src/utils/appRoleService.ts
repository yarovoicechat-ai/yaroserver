import { User } from '../models/user.model';
import Host from '../models/host.model';
import { Logger } from './logger';

export const MANDATORY_YARO_ID_ROLES = ['bd', 'bdleader', 'bd-leader', 'agency', 'host'];

export const isYaroIdMandatoryRole = (role: string): boolean => {
  const norm = String(role || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['bd', 'bdleader', 'agency', 'host'].includes(norm);
};

export interface ApplyAppOptionOptions {
  enableAppAccess?: boolean;
}

/**
 * Unlocks in-app role features, dashboard tabs, and services for approved users
 */
export async function applyInAppRoleOption(
  user: any,
  role: string,
  options: ApplyAppOptionOptions = { enableAppAccess: true }
): Promise<any> {
  if (!user) return null;
  const norm = String(role || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const enable = options.enableAppAccess !== false;

  user.hasAppAccess = enable;
  user.hasAppOption = enable;
  user.appRole = role;
  user.appFeatures = user.appFeatures || {};

  if (!enable) {
    await user.save();
    return user;
  }

  if (norm === 'agency') {
    user.isAgency = true;
    user.isAgencyOwner = true;
    user.hasAgency = true;
    user.appFeatures.agencyPortal = true;
    user.appFeatures.agencyDashboard = true;
  } else if (norm === 'host') {
    user.isHost = true;
    user.isApprovedHost = true;
    user.isHostApproved = true;
    user.hostingApproved = true;
    user.hostStatus = 'approved';
    user.hostingStatus = 'approved';
    user.appFeatures.hostCenter = true;
    user.appFeatures.dataCenter = true;

    // Upsert Host record in Host collection
    try {
      const existingHost = await Host.findOne({
        $or: [
          { hostId: user.userId },
          { meethiId: user.meethiId || String(user.userId) },
          { emailId: user.email }
        ]
      });

      if (existingHost) {
        existingHost.isDeleted = false;
        existingHost.isApproved = true;
        await existingHost.save();
      } else {
        await Host.create({
          hostId: user.userId,
          fullName: user.name || 'Approved Host',
          meethiId: user.meethiId || String(user.userId),
          emailId: user.email,
          mobileNumber: user.phoneNumber,
          termsAccepted: true,
          isApproved: true,
          isDeleted: false,
        });
      }
    } catch (hostErr) {
      await Logger('applyInAppRoleOptionHostUpsert', hostErr);
    }
  } else if (norm === 'bd') {
    user.isBd = true;
    user.isBD = true;
    user.appFeatures.bdCenter = true;
    user.appFeatures.bdDashboard = true;
  } else if (norm === 'bdleader') {
    user.isBdLeader = true;
    user.isBd = true;
    user.isBD = true;
    user.appFeatures.bdCenter = true;
    user.appFeatures.bdLeaderPortal = true;
  }

  await user.save();
  return user;
}
