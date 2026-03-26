import { NextResponse } from "next/server";
import { fetchInstances } from "@/lib/evolution";

export async function GET() {
  try {
    const instances = await fetchInstances();
    return NextResponse.json(instances);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch instances", details: String(error) },
      { status: 500 }
    );
  }
}
