const mockSendMail = jest.fn().mockResolvedValue(undefined);
const mockCreateTransport = jest.fn(() => ({
  sendMail: mockSendMail,
}));

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: mockCreateTransport,
  },
}));

const baseEnv = {
  SMTP_HOST: 'smtp.softlogic.test',
  SMTP_PORT: 587,
  SMTP_USER: 'smtp-user',
  SMTP_PASS: 'smtp-pass',
  EMAIL_FROM_NAME: 'SoftLogic',
  EMAIL_FROM: 'noreply@softlogic.test',
  BREVO_API_URL: 'https://api.brevo.test/v3/smtp/email',
  PUBLIC_APP_URL: 'https://app.softlogic.test',
  PUBLIC_DOWNLOAD_PAGE_URL: 'https://downloads.softlogic.test',
};

const loadEmailModule = async (envOverrides: Record<string, unknown>) => {
  jest.resetModules();
  jest.doMock('@/config', () => ({
    env: {
      ...baseEnv,
      ...envOverrides,
    },
  }));
  return import('../email');
};

describe('email provider selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: jest.fn().mockResolvedValue(''),
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.dontMock('@/config');
  });

  it('sends via Brevo HTTPS API when configured', async () => {
    const { sendEmail } = await loadEmailModule({
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'brevo-secret',
      BREVO_FROM_EMAIL: 'verified@softlogic.test',
      BREVO_FROM_NAME: 'SoftLogic Verified',
    });

    await sendEmail({
      to: 'teacher@example.com',
      subject: 'Setup your account',
      html: '<p>Hello</p>',
      attachments: [
        {
          filename: 'note.txt',
          content: 'welcome',
        },
      ],
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.brevo.test/v3/smtp/email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'api-key': 'brevo-secret',
        }),
      }),
    );
    const [, request] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      sender: { name: 'SoftLogic Verified', email: 'verified@softlogic.test' },
      to: [{ email: 'teacher@example.com' }],
      subject: 'Setup your account',
      htmlContent: '<p>Hello</p>',
    });
    expect(body.attachment).toEqual([
      {
        name: 'note.txt',
        content: Buffer.from('welcome').toString('base64'),
      },
    ]);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('falls back to EMAIL_FROM for Brevo sender when no provider sender is set', async () => {
    const { sendEmail } = await loadEmailModule({
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'brevo-secret',
    });

    await sendEmail({
      to: 'teacher@example.com',
      subject: 'Setup your account',
      html: '<p>Hello</p>',
    });

    const [, request] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body.sender).toEqual({ name: 'SoftLogic', email: 'noreply@softlogic.test' });
  });

  it('uses SMTP when Brevo is not selected', async () => {
    const { sendEmail } = await loadEmailModule({
      EMAIL_PROVIDER: 'smtp',
      BREVO_API_KEY: 'brevo-secret',
    });

    await sendEmail({
      to: 'teacher@example.com',
      subject: 'Setup your account',
      html: '<p>Hello</p>',
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"SoftLogic" <noreply@softlogic.test>',
        to: 'teacher@example.com',
        subject: 'Setup your account',
        html: '<p>Hello</p>',
      }),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
