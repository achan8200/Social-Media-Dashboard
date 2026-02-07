import { Component } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { NotificationsService } from '../../services/notifications.service';
import { map, Observable, of, switchMap, take } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import { doc, docData, Firestore, getDoc } from '@angular/fire/firestore';

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
    private firestore: Firestore,
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

  goToProfile() {
    this.auth.getCurrentUser().pipe(take(1)).subscribe(async user => {
      if (!user) return;

      const userRef = doc(this.firestore, `users/${user.uid}`);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        console.warn('[NAVBAR] User doc missing');
        return;
      }

      const data = snap.data();

      // Prefer username-based route
      if (data['username']) {
        this.router.navigate(['/u', data['username']]);
        return;
      }

      // Fallback to numeric userId
      if (data['userId'] != null) {
        this.router.navigate(['/profile', data['userId']]);
        return;
      }

      console.warn('[NAVBAR] No username or userId available for profile navigation');
    });
  }

  async logout() {
    console.log('[NAVBAR] logout clicked'); // test
    await this.auth.logout();
    this.router.navigate(['/login'], { replaceUrl: true });
  }
}