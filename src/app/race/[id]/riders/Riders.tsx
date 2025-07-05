"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback
} from "react";
import styles from "./riders.module.css";
import useRiderStore from "@/stores/ridersStore";
import { RiderProps } from "@/types/types";
import RiderCard from "../../components/riderCard/RiderCard";
import Image from "next/image";
import Icons from "@/constants/Icons";
import { shallow } from "zustand/shallow";
import { debounce } from "lodash"; // ✅ Import debounce to optimize scrolling

interface ManageHeatProps {
  raceUuid: string;
}

const Riders: React.FC<ManageHeatProps> = ({ raceUuid }) => {
  const previousRaceUuid = useRef<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // ✅ Optimize Zustand Selector
  const { getRiders, riders } = useRiderStore(
    (state) => ({
      getRiders: state.getRiders,
      riders: state.riders
    }),
    shallow // ✅ Prevents unnecessary re-renders when only `riders` changes
  );

  console.log("at riders ------------");

  // ✅ Prevent multiple API calls
  useEffect(() => {
    if (previousRaceUuid.current !== raceUuid) {
      getRiders(raceUuid);
      previousRaceUuid.current = raceUuid; // ✅ Store the last fetched race ID
    }
  }, [raceUuid, getRiders]);

  // ✅ Optimize scrolling with debounce
  useEffect(() => {
    const handleScroll = debounce(() => {
      setIsVisible(window.scrollY > 50);
    }, 100); // ✅ Only update state every 100ms

    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      handleScroll.cancel(); // ✅ Cancel debounce on unmount
    };
  }, []);

  // ✅ Memoize riders list to prevent unnecessary re-renders
  const renderedRiders = useMemo(
    () => riders.map((rider) => <RiderCard key={rider.id} {...rider} />),
    [riders]
  );

  return (
    <div className={styles.riders}>
      {riders.length > 0 && (
        <div className={styles.tabCount}> Riders({riders.length})</div>
      )}
      {riders.length > 0 ? (
        <>
          {renderedRiders}

          <div
            className={`${styles.goUp} ${
              isVisible ? styles.show : styles.hide
            }`}
          >
            <Image
              src={Icons.goup}
              alt="go up"
              width={20}
              height={20}
              onClick={() => {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </div>
        </>
      ) : (
        <p>No riders found for this race.</p>
      )}
    </div>
  );
};

// ✅ Prevent unnecessary re-renders of Riders component
export default React.memo(Riders);
