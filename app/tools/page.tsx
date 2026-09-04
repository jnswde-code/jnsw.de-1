import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireActiveUser } from "../auth";
import { SiteNav } from "../SiteNav";
import { ToolsExperience } from "./ToolsExperience";

export const metadata: Metadata = {
  title: "Tools – JNSW.DE",
  description: "Kostenlose Werkzeuge für digitale Arbeit – direkt und datensparsam im Browser.",
};

export const dynamic = "force-dynamic";

export default async function ToolsPage() {
  if (!(await requireActiveUser())) redirect("/community");
  return (
    <main className="tools-page">
      <SiteNav />
      <div className="tools-intro">
        <p className="eyebrow">
          JNSW.DE / Tools
          <br />
          Werkzeuge für konkrete Aufgaben.
        </p>
        <h1>
          Werkzeuge
          <br />
          für <em>Ideen.</em>
          <span>.</span>
        </h1>
        <p className="tools-lead">
          Kleine digitale Helfer, die lokal, verständlich und ohne unnötige Konten funktionieren.
        </p>
      </div>
      <ToolsExperience />
    </main>
  );
}
