import { Component } from '@angular/core';
import { CommonModule, AsyncPipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { NotificationUtilsService } from '../../services/notification-utils.service';
import { Notification } from '../../models/notification.model';
import { NotificationItem } from '../../components/notification-item/notification-item';
import { Observable, filter, switchMap, tap, map, shareReplay, firstValueFrom } from 'rxjs';

type DayKey = 'Today' | 'Yesterday' | 'Earlier';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, AsyncPipe, NotificationItem],
  templateUrl: './notifications.html',
  styleUrls: ['./notifications.css']
})
export class Notifications {
  notificationsByDay$!: Observable<Record<string, Notification[][]>>;
  unreadCount$!: Observable<number>;
  private latestNotifications: Notification[] = [];
  newNotification = false;

  showTopFade = false;
  showBottomFade = true;

  constructor(
    private authService: AuthService,
    private notificationsService: NotificationsService,
    private utils: NotificationUtilsService
  ) {}

  ngOnInit() {
    const raw$ = this.authService.authReady$.pipe(
      filter(Boolean),
      switchMap(() => this.authService.user$),
      filter(Boolean),
      switchMap(user => this.notificationsService.getNotifications(user!.uid)),
      tap(list => {
        this.latestNotifications = list;

        if (list.some(n => !n.read)) {
          this.newNotification = true;
          setTimeout(() => (this.newNotification = false), 300);
        }
      }),
      shareReplay(1)
    );

    this.notificationsByDay$ = raw$.pipe(
      map(list => this.utils.groupNotificationsByDay(list))
    );

    this.unreadCount$ = raw$.pipe(
      map(list => list.filter(n => !n.read).length)
    );
  }

  markAllRead() {
    this.notificationsService.markAllAsRead(this.latestNotifications);
  }

  onScroll(event: Event) {
    const target = event.target as HTMLElement;
    this.showTopFade = target.scrollTop > 5;
    this.showBottomFade = target.scrollTop + target.clientHeight < target.scrollHeight - 5;
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