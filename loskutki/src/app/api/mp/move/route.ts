import { NextResponse } from 'next/server';
import { applyAction, getRoom, viewFor } from '@/lib/server/rooms';
import type { NetAction } from '@/lib/game/types';

export const dynamic = 'force-dynamic';

/** POST /api/mp/move — ход игрока (advance | buy | leather) */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const code = typeof body?.code === 'string' ? body.code : '';
    const playerId = typeof body?.playerId === 'string' ? body.playerId : '';
    const action = body?.action as NetAction | undefined;
    const room = getRoom(code);
    if (!room) return NextResponse.json({ ok: false, error: 'notfound' }, { status: 404 });
    if (!action || typeof action.type !== 'string') {
      return NextResponse.json({ ok: false, error: 'badpayload' }, { status: 400 });
    }
    try {
      const seat = room.host.id === playerId ? 0 : room.guest?.id === playerId ? 1 : null;
      if (seat === null) return NextResponse.json({ ok: false, error: 'notfound' }, { status: 404 });
      applyAction(room, seat, action);
    } catch (e) {
      const err = typeof e === 'string' ? e : 'illegal';
      return NextResponse.json({ ok: false, error: err }, { status: 409 });
    }
    const view = viewFor(room, playerId);
    return NextResponse.json({ ok: true, view });
  } catch {
    return NextResponse.json({ ok: false, error: 'badpayload' }, { status: 400 });
  }
}
