import dotenv from 'dotenv';
import request from 'supertest';
import { OtpType } from '@prisma/client';

import { createApp } from '@/app';
import { connectDatabase, disconnectDatabase, prisma } from '@/config';
import { hashOtp } from '@/shared/utils/otp';

dotenv.config();

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function createKnownOtp(email: string, code: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  assertCondition(user, `Seeded user not found for ${email}`);

  await prisma.otp.updateMany({
    where: { userId: user.id, type: OtpType.EMAIL_LOGIN, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.otp.create({
    data: {
      userId: user.id,
      code: await hashOtp(code),
      type: OtpType.EMAIL_LOGIN,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
}

async function main(): Promise<void> {
  const email =
    process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@softlogicwhiteboard.com';
  const otpCode = '1234';

  await connectDatabase();
  try {
    await createKnownOtp(email, otpCode);
    const app = createApp();

    const verifyResponse = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ email, code: otpCode })
      .expect(200);

    const authData = verifyResponse.body?.data as
      | {
          tokens?: { accessToken?: string };
          user?: { email?: string; role?: string };
        }
      | undefined;

    const accessToken = authData?.tokens?.accessToken;
    assertCondition(accessToken, 'Access token missing from auth smoke response');

    const meResponse = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const me = meResponse.body?.data as
      | { email?: string; role?: string; subscription?: { status?: string } }
      | undefined;

    assertCondition(me?.email === email, 'Authenticated user email mismatch');

    console.log(
      JSON.stringify(
        {
          smoke: 'auth',
          email: me?.email,
          role: me?.role,
          subscriptionStatus: me?.subscription?.status ?? null,
        },
        null,
        2,
      ),
    );
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  console.error('local auth smoke failed');
  console.error(error);
  process.exit(1);
});
