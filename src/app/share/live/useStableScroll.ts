/**
 * LIVE scroll stability (hotfix 2026-11-23). A spectator scrolled into the standings must stay
 * on the same place when an update arrives: no jump, no reset to top, no auto-scroll.
 *
 * Native scroll anchoring is OFF for the whole LIVE tab (`.live { overflow-anchor: none }`):
 * Chrome/Firefox anchored on a visible row and followed it when it moved to another place.
 * Rows only reorder inside a list of the same length and row height, so without anchoring the
 * same positions stay under the reader's eyes. What can still shift the lists is content ABOVE
 * them changing height (stale banner, "No lap recorded yet", a divider). This hook keeps the
 * list the reader is in at the same screen position: after each render it compares that list's
 * top with where it was and scrolls by the difference — only when it moved, so a normal update
 * (nothing above changed) never touches the scroll and never interrupts a scroll in progress.
 * Works the same in Safari (no native anchoring).
 */
import { useLayoutEffect, useRef, type RefObject } from "react";

interface Anchor { index: number; top: number }

/** The last list whose top is above the viewport top (the one being read), or null at the top. */
function readAnchor(root: HTMLElement): Anchor | null {
  const lists = root.querySelectorAll("ol");
  let found: Anchor | null = null;
  lists.forEach((ol, index) => {
    const top = ol.getBoundingClientRect().top;
    if (top < 0) found = { index, top };
  });
  return found;
}

export function useStableScroll(rootRef: RefObject<HTMLElement | null>): void {
  const anchor = useRef<Anchor | null>(null);

  // Remember the anchor whenever the reader scrolls (scroll is the only other thing that moves it).
  useLayoutEffect(() => {
    // The root can appear later (LIVE shows "No Active Wave" first), so read the ref each time.
    const onScroll = () => {
      const root = rootRef.current;
      anchor.current = root ? readAnchor(root) : null;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [rootRef]);

  // After every render: put the list being read back where it was.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const before = anchor.current;
    if (!root) return;
    if (before) {
      const ol = root.querySelectorAll("ol")[before.index];
      if (ol) {
        const delta = Math.round(ol.getBoundingClientRect().top - before.top);
        if (delta !== 0) window.scrollBy(0, delta);
      }
    }
    anchor.current = readAnchor(root);
  });
}
