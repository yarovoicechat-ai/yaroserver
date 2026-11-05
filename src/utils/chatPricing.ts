export const HOSTED_CHAT_DIAMONDS = 2;

export function hasCallHosting(receiver: any): boolean {
  if (!receiver) return false;
  if (receiver.isHost || receiver.isApprovedHost || receiver.isHostApproved || receiver.hostingApproved) {
    return true;
  }
  if (String(receiver.hostStatus || '').toLowerCase() === 'approved') {
    return true;
  }
  if (['host', 'agency'].includes(String(receiver.role || '').toLowerCase())) {
    return true;
  }
  const types = Array.isArray(receiver.hostTypes) ? receiver.hostTypes : [];
  if (types.some((type: string) => ['voice', 'video', 'voice_call', 'video_call', 'call', 'audio'].includes(String(type).toLowerCase()))) {
    return true;
  }
  return false;
}

export function hostedChatCost(sender: any, receiver: any): number {
  // Free chat with normal users (who don't have call hosting)
  if (!hasCallHosting(receiver)) return 0;

  // Staff / admin exemptions
  const senderRole = String(sender?.role || '').toLowerCase();
  if (['admin', 'superadmin', 'root'].includes(senderRole)) return 0;

  // 2 Diamonds deducted per message when chatting with a call host
  return HOSTED_CHAT_DIAMONDS;
}
