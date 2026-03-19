import AppError from "../../utils/AppError";
import { CreatePostServiceResult } from "../../types/type";
import { extractImageUrls } from "./post.helper";
import { finalizeStatus } from "./post.status";


export function ensureValidMedia(media: any) {
  if (!media || (media.kind !== "images" && media.kind !== "video")) {
    throw new AppError("Unsupported media type", 400);
  }
}

export function ensurePublishResults(post: any) {
  post.publishResults = post.publishResults || {};
}

export function finalizeAndReturn(
  post: any,
  note?: string
): CreatePostServiceResult {
  const fin = finalizeStatus(post);
  post.status = fin.status;

  return {
    post,
    note,
    meta: {
      publishedPlatforms: fin.publishedPlatforms,
      failedPlatforms: fin.failedPlatforms,
      idlePlatforms: fin.idlePlatforms,
    },
  };
}

export async function saveFinalized(
  post: any,
  note?: string
): Promise<CreatePostServiceResult> {
  const result = finalizeAndReturn(post, note);
  await post.save();
  return result;
}

export function getImageUrls(media: any) {
  return media.kind === "images" ? extractImageUrls(media) : [];
}

