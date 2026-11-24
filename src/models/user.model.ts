// user.model.ts
import mongoose, { Schema } from "mongoose";
import { UserInterface } from "../interfaces/user.interface";
import { AuthType, Gender, UserRole } from "../constants/user";
import { ACCOUNT_IDENTITY_INDEXES } from "../utils/accountScope";

const DeviceSchema = new Schema(
  {
    createdDeviceId: { type: String, required: true },
    currentDeviceId: { type: String, default: "" },
    loggedInDeviceIds: { type: [String], default: [] },
    ipAddress: { type: String, default: "" },
  },
  { _id: false }
);

const StoreInventoryItemSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: 'StoreItem' },
    name: { type: String, required: true },
    category: { type: String, required: true },
    durationDays: { type: Number },
    purchasedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date },
    imageUrl: { type: String, default: '' },
    animationUrl: { type: String, default: '' },
    source: { type: String, enum: ['store', 'level', 'admin_grant'], default: 'store' },
    grantKey: { type: String, default: '' },
    uniqueId: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
    message: { type: String, default: '' },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: true }
);

const userSchema = new Schema<UserInterface>(
  {
    userId: { type: Number, required: false, unique: true, sparse: true },
    accountType: { type: String, enum: ['regular', 'test', 'fake'], default: 'regular', index: true },
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phoneNumber: { type: String, trim: true },
    ipAddress: { type: String, default: "" },
    lastIp: { type: String, default: "" },
    gender: {
      type: String,
      enum: Object.values(Gender),
      required: true,
    },
    bio: { type: String, default: "" },
    hobbies: { type: [String], default: [] },
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },
    password: { type: String, select: false },
    role: { type: String, enum: Object.values(UserRole), default: UserRole.USER },
    authType: { type: String, enum: Object.values(AuthType), default: AuthType.PHONE },
    // In MongoDB database storage:
    // diamonds: Sole authoritative storage for Spending Currency (COINS)
    // coins: Sole authoritative storage for Creator Earnings (BEANS)
    coins: { type: Number, default: 0, min: 0 },
    diamonds: { type: Number, default: 5, min: 0 },
    image: { type: String, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    isDeleted: { type: Boolean, default: false },
    isFake: { type: Boolean, default: false, index: true },
    isMockUser: { type: Boolean, default: false, index: true },
    isTestAccount: { type: Boolean, default: false, index: true },
    hasVideoAccess: { type: Boolean, default: false, index: true },
    videoAccessGrantedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    videoAccessGrantedByName: { type: String, default: "" },
    videoAccessGrantedAt: { type: Date, default: null },
    isOnline: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false, index: true },
    banType: { type: String, enum: ['temporary', 'permanent', null], default: null },
    banReason: { type: String, default: "" },
    adminNote: { type: String, default: "" },
    bannedAt: { type: Date, default: null },
    bannedUntil: { type: Date, default: null, index: true },
    bannedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    bannedByName: { type: String, default: "" },
    banVersion: { type: Number, default: 0 },
    lastOnline: { type: Date },
    lastActiveAt: { type: Date, default: Date.now, index: true },
    device: { type: DeviceSchema, default: () => ({}) },
    googleId: { type: String, default: "" },
    language: { type: [String], default: [] },
    country: {
      name: { type: String, default: '' },
      code: { type: String, default: '' },
      flag: { type: String, default: '' },
    },
    age: { type: Number, min: 18, max: 120 },
    state: { type: String, default: "" },
    hiringScope: { country: String, state: String },
    frameId: { type: String, default: "" },
    equippedFrame: { type: String, default: null },
    equippedFrameAsset: { type: Schema.Types.Mixed, default: null },
    equippedEntry: { type: String, default: null },
    equippedEntryAsset: { type: Schema.Types.Mixed, default: null },
    equippedTassel: { type: String, default: null },
    equippedTasselAsset: { type: Schema.Types.Mixed, default: null },
    equippedEntrance: { type: String, default: null },
    equippedEntranceAsset: { type: Schema.Types.Mixed, default: null },
    equippedEntryEffect: { type: Schema.Types.ObjectId, ref: 'EntryEffect', default: null },
    equippedEntryTag: { type: String, default: "" },
    equippedBadge: { type: Schema.Types.Mixed, default: null },
    equippedBadgeAsset: { type: Schema.Types.Mixed, default: null },
    equippedBadges: { type: [Schema.Types.Mixed], default: [] },
    equippedTag: { type: String, default: null },
    equippedTagAsset: { type: Schema.Types.Mixed, default: null },
    ownedEntryEffects: [{ type: Schema.Types.ObjectId, ref: 'EntryEffect' }],
    equippedVipId: { type: String, default: null },
    equippedVipExpiresAt: { type: Date, default: null },
    ownedVipIds: [{ type: String, default: [] }],
    equippedSvipId: { type: String, default: null },
    equippedSvipExpiresAt: { type: Date, default: null },
    isSvip: { type: Boolean, default: false },
    svipLevel: { type: Number, default: 0 },
    ownedSvipIds: [{ type: String, default: [] }],
    equippedChatBubble: { type: String, default: null },
    equippedChatBubbleAsset: { type: Schema.Types.Mixed, default: null },
    equippedMicWave: { type: String, default: null },
    equippedRoomTheme: { type: String, default: null },
    equippedEntryFrame: { type: String, default: null },
    blockedUsers: [{ type: Schema.Types.ObjectId, ref: "User" }],
    followers: [{ type: Schema.Types.ObjectId, ref: "User" }],
    following: [{ type: Schema.Types.ObjectId, ref: "User" }],
    followersCount: { type: Number, default: 0, min: 0 },
    followingCount: { type: Number, default: 0, min: 0 },
    visitorsCount: { type: Number, default: 0, min: 0 },
    refreshToken: { type: String, select: false },
    activeToken: { type: String, default: "" },
    fcmToken: { type: String, default: "" },
    audio: { type: String, default: "" },
    isUserName: { type: Boolean, default: false },
    userName: { type: String, trim: true, unique: true, sparse: true },
    isGlobalRoomManager: { type: Boolean, default: false, index: true },
    officialPowers: {
      canBanRoom: { type: Boolean, default: false },
      canBanUser: { type: Boolean, default: false },
      canGhostEntry: { type: Boolean, default: false },
      canKickAnyUser: { type: Boolean, default: false },
      canMuteAnyUser: { type: Boolean, default: false },
      canLockAnySeat: { type: Boolean, default: false },
      isGlobalRoomManager: { type: Boolean, default: false },
    },
    isAgency: { type: Boolean, default: false },
    isBd: { type: Boolean, default: false },
    canPrivateLive: { type: Boolean, default: false },
    canWatchTogether: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false },
    isBusy: { type: Boolean, default: false },
    recruitmentRevision: { type: Number, default: 0 },
    hostTypes: { type: [String], default: [] },
    canVoiceCall: { type: Boolean, default: false },
    canVideoCall: { type: Boolean, default: false },
    canRoomHost: { type: Boolean, default: true },
    meethiId: { type: String, default: "" },
    level: { type: Number, default: 1 },
    wealthExp: { type: Number, default: 0, index: true },
    wealthLevel: { type: Number, default: 1, index: true },
    charmExp: { type: Number, default: 0, index: true },
    charmLevel: { type: Number, default: 1, index: true },
    claimedLevelRewards: { type: [String], default: [] },
    equippedVehicle: { type: String, default: null },
    equippedVehicleAsset: { type: Schema.Types.Mixed, default: null },
    equippedCustomId: { type: String, default: null },
    customDisplayId: { type: String, default: null },
    uniqueId: { type: String, default: null },
    displayId: { type: String, default: null },
    equippedProfileBorder: { type: String, default: null },
    equippedProfileBorderAsset: { type: Schema.Types.Mixed, default: null },
    employeeCode: { type: String, unique: true, sparse: true },
    parentId: { type: Schema.Types.ObjectId, ref: "User" },
    referredBy: { type: Schema.Types.ObjectId, ref: "User" },
    documents: { type: [String], default: [] },
    sourceForm: { type: String, default: "" },
    parentRole: { type: String },
    createdByRole: { type: String },
    ownerId: { type: Schema.Types.ObjectId, ref: "User" },
    operatorId: { type: Schema.Types.ObjectId, ref: "User" },
    countryManagerId: { type: Schema.Types.ObjectId, ref: "User" },
    stateManagerId: { type: Schema.Types.ObjectId, ref: "User" },
    superAdminId: { type: Schema.Types.ObjectId, ref: "User" },
    adminId: { type: Schema.Types.ObjectId, ref: "User" },
    agencyId: { type: Schema.Types.ObjectId, ref: "User" },
    bdLeaderId: { type: Schema.Types.ObjectId, ref: "User" },
    bdId: { type: Schema.Types.ObjectId, ref: "User" },
    specialCode: { type: String, unique: true, sparse: true },
    orgId: { type: Schema.Types.ObjectId, ref: "Organization" },
    branchId: { type: Schema.Types.ObjectId, ref: "BranchRegion" },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department" },
    teamId: { type: Schema.Types.ObjectId, ref: "Team" },
    mustChangePassword: { type: Boolean, default: false },
    loginUrl: { type: String, default: '' },
    lastLogin: { type: Date },
    emsRequestId: { type: Schema.Types.ObjectId, ref: 'Request' },
    status: { type: String, enum: ['Active', 'Inactive', 'Blocked', 'Deleted'], default: 'Active' },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date },
    deleteReason: { type: String, default: '' },
    referralCode: { type: String, uppercase: true, trim: true },
    referralLink: { type: String, default: '' },
    referrerId: { type: String, default: '' },
    referrerRole: { type: String, default: '' },
    referrerCode: { type: String, uppercase: true, trim: true, default: '' },
    totalReferrals: { type: Number, default: 0 },
    activeReferrals: { type: Number, default: 0 },
    pendingReferrals: { type: Number, default: 0 },
    approvedReferrals: { type: Number, default: 0 },
    rejectedReferrals: { type: Number, default: 0 },
    monthlyReferrals: { type: Number, default: 0 },
    todayReferrals: { type: Number, default: 0 },
    lastReferralAt: { type: Date },
    parentUserId: { type: String, default: '' },
    rootReferralId: { type: String, default: '' },
    hierarchyPath: { type: String, default: '' },
    referralOwnerId: { type: String, default: '', index: true },
    referralOwnerRole: { type: String, default: '' },
    rootOwnerId: { type: Schema.Types.ObjectId, ref: 'User' },
    rootOperatorId: { type: Schema.Types.ObjectId, ref: 'User' },
    networkId: { type: String, default: '' },
    treeDepth: { type: Number, default: 0 },
    createdFromReferral: { type: Boolean, default: false },
    isRootNode: { type: Boolean, default: false },
    childrenCount: { type: Number, default: 0 },
    activeChildren: { type: Number, default: 0 },
    pendingChildren: { type: Number, default: 0 },
    approvedChildren: { type: Number, default: 0 },
    totalNetworkUsers: { type: Number, default: 0 },
    lastHierarchyUpdate: { type: Date },
    faceVerificationStatus: {
      type: String, enum: ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'],
      default: 'NOT_SUBMITTED', index: true,
    },
    isProfileVerified: { type: Boolean, default: false, index: true },
    verifiedTitle: { type: String, default: '', trim: true, maxlength: 60 },
    kycVerificationStatus: {
      type: String, enum: ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'],
      default: 'NOT_SUBMITTED', index: true,
    },
    faceVerifiedAt: { type: Date },
    kycVerifiedAt: { type: Date },
    profileCompleted: { type: Boolean, default: false, index: true },
    welcomeRewardClaimed: { type: Boolean, default: false },
    referralClaimed: { type: Boolean, default: false },
    chatMuteUntil: { type: Date, index: true },
    chatMuteReason: { type: String, default: "" },
    chatMuteViolationCount: { type: Number, default: 0 },
    accountReviewRequired: { type: Boolean, default: false, index: true },
    accountReviewReason: { type: String, default: "" },
    lastEscalationAction: { type: String, default: "NONE" },
    lastEscalatedAt: { type: Date },
    moderationRiskScore: { type: Number, default: 0, index: true },
    moderationRiskLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "LOW",
      index: true,
    },
    moderationLastViolationAt: { type: Date },
    storeInventory: { type: [StoreInventoryItemSchema], default: [] },
    levelRewardClaims: { type: [String], default: [], select: false },
    lastLoginIp: { type: String, default: "" },
    deviceId: { type: String, default: "" },
    isHost: { type: Boolean, default: false, index: true },
    hostStatus: { type: String, default: "" },
    isApprovedHost: { type: Boolean, default: false },
    isHostApproved: { type: Boolean, default: false },
    hostingApproved: { type: Boolean, default: false },
    isAgencyOwner: { type: Boolean, default: false },
    hasAgency: { type: Boolean, default: false },
    isBD: { type: Boolean, default: false },
    isBdLeader: { type: Boolean, default: false, index: true },
    hasAppOption: { type: Boolean, default: false, index: true },
    hasAppAccess: { type: Boolean, default: false, index: true },
    appRole: { type: String, default: "" },
    appFeatures: { type: Object, default: {} },
    yaroId: { type: String, default: "", index: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc: any, ret: any) => {
        // Authoritative mapping for API consumers:
        // coins = spending currency (doc.diamonds)
        // beans = creator earnings (doc.coins)
        // diamonds = spending currency (doc.diamonds) for backward compatibility
        const spending = typeof doc.diamonds === 'number' ? doc.diamonds : (typeof ret.diamonds === 'number' ? ret.diamonds : 0);
        const earnings = typeof doc.coins === 'number' ? doc.coins : (typeof ret.coins === 'number' ? ret.coins : 0);
        ret.coins = spending;
        ret.beans = earnings;
        ret.diamonds = spending;
        delete ret.password;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc: any, ret: any) => {
        const spending = typeof doc.diamonds === 'number' ? doc.diamonds : (typeof ret.diamonds === 'number' ? ret.diamonds : 0);
        const earnings = typeof doc.coins === 'number' ? doc.coins : (typeof ret.coins === 'number' ? ret.coins : 0);
        ret.coins = spending;
        ret.beans = earnings;
        ret.diamonds = spending;
        delete ret.password;
        return ret;
      },
    },
  }
);

// Virtual getter: user.beans resolves dynamically to authoritative creator earnings storage (user.coins)
userSchema.virtual('beans').get(function (this: any) {
  return typeof this.coins === 'number' ? this.coins : 0;
});

// Indexes for Global Search Engine, RBAC Filters & Referral Network Engine
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });
userSchema.index({ isDeleted: 1 });
userSchema.index({ referralCode: 1 }, { sparse: true });
userSchema.index({ referrerId: 1 }, { sparse: true });
userSchema.index({ referrerCode: 1 }, { sparse: true });
userSchema.index({ hierarchyPath: 1 }, { sparse: true });
userSchema.index({ networkId: 1 }, { sparse: true });
userSchema.index({ countryManagerId: 1 }, { sparse: true });
userSchema.index({ stateManagerId: 1 }, { sparse: true });
userSchema.index({ superAdminId: 1 }, { sparse: true });
userSchema.index({ adminId: 1 }, { sparse: true });
userSchema.index({ agencyId: 1 }, { sparse: true });
userSchema.index({ createdAt: -1 });
for (const { key, options } of ACCOUNT_IDENTITY_INDEXES) userSchema.index(key, options);

export const User = mongoose.model<UserInterface>("User", userSchema);
