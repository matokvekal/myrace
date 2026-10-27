import type { CategoryProps, RiderProps } from "@/types/types";
import useCategoryStore from "@/stores/categoryStore";
import { resolveBibColors } from "@/utils/bibColors";

type BibRider = Pick<RiderProps, "bibNumber" | "bibColor" | "bibTextColor" | "raceUuid" | "category" | "subCategory">;

/**
 * A rider's bib number in its bib colours when set (rider override → category
 * default), else plain. The category is looked up in the store when not given.
 */
export default function BibBadge({
  rider,
  category,
  className,
  prefix = "#",
}: {
  rider: BibRider;
  category?: Pick<CategoryProps, "bibColor" | "bibTextColor"> | null;
  className?: string;
  prefix?: string;
}) {
  const stored = useCategoryStore((s) =>
    category !== undefined
      ? null
      : s.categories.find(
          (c) => c.raceUuid === rider.raceUuid && c.name === rider.category && (c.subCategory ?? null) === (rider.subCategory ?? null)
        ) ?? null
  );
  const colors = resolveBibColors(rider, category !== undefined ? category : stored);
  const label = rider.bibNumber ? `${prefix}${rider.bibNumber}` : "—";
  if (!colors) return <span className={className} data-testid="bib">{label}</span>;
  return (
    <span
      className={className}
      data-testid="bib"
      data-bib-colored="true"
      style={{
        background: colors.bg,
        color: colors.fg,
        padding: "1px 6px",
        borderRadius: 4,
        border: "1px solid rgba(0,0,0,0.25)",
        fontWeight: 800,
        display: "inline-block",
        minWidth: "2.2em",
        textAlign: "center",
      }}
    >
      {label}
    </span>
  );
}
