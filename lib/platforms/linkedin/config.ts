import { z } from "zod";

// Field names follow POST /rest/posts (linkedin.md section 4, "Text post" and visibility list).
export const LinkedInConfigSchema = z
  .object({
    // CONTAINER is left out: it needs a group, which linkedin.md section 1 marks UNVERIFIED.
    visibility: z.enum(["PUBLIC", "CONNECTIONS", "LOGGED_IN"]).optional(),
    is_reshare_disabled_by_author: z.boolean().optional(),
  })
  .strict();
