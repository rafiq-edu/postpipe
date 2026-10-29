import { z } from "zod";
import { ERROR_CODES } from "../errors";

export const UuidSchema = z.uuid();
export const ModeSchema = z.enum(["live", "test"]);
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    code: z.enum(ERROR_CODES).optional(),
  })
  .meta({ id: "Problem" });

export const ListSchema = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), next_cursor: z.string().nullable() });
