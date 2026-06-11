import { PrismaClient, OrganizationKind, UserRole, UserStatus, SubscriptionStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { DEFAULT_AI_MODEL_PRICING } from '../src/modules/ai/ai.pricing';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: 'softlogic-internal' },
    update: {
      name: 'Softlogic Internal',
      kind: OrganizationKind.INTERNAL,
    },
    create: {
      name: 'Softlogic Internal',
      slug: 'softlogic-internal',
      kind: OrganizationKind.INTERNAL,
    },
  });

  const email = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@softlogicwhiteboard.com';
  const name = process.env.SEED_SUPER_ADMIN_NAME ?? 'Softlogic Super Admin';
  const adminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
  const fallbackAdminPassword = 'admin123';
  const passwordHash = adminPassword ? await bcrypt.hash(adminPassword, 10) : null;
  const createPasswordHash = await bcrypt.hash(adminPassword ?? fallbackAdminPassword, 10);

  const superAdmin = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      primaryOrganizationId: organization.id,
      isEmailVerified: true,
      ...(passwordHash ? { passwordHash } : {}),
    },
    create: {
      email,
      name,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      primaryOrganizationId: organization.id,
      isEmailVerified: true,
      passwordHash: createPasswordHash,
    },
  });

  await prisma.organizationMembership.upsert({
    where: {
      userId_organizationId: {
        userId: superAdmin.id,
        organizationId: organization.id,
      },
    },
    update: {},
    create: {
      userId: superAdmin.id,
      organizationId: organization.id,
    },
  });

  const existingSubscription = await prisma.subscription.findFirst({
    where: {
      organizationId: organization.id,
      planName: 'Internal Unlimited',
    },
  });

  if (existingSubscription) {
    await prisma.subscription.update({
      where: { id: existingSubscription.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        seatLimit: 999,
        seatUsage: 1,
        startDate: existingSubscription.startDate,
        endDate: null,
      },
    });
  } else {
    await prisma.subscription.create({
      data: {
        organizationId: organization.id,
        planName: 'Internal Unlimited',
        status: SubscriptionStatus.ACTIVE,
        seatLimit: 999,
        seatUsage: 1,
        startDate: new Date(),
        endDate: null,
      },
    });
  }

  for (const pricing of DEFAULT_AI_MODEL_PRICING) {
    await prisma.aiModelPricing.upsert({
      where: { modelId: pricing.modelId },
      update: {},
      create: {
        provider: pricing.provider ?? 'gemini',
        modelId: pricing.modelId,
        billingType: pricing.billingType,
        inputUsdMicrosPerMillion: pricing.inputUsdMicrosPerMillion,
        outputUsdMicrosPerMillion: pricing.outputUsdMicrosPerMillion,
        imageUsdMicrosEach: pricing.imageUsdMicrosEach,
        searchUsdMicrosPerThousand: pricing.searchUsdMicrosPerThousand,
        enabled: pricing.enabled ?? true,
      },
    });
  }

  console.log(`Seeded super admin: ${email} (password set)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
