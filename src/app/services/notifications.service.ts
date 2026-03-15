import { Injectable, inject } from '@angular/core';
import { Firestore, collection, setDoc, collectionData, query, where, orderBy, doc, updateDoc, serverTimestamp } from '@angular/fire/firestore'; 
import { Observable } from 'rxjs';
import { Notification } from '../models/notification.model';

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
    const recipientUid = notification.recipientUid;
    const actorUid = notification.actorUid;
    const type = notification.type;

    if (!recipientUid || !actorUid || !type) return;

    let id = `${recipientUid}_${type}_${actorUid}`;

    // Add resource identifiers if they exist
    if (notification.postId) {
      id += `_${notification.postId}`;
    }

    if (notification.commentId) {
      id += `_${notification.commentId}`;
    }

    if (notification.threadId) {
      id += `_${notification.threadId}`;
    }

    const ref = doc(this.firestore, `notifications/${id}`);

    await setDoc(ref, {
      ...notification,
      createdAt: serverTimestamp(),
      read: false
    }, { merge: true });
  }

  async markAsRead(notificationId: string) {
    const ref = doc(this.firestore, `notifications/${notificationId}`);
    await updateDoc(ref, { read: true });
  }

  async markAllAsRead(notifications: Notification[]) {
    const unread = notifications.filter(n => !n.read && n.id);
    for (const n of unread) {
      const ref = doc(this.firestore, `notifications/${n.id}`);
      await updateDoc(ref, { read: true });
    }
  }
}