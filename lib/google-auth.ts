import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/meetings.space.created",
]

function getEncryptionKey() {
  const encoded = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
  if (!encoded) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is not configured")
  const key = Buffer.from(encoded, "base64")
  if (key.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key")
  return key
}

export function encryptGoogleToken(token: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()])
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`
}

export function decryptGoogleToken(value: string) {
  const [ivText, tagText, encryptedText] = value.split(".")
  if (!ivText || !tagText || !encryptedText) throw new Error("Stored Google token is invalid")
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivText, "base64url"))
  decipher.setAuthTag(Buffer.from(tagText, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

export function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured")
  return { clientId, clientSecret }
}

export function getGoogleScopes() {
  return GOOGLE_SCOPES
}

export function getAppUrl(fallback: string) {
  return (process.env.NEXT_PUBLIC_APP_URL || fallback).replace(/\/$/, "")
}
