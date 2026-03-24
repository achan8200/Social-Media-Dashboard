import { Injectable, inject } from '@angular/core';
import { Firestore, doc, setDoc, deleteDoc, docData, serverTimestamp, collection, collectionData, query, orderBy } from '@angular/fire/firestore';
import { NotificationsService } from './notifications.service';
import { Observable, map } from 'rxjs';

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

  // Reactive isFollowing observable
  isFollowing$(currentUserId: string, targetUserId: string): Observable<boolean> {
    const followerRef = doc(this.firestore, `users/${targetUserId}/followers/${currentUserId}`);
    return docData(followerRef, { idField: 'id' }).pipe(
      map(doc => !!doc)
    );
  }

  // Reactive followers list
  getFollowers(userId: string): Observable<{ uid: string; createdAt: any }[]> {
    const followersRef = query(
      collection(this.firestore, `users/${userId}/followers`),
      orderBy('createdAt', 'desc')
    );

    return collectionData(followersRef, { idField: 'uid' }).pipe(
      map(docs =>
        docs.map(doc => ({
          uid: doc.uid,
          createdAt: doc['createdAt'] ?? null
        }))
      )
    );
  }

  // Reactive following list
  getFollowing(userId: string): Observable<{ uid: string; createdAt: any }[]> {
    const followingRef = query(
      collection(this.firestore, `users/${userId}/following`),
      orderBy('createdAt', 'desc')
    );

    return collectionData(followingRef, { idField: 'uid' }).pipe(
      map(docs =>
        docs.map(doc => ({
          uid: doc.uid,
          createdAt: doc['createdAt'] ?? null
        }))
      )
    );
  }
}