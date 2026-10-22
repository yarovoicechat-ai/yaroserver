export enum UserRole {
  OWNER = "owner",
  OPERATOR = "operator",
  SUPER_ADMIN = "superAdmin",
  ADMIN = "admin",
  BD_LEADER = "bdLeader",
  BD = "bd",
  AGENCY = "agency",
  COIN_SELLER = "coinSeller",
  CUSTOMER_SUPPORT = "customerSupport",
  HOST = "host",
  USER = "user",
}

export const ROLE_HIERARCHY: Record<string, number> = {
  [UserRole.OWNER]: 0,
  [UserRole.SUPER_ADMIN]: 1,
  [UserRole.ADMIN]: 2,
  [UserRole.BD_LEADER]: 3,
  [UserRole.BD]: 4,
  [UserRole.OPERATOR]: 5,
  [UserRole.AGENCY]: 6,
  [UserRole.COIN_SELLER]: 7,
  [UserRole.CUSTOMER_SUPPORT]: 7,
  [UserRole.HOST]: 8,
  [UserRole.USER]: 9,
};

export enum AuthType {
  GOOGLE = "google",
  PHONE = "phone",
}

export enum Gender {
  MALE = "male",
  FEMALE = "female",
  OTHER = "other",
}

export enum RechargeType {
  ONLINE = 'online',
  OFFLINE = 'offline',
  GOOGLE_PLAY = 'google_play',
  REFERRAL_REGISTRATION_REWARD = 'referral_registration_reward',
  REFERRAL_CALL_REWARD = 'referral_call_reward',
}

export enum TransactionType {
  VOICE_CALL = 'voice_call',
  GIFT = 'gift',
  GIFT_SENT = 'gift_sent',
}

export enum CallStatus {
  INITIATED = 'initiated',
  RINGING = 'ringing',
  ACCEPTED = 'accepted',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ENDED = 'ended',
  CANCELLED = 'cancelled',
  MISSED = 'missed',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}
