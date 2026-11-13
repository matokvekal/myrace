/**
 * TV footer: what the screen shows (provisional / official), the page indicator with a thin
 * progress bar for the page timer, and data freshness (never old data shown as current).
 */
import React from "react";
import type { FeedFreshness } from "../feedStatus";
import { PAGE_MS } from "./useBroadcast";
import styles from "./broadcast.module.css";

export function BroadcastFooter({
  note,
  page,
  pages,
  pageLabel,
  freshness,
  updatedAt,
}: {
  note: string;
  page: number;
  pages: number;
  pageLabel?: string | null;
  freshness: FeedFreshness;
  updatedAt: number | null;
}) {
  const at = updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—";
  return (
    <footer className={styles.footer} data-testid="tv-footer">
      {pages > 1 && <span key={page} className={styles.pageTimer} style={{ animationDuration: `${PAGE_MS}ms` }} aria-hidden="true" />}
      <span className={styles.note}>{note}</span>
      <span className={styles.pager} data-testid="tv-pager" aria-label={pages > 1 ? `Page ${page + 1} of ${pages}` : undefined}>
        {pageLabel && <span className={styles.pageLabel} dir="auto">{pageLabel}</span>}
        {pages > 1 && (
          <>
            <span className={styles.dots} aria-hidden="true">
              {Array.from({ length: Math.min(pages, 12) }, (_, i) => (
                <span key={i} className={styles.dot} data-on={i === page ? "true" : undefined} />
              ))}
            </span>
            <span>Page {page + 1} / {pages}</span>
          </>
        )}
      </span>
      <span className={styles.fresh} data-freshness={freshness} data-testid="tv-freshness">
        {freshness === "fresh" ? `Updated ${at}` : freshness === "ended" ? `Live updates ended · ${at}` : `Data delayed · last update ${at}`}
      </span>
    </footer>
  );
}

/** Cut a list into pages of `per` (at least one page, possibly empty). */
export function chunk<T>(list: T[], per: number): T[][] {
  const n = Math.max(1, per);
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out.length ? out : [[]];
}
