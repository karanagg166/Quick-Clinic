import { NextRequest } from "next/server";
import { createToken } from "@/lib/auth";

// Business-logic suites run as an authenticated administrator. Security suites
// separately exercise owner, participant, role and anonymous restrictions.
export const businessTestAdmin = {
  id: "u_1", role: "ADMIN", isActive: true,
  email: "admin@example.test", name: "Test admin",
} as const;

export async function authenticatedRequestClass() {
  const token = await createToken({ id: businessTestAdmin.id, role: businessTestAdmin.role });
  return class AuthenticatedRequest extends NextRequest {
    constructor(input: ConstructorParameters<typeof NextRequest>[0], init?: ConstructorParameters<typeof NextRequest>[1]) {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${token}`);
      super(input, { ...init, headers });
    }
  };
}
