"use client";
import Image from "next/image";
import Icons from "@/constants/Icons";
import React from "react";
import "./headerLogo.css"; // Import your custom CSS file for styling

function HeaderLogo() {
  return (
    <div className="logo">
      <Image
        src={Icons.logo}
        alt="headerLogo"
        width={280}
        height={80}
      />
      {/* <div className="textlogo">commissire</div> */}
    </div>
  );
}

export default HeaderLogo;
