"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Cookies from "js-cookie";
import { useDataStore } from "@/stores/appStore";
import dynamic from "next/dynamic";
// import { getCookie } from "@/utils/storageUtils";
import "./globals.css";

const listofLoginPages = ["/login", "/otp", "/loginerror"];

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useDataStore((state) => state.user);

  useEffect(() => {
    const token = Cookies.get("token");
    // if (pathname && !token && !listofLoginPages.includes(pathname)) {

    //redirect to main only if pathname id like "/" meen no other path
    if (pathname === "/") {
      router.push("/main");
    }
  }, [user, pathname, router, listofLoginPages]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=375, initial-scale=1" />
        <title>Bike race commissaire</title>
        <link rel="icon" href="/favicon.ico" />
      </head>
        <body>
          {children}
        </body>
    </html>
  );
}
