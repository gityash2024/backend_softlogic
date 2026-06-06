const mockSendMail = jest.fn().mockResolvedValue(undefined);

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
  })),
}));

jest.mock('@/config', () => ({
  env: {
    SMTP_HOST: 'smtp.softlogic.test',
    SMTP_PORT: 587,
    SMTP_USER: 'user',
    SMTP_PASS: 'pass',
    EMAIL_FROM_NAME: 'SoftLogic',
    EMAIL_FROM: 'noreply@softlogic.test',
    PUBLIC_APP_URL: 'https://app.softlogic.test',
    PUBLIC_DOWNLOAD_PAGE_URL: 'https://downloads.softlogic.test',
  },
}));

import {
  getPasswordChangedEmailHtml,
  getPasswordResetEmailHtml,
  getPasswordSetupEmailHtml,
  sendPasswordSetupEmail,
} from '../email';

describe('role-aware password email copy', () => {
  beforeEach(() => {
    mockSendMail.mockClear();
  });

  it('keeps admin setup copy for admin roles', () => {
    const html = getPasswordSetupEmailHtml({
      name: 'Admin User',
      role: 'CUSTOMER_ADMIN',
      organizationName: 'Demo Org',
      setupUrl: 'https://admin.softlogic.test/setup-password?token=abc',
    });

    expect(html).toContain('SoftLogic administrator access');
    expect(html).toContain('Create admin password');
    expect(html).toContain('web admin panel');
  });

  it('uses teacher setup copy without admin wording', () => {
    const html = getPasswordSetupEmailHtml({
      name: 'Teacher User',
      role: 'TEACHER',
      organizationName: 'Demo Org',
      setupUrl: 'https://admin.softlogic.test/setup-password?token=abc',
    });

    expect(html).toContain('SoftLogic teacher access');
    expect(html).toContain('Set teacher password');
    expect(html).toContain('boards, run live sessions, and invite students');
    expect(html).not.toContain('Create admin password');
    expect(html).not.toContain('administrator account has been created');
  });

  it('uses student and parent role copy for reset and changed messages', () => {
    const studentReset = getPasswordResetEmailHtml({
      name: 'Student User',
      role: 'STUDENT',
      resetUrl: 'https://admin.softlogic.test/setup-password?mode=reset',
    });
    const parentChanged = getPasswordChangedEmailHtml({
      name: 'Parent User',
      role: 'PARENT',
    });

    expect(studentReset).toContain('SoftLogic student access');
    expect(studentReset).toContain('joining live classes');
    expect(parentChanged).toContain('Your parent password was changed');
    expect(parentChanged).toContain('SoftLogic parent password was updated');
  });

  it('sends role-aware setup subjects', async () => {
    await sendPasswordSetupEmail({
      to: 'teacher@example.com',
      name: 'Teacher User',
      role: 'TEACHER',
      organizationName: 'Demo Org',
      setupUrl: 'https://admin.softlogic.test/setup-password?token=abc',
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Set up your SoftLogic teacher password',
      }),
    );
  });
});
