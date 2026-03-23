import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, query, where, orderBy, doc, updateDoc, serverTimestamp, setDoc } from '@angular/fire/firestore'; 
import { Notification } from '../models/notification.model';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private firestore = inject(Firestore);
  
  getNotifications(uid: string): Observable<Notification[]> {
    const ref = collection(this.firestore, 'notifications');
    const q = query(
      ref,
      where('recipientUid', '==', uid),
      orderBy('createdAt', 'desc')
    );
    return collectionData(q, { idField: 'id' }) as Observable<Notification[]>;
  }

  async createNotification(notification: Partial<Notification>) {
    const { recipientUid, actorUid, type, postId, commentId, threadId } = notification;

    if (!recipientUid || !actorUid || !type) {
      console.warn('createNotification: missing required fields', notification);
      return;
    }

    // Prevent self-notifications
    if (recipientUid === actorUid) return;

    try {
      // Build deterministic id
      let id = `${recipientUid}_${type}_${actorUid}`;

      if (postId) id += `_${postId}`;
      if (commentId) id += `_${commentId}`;
      if (threadId) id += `_${threadId}`;

      const ref = doc(this.firestore, `notifications/${id}`);

      const payload: any = {
        recipientUid,
        actorUid,
        type,
        read: false,
        updatedAt: serverTimestamp()
      };

      if (postId) payload.postId = postId;
      if (commentId) payload.commentId = commentId;
      if (threadId) payload.threadId = threadId;

      console.log('Creating/updating notification:', id, payload);

      // merge: true prevents overwriting important fields unintentionally
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp()
      }, { merge: true });

      console.log('Notification upsert successful');

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
}