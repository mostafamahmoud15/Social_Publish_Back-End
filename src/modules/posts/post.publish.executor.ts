import { Platform } from "../../types/type";
import { getProviderError } from "../../utils/publishError";
import { setPlatformResult } from "./post.helper";
import { getImageUrls } from "./post.publish.utils";

import { publishFacebookMultiPhotoPost, publishFacebookVideoPost } from "../../services/metaPublish/facebookPublish";
import { publishInstagramImages, publishInstagramVideo } from "../../services/metaPublish/instagramPublish";
import { publishTikTokVideo } from "../../services/tiktokPublish/tiktokPublish";
import { publishYouTubeVideo } from "../../services/youtubePublish/youtubePublish";

async function publishFacebook(params: {
  post: any;
  byPlatform: Map<Platform, any>;
  message: string;
  media: any;
}) {
  const { post, byPlatform, message, media } = params;

  if (!byPlatform.has("facebook")) return;

  try {
    const acc: any = byPlatform.get("facebook");

    /**
     * ✅ Images
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
     * ✅ Video
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
     * ❌ Unsupported
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
     * ✅ Images
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
     * ✅ Video
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

    /**
     * ❌ Unsupported
     */
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

async function publishTikTok(params: {
  post: any;
  byPlatform: Map<Platform, any>;
  message: string;
  media: any;
  tiktokSettings?: any;
}) {
  const { post, byPlatform, message, media, tiktokSettings } = params;

  if (media.kind !== "video" || !byPlatform.has("tiktok")) return;

  const videoUrl = media?.video?.url;

  if (!tiktokSettings?.privacy_level) {
    setPlatformResult(post, "tiktok", {
      status: "failed",
      externalId: null,
      error: "Missing tiktokSettings.privacy_level",
      publishedAt: null,
    });
    return;
  }

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
      privacy_level: tiktokSettings.privacy_level,
      disable_comment: Boolean(tiktokSettings.disable_comment),
      disable_duet: Boolean(tiktokSettings.disable_duet),
      disable_stitch: Boolean(tiktokSettings.disable_stitch),
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

async function publishYouTube(params: {
  post: any;
  byPlatform: Map<Platform, any>;
  message: string;
  media: any;
  youtubeSettings?: any;
}) {
  const { post, byPlatform, message, media, youtubeSettings } = params;

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
      description: youtubeSettings?.description || message || "",
      privacyStatus: youtubeSettings?.privacyStatus || "private",
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

  const runnableMap = new Map<Platform, any>();

  for (const p of platforms) {
    if (byPlatform.has(p)) {
      runnableMap.set(p, byPlatform.get(p));
    }
  }

  await publishFacebook({ post, byPlatform: runnableMap, message, media });
  await publishInstagram({ post, byPlatform: runnableMap, message, media });
  await publishTikTok({ post, byPlatform: runnableMap, message, media, tiktokSettings });
  await publishYouTube({ post, byPlatform: runnableMap, message, media, youtubeSettings });
}