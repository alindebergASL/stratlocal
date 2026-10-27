import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getAccount } from "@/lib/queries/accounts";
import { roadmap } from "@/lib/playbook/roadmap";
import { icsCalendar, icsResponseHeaders } from "@/lib/calendar/icsWrite";
export const runtime = "nodejs";

// The open, dated milestones of an account's action plan as one calendar file.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireUser(req);
    const { id } = await params;
    const account = getAccount(id);
    if (!account) return NextResponse.json({ error: "No such account." }, { status: 404 });
    const items = roadmap(id)
      .milestones.filter((m) => m.status === "open" && m.due)
      .map((m) => ({ uid: `${m.id}@strategy`, day: m.due!, title: `${account.name}: ${m.text}`, description: `Mutual action plan · ${m.play.title}` }));
    if (!items.length) return NextResponse.json({ error: "No open, dated milestones." }, { status: 400 });
    return new NextResponse(icsCalendar(`${account.name} action plan`, items), { headers: icsResponseHeaders(`${account.name} action plan`) });
  });
}
