import type { z } from "zod";
import { AppError } from "../errors.ts";

// Parse + validate `data` with a Zod schema. Returns the parsed (trimmed, coerced, typed) value,
// or throws AppError(422, VALIDATION_ERROR) with one { field, message } per failed field.
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      // ["a", "b"] -> "a.b"; empty path (e.g. body is not an object) -> "body"
      field: issue.path.join(".") || "body",
      message: issue.message,
    }));
    throw new AppError(422, "VALIDATION_ERROR", "Input tidak valid.", details);
  }
  return result.data;
}
