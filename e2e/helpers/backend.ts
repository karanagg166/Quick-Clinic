import { createToken } from "@/lib/auth-token";
const base = process.env.BACKEND_URL || "http://localhost:4000";
export async function initiateCheckout(input: { userId: string; patientId: string; doctorId: string; slotId: string; paymentMethod: string; idempotencyKey: string }) {
  const token = await createToken({ id: input.userId, role: "PATIENT" });
  const response = await fetch(`${base}/api/checkout`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...input, action: "INITIATE" }) });
  if (!response.ok) throw new Error(`Checkout failed: ${response.status}`);
  return response.json();
}
export async function expireDoctorHolds(_doctorId: string) {
  const response = await fetch(`${base}/api/cron/expire-appointments`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  if (!response.ok) throw new Error(`Expiry failed: ${response.status}`);
}
