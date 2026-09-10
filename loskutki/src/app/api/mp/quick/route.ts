import { NextResponse } from 'next/server';
import { quickCancel, quickMatch } from '@/lib/server/rooms';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mp/quick — быстрый матч (автопоиск).
 *  { playerId?, name, avatar }            → { status: 'matched', code, playerId }
 *                                        или { status: 'waiting', playerId }
 *  { playerId, op: 'cancel' }            → { ok: true }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.op === 'cancel') {
      quickCancel(body?.playerId);
      return NextResponse.json({ ok: true });
    }
    const res = quickMatch({
      playerId: body?.playerId,
      name: body?.name,
      avatar: body?.avatar,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: typeof e === 'string' ? e : 'badpayload' }, { status: 400 });
  }
}
