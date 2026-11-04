import { z } from "zod";
import { REQUESTABLE_PEOPLE_ROLES } from "../people";

export const emailSchema = z.string().trim().toLowerCase().email();
export const passwordSchema = z.string().min(8).max(255);

export const signUpSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(100),
  inviteId: z.string().uuid().optional(),
  // Joining through an invite: a request for an Admin to approve, nothing more.
  requestedRole: z.enum(REQUESTABLE_PEOPLE_ROLES).optional(),
});

export const signUpTokenSchema = z.object({ token: z.string().min(1).max(200) });

export const completeSignUpSchema = signUpTokenSchema.extend({ password: passwordSchema });

export const requestPasswordResetSchema = z.object({ email: emailSchema });

export const logInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

// Requires re-typing your own email as an explicit confirmation step for a
// destructive, irreversible action — same "type to confirm" pattern used
// for other hard-to-reverse actions elsewhere in the product.
export const deleteAccountSchema = z.object({
  confirmEmail: z.string().trim(),
});

// Full-replace, not partial-update: bio/title always sent (empty string
// allowed, coerced to null server-side) rather than optional/nullable —
// avoids "field omitted" vs. "field cleared" ambiguity in the client form.
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  bio: z.string().trim().max(500),
  title: z.string().trim().max(100),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type LogInInput = z.infer<typeof logInSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
