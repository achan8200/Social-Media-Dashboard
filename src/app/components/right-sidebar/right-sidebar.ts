import { Component } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { NotificationUtilsService } from '../../services/notification-utils.service';
import { Notification } from '../../models/notification.model';
import { NotificationItem } from '../notification-item/notification-item';
import { TrendingTag } from '../trending-tag/trending-tag';
import { map, Observable, firstValueFrom } from 'rxjs';

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

  isGuest$!: Observable<boolean>;
  notificationsByDay$!: Observable<Record<string, Notification[][]>>;
  unreadCount$!: Observable<number>;
  
  newNotification = false;
  private latestNotifications: Notification[] = [];
  
  constructor(
    private notificationsService: NotificationsService,
    private utils: NotificationUtilsService,
    private authService: AuthService
  ) {}

  async ngOnInit() {
    this.isGuest$ = this.authService.user$.pipe(
      map(user => !user)  // true if no user is logged in
    );
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
        const grouped = this.utils.groupNotificationsByDay(list);
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

  readonly dayOrder: Record<DayKey, number> = {
    Today: 0,
    Yesterday: 1,
    Earlier: 2
  };

  sortDays = (a: { key: string }, b: { key: string }): number => {
    return this.dayOrder[a.key as DayKey] - this.dayOrder[b.key as DayKey];
  };
}