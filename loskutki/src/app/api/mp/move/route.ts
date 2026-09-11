import { NextResponse } from 'next/server';
import { roomMove } from '@/lib/server/rooms';
import type { NetAction } from '@/lib/game/types';

export const dynamic = 'force-dynamic';

/** POST /api/mp/move — ход игрока (advance | buy | leather).
 *  Конфликт одновременных ходов разрешается перечитыванием (CAS). */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const code = typeof body?.code === 'string' ? body.code : '';
    const playerId = typeof body?.playerId === 'string' ? body.playerId : '';
    const action = body?.action as NetAction | undefined;
    if (!action || typeof action.type !== 'string') {
      return NextResponse.json({ ok: false, error: 'badpayload' }, { status: 400 });
    }
    try {
      const view = await roomMove(code, playerId, action);
      return NextResponse.json({ ok: true, view });
    } catch (e) {
      const err = typeof e === 'string' ? e : 'illegal';
      return NextResponse.json({ ok: false, error: err }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'badpayload' }, { status: 400 });
  }
}
