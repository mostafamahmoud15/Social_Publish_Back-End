import axios from "axios";
import AppError from "../../utils/AppError";

/**
 * Truncate long strings to avoid huge logs / payloads.
 */
function safeTruncate(str: string, max = 4000) {
  if (!str) return str;
  return str.length > max ? str.slice(0, max) + "..." : str;
}

/**
 * Returns a safe URL hint (origin + path only) without query params.
 * Useful for logs without leaking sensitive query strings.
 */
function safeUrlHint(url?: string) {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return undefined;
  }
}

/**
 * Decide whether an HTTP status is worth retrying.
 * - 408 / 429 / 5xx are usually transient
 * - undefined status can happen on network errors
 */
function isRetryableStatus(status?: number) {
  if (!status) return true;
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Normalizes Meta/Facebook Graph errors coming from axios.
 * Returns a consistent object for logging / error responses.
 */
function fbErrorFromAxios(e: any) {
  const status = e?.response?.status;
  const data = e?.response?.data;

  const fb = data?.error ?? null;
  const message =
    fb?.message ||
    (typeof data === "string" ? safeTruncate(data, 8000) : undefined) ||
    e?.message;

  return {
    status,
    fb,
    message,
    raw: typeof data === "string" ? safeTruncate(data, 8000) : data,
  };
}

/**
 * Helper to throw a structured AppError in one place.
 */
function throwAppError(params: {
  message: string; // user-friendly
  status: number;  // http status
  code: string;    // internal error code
  details?: any[]; // debug details
}): never {
  throw new AppError(params.message, params.status, params.details ?? [], params.code);
}

/**
 * Publishes a multi-photo Facebook Page post.
 *
 * Flow:
 * 1) Upload each image as an unpublished photo
 * 2) Create a feed post with attached_media = uploaded photo ids
 */
export async function publishFacebookMultiPhotoPost(opts: {
  pageId: string;
  pageAccessToken: string;
  message: string;
  imageUrls: string[];
}) {
  const { pageId, pageAccessToken, message, imageUrls } = opts;

  // Basic validation (bad input -> 400)
  if (!pageId || !pageAccessToken) {
    throwAppError({
      message: "Facebook account token is missing",
      status: 400,
      code: "FB_AUTH_MISSING",
      details: [{ step: "validate", hasPageId: !!pageId, hasAccessToken: !!pageAccessToken }],
    });
  }

  if (!imageUrls?.length) {
    throwAppError({
      message: "No images provided for Facebook",
      status: 400,
      code: "FB_IMAGES_MISSING",
      details: [{ step: "validate" }],
    });
  }

  // Shared context for debugging
  const ctxBase = {
    provider: "facebook",
    pageId,
    imagesCount: imageUrls.length,
  };

  try {
    const photoIds: string[] = [];

    // 1) Upload photos as unpublished (we attach them later)
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];

      try {
        const r = await axios.post(`https://graph.facebook.com/v24.0/${pageId}/photos`, null, {
          params: { url, published: false, access_token: pageAccessToken },
          timeout: 30_000,
          validateStatus: (s) => s >= 200 && s < 300,
        });

        const id = r.data?.id;
        if (!id) {
          throwAppError({
            message: "Facebook returned an invalid photo upload response",
            status: 502,
            code: "FB_PHOTO_INVALID_RESPONSE",
            details: [
              {
                step: "upload_photo",
                ...ctxBase,
                index: i,
                imageUrlHint: safeUrlHint(url),
                response: r.data,
              },
            ],
          });
        }

        photoIds.push(id);
      } catch (e: any) {
        // Normalize FB error and throw a consistent AppError
        const { status, fb, message: fbMsg, raw } = fbErrorFromAxios(e);
        const httpStatus = status ?? 502;

        throwAppError({
          message: "Failed to upload Facebook photo",
          status: isRetryableStatus(httpStatus) ? 502 : 400,
          code: "FB_PHOTO_UPLOAD_FAILED",
          details: [
            {
              step: "upload_photo",
              ...ctxBase,
              index: i,
              imageUrlHint: safeUrlHint(url),
              httpStatus,
              retryable: isRetryableStatus(httpStatus),
              fbError: fb,
              errorMessage: fbMsg,
              response: raw,
            },
          ],
        });
      }
    }

    // 2) Create the final post with attached_media
    const attached_media = photoIds.map((id) => ({ media_fbid: id }));

    try {
      const postResp = await axios.post(`https://graph.facebook.com/v24.0/${pageId}/feed`, null, {
        params: {
          message,
          attached_media: JSON.stringify(attached_media),
          access_token: pageAccessToken,
        },
        timeout: 30_000,
        validateStatus: (s) => s >= 200 && s < 300,
      });

      const postId = postResp.data?.id;
      if (!postId) {
        throwAppError({
          message: "Facebook returned an invalid post creation response",
          status: 502,
          code: "FB_POST_INVALID_RESPONSE",
          details: [
            {
              step: "create_post",
              ...ctxBase,
              photosCount: photoIds.length,
              response: postResp.data,
            },
          ],
        });
      }

      return { postId, photoIds };
    } catch (e: any) {
      const { status, fb, message: fbMsg, raw } = fbErrorFromAxios(e);
      const httpStatus = status ?? 502;

      throwAppError({
        message: "Failed to create Facebook post",
        status: isRetryableStatus(httpStatus) ? 502 : 400,
        code: "FB_POST_CREATE_FAILED",
        details: [
          {
            step: "create_post",
            ...ctxBase,
            photosCount: photoIds.length,
            httpStatus,
            retryable: isRetryableStatus(httpStatus),
            fbError: fb,
            errorMessage: fbMsg,
            response: raw,
          },
        ],
      });
    }
  } catch (e: any) {
    // If it's already an AppError, keep it as-is
    if (e instanceof AppError) throw e;

    // Any other unexpected errors -> normalize to AppError
    throwAppError({
      message: "Facebook publish failed",
      status: 502,
      code: "FB_PUBLISH_UNEXPECTED",
      details: [
        {
          step: "unknown",
          ...ctxBase,
          errorMessage: e?.message,
        },
      ],
    });
  }
}