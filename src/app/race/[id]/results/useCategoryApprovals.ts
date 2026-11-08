/**
 * 0.3.5 — official podium approval per category, for a shared race on Results.
 * Read from the server (GET /races/:uuid/approvals): the server re-checks every approval
 * against the current result, so a change made on any device shows up as withdrawn here
 * once this reloads. Reloads on open, after an approval, and (debounced) whenever the
 * race's results change on this device — no polling. Local races: nothing (no approval).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isLiveRace } from "@/services/live/liveBridge";
import type { CategoryApprovalView } from "../../../../shared/race/approval";

export interface CategoryApprovals {
  /** By category uuid. */
  byCategory: Map<string, CategoryApprovalView>;
  /** Category uuids this member may approve now (finished, permission, in scope). */
  canApprove: Set<string>;
  reload: () => void;
}

const EMPTY: Omit<CategoryApprovals, "reload"> = { byCategory: new Map(), canApprove: new Set() };

export function useCategoryApprovals(raceUuid: string, resultsSignature: string): CategoryApprovals {
  const [state, setState] = useState(EMPTY);
  const live = isLiveRace(raceUuid);
  const seq = useRef(0);

  const reload = useCallback(() => {
    if (!isLiveRace(raceUuid)) return;
    const mine = ++seq.current;
    void import("@/services/live/liveClient")
      .then(({ team }) => team.approvals(raceUuid))
      .then((r) => {
        if (mine !== seq.current) return; // an older answer never overwrites a newer one
        setState({ byCategory: new Map(r.approvals.map((a) => [a.categoryUuid, a])), canApprove: new Set(r.canApprove) });
      })
      .catch(() => {
        /* offline / older server: keep what we have; nothing is shown as approved by mistake */
      });
  }, [raceUuid]);

  useEffect(() => {
    if (!live) {
      setState(EMPTY);
      return;
    }
    const t = setTimeout(reload, seq.current === 0 ? 0 : 1500);
    return () => clearTimeout(t);
  }, [live, reload, resultsSignature]);

  return { ...state, reload };
}
