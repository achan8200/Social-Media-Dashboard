import { Injectable, inject } from '@angular/core';
import { Firestore, doc, setDoc, deleteDoc, docData, serverTimestamp } from '@angular/fire/firestore';
import { NotificationsService } from './notifications.service';
import { Observable, map, take } from 'rxjs';

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

  async removeFollower(currentUserId: string, followerUid: string): Promise<void> {
    const followerRef = doc(this.firestore, `users/${currentUserId}/followers/${followerUid}`);
    const followingRef = doc(this.firestore, `users/${followerUid}/following/${currentUserId}`);

    try {
      // Remove follower and their corresponding following doc simultaneously
      await Promise.all([
        deleteDoc(followerRef),
        deleteDoc(followingRef)
      ]);

      console.log(`Removed follower ${followerUid} from ${currentUserId}`);
    } catch (error) {
      console.error('Failed to remove follower fast:', error);
      throw error;
    }
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