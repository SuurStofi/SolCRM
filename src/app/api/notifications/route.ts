import { userRoute } from '@/lib/auth/route';
import { listNotifications, unreadCount, markAllRead } from '@/lib/alerts/notify';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return userRoute(request, 'GET /api/notifications', async (user) => {
    const [notifications, unread] = await Promise.all([
      listNotifications(user.id),
      unreadCount(user.id),
    ]);
    return {
      notifications: notifications.map((n) => ({
        ...n,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      unread,
    };
  });
}

/** Mark everything read, which is what opening the bell means. */
export async function POST(request: Request) {
  return userRoute(request, 'POST /api/notifications', async (user) => {
    await markAllRead(user.id);
    return { unread: 0 };
  });
}
