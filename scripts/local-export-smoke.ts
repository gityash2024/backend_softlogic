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
  assertCondition(accessToken, 'Unable to obtain access token for export smoke');
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
        name: 'Export Smoke Canvas',
        metadata: {
          showGrid: true,
          isInfinite: true,
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

    await request(app)
      .put(`/api/v1/canvas/${canvasId}/slides/${firstSlideId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Intro Slide',
        elements: [
          { type: 'stroke', id: 'stroke-1' },
          { type: 'text', id: 'text-1' },
          { type: 'shape', id: 'shape-1' },
        ],
      })
      .expect(200);

    const pdfExportResponse = await request(app)
      .post('/api/v1/export/pdf')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ canvasId, slideIds: [firstSlideId] })
      .expect(201);

    const pngExportResponse = await request(app)
      .post('/api/v1/export/image')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ canvasId, format: 'PNG' })
      .expect(201);

    const jpgExportResponse = await request(app)
      .post('/api/v1/export/image')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ canvasId, format: 'JPG' })
      .expect(201);

    const exports = [
      {
        id: pdfExportResponse.body?.data?.id as string | undefined,
        expectedType: 'application/pdf',
      },
      {
        id: pngExportResponse.body?.data?.id as string | undefined,
        expectedType: 'image/png',
      },
      {
        id: jpgExportResponse.body?.data?.id as string | undefined,
        expectedType: 'image/jpeg',
      },
    ];

    const downloads: Record<string, number> = {};

    for (const entry of exports) {
      assertCondition(entry.id, 'Export id missing from response');

      const statusResponse = await request(app)
        .get(`/api/v1/export/${entry.id}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      assertCondition(
        statusResponse.body?.data?.status === 'COMPLETED',
        `Export ${entry.id} did not complete`,
      );

      const downloadResponse = await request(app)
        .get(`/api/v1/export/${entry.id}/download`)
        .set('Authorization', `Bearer ${accessToken}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
          response.on('error', callback);
        })
        .expect(200);

      assertCondition(
        String(downloadResponse.headers['content-type'] || '').includes(entry.expectedType),
        `Unexpected content type for export ${entry.id}`,
      );
      const body = downloadResponse.body as Buffer;
      assertCondition(body.length > 0, `Export ${entry.id} download was empty`);
      downloads[entry.id] = body.length;
    }

    console.log(
      JSON.stringify(
        {
          smoke: 'export',
          canvasId,
          downloads,
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
  console.error('local export smoke failed');
  console.error(error);
  process.exit(1);
});
