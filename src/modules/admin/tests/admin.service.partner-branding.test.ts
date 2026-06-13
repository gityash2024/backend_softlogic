import {
  BrandingMode,
  OrganizationKind,
  OrganizationStatus,
  UserRole,
} from '@prisma/client';

jest.mock('@/config', () => ({
  env: {
    PUBLIC_ADMIN_URL: 'https://admin.softlogic.test',
    PUBLIC_APP_URL: 'https://app.softlogic.test',
  },
  prisma: {
    $transaction: jest.fn(),
    adminAuditLog: {
      create: jest.fn(),
    },
    organization: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('@/shared/utils/access-control', () => ({
  canManageRole: jest.fn(() => true),
  ensureOrganizationManaged: jest.fn(),
  getManagedOrganizationIds: jest.fn(),
}));

jest.mock('@/shared/utils/email', () => ({
  sendPasswordSetupEmail: jest.fn(),
  sendSessionsRevokedEmail: jest.fn(),
  sendSubscriptionApprovedEmail: jest.fn(),
  sendSubscriptionPendingEmail: jest.fn(),
  sendSubscriptionRejectedEmail: jest.fn(),
  sendWelcomeEmail: jest.fn(),
}));

import { prisma } from '@/config';
import { adminService } from '@/modules/admin/admin.service';

const mockedPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  adminAuditLog: { create: jest.Mock };
  organization: { findFirst: jest.Mock };
};

describe('AdminService partner organization branding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.adminAuditLog.create.mockResolvedValue({});
    mockedPrisma.organization.findFirst.mockResolvedValue({
      brandingMode: BrandingMode.WHITE_LABEL,
      brandName: 'Partner One',
      brandPrimaryColor: '#19e686',
      brandAccentColor: '#15f5f9',
      logoUrl: 'https://cdn.example.test/partner-logo.png',
      studentLoginEnabled: true,
      parentLoginEnabled: true,
      teacherOnlyMode: false,
      teacherUserLimit: 20,
      studentUserLimit: 20,
      parentUserLimit: 20,
    });
  });

  it('forces partner-admin organization creation to a customer with inherited partner branding', async () => {
    let createdData: Record<string, unknown> | null = null;
    mockedPrisma.$transaction.mockImplementation(async (callback) =>
      callback({
        organization: {
          create: jest.fn(async ({ data }) => {
            createdData = data;
            return {
              id: 'customer-1',
              ...data,
              status: OrganizationStatus.ACTIVE,
            };
          }),
          findUnique: jest.fn(async () => ({
            id: 'customer-1',
            name: 'Customer School',
            slug: 'customer-school',
            kind: OrganizationKind.CUSTOMER,
            parentOrganizationId: 'partner-1',
            brandingMode: BrandingMode.WHITE_LABEL,
            brandName: 'Partner One',
            brandPrimaryColor: '#19e686',
            brandAccentColor: '#15f5f9',
            logoUrl: 'https://cdn.example.test/partner-logo.png',
            logoPublicId: null,
            status: OrganizationStatus.ACTIVE,
          })),
        },
      }),
    );

    const result = await adminService.createOrganization(
      {
        userId: 'partner-admin-1',
        role: UserRole.PARTNER_ADMIN,
        organizationId: 'partner-1',
      },
      {
        name: 'Customer School',
        kind: OrganizationKind.PARTNER,
        parentOrganizationId: null,
        brandingMode: BrandingMode.SOFTLOGIC,
        brandName: 'Should Be Ignored',
        brandPrimaryColor: '#111111',
        brandAccentColor: '#222222',
        studentLoginEnabled: true,
        parentLoginEnabled: true,
        teacherUserLimit: 10,
        studentUserLimit: 10,
        parentUserLimit: 10,
      },
    );

    expect(createdData).toMatchObject({
      kind: OrganizationKind.CUSTOMER,
      parentOrganizationId: 'partner-1',
      brandingMode: BrandingMode.WHITE_LABEL,
      brandName: 'Partner One',
      brandPrimaryColor: '#19e686',
      brandAccentColor: '#15f5f9',
      logoUrl: 'https://cdn.example.test/partner-logo.png',
      logoPublicId: null,
    });
    expect(result).toMatchObject({
      kind: OrganizationKind.CUSTOMER,
      brandingMode: BrandingMode.WHITE_LABEL,
      brandName: 'Partner One',
    });
  });
});
