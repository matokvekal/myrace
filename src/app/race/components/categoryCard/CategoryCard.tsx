import React, { useState } from "react";
import styles from "./categoryCard.module.css";
import ButtonStart from "../buttons/ButtonStart";
import Icons from "@/constants/Icons";
import useUIStore from "@/stores/uiStore";

const CategoryCard = ({ category, setSelectedCategory }: any) => {
  const { openModal } = useUIStore();


  const handleClick = () => {
    console.log("Clicked settings for:", category.name);
    setSelectedCategory(category); 
    openModal("modalCategorySettings"); 
  };



  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <div className={styles.left}>
          <div className={styles.leftTop}>
            <div
              className={styles.stageColor}
              style={{ background: `${category.color || "lightgray"}` }}
            ></div>
            <div className={styles.categoryName}> {category.name}</div>
            <div className={styles.dot}></div>
            <div className={styles.participents}>
              <img src={Icons.bike} alt="bike" width={12} height={12} className={styles.icon} />
              {category.riders}
            </div>
          </div>
          <div className={styles.leftBottom}>
            <div className={styles.laps}>
              {category.lapsCounter || 0}/{category.laps || 0} Laps
            </div>
            <div className={styles.dot}></div>
            <div className={styles.start}>{category.startTime || "--:--"}</div>
   
          </div>
        </div>
        <div className={styles.buttons}>
          <img src={Icons.setting} alt="setting" width={20} height={20} className={styles.setting} onClick={handleClick} />
          {/* <ButtonStart category={category} /> */}
          <div>Running</div>
        </div>
      </div>
    </div>
  );
};

export default CategoryCard;
