import 'server-only';

import { prisma } from '../db';
import { safeLog, redact } from '../binance/redact';

/**
 * Telling the user something happened.
 *
 * The in-app record is always written; extra channels are senders that may
 * also deliver it. Built as a list so Telegram or email is a new sender
 * rather than an edit to every caller -- and so a channel failing never loses
 * the notification, because the row is already saved.
 */

export interface NotificationInput {
  /** price_alert | autotrade | system */
  type: string;
  title: string;
  body: string;
  link?: string;
}

export interface NotificationSender {
  readonly name: string;
  /** Whether this deployment has what the sender needs. */
  isConfigured(): boolean;
  send(userId: string, notification: NotificationInput): Promise<void>;
}

/**
 * Browser push. Not implemented: it needs VAPID keys and a stored
 * subscription per device, and sending to a subscription nobody opted into
 * would be worse than not sending at all.
 *
 * Present so the shape is settled and the bell is not the only possible
 * channel by accident.
 */
const webPushSender: NotificationSender = {
  name: 'web-push',
  isConfigured: () =>
    Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
  async send() {
    // Deliberately a no-op until subscriptions are stored. Returning quietly
    // beats throwing, which would make a working in-app notification look
    // like a failure.
  },
};

const SENDERS: NotificationSender[] = [webPushSender];

/**
 * Record a notification and attempt every configured channel.
 *
 * The database write comes first on purpose: a push that fails should not
 * lose the message, because the bell is the channel everyone has.
 */
export async function notify(
  userId: string,
  notification: NotificationInput,
): Promise<void> {
  await prisma.notification.create({
    data: {
      userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      link: notification.link ?? null,
    },
  });

  for (const sender of SENDERS) {
    if (!sender.isConfigured()) continue;
    try {
      await sender.send(userId, notification);
    } catch (error) {
      // A channel failing is not worth failing the caller over: the record
      // exists and the user will see it in the app.
      safeLog.warn(`[notify] ${sender.name} failed: ${redact(error)}`);
    }
  }
}

export async function listNotifications(userId: string, limit = 30) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
