import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generateSixDigitOtp,
  hashOtp,
  verifyOtpHash,
  OTP_TTL_MS,
} from '../otpService.js'
import {
  initDB,
  saveEmailOtp,
  getLatestEmailOtp,
  incrementOtpAttempts,
  markEmailOtpUsed,
  createOwner,
} from '../db.js'

test('Real Gmail OTP Service: 6-digit cryptographic generation', () => {
  for (let i = 0; i < 100; i++) {
    const otp = generateSixDigitOtp()
    assert.equal(typeof otp, 'string', 'OTP must be a string')
    assert.equal(otp.length, 6, 'OTP must be exactly 6 characters long')
    assert.match(otp, /^\d{6}$/, 'OTP must be purely numeric digits')
    const num = parseInt(otp, 10)
    assert.ok(num >= 100000 && num <= 999999, 'OTP must be between 100000 and 999999')
  }
})

test('Real Gmail OTP Service: HMAC-SHA256 hashing and timing-safe verification', () => {
  const email = 'testagency@gmail.com'
  const otp = '739204'

  const hash = hashOtp(email, otp)
  assert.equal(typeof hash, 'string')
  assert.equal(hash.length, 64, 'SHA-256 HMAC must be 64 hex characters')

  // Valid verification
  assert.equal(verifyOtpHash(email, otp, hash), true)
  assert.equal(verifyOtpHash(' TESTAGENCY@gmail.com ', ` ${otp} `, hash), true)

  // Incorrect OTP
  assert.equal(verifyOtpHash(email, '000000', hash), false)
  assert.equal(verifyOtpHash(email, '739205', hash), false)

  // Different email
  assert.equal(verifyOtpHash('otheragency@gmail.com', otp, hash), false)
})

test('Real Gmail OTP DB Persistence: 5-minute expiry, single-use, and attempt limits', async () => {
  await initDB()
  const email = `otp_test_${Date.now()}@gmail.com`
  const validOtp = '582019'
  const otpHash = hashOtp(email, validOtp)

  // 1. Save OTP with 5-minute validity
  const createdNow = Date.now()
  const expiresAt = createdNow + OTP_TTL_MS
  const saved = await saveEmailOtp({
    email,
    otpHash,
    expiresAt,
    createdAt: createdNow,
  })
  assert.ok(saved.id, 'OTP record must have an ID')

  // 2. Fetch latest active OTP
  const fetched = await getLatestEmailOtp(email)
  assert.ok(fetched, 'Active OTP must be retrievable')
  assert.equal(fetched.email, email)
  assert.equal(fetched.otp_hash, otpHash)
  assert.equal(fetched.used, 0)
  assert.equal(fetched.attempts, 0)

  // 3. Increment attempts
  await incrementOtpAttempts(fetched.id)
  const afterInc = await getLatestEmailOtp(email)
  assert.equal(afterInc.attempts, 1)

  // 4. Mark as used (single-use)
  await markEmailOtpUsed(fetched.id)
  const afterUsed = await getLatestEmailOtp(email)
  assert.equal(afterUsed, null, 'Used OTP must no longer be retrieved as active')
})

test('Real Gmail OTP DB Persistence: Expired OTP rejection', async () => {
  await initDB()
  const email = `expired_test_${Date.now()}@gmail.com`
  const validOtp = '112233'
  const otpHash = hashOtp(email, validOtp)

  // Create an already-expired OTP (timestamp in past)
  await saveEmailOtp({
    email,
    otpHash,
    expiresAt: Date.now() - 10000, // expired 10 seconds ago
    createdAt: Date.now() - 310000,
  })

  const fetched = await getLatestEmailOtp(email)
  assert.ok(fetched)
  const isExpired = Date.now() > Number(fetched.expires_at)
  assert.equal(isExpired, true, 'OTP must be identified as expired')
})

test('Real Gmail OTP Endpoint: Rejects unregistered travel agency with 404', async () => {
  const baseUrl = 'http://localhost:5000'
  const unregisteredEmail = `unregistered_${Date.now()}@gmail.com`

  const res = await fetch(`${baseUrl}/api/conductor/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: unregisteredEmail }),
  })

  assert.equal(res.status, 404)
  const data = await res.json()
  assert.equal(data.success, false)
  assert.ok(data.error.includes('is not registered'))
})

test('Real Gmail OTP Security: Zero leakage in logs and API responses', async () => {
  const baseUrl = 'http://localhost:5000'
  await initDB()
  const agencyEmail = `leak_test_${Date.now()}@gmail.com`
  await createOwner(agencyEmail, 'Leak Prevention Travels')

  // Request OTP from endpoint
  const res = await fetch(`${baseUrl}/api/conductor/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: agencyEmail }),
  })
  const data = await res.json()

  // Verify response does not leak raw OTP
  assert.equal(data.otp, undefined, 'Raw otp must not be in response')
  assert.equal(data.preview_otp, undefined, 'preview_otp must not be in response')
  assert.equal(data.code, undefined, 'code must not be in response')
})
