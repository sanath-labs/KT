import crypto from 'node:crypto'

export const OTP_TTL_MS = 5 * 60 * 1000 // 5 minutes validity
export const OTP_COOLDOWN_MS = 60 * 1000 // 60 seconds resend cooldown
export const OTP_MAX_ATTEMPTS = 5 // Maximum verification attempts before invalidation

/**
 * Generates a cryptographically secure uniform 6-digit numeric OTP string.
 * Uses crypto.randomInt (100000 to 999999).
 */
export function generateSixDigitOtp() {
  return crypto.randomInt(100000, 1000000).toString()
}

/**
 * Produces a secure HMAC-SHA256 hash of the OTP tied to the email address.
 * Never stores plain-text OTP in the database.
 */
export function hashOtp(email, otp) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  const cleanOtp = String(otp || '').trim()
  const salt = process.env.OTP_SECRET_SALT || 'karavali_transit_secure_otp_salt_v1'

  return crypto
    .createHmac('sha256', salt)
    .update(`${cleanEmail}:${cleanOtp}`)
    .digest('hex')
}

/**
 * Timing-safely verifies whether entered OTP matches the stored hash.
 */
export function verifyOtpHash(email, enteredOtp, storedHash) {
  if (!enteredOtp || !storedHash) return false
  const cleanEmail = String(email || '').trim().toLowerCase()
  const cleanOtp = String(enteredOtp || '').trim()

  const computedHash = hashOtp(cleanEmail, cleanOtp)
  try {
    const computedBuf = Buffer.from(computedHash, 'hex')
    const storedBuf = Buffer.from(storedHash, 'hex')
    if (computedBuf.length !== storedBuf.length) return false
    return crypto.timingSafeEqual(computedBuf, storedBuf)
  } catch {
    return false
  }
}
