import { Component } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { map, Observable, firstValueFrom } from 'rxjs';
import { Notification } from '../../models/notification.model';
import { NotificationItem } from '../notification-item/notification-item';
import { TrendingTag } from '../trending-tag/trending-tag';

type DayKey = 'Today' | 'Yesterday' | 'Earlier';

@Component({
  selector: 'app-right-sidebar',
  standalone: true,
  imports: [AsyncPipe, CommonModule, NotificationItem, TrendingTag],
  templateUrl: './right-sidebar.html',
  styleUrls: ['./right-sidebar.css']
})
export class RightSidebar {

  trending = [
    '#Angular',
    '#TailwindCSS',
    '#Firebase',
  ];

  notificationsByDay$!: Observable<Record<string, Notification[][]>>;
  unreadCount$!: Observable<number>;
  
  newNotification = false;
  private latestNotifications: Notification[] = [];
  
  constructor(private notificationsService: NotificationsService, private authService: AuthService) {}

  async ngOnInit() {
    const user = await firstValueFrom(this.authService.getCurrentUser());
    if (!user) return;

    // Original notifications stream
    const raw$ = this.notificationsService.getNotifications(user.uid);

    // Count unread notifications
    this.unreadCount$ = raw$.pipe(
      map(list => list.filter(n => !n.read).length)
    );

    // Track latest notifications for marking read
    raw$.subscribe(list => {
      this.latestNotifications = list;
      if (list.some(n => !n.read)) {
        this.newNotification = true;
        setTimeout(() => this.newNotification = false, 300);
      }
    });

    // Group notifications by day and then type/post/comment
    this.notificationsByDay$ = raw$.pipe(
      map(list => {
        const grouped = this.groupNotificationsByDay(list);
        return grouped;
      })
    );
  }

  markAllRead() {
    this.notificationsService.markAllAsRead(this.latestNotifications);
  }

  markNotificationRead(id?: string) {
    if (!id) return;
    this.notificationsService.markAsRead(id);
  }

  onTagClicked(tag: string) {
    console.log('Tag clicked:', tag);
  }

  // Groups notifications first by day, then by type/post/comment
  private groupNotificationsByDay(list: Notification[]): Record<string, Notification[][]> {
    const days: Record<string, Notification[][]> = {};

    list.forEach(n => {
      const date = n.createdAt?.toDate?.();
      const dayKey = this.getNotificationSection(date) || 'Earlier';

      if (!days[dayKey]) {
        days[dayKey] = [];
      }

      // Build grouping key
      let key = n.type;
      switch (n.type) {
        case 'like_post':
        case 'comment_post':
        case 'like_comment':
          key += `_${n.postId || ''}_${n.commentId || ''}`;
          break;

        case 'follow':
          key = 'follow';
          break;
      }

      // Find existing group
      let group = days[dayKey].find(g => {
        const gKey = g[0]?.type + '_' + (g[0]?.postId || '') + '_' + (g[0]?.commentId || '');
        return gKey === key;
      });

      // Create new group if not found
      if (!group) {
        group = [];
        days[dayKey].push(group);
      }

      group.push(n);
    });

    // Sorting
    Object.keys(days).forEach(day => {
      // Sort notifications inside each group (newest first)
      days[day].forEach(group => {
        group.sort((a, b) => {
          const timeA = a.createdAt?.toDate?.()?.getTime() ?? 0;
          const timeB = b.createdAt?.toDate?.()?.getTime() ?? 0;
          return timeB - timeA;
        });
      });

      // Sort groups by most recent notification in each group
      days[day].sort((a, b) => {
        const timeA = a[0]?.createdAt?.toDate?.()?.getTime() ?? 0;
        const timeB = b[0]?.createdAt?.toDate?.()?.getTime() ?? 0;
        return timeB - timeA;
      });
    });

    return days;
  }

  // Determine section label
  getNotificationSection(date?: Date): 'Today' | 'Yesterday' | 'Earlier' {
    if (!date) return 'Earlier';
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const d = new Date(date);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return 'Earlier';
  }

  readonly dayOrder: Record<DayKey, number> = {
    Today: 0,
    Yesterday: 1,
    Earlier: 2
  };

  sortDays = (a: { key: string }, b: { key: string }): number => {
    return this.dayOrder[a.key as DayKey] - this.dayOrder[b.key as DayKey];
  };
}