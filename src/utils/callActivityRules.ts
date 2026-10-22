export type CallActivityStatus = 'ringing' | 'accepted' | 'rejected' | 'missed' | 'expired' | 'cancelled' | 'ended';
export type CallActivityRecipient = 'caller' | 'host';

export const getCallActivityContent = (
  status: CallActivityStatus,
  recipient: CallActivityRecipient,
  peerName: string,
): { title: string; message: string } => {
  const peer = peerName || (recipient === 'caller' ? 'Host' : 'Caller');
  switch (status) {
    case 'ringing':
      return recipient === 'host'
        ? { title: 'Incoming call', message: `${peer} is calling you` }
        : { title: 'Calling', message: `Calling ${peer}` };
    case 'accepted':
      return recipient === 'caller'
        ? { title: 'Call accepted', message: `${peer} accepted your call` }
        : { title: 'Call accepted', message: `You accepted ${peer}'s call` };
    case 'rejected':
      return recipient === 'caller'
        ? { title: 'Call declined', message: `${peer} declined your call` }
        : { title: 'Call declined', message: `You declined ${peer}'s call` };
    case 'missed':
    case 'expired':
      return recipient === 'host'
        ? { title: 'Missed call', message: `You missed a call from ${peer}` }
        : { title: 'Call unanswered', message: `${peer} did not answer your call` };
    case 'cancelled':
      return recipient === 'host'
        ? { title: 'Call cancelled', message: `${peer} cancelled before you answered` }
        : { title: 'Call cancelled', message: `You cancelled your call with ${peer}` };
    case 'ended':
    default:
      return { title: 'Call ended', message: `Your call with ${peer} ended` };
  }
};
