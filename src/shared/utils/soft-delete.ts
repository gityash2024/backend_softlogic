/**
 * Soft-delete vs disabled semantics:
 *   - `status = DISABLED` means admin-suspended (recoverable; the record is still "live").
 *   - `deletedAt` (non-null) means archived/soft-deleted (excluded from normal queries).
 *
 * `notDeleted` is a reusable Prisma `where` fragment for models carrying a `deletedAt`
 * column. Spread it into a query's `where` to scope to non-archived rows, e.g.
 * `prisma.subscription.findMany({ where: { ...notDeleted, organizationId } })`.
 */
export const notDeleted = { deletedAt: null } as const;
