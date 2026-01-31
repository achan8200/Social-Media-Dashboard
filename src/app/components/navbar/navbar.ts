import { Component } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { NotificationsService } from '../../services/notifications.service';
import { map, Observable } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [AsyncPipe, CommonModule],
  templateUrl: './navbar.html',
  styleUrls: ['./navbar.css']
})
export class Navbar {
  showNotifications = false;

  notifications$: Observable<{ text: string; read: boolean }[]>;
  unreadCount$: Observable<number>;

  newNotification = false;

  constructor(
    public auth: AuthService,
    private router: Router,
    private notificationsService: NotificationsService
  ) {
    this.notifications$ = this.notificationsService.notifications$;
    this.unreadCount$ = this.notifications$.pipe(
      map(notifications => notifications.filter(n => !n.read).length)
    );

    // Detect new notifications
    this.notifications$.subscribe(list => {
      if (list.some(n => !n.read)) {
        this.newNotification = true;
        setTimeout(() => this.newNotification = false, 300); // remove class after animation
      }
    });
  }

  toggleNotifications() {
    this.showNotifications = !this.showNotifications;
  }

  markAllRead() {
    this.notificationsService.markAllAsRead();
  }

  markNotificationRead(index: number) {
    this.notificationsService.markAsRead(index);
  }

  async logout() {
    console.log('[NAVBAR] logout clicked'); // test
    await this.auth.logout();
    this.router.navigate(['/login'], { replaceUrl: true });
  }
}