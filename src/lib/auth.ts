import { getServerSession } from "next-auth";
import { NextResponse, type NextRequest } from "next/server";

export async function requireAuth() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// Aceita NextAuth session OU Authorization: Bearer <CRON_SECRET>.
// Vercel Cron envia automaticamente esse header quando o env CRON_SECRET existe.
// Permite que o mesmo endpoint sirva pra trigger manual (UI logada) e pra cron.
export async function requireAuthOrCron(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader === `Bearer ${cronSecret}`) return null;
  }
  return requireAuth();
}
