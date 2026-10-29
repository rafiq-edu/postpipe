import { z } from "zod";
import { ApiError } from "./errors";

export const LIST_LIMIT_MAX = 100;
export const LIST_LIMIT_DEFAULT = 20;

export const ListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIST_LIMIT_MAX)
    .default(LIST_LIMIT_DEFAULT),
  cursor: z.string().max(512).optional(),
});

export function parseListQuery<T extends z.ZodObject>(
  url: URL,
  extra?: T,
): z.output<typeof ListQuerySchema> & z.output<T> {
  const schema = ListQuerySchema.extend(extra?.shape ?? {});
  const result = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!result.success)
    throw new ApiError(422, "validation_failed", "Query is invalid", {
      errors: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  // extend() with a generic shape loses the static type; the schema above is the check
  return result.data as z.output<typeof ListQuerySchema> & z.output<T>;
}

export interface Cursor {
  created_at: string;
  id: string;
}

const CursorSchema = z.object({
  created_at: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(s: string): Cursor {
  try {
    const c = CursorSchema.parse(
      JSON.parse(Buffer.from(s, "base64url").toString()),
    );
    return { created_at: c.created_at, id: c.id };
  } catch {
    throw new ApiError(422, "validation_failed", "cursor is invalid");
  }
}

// Q is a PostgREST filter builder; lists order by created_at desc, id desc.
export function applyCursor<Q extends { or(filters: string): Q }>(
  q: Q,
  cursor?: string,
): Q {
  if (!cursor) return q;
  const c = decodeCursor(cursor);
  return q.or(
    `created_at.lt.${c.created_at},and(created_at.eq.${c.created_at},id.lt.${c.id})`,
  );
}

export function pageOf<T extends Cursor>(
  rows: T[],
  limit: number,
): { data: T[]; next_cursor: string | null } {
  const last = rows[limit - 1];
  return {
    data: rows.slice(0, limit),
    next_cursor:
      rows.length > limit && last
        ? encodeCursor({ created_at: last.created_at, id: last.id })
        : null,
  };
}
