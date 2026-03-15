import { Component } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { map, Observable, firstValueFrom } from 'rxjs';
import { Notification } from '../../models/notification.model';
import { NotificationItem } from '../notification-item/notification-item';
import { TrendingTag } from '../trending-tag/trending-tag';

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
      const dayKey = this.getNotificationSection(n.createdAt?.toDate?.()) || 'Earlier';
      if (!days[dayKey]) days[dayKey] = [];

      // create type+post+comment key
      let key = n.type;
      if (n.type === 'like_post' || n.type === 'comment_post' || n.type === 'like_comment') {
        key += `_${n.postId || ''}_${n.commentId || ''}`;
      }

      // find existing group in this day
      let group = days[dayKey].find(g => {
        const gKey = g[0]?.type + '_' + (g[0]?.postId || '') + '_' + (g[0]?.commentId || '');
        return gKey === key;
      });

      if (!group) {
        group = [];
        days[dayKey].push(group);
      }

      group.push(n);
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
}