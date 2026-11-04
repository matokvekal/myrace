/**
 * Where to go after a successful sign-in / registration / password reset:
 * the `?next=` page when it is a safe in-app path, else All Races (/main).
 * Never another site ("//evil", "https:"), never back to /account or /login
 * (that would loop), so a bad link can't trap or redirect the user.
 */
export const ALL_RACES = "/main";

export function afterAuthTarget(next: string | null | undefined): string {
  if (!next) return ALL_RACES;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return ALL_RACES;
  const path = next.split(/[?#]/)[0].toLowerCase();
  if (path === "/account" || path.startsWith("/account/") || path === "/login" || path === "/otp") return ALL_RACES;
  return next;
}
