"use client";

import { useState } from "react";

interface AvatarImageProps {
  src: string | null;
  alt: string;
  imgClassName: string;
  fallbackClassName: string;
  fallbackText?: string;
}

/**
 * Threads/Instagram profile picture URLs (from Meta's CDN, e.g.
 * scontent-*.cdninstagram.com) are signed and time-limited — they carry an
 * `oe=` expiry param and typically stop working days to weeks after being
 * fetched during OAuth connect. Once that happens a plain <img> just shows
 * the browser's broken-image icon forever, since nothing tells it to fall
 * back. This swaps to a plain "?" circle instead as soon as the image
 * actually fails to load (a real fix — refetching a fresh URL from Meta
 * periodically — would need its own backend job; this at least keeps the
 * UI clean in the meantime).
 */
export function AvatarImage({ src, alt, imgClassName, fallbackClassName, fallbackText }: AvatarImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return <div className={fallbackClassName}>{fallbackText ?? "?"}</div>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={imgClassName} onError={() => setFailed(true)} />
  );
}
