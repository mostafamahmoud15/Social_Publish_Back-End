function pickFirstString(...vals: any[]) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function getProviderError(e: any, fallback: string) {

  const status = e?.response?.status;
  const data = e?.response?.data;

  // Meta Graph API patterns (FB/IG)
  const meta = data?.error;
  const metaMsg = pickFirstString(
    meta?.error_user_msg,
    meta?.error_user_title,
    meta?.message,
    data?.message
  );

  // TikTok patterns (depending on your SDK/endpoint)
  const tiktokMsg = pickFirstString(
    data?.message,
    data?.error?.message,
    data?.error_description,
    data?.data?.error?.message
  );

  const genericMsg = pickFirstString(e?.message);

  const message = metaMsg || tiktokMsg || genericMsg || fallback;

  // useful details (NOT for user necessarily, but for logs/debug/UI)
  const details = {
    providerStatus: status,
    providerCode: meta?.code ?? data?.code ?? data?.error_code,
    providerSubcode: meta?.error_subcode ?? data?.sub_code,
    traceId: meta?.fbtrace_id,
    raw: meta ? { code: meta.code, subcode: meta.error_subcode, fbtrace_id: meta.fbtrace_id } : undefined,
  };

  return { message, details };
}