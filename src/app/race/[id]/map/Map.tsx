import React, { useState, useEffect } from "react";
import styles from "./riders.module.css";
import useRiderStore from "@/stores/ridersStore";
import { RiderProps } from "@/types/types";

interface ManageHeatProps {
  raceUuid: string;
}

const Map: React.FC<ManageHeatProps> = ({ raceUuid }) => {


  return (
    <>
      map...

    </>
  );
};

export default Map;
