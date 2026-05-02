import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { NotificationUtilsService } from '../../services/notification-utils.service';
import { Notification } from '../../models/notification.model';
import { NotificationItem } from '../notification-item/notification-item';
import { UserService } from '../../services/user.service';
import { GroupsService } from '../../services/groups.service';
import { Avatar } from "../avatar/avatar";
import { trigger, transition, style, animate } from '@angular/animations';
import { BehaviorSubject, Observable, combineLatest, debounceTime, distinctUntilChanged, filter, firstValueFrom, map, of, shareReplay, switchMap, tap } from 'rxjs';

type DayKey = 'Today' | 'Yesterday' | 'Earlier';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, FormsModule, AsyncPipe, NotificationItem, Avatar],
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
  isGuest$!: Observable<boolean>;
  showNotifications = false;

  notifications$!: Observable<Notification[]>;
  notificationsByDay$!: Observable<Record<string, Notification[][]>>;
  unreadCount$!: Observable<number>;
  newNotification = false;

  private latestNotifications: Notification[] = [];

  searchQuery = '';
  searchType: 'user' | 'group' = 'user';

  showResults = false;
  showSearchTypeDropdown = false;

  private searchSubject = new BehaviorSubject<string>('');
  private searchTypeSubject = new BehaviorSubject<'user' | 'group'>(this.searchType);

  results$!: Observable<any[]>;

  @ViewChild('searchContainer') searchContainer!: ElementRef;

  constructor(
    private authService: AuthService,
    private userService: UserService,
    private notificationsService: NotificationsService,
    private utils: NotificationUtilsService,
    private groupsService: GroupsService,
    private router: Router,
    private elementRef: ElementRef
  ) {}

  ngOnInit() {
    this.isGuest$ = this.authService.user$.pipe(
      map(user => !user)  // true if no user is logged in
    );
    const raw$ = this.authService.authReady$.pipe(
    filter(Boolean),
    switchMap(() => this.authService.user$),
    switchMap(user => {
      if (!user) return of([]);
      return this.notificationsService.getNotifications(user.uid);
    }),
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

    this.results$ = combineLatest([
      this.searchSubject,
      this.searchTypeSubject
    ]).pipe(
      debounceTime(150),
      switchMap(([query, type]) => {
        const q = query.trim();
        if (!q) return of([]);

        return type === 'user'
          ? this.userService.searchUsers(q)
          : this.groupsService.searchGroups(q);
      })
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

  async goToSettings() {
    const authUser = await firstValueFrom(this.authService.getCurrentUser());
    if (!authUser) return;

    this.router.navigate(['/settings']);
  }

  onSearchChange() {
    const query = this.searchQuery.trim();

    // hide dropdown if empty
    if (!query) {
      this.showResults = false;
      this.searchSubject.next('');
      return;
    }

    this.showResults = true;
    this.searchSubject.next(query);
  }

  toggleSearchTypeDropdown(event: Event) {
    event.stopPropagation();
    this.showSearchTypeDropdown = !this.showSearchTypeDropdown;
  }

  setSearchType(type: 'user' | 'group') {
    this.searchType = type;
    this.searchTypeSubject.next(type);
    this.showSearchTypeDropdown = false;

    const q = this.searchQuery.trim();

    if (!q) {
      this.showResults = false;
      return;
    }

    if (q) this.searchSubject.next(q);
    this.showResults = true;
  }

  goToResult(item: any) {
    this.showResults = false;
    this.showSearchTypeDropdown = false;

    if (this.searchType === 'user') {
      this.searchQuery = item.displayName;
      this.searchSubject.next(this.searchQuery);
      this.router.navigate(['/u', item.username]);
    } else {
      this.searchQuery = item.name;
      this.searchSubject.next(this.searchQuery);
      this.router.navigate(['/group', item.id]);
    }
  }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;

    const clickedInsideSearch =
      this.searchContainer?.nativeElement.contains(target);

    const clickedInsideNotifications =
      this.elementRef.nativeElement.contains(target);

    if (!clickedInsideSearch && !clickedInsideNotifications) {
      this.showResults = false;
      this.showSearchTypeDropdown = false;
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