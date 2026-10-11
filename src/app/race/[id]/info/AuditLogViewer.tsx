import React, { useEffect, useMemo, useState } from "react";
import styles from "./auditLogViewer.module.css";
import { RaceProps } from "@/types/types";
import { AuditLogEntry } from "@/types/auditLog.types";
import { AuditLogService } from "@/services/auditLog/auditLogService";
import { X, Download, Search } from "lucide-react";

interface Props {
  race: RaceProps;
  onClose: () => void;
}

const AuditLogViewer: React.FC<Props> = ({ race, onClose }) => {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    AuditLogService.readEntries(race).then((loaded) => {
      if (cancelled) return;
      // Newest first.
      setEntries(loaded.slice().reverse());
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [race]);

  const users = useMemo(
    () => Array.from(new Set(entries.map((e) => e.performedBy.userName))).sort(),
    [entries]
  );
  const actions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.action))).sort(),
    [entries]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (userFilter && e.performedBy.userName !== userFilter) return false;
      if (actionFilter && e.action !== actionFilter) return false;
      if (!q) return true;
      const haystack = [
        e.action,
        e.entityType,
        e.entityId ?? "",
        e.screen,
        e.performedBy.userName,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, search, userFilter, actionFilter]);

  const handleExport = async () => {
    const ok = await AuditLogService.downloadLogFile(race);
    if (!ok) {
      // No entries yet, or OPFS unsupported — nothing to export.
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>Audit Log — {race.name}</div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.searchBox}>
            <Search size={14} />
            <input
              className={styles.searchInput}
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className={styles.filterSelect}
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <select
            className={styles.filterSelect}
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button className={styles.exportBtn} onClick={handleExport}>
            <Download size={14} />
            Export
          </button>
        </div>

        <div className={styles.list}>
          {loading ? (
            <div className={styles.empty}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>No log entries yet.</div>
          ) : (
            filtered.map((entry, i) => (
              <button
                key={i}
                className={styles.row}
                onClick={() => setSelected(entry)}
              >
                <span className={styles.rowTime}>
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
                <span className={styles.rowUser}>{entry.performedBy.userName}</span>
                <span className={styles.rowAction}>{entry.action}</span>
                <span className={styles.rowEntity}>
                  {entry.entityType}
                  {entry.entityId ? ` #${entry.entityId}` : ""}
                </span>
                {entry.data && <span className={styles.rowData}>{entry.data}</span>}
                {!entry.success && <span className={styles.rowFail}>FAILED</span>}
              </button>
            ))
          )}
        </div>
      </div>

      {selected && (
        <div className={styles.detailOverlay} onClick={() => setSelected(null)}>
          <div className={styles.detailModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.header}>
              <div className={styles.title}>Entry Detail</div>
              <button
                className={styles.closeBtn}
                onClick={() => setSelected(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <pre className={styles.detailJson}>{JSON.stringify(selected, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLogViewer;
