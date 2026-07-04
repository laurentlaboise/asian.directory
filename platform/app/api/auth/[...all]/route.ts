import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Mounts all Better Auth endpoints under /api/auth/*.
export const { GET, POST } = toNextJsHandler(auth);
