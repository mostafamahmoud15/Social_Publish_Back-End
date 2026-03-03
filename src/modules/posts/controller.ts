import { NextFunction, Response } from "express";
import Post from "./model";
import AppError from "../../utils/AppError";
import { ConnectedAccount } from "../integrations/ConnectedAccount";
import { AuthenticatedRequest } from "../../types/express";
import { publishFacebookMultiPhotoPost } from "../../services/metaPublish/facebookPublish";
import { publishInstagramImages } from "../../services/metaPublish/instagramPublish";
import { publishTikTokVideo } from "../../services/tiktokPublish/tiktokPublish";
import { sendSuccess } from "../../utils/response";
import { ApiFeatures } from "../../utils/ApiFeatures";

type Platform = "facebook" | "instagram" | "tiktok";
type PostStatus = "draft" | "queued" | "publishing" | "published" | "partial" | "failed";

/**
 * Builds the final post message.
 * - Adds "#" to hashtags if missing
 * - Joins caption and hashtags with spacing
 */
function buildMessage(caption: string, hashtags: string[]) {
  // Ensure every hashtag starts with "#"
  const tags = (hashtags ?? [])
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .join(" ");

  // Combine caption + hashtags
  // Adds a blank line between them if both exist
  return [caption?.trim(), tags]
    .filter(Boolean) // remove empty values
    .join("\n\n");
}


/**
 * Safely converts any value to an array of strings.
 * - If input is not an array → return empty array
 * - Removes empty/falsy values
 * - Forces all items to be strings
 */
function asStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];

  return v
    .filter(Boolean) // remove null/undefined/""/0/false
    .map(String);    // convert everything to string
}

/**
 * Reads the targets object and returns the platforms that are set to true.
 * Example:
 * { facebook: true, instagram: false, tiktok: true } -> ["facebook", "tiktok"]
 */
function getSelectedPlatforms(targets: any): Platform[] {
  return (Object.entries(targets || {}) as Array<[Platform, any]>)
    .filter(([_, v]) => v === true) // only keep explicitly selected platforms
    .map(([k]) => k);               // return platform names
}

/**
 * Checks if a platform supports the current media type.
 * - Facebook/Instagram: images only
 * - TikTok: video only
 */
function isPlatformCompatible(p: Platform, mediaKind: "images" | "video") {
  if ((p === "facebook" || p === "instagram") && mediaKind !== "images") return false;
  if (p === "tiktok" && mediaKind !== "video") return false;
  return true;
}

/**
 * Marks selected platforms as failed if they can't handle the current media kind.
 * This keeps publishResults consistent even before we try publishing.
 */
function markIncompatiblePlatforms(
  post: any,
  selected: Platform[],
  mediaKind: "images" | "video"
) {
  // Ensure object exists (safety)
  post.publishResults = post.publishResults || {};

  for (const p of selected) {
    if (isPlatformCompatible(p, mediaKind)) continue;

    post.publishResults[p] = {
      status: "failed",
      externalId: null,
      error:
        p === "tiktok"
          ? "This platform requires a video"
          : "This platform currently supports images only",
      publishedAt: null,
    };
  }
}

/**
 * Loads active connected accounts for the given user and platforms.
 * Returns a Map for fast lookup by platform.
 */
async function loadActiveAccounts(userId: string, platforms: Platform[]) {
  const accounts = await ConnectedAccount.find({
    userId,
    platform: { $in: platforms },
    isActive: true,
  })
    .select("platform accountExternalId accountName +accessToken")
    .lean(); // lighter than full mongoose documents

  // Map: platform -> account
  return new Map(accounts.map((a: any) => [a.platform as Platform, a]));
}

/**
 * Marks platforms as failed when the user has no active connected account for them.
 */
function markMissingAccounts(post: any, missing: Platform[]) {
  // Ensure publishResults exists before writing into it
  post.publishResults = post.publishResults || {};

  for (const p of missing) {
    post.publishResults[p] = {
      status: "failed",
      externalId: null,
      error: "Platform not connected/active",
      publishedAt: null,
    };
  }
}

/**
 * Extracts image URLs from the media object.
 * Returns a clean list of non-empty URLs.
 */
function extractImageUrls(media: any): string[] {
  const imgs = Array.isArray(media?.images) ? media.images : [];

  return imgs
    .map((img: any) => String(img?.url || "").trim())
    .filter(Boolean);
}

/**
 * Publish to Facebook only when:
 * - media is images
 * - facebook target is selected
 * - user has an active connected Facebook account
 */
async function publishFacebookIfNeeded(args: {
  post: any;
  targets: any;
  media: any;
  byPlatform: Map<Platform, any>;
  message: string;
  imageUrls: string[];
}) {
  const { post, targets, media, byPlatform, message, imageUrls } = args;

  // Not applicable for this post
  if (!(media.kind === "images" && targets.facebook === true && byPlatform.has("facebook"))) return;

  // Ensure publishResults exists
  post.publishResults = post.publishResults || {};

  // Safety: avoid calling API with empty media
  if (!imageUrls?.length) {
    post.publishResults.facebook = {
      status: "failed",
      externalId: null,
      error: "No images provided for Facebook",
      publishedAt: null,
    };
    return;
  }

  try {
    const fbAcc: any = byPlatform.get("facebook");

    const fb = await publishFacebookMultiPhotoPost({
      pageId: fbAcc.accountExternalId,
      pageAccessToken: fbAcc.accessToken,
      message,
      imageUrls,
    });

    post.publishResults.facebook = {
      status: "published",
      externalId: fb.postId,
      error: null,
      publishedAt: new Date(),
    };
  } catch (e: any) {
    post.publishResults.facebook = {
      status: "failed",
      externalId: null,
      error: e?.response?.data?.error?.message || e?.message || "Facebook publish failed",
      publishedAt: null,
    };
  }
}

/**
 * Publish to Instagram only when:
 * - media is images
 * - instagram target is selected
 * - user has an active connected Instagram account
 */
async function publishInstagramIfNeeded(args: {
  post: any;
  targets: any;
  media: any;
  byPlatform: Map<Platform, any>;
  message: string;
  imageUrls: string[];
}) {
  const { post, targets, media, byPlatform, message, imageUrls } = args;

  if (!(media.kind === "images" && targets.instagram === true && byPlatform.has("instagram"))) return;

  post.publishResults = post.publishResults || {};

  if (!imageUrls?.length) {
    post.publishResults.instagram = {
      status: "failed",
      externalId: null,
      error: "No images provided for Instagram",
      publishedAt: null,
    };
    return;
  }

  try {
    const igAcc: any = byPlatform.get("instagram");

    const ig = await publishInstagramImages({
      igUserId: igAcc.accountExternalId,
      accessToken: igAcc.accessToken,
      caption: message,
      imageUrls,
    });

    post.publishResults.instagram = {
      status: "published",
      externalId: ig.mediaId,
      error: null,
      publishedAt: new Date(),
    };
  } catch (e: any) {
    post.publishResults.instagram = {
      status: "failed",
      externalId: null,
      error: e?.response?.data?.error?.message || e?.message || "Instagram publish failed",
      publishedAt: null,
    };
  }
}

/**
 * Publish to TikTok only when:
 * - media is video
 * - tiktok target is selected
 * - user has an active connected TikTok account
 */
async function publishTikTokIfNeeded(args: {
  post: any;
  targets: any;
  media: any;
  byPlatform: Map<Platform, any>;
  message: string;
  tiktokSettings: any;
}) {
  const { post, targets, media, byPlatform, message, tiktokSettings } = args;

  if (!(media.kind === "video" && targets.tiktok === true && byPlatform.has("tiktok"))) return;

  post.publishResults = post.publishResults || {};

  // TikTok requires privacy settings
  if (!tiktokSettings?.privacy_level) {
    post.publishResults.tiktok = {
      status: "failed",
      externalId: null,
      error: "Missing tiktokSettings.privacy_level",
      publishedAt: null,
    };
    return;
  }

  // Safety: ensure video URL exists
  const videoUrl = media?.video?.url;
  if (!videoUrl) {
    post.publishResults.tiktok = {
      status: "failed",
      externalId: null,
      error: "Video url is missing",
      publishedAt: null,
    };
    return;
  }

  try {
    const ttAcc: any = byPlatform.get("tiktok");

    // Token must exist (select +accessToken already, but keep safety)
    if (!ttAcc?.accessToken) {
      post.publishResults.tiktok = {
        status: "failed",
        externalId: null,
        error: "TikTok access token missing",
        publishedAt: null,
      };
      return;
    }

    const result = await publishTikTokVideo({
      accessToken: ttAcc.accessToken,
      videoUrl,
      caption: message,
      privacy_level: tiktokSettings.privacy_level,
      disable_comment: Boolean(tiktokSettings.disable_comment),
      disable_duet: Boolean(tiktokSettings.disable_duet),
      disable_stitch: Boolean(tiktokSettings.disable_stitch),
    });

    post.publishResults.tiktok = {
      status: "published",
      externalId: result.publish_id,
      error: null,
      publishedAt: new Date(),
    };
  } catch (e: any) {
    post.publishResults.tiktok = {
      status: "failed",
      externalId: null,
      error: e?.message || "TikTok publish failed",
      publishedAt: null,
    };
  }
}

/**
 * Calculates the final post status based on per-platform publish results.
 *
 * Rules:
 * - If at least one platform succeeded:
 *     - and others failed/idle -> "partial"
 *     - and all succeeded      -> "published"
 * - If none succeeded -> "failed"
 */
export function finalizeStatus(post: any): {
  status: PostStatus;
  publishedPlatforms: Platform[];
  failedPlatforms: Platform[];
  idlePlatforms: Platform[];
} {
  const results = post.publishResults || {};
  const targets = post.targets || {};

  const platforms: Platform[] = ["facebook", "instagram", "tiktok"];

  // Only consider platforms that were selected by the user
  const targeted = platforms.filter((p) => targets?.[p] === true);

  const publishedPlatforms: Platform[] = [];
  const failedPlatforms: Platform[] = [];
  const idlePlatforms: Platform[] = [];

  for (const p of targeted) {
    const s = results?.[p]?.status;

    if (s === "published") {
      publishedPlatforms.push(p);
    } else if (s === "failed") {
      failedPlatforms.push(p);
    } else {
      // idle or undefined
      idlePlatforms.push(p);
    }
  }

  const anyPublished = publishedPlatforms.length > 0;

  let status: PostStatus;

  if (anyPublished) {
    status =
      failedPlatforms.length > 0 || idlePlatforms.length > 0
        ? "partial"
        : "published";
  } else {
    status = "failed";
  }

  return {
    status,
    publishedPlatforms,
    failedPlatforms,
    idlePlatforms,
  };
}

// function validateBasicsOrThrow(body: any) {
//   const { action, media } = body;

//   if (action !== "draft" && action !== "publish") {
//     throw new AppError("Invalid action", 400, [{ field: "action", message: "Must be draft or publish" }]);
//   }

//   if (!media || (media.kind !== "images" && media.kind !== "video")) {
//     throw new AppError("Unsupported media type", 400, [{ field: "media.kind", message: "Must be images or video" }]);
//   }

//   if (media.kind === "images") {
//     const imgs = Array.isArray(media.images) ? media.images : [];
//     if (imgs.length === 0) {
//       throw new AppError("Invalid media", 400, [{ field: "media.images", message: "At least one image is required" }]);
//     }
//   }

//   if (media.kind === "video") {
//     if (!media.video?.url) {
//       throw new AppError("Invalid media", 400, [{ field: "media.video.url", message: "Video url is required" }]);
//     }
//   }
// }

/**
 * Create a post.
 * - draft: save and return
 * - publish: try to publish to selected platforms (if compatible + connected)
 */
export const createPost = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const userId = req.user?._id;
  if (!userId) return next(new AppError("Unauthorized", 401));

  // // Extra safety validation (even if Zod exists)
  // try {
  //   validateBasicsOrThrow(req.body);
  // } catch (e) {
  //   return next(e as any);
  // }

  const {
    action,
    caption = "",
    hashtags = [],
    targets = {},
    media,
    tiktokSettings,
  } = req.body;

  // Build the final caption (caption + hashtags)
  const hashtagsArr = asStringArray(hashtags);
  const message = buildMessage(String(caption || ""), hashtagsArr);

  // Create DB record first
  const post = await Post.create({
    user: userId,
    action,
    status: action === "draft" ? "draft" : "queued",
    caption,
    hashtags: hashtagsArr,
    targets,
    media,
  });

  // Draft: stop here (no external publishing)
  if (action === "draft") {
    return sendSuccess(req, res, { post }, 201);
  }

  // Selected platforms
  const selected = getSelectedPlatforms(targets);

  // No platforms selected: save only
  if (selected.length === 0) {
    post.status = "queued";
    await post.save();

    return sendSuccess(
      req,
      res,
      { post, note: "No platforms selected. Post saved without external publishing." },
      201
    );
  }

  // Mark incompatible targets as failed
  markIncompatiblePlatforms(post, selected, media.kind);
  const compatibleSelected = selected.filter((p) => isPlatformCompatible(p, media.kind));

  if (compatibleSelected.length === 0) {
    post.status = "failed";
    await post.save();

    return sendSuccess(
      req,
      res,
      { post, note: "Selected platforms are incompatible with the media type." },
      201
    );
  }

  // Load active connected accounts
  const byPlatform = await loadActiveAccounts(String(userId), compatibleSelected);

  // Mark missing accounts as failed
  const missing = compatibleSelected.filter((p) => !byPlatform.has(p));
  markMissingAccounts(post, missing);

  if (missing.length === compatibleSelected.length) {
    post.status = "failed";
    await post.save();

    return sendSuccess(
      req,
      res,
      { post, note: "Selected platforms are not connected/active. Nothing was published." },
      201
    );
  }

  // Publish
  post.status = "publishing";
  await post.save();

  const imageUrls = media.kind === "images" ? extractImageUrls(media) : [];

  await publishFacebookIfNeeded({ post, targets, media, byPlatform, message, imageUrls });
  await publishInstagramIfNeeded({ post, targets, media, byPlatform, message, imageUrls });
  await publishTikTokIfNeeded({ post, targets, media, byPlatform, message, tiktokSettings });

  // Finalize status based on per-platform results
  const fin = finalizeStatus(post);
  post.status = fin.status;
  await post.save();

  return sendSuccess(
    req,
    res,
    { post, meta: { publishedPlatforms: fin.publishedPlatforms, failedPlatforms: fin.failedPlatforms } },
    201
  );
};

/**
 * List posts (paginated + optional search).
 * Owners can see all posts, others only see their own.
 */
export const getAllPosts = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const user = req.user;
  if (!user?._id) return next(new AppError("Unauthorized", 401));

  const isOwner = user.role === "owner";
  const baseFilter = isOwner ? {} : { user: user._id };

  const features = new ApiFeatures(Post.find(baseFilter), req.query)
    .search(["caption", "hashtags"])
    .paginate(10, 50);

  // Count must match the same filter used in the query
  const total = await Post.countDocuments({ ...baseFilter, ...(features.filter || {}) });

  const items = await features.mongooseQuery
    .sort({ createdAt: -1 })
    .populate({ path: "user", select: "username" });

  return sendSuccess(req, res, { items, meta: features.meta(total) }, 200);
};


/**
 * Get a single post by id.
 * - Owner can view any post
 * - Normal user can view only their own posts
 */
export const getPost = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const user = req.user;
  if (!user?._id) return next(new AppError("Unauthorized", 401));

  // Load post by id
  const post = await Post.findById(req.params.id);
  if (!post) return next(new AppError("Post not found", 404));

  // Enforce ownership unless the user is an owner
  const isOwner = user.role === "owner";
  if (!isOwner && String((post as any).user) !== String(user._id)) {
    return next(new AppError("Forbidden", 403));
  }

  // sendSuccess reads requestId from req
  return sendSuccess(req, res, { post }, 200);
};





function shouldRetryPlatform(post: any, p: Platform) {
  const r = post?.publishResults?.[p];
  if (r?.status === "published") return false;
  return r?.status === "failed" || r?.status === "idle" || !r?.status;
}

function setPlatformResult(post: any, p: Platform, patch: any) {
  post.publishResults = post.publishResults || {};
  post.publishResults[p] = {
    status: patch.status ?? post.publishResults?.[p]?.status ?? "idle",
    externalId: patch.externalId ?? null,
    error: patch.error ?? null,
    publishedAt: patch.publishedAt ?? null,
  };
}








function parsePlatform(v: any): Platform | null {
  if (!v) return null;
  const s = String(v).toLowerCase().trim();
  if (s === "facebook" || s === "instagram" || s === "tiktok") return s;
  return null;
}




export const retryPublishPost = async (req: any, res: Response, next: NextFunction) => {
  const user = req.user;
  if (!user?._id) return next(new AppError("Unauthorized", 401));

  const postId = req.params.id;

  // (A) اقرأ للتأكد من الملكية
  const existing = await Post.findById(postId);
  if (!existing) return next(new AppError("Post not found", 404));

  const isOwner = user.role === "owner";
  if (!isOwner && String((existing as any).user) !== String(user._id)) {
    return next(new AppError("Forbidden", 403));
  }

  if ((existing as any).action !== "publish") {
    return next(new AppError("This post is not a publish action", 400));
  }

  // (B) Lock atomic لمنع double retry
  const locked = await Post.findOneAndUpdate(
    { _id: postId, status: { $ne: "publishing" } },
    { $set: { status: "publishing" } },
    { new: true }
  );
  if (!locked) return next(new AppError("Post is currently publishing", 409));

  const post: any = locked;

  try {
    const targets = post.targets || {};
    const media = post.media;

    if (!media || (media.kind !== "images" && media.kind !== "video")) {
      post.status = "failed";
      await post.save();
      return next(new AppError("Unsupported media type", 400));
    }

    // (C) تحديد المنصة (اختياري)
    const onlyPlatform = parsePlatform(req.query.platform);

    // المنصات المستهدفة فقط
    const allPlatforms: Platform[] = ["facebook", "instagram", "tiktok"];
    const targeted = allPlatforms.filter((p) => targets?.[p] === true);

    if (targeted.length === 0) {
      const fin0 = finalizeStatus(post);
      post.status = fin0.status;
      await post.save();
      return res.status(200).json({
        success: true,
        data: { post, note: "No platforms selected for this post." },
        requestId: req.requestId,
      });
    }

    // (D) منصات هنعيد عليها
    let candidates = targeted
      .filter((p) => isPlatformCompatible(p, media.kind))
      .filter((p) => shouldRetryPlatform(post, p));

    if (onlyPlatform) candidates = candidates.filter((p) => p === onlyPlatform);

    if (candidates.length === 0) {
      const fin0 = finalizeStatus(post);
      post.status = fin0.status;
      await post.save();
      return res.status(200).json({
        success: true,
        data: { post, note: "Nothing to retry for the selected platform(s)." },
        requestId: req.requestId,
      });
    }

    // (E) Reload accounts
    const byPlatform = await loadActiveAccounts(String(post.user), candidates);

    // reset/mark missing
    for (const p of candidates) {
      if (!byPlatform.has(p)) {
        setPlatformResult(post, p, {
          status: "failed",
          externalId: null,
          error: "Platform not connected/active",
          publishedAt: null,
        });
      } else {
        setPlatformResult(post, p, {
          status: "idle",
          externalId: null,
          error: null,
          publishedAt: null,
        });
      }
    }

    const runnable = candidates.filter((p) => byPlatform.has(p));
    if (runnable.length === 0) {
      const finX = finalizeStatus(post);
      post.status = finX.status;
      await post.save();
      return res.status(200).json({
        success: true,
        data: { post, note: "No active connected accounts for retry platforms." },
        requestId: req.requestId,
      });
    }

    const message = buildMessage(String(post.caption || ""), asStringArray(post.hashtags || []));
    const imageUrls = media.kind === "images" ? extractImageUrls(media) : [];

    // (F) Publish
    if (runnable.includes("facebook") && media.kind === "images") {
      try {
        const fbAcc: any = byPlatform.get("facebook");
        const fb = await publishFacebookMultiPhotoPost({
          pageId: fbAcc.accountExternalId,
          pageAccessToken: fbAcc.accessToken,
          message,
          imageUrls,
        });
        setPlatformResult(post, "facebook", { status: "published", externalId: fb.postId, error: null, publishedAt: new Date() });
      } catch (e: any) {
        setPlatformResult(post, "facebook", { status: "failed", externalId: null, error: e?.message || "Facebook publish failed", publishedAt: null });
      }
    }

    if (runnable.includes("instagram") && media.kind === "images") {
      try {
        const igAcc: any = byPlatform.get("instagram");
        const ig = await publishInstagramImages({
          igUserId: igAcc.accountExternalId,
          accessToken: igAcc.accessToken,
          caption: message,
          imageUrls,
        });
        setPlatformResult(post, "instagram", { status: "published", externalId: ig.mediaId, error: null, publishedAt: new Date() });
      } catch (e: any) {
        setPlatformResult(post, "instagram", { status: "failed", externalId: null, error: e?.message || "Instagram publish failed", publishedAt: null });
      }
    }

    if (runnable.includes("tiktok") && media.kind === "video") {
      try {
        const ttAcc: any = byPlatform.get("tiktok");
        const tiktokSettings = req.body?.tiktokSettings || {};

        if (!tiktokSettings?.privacy_level) {
          setPlatformResult(post, "tiktok", { status: "failed", externalId: null, error: "Missing tiktokSettings.privacy_level", publishedAt: null });
        } else if (!ttAcc?.accessToken) {
          setPlatformResult(post, "tiktok", { status: "failed", externalId: null, error: "TikTok access token missing", publishedAt: null });
        } else {
          const result = await publishTikTokVideo({
            accessToken: ttAcc.accessToken,
            videoUrl: media.video.url,
            caption: message,
            privacy_level: tiktokSettings.privacy_level,
            disable_comment: Boolean(tiktokSettings.disable_comment),
            disable_duet: Boolean(tiktokSettings.disable_duet),
            disable_stitch: Boolean(tiktokSettings.disable_stitch),
          });
          setPlatformResult(post, "tiktok", { status: "published", externalId: result.publish_id, error: null, publishedAt: new Date() });
        }
      } catch (e: any) {
        setPlatformResult(post, "tiktok", { status: "failed", externalId: null, error: e?.message || "TikTok publish failed", publishedAt: null });
      }
    }

    // (G) finalize + save
    const fin = finalizeStatus(post);
    post.status = fin.status;
    await post.save();

    return res.status(200).json({
      success: true,
      data: {
        post,
        meta: {
          retriedPlatforms: candidates,
          publishedPlatforms: fin.publishedPlatforms,
          failedPlatforms: fin.failedPlatforms,
          idlePlatforms: fin.idlePlatforms,
        },
      },
      requestId: req.requestId,
    });
  } catch (err) {
    // فك الـ lock بحالة منطقية
    try {
      const fin = finalizeStatus(post);
      post.status = fin.status;
      await post.save();
    } catch { }
    return next(err);
  }
};



export const deletePost = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { postId } = req.params;
  const post = await Post.findByIdAndDelete(postId);
  if (!post) return next(new AppError("Post not found", 404));
  return res.status(200).json({ success: true, data: { post }, requestId: req.requestId });
};