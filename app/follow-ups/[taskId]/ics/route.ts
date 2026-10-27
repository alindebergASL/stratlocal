import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getTask } from "@/lib/planning";
import { getAccount } from "@/lib/queries/accounts";
import { icsCalendar, icsResponseHeaders } from "@/lib/calendar/icsWrite";
export const runtime = "nodejs";

// One follow-up as a calendar file, on its due day with a reminder.
export async function GET(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  return handle(async () => {
    requireUser(req);
    const { taskId } = await params;
    const task = getTask(taskId);
    if (!task || task.archived_at) return NextResponse.json({ error: "No such follow-up." }, { status: 404 });
    if (!task.due) return NextResponse.json({ error: "This follow-up has no date." }, { status: 400 });
    const account = getAccount(task.account_id);
    const body = icsCalendar(task.text, [{ uid: `${task.id}@strategy`, day: task.due, title: task.text, description: [account?.kind === "customer" ? account.name : null, task.notes].filter(Boolean).join("\n\n") || null }]);
    return new NextResponse(body, { headers: icsResponseHeaders(task.text) });
  });
}
