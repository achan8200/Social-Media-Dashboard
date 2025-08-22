import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface Notification {
  text: string;
  read: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private notificationsSubject = new BehaviorSubject<{ text: string; read: boolean }[]>([
    { text: 'User1 liked your post', read: false },
    { text: 'User2 commented on your photo', read: true },
    { text: 'User3 sent you a friend request', read: false },
  ]);

  notifications$ = this.notificationsSubject.asObservable();

  addNotification(notification: { text: string; read: boolean }) {
    const current = this.notificationsSubject.value;
    this.notificationsSubject.next([notification, ...current]);
  }

  getUnreadCount() {
    return this.notificationsSubject.value.filter(n => !n.read).length;
  }

  markAllAsRead() {
    const updated = this.notificationsSubject.value.map(n => ({ ...n, read: true }));
    this.notificationsSubject.next(updated);
  }

  markAsRead(index: number) {
    const updated = this.notificationsSubject.value.map((n, i) =>
      i === index ? { ...n, read: true } : n
    );
    this.notificationsSubject.next(updated);
  }
}