import { prisma } from '@/config';

export interface WriteAuditLogInput {
  /**
   * The user performing the action. The `admin_audit_logs.actorUserId` column is
   * a required (non-null) FK to `users`, so when the actor is unknown the write
   * is skipped rather than attempted (which would crash on a null FK).
   */
  readonly actorUserId?: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly summary?: string | null;
  /**
   * Request IP address. The AdminAuditLog model has no dedicated `ip` column, so
   * the value is recorded in `metadata.ip` and appended to `summary` for
   * at-a-glance visibility.
   */
  readonly ip?: string | null;
}

/**
 * Best-effort insert into the AdminAuditLog table. Callers should wrap this in a
 * try/catch (or rely on the internal swallow) so an audit failure never blocks
 * the originating request. Returns void.
 */
export const writeAuditLog = async ({
  actorUserId,
  action,
  targetType,
  targetId,
  summary,
  ip,
}: WriteAuditLogInput): Promise<void> => {
  // actorUserId is a required non-null FK — skip when unknown instead of crashing.
  if (!actorUserId) {
    return;
  }

  const trimmedIp = ip?.trim() || null;
  const baseSummary = summary?.trim() || null;
  const summaryWithIp = trimmedIp
    ? `${baseSummary ? `${baseSummary} ` : ''}(ip: ${trimmedIp})`
    : baseSummary;

  try {
    await prisma.adminAuditLog.create({
      data: {
        actorUserId,
        action,
        targetType,
        targetId: targetId ?? null,
        summary: summaryWithIp,
        metadata: trimmedIp ? { ip: trimmedIp } : undefined,
      },
    });
  } catch (error) {
    console.error(`Audit log write failed for action "${action}":`, error);
  }
};
