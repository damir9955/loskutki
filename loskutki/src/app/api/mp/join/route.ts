import { NextResponse } from 'next/server';
import { joinRoom } from '@/lib/server/rooms';

export const dynamic = 'force-dynamic';

/** POST /api/mp/join — войти в комнату по коду (партия стартует сразу) */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { code, playerId } = joinRoom({
      code: body?.code,
      name: body?.name,
      avatar: body?.avatar,
      playerId: body?.playerId,
    });
    return NextResponse.json({ ok: true, code, playerId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: typeof e === 'string' ? e : 'badpayload' }, { status: 400 });
  }
}
