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
