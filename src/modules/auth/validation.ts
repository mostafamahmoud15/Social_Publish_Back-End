import { z } from "zod";

/**
 * ==============================
 * Login Validation Schema
 * ==============================
 * Validates login request body.
 */
const loginSchema = z.object({
  // Email must be a valid email format
  email: z.email({ message: "Invalid email" }),

  // Password rules (example):
  // - starts with special char
  // - includes letters
  // - includes at least 2 digits
  // - ends with special char
  password: z
    .string()
    .regex(
      /^[!@#$%^&*]{1}[A-Za-z]{3,}[0-9]{2,}[!@#$%^&*]{1}$/,
      "Password must start/end with a special char, include letters and at least 2 digits"
    ),
});

export default loginSchema;