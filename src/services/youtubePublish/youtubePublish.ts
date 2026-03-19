import axios from "axios";
import { google } from "googleapis";

type PublishYouTubeVideoParams = {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date | string | null;
  videoUrl: string;
  title: string;
  description?: string;
  privacyStatus?: "private" | "public" | "unlisted";
};

export const publishYouTubeVideo = async ({
  accessToken,
  refreshToken,
  tokenExpiresAt,
  videoUrl,
  title,
  description = "",
  privacyStatus = "private",
}: PublishYouTubeVideoParams) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: tokenExpiresAt ? new Date(tokenExpiresAt).getTime() : undefined,
  });

  const expiresAtMs = tokenExpiresAt ? new Date(tokenExpiresAt).getTime() : 0;
  const shouldRefresh =
    !!refreshToken &&
    (!expiresAtMs || expiresAtMs <= Date.now() + 60_000);

  if (shouldRefresh) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials({
      access_token: credentials.access_token ?? accessToken,
      refresh_token: credentials.refresh_token ?? refreshToken,
      expiry_date: credentials.expiry_date ?? expiresAtMs,
    });
  }

  const youtube = google.youtube({
    version: "v3",
    auth: oauth2Client,
  });

  const videoResponse = await axios.get(videoUrl, {
    responseType: "stream",
    maxRedirects: 5,
  });

  const contentType = videoResponse.headers["content-type"];

  if (!contentType || !contentType.startsWith("video/")) {
    throw new Error(`Invalid source content-type for YouTube upload: ${contentType || "unknown"}`);
  }

  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title,
        description,
      },
      status: {
        privacyStatus,
      },
    },
    media: {
      mimeType: contentType,
      body: videoResponse.data,
    },
  });

  return {
    videoId: response.data.id,
  };
};