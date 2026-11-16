/**
 * 0.3.5 — official podium approval per category, for a shared race on Results.
 * Read from the server (GET /races/:uuid/approvals): the server re-checks every approval
 * against the current result, so a change made on any device shows up as withdrawn here
 * once this reloads. Reloads on open, after an approval, and (debounced) whenever the
 * race's results change on this device — no polling. Local races: nothing (no approval).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isLiveRace } from "@/services/live/liveBridge";
import type { CategoryApprovalView, ResultsApprovalView } from "../../../../shared/race/approval";

export interface CategoryApprovals {
  /** By category uuid. */
  byCategory: Map<string, CategoryApprovalView>;
  /** Category uuids this member may approve now (finished, permission, in scope). */
  canApprove: Set<string>;
  /** 1.2.1: race-wide approval as the server sees it now (null = never approved). */
  resultsApproval: ResultsApprovalView | null;
  /** The server has the race finalized (Finish Race) — the RESULTS status applies. */
  finalized: boolean;
  /** THIS member may approve the race's results now (owner/admin, finalized, not approved). */
  canApproveResults: boolean;
  reload: () => void;
}

const EMPTY: Omit<CategoryApprovals, "reload"> = { byCategory: new Map(), canApprove: new Set(), resultsApproval: null, finalized: false, canApproveResults: false };

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
        setState({
          byCategory: new Map(r.approvals.map((a) => [a.categoryUuid, a])),
          canApprove: new Set(r.canApprove),
          resultsApproval: r.resultsApproval ?? null,
          finalized: !!r.finalized,
          canApproveResults: !!r.canApproveResults,
        });
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
