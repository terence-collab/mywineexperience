"use client";

import { useEffect } from "react";

export default function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator)
      void navigator.serviceWorker.register("/service-worker.js");
  }, []);
  return null;
}
