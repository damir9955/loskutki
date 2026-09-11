import { NextResponse } from 'next/server';
import { storePing } from '@/lib/server/rooms';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mp/ping — живность мультиплеера.
 * Открыть в браузере, чтобы проверить, что серверные функции работают.
 */
export async function GET() {
  const res = await storePing();
  return NextResponse.json({ ok: res.ok, at: Date.now() });
}
