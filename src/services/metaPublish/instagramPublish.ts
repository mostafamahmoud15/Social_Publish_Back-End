import axios from "axios";
import AppError from "../../utils/AppError";

/**
 * Truncate long strings to prevent huge logs / payloads.
 */
function safeTruncate(str: string, max = 4000) {
  if (!str) return str;
  return str.length > max ? str.slice(0, max) + "..." : str;
}

/**
 * Returns a safe URL hint (origin + pathname only).
 * Prevents leaking query params in logs.
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
 * Determines if an HTTP status is retryable.
 * Retryable: timeout, rate-limit, server errors.
 */
function isRetryableStatus(status?: number) {
  if (!status) return true;
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Normalizes Facebook/Instagram Graph API errors from axios.
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
 * Throws a structured AppError.
 */
function throwAppError(params: {
  message: string;
  status: number;
  code: string;
  details?: any[];
}): never {
  throw new AppError(
    params.message,
    params.status,
    params.details ?? [],
    params.code
  );
}

/**
 * Creates an Instagram media container.
 * - Single image: caption allowed
 * - Carousel child: must use is_carousel_item = true (no caption)
 */
async function createIgMediaContainer(opts: {
  igUserId: string;
  accessToken: string;
  imageUrl: string;
  caption?: string;
  isCarouselItem?: boolean;
}) {
  const { igUserId, accessToken, imageUrl, caption, isCarouselItem } = opts;

  try {
    const r = await axios.post(
      `https://graph.facebook.com/v24.0/${igUserId}/media`,
      null,
      {
        params: {
          image_url: imageUrl,
          caption,
          is_carousel_item: isCarouselItem ? true : undefined,
          access_token: accessToken,
        },
        timeout: 30_000,
        validateStatus: (s) => s >= 200 && s < 300,
      }
    );

    const creationId = r.data?.id;

    if (!creationId) {
      throwAppError({
        message: "Instagram returned an invalid media container response",
        status: 502,
        code: "IG_CONTAINER_INVALID_RESPONSE",
        details: [
          {
            step: "create_container",
            igUserId,
            imageUrlHint: safeUrlHint(imageUrl),
            response: r.data,
          },
        ],
      });
    }

    return creationId as string;
  } catch (e: any) {
    const { status, fb, message, raw } = fbErrorFromAxios(e);
    const httpStatus = status ?? 502;

    throwAppError({
      message: "Failed to create Instagram media container",
      status: isRetryableStatus(httpStatus) ? 502 : 400,
      code: "IG_CONTAINER_CREATE_FAILED",
      details: [
        {
          step: "create_container",
          igUserId,
          imageUrlHint: safeUrlHint(imageUrl),
          isCarouselItem: !!isCarouselItem,
          httpStatus,
          retryable: isRetryableStatus(httpStatus),
          fbError: fb,
          errorMessage: message,
          response: raw,
        },
      ],
    });
  }
}

/**
 * Creates the parent CAROUSEL container.
 * Must be called after all child containers are created.
 */
async function createCarouselParentContainer(opts: {
  igUserId: string;
  accessToken: string;
  caption: string;
  children: string[];
}) {
  const { igUserId, accessToken, caption, children } = opts;

  try {
    const parentResp = await axios.post(
      `https://graph.facebook.com/v24.0/${igUserId}/media`,
      null,
      {
        params: {
          media_type: "CAROUSEL",
          children: children.join(","),
          caption,
          access_token: accessToken,
        },
        timeout: 30_000,
        validateStatus: (s) => s >= 200 && s < 300,
      }
    );

    const id = parentResp.data?.id;

    if (!id) {
      throwAppError({
        message:
          "Instagram returned an invalid carousel container response",
        status: 502,
        code: "IG_CAROUSEL_INVALID_RESPONSE",
        details: [
          {
            step: "create_carousel_parent",
            igUserId,
            childrenCount: children.length,
            response: parentResp.data,
          },
        ],
      });
    }

    return id as string;
  } catch (e: any) {
    const { status, fb, message, raw } = fbErrorFromAxios(e);
    const httpStatus = status ?? 502;

    throwAppError({
      message: "Failed to create Instagram carousel container",
      status: isRetryableStatus(httpStatus) ? 502 : 400,
      code: "IG_CAROUSEL_CREATE_FAILED",
      details: [
        {
          step: "create_carousel_parent",
          igUserId,
          childrenCount: children.length,
          httpStatus,
          retryable: isRetryableStatus(httpStatus),
          fbError: fb,
          errorMessage: message,
          response: raw,
        },
      ],
    });
  }
}

/**
 * Publishes a container and returns the final media id.
 */
async function publishIgContainer(opts: {
  igUserId: string;
  accessToken: string;
  creationId: string;
}) {
  const { igUserId, accessToken, creationId } = opts;

  try {
    const r = await axios.post(
      `https://graph.facebook.com/v24.0/${igUserId}/media_publish`,
      null,
      {
        params: {
          creation_id: creationId,
          access_token: accessToken,
        },
        timeout: 30_000,
        validateStatus: (s) => s >= 200 && s < 300,
      }
    );

    const mediaId = r.data?.id;

    if (!mediaId) {
      throwAppError({
        message: "Instagram returned an invalid publish response",
        status: 502,
        code: "IG_PUBLISH_INVALID_RESPONSE",
        details: [
          { step: "publish", igUserId, creationId, response: r.data },
        ],
      });
    }

    return mediaId as string;
  } catch (e: any) {
    const { status, fb, message, raw } = fbErrorFromAxios(e);
    const httpStatus = status ?? 502;

    throwAppError({
      message: "Failed to publish Instagram media",
      status: isRetryableStatus(httpStatus) ? 502 : 400,
      code: "IG_PUBLISH_FAILED",
      details: [
        {
          step: "publish",
          igUserId,
          creationId,
          httpStatus,
          retryable: isRetryableStatus(httpStatus),
          fbError: fb,
          errorMessage: message,
          response: raw,
        },
      ],
    });
  }
}

/**
 * Publishes either:
 * - Single image
 * - Carousel of images
 */
export async function publishInstagramImages(opts: {
  igUserId: string;
  accessToken: string;
  caption: string;
  imageUrls: string[];
}) {
  const { igUserId, accessToken, caption, imageUrls } = opts;

  if (!igUserId || !accessToken) {
    throwAppError({
      message: "Instagram account token is missing",
      status: 400,
      code: "IG_AUTH_MISSING",
      details: [
        {
          step: "validate",
          hasIgUserId: !!igUserId,
          hasAccessToken: !!accessToken,
        },
      ],
    });
  }

  if (!imageUrls?.length) {
    throwAppError({
      message: "No images provided for Instagram",
      status: 400,
      code: "IG_IMAGES_MISSING",
      details: [{ step: "validate" }],
    });
  }

  try {
    // Single image flow
    if (imageUrls.length === 1) {
      const creationId = await createIgMediaContainer({
        igUserId,
        accessToken,
        imageUrl: imageUrls[0],
        caption,
      });

      const mediaId = await publishIgContainer({
        igUserId,
        accessToken,
        creationId,
      });

      return { mediaId };
    }

    // Carousel flow
    const children: string[] = [];

    for (const url of imageUrls) {
      const childId = await createIgMediaContainer({
        igUserId,
        accessToken,
        imageUrl: url,
        isCarouselItem: true,
      });

      children.push(childId);
    }

    const parentCreationId =
      await createCarouselParentContainer({
        igUserId,
        accessToken,
        caption,
        children,
      });

    const mediaId = await publishIgContainer({
      igUserId,
      accessToken,
      creationId: parentCreationId,
    });

    return { mediaId, children };
  } catch (e: any) {
    if (e instanceof AppError) throw e;

    throwAppError({
      message: "Instagram publish failed",
      status: 502,
      code: "IG_PUBLISH_UNEXPECTED",
      details: [
        {
          step: "unknown",
          igUserId,
          imagesCount: imageUrls.length,
          errorMessage: e?.message,
        },
      ],
    });
  }
}