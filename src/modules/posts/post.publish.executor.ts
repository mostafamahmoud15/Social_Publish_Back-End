import { Platform } from "../../types/type";
import { getProviderError } from "../../utils/publishError";
import { setPlatformResult } from "./post.helper";
import { getImageUrls } from "./post.publish.utils";

import { publishFacebookMultiPhotoPost, publishFacebookVideoPost } from "../../services/metaPublish/facebookPublish";
import { publishInstagramImages, publishInstagramVideo } from "../../services/metaPublish/instagramPublish";
import { publishTikTokVideo } from "../../services/tiktokPublish/tiktokPublish";
import { publishYouTubeVideo } from "../../services/youtubePublish/youtubePublish";

/**
 * =========================
 * Facebook Publishing Logic
 * =========================
 */
async function publishFacebook(params: {
  post: any;
  byPlatform: Map<Platform, any>;
  message: string;
  media: any;
}) {
  const { post, byPlatform, message, media } = params;

  // Skip if Facebook is not selected
  if (!byPlatform.has("facebook")) return;

  try {
    const acc: any = byPlatform.get("facebook");

    /**
     * Handle image posts
     */
    if (media.kind === "images") {
      const imageUrls = getImageUrls(media);

      if (!imageUrls.length) {
        setPlatformResult(post, "facebook", {
          status: "failed",
          externalId: null,
          error: "No images provided for Facebook",
          publishedAt: null,
        });
        return;
      }

      const result = await publishFacebookMultiPhotoPost({
        pageId: acc.accountExternalId,
        pageAccessToken: acc.accessToken,
        message,
        imageUrls,
      });

      setPlatformResult(post, "facebook", {
        status: "published",
        externalId: result.postId,
        error: null,
        publishedAt: new Date(),
      });

      return;
    }

    /**
     * Handle video posts
     */
    if (media.kind === "video") {
      const videoUrl = media?.video?.url;

      if (!videoUrl) {
        setPlatformResult(post, "facebook", {
          status: "failed",
          externalId: null,
          error: "Video url is missing",
          publishedAt: null,
        });
        return;
      }

      const result = await publishFacebookVideoPost({
        pageId: acc.accountExternalId,
        pageAccessToken: acc.accessToken,
        message,
        videoUrl,
      });

      setPlatformResult(post, "facebook", {
        status: "published",
        externalId: result.videoId,
        error: null,
        publishedAt: new Date(),
      });

      return;
    }

    /**
     * Unsupported media type
     */
    setPlatformResult(post, "facebook", {
      status: "failed",
      externalId: null,
      error: `Unsupported media kind: ${media?.kind}`,
      publishedAt: null,
    });
  } catch (e: any) {
    const { message: providerMsg } = getProviderError(
      e,
      "Facebook publish failed"
    );

    setPlatformResult(post, "facebook", {
      status: "failed",
      externalId: null,
      error: providerMsg,
      publishedAt: null,
    });
  }
}

/**
 * =========================
 * Instagram Publishing Logic
 * =========================
 */
async function publishInstagram(params: {
  post: any;
  byPlatform: Map<Platform, any>;
  message: string;
  media: any;
}) {
  const { post, byPlatform, message, media } = params;

  if (!byPlatform.has("instagram")) return;

  try {
    const acc: any = byPlatform.get("instagram");

    /**
     * Handle image posts
     */
    if (media.kind === "images") {
      const imageUrls = getImageUrls(media);

      if (!imageUrls.length) {
        setPlatformResult(post, "instagram", {
          status: "failed",
          externalId: null,
          error: "No images provided for Instagram",
          publishedAt: null,
        });
        return;
      }

      const result = await publishInstagramImages({
        igUserId: acc.accountExternalId,
        accessToken: acc.accessToken,
        caption: message,
        imageUrls,
      });

      setPlatformResult(post, "instagram", {
        status: "published",
        externalId: result.mediaId,
        error: null,
        publishedAt: new Date(),
      });

      return;
    }

    /**
     * Handle video posts
     */
    if (media.kind === "video") {
      const videoUrl = media?.video?.url;

      if (!videoUrl) {
        setPlatformResult(post, "instagram", {
          status: "failed",
          externalId: null,
          error: "Video url is missing",
          publishedAt: null,
        });
        return;
      }

      const result = await publishInstagramVideo({
        igUserId: acc.accountExternalId,
        accessToken: acc.accessToken,
        caption: message,
        videoUrl,
        shareToFeed: true,
      });

      setPlatformResult(post, "instagram", {
        status: "published",
        externalId: result.mediaId,
        error: null,
        publishedAt: new Date(),
      });

      return;
    }

    setPlatformResult(post, "instagram", {
      status: "failed",
      externalId: null,
      error: `Unsupported media kind: ${media?.kind}`,
      publishedAt: null,
    });
  } catch (e: any) {
    const { message: providerMsg } = getProviderError(
      e,
      "Instagram publish failed"
    );

    setPlatformResult(post, "instagram", {
      status: "failed",
      externalId: null,
      error: providerMsg,
      publishedAt: null,
    });
  }
}

/**
 * =========================
 * TikTok Publishing Logic
 * =========================
 */
async function publishTikTok(params: {
  post: any;
  byPlatform: Map<Platform, any>;
  message: string;
  media: any;
  tiktokSettings?: any;
}) {
  const { post, byPlatform, message, media, tiktokSettings } = params;

  // TikTok supports only video
  if (media.kind !== "video" || !byPlatform.has("tiktok")) return;

  const videoUrl = media?.video?.url;

  // Retry should default to public if no settings were provided
  const privacyLevel =
    tiktokSettings?.privacy_level || "PUBLIC_TO_EVERYONE";

  if (!videoUrl) {
    setPlatformResult(post, "tiktok", {
      status: "failed",
      externalId: null,
      error: "Video url is missing",
      publishedAt: null,
    });
    return;
  }

  try {
    const acc: any = byPlatform.get("tiktok");

    const result = await publishTikTokVideo({
      accessToken: acc.accessToken,
      videoUrl,
      caption: message,
      privacy_level: privacyLevel,
      disable_comment: Boolean(tiktokSettings?.disable_comment),
      disable_duet: Boolean(tiktokSettings?.disable_duet),
      disable_stitch: Boolean(tiktokSettings?.disable_stitch),
      forcePrivate: false,
    });

    setPlatformResult(post, "tiktok", {
      status: "published",
      externalId: result.publish_id,
      error: null,
      publishedAt: new Date(),
    });
  } catch (e: any) {
    const { message: providerMsg } = getProviderError(e, "TikTok publish failed");

    setPlatformResult(post, "tiktok", {
      status: "failed",
      externalId: null,
      error: providerMsg,
      publishedAt: null,
    });
  }
}

/**
 * =========================
 * YouTube Publishing Logic
 * =========================
 */
async function publishYouTube(params: {
  post: any;
  byPlatform: Map<Platform, any>;
  message: string;
  media: any;
  youtubeSettings?: any;
}) {
  const { post, byPlatform, media, youtubeSettings } = params;

  if (media.kind !== "video" || !byPlatform.has("youtube")) return;

  const videoUrl = media?.video?.url;

  if (!videoUrl) {
    setPlatformResult(post, "youtube", {
      status: "failed",
      externalId: null,
      error: "Video url is missing",
      publishedAt: null,
    });
    return;
  }

  try {
    const acc: any = byPlatform.get("youtube");

    if (!acc?.accessToken) {
      setPlatformResult(post, "youtube", {
        status: "failed",
        externalId: null,
        error: "YouTube access token missing",
        publishedAt: null,
      });
      return;
    }

    const result = await publishYouTubeVideo({
      accessToken: acc.accessToken,
      refreshToken: acc.meta?.refreshToken,
      videoUrl,
      title:
        youtubeSettings?.title ||
        String(post.caption || "").slice(0, 100) ||
        "Untitled video",
      privacyStatus: "public",
    });

    setPlatformResult(post, "youtube", {
      status: "published",
      externalId: result.videoId,
      error: null,
      publishedAt: new Date(),
    });
  } catch (e: any) {
    const { message: providerMsg } = getProviderError(e, "YouTube publish failed");

    setPlatformResult(post, "youtube", {
      status: "failed",
      externalId: null,
      error: providerMsg,
      publishedAt: null,
    });
  }
}

/**
 * =========================
 * Main Executor
 * =========================
 *
 * Responsible for running publishing across all selected platforms.
 * Each platform handles its own validation + defaults internally.
 */
export async function executePublishing(params: {
  post: any;
  platforms: Platform[];
  byPlatform: Map<Platform, any>;
  media: any;
  message: string;
  tiktokSettings?: any;
  youtubeSettings?: any;
}) {
  const {
    post,
    platforms,
    byPlatform,
    media,
    message,
    tiktokSettings,
    youtubeSettings,
  } = params;

  /**
   * Build a filtered map of only connected platforms
   */
  const runnableMap = new Map<Platform, any>();

  for (const p of platforms) {
    if (byPlatform.has(p)) {
      runnableMap.set(p, byPlatform.get(p));
    }
  }

  /**
   * Execute publishing sequentially
   * (can be parallelized later if needed)
   */
  await publishFacebook({ post, byPlatform: runnableMap, message, media });
  await publishInstagram({ post, byPlatform: runnableMap, message, media });
  await publishTikTok({
    post,
    byPlatform: runnableMap,
    message,
    media,
    tiktokSettings,
  });
  await publishYouTube({
    post,
    byPlatform: runnableMap,
    message,
    media,
    youtubeSettings,
  });
}