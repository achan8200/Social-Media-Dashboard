import { Injectable } from '@angular/core';
import { Firestore, collection, query, where, orderBy, collectionData, addDoc, doc, updateDoc, serverTimestamp } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class MessagesService {
  constructor(private firestore: Firestore, private auth: Auth) {}

  getUserThreads(userId: string): Observable<any[]> {
    const ref = collection(this.firestore, 'threads');
    const q = query(
      ref,
      where('participants', 'array-contains', userId),
      orderBy('lastMessageAt', 'desc')
    );

    return collectionData(q, { idField: 'id' });
  }

  getMessages(threadId: string): Observable<any[]> {
    const ref = collection(this.firestore, `threads/${threadId}/messages`);
    const q = query(ref, orderBy('createdAt', 'asc'));

    return collectionData(q, { idField: 'id' });
  }

  async sendMessage(threadId: string, text: string) {
    const messageRef = collection(this.firestore, `threads/${threadId}/messages`);

    await addDoc(messageRef, {
      senderId: this.auth.currentUser?.uid,
      text,
      createdAt: serverTimestamp()
    });

    await updateDoc(doc(this.firestore, `threads/${threadId}`), {
      lastMessage: text,
      lastMessageAt: serverTimestamp()
    });
  }
}