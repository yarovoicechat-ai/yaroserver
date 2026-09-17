import { Request, Response } from 'express';

export const getVoiceClubConfig = async (req: Request, res: Response) => {
  try {
    return res.status(200).json({
      success: true,
      data: {
        appName: 'Voice Call Club',
        package: 'com.voicecallclub.app',
        deepLinkScheme: 'voiceclub://',
        version: '2.0.0',
        features: {
          voiceCallsEnabled: true,
          videoCallsEnabled: true,
          giftExchangeEnabled: true,
          vipLoungesEnabled: true,
          instantMatchingEnabled: true,
        },
        bannerNotice: 'Welcome to Voice Call Club! Connect with vibrant hosts instantly.',
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const joinVoiceQueue = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id || req.body.userId;
    const { preferredLanguage, callType } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    return res.status(200).json({
      success: true,
      message: 'Successfully queued for Voice Call Club audio lounge match',
      data: {
        queueTicketId: `VCQ-${Date.now()}-${userId.toString().slice(-4)}`,
        status: 'WAITING',
        estimatedWaitSeconds: 15,
        preferredLanguage: preferredLanguage || 'English',
        callType: callType || 'voice',
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getVipRewards = async (req: Request, res: Response) => {
  try {
    return res.status(200).json({
      success: true,
      data: {
        tiers: [
          { name: 'Bronze Club', minCoinsSpent: 1000, callDiscountPercent: 5, badgeUrl: '/uploads/badges/bronze.png' },
          { name: 'Silver Club', minCoinsSpent: 5000, callDiscountPercent: 10, badgeUrl: '/uploads/badges/silver.png' },
          { name: 'Gold Club', minCoinsSpent: 20000, callDiscountPercent: 15, badgeUrl: '/uploads/badges/gold.png' },
          { name: 'Diamond VIP Club', minCoinsSpent: 100000, callDiscountPercent: 25, badgeUrl: '/uploads/badges/diamond.png' },
        ],
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
