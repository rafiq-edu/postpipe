import type { z } from "zod";
import { ApiError } from "./errors";

export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new ApiError(422, "validation_failed", "Request body is invalid", {
      errors: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  return result.data;
}
