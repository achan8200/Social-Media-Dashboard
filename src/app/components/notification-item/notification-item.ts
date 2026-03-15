import { Component, Input, OnChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Notification } from '../../models/notification.model';
import { UserService, User } from '../../services/user.service';
import { NotificationsService } from '../../services/notifications.service';
import { combineLatest, map, Observable, of } from 'rxjs';
import { Avatar } from '../avatar/avatar';

@Component({
  selector: 'app-notification-item',
  standalone: true,
  imports: [CommonModule, Avatar],
  templateUrl: './notification-item.html',
  styleUrls: ['./notification-item.css']
})
export class NotificationItem implements OnChanges {
  @Input() notifications!: Notification[];

  private userService = inject(UserService);
  private notificationsService = inject(NotificationsService);

  actors$!: Observable<any[]>;
  previewActors$!: Observable<User[]>;

  ngOnChanges() {
    if (!this.notifications?.length) {
      this.actors$ = of([]);
      return;
    }

    // Fetch actors using cached UserService
    const requests = this.notifications.map(n =>
      this.userService.getUserByUid(n.actorUid).pipe(
        map(user => user ?? { username: 'Someone', userId: '', profilePicture: null, uid: n.actorUid })
      )
    );

    // Combine all actor observables into one array
    this.actors$ = combineLatest(requests).pipe(
      map(actors => {
        return actors;
      })
    );

    this.previewActors$ = this.actors$.pipe(
      map(actors => actors.slice(0, 2))
    );
  }

  // Mark all notifications in this group as read
  markAsRead() {
    this.notifications.forEach(n => {
      if (!n.read && n.id) {
        this.notificationsService.markAsRead(n.id);
        n.read = true; // optimistically update local state
      }
    });
  }

  // Check if any notification in this group is unread
  get hasUnread(): boolean {
    return this.notifications?.some(n => !n.read);
  }
}