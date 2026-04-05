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

async function issueAccessToken(app: ReturnType<typeof createApp>): Promise<string> {
  const email =
    process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@softlogicwhiteboard.com';
  const otpCode = '1234';
  const user = await prisma.user.findUnique({ where: { email } });
  assertCondition(user, `Seeded user not found for ${email}`);

  await prisma.session.deleteMany({
    where: { userId: user.id },
  });

  await prisma.otp.updateMany({
    where: { userId: user.id, type: OtpType.EMAIL_LOGIN, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.otp.create({
    data: {
      userId: user.id,
      code: await hashOtp(otpCode),
      type: OtpType.EMAIL_LOGIN,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const verifyResponse = await request(app)
    .post('/api/v1/auth/verify-otp')
    .send({ email, code: otpCode })
    .expect(200);

  const accessToken = verifyResponse.body?.data?.tokens?.accessToken as
    | string
    | undefined;
  assertCondition(accessToken, 'Unable to obtain access token for whiteboard smoke');
  return accessToken;
}

async function main(): Promise<void> {
  await connectDatabase();
  try {
    const app = createApp();
    const accessToken = await issueAccessToken(app);

    const createCanvasResponse = await request(app)
      .post('/api/v1/canvas')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Smoke Canvas',
        metadata: {
          showGrid: true,
          isInfinite: true,
          nextPageId: 2,
          nextUntitledPageNumber: 2,
        },
      })
      .expect(201);

    const createdCanvas = createCanvasResponse.body?.data as
      | { id?: string; slides?: Array<{ id?: string }> }
      | undefined;
    const canvasId = createdCanvas?.id;
    const firstSlideId = createdCanvas?.slides?.[0]?.id;
    assertCondition(canvasId, 'Canvas id missing after create');
    assertCondition(firstSlideId, 'Initial slide id missing after create');

    const createSlideResponse = await request(app)
      .post(`/api/v1/canvas/${canvasId}/slides`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);

    const secondSlideId = createSlideResponse.body?.data?.id as
      | string
      | undefined;
    assertCondition(secondSlideId, 'Second slide id missing after create');

    await request(app)
      .put(`/api/v1/canvas/${canvasId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Smoke Canvas Updated',
        metadata: {
          showGrid: false,
          isInfinite: true,
          nextPageId: 3,
          nextUntitledPageNumber: 3,
        },
      })
      .expect(200);

    await request(app)
      .put(`/api/v1/canvas/${canvasId}/slides/${firstSlideId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Slide 1',
        elements: {
          id: 1,
          title: 'Slide 1',
          strokes: [],
        },
      })
      .expect(200);

    await request(app)
      .put(`/api/v1/canvas/${canvasId}/slides/${secondSlideId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Slide 2',
        elements: {
          id: 2,
          title: 'Slide 2',
          strokes: [],
        },
      })
      .expect(200);

    await request(app)
      .post(`/api/v1/canvas/${canvasId}/slides/reorder`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        slideIds: [secondSlideId, firstSlideId],
      })
      .expect(200);

    const canvasResponse = await request(app)
      .get(`/api/v1/canvas/${canvasId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const canvas = canvasResponse.body?.data as
      | {
          id?: string;
          name?: string;
          metadata?: { showGrid?: boolean };
          slides?: Array<{ id?: string; order?: number }>;
        }
      | undefined;

    assertCondition(canvas?.name === 'Smoke Canvas Updated', 'Canvas update was not persisted');
    assertCondition(
      canvas?.metadata?.showGrid === false,
      'Canvas metadata update was not persisted',
    );
    assertCondition(
      canvas?.slides?.[0]?.id === secondSlideId,
      'Slide reorder was not persisted',
    );

    console.log(
      JSON.stringify(
        {
          smoke: 'whiteboard',
          canvasId,
          slideOrder: canvas?.slides?.map((slide) => slide.id) ?? [],
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
  console.error('local whiteboard smoke failed');
  console.error(error);
  process.exit(1);
});
