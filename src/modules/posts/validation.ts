import { z } from "zod";

/**
 * Targets: which platforms to publish to.
 * All fields are optional, frontend can send only the ones it wants.
 */
const targetsSchema = z
  .object({
    facebook: z.boolean().optional(),
    instagram: z.boolean().optional(),
    tiktok: z.boolean().optional(),
  })
  .default({});

/**
 * Single image item.
 */
const imageItemSchema = z.object({
  // Optional: frontend may not send it
  kind: z.literal("image").optional(),

  url: z.url("Invalid image url"),
  publicId: z.string().min(1, "publicId is required"),
  width: z.number().int().positive("width must be positive"),
  height: z.number().int().positive("height must be positive"),
  format: z.string().optional(),
});

/**
 * Video object.
 */
const videoSchema = z.object({
  kind: z.literal("video").optional(),
  url: z.string().url("Invalid video url"),
  publicId: z.string().min(1, "publicId is required"),
  duration: z.number().positive("duration must be positive"),
  format: z.string().min(1, "format is required"),
});

/**
 * Media can be either:
 * - images: array of image items
 * - video: single video object
 */
const mediaSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("images"),
    images: z.array(imageItemSchema).min(1, "At least one image is required"),
    video: z.undefined().optional(),
  }),
  z.object({
    kind: z.literal("video"),
    video: videoSchema,
    images: z.undefined().optional(),
  }),
]);

/**
 * TikTok settings are only needed when publishing to TikTok.
 */
const tiktokSettingsSchema = z
  .object({
    privacy_level: z.string().min(1, "privacy_level is required"),
    disable_comment: z.boolean().optional(),
    disable_duet: z.boolean().optional(),
    disable_stitch: z.boolean().optional(),
  })
  .optional();

/**
 * Create post request schema.
 * Includes extra rules in superRefine based on action/targets/media.
 */
export const createPostSchema = z
  .object({
    action: z.enum(["draft", "publish"]),
    caption: z.string().max(5000, "Caption is too long").optional().default(""),
    hashtags: z.array(z.string().min(1)).optional().default([]),

    targets: targetsSchema,
    media: mediaSchema,

    // Only required when publishing to TikTok
    tiktokSettings: tiktokSettingsSchema,
  })
  .superRefine((val, ctx) => {
    const targets = val.targets || {};

    // If publishing, at least one platform must be selected
    const selectedPlatforms = Object.entries(targets)
      .filter(([_, v]) => v === true)
      .map(([k]) => k);

    if (val.action === "publish" && selectedPlatforms.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["targets"],
        message: "Select at least one platform",
      });
    }

    // Platform vs media rules
    if (val.media.kind === "images") {
      // TikTok requires video
      if (targets.tiktok === true) {
        ctx.addIssue({
          code: "custom",
          path: ["media", "kind"],
          message: "TikTok requires a video",
        });
      }
    }

    if (val.media.kind === "video") {
      // Your current rule: Facebook/Instagram images only
      if (targets.facebook === true) {
        ctx.addIssue({
          code: "custom",
          path: ["media", "kind"],
          message: "Facebook currently supports images only",
        });
      }
      if (targets.instagram === true) {
        ctx.addIssue({
          code: "custom",
          path: ["media", "kind"],
          message: "Instagram currently supports images only",
        });
      }

      // TikTok selected -> privacy_level must exist
      if (targets.tiktok === true && !val.tiktokSettings?.privacy_level) {
        ctx.addIssue({
          code: "custom",
          path: ["tiktokSettings", "privacy_level"],
          message: "privacy_level is required when publishing to TikTok",
        });
      }
    }
  });

/**
 * Valid MongoDB ObjectId param.
 */
export const idParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id"),
});