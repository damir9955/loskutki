import { NextResponse } from 'next/server';
import { roomChat } from '@/lib/server/rooms';

export const dynamic = 'force-dynamic';

/** POST /api/mp/chat — сообщение в чат партии (HTTP-фолбэк без WS).
 *  Возвращает свежий вид комнаты: в нём обновлённый чат партии. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const code = typeof body?.code === 'string' ? body.code : '';
    const playerId = typeof body?.playerId === 'string' ? body.playerId : '';
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!code || !playerId || !text.trim()) {
      return NextResponse.json({ ok: false, error: 'badpayload' }, { status: 400 });
    }
    try {
      const view = await roomChat(code, playerId, text);
      return NextResponse.json({ ok: true, view });
    } catch (e) {
      const err = typeof e === 'string' ? e : 'illegal';
      return NextResponse.json({ ok: false, error: err }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'badpayload' }, { status: 400 });
  }
}
