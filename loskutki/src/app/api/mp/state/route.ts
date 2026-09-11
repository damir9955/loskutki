import { NextResponse } from 'next/server';
import { roomState } from '@/lib/server/rooms';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mp/state — текущий вид комнаты для игрока (poll ~1.5с).
 * Заодно тикает таймауты ходов и отмечает присутствие.
 * Комната читается из хранилища (см. roomStore.ts).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const code = typeof body?.code === 'string' ? body.code : '';
    const playerId = typeof body?.playerId === 'string' ? body.playerId : '';
    const view = await roomState(code, playerId);
    return NextResponse.json({ ok: true, view });
  } catch (e) {
    return NextResponse.json({ ok: false, error: typeof e === 'string' ? e : 'notfound' }, { status: 404 });
  }
}
