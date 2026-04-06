import { Injectable } from '@angular/core';
import { Firestore, collection, query, where, orderBy, getDocs, addDoc, serverTimestamp, updateDoc, doc, collectionData, getDoc, docData, deleteDoc } from '@angular/fire/firestore';
import { Auth, authState } from '@angular/fire/auth';
import { Observable, from, map, switchMap, of } from 'rxjs';
import { Thread, Message } from '../models/messages.model';
import { User } from './user.service';
import { NotificationsService } from './notifications.service';

@Injectable({ providedIn: 'root' })
export class MessagesService {
  private usersCache$?: Observable<User[]>;

  constructor(
    private firestore: Firestore, 
    private auth: Auth,
    private notificationsService: NotificationsService
  ) {}

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
          typing: t.typing || {},
          groupName: t.groupName ?? null
        } as Thread))
      )
    );
  }

  /** ---------------------- Refactored Thread Creation ---------------------- */

  /**
   * Get or create a 1-on-1 thread between the current user and another user.
   * Internally calls getOrCreateGroupThread() for unified logic.
   */
  async getOrCreateThread(otherUserId: string): Promise<string> {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) throw new Error('Not authenticated');

    // Use group-thread function with exactly two participants and no groupName
    return this.getOrCreateGroupThread([otherUserId], undefined);
  }

  /** ---------------------- Group Chat Support ---------------------- */

  /**
   * Get or create a thread with multiple participants.
   * If a groupName is provided, it's treated as a group chat.
   * Returns the thread ID.
   */
  async getOrCreateGroupThread(participantIds: string[], groupName?: string): Promise<string> {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) throw new Error('Not authenticated');

    const uid = currentUser.uid;

    if (!participantIds || participantIds.length < 1) {
      throw new Error('Cannot create a group with only 1 participant');
    }

    // Ensure current user is included
    const participants = Array.from(new Set([uid, ...participantIds]));

    const ref = collection(this.firestore, 'threads');

    // For 1-on-1 chats, we try to find an existing thread
    if (!groupName && participants.length === 2) {
      const q = query(ref, where('participants', 'array-contains', uid));
      const snapshot = await getDocs(q);

      const existingThread = snapshot.docs.find(docSnap => {
        const data = docSnap.data();
        const docParticipants: string[] = data['participants'] || [];
        return (
          docParticipants.length === participants.length &&
          participants.every(p => docParticipants.includes(p))
        );
      });

      if (existingThread) return existingThread.id;
    }

    // Create new thread
    const docRef = await addDoc(ref, {
      participants,
      groupName: groupName || null,
      lastMessageAt: serverTimestamp(),
      unreadByUser: participants.reduce((acc, uid) => ({ ...acc, [uid]: 0 }), {})
    });

    return docRef.id;
  }

  async createGroupFromThread(
    existingParticipantIds: string[],
    newParticipantIds: string[],
    groupName?: string
  ): Promise<string> {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) throw new Error('Not authenticated');

    const uid = currentUser.uid;

    // Merge all participants
    const participants = Array.from(
      new Set([
        uid,
        ...existingParticipantIds,
        ...newParticipantIds
      ])
    );

    const ref = collection(this.firestore, 'threads');

    const docRef = await addDoc(ref, {
      participants,
      groupName: groupName || null,
      lastMessageAt: serverTimestamp(),
      unreadByUser: participants.reduce(
        (acc, uid) => ({ ...acc, [uid]: 0 }),
        {}
      )
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
        senderName: currentUser.displayName,
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

  async deleteThread(threadId: string) {
    const threadRef = doc(this.firestore, `threads/${threadId}`);
    const messagesRef = collection(this.firestore, `threads/${threadId}/messages`);

    // Delete all messages
    const snapshot = await getDocs(messagesRef);

    const deletePromises = snapshot.docs.map(docSnap =>
      deleteDoc(docSnap.ref)
    );

    await Promise.all(deletePromises);

    // Delete thread document
    await deleteDoc(threadRef);
  }

  async updateGroupName(threadId: string, name: string) {
    const ref = doc(this.firestore, `threads/${threadId}`);
    await updateDoc(ref, { groupName: name || null });
  }

  async removeParticipant(threadId: string, uid: string) {
    const ref = doc(this.firestore, `threads/${threadId}`);
    const snap = await getDoc(ref);
    const data = snap.data();

    if (!data) return;

    const participants: string[] = (data['participants'] || []).filter((p: string) => p !== uid);

    // Automatically nullify groupName if 2 or less participants
    let groupName: string | null = data['groupName'] || null;
    if (participants.length <= 2 && groupName) {
      groupName = null;
    }

    await updateDoc(ref, {
      participants,
      groupName
    });
  }

  async addParticipants(threadId: string, newUids: string[]) {
    const ref = doc(this.firestore, `threads/${threadId}`);
    const snap = await getDoc(ref);
    const data = snap.data();

    const existing: string[] = data?.['participants'] || [];

    const updated = Array.from(new Set([...existing, ...newUids]));

    // also update unreadByUser
    const unreadByUser = data?.['unreadByUser'] || {};
    newUids.forEach(uid => {
      unreadByUser[uid] = 0;
    });

    await updateDoc(ref, {
      participants: updated,
      unreadByUser
    });

    // --- Add notifications ---
    const actorUid = this.auth.currentUser?.uid;
    if (!actorUid) return;

    for (const recipientUid of newUids) {
      // Skip self-notification
      if (recipientUid === actorUid) continue;

      await this.notificationsService.createNotification({
        recipientUid,
        actorUid,
        type: 'thread_added',
        threadId
      });
    }
    }
}