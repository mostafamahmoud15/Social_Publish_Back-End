import axios from "axios";
import AppError from "../../utils/AppError";

// TikTok chunk upload expects chunking constraints.
// These values are common-safe defaults for FILE_UPLOAD chunking.
const MIN_CHUNK = 5 * 1024 * 1024;   // 5MB
const MAX_CHUNK = 64 * 1024 * 1024;  // 64MB

// Safety guard: since we currently download the whole video into RAM,
// we must cap the maximum allowed size to avoid crashing the server.
const MAX_VIDEO_SIZE = 200 * 1024 * 1024; // 200MB

/**
 * Chooses a practical chunk size based on the total file size.
 * - If the file is small, upload it as a single chunk (simpler + faster).
 * - Otherwise, use ~10MB chunks (within MIN/MAX) to balance speed and stability.
 */
function chooseChunkSize(size: number) {
  // Small file => one chunk
  if (size <= MIN_CHUNK) return size;

  // Default chunk size target (10MB) for smoother uploads
  const tenMB = 10 * 1024 * 1024;

  // Clamp to [MIN_CHUNK .. MAX_CHUNK]
  return Math.min(Math.max(tenMB, MIN_CHUNK), MAX_CHUNK);
}

/**
 * Truncates long strings to keep logs/errors lightweight.
 * (Some providers return huge HTML/JSON bodies on errors.)
 */
function safeTruncate(str: string, max = 4000) {
  if (!str) return str;
  return str.length > max ? str.slice(0, max) + "..." : str;
}

/**
 * Safe URL hint for logs.
 * Important: never log TikTok upload_url fully (it's a signed URL).
 * We only keep origin + path to help debugging without leaking secrets.
 */
function safeUrlHint(url?: string) {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    // If URL is invalid, avoid throwing inside the logger path
    return undefined;
  }
}

/**
 * Reads fetch Response body safely.
 * - If JSON: return parsed JSON
 * - Else: return truncated text
 *
 * Note: we use globalThis.Response to avoid confusion with Express "Response".
 */
async function readFetchBody(fetchRes: globalThis.Response) {
  const ct = fetchRes.headers.get("content-type") || "";

  // Try JSON first (most APIs respond with JSON error objects)
  try {
    if (ct.includes("application/json")) return await fetchRes.json();
  } catch {
    // Ignore parsing failures and fall back to text
  }

  // Fallback: try reading text (HTML/plain text error pages)
  try {
    const text = await fetchRes.text();
    return text ? safeTruncate(text, 8000) : null;
  } catch {
    return null;
  }
}

/**
 * Determines whether a status code is typically retryable.
 * - 408: request timeout
 * - 429: rate limited
 * - 5xx: server-side issues
 */
function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Wraps our errors in a consistent AppError shape.
 * - message: FE-friendly toast message
 * - code: stable identifier for FE handling / analytics
 * - details: structured debug payload (safe for server logs)
 */
function buildAppError(params: {
  message: string;
  status: number;
  code: string;
  details?: any[];
}) {
  return new AppError(
    params.message,
    params.status,
    params.details ?? [],
    params.code
  );
}

/**
 * Publishes a video to TikTok using chunked upload.
 *
 * High-level flow:
 * 1) Download the video (currently into memory)
 * 2) Ask TikTok to initialize an upload (get upload_url + publish_id)
 * 3) Upload the video in chunks using PUT + Content-Range
 * 4) Return publish_id (used to track/poll status if needed)
 */
export async function publishTikTokVideo({
  accessToken,
  videoUrl,
  caption,
  privacy_level,
  disable_comment = false,
  disable_duet = false,
  disable_stitch = false,
  forcePrivate = true,
}: {
  accessToken: string;
  videoUrl: string;
  caption: string;
  privacy_level?: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "SELF_ONLY";
  disable_comment?: boolean;
  disable_duet?: boolean;
  disable_stitch?: boolean;
  forcePrivate?: boolean;
}) {
  // Common context included in errors to simplify debugging
  const ctxBase = {
    provider: "tiktok",
    videoUrlHint: safeUrlHint(videoUrl),
  };

  // 1) Download video
  // NOTE: This loads the entire file into RAM (Buffer).
  // If you want best performance, switch to temp-file streaming approach.
  let buffer: Buffer;
  let videoSize: number;

  try {
    // Download the video bytes from the provided URL
    const videoResponse = await axios.get(videoUrl, {
      responseType: "arraybuffer", // we need raw bytes
      timeout: 60_000,            // video download can be slow
      maxRedirects: 5,            // some CDNs redirect
      validateStatus: (s) => s >= 200 && s < 300,
    });

    // Convert axios ArrayBuffer -> Node Buffer
    buffer = Buffer.from(videoResponse.data);
    videoSize = buffer.length;

    // If the download succeeded but returned empty content
    if (!videoSize) {
      throw buildAppError({
        message: "Failed to download the video before uploading to TikTok",
        status: 400,
        code: "TIKTOK_VIDEO_EMPTY",
        details: [{ step: "download", ...ctxBase, reason: "EMPTY_BUFFER" }],
      });
    }

    // Protect the server from huge videos (RAM blow-up)
    if (videoSize > MAX_VIDEO_SIZE) {
      throw buildAppError({
        message: "Video is too large to upload",
        status: 400,
        code: "TIKTOK_VIDEO_TOO_LARGE",
        details: [
          {
            step: "download",
            ...ctxBase,
            videoSize,
            maxAllowed: MAX_VIDEO_SIZE,
          },
        ],
      });
    }
  } catch (e: any) {
    // If we already built an AppError above, rethrow as-is
    if (e instanceof AppError) throw e;

    // Otherwise normalize axios error details
    const status = e?.response?.status ?? 502; // 502 for "upstream failure"
    const body = e?.response?.data;

    throw buildAppError({
      message: "Failed to download the video before uploading to TikTok",
      status: isRetryableStatus(status) ? 502 : 400,
      code: "TIKTOK_VIDEO_DOWNLOAD_FAILED",
      details: [
        {
          step: "download",
          ...ctxBase,
          axiosStatus: status,
          axiosCode: e?.code, // e.g. ECONNABORTED
          response: typeof body === "string" ? safeTruncate(body, 8000) : body,
          hint:
            "Make sure the video URL is a direct link and accessible from the backend server",
          retryable: isRetryableStatus(status),
        },
      ],
    });
  }

  // 2) Chunking setup
  // TikTok needs:
  // - video_size
  // - chunk_size
  // - total_chunk_count
  const chunkSize = chooseChunkSize(videoSize);
  const totalChunkCount = Math.ceil(videoSize / chunkSize);

  // Privacy handling:
  // - forcePrivate=true => always SELF_ONLY (safe default while testing)
  // - else use provided privacy_level or fallback to SELF_ONLY
  const finalPrivacy:
    | "SELF_ONLY"
    | "PUBLIC_TO_EVERYONE"
    | "MUTUAL_FOLLOW_FRIENDS" = forcePrivate
    ? "SELF_ONLY"
    : (privacy_level ?? "SELF_ONLY");

  // 3) Init upload with TikTok
  // TikTok returns:
  // - upload_url (signed URL used to PUT chunks)
  // - publish_id (reference id for this publishing job)
  let uploadUrl: string;
  let publishId: string;

  try {
    const initRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`, // user token
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          post_info: {
            // TikTok has a title/caption limit; keep it safe
            title: (caption || "").trim().substring(0, 2200),
            privacy_level: finalPrivacy,
            disable_comment,
            disable_duet,
            disable_stitch,
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: videoSize,
            chunk_size: chunkSize,
            total_chunk_count: totalChunkCount,
          },
        }),
      }
    );

    // TikTok sometimes responds with error object even on 200 OK
    const initBody = await initRes.json().catch(() => ({} as any));

    // Fail if:
    // - HTTP not ok
    // - or TikTok error code isn't "ok"
    if (!initRes.ok || initBody?.error?.code !== "ok") {
      const status = initRes.status || 502;

      throw buildAppError({
        message: "Failed to initialize video upload on TikTok",
        status: isRetryableStatus(status) ? 502 : 400,
        code: "TIKTOK_INIT_FAILED",
        details: [
          {
            step: "init",
            ...ctxBase,
            httpStatus: initRes.status,
            retryable: isRetryableStatus(initRes.status),
            tiktokError: initBody?.error ?? null,
            response: initBody,
          },
        ],
      });
    }

    // Extract the fields needed for uploading chunks
    uploadUrl = initBody?.data?.upload_url;
    publishId = initBody?.data?.publish_id;

    // If TikTok didn't return what we need, treat as upstream invalid response
    if (!uploadUrl || !publishId) {
      throw buildAppError({
        message: "TikTok returned incomplete data during upload initialization",
        status: 502,
        code: "TIKTOK_INIT_MISSING_FIELDS",
        details: [
          {
            step: "init",
            ...ctxBase,
            missing: { upload_url: !uploadUrl, publish_id: !publishId },
            response: initBody,
          },
        ],
      });
    }
  } catch (err: any) {
    // Keep AppError details if already structured
    if (err instanceof AppError) throw err;

    // Unexpected errors (fetch crashed, JSON parse issue, etc.)
    throw buildAppError({
      message: "Failed to initialize video upload on TikTok",
      status: 502,
      code: "TIKTOK_INIT_EXCEPTION",
      details: [{ step: "init", ...ctxBase, errorMessage: err?.message }],
    });
  }

  // 4) Upload chunks
  // TikTok expects chunk uploads using:
  // - PUT uploadUrl
  // - Content-Range: bytes start-end/total
  // - Usually returns 206 for partial chunks, and 201 for final chunk.
  for (let i = 0; i < totalChunkCount; i++) {
    // Compute chunk byte range
    const start = i * chunkSize;
    const endExclusive = Math.min(start + chunkSize, videoSize);
    const end = endExclusive - 1;

    // Slice only the current chunk from the big buffer
    const chunkBuf = buffer.subarray(start, endExclusive);

    // fetch body expects Uint8Array/ArrayBuffer; Buffer is fine too,
    // but Uint8Array keeps it explicit across runtimes.
    const chunk = new Uint8Array(chunkBuf);

    try {
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(chunk.byteLength),
          "Content-Range": `bytes ${start}-${end}/${videoSize}`,
        },
        body: chunk,
      });

      // Success statuses commonly:
      // - 206: chunk accepted (partial)
      // - 201: final chunk accepted (complete)
      if (!(uploadRes.status === 206 || uploadRes.status === 201)) {
        // Read response body safely for debugging (without blowing logs)
        const body = await readFetchBody(uploadRes);

        throw buildAppError({
          message:
            "Failed to upload the video to TikTok (during upload process)",
          status: isRetryableStatus(uploadRes.status) ? 502 : 400,
          code: "TIKTOK_UPLOAD_FAILED",
          details: [
            {
              step: "upload",
              ...ctxBase,
              publishId,
              uploadUrlHint: safeUrlHint(uploadUrl),
              httpStatus: uploadRes.status,
              retryable: isRetryableStatus(uploadRes.status),
              chunk: {
                index: i,
                total: totalChunkCount,
                start,
                end,
                size: chunk.length,
              },
              response: body,
            },
          ],
        });
      }
    } catch (err: any) {
      // If we already created a structured error above, rethrow it
      if (err instanceof AppError) throw err;

      // Network errors (fetch throws) -> treat as retryable upstream failure
      throw buildAppError({
        message:
          "Failed to upload the video to TikTok (network error during upload)",
        status: 502,
        code: "TIKTOK_UPLOAD_NETWORK_ERROR",
        details: [
          {
            step: "upload",
            ...ctxBase,
            publishId,
            uploadUrlHint: safeUrlHint(uploadUrl),
            chunk: {
              index: i,
              total: totalChunkCount,
              start,
              end,
              size: chunk.length,
            },
            errorMessage: err?.message,
            retryable: true,
          },
        ],
      });
    }
  }

  // If all chunks succeeded, TikTok has accepted the upload.
  // publish_id can be used later to check publish status (if you implement polling).
  return { publish_id: publishId };
}