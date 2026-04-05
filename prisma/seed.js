"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const prisma = new client_1.PrismaClient();
async function main() {
    const organization = await prisma.organization.upsert({
        where: { slug: 'softlogic-internal' },
        update: {
            name: 'Softlogic Internal',
            kind: client_1.OrganizationKind.INTERNAL,
        },
        create: {
            name: 'Softlogic Internal',
            slug: 'softlogic-internal',
            kind: client_1.OrganizationKind.INTERNAL,
        },
    });
    const email = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@softlogicwhiteboard.com';
    const name = process.env.SEED_SUPER_ADMIN_NAME ?? 'Softlogic Super Admin';
    const superAdmin = await prisma.user.upsert({
        where: { email },
        update: {
            name,
            role: client_1.UserRole.SUPER_ADMIN,
            status: client_1.UserStatus.ACTIVE,
            primaryOrganizationId: organization.id,
            isEmailVerified: true,
        },
        create: {
            email,
            name,
            role: client_1.UserRole.SUPER_ADMIN,
            status: client_1.UserStatus.ACTIVE,
            primaryOrganizationId: organization.id,
            isEmailVerified: true,
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
                status: client_1.SubscriptionStatus.ACTIVE,
                seatLimit: 999,
                seatUsage: 1,
                startDate: existingSubscription.startDate,
                endDate: null,
            },
        });
    }
    else {
        await prisma.subscription.create({
            data: {
                organizationId: organization.id,
                planName: 'Internal Unlimited',
                status: client_1.SubscriptionStatus.ACTIVE,
                seatLimit: 999,
                seatUsage: 1,
                startDate: new Date(),
                endDate: null,
            },
        });
    }
    console.log(`Seeded super admin: ${email}`);
}
main()
    .catch((error) => {
    console.error(error);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map