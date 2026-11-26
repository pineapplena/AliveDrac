export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

export function showDesktopNotification(
  title: string,
  body: string,
  options: { icon?: string | null; tag?: string; onClick?: () => void } = {}
): boolean {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  try {
    const notification = new Notification(title, {
      body: body.replace(/\s+/g, ' ').slice(0, 180),
      icon: options.icon ?? undefined,
      tag: options.tag,
      silent: false
    });
    notification.onclick = () => {
      window.focus();
      options.onClick?.();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
