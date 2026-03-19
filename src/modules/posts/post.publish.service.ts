import Post from "./model";
import AppError from "../../utils/AppError";
import {
  ALL_PLATFORMS,
  CreatePostServiceInput,
  CreatePostServiceResult,
  PostStatus,
  RetryPostServiceInput,
} from "../../types/type";

import {
  asStringArray,
  buildMessage,
  getSelectedPlatforms,
  isPlatformCompatible,
  markIncompatiblePlatforms,
  parsePlatform,
  setPlatformResult,
  shouldRetryPlatform,
} from "./post.helper";

import { loadActiveAccounts, markMissingAccounts } from "./post.accounts";
import { finalizeStatus } from "./post.status";
import {
  ensurePublishResults,
  ensureValidMedia,
  saveFinalized,
} from "./post.publish.utils";
import { executePublishing } from "./post.publish.executor";

export async function createPostAndMaybePublish(
  input: CreatePostServiceInput
): Promise<CreatePostServiceResult> {
  const {
    userId,
    action,
    caption = "",
    hashtags = [],
    targets = {},
    media,
    tiktokSettings,
    youtubeSettings,
  } = input;

  if (!userId) throw new AppError("Unauthorized", 401);

  ensureValidMedia(media);

  const hashtagsArr = asStringArray(hashtags);
  const message = buildMessage(String(caption || ""), hashtagsArr);

  const post = await Post.create({
    user: userId,
    action,
    status: action === "draft" ? "draft" : "queued",
    caption,
    hashtags: hashtagsArr,
    targets,
    media,
  });

  ensurePublishResults(post);

  if (action === "draft") {
    return { post };
  }

  const selected = getSelectedPlatforms(targets);

  if (selected.length === 0) {
    post.status = "queued";
    await post.save();

    return {
      post,
      note: "No platforms selected. Post saved without external publishing.",
    };
  }

  markIncompatiblePlatforms(post, selected, media.kind);

  const compatibleSelected = selected.filter((p) =>
    isPlatformCompatible(p, media.kind)
  );

  if (compatibleSelected.length === 0) {
    post.status = "failed";
    await post.save();

    return {
      post,
      note: "Selected platforms are incompatible with the media type.",
    };
  }

  const byPlatform = await loadActiveAccounts(String(userId), compatibleSelected);

  const missing = compatibleSelected.filter((p) => !byPlatform.has(p));
  markMissingAccounts(post, missing);

  if (missing.length === compatibleSelected.length) {
    post.status = "failed";
    await post.save();

    return {
      post,
      note: "Selected platforms are not connected/active. Nothing was published.",
    };
  }

  post.status = "publishing";
  await post.save();

  await executePublishing({
    post,
    platforms: compatibleSelected,
    byPlatform,
    media,
    message,
    tiktokSettings,
    youtubeSettings,
  });

  return await saveFinalized(post);
}

export async function retryPostPublishing(
  input: RetryPostServiceInput
): Promise<CreatePostServiceResult> {
  const {
    postId,
    requesterId,
    requesterRole,
    onlyPlatform,
    tiktokSettings,
    youtubeSettings,
  } = input;

  if (!requesterId) {
    throw new AppError("Unauthorized", 401);
  }

  const existing = await Post.findById(postId);
  if (!existing) {
    throw new AppError("Post not found", 404);
  }

  const isOwner = requesterRole === "owner";
  if (!isOwner && String((existing as any).user) !== String(requesterId)) {
    throw new AppError("Forbidden", 403);
  }

  if ((existing as any).action !== "publish") {
    throw new AppError("This post is not a publish action", 400);
  }

  const retryablePostStatuses: PostStatus[] = ["failed", "partial", "queued"];
  if (!retryablePostStatuses.includes(existing.status)) {
    throw new AppError(
      "This post cannot be retried unless its status is queued, partial, or failed",
      400
    );
  }

  const locked = await Post.findOneAndUpdate(
    { _id: postId, status: { $ne: "publishing" } },
    { $set: { status: "publishing" } },
    { new: true }
  );

  if (!locked) {
    throw new AppError("Post is currently publishing", 409);
  }

  const post: any = locked;

  try {
    ensurePublishResults(post);
    ensureValidMedia(post.media);

    const media = post.media;
    const targets = post.targets || {};

    const hasRequestedPlatform =
      onlyPlatform !== undefined &&
      onlyPlatform !== null &&
      String(onlyPlatform).trim() !== "";

    const requestedPlatform = parsePlatform(onlyPlatform);

    if (hasRequestedPlatform && !requestedPlatform) {
      throw new AppError("Invalid platform value", 400);
    }

    const targeted = ALL_PLATFORMS.filter((p) => targets?.[p] === true);

    if (targeted.length === 0) {
      return await saveFinalized(post, "No platforms selected for this post.");
    }

    if (requestedPlatform && !targeted.includes(requestedPlatform)) {
      return await saveFinalized(
        post,
        `Platform "${requestedPlatform}" was not selected for this post.`
      );
    }

    let candidates = targeted
      .filter((p) => isPlatformCompatible(p, media.kind))
      .filter((p) => shouldRetryPlatform(post, p));

    if (requestedPlatform) {
      candidates = candidates.filter((p) => p === requestedPlatform);
    }

    if (candidates.length === 0) {
      return await saveFinalized(
        post,
        requestedPlatform
          ? `Nothing to retry for platform "${requestedPlatform}".`
          : "Nothing to retry for the selected platform(s)."
      );
    }

    const byPlatform = await loadActiveAccounts(String(post.user), candidates);

    for (const p of candidates) {
      setPlatformResult(post, p, {
        status: byPlatform.has(p) ? "idle" : "failed",
        externalId: null,
        error: byPlatform.has(p) ? null : "Platform not connected/active",
        publishedAt: null,
      });
    }

    const runnable = candidates.filter((p) => byPlatform.has(p));

    if (runnable.length === 0) {
      return await saveFinalized(
        post,
        requestedPlatform
          ? `No active connected account for platform "${requestedPlatform}".`
          : "No active connected accounts for retry platforms."
      );
    }

    const message = buildMessage(
      String(post.caption || ""),
      asStringArray(post.hashtags || [])
    );

    await executePublishing({
      post,
      platforms: runnable,
      byPlatform,
      media,
      message,
      tiktokSettings,
      youtubeSettings,
    });

    return await saveFinalized(post);
  } finally {
    if (post.status === "publishing") {
      try {
        const fin = finalizeStatus(post);
        post.status = fin.status;
        await post.save();
      } catch { }
    }
  }
}