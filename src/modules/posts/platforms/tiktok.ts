import { publishTikTokVideo } from "../../../services/tiktokPublish/tiktokPublish";
import { Platform } from "../../../types/type";
import AppError from "../../../utils/AppError";
import { getProviderError } from "../../../utils/publishError";


/**
 * Publish to TikTok only when:
 * - media is video
 * - tiktok target is selected
 * - user has an active connected TikTok account
 */
export async function publishTikTokIfNeeded(args: {
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
    const { message: providerMsg, details } = getProviderError(e, "Tiktok publish failed");
    post.publishResults.tiktok = {
      status: "failed",
      externalId: null,
      error: providerMsg,
      publishedAt: null,
    };
    throw new AppError(providerMsg, 502, [{ platform: "tiktok", ...details }], "Tiktok_PUBLISH_FAILED");
  }
}
