import { Injectable } from '@angular/core';
import { Firestore, collection, query, where, orderBy, getDocs, addDoc, serverTimestamp, updateDoc, doc, collectionData, getDoc, docData } from '@angular/fire/firestore';
import { Auth, authState } from '@angular/fire/auth';
import { Observable, forkJoin, from, map, switchMap, of, tap } from 'rxjs';
import { Thread, Message } from '../models/messages.model';
import { User } from './user.service';

@Injectable({ providedIn: 'root' })
export class MessagesService {
  private usersCache$?: Observable<User[]>;

  constructor(private firestore: Firestore, private auth: Auth) {}

  /** Wait for auth token before Firestore query */
  private withAuth<T>(fn: (uid: string) => Observable<T>): Observable<T> {
    return authState(this.auth).pipe(
      switchMap(user => {
        if (!user?.uid) return of([] as unknown as T); // safe empty array
        return from(user.getIdToken()).pipe(
          switchMap(() => fn(user.uid))
        );
      })
    );
  }

  /** Get threads for current user with reactive unread count */
  getUserThreads(): Observable<Thread[]> {
    const currentUser = this.auth.currentUser;

    if (!currentUser?.uid) {
      console.log('No current user logged in.');
      return of([]);
    }

    const uid = currentUser.uid;
    const ref = collection(this.firestore, 'threads');

    // Query threads where user is a participant, ordered by lastMessageAt
    const q = query(ref, where('participants', 'array-contains', uid), orderBy('lastMessageAt', 'desc'));

    // Reactive observable
    return collectionData(q as any, { idField: 'id' }).pipe(
      map((threads: any[]) =>
        threads.map(t => ({
          id: t.id,
          participants: t.participants || [],
          lastMessage: t.lastMessage || null,
          lastMessageAt: t.lastMessageAt || null,
          unreadCount: (t.unreadByUser?.[uid]) || 0, // use per-user count
          typing: t.typing || {}
        } as Thread))
      )
    );
  }

  async getOrCreateThread(otherUserId: string): Promise<string> {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) throw new Error('Not authenticated');

    const uid = currentUser.uid;
    const participants = [uid, otherUserId].sort(); // keep consistent order

    const ref = collection(this.firestore, 'threads');

    // Since Firestore can't query for arrays exactly, check existing threads manually
    const q = query(ref, where('participants', 'array-contains', uid));
    const snapshot = await getDocs(q);

    // Look for thread where participants exactly match our pair
    const existingThread = snapshot.docs.find(docSnap => {
      const data = docSnap.data();
      const docParticipants: string[] = data['participants'] || [];
      return (
        docParticipants.length === participants.length &&
        participants.every(p => docParticipants.includes(p))
      );
    });

    if (existingThread) {
      return existingThread.id;
    }

    // Create new thread
    const docRef = await addDoc(ref, {
      participants,
      lastMessageAt: serverTimestamp()
    });

    return docRef.id;
  }

  /** Get all users except current */
  getAllUsers(): Observable<User[]> {
    if (this.usersCache$) return this.usersCache$;

    this.usersCache$ = authState(this.auth).pipe(
      switchMap(user => {
        if (!user) return of([]);

        return from(user.getIdToken()).pipe(
          switchMap(() => {
            const ref = collection(this.firestore, 'users');
            const q = query(ref, where('uid', '!=', user.uid));
            return collectionData(q) as Observable<User[]>;
          })
        );
      })
    );

    return this.usersCache$;
  }

  /** Send a message */
  async sendMessage(threadId: string, text: string) {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) throw new Error('User not authenticated');

    const threadDocRef = doc(this.firestore, `threads/${threadId}`);
    const threadDocSnap = await getDoc(threadDocRef);

    const threadData = threadDocSnap.data();
    const participants: string[] = threadData?.['participants'] || [];
    if (!participants.includes(currentUser.uid)) {
      throw new Error('User is not a participant of this thread or thread does not exist');
    }

    const messageRef = collection(this.firestore, `threads/${threadId}/messages`);
    const createdAt = serverTimestamp();
    
    // Add the new message
    await addDoc(messageRef, {
      senderId: currentUser.uid,
      text,
      createdAt,
      readBy: [currentUser.uid], // sender has read
    });

    // Compute unreadCount per participant
    const unreadCounts: Record<string, number> = {};
    participants.forEach(uid => {
      unreadCounts[uid] = uid === currentUser.uid ? 0 : (threadData?.['unreadByUser']?.[uid] || 0) + 1;
    });

    // Update thread atomically
    await updateDoc(threadDocRef, {
      lastMessage: {
        text,
        senderId: currentUser.uid,
        createdAt,
      },
      lastMessageAt: createdAt,
      unreadByUser: unreadCounts
    });
  }

  /** Get messages for a thread */
  getMessages(threadId: string): Observable<Message[]> {
    return this.withAuth(userId => {
      const ref = collection(this.firestore, `threads/${threadId}/messages`);
      const q = query(ref, orderBy('createdAt', 'asc'));

      return collectionData(q, { idField: 'id' }).pipe(
        map((messages: any[]) => messages.filter(m => m.readBy?.includes(userId) || true))
      );
    });
  }

  getUnreadCount(threadId: string): Observable<number> {
    return this.withAuth(userId => {
      const ref = collection(this.firestore, `threads/${threadId}/messages`);
      const q = query(ref);

      return collectionData(q).pipe(
        map((messages: any[]) =>
          messages.filter(m => !(m.readBy || []).includes(userId)).length
        )
      );
    });
  }

  /** Mark all messages in a thread as read by current user */
  async markMessagesAsRead(threadId: string) {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) return;

    const threadDocRef = doc(this.firestore, `threads/${threadId}`);
    const ref = collection(this.firestore, `threads/${threadId}/messages`);
    const snapshot = await getDocs(ref);

    let markedAny = false;

    const updates = snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      const readBy: string[] = data['readBy'] || [];

      if (!readBy.includes(currentUser.uid)) {
        markedAny = true;
        return updateDoc(docSnap.ref, {
          readBy: [...readBy, currentUser.uid]
        });
      }
      return Promise.resolve();
    });

    await Promise.all(updates);

    // If any messages were marked read, update thread unreadByUser
    if (markedAny) {
      const threadSnap = await getDoc(threadDocRef);
      const threadData = threadSnap.data() || {};
      const unreadByUser = threadData['unreadByUser'] || {};

      const newUnreadByUser = { ...unreadByUser, [currentUser.uid]: 0 };

      await updateDoc(threadDocRef, { unreadByUser: newUnreadByUser });
    }
  }

  getTyping(threadId: string): Observable<{ [uid: string]: boolean }> {
    return docData(doc(this.firestore, `threads/${threadId}`)).pipe(
      map((thread: any) => thread?.typing || {})
    );
  }

  async setTyping(threadId: string, isTyping: boolean) {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;

    const threadRef = doc(this.firestore, `threads/${threadId}`);

    await updateDoc(threadRef, {
      [`typing.${uid}`]: isTyping
    });
  }
}