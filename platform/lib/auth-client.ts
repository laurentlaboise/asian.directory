import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client. Same-origin, so no baseURL needed.
 * Exposes signIn / signUp / signOut / useSession to client components.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
