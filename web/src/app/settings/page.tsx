import { redirect } from "next/navigation";
import { getAllTeams } from "@/lib/team";
import "./settings.css";

export const dynamic = "force-dynamic";

export default async function SettingsRedirect() {
  const teams = await getAllTeams();

  // Redirect to the first team's settings (salescloser)
  if (teams.length > 0) {
    redirect(`/t/${teams[0].slug}/settings`);
  }

  redirect("/");
}
