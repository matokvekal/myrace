import Images from "@/constants/Images";

/**
 * Resolve a race's stored `image` value to a usable <img> src.
 *
 * ONE place so a card can't miss a case (BUGS.md #R4 — a gallery-selected cover
 * showed the default on the main page because RaceTile's copy of this logic was
 * missing the "images/" branch that RaceCard had).
 *
 * Handles, in order:
 *  - empty → default cover
 *  - base64 data URL (custom upload), absolute path, or http(s) URL → as-is
 *  - "images/foo.jpg" gallery path → served from BASE_URL (prod is /commissire-race/)
 *  - a named key of the Images constant → that asset
 *  - anything else → default cover
 */
export function resolveRaceImage(image: string | null | undefined): string {
  if (!image) return Images.defaultRaceBike;
  if (image.startsWith("data:") || image.startsWith("http") || image.startsWith("/")) {
    return image;
  }
  if (image.startsWith("images/")) return import.meta.env.BASE_URL + image;
  return (Images as Record<string, string>)[image] ?? Images.defaultRaceBike;
}
