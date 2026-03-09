import { getTeamBySlug } from "@/lib/team";
import { getAllSettings } from "@/lib/settings";
import { notFound } from "next/navigation";
import SettingsClient from "@/app/settings/SettingsClient";
import "@/app/settings/settings.css";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) return notFound();

  const settings = await getAllSettings(team.id);
  return <SettingsClient initialSettings={settings} teamSlug={slug} teamId={team.id} />;
}
