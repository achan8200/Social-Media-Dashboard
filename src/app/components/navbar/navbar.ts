import { Component } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Observable, filter, firstValueFrom, of, switchMap, tap } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { Notification } from '../../models/notification.model';
import { NotificationItem } from '../notification-item/notification-item';
import { UserService, User } from '../../services/user.service';

type DayKey = 'Today' | 'Yesterday' | 'Earlier';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, AsyncPipe, NotificationItem],
  templateUrl: './navbar.html',
  styleUrls: ['./navbar.css'],
})
export class Navbar {
  showNotifications = false;

  notifications$!: Observable<Notification[]>;
  notificationsByDay$!: Observable<Record<string, Notification[][]>>;
  unreadCount$!: Observable<number>;
  newNotification = false;

  private latestNotifications: Notification[] = [];

  constructor(
    private authService: AuthService,
    private userService: UserService,
    private notificationsService: NotificationsService,
    private router: Router
  ) {}

  ngOnInit() {
    // Wait until auth is ready and user exists
    this.authService.authReady$
      .pipe(
        filter(ready => ready), // only continue once auth is initialized
        switchMap(() => this.authService.user$),
        filter(user => !!user), // skip null
        switchMap(user => {
          return this.notificationsService.getNotifications(user!.uid).pipe(
            tap(list => {
              this.latestNotifications = list;
              if (list.some(n => !n.read)) {
                this.newNotification = true;
                setTimeout(() => (this.newNotification = false), 300);
              }
            })
          );
        })
      )
      .subscribe(list => {
        this.notifications$ = of(list);
        this.unreadCount$ = of(list.filter(n => !n.read).length);
        this.notificationsByDay$ = of(this.groupNotificationsByDay(list));
      });
  }

  toggleNotifications() {
    this.showNotifications = !this.showNotifications;
  }

  markAllRead() {
    this.notificationsService.markAllAsRead(this.latestNotifications);
  }

  markNotificationRead(id?: string) {
    if (!id) return;
    this.notificationsService.markAsRead(id);
  }

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

  private getNotificationSection(date?: Date): 'Today' | 'Yesterday' | 'Earlier' {
    if (!date) return 'Earlier';
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const d = new Date(date);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return 'Earlier';
  }

  async goToProfile() {
    const authUser = await firstValueFrom(this.authService.getCurrentUser());
    if (!authUser) return;
    const appUser = await firstValueFrom(this.userService.getUserByUid(authUser.uid));
    if (!appUser) return;

    if (appUser.userId != null) this.router.navigate(['/profile', appUser.userId]);
    else if (appUser.username) this.router.navigate(['/u', appUser.username]);
    else console.warn('[NAVBAR] No username or userId available for profile navigation');
  }

  async logout() {
    await this.authService.logout();
    this.router.navigate(['/login'], { replaceUrl: true });
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