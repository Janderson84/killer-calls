import type { Metadata } from "next";
import SalesClient from "./SalesClient";

export const metadata: Metadata = {
  title: "Killer Calls — AI-Powered Sales Coaching",
  description:
    "Every call scored. Every rep coached. Zero manager hours. Killer Calls reviews every demo against a 100-point rubric and delivers coaching your team actually uses.",
};

export default function SalesPage() {
  return <SalesClient />;
}
