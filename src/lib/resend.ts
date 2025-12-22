import { Resend } from "resend";

// Initialize Resend with API key
// During build time on Vercel, if RESEND_API_KEY is not set, use a placeholder
// The placeholder format matches Resend's expected format (starts with "re_")
// This prevents build-time errors - actual API calls will fail gracefully at runtime
// IMPORTANT: Set RESEND_API_KEY in Vercel environment variables for production
const apiKey = process.env.RESEND_API_KEY || "re_1234567890abcdef1234567890abcdef12345678";

export const resend = new Resend(apiKey);
