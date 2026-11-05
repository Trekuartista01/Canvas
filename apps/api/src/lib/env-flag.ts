import { z } from "zod";

/**
 * An on/off setting from .env. z.coerce.boolean() can't be used for these: it
 * reads the text "false" as true. A typo stops the app at startup rather than
 * quietly picking a side.
 */
export const envFlag = (fallback: boolean) =>
  z
    .enum(["true", "false", ""])
    .optional()
    .transform((value) => (value ? value === "true" : fallback));
