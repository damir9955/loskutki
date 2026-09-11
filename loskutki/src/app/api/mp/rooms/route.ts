import { NextResponse } from 'next/server';
import { listRooms } from '@/lib/server/rooms';

export const dynamic = 'force-dynamic';

/** GET /api/mp/rooms — список открытых комнат (+ чистка протухших) */
export async function GET() {
  const rooms = await listRooms();
  return NextResponse.json({ ok: true, rooms });
}
