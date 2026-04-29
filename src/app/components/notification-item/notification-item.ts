import { Component, Input, OnChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationsService } from '../../services/notifications.service';
import { NotificationUtilsService } from '../../services/notification-utils.service';
import { Notification } from '../../models/notification.model';
import { UserService, User } from '../../services/user.service';
import { Avatar } from '../avatar/avatar';
import { combineLatest, firstValueFrom, map, Observable, of } from 'rxjs';
import { Router } from '@angular/router';

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
  private utils = inject(NotificationUtilsService);
  private router = inject(Router);

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

  async onClick() {
    if (!this.notifications?.length) return;

    const n = this.notifications[0];

    // Mark entire group as read
    this.markAsRead();

    switch (n.type) {
      case 'like_post':
      case 'comment_post':
      case 'like_comment':
        if (n.postId) {
          if (n.type === 'like_comment') {
            this.router.navigate(['/post', n.postId], { queryParams: { comment: n.commentId } });
          } else {
            this.router.navigate(['/post', n.postId]);
          }
        }
        break;


      case 'follow':
        if (!n.actorUid) return;

        // Get userId before routing
        firstValueFrom(this.userService.getUserByUid(n.actorUid))
          .then(user => {
            if (user?.userId) {
              this.router.navigate(['/profile', user.userId]);
            }
          });
        break;

      case 'thread_added':
        if (n.threadId) {
          this.router.navigate(['/messages'], { queryParams: { threadId: n.threadId } });
        }
        break;

      case 'promote':
        if (n.groupId) {
          this.router.navigate(['/group', n.groupId]);
        }
        break;

      default:
        console.warn('[Notification] Unhandled type:', n.type);
    }
  }

  // Check if any notification in this group is unread
  get hasUnread(): boolean {
    return this.notifications?.some(n => !n.read);
  }

  getFormattedTimeForGroup(): string {
    const date = this.notifications[0]?.createdAt?.toDate?.();
    return this.utils.formatNotificationTimestamp(date);
  }

  formatActorsText(actors: any[]): string {
    if (!actors || actors.length === 0) return 'Someone';

    if (actors.length === 1) {
      return actors[0].username;
    }

    if (actors.length === 2) {
      return `${actors[0].username} and ${actors[1].username}`;
    }

    // 3+ users
    const othersCount = actors.length - 1;
    return `${actors[0].username} and ${othersCount} others`;
  }
}