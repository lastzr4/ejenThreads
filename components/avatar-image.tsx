"use client";

import { useRef, useState } from "react";
import { refreshThreadsAvatar } from "@/app/dashboard/settings/refresh-avatar-action";

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
 * `oe=` expiry param and stop working days to weeks after being fetched
 * during OAuth connect, long before the actual access token expires. When
 * that happens, this tries once to fetch a fresh URL (via
 * refreshThreadsAvatar, using the still-valid access token already on
 * file — no reconnect needed) and swaps to it automatically. Only if that
 * also fails does it fall back to the plain "?" placeholder.
 */
export function AvatarImage({ src, alt, imgClassName, fallbackClassName, fallbackText }: AvatarImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [failed, setFailed] = useState(false);
  const triedRefresh = useRef(false);

  const handleError = async () => {
    if (triedRefresh.current) {
      setFailed(true);
      return;
    }
    triedRefresh.current = true;
    try {
      const fresh = await refreshThreadsAvatar();
      if (fresh) {
        setCurrentSrc(fresh);
        return;
      }
    } catch {
      // Falls through to the placeholder below.
    }
    setFailed(true);
  };

  if (!currentSrc || failed) {
    return <div className={fallbackClassName}>{fallbackText ?? "?"}</div>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={currentSrc} alt={alt} className={imgClassName} onError={handleError} />
  );
}
