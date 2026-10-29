import { z } from "zod";

// Field names follow POST /v5/pins (pinterest.md section 1). Lengths are checked in rules.ts so each gets its own code.
// `board_id` is optional here: a missing one is the `board_required` violation (pinterest.md section 4).
export const PinterestConfigSchema = z
  .object({
    board_id: z.string().optional(),
    board_section_id: z.string().optional(),
    title: z.string().optional(),
    link: z.string().url().optional(),
    alt_text: z.string().optional(),
  })
  .strict();
