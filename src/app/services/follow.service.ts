import { Injectable, inject } from '@angular/core';
import { Firestore, doc, setDoc, deleteDoc, docData } from '@angular/fire/firestore';
import { map, take } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { serverTimestamp } from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class FollowService {
  private firestore = inject(Firestore);

  // Follow a user
  async followUser(currentUserId: string, targetUserId: string): Promise<void> {
    const followerRef = doc(this.firestore, `users/${targetUserId}/followers/${currentUserId}`);
    const followingRef = doc(this.firestore, `users/${currentUserId}/following/${targetUserId}`);

    await Promise.all([
      setDoc(followerRef, { createdAt: serverTimestamp() }),
      setDoc(followingRef, { createdAt: serverTimestamp() })
    ]);
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