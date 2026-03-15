import { Injectable, inject } from '@angular/core';
import { Firestore, doc, setDoc, deleteDoc, docData, serverTimestamp } from '@angular/fire/firestore';
import { Observable, map, take } from 'rxjs';
import { NotificationsService } from './notifications.service';

@Injectable({ providedIn: 'root' })
export class FollowService {
  private firestore = inject(Firestore);
  private notificationsService = inject(NotificationsService);

  // Follow a user
  async followUser(currentUserId: string, targetUserId: string): Promise<void> {
    const followerRef = doc(this.firestore, `users/${targetUserId}/followers/${currentUserId}`);
    const followingRef = doc(this.firestore, `users/${currentUserId}/following/${targetUserId}`);

    await Promise.all([
      setDoc(followerRef, { createdAt: serverTimestamp() }),
      setDoc(followingRef, { createdAt: serverTimestamp() })
    ]);

    // Prevent self-follow notifications
    if (currentUserId !== targetUserId) {
      await this.notificationsService.createNotification({
        recipientUid: targetUserId,
        actorUid: currentUserId,
        type: 'follow'
      });
    }
  }

  // Unfollow a user
  async unfollowUser(currentUserId: string, targetUserId: string): Promise<void> {
    const followerRef = doc(this.firestore, `users/${targetUserId}/followers/${currentUserId}`);
    const followingRef = doc(this.firestore, `users/${currentUserId}/following/${targetUserId}`);

    await Promise.all([
      deleteDoc(followerRef),
      deleteDoc(followingRef)
    ]);
  }

  // Check if current user is following target user
  isFollowing(currentUserId: string, targetUserId: string): Observable<boolean> {
    const followerRef = doc(this.firestore, `users/${targetUserId}/followers/${currentUserId}`);
    return docData(followerRef, { idField: 'id' }).pipe(
      take(1),
      map(doc => !!doc)
    );
  }
}