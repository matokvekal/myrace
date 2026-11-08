import React from "react";
import RaceTopBar from "../raceSidebar/RaceTopBar";

/** Create / Race screen header: the shared race top bar (+ optional right-hand controls). */
function HeaderRace({ children }: { children?: React.ReactNode }) {
  return <RaceTopBar>{children}</RaceTopBar>;
}

export default HeaderRace;
