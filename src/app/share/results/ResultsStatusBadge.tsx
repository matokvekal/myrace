/**
 * 1.2.1 — the ONE race-wide RESULTS status indicator, shown after Finish Race:
 * PROVISIONAL (awaiting approval) until the owner/admin approves, then OFFICIAL (approved at …).
 * Used by the public RESULTS tab and the app's Results screen. Derived from the server's
 * approval (valid only), never stored on the device.
 */
import React from "react";
import { BadgeCheck, Hourglass } from "lucide-react";
import type { ResultsApprovalView } from "../../../shared/race/approval";
import styles from "./results.module.css";

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ResultsStatusBadge({ approval, testId = "results-status" }: { approval: ResultsApprovalView | null | undefined; testId?: string }) {
  const official = approval?.status === "approved";
  return (
    <p className={styles.status} data-status={official ? "official" : "provisional"} role="status" data-testid={testId}>
      {official ? <BadgeCheck size={15} aria-hidden="true" /> : <Hourglass size={14} aria-hidden="true" />}
      <b>{official ? "Official" : "Provisional"}</b>
      <span dir="auto">
        {official
          ? `Approved ${hhmm(approval!.approvedAt)}${approval!.approvedByName ? ` · ${approval!.approvedByName}` : ""}`
          : approval?.status === "invalidated"
            ? "Changed after approval · awaiting re-approval"
            : "Awaiting approval"}
      </span>
    </p>
  );
}
