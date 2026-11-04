import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Room } from '../models/room.model';
import { User } from '../models/user.model';

// Public invite cards deliberately expose only fields already shown on the card.
export const getPublicShare = async (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!['room', 'user'].includes(String(req.params.kind)) || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) {
    return res.status(400).json({ success: false });
  }
  try {
    res.setHeader('Cache-Control', 'public, max-age=60');
    if (req.params.kind === 'room') {
      const room = await Room.findOne({
        isBanned: { $ne: true },
        $or: [{ channelName: id }, ...(Types.ObjectId.isValid(id) ? [{ _id: id }] : [])],
      }).select('title channelName coverImage ownerId isActive').lean();
      if (!room) return res.status(404).json({ success: false });
      const owner = await User.findById(room.ownerId).select('name image').lean();
      return res.json({ success: true, data: { kind: 'room', id: room.channelName,
        name: room.title, image: room.coverImage || owner?.image || '', isActive: room.isActive } });
    }
    if (!/^\d+$/.test(id) && !Types.ObjectId.isValid(id)) return res.status(404).json({ success: false });
    const user = await User.findOne({ isDeleted: { $ne: true }, isBlocked: { $ne: true },
      $or: [...(/^\d+$/.test(id) ? [{ userId: Number(id) }] : []),
        ...(Types.ObjectId.isValid(id) ? [{ _id: id }] : [])],
    }).select('name image userId followersCount visitorsCount').lean();
    if (!user) return res.status(404).json({ success: false });
    return res.json({ success: true, data: { kind: 'user', id: String(user.userId),
      name: user.name, image: user.image || '', followers: user.followersCount || 0,
      visitors: user.visitorsCount || 0 } });
  } catch (_) {
    return res.status(503).json({ success: false });
  }
};
