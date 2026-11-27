import { z } from "zod";

import { USER_NAME_MAX_LENGTH } from "@/lib/auth/profile";

/** Client-side form rules (PROJECT F11); the server enforces the same limits (ARCHITECTURE §7). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const email = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .pipe(z.email("Enter a valid email address, like name@example.com."));

export const SignInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

export const SignUpSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(USER_NAME_MAX_LENGTH, `Use ${USER_NAME_MAX_LENGTH} characters or fewer.`),
  email,
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH, `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`),
});

export type SignInValues = z.output<typeof SignInSchema>;
export type SignUpValues = z.output<typeof SignUpSchema>;
export type AuthFieldName = "name" | "email" | "password";
export type AuthFieldErrors = Partial<Record<AuthFieldName, string>>;

/** First message per field of a failed parse. */
export function toFieldErrors(error: z.ZodError): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if ((field === "name" || field === "email" || field === "password") && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}
