import type { Server } from 'socket.io';
import { AuthenticatedUserLike, getManagedOrganizationIds } from '@/shared/utils/access-control';

let io: Server | null = null;

export const registerAiRealtimeServer = (server: Server): void => {
  io = server;
};

export const aiRealtimeRoomFor = async (user: AuthenticatedUserLike): Promise<string> => {
  if (user.role === 'SUPER_ADMIN') return 'ai:global';
  const managedIds = await getManagedOrganizationIds(user);
  return `ai:managed:${(managedIds ?? []).sort().join(',')}`;
};

export const emitAiCreditUpdate = (payload: Record<string, unknown>): void => {
  if (!io) return;
  io.to('ai:global').emit('ai:credits-updated', payload);
  const organizationId = payload.organizationId;
  if (typeof organizationId === 'string' && organizationId.trim()) {
    io.to(`ai:organization:${organizationId}`).emit('ai:credits-updated', payload);
  }
};
