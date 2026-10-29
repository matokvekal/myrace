import React, { useEffect, useRef, useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import styles from "./map.module.css";

/** One geocoding hit. */
interface Place {
  lat: number;
  lng: number;
  label: string;
}

/**
 * Worldwide place search (Hebrew and English) for the map editor, on
 * OpenStreetMap's Nominatim — free, no key, no dependency. Debounced and
 * cancellable to respect its usage policy (≤ 1 request/second). Picking a
 * place only moves the map; nothing is saved until "Set area".
 */
const PlaceSearch: React.FC<{ onPick: (p: Place) => void }> = ({ onPick }) => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setResults([]);
      setState("idle");
      return;
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setState("loading");
      try {
        const url =
          "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=he,en&q=" +
          encodeURIComponent(term);
        const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(String(res.status));
        const data: { lat: string; lon: string; display_name: string }[] = await res.json();
        const places = data.map((d) => ({ lat: Number(d.lat), lng: Number(d.lon), label: d.display_name }));
        setResults(places);
        setState(places.length ? "idle" : "empty");
        setOpen(true);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setResults([]);
        setState("error");
        setOpen(true);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const pick = (p: Place) => {
    onPick(p);
    setOpen(false);
    setQ(p.label.split(",")[0]);
  };

  return (
    <div className={styles.placeSearch}>
      <div className={styles.placeInputWrap}>
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          dir="auto"
          className={styles.placeInput}
          placeholder="Search a place (city, park, address…)"
          aria-label="Search a place"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) pick(results[0]);
            if (e.key === "Escape") setOpen(false);
          }}
          data-testid="place-search"
        />
        {state === "loading" && <span className={styles.placeHint}>…</span>}
        {q && (
          <button type="button" className={styles.placeClear} onClick={() => { setQ(""); setOpen(false); }} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <div className={styles.placeList} role="listbox">
          {state === "error" && <div className={styles.placeMsg}>Search unavailable (offline?). Try again later.</div>}
          {state === "empty" && <div className={styles.placeMsg}>No places found.</div>}
          {results.map((p, i) => (
            <button
              key={`${p.lat},${p.lng},${i}`}
              type="button"
              role="option"
              aria-selected={false}
              className={styles.placeItem}
              onClick={() => pick(p)}
              dir="auto"
            >
              <MapPin size={14} aria-hidden="true" />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default PlaceSearch;
