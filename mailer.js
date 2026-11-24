import nodemailer from 'nodemailer'
import { Resend } from 'resend'

/**
 * Checks whether an active email provider is configured in environment variables.
 * Supports Resend (preferred) and Gmail SMTP.
 */
export function isEmailConfigured() {
  if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim()) {
    return true
  }
  const user = process.env.GMAIL_USER ? process.env.GMAIL_USER.trim() : ''
  const pass = process.env.GMAIL_APP_PASSWORD ? process.env.GMAIL_APP_PASSWORD.trim() : ''
  return Boolean(user && pass)
}

/**
 * Returns the active email delivery provider ('resend' | 'gmail' | null).
 */
export function getEmailProvider() {
  if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim()) {
    return 'resend'
  }
  const user = process.env.GMAIL_USER ? process.env.GMAIL_USER.trim() : ''
  const pass = process.env.GMAIL_APP_PASSWORD ? process.env.GMAIL_APP_PASSWORD.trim() : ''
  if (user && pass) {
    return 'gmail'
  }
  return null
}

/**
 * Backward compatibility alias for isEmailConfigured()
 */
export function isGmailConfigured() {
  return isEmailConfigured()
}

/**
 * Returns a configured Nodemailer transporter using Gmail SMTP.
 */
export function getGmailTransporter() {
  const user = process.env.GMAIL_USER ? process.env.GMAIL_USER.trim() : ''
  const pass = process.env.GMAIL_APP_PASSWORD
    ? process.env.GMAIL_APP_PASSWORD.trim().replace(/\s+/g, '')
    : ''

  if (!user || !pass) {
    return null
  }

  return nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user,
      pass,
    },
    connectionTimeout: 6000,
    greetingTimeout: 6000,
    socketTimeout: 8000,
  })
}

/**
 * Verifies Gmail SMTP connection without sending an email.
 */
export async function verifyGmailConnection() {
  const transporter = getGmailTransporter()
  if (!transporter) {
    return {
      configured: false,
      error: 'GMAIL_USER or GMAIL_APP_PASSWORD environment variable is missing.',
    }
  }

  try {
    await transporter.verify()
    return { configured: true, verified: true }
  } catch (err) {
    return { configured: true, verified: false, error: err.message }
  }
}

/**
 * Generates the professional Karavali-Transit branded HTML email.
 */
function getHtmlEmailTemplate({ agencyName, otp }) {
  const currentYear = new Date().getFullYear()

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Karavali-Transit Conductor Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 560px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.07); border: 1px solid #e2e8f0;" cellspacing="0" cellpadding="0">
          
          <!-- Corridor Branding Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 50%, #0284c7 100%); padding: 36px 32px; text-align: center;">
              <div style="display: inline-block; background-color: rgba(255, 255, 255, 0.16); border-radius: 14px; padding: 10px 18px; margin-bottom: 12px; border: 1px solid rgba(255, 255, 255, 0.2);">
                <span style="font-size: 26px; vertical-align: middle;">🚌</span>
                <span style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: 0.5px; margin-left: 10px; vertical-align: middle;">Karavali-Transit</span>
              </div>
              <div style="color: #dbeafe; font-size: 13px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;">
                ಕರಾವಳಿ ಸಾರಿಗೆ • NH-66 Coastal Corridor
              </div>
              <div style="color: #93c5fd; font-size: 11px; margin-top: 6px; font-weight: 500;">
                Mangaluru ➔ Surathkal ➔ Mulki ➔ Udupi ➔ Kundapura
              </div>
            </td>
          </tr>

          <!-- Email Content Body -->
          <tr>
            <td style="padding: 36px 32px 28px;">
              <h2 style="margin: 0 0 12px; font-size: 21px; font-weight: 800; color: #0f172a;">
                Conductor Terminal Sign-In Code
              </h2>
              <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #475569;">
                A duty sign-in request was initiated for the conductor terminal under 
                <strong style="color: #1e3a8a;">${agencyName || 'Registered Travel Agency'}</strong>. 
                Please enter the 6-digit one-time verification code below to authorize duty access:
              </p>

              <!-- OTP Verification Card -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
                <tr>
                  <td align="center" style="background-color: #f8fafc; border: 2px dashed #93c5fd; border-radius: 14px; padding: 26px 20px;">
                    <div style="font-size: 12px; font-weight: 700; color: #64748b; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 10px;">
                      Your One-Time Security Code
                    </div>
                    <div style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 42px; font-weight: 900; letter-spacing: 12px; color: #1d4ed8; padding: 4px 0 8px 12px;">
                      ${otp}
                    </div>
                    <div style="display: inline-block; background-color: #fee2e2; color: #991b1b; font-size: 12px; font-weight: 700; border-radius: 20px; padding: 5px 14px; margin-top: 6px;">
                      ⏱️ Valid for 5 minutes only
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Security Information Banner -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
                <tr>
                  <td style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 14px 18px; border-radius: 8px;">
                    <div style="font-size: 13px; line-height: 1.5; color: #92400e; font-weight: 600;">
                      🔒 Security Guidelines:
                    </div>
                    <ul style="margin: 6px 0 0; padding-left: 18px; font-size: 12px; line-height: 1.6; color: #78350f;">
                      <li>Never share this code with anyone. Karavali-Transit administrators will never ask for your code.</li>
                      <li>This code expires in <strong>5 minutes</strong> and can be used <strong>only once</strong>.</li>
                      <li>Maximum 5 verification attempts are permitted before this code is invalidated.</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <p style="margin: 20px 0 0; font-size: 13px; line-height: 1.5; color: #64748b;">
                If you or your conductors did not request this verification code, please ignore this email or review your fleet security in the Fleet Owner Console.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 32px; text-align: center;">
              <p style="margin: 0 0 6px; font-size: 12px; font-weight: 700; color: #475569;">
                Karavali-Transit (ಕರಾವಳಿ ಸಾರಿಗೆ)
              </p>
              <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.5;">
                Real-Time Private Bus Telemetry Network for Coastal Karnataka NH-66 Corridor<br>
                © ${currentYear} Karavali-Transit. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Plain-text fallback for non-HTML mail clients.
 */
function getPlainTextEmailTemplate({ agencyName, otp }) {
  return `🚌 Karavali-Transit (ಕರಾವಳಿ ಸಾರಿಗೆ)
NH-66 Coastal Corridor Private Bus Telemetry Platform

Conductor Terminal Sign-In Code
--------------------------------------------------
A duty sign-in request was initiated for: ${agencyName || 'Registered Travel Agency'}

YOUR 6-DIGIT VERIFICATION CODE:
${otp}

⏱️ This code is valid for 5 minutes only.
🔒 This code can only be used once. Do not share it with anyone.

If you did not request this verification code, please ignore this email.
`
}

/**
 * Sends a real 6-digit OTP email to the registered agency's inbox.
 * Dispatches via Resend API if RESEND_API_KEY is configured,
 * otherwise falls back to Gmail SMTP if GMAIL_USER/GMAIL_APP_PASSWORD are set.
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.agencyName - Registered agency name
 * @param {string} options.otp - 6-digit verification code
 * @returns {Promise<Object>} Delivery result
 */
export async function sendOtpEmail({ to, agencyName, otp }) {
  const cleanTo = String(to || '').trim().toLowerCase()
  const cleanOtp = String(otp || '').trim()

  if (!cleanTo || !cleanOtp) {
    throw new Error('Recipient email and OTP code are required.')
  }

  const provider = getEmailProvider()

  if (!provider) {
    throw new Error(
      'Email delivery is not configured. Please define RESEND_API_KEY (from https://resend.com) or GMAIL_USER and GMAIL_APP_PASSWORD in your .env file.'
    )
  }

  // 1. Resend API Delivery
  if (provider === 'resend') {
    const resend = new Resend(process.env.RESEND_API_KEY.trim())
    const fromAddress = process.env.RESEND_FROM?.trim() || 'Karavali-Transit <onboarding@resend.dev>'

    console.log(`[Email] Dispatching real OTP email via Resend to: ${cleanTo}`)
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: [cleanTo],
      subject: `🚌 ${cleanOtp} is your Karavali-Transit Conductor Sign-In Code`,
      text: getPlainTextEmailTemplate({ agencyName, otp: cleanOtp }),
      html: getHtmlEmailTemplate({ agencyName, otp: cleanOtp }),
    })

    if (error) {
      console.error(`[Email] Resend delivery error:`, error.message)
      throw new Error(`Resend delivery failed: ${error.message}`)
    }

    console.log(`[Email] Successfully delivered via Resend (Message ID: ${data?.id})`)
    return { provider: 'resend', id: data?.id }
  }

  // 2. Gmail SMTP Delivery
  const user = process.env.GMAIL_USER.trim()
  const pass = process.env.GMAIL_APP_PASSWORD.trim().replace(/\s+/g, '')

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
    connectionTimeout: 6000,
    greetingTimeout: 6000,
    socketTimeout: 8000,
  })

  const mailOptions = {
    from: `"Karavali-Transit" <${user}>`,
    to: cleanTo,
    subject: `🚌 ${cleanOtp} is your Karavali-Transit Conductor Sign-In Code`,
    text: getPlainTextEmailTemplate({ agencyName, otp: cleanOtp }),
    html: getHtmlEmailTemplate({ agencyName, otp: cleanOtp }),
  }

  console.log(`[Email] Dispatching real OTP email via Gmail SMTP to: ${cleanTo}`)
  const info = await transporter.sendMail(mailOptions)
  console.log(`[Email] Successfully delivered via Gmail SMTP (Message ID: ${info.messageId})`)
  return { provider: 'gmail', id: info.messageId }
}
