import { z } from "zod";

export const setActiveSchema = z.object({
  platform: z.enum(["facebook", "instagram", "tiktok"]),
  active: z.coerce.boolean(),
});