import express from 'express';
import {
  getEffectiveIdentity,
  getMyIdentity,
  searchUsersWithIdentity,
  getIdentityCatalog,
  grantOfficialId,
  revokeOfficialId,
  listOfficialIds,
  listUniqueIds,
  listUniqueIdLevels,
  createUniqueIdLevel,
  updateUniqueIdLevel,
  deleteUniqueIdLevel,
  grantUniqueId,
  revokeUniqueId,
  adjustUniqueIdValidity,
  removeUniqueId,
  updateUniqueIdDetails,
  listNameEffects,
  createNameEffect,
  updateNameEffect,
  deleteNameEffect,
  grantNameEffectToUser,
  listAssetLibrary,
  registerAsset,
  deleteAsset,
  listAllEntitlements,
  revokeEntitlement,
  extendEntitlement,
  getIdentityAuditLogs,
} from '../controllers/identityStudio.controller';
import { verifyToken, requireRoles } from '../middlewares/authorize.middleware';

const router = express.Router();

const adminRoles = requireRoles('owner', 'superAdmin', 'admin', 'operator');

/* =========================================================================
   PUBLIC / USER IDENTITY RESOLUTION
========================================================================= */

// Effective Identity for any user
router.get('/effective/:userId', getEffectiveIdentity);

// Effective Identity for authenticated self
router.get('/me', verifyToken, getMyIdentity);

// Identity-aware Search (supports numeric ID, username, active official ID)
router.get('/search', searchUsersWithIdentity);

// Public catalog of identity effects and VIP packages
router.get('/catalog', getIdentityCatalog);

/* =========================================================================
   ADMIN OFFICIAL ID MANAGEMENT
========================================================================= */

router.get('/admin/official-ids', verifyToken, adminRoles, listOfficialIds);
router.post('/admin/official-ids/grant', verifyToken, adminRoles, grantOfficialId);
router.post('/admin/official-ids/:userId/revoke', verifyToken, adminRoles, revokeOfficialId);
router.get('/admin/unique-ids', verifyToken, adminRoles, listUniqueIds);
router.get('/admin/unique-id-levels', verifyToken, adminRoles, listUniqueIdLevels);
router.post('/admin/unique-id-levels', verifyToken, adminRoles, createUniqueIdLevel);
router.put('/admin/unique-id-levels/:id', verifyToken, adminRoles, updateUniqueIdLevel);
router.patch('/admin/unique-id-levels/:id', verifyToken, adminRoles, updateUniqueIdLevel);
router.delete('/admin/unique-id-levels/:id', verifyToken, adminRoles, deleteUniqueIdLevel);
router.post('/admin/unique-ids/grant', verifyToken, adminRoles, grantUniqueId);
router.post('/admin/unique-ids/:userId/revoke', verifyToken, adminRoles, revokeUniqueId);
router.post('/admin/unique-ids/:userId/validity', verifyToken, adminRoles, adjustUniqueIdValidity);
router.delete('/admin/unique-ids/:userId/remove', verifyToken, adminRoles, removeUniqueId);
router.patch('/admin/unique-ids/:userId', verifyToken, adminRoles, updateUniqueIdDetails);

/* =========================================================================
   ADMIN ANIMATED NAME & COLOR EFFECTS
========================================================================= */

router.get('/admin/effects', verifyToken, adminRoles, listNameEffects);
router.post('/admin/effects', verifyToken, adminRoles, createNameEffect);
router.put('/admin/effects/:id', verifyToken, adminRoles, updateNameEffect);
router.patch('/admin/effects/:id', verifyToken, adminRoles, updateNameEffect);
router.delete('/admin/effects/:id', verifyToken, adminRoles, deleteNameEffect);
router.post('/admin/effects/grant', verifyToken, adminRoles, grantNameEffectToUser);

/* =========================================================================
   ADMIN ASSET LIBRARY
========================================================================= */

router.get('/admin/assets', verifyToken, adminRoles, listAssetLibrary);
router.post('/admin/assets', verifyToken, adminRoles, registerAsset);
router.delete('/admin/assets/:id', verifyToken, adminRoles, deleteAsset);

/* =========================================================================
   ADMIN USER ENTITLEMENTS MASTER DIRECTORY
========================================================================= */

router.get('/admin/entitlements', verifyToken, adminRoles, listAllEntitlements);
router.post('/admin/entitlements/:id/revoke', verifyToken, adminRoles, revokeEntitlement);
router.post('/admin/entitlements/:id/extend', verifyToken, adminRoles, extendEntitlement);

/* =========================================================================
   ADMIN AUDIT TRAIL
========================================================================= */

router.get('/admin/audit-logs', verifyToken, adminRoles, getIdentityAuditLogs);

export const identityStudioRouter = router;
