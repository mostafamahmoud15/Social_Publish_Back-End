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
  if (!targets?.youtube) return;
  if (media?.kind !== "video") return;
  if (!byPlatform.has("youtube")) return;

  try {
    const ytAcc: any = byPlatform.get("youtube");

    if (!ytAcc?.accessToken) {
      setPlatformResult(post, "youtube", {
        status: "failed",
        externalId: null,
        error: "YouTube access token missing",
        publishedAt: null,
      });
      return;
    }

    const result = await publishYouTubeVideo({
      accessToken: ytAcc.accessToken,
      refreshToken: ytAcc.meta?.refreshToken,
      tokenExpiresAt: ytAcc.tokenExpiresAt,
      videoUrl: media.video.url,
      title: youtubeSettings?.title || post.caption || "Untitled video",
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
    setPlatformResult(post, "youtube", {
      status: "failed",
      externalId: null,
      error: e?.response?.data?.error?.message || e?.message || "YouTube publish failed",
      publishedAt: null,
    });
  }
};