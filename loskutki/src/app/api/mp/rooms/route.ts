import { NextResponse } from 'next/server';
import { listRooms } from '@/lib/server/rooms';

export const dynamic = 'force-dynamic';

/** GET /api/mp/rooms — список открытых комнат */
export async function GET() {
  return NextResponse.json({ ok: true, rooms: listRooms() });
}
