import { existsSync } from 'fs';
import { resolve } from 'path';

import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';

import { env } from '@/config';

const BRAND_LOGO_CID = 'softlogic-logo';
const BRAND_LOGO_FILENAME = 'softlogic-logo.png';

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: Mail.Attachment[];
}

interface BrandEmailLayoutOptions {
  readonly preheader: string;
  readonly eyebrow: string;
  readonly heroTitle?: string;
  readonly heroCopy?: string;
  readonly title: string;
  readonly intro: string;
  readonly spotlightHtml: string;
  readonly outro: string;
  readonly securityHtml?: string | null;
}

interface WelcomeEmailOptions {
  readonly to: string;
  readonly name?: string | null;
  readonly role?: string | null;
  readonly inviterName?: string | null;
  readonly appUrl?: string;
  readonly downloadPageUrl?: string;
}

interface PasswordSetupEmailOptions {
  readonly to: string;
  readonly name?: string | null;
  readonly role?: string | null;
  readonly organizationName?: string | null;
  readonly setupUrl: string;
  readonly expiresInLabel?: string;
}

interface PasswordResetEmailOptions {
  readonly to: string;
  readonly name?: string | null;
  readonly role?: string | null;
  readonly resetUrl: string;
  readonly expiresInLabel?: string;
}

interface PasswordChangedEmailOptions {
  readonly to: string;
  readonly name?: string | null;
  readonly role?: string | null;
}

interface ForcedLogoutEmailOptions {
  readonly to: string;
  readonly name?: string | null;
}

interface SessionsRevokedEmailOptions {
  readonly to: string;
  readonly name?: string | null;
}

export const sendEmail = async (options: EmailOptions): Promise<void> => {
  try {
    await transporter.sendMail({
      attachments: options.attachments,
      from: `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_FROM}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    console.log(`Email sent to ${options.to}`);
  } catch (error) {
    console.error('Email sending failed:', error);
    throw new Error('Failed to send email');
  }
};

const getBrandLogoPath = (): string | null => {
  const candidatePaths = [
    resolve(process.cwd(), 'src', 'modules', 'auth', 'assets', BRAND_LOGO_FILENAME),
    resolve(__dirname, '..', '..', 'modules', 'auth', 'assets', BRAND_LOGO_FILENAME),
  ];

  for (const candidatePath of candidatePaths) {
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
};

export const getBrandLogoEmailAttachments = (): Mail.Attachment[] => {
  const logoPath = getBrandLogoPath();
  if (!logoPath) {
    return [];
  }

  return [
    {
      cid: BRAND_LOGO_CID,
      contentDisposition: 'inline',
      contentType: 'image/png',
      filename: BRAND_LOGO_FILENAME,
      path: logoPath,
    },
  ];
};

const renderBrandEmailLayout = (
  options: BrandEmailLayoutOptions,
): string => {
  const currentYear = new Date().getFullYear();
  const hasBrandLogo = getBrandLogoPath() != null;
  const brandMarkup = hasBrandLogo
    ? `
      <div class="brand-lockup">
        <img src="cid:${BRAND_LOGO_CID}" alt="SoftLogic" class="brand-logo" />
      </div>
    `
    : `<div class="brand-chip">${env.EMAIL_FROM_NAME}</div>`;

  const securityHtml =
    options.securityHtml === undefined
      ? `
        <div class="security-panel">
          <p class="security-title">Security reminder</p>
          <p class="security-copy">
            Only enter this code inside the official SoftLogic whiteboard app or website.
            Our team will never ask for this code over chat, phone, or email.
          </p>
        </div>
      `
      : options.securityHtml ?? '';

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="x-apple-disable-message-reformatting">
        <title>${env.EMAIL_FROM_NAME}</title>
        <style>
          body {
            margin: 0;
            padding: 0;
            background: #eef4ff;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            color: #0f172a;
          }
          table {
            border-spacing: 0;
          }
          td {
            padding: 0;
          }
          .preheader {
            display: none;
            max-height: 0;
            max-width: 0;
            opacity: 0;
            overflow: hidden;
            mso-hide: all;
          }
          .shell {
            width: 100%;
            background:
              radial-gradient(circle at top left, rgba(47, 104, 232, 0.18), transparent 34%),
              linear-gradient(180deg, #0b3d91 0%, #eef4ff 34%, #eef4ff 100%);
            padding: 32px 16px;
          }
          .card {
            width: 100%;
            max-width: 640px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 28px;
            overflow: hidden;
            box-shadow: 0 24px 60px rgba(8, 53, 124, 0.18);
          }
          .hero {
            padding: 36px 40px 24px;
            background: linear-gradient(135deg, #08357c 0%, #2f68e8 100%);
            color: #ffffff;
          }
          .brand-lockup {
            display: inline-block;
            padding: 12px 18px;
            border-radius: 22px;
            background: rgba(255, 255, 255, 0.12);
          }
          .brand-chip {
            display: inline-block;
            padding: 8px 14px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.16);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          .brand-logo {
            display: block;
            width: 220px;
            max-width: 100%;
            height: auto;
          }
          .brand-title {
            margin: 18px 0 0;
            font-size: 30px;
            line-height: 1.15;
            font-weight: 700;
          }
          .brand-copy {
            margin: 12px 0 0;
            color: rgba(255, 255, 255, 0.84);
            font-size: 15px;
            line-height: 1.7;
          }
          .content {
            padding: 34px 40px 40px;
          }
          .eyebrow {
            margin: 0 0 10px;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #2f68e8;
          }
          .title {
            margin: 0;
            font-size: 28px;
            line-height: 1.2;
            color: #101828;
            font-weight: 700;
          }
          .intro,
          .outro {
            margin: 16px 0 0;
            color: #475467;
            font-size: 15px;
            line-height: 1.75;
          }
          .spotlight {
            margin: 28px 0;
            padding: 28px 24px;
            border-radius: 24px;
            background: linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%);
            border: 1px solid #dbe7ff;
            text-align: center;
          }
          .spotlight-label {
            margin: 0 0 12px;
            color: #344054;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          .security-panel {
            margin-top: 28px;
            padding: 18px 20px;
            border-radius: 18px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
          }
          .security-title {
            margin: 0 0 6px;
            font-size: 14px;
            font-weight: 700;
            color: #0f172a;
          }
          .security-copy {
            margin: 0;
            font-size: 13px;
            line-height: 1.7;
            color: #64748b;
          }
          .footer {
            padding: 0 40px 34px;
            color: #98a2b3;
            font-size: 12px;
            line-height: 1.7;
            text-align: center;
          }
          @media only screen and (max-width: 640px) {
            .hero,
            .content,
            .footer {
              padding-left: 24px !important;
              padding-right: 24px !important;
            }
            .brand-title {
              font-size: 26px !important;
            }
            .brand-logo {
              width: 180px !important;
            }
            .title {
              font-size: 24px !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="preheader">${options.preheader}</div>
        <table role="presentation" width="100%" class="shell">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" class="card">
                <tr>
                  <td class="hero">
                    ${brandMarkup}
                    <h1 class="brand-title">${options.heroTitle ?? 'Secure access for every learning session.'}</h1>
                    <p class="brand-copy">
                      ${options.heroCopy ?? 'Fast, safe sign-in for the SoftLogic whiteboard experience.'}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td class="content">
                    <p class="eyebrow">${options.eyebrow}</p>
                    <h2 class="title">${options.title}</h2>
                    <p class="intro">${options.intro}</p>
                    <div class="spotlight">
                      ${options.spotlightHtml}
                    </div>
                    <p class="outro">${options.outro}</p>
                    ${securityHtml}
                  </td>
                </tr>
                <tr>
                  <td class="footer">
                    <p>
                      Need help? Reply to this email or contact your SoftLogic administrator.
                    </p>
                    <p>
                      &copy; ${currentYear} ${env.EMAIL_FROM_NAME}. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
};

export const getOtpEmailHtml = (otp: string): string => {
  return renderBrandEmailLayout({
    preheader: `Your SoftLogic verification code is ${otp}. This code expires in 10 minutes.`,
    eyebrow: 'Login Verification',
    title: 'Your one-time sign-in code',
    intro:
      'Use the verification code below to continue signing in to SoftLogic Whiteboard. This code stays active for 10 minutes.',
    spotlightHtml: `
      <p class="spotlight-label">Verification Code</p>
      <div
        style="
          display: inline-block;
          padding: 16px 24px;
          border-radius: 18px;
          background: #ffffff;
          border: 1px solid #c9dcff;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
          font-size: 34px;
          font-weight: 800;
          letter-spacing: 0.42em;
          color: #08357c;
          text-indent: 0.42em;
        "
      >
        ${otp}
      </div>
    `,
    outro:
      'If you did not request this code, you can safely ignore this email and no changes will be made to your account.',
  });
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const formatRoleLabel = (role?: string | null): string => {
  if (!role?.trim()) {
    return 'SoftLogic member';
  }

  return role
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

type PasswordEmailMode = 'setup' | 'reset' | 'changed';

interface PasswordEmailCopy {
  readonly accountLabel: string;
  readonly preheader: string;
  readonly eyebrow: string;
  readonly heroTitle: string;
  readonly heroCopy: string;
  readonly introNoun: string;
  readonly signInTarget: string;
  readonly inviteFallback: string;
  readonly setupSubject: string;
  readonly setupCta: string;
  readonly resetSubject: string;
  readonly changedSubject: string;
}

const isAdminPasswordRole = (role?: string | null): boolean =>
  ['SUPER_ADMIN', 'PARTNER_ADMIN', 'CUSTOMER_ADMIN', 'ADMIN'].includes(
    role?.trim().toUpperCase() ?? '',
  );

const passwordEmailCopyForRole = (
  role?: string | null,
  mode: PasswordEmailMode = 'setup',
): PasswordEmailCopy => {
  const normalizedRole = role?.trim().toUpperCase();
  if (normalizedRole === 'TEACHER') {
    return {
      accountLabel: 'teacher',
      preheader:
        mode === 'setup'
          ? 'Your SoftLogic teaching workspace is ready. Set your password to continue.'
          : 'A password update was requested for your SoftLogic teacher account.',
      eyebrow: 'SoftLogic teacher access',
      heroTitle:
        mode === 'changed'
          ? 'Your teacher password was changed.'
          : mode === 'reset'
          ? 'Reset your teacher password.'
          : 'Your teaching workspace is ready.',
      heroCopy:
        mode === 'changed'
          ? 'This is a confirmation that your SoftLogic teacher password was updated.'
          : mode === 'reset'
          ? 'Choose a new password to keep managing your boards, live sessions, and student invites.'
          : 'Set your password to manage your boards, run live sessions, and invite students.',
      introNoun: 'teacher account',
      signInTarget: 'SoftLogic role portal',
      inviteFallback: 'teacher invite',
      setupSubject: 'Set up your SoftLogic teacher password',
      setupCta: 'Set teacher password',
      resetSubject: 'Reset your SoftLogic teacher password',
      changedSubject: 'Your SoftLogic teacher password was changed',
    };
  }
  if (normalizedRole === 'STUDENT') {
    return {
      accountLabel: 'student',
      preheader:
        mode === 'setup'
          ? 'Your SoftLogic student workspace is ready. Set your password to continue.'
          : 'A password update was requested for your SoftLogic student account.',
      eyebrow: 'SoftLogic student access',
      heroTitle:
        mode === 'changed'
          ? 'Your student password was changed.'
          : mode === 'reset'
          ? 'Reset your student password.'
          : 'Your student workspace is ready.',
      heroCopy:
        mode === 'changed'
          ? 'This is a confirmation that your SoftLogic student password was updated.'
          : mode === 'reset'
          ? 'Choose a new password to keep joining live classes and reviewing read-only boards.'
          : 'Set your password to join live classes, view boards read-only, and review previous sessions.',
      introNoun: 'student account',
      signInTarget: 'SoftLogic role portal',
      inviteFallback: 'student invite',
      setupSubject: 'Set up your SoftLogic student password',
      setupCta: 'Set student password',
      resetSubject: 'Reset your SoftLogic student password',
      changedSubject: 'Your SoftLogic student password was changed',
    };
  }
  if (normalizedRole === 'PARENT') {
    return {
      accountLabel: 'parent',
      preheader:
        mode === 'setup'
          ? 'Your SoftLogic parent portal is ready. Set your password to continue.'
          : 'A password update was requested for your SoftLogic parent account.',
      eyebrow: 'SoftLogic parent access',
      heroTitle:
        mode === 'changed'
          ? 'Your parent password was changed.'
          : mode === 'reset'
          ? 'Reset your parent password.'
          : 'Your parent portal is ready.',
      heroCopy:
        mode === 'changed'
          ? 'This is a confirmation that your SoftLogic parent password was updated.'
          : mode === 'reset'
          ? 'Choose a new password to keep viewing linked-student progress, reports, and board history.'
          : 'Set your password to view linked-student progress, reports, and read-only board history.',
      introNoun: 'parent account',
      signInTarget: 'SoftLogic role portal',
      inviteFallback: 'parent invite',
      setupSubject: 'Set up your SoftLogic parent password',
      setupCta: 'Set parent password',
      resetSubject: 'Reset your SoftLogic parent password',
      changedSubject: 'Your SoftLogic parent password was changed',
    };
  }

  return {
    accountLabel: isAdminPasswordRole(role) ? 'admin' : 'account',
    preheader:
      mode === 'setup'
        ? 'Your SoftLogic administrator account is ready. Set your password to continue.'
        : 'A password reset was requested for your SoftLogic admin account.',
    eyebrow: 'SoftLogic administrator access',
    heroTitle:
      mode === 'changed'
        ? 'Your admin password was changed.'
        : mode === 'reset'
        ? 'Reset your admin password.'
        : 'Your organization workspace is ready.',
    heroCopy:
      mode === 'changed'
        ? 'This is a confirmation that your SoftLogic admin password was updated.'
        : mode === 'reset'
        ? 'Choose a new password to keep managing teachers, licenses, and launch settings.'
        : 'Set your admin password to manage teachers, licenses, storage, and launch settings.',
    introNoun: 'administrator account',
    signInTarget: 'SoftLogic web admin panel',
    inviteFallback: 'administrator invite',
    setupSubject: 'Set up your SoftLogic admin password',
    setupCta: 'Create admin password',
    resetSubject: 'Reset your SoftLogic admin password',
    changedSubject: 'Your SoftLogic admin password was changed',
  };
};

export const getWelcomeEmailHtml = ({
  appUrl = env.PUBLIC_APP_URL,
  downloadPageUrl = env.PUBLIC_DOWNLOAD_PAGE_URL,
  inviterName,
  name,
  role,
}: Omit<WelcomeEmailOptions, 'to'>): string => {
  const safeName = escapeHtml(name?.trim() || 'there');
  const safeRole = escapeHtml(formatRoleLabel(role));
  const safeAppUrl = escapeHtml(trimTrailingSlash(appUrl));
  const safeDownloadPageUrl = escapeHtml(trimTrailingSlash(downloadPageUrl));
  const safeInviterName = inviterName?.trim()
    ? escapeHtml(inviterName.trim())
    : null;

  return renderBrandEmailLayout({
    preheader: 'Welcome to SoftLogic Whiteboard. Your account is ready.',
    eyebrow: 'Welcome to SoftLogic',
    heroTitle: 'Your SoftLogic workspace is ready.',
    heroCopy:
      'Teach, learn, draw, present, and collaborate from one focused whiteboard.',
    title: `Welcome, ${safeName}`,
    intro: safeInviterName
      ? `${safeInviterName} created a SoftLogic account for you. Your role is set to ${safeRole}.`
      : `Your SoftLogic account has been created. Your role is set to ${safeRole}.`,
    spotlightHtml: `
      <p class="spotlight-label">Start Here</p>
      <a
        href="${safeAppUrl}"
        style="
          display: inline-block;
          padding: 14px 24px;
          border-radius: 999px;
          background: #08357c;
          color: #ffffff;
          font-size: 15px;
          font-weight: 800;
          text-decoration: none;
        "
      >
        Open SoftLogic
      </a>
      <p style="margin: 18px 0 0; color: #475467; font-size: 14px; line-height: 1.6;">
        Prefer the desktop app? Download it here:
        <a href="${safeDownloadPageUrl}" style="color: #2563eb; font-weight: 700;">${safeDownloadPageUrl}</a>
      </p>
    `,
    outro:
      'Use your email address to sign in. SoftLogic will send a secure one-time code whenever verification is required.',
    securityHtml: null,
  });
};

export const sendWelcomeEmail = async ({
  to,
  ...templateOptions
}: WelcomeEmailOptions): Promise<void> => {
  try {
    const brandLogoAttachments = getBrandLogoEmailAttachments();
    await sendEmail({
      attachments:
        brandLogoAttachments.length > 0 ? brandLogoAttachments : undefined,
      to,
      subject: 'Welcome to SoftLogic Whiteboard',
      html: getWelcomeEmailHtml(templateOptions),
    });
  } catch (error) {
    console.error(`Welcome email failed for ${to}:`, error);
  }
};

const DEFAULT_PASSWORD_SETUP_EXPIRY_LABEL = '7 days';

export const getPasswordSetupEmailHtml = ({
  name,
  role,
  organizationName,
  setupUrl,
  expiresInLabel = DEFAULT_PASSWORD_SETUP_EXPIRY_LABEL,
}: Omit<PasswordSetupEmailOptions, 'to'>): string => {
  const safeName = escapeHtml(name?.trim() || 'there');
  const safeRole = escapeHtml(formatRoleLabel(role));
  const safeOrganizationName = escapeHtml(
    organizationName?.trim() || 'your organization',
  );
  const safeSetupUrl = escapeHtml(setupUrl);
  const safeExpiresInLabel = escapeHtml(expiresInLabel);
  const copy = passwordEmailCopyForRole(role, 'setup');

  return renderBrandEmailLayout({
    preheader: copy.preheader,
    eyebrow: copy.eyebrow,
    heroTitle: copy.heroTitle,
    heroCopy: copy.heroCopy,
    title: `Welcome, ${safeName}`,
    intro: `A ${copy.introNoun} has been created for ${safeOrganizationName}. Your role is set to ${safeRole}.`,
    spotlightHtml: `
      <p class="spotlight-label">Set Your Password</p>
      <a
        href="${safeSetupUrl}"
        style="
          display: inline-block;
          padding: 14px 24px;
          border-radius: 999px;
          background: #08357c;
          color: #ffffff;
          font-size: 15px;
          font-weight: 800;
          text-decoration: none;
        "
      >
        ${copy.setupCta}
      </a>
      <p style="margin: 18px 0 0; color: #475467; font-size: 14px; line-height: 1.6;">
        This secure setup link expires in ${safeExpiresInLabel}.
      </p>
    `,
    outro:
      `After your password is set, use this email address and password to sign in to the ${copy.signInTarget}.`,
    securityHtml: `
      <div class="security-panel">
        <p class="security-title">Security reminder</p>
        <p class="security-copy">
          If you did not expect this ${copy.inviteFallback}, ignore this email and contact SoftLogic support.
        </p>
      </div>
    `,
  });
};

export const sendPasswordSetupEmail = async ({
  to,
  ...templateOptions
}: PasswordSetupEmailOptions): Promise<boolean> => {
  try {
    const brandLogoAttachments = getBrandLogoEmailAttachments();
    const copy = passwordEmailCopyForRole(templateOptions.role, 'setup');
    await sendEmail({
      attachments:
        brandLogoAttachments.length > 0 ? brandLogoAttachments : undefined,
      to,
      subject: copy.setupSubject,
      html: getPasswordSetupEmailHtml(templateOptions),
    });
    return true;
  } catch (error) {
    console.error(`Password setup email failed for ${to}:`, error);
    return false;
  }
};

export const getPasswordResetEmailHtml = ({
  name,
  role,
  resetUrl,
  expiresInLabel = '24 hours',
}: Omit<PasswordResetEmailOptions, 'to'>): string => {
  const safeName = escapeHtml(name?.trim() || 'there');
  const safeRole = role ? escapeHtml(formatRoleLabel(role)) : null;
  const safeResetUrl = escapeHtml(resetUrl);
  const safeExpiresInLabel = escapeHtml(expiresInLabel);
  const copy = passwordEmailCopyForRole(role, 'reset');

  return renderBrandEmailLayout({
    preheader: copy.preheader,
    eyebrow: copy.eyebrow,
    heroTitle: copy.heroTitle,
    heroCopy: copy.heroCopy,
    title: `Hello, ${safeName}`,
    intro: safeRole
      ? `We received a request to reset the password for your ${safeRole} account.`
      : `We received a request to reset the password for your SoftLogic ${copy.accountLabel} account.`,
    spotlightHtml: `
      <p class="spotlight-label">Reset Your Password</p>
      <a
        href="${safeResetUrl}"
        style="
          display: inline-block;
          padding: 14px 24px;
          border-radius: 999px;
          background: #08357c;
          color: #ffffff;
          font-size: 15px;
          font-weight: 800;
          text-decoration: none;
        "
      >
        Choose a new password
      </a>
      <p style="margin: 18px 0 0; color: #475467; font-size: 14px; line-height: 1.6;">
        This secure reset link expires in ${safeExpiresInLabel}.
      </p>
    `,
    outro:
      `After your new password is set, use this email and password to sign in to the ${copy.signInTarget}.`,
    securityHtml: `
      <div class="security-panel">
        <p class="security-title">Didn't request this?</p>
        <p class="security-copy">
          If you did not request a password reset, ignore this email — your current password remains active. For peace of mind, contact SoftLogic support.
        </p>
      </div>
    `,
  });
};

export const sendPasswordResetEmail = async ({
  to,
  ...templateOptions
}: PasswordResetEmailOptions): Promise<boolean> => {
  try {
    const brandLogoAttachments = getBrandLogoEmailAttachments();
    const copy = passwordEmailCopyForRole(templateOptions.role, 'reset');
    await sendEmail({
      attachments:
        brandLogoAttachments.length > 0 ? brandLogoAttachments : undefined,
      to,
      subject: copy.resetSubject,
      html: getPasswordResetEmailHtml(templateOptions),
    });
    return true;
  } catch (error) {
    console.error(`Password reset email failed for ${to}:`, error);
    return false;
  }
};

export const getPasswordChangedEmailHtml = ({
  name,
  role,
}: Omit<PasswordChangedEmailOptions, 'to'>): string => {
  const safeName = escapeHtml(name?.trim() || 'there');
  const copy = passwordEmailCopyForRole(role, 'changed');

  return renderBrandEmailLayout({
    preheader: copy.preheader,
    eyebrow: copy.eyebrow,
    heroTitle: copy.heroTitle,
    heroCopy: copy.heroCopy,
    title: `Hello, ${safeName}`,
    intro: `Your SoftLogic ${copy.accountLabel} password was changed.`,
    spotlightHtml: `
      <p class="spotlight-label">Password updated</p>
      <p style="margin: 6px 0 0; color: #101828; font-size: 16px; font-weight: 700;">
        Your account password has been successfully changed.
      </p>
    `,
    outro:
      'For your security, you may need to sign in again on your other devices.',
    securityHtml: `
      <div class="security-panel">
        <p class="security-title">Didn't do this?</p>
        <p class="security-copy">
          If you didn't do this, contact your workspace owner immediately.
        </p>
      </div>
    `,
  });
};

export const sendPasswordChangedEmail = async ({
  to,
  ...templateOptions
}: PasswordChangedEmailOptions): Promise<boolean> => {
  try {
    const brandLogoAttachments = getBrandLogoEmailAttachments();
    const copy = passwordEmailCopyForRole(templateOptions.role, 'changed');
    await sendEmail({
      attachments:
        brandLogoAttachments.length > 0 ? brandLogoAttachments : undefined,
      to,
      subject: copy.changedSubject,
      html: getPasswordChangedEmailHtml(templateOptions),
    });
    return true;
  } catch (error) {
    console.error(`Password changed email failed for ${to}:`, error);
    return false;
  }
};

export const getForcedLogoutEmailHtml = ({
  name,
}: Omit<ForcedLogoutEmailOptions, 'to'>): string => {
  const safeName = escapeHtml(name?.trim() || 'there');

  return renderBrandEmailLayout({
    preheader: 'You were signed out of all devices by an administrator.',
    eyebrow: 'SoftLogic account security',
    heroTitle: 'You were signed out of all devices.',
    heroCopy:
      'An administrator signed your account out everywhere. Sign in again to continue.',
    title: `Hello, ${safeName}`,
    intro:
      'You were signed out of all devices by an administrator. You will need to sign in again to continue using SoftLogic.',
    spotlightHtml: `
      <p class="spotlight-label">Sessions ended</p>
      <p style="margin: 6px 0 0; color: #101828; font-size: 16px; font-weight: 700;">
        All active sessions for your account have been signed out.
      </p>
    `,
    outro:
      'If you still need access, simply sign in again on any device.',
    securityHtml: `
      <div class="security-panel">
        <p class="security-title">Didn't expect this?</p>
        <p class="security-copy">
          If you did not expect to be signed out, contact your SoftLogic administrator.
        </p>
      </div>
    `,
  });
};

export const sendForcedLogoutEmail = async ({
  to,
  ...templateOptions
}: ForcedLogoutEmailOptions): Promise<boolean> => {
  try {
    const brandLogoAttachments = getBrandLogoEmailAttachments();
    await sendEmail({
      attachments:
        brandLogoAttachments.length > 0 ? brandLogoAttachments : undefined,
      to,
      subject: 'You were signed out of all devices',
      html: getForcedLogoutEmailHtml(templateOptions),
    });
    return true;
  } catch (error) {
    console.error(`Forced logout email failed for ${to}:`, error);
    return false;
  }
};

export const getSessionsRevokedEmailHtml = ({
  name,
}: Omit<SessionsRevokedEmailOptions, 'to'>): string => {
  const safeName = escapeHtml(name?.trim() || 'there');

  return renderBrandEmailLayout({
    preheader: 'Your sessions were signed out by an administrator.',
    eyebrow: 'SoftLogic account security',
    heroTitle: 'Your sessions were signed out.',
    heroCopy:
      'An administrator signed your account out of all sessions. Sign in again to continue.',
    title: `Hello, ${safeName}`,
    intro:
      'Your active sessions were signed out by an administrator. You will need to sign in again to continue using SoftLogic.',
    spotlightHtml: `
      <p class="spotlight-label">Sessions ended</p>
      <p style="margin: 6px 0 0; color: #101828; font-size: 16px; font-weight: 700;">
        All active sessions for your account have been signed out.
      </p>
    `,
    outro: 'If you still need access, simply sign in again on any device.',
    securityHtml: `
      <div class="security-panel">
        <p class="security-title">Didn't expect this?</p>
        <p class="security-copy">
          If you did not expect to be signed out, contact your SoftLogic administrator.
        </p>
      </div>
    `,
  });
};

export const sendSessionsRevokedEmail = async ({
  to,
  ...templateOptions
}: SessionsRevokedEmailOptions): Promise<boolean> => {
  try {
    const brandLogoAttachments = getBrandLogoEmailAttachments();
    await sendEmail({
      attachments:
        brandLogoAttachments.length > 0 ? brandLogoAttachments : undefined,
      to,
      subject: 'Your sessions were signed out',
      html: getSessionsRevokedEmailHtml(templateOptions),
    });
    return true;
  } catch (error) {
    console.error(`Sessions revoked email failed for ${to}:`, error);
    return false;
  }
};

interface ActivationKeyEmailEntry {
  readonly label: string;
  readonly status: string;
  readonly expiresAt: string | null;
  readonly plain: string;
}

interface SendActivationKeysEmailOptions {
  readonly to: string;
  readonly organizationName: string;
  readonly adminName?: string | null;
  readonly keys: ActivationKeyEmailEntry[];
}

const renderActivationKeysTable = (keys: ActivationKeyEmailEntry[]): string => {
  if (keys.length === 0) {
    return `<p style="margin:12px 0; color:#475467; font-size:14px;">No active keys are available to share at this time.</p>`;
  }
  const rows = keys
    .map(
      (entry) => `
        <tr>
          <td style="padding:10px 12px; border-bottom:1px solid #e4e7ec; font-size:13px; color:#1f2937;">${escapeHtml(entry.label)}</td>
          <td style="padding:10px 12px; border-bottom:1px solid #e4e7ec; font-size:13px; color:#1f2937; font-family: 'Menlo', monospace;">${escapeHtml(entry.plain)}</td>
          <td style="padding:10px 12px; border-bottom:1px solid #e4e7ec; font-size:13px; color:#475467;">${escapeHtml(entry.status)}</td>
          <td style="padding:10px 12px; border-bottom:1px solid #e4e7ec; font-size:13px; color:#475467;">${escapeHtml(entry.expiresAt ?? '—')}</td>
        </tr>`,
    )
    .join('');
  return `
    <table style="width:100%; border-collapse:collapse; background:#ffffff; border:1px solid #e4e7ec; border-radius:12px; overflow:hidden;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="text-align:left; padding:10px 12px; font-size:12px; text-transform:uppercase; color:#475467;">Label</th>
          <th style="text-align:left; padding:10px 12px; font-size:12px; text-transform:uppercase; color:#475467;">Key</th>
          <th style="text-align:left; padding:10px 12px; font-size:12px; text-transform:uppercase; color:#475467;">Status</th>
          <th style="text-align:left; padding:10px 12px; font-size:12px; text-transform:uppercase; color:#475467;">Expires</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
};

export const sendActivationKeysEmail = async ({
  to,
  organizationName,
  adminName,
  keys,
}: SendActivationKeysEmailOptions): Promise<void> => {
  const safeOrgName = escapeHtml(organizationName);
  const safeAdminName = escapeHtml((adminName ?? '').trim() || 'there');
  const html = renderBrandEmailLayout({
    preheader: `${organizationName} activation keys`,
    eyebrow: 'License Activation Keys',
    title: `Activation keys for ${organizationName}`,
    intro: `Hi ${safeAdminName}, here is the current list of activation keys issued for <strong>${safeOrgName}</strong>. Each key activates one board/device, and any active user in the same organization can use the app on that activated device. Keep this email secure.`,
    spotlightHtml: renderActivationKeysTable(keys),
    outro:
      'If a teammate needs to activate a different device, request a reset from the SoftLogic super admin in the web admin panel.',
    securityHtml: `
      <div class="security-panel">
        <p class="security-title">Security reminder</p>
        <p class="security-copy">
          Treat activation keys like passwords. Each key is board/device based and remains valid until expiry, suspension, or reset.
        </p>
      </div>
    `,
  });
  await sendEmail({
    attachments: getBrandLogoEmailAttachments(),
    to,
    subject: `Activation keys for ${organizationName}`,
    html,
  });
};

interface SeatUsageWarningEmailOptions {
  readonly to: string;
  readonly orgName: string;
  readonly seatUsage: number;
  readonly seatLimit: number;
  readonly pct: number;
  readonly adminName?: string | null;
}

export const getSeatUsageWarningEmailHtml = ({
  orgName,
  seatUsage,
  seatLimit,
  pct,
  adminName,
}: Omit<SeatUsageWarningEmailOptions, 'to'>): string => {
  const safeOrgName = escapeHtml(orgName);
  const safeAdminName = escapeHtml((adminName ?? '').trim() || 'there');
  const atCapacity = pct >= 100;
  const remaining = Math.max(seatLimit - seatUsage, 0);
  return renderBrandEmailLayout({
    preheader: `${orgName} is using ${pct}% of its licensed seats.`,
    eyebrow: 'License Usage Alert',
    heroTitle: atCapacity ? 'Your seats are full.' : 'Your seats are filling up.',
    heroCopy:
      'Keep your team productive by reviewing seat usage before you run out of licenses.',
    title: atCapacity
      ? `${safeOrgName} has reached its seat limit`
      : `${safeOrgName} is at ${pct}% seat usage`,
    intro: `Hi ${safeAdminName}, your organization <strong>${safeOrgName}</strong> is currently using <strong>${seatUsage}</strong> of <strong>${seatLimit}</strong> licensed seats (${pct}%).`,
    spotlightHtml: `
      <p class="spotlight-label">Seat Usage</p>
      <p style="margin:6px 0 0; font-size:34px; font-weight:800; color:#08357c;">${seatUsage} / ${seatLimit}</p>
      <p style="margin:10px 0 0; color:#475467; font-size:14px;">${
        atCapacity
          ? 'All seats are in use. New licensed users cannot be added until seats are freed or your plan is upgraded.'
          : `${remaining} seat${remaining === 1 ? '' : 's'} remaining.`
      }</p>
    `,
    outro:
      'To request additional seats, contact the SoftLogic super admin or open a support request from your admin panel.',
    securityHtml: null,
  });
};

export const sendSeatUsageWarningEmail = async ({
  to,
  ...templateOptions
}: SeatUsageWarningEmailOptions): Promise<boolean> => {
  try {
    await sendEmail({
      attachments: getBrandLogoEmailAttachments(),
      to,
      subject:
        templateOptions.pct >= 100
          ? `${templateOptions.orgName}: seat limit reached`
          : `${templateOptions.orgName}: ${templateOptions.pct}% of seats in use`,
      html: getSeatUsageWarningEmailHtml(templateOptions),
    });
    return true;
  } catch (error) {
    console.error(`Seat usage warning email failed for ${to}:`, error);
    return false;
  }
};

interface SubscriptionExpiryEmailOptions {
  readonly to: string;
  readonly orgName: string;
  readonly endDate: Date | string;
  readonly daysLeft: number;
  readonly adminName?: string | null;
}

const formatExpiryDate = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

export const getSubscriptionExpiryEmailHtml = ({
  orgName,
  endDate,
  daysLeft,
  adminName,
}: Omit<SubscriptionExpiryEmailOptions, 'to'>): string => {
  const safeOrgName = escapeHtml(orgName);
  const safeAdminName = escapeHtml((adminName ?? '').trim() || 'there');
  const safeEndDate = escapeHtml(formatExpiryDate(endDate));
  const expired = daysLeft <= 0;
  const daysLabel = expired
    ? 'today'
    : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  return renderBrandEmailLayout({
    preheader: expired
      ? `${orgName}'s subscription expires today.`
      : `${orgName}'s subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
    eyebrow: 'Subscription Reminder',
    heroTitle: expired
      ? 'Your subscription expires today.'
      : 'Your subscription is expiring soon.',
    heroCopy:
      'Renew before it expires to keep uninterrupted access for your whole organization.',
    title: expired
      ? `${safeOrgName}'s subscription expires today`
      : `${safeOrgName}'s subscription expires ${daysLabel}`,
    intro: `Hi ${safeAdminName}, the subscription for <strong>${safeOrgName}</strong> ends on <strong>${safeEndDate}</strong> (${daysLabel}). Renew to avoid any interruption to your team's access.`,
    spotlightHtml: `
      <p class="spotlight-label">Expires On</p>
      <p style="margin:6px 0 0; font-size:28px; font-weight:800; color:#08357c;">${safeEndDate}</p>
      <p style="margin:10px 0 0; color:#475467; font-size:14px;">${
        expired
          ? 'Once expired, licensed users will lose access until the subscription is renewed.'
          : `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining.`
      }</p>
    `,
    outro:
      'To renew, contact the SoftLogic super admin or open a support request from your admin panel.',
    securityHtml: null,
  });
};

export const sendSubscriptionExpiryEmail = async ({
  to,
  ...templateOptions
}: SubscriptionExpiryEmailOptions): Promise<boolean> => {
  try {
    await sendEmail({
      attachments: getBrandLogoEmailAttachments(),
      to,
      subject:
        templateOptions.daysLeft <= 0
          ? `${templateOptions.orgName}: subscription expires today`
          : `${templateOptions.orgName}: subscription expires in ${templateOptions.daysLeft} day${templateOptions.daysLeft === 1 ? '' : 's'}`,
      html: getSubscriptionExpiryEmailHtml(templateOptions),
    });
    return true;
  } catch (error) {
    console.error(`Subscription expiry email failed for ${to}:`, error);
    return false;
  }
};

interface SubscriptionPendingEmailOptions {
  readonly to: string;
  readonly name?: string | null;
  readonly planName: string;
  readonly organizationName?: string | null;
  readonly seatLimit?: number;
  readonly forSuperAdmin?: boolean;
  readonly requestedByName?: string | null;
}

const seatCountLabel = (seatLimit?: number): string =>
  typeof seatLimit === 'number' ? `${seatLimit} seat${seatLimit === 1 ? '' : 's'}` : '—';

export const getSubscriptionPendingEmailHtml = ({
  name,
  planName,
  organizationName,
  seatLimit,
  forSuperAdmin,
  requestedByName,
}: Omit<SubscriptionPendingEmailOptions, 'to'>): string => {
  const safePlan = escapeHtml(planName);
  const safeOrg = escapeHtml((organizationName ?? '').trim() || 'your organization');
  const safeName = escapeHtml((name ?? '').trim() || 'there');
  const safeRequestedBy = escapeHtml((requestedByName ?? '').trim() || 'An organization admin');
  const seatLabel = seatCountLabel(seatLimit);
  if (forSuperAdmin) {
    return renderBrandEmailLayout({
      preheader: `${safeOrg} requested the ${planName} plan and needs your approval.`,
      eyebrow: 'Approval Needed',
      heroTitle: 'A subscription needs your approval.',
      heroCopy:
        'An organization admin submitted a subscription request that is waiting for Super Admin review.',
      title: `${safeOrg} requested the ${safePlan} plan`,
      intro: `Hi ${safeName}, ${safeRequestedBy} requested a subscription for <strong>${safeOrg}</strong>. It is on hold in <strong>Pending Approval</strong> and grants no seats until you approve it.`,
      spotlightHtml: `
        <p class="spotlight-label">Requested Plan</p>
        <p style="margin:6px 0 0; font-size:28px; font-weight:800; color:#08357c;">${safePlan}</p>
        <p style="margin:10px 0 0; color:#475467; font-size:14px;">${seatLabel} · awaiting your approval</p>
      `,
      outro:
        'Review and approve or reject this request from Subscriptions in your SoftLogic admin panel.',
      securityHtml: null,
    });
  }
  return renderBrandEmailLayout({
    preheader: `Your ${planName} subscription request is pending approval.`,
    eyebrow: 'Subscription Submitted',
    heroTitle: 'Your subscription is pending approval.',
    heroCopy:
      'We received your subscription request. A SoftLogic Super Admin will review it shortly.',
    title: `Your ${safePlan} request for ${safeOrg} is pending`,
    intro: `Hi ${safeName}, your subscription request for <strong>${safeOrg}</strong> has been submitted and is currently <strong>Pending Approval</strong>. It is not active yet — licensed users cannot be added until a Super Admin approves it. We'll email you as soon as it's reviewed.`,
    spotlightHtml: `
      <p class="spotlight-label">Requested Plan</p>
      <p style="margin:6px 0 0; font-size:28px; font-weight:800; color:#08357c;">${safePlan}</p>
      <p style="margin:10px 0 0; color:#475467; font-size:14px;">${seatLabel} · awaiting Super Admin approval</p>
    `,
    outro:
      'No action is needed from you right now. You will receive an email once your subscription is approved.',
    securityHtml: null,
  });
};

export const sendSubscriptionPendingEmail = async ({
  to,
  ...templateOptions
}: SubscriptionPendingEmailOptions): Promise<boolean> => {
  try {
    const orgLabel = (templateOptions.organizationName ?? '').trim() || 'An organization';
    await sendEmail({
      attachments: getBrandLogoEmailAttachments(),
      to,
      subject: templateOptions.forSuperAdmin
        ? `Approval needed: ${orgLabel} requested ${templateOptions.planName}`
        : `Your ${templateOptions.planName} subscription is pending approval`,
      html: getSubscriptionPendingEmailHtml(templateOptions),
    });
    return true;
  } catch (error) {
    console.error(`Subscription pending email failed for ${to}:`, error);
    return false;
  }
};

interface SubscriptionApprovedEmailOptions {
  readonly to: string;
  readonly name?: string | null;
  readonly planName: string;
  readonly organizationName?: string | null;
  readonly seatLimit?: number;
}

export const getSubscriptionApprovedEmailHtml = ({
  name,
  planName,
  organizationName,
  seatLimit,
}: Omit<SubscriptionApprovedEmailOptions, 'to'>): string => {
  const safePlan = escapeHtml(planName);
  const safeOrg = escapeHtml((organizationName ?? '').trim() || 'your organization');
  const safeName = escapeHtml((name ?? '').trim() || 'there');
  const seatLabel = seatCountLabel(seatLimit);
  return renderBrandEmailLayout({
    preheader: `Your ${planName} subscription is approved and active.`,
    eyebrow: 'Subscription Approved',
    heroTitle: 'Your subscription is now active.',
    heroCopy: 'Your subscription request has been approved by a SoftLogic Super Admin.',
    title: `${safePlan} is active for ${safeOrg}`,
    intro: `Hi ${safeName}, great news — your subscription for <strong>${safeOrg}</strong> has been <strong>approved</strong> and is now active. You can start adding licensed users right away.`,
    spotlightHtml: `
      <p class="spotlight-label">Active Plan</p>
      <p style="margin:6px 0 0; font-size:28px; font-weight:800; color:#08357c;">${safePlan}</p>
      <p style="margin:10px 0 0; color:#475467; font-size:14px;">${seatLabel} now available</p>
    `,
    outro: 'You can manage users and seats from your SoftLogic admin panel.',
    securityHtml: null,
  });
};

export const sendSubscriptionApprovedEmail = async ({
  to,
  ...templateOptions
}: SubscriptionApprovedEmailOptions): Promise<boolean> => {
  try {
    await sendEmail({
      attachments: getBrandLogoEmailAttachments(),
      to,
      subject: `Your ${templateOptions.planName} subscription is approved`,
      html: getSubscriptionApprovedEmailHtml(templateOptions),
    });
    return true;
  } catch (error) {
    console.error(`Subscription approved email failed for ${to}:`, error);
    return false;
  }
};

interface SubscriptionRejectedEmailOptions {
  readonly to: string;
  readonly name?: string | null;
  readonly planName: string;
  readonly organizationName?: string | null;
  readonly reason?: string | null;
}

export const getSubscriptionRejectedEmailHtml = ({
  name,
  planName,
  organizationName,
  reason,
}: Omit<SubscriptionRejectedEmailOptions, 'to'>): string => {
  const safePlan = escapeHtml(planName);
  const safeOrg = escapeHtml((organizationName ?? '').trim() || 'your organization');
  const safeName = escapeHtml((name ?? '').trim() || 'there');
  const trimmedReason = (reason ?? '').trim();
  const safeReason = trimmedReason ? escapeHtml(trimmedReason) : null;
  return renderBrandEmailLayout({
    preheader: `Your ${planName} subscription request was not approved.`,
    eyebrow: 'Subscription Update',
    heroTitle: 'Your subscription request was not approved.',
    heroCopy: 'A SoftLogic Super Admin reviewed your subscription request.',
    title: `${safePlan} request for ${safeOrg} was not approved`,
    intro: `Hi ${safeName}, your subscription request for <strong>${safeOrg}</strong> was <strong>not approved</strong>.${safeReason ? '' : ' You can submit a new request or reach out for more details.'}`,
    spotlightHtml: safeReason
      ? `
      <p class="spotlight-label">Reason</p>
      <p style="margin:6px 0 0; color:#475467; font-size:15px; line-height:1.5;">${safeReason}</p>
    `
      : `
      <p class="spotlight-label">Requested Plan</p>
      <p style="margin:6px 0 0; font-size:28px; font-weight:800; color:#08357c;">${safePlan}</p>
    `,
    outro:
      'If you have questions, contact the SoftLogic super admin or open a support request from your admin panel. You can submit a new subscription request at any time.',
    securityHtml: null,
  });
};

export const sendSubscriptionRejectedEmail = async ({
  to,
  ...templateOptions
}: SubscriptionRejectedEmailOptions): Promise<boolean> => {
  try {
    await sendEmail({
      attachments: getBrandLogoEmailAttachments(),
      to,
      subject: `Update on your ${templateOptions.planName} subscription request`,
      html: getSubscriptionRejectedEmailHtml(templateOptions),
    });
    return true;
  } catch (error) {
    console.error(`Subscription rejected email failed for ${to}:`, error);
    return false;
  }
};

interface SupportThreadCreatedEmailOptions {
  readonly to: string;
  readonly organizationName: string;
  readonly threadId: string;
  readonly category: string;
  readonly subject: string;
  readonly openedByName: string;
}

interface SupportReplyEmailOptions {
  readonly to: string;
  readonly organizationName: string;
  readonly threadId: string;
  readonly subject: string;
  readonly replyAuthorName: string;
  readonly replyExcerpt: string;
  readonly audience: 'super_admin' | 'org_admin';
}

interface SupportStatusChangeEmailOptions {
  readonly to: string;
  readonly organizationName: string;
  readonly threadId: string;
  readonly subject: string;
  readonly newStatus: string;
  readonly changedByName: string;
}

const SUPPORT_CATEGORY_LABELS: Record<string, string> = {
  REQUEST_SEATS: 'Request more seats',
  EXTEND_SUBSCRIPTION: 'Extend subscription',
  RESET_DEVICE: 'Reset activation device',
  BILLING: 'Billing question',
  ACTIVATION_ISSUE: 'Activation issue',
  TECHNICAL: 'Technical issue',
  USER_MANAGEMENT: 'User management',
  GENERAL: 'General question',
};

const supportThreadUrl = (audience: 'super_admin' | 'org_admin', threadId: string): string => {
  const base = env.PUBLIC_ADMIN_URL?.replace(/\/$/, '') ?? '';
  const segment = audience === 'super_admin' ? 'support' : 'help';
  return `${base}/${segment}/${threadId}`;
};

const supportButtonHtml = (label: string, href: string): string => `
  <a href="${escapeHtml(href)}" style="display:inline-block; margin-top:18px; padding:12px 22px; background:#08357C; color:#ffffff; text-decoration:none; border-radius:10px; font-weight:700; font-size:14px;">${escapeHtml(label)}</a>
`;

export const sendSupportThreadCreatedEmail = async ({
  to,
  organizationName,
  threadId,
  category,
  subject,
  openedByName,
}: SupportThreadCreatedEmailOptions): Promise<void> => {
  const safeOrg = escapeHtml(organizationName);
  const safeSubject = escapeHtml(subject);
  const categoryLabel = escapeHtml(SUPPORT_CATEGORY_LABELS[category] ?? category);
  const safeAuthor = escapeHtml(openedByName);
  const threadUrl = supportThreadUrl('super_admin', threadId);
  const html = renderBrandEmailLayout({
    preheader: `New ${categoryLabel} thread from ${organizationName}`,
    eyebrow: 'Support Inbox',
    title: 'New support request',
    intro: `<strong>${safeAuthor}</strong> from <strong>${safeOrg}</strong> opened a new ${categoryLabel.toLowerCase()} thread.`,
    spotlightHtml: `
      <p class="spotlight-label">Subject</p>
      <p style="margin:6px 0 14px; font-size:18px; font-weight:700; color:#08357C;">${safeSubject}</p>
      ${supportButtonHtml('Open in Support Inbox', threadUrl)}
    `,
    outro: 'You can reply or apply the requested change directly from the Support Inbox.',
  });
  await sendEmail({
    attachments: getBrandLogoEmailAttachments(),
    to,
    subject: `[Support] ${organizationName}: ${subject}`,
    html,
  });
};

export const sendSupportReplyEmail = async ({
  to,
  organizationName,
  threadId,
  subject,
  replyAuthorName,
  replyExcerpt,
  audience,
}: SupportReplyEmailOptions): Promise<void> => {
  const safeOrg = escapeHtml(organizationName);
  const safeSubject = escapeHtml(subject);
  const safeAuthor = escapeHtml(replyAuthorName);
  const safeExcerpt = escapeHtml(replyExcerpt);
  const threadUrl = supportThreadUrl(audience, threadId);
  const label = audience === 'super_admin' ? 'Open in Support Inbox' : 'Open in Help';
  const html = renderBrandEmailLayout({
    preheader: `New reply from ${replyAuthorName}`,
    eyebrow: audience === 'super_admin' ? 'Support Inbox' : 'Help',
    title: `New reply on “${safeSubject}”`,
    intro: `<strong>${safeAuthor}</strong> replied to the support thread for <strong>${safeOrg}</strong>.`,
    spotlightHtml: `
      <p class="spotlight-label">Reply</p>
      <p style="margin:6px 0 14px; padding:12px 14px; background:#F2F4F7; border-radius:10px; color:#1F2937; font-size:14px; line-height:1.55; white-space:pre-wrap;">${safeExcerpt}</p>
      ${supportButtonHtml(label, threadUrl)}
    `,
    outro: 'Reply or take action from the thread page.',
  });
  await sendEmail({
    attachments: getBrandLogoEmailAttachments(),
    to,
    subject: `[Support reply] ${organizationName}: ${subject}`,
    html,
  });
};

export const sendSupportStatusChangeEmail = async ({
  to,
  organizationName,
  threadId,
  subject,
  newStatus,
  changedByName,
}: SupportStatusChangeEmailOptions): Promise<void> => {
  const safeOrg = escapeHtml(organizationName);
  const safeSubject = escapeHtml(subject);
  const safeStatus = escapeHtml(newStatus);
  const safeWho = escapeHtml(changedByName);
  const threadUrl = supportThreadUrl('org_admin', threadId);
  const html = renderBrandEmailLayout({
    preheader: `Status changed to ${newStatus}`,
    eyebrow: 'Help',
    title: `Your support thread is now ${safeStatus}`,
    intro: `<strong>${safeWho}</strong> updated the status of <strong>${safeSubject}</strong> for <strong>${safeOrg}</strong>.`,
    spotlightHtml: `
      <p class="spotlight-label">New status</p>
      <p style="margin:6px 0 14px; font-size:20px; font-weight:800; color:#08357C;">${safeStatus}</p>
      ${supportButtonHtml('Open thread', threadUrl)}
    `,
    outro: 'You can reopen the thread by replying.',
  });
  await sendEmail({
    attachments: getBrandLogoEmailAttachments(),
    to,
    subject: `[Support ${safeStatus}] ${organizationName}: ${subject}`,
    html,
  });
};

export const getLiveSessionInviteEmailHtml = ({
  code,
  teacherName,
  sessionTitle,
  downloadPageUrl,
}: {
  code: string;
  teacherName: string;
  sessionTitle: string;
  downloadPageUrl: string;
}): string => {
  const safeTeacherName = escapeHtml(teacherName);
  const safeSessionTitle = escapeHtml(sessionTitle);
  const safeDownloadPageUrl = escapeHtml(downloadPageUrl);

  return renderBrandEmailLayout({
    preheader: `Your SoftLogic live-session code is ${code}.`,
    eyebrow: 'Live Session Invite',
    title: 'Join your SoftLogic classroom session',
    intro: `${safeTeacherName} invited you to join "${safeSessionTitle}". Sign in to the SoftLogic app as a student and enter the code below from Join Session.`,
    spotlightHtml: `
      <p class="spotlight-label">Session Code</p>
      <div
        style="
          display: inline-block;
          padding: 16px 24px;
          border-radius: 18px;
          background: #ffffff;
          border: 1px solid #c9dcff;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
          font-size: 34px;
          font-weight: 800;
          letter-spacing: 0.32em;
          color: #08357c;
          text-indent: 0.32em;
        "
      >
        ${escapeHtml(code)}
      </div>
      <p style="margin: 18px 0 0; color: #475467; font-size: 14px; line-height: 1.6;">
        Need the app? Download it here:
        <a href="${safeDownloadPageUrl}" style="color: #2563eb; font-weight: 700;">${safeDownloadPageUrl}</a>
      </p>
    `,
    outro:
      'This code is for your account only. If it expires, ask your teacher to send a new invite.',
  });
};
