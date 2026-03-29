import { publishYouTubeVideo } from "../../../services/youtubePublish/youtubePublish";
import { setPlatformResult } from "../post.helper";

type Params = {
  post: any;
  targets: Record<string, boolean>;
  media: any;
  byPlatform: Map<any, any>;
  message: string;
  youtubeSettings?: {
    title?: string;
    description?: string;
    privacyStatus?: "private" | "public" | "unlisted";
  };
};

export const publishYouTubeIfNeeded = async ({
  post,
  targets,
  media,
  byPlatform,
  message,
  youtubeSettings,
}: Params) => {
  /**
   * Skip YouTube publishing if:
   * - YouTube was not selected
   * - media is not a video
   * - no active YouTube account is connected
   */
  if (!targets?.youtube) return;
  if (media?.kind !== "video") return;
  if (!byPlatform.has("youtube")) return;

  try {
    const ytAcc: any = byPlatform.get("youtube");

    /**
     * Validate that the connected YouTube account
     * has a usable access token.
     */
    if (!ytAcc?.accessToken) {
      setPlatformResult(post, "youtube", {
        status: "failed",
        externalId: null,
        error: "YouTube access token missing",
        publishedAt: null,
      });
      return;
    }

    /**
     * Publish video to YouTube.
     *
     * Fallback strategy:
     * - title: explicit title -> post caption -> default label
     * - description: explicit description -> built message
     * - privacyStatus: explicit setting -> PUBLIC by default
     */
    const result = await publishYouTubeVideo({
      accessToken: ytAcc.accessToken,
      refreshToken: ytAcc.meta?.refreshToken,
      tokenExpiresAt: ytAcc.tokenExpiresAt,
      videoUrl: media.video.url,
      title: youtubeSettings?.title || post.caption || "Untitled video",
      description: youtubeSettings?.description || message || "",
      privacyStatus: youtubeSettings?.privacyStatus || "public",
    });

    /**
     * Mark platform result as published on success.
     */
    setPlatformResult(post, "youtube", {
      status: "published",
      externalId: result.videoId,
      error: null,
      publishedAt: new Date(),
    });
  } catch (e: any) {
    /**
     * Store the most useful available error message.
     */
    setPlatformResult(post, "youtube", {
      status: "failed",
      externalId: null,
      error:
        e?.response?.data?.error?.message ||
        e?.message ||
        "YouTube publish failed",
      publishedAt: null,
    });
  }
};