import { NextResponse } from 'next/server';
import { roomControl } from '@/lib/server/rooms';

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
    if (op !== 'leave' && op !== 'cancel' && op !== 'rematch') {
      return NextResponse.json({ ok: false, error: 'badpayload' }, { status: 400 });
    }
    try {
      const res = await roomControl(code, playerId, op);
      return NextResponse.json({ ok: true, ...res });
    } catch (e) {
      return NextResponse.json({ ok: false, error: typeof e === 'string' ? e : 'notfound' }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'badpayload' }, { status: 400 });
  }
}
