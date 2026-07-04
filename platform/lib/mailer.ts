import { env } from "@/lib/env";

/**
 * OTP delivery. A real provider (Resend/SES/Postmark) is wired later; until then this logs in
 * dev. It FAILS CLOSED in production if no sender is configured — better to block Tier-1
 * verification than to silently "succeed" without actually delivering a code.
 */
export async function sendOtpEmail(to: string, code: string): Promise<void> {
  if (env.NODE_ENV === "production" && !env.MAIL_FROM) {
    throw new Error("Email delivery is not configured (set MAIL_FROM + a provider).");
  }
  // eslint-disable-next-line no-console
  console.log(`[otp] would email ${to}: verification code ${code}`);
}
