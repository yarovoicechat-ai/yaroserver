export interface ConversationPairRepository<TConversation> {
  find: (participants: [string, string]) => Promise<TConversation | null>;
  create: (participants: [string, string]) => Promise<TConversation>;
  withLock: <T>(key: string, task: () => Promise<T>) => Promise<T>;
}

export const getOrCreateConversationPair = async <TConversation>(
  firstUserId: string,
  secondUserId: string,
  repository: ConversationPairRepository<TConversation>,
): Promise<TConversation> => {
  const participants = [String(firstUserId), String(secondUserId)].sort() as [string, string];
  if (!participants[0] || !participants[1] || participants[0] === participants[1]) {
    throw new Error('A private conversation requires two different users');
  }

  const existing = await repository.find(participants);
  if (existing) return existing;

  const pairKey = `conversation_pair:${participants[0]}:${participants[1]}`;
  return repository.withLock(pairKey, async () => {
    const afterLock = await repository.find(participants);
    if (afterLock) return afterLock;
    return repository.create(participants);
  });
};
