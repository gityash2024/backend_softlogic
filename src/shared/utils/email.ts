import nodemailer from 'nodemailer';
import { env } from '@/config';

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
}

export const sendEmail = async (options: EmailOptions): Promise<void> => {
  try {
    await transporter.sendMail({
      from: `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_FROM}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    console.log(`📧 Email sent to ${options.to}`);
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    throw new Error('Failed to send email');
  }
};

export const getOtpEmailHtml = (otp: string): string => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f4f7fa; padding: 40px; }
        .container { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
        .logo { text-align: center; margin-bottom: 24px; font-size: 24px; font-weight: 700; color: #2563eb; }
        .otp-box { text-align: center; margin: 32px 0; }
        .otp-code { font-size: 36px; font-weight: 700; letter-spacing: 12px; color: #1e293b; background: #f1f5f9; padding: 16px 32px; border-radius: 8px; display: inline-block; }
        .message { color: #64748b; font-size: 14px; line-height: 1.6; text-align: center; }
        .footer { margin-top: 32px; text-align: center; color: #94a3b8; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">Softlogic Whiteboard</div>
        <p class="message">Your verification code is:</p>
        <div class="otp-box">
          <span class="otp-code">${otp}</span>
        </div>
        <p class="message">This code will expire in 10 minutes. Do not share this code with anyone.</p>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Softlogic Whiteboard. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};
