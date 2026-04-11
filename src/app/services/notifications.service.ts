import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, query, where, orderBy, doc, updateDoc, serverTimestamp, setDoc, deleteDoc } from '@angular/fire/firestore'; 
import { Notification } from '../models/notification.model';
import { Observable, of } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private firestore = inject(Firestore);
  
  getNotifications(uid: string): Observable<Notification[]> {
    if (!uid) return of([]);
    const ref = collection(this.firestore, 'notifications');
    const q = query(
      ref,
      where('recipientUid', '==', uid),
      orderBy('createdAt', 'desc')
    );
    return collectionData(q, { idField: 'id' }) as Observable<Notification[]>;
  }

  async createNotification(notification: Partial<Notification>) {
    const { recipientUid, actorUid, postOwnerUid, type, postId, commentId, threadId } = notification;

    if (!recipientUid || !actorUid || !type) {
      console.warn('createNotification: missing required fields', notification);
      return;
    }

    // Prevent self-notifications
    if (recipientUid === actorUid) return;

    try {
      // Build deterministic id
      let id = `${recipientUid}_${type}`;

      // Special case for thread_added
      if (type === 'thread_added' && threadId) {
        id = `${recipientUid}_${type}_${threadId}`;
      } else {
        id += `_${actorUid}`;
        if (postId) id += `_${postId}`;
        if (commentId) id += `_${commentId}`;
        if (threadId) id += `_${threadId}`;
      }

      const ref = doc(this.firestore, `notifications/${id}`);

      const payload: any = {
        recipientUid,
        actorUid,
        type,
        read: false,
        updatedAt: serverTimestamp()
      };

      switch (type) {
        case 'like_post':
        case 'comment_post':
          payload.postId = postId;
          payload.postOwnerUid = postOwnerUid;
          break;

        case 'like_comment':
          payload.postId = postId;
          payload.commentId = commentId;
          break;

        case 'thread_added':
          payload.threadId = threadId;
          break;
      }

      console.log('Creating notification:', id, payload);

      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp()
      });

    } catch (err) {
      console.error('Failed to create notification:', err);
    }
  }

  async markAsRead(notificationId: string) {
    const ref = doc(this.firestore, `notifications/${notificationId}`);
    await updateDoc(ref, { read: true });
  }

  async markAllAsRead(notifications: Notification[]) {
    const unread = notifications.filter(n => !n.read && n.id);

    await Promise.all(
      unread.map(n => {
        const ref = doc(this.firestore, `notifications/${n.id}`);
        return updateDoc(ref, { read: true });
      })
    );
  }

  async deleteNotification(notification: Partial<Notification>) {
    const { recipientUid, actorUid, type, postId, commentId, threadId } = notification;

    if (!recipientUid || !type) {
      console.warn('deleteNotification: missing required fields', notification);
      return;
    }

    try {
      // Build same deterministic ID
      let id = `${recipientUid}_${type}`;

      if (type === 'thread_added' && threadId) {
        id = `${recipientUid}_${type}_${threadId}`;
      } else {
        id += `_${actorUid}`;
        if (postId) id += `_${postId}`;
        if (commentId) id += `_${commentId}`;
        if (threadId) id += `_${threadId}`;
      }

      const ref = doc(this.firestore, `notifications/${id}`);

      await deleteDoc(ref);

      console.log('Notification deleted:', id);
    } catch (err) {
      console.error('Failed to delete notification:', err);
    }
  }
}