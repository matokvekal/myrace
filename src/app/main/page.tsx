"use client";

import { useState, useEffect } from "react";
import Cookies from "js-cookie";
import styles from "./main.module.css";
import AddRace from "./addRace/AddRace";
import { useRouter } from "next/navigation";
import MyRaces from "./myRaces/MyRaces";
import AllRaces from "./allRaces/AllRaces";
import HeaderMain from "./components/headerMain/HeaderMain";

// const Messages = dynamic(() => import("@/components/messeges/Messages"), {
//   ssr: false,
// });
// import CircularProgress from "@mui/material/CircularProgress";

import {} from "@/types/types";
const MainPage = () => {
  const [loading, setLoading] = useState(false);
  const [addNewwRace, setAddNewwRace] = useState(false);

  const router = useRouter();

  // if (loading) {
  //   return (
  //     <CircularProgress
  //       sx={{
  //         color: "var(--primary-green)"
  //       }}
  //     />
  //   );
  // }

  return (
    <>
      {loading ? (
        <div>Loading</div>
      ) : (
        <div className={styles.main}>
          {addNewwRace ? (
            <AddRace setAddNewwRace={setAddNewwRace} />
          ) : (
            <>
              <HeaderMain />
              <MyRaces setAddNewwRace={setAddNewwRace} />
              <AllRaces />
            </>
          )}
        </div>
      )}
    </>
  );
};

export default MainPage;
