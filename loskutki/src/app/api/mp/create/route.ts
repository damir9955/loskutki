import { NextResponse } from 'next/server';
import { createRoom } from '@/lib/server/rooms';

export const dynamic = 'force-dynamic';

/** POST /api/mp/create — создать комнату (приватную по коду или открытую) */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { code, playerId } = await createRoom({
      name: body?.name,
      avatar: body?.avatar,
      isPublic: body?.isPublic,
    });
    return NextResponse.json({ ok: true, code, playerId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: typeof e === 'string' ? e : 'badpayload' }, { status: 400 });
  }
}
