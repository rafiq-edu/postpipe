import { type ZodTypeAny, z } from "zod";
import { PLATFORM_CONFIG_SCHEMAS } from "../../platforms/config-schemas";
import type { Platform } from "../../platforms/types";

export const PlatformConfigurationsSchema = z.strictObject(
  Object.fromEntries(
    Object.entries(PLATFORM_CONFIG_SCHEMAS).map(([p, s]) => [
      p,
      (s as ZodTypeAny).optional(),
    ]),
  ),
);

export function platformConfigSchema(
  platform: Platform,
): ZodTypeAny | undefined {
  return PLATFORM_CONFIG_SCHEMAS[platform];
}
