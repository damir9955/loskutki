import { NextResponse } from 'next/server';
import { cancelRoom, getRoom, leaveRoom, requestRematch } from '@/lib/server/rooms';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mp/control — управление комнатой:
 *  op = 'leave'   — покинуть партию (сопернику уйдёт «партия брошена»)
 *  op = 'cancel'  — хост отменяет ожидающую комнату
 *  op = 'rematch' — запросить реванш (новая партия, когда оба согласны)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const code = typeof body?.code === 'string' ? body.code : '';
    const playerId = typeof body?.playerId === 'string' ? body.playerId : '';
    const op = typeof body?.op === 'string' ? body.op : '';
    const room = getRoom(code);
    if (!room) return NextResponse.json({ ok: true, error: 'notfound' });
    try {
      if (op === 'leave') leaveRoom(room, playerId);
      else if (op === 'cancel') cancelRoom(room, playerId);
      else if (op === 'rematch') {
        const res = requestRematch(room, playerId);
        return NextResponse.json({ ok: true, started: res.started });
      } else return NextResponse.json({ ok: false, error: 'badpayload' }, { status: 400 });
    } catch (e) {
      return NextResponse.json({ ok: false, error: typeof e === 'string' ? e : 'notfound' }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'badpayload' }, { status: 400 });
  }
}
