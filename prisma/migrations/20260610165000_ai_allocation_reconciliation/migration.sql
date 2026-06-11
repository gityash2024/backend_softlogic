ALTER TABLE "ai_master_configs"
ADD COLUMN IF NOT EXISTS "googleSearchGroundingEnabled" BOOLEAN NOT NULL DEFAULT false;

WITH user_accounts AS (
  SELECT
    ua.id AS user_account_id,
    ua."allocatedTokens" AS allocated_tokens,
    ua."parentAccountId" AS old_parent_id,
    oa.id AS organization_account_id
  FROM "ai_credit_accounts" ua
  JOIN "users" u ON u.id = ua."userId"
  JOIN "ai_credit_accounts" oa
    ON oa.scope = 'ORGANIZATION'
   AND oa."organizationId" = u."primaryOrganizationId"
  WHERE ua.scope = 'USER'
    AND ua."allocatedTokens" > 0
    AND u."primaryOrganizationId" IS NOT NULL
    AND ua."parentAccountId" IS DISTINCT FROM oa.id
)
UPDATE "ai_credit_accounts" parent
SET "childAllocatedTokens" = parent."childAllocatedTokens" - user_accounts.allocated_tokens
FROM user_accounts
WHERE parent.id = user_accounts.old_parent_id
  AND parent."childAllocatedTokens" >= user_accounts.allocated_tokens;

WITH user_accounts AS (
  SELECT
    ua.id AS user_account_id,
    ua."allocatedTokens" AS allocated_tokens,
    oa.id AS organization_account_id
  FROM "ai_credit_accounts" ua
  JOIN "users" u ON u.id = ua."userId"
  JOIN "ai_credit_accounts" oa
    ON oa.scope = 'ORGANIZATION'
   AND oa."organizationId" = u."primaryOrganizationId"
  WHERE ua.scope = 'USER'
    AND ua."allocatedTokens" > 0
    AND u."primaryOrganizationId" IS NOT NULL
    AND ua."parentAccountId" IS DISTINCT FROM oa.id
)
UPDATE "ai_credit_accounts" parent
SET "childAllocatedTokens" = parent."childAllocatedTokens" + user_accounts.allocated_tokens
FROM user_accounts
WHERE parent.id = user_accounts.organization_account_id;

WITH user_accounts AS (
  SELECT
    ua.id AS user_account_id,
    oa.id AS organization_account_id,
    u."primaryOrganizationId" AS organization_id
  FROM "ai_credit_accounts" ua
  JOIN "users" u ON u.id = ua."userId"
  JOIN "ai_credit_accounts" oa
    ON oa.scope = 'ORGANIZATION'
   AND oa."organizationId" = u."primaryOrganizationId"
  WHERE ua.scope = 'USER'
    AND u."primaryOrganizationId" IS NOT NULL
    AND ua."parentAccountId" IS DISTINCT FROM oa.id
)
UPDATE "ai_credit_accounts" ua
SET
  "parentAccountId" = user_accounts.organization_account_id,
  "organizationId" = user_accounts.organization_id
FROM user_accounts
WHERE ua.id = user_accounts.user_account_id;
