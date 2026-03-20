import { Component, ElementRef, HostListener } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { NotificationUtilsService } from '../../services/notification-utils.service';
import { Notification } from '../../models/notification.model';
import { NotificationItem } from '../notification-item/notification-item';
import { UserService } from '../../services/user.service';
import { Observable, filter, firstValueFrom, map, shareReplay, switchMap, tap } from 'rxjs';
import { trigger, transition, style, animate } from '@angular/animations';

type DayKey = 'Today' | 'Yesterday' | 'Earlier';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, AsyncPipe, NotificationItem],
  templateUrl: './navbar.html',
  styleUrls: ['./navbar.css'],
  animations: [
    trigger('dropdownAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95)' }),
        animate('120ms ease-out', style({ opacity: 1, transform: 'scale(1)' }))
      ]),
      transition(':leave', [
        animate('100ms ease-in', style({ opacity: 0, transform: 'scale(0.95)' }))
      ])
    ])
  ]
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
    private utils: NotificationUtilsService,
    private router: Router,
    private elementRef: ElementRef
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

    this.notifications$ = raw$;

    this.unreadCount$ = raw$.pipe(
      map(list => list.filter(n => !n.read).length)
    );

    this.notificationsByDay$ = raw$.pipe(
      map(list => this.utils.groupNotificationsByDay(list))
    );
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

  async goToProfile() {
    const authUser = await firstValueFrom(this.authService.getCurrentUser());
    if (!authUser) return;
    const appUser = await firstValueFrom(this.userService.getUserByUid(authUser.uid));
    if (!appUser) return;

    if (appUser.userId != null) this.router.navigate(['/profile', appUser.userId]);
    else if (appUser.username) this.router.navigate(['/u', appUser.username]);
    else console.warn('[NAVBAR] No username or userId available for profile navigation');
  }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: Event) {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.showNotifications = false;
    }
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