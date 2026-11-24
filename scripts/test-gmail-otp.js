#!/usr/bin/env node

/**
 * Karavali-Transit: Real Email Delivery & OTP Verification Test Tool
 *
 * Supports:
 * 1. Resend API (RESEND_API_KEY)
 * 2. Gmail SMTP (GMAIL_USER & GMAIL_APP_PASSWORD)
 *
 * Usage:
 *   node scripts/test-gmail-otp.js recipient@example.com
 */

import 'dotenv/config'
import readline from 'node:readline'
import { isEmailConfigured, getEmailProvider, sendOtpEmail } from '../mailer.js'
import { generateSixDigitOtp, hashOtp, verifyOtpHash } from '../otpService.js'
import { initDB, saveEmailOtp, getLatestEmailOtp, markEmailOtpUsed, incrementOtpAttempts } from '../db.js'

async function run() {
  console.log('\n🚌 ========================================================')
  console.log('   Karavali-Transit: Real Email OTP Verification Tool')
  console.log('========================================================\n')

  const recipient = process.argv[2]?.trim()

  if (!isEmailConfigured()) {
    console.error('❌ No email provider is configured in your .env file.\n')
    console.log('Please add your Resend API Key to .env:')
    console.log('  RESEND_API_KEY=re_your_api_key_here\n')
    console.log('How to get a free Resend API key (takes 30 seconds):')
    console.log('  1. Go to https://resend.com and sign up for free.')
    console.log('  2. Click "API Keys" on the left menu -> "Create API Key".')
    console.log('  3. Copy the key (starts with re_) and paste it into .env as RESEND_API_KEY=re_...\n')
    process.exit(1)
  }

  const provider = getEmailProvider()
  console.log(`📡 Active Email Provider: ${provider === 'resend' ? '🚀 Resend API' : '📧 Gmail SMTP'}`)

  if (!recipient) {
    console.log('\nℹ️ Usage: node scripts/test-gmail-otp.js <recipient_email>')
    console.log('   Example: node scripts/test-gmail-otp.js myemail@gmail.com\n')
    process.exit(0)
  }

  console.log(`📬 Initializing Database and preparing real OTP delivery to: ${recipient}...`)
  await initDB()

  const otp = generateSixDigitOtp()
  const otpHash = hashOtp(recipient, otp)
  const expiresAt = Date.now() + 5 * 60 * 1000

  console.log('🔐 Storing SHA-256 HMAC hash in database (5-minute expiry)...')
  await saveEmailOtp({
    email: recipient,
    otpHash,
    expiresAt,
    createdAt: Date.now(),
  })

  console.log(`📤 Dispatching branded email via ${provider === 'resend' ? 'Resend' : 'Gmail'} to: ${recipient}...`)
  try {
    const info = await sendOtpEmail({
      to: recipient,
      agencyName: 'Karavali-Transit Verification Test',
      otp,
    })
    console.log(`✅ Email delivered successfully! (${info.provider} ID: ${info.id})`)
    console.log('\n📥 Please check your inbox (and Spam folder if not visible within 15 seconds).')
  } catch (err) {
    console.error(`❌ Failed to send email: ${err.message}`)
    process.exit(1)
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  rl.question('\n🔑 Enter the 6-digit OTP code received in your inbox: ', async (enteredOtp) => {
    rl.close()

    const cleanInput = enteredOtp.trim()
    const record = await getLatestEmailOtp(recipient)

    if (!record) {
      console.error('❌ No active OTP record found in database.')
      process.exit(1)
    }

    if (Date.now() > Number(record.expires_at)) {
      console.error('❌ OTP has expired.')
      process.exit(1)
    }

    const isValid = verifyOtpHash(recipient, cleanInput, record.otp_hash)
    if (isValid) {
      await markEmailOtpUsed(record.id)
      console.log('\n🎉 SUCCESS! Real OTP verified successfully!')
      console.log('   - The entered code matches the database cryptographic hash.')
      console.log('   - The record has been marked as used (single-use enforced).')
    } else {
      await incrementOtpAttempts(record.id)
      console.error('\n❌ FAILED! The entered OTP did not match.')
    }
    process.exit(isValid ? 0 : 1)
  })
}

run().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
