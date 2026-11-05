import React, { useState } from "react";

/**
 * A rider's country flag.
 *
 * Renders NOTHING when the rider has no flag, or when the asset is missing —
 * instead of the browser's broken-image alt text (BUGS.md #5).
 *
 * Two things were wrong before:
 *  - the src was hardcoded to "/international/…", but the app is served from
 *    import.meta.env.BASE_URL ("/commissire-race/" in prod), so every flag 404'd
 *    in production and fell back to showing its alt text;
 *  - a rider with no flag defaulted to "il", which both mislabelled them and
 *    404'd for anyone whose flag isn't one of the few files we actually ship
 *    (public/international currently has gb, il, it, us only).
 *
 * alt is intentionally empty: the flag is decorative next to the rider's name,
 * so a broken one must degrade to nothing, never to text.
 */
interface RiderFlagProps {
  flag?: string | null;
  className?: string;
  size?: number;
}

const RiderFlag: React.FC<RiderFlagProps> = ({ flag, className, size = 14 }) => {
  const [failed, setFailed] = useState(false);

  const code = flag?.trim().toLowerCase();
  if (!code || failed) return null;

  return (
    <img
      src={`${import.meta.env.BASE_URL}international/${code}.svg`}
      alt=""
      width={size}
      height={size}
      className={className}
      onError={() => setFailed(true)}
    />
  );
};

export default RiderFlag;
