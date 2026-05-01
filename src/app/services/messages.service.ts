import { Injectable } from '@angular/core';
import { Firestore, collection, query, where, orderBy, getDocs, 
  addDoc, serverTimestamp, updateDoc, doc, collectionData, getDoc, 
  docData, deleteDoc, writeBatch } from '@angular/fire/firestore';
import { Auth, authState } from '@angular/fire/auth';
import { Observable, from, map, switchMap, of } from 'rxjs';
import { Thread, Message } from '../models/messages.model';
import { User } from './user.service';
import { NotificationsService } from './notifications.service';

@Injectable({ providedIn: 'root' })
export class MessagesService {
  private usersCache$?: Observable<User[]>;
  private displayNameCache = new Map<string, string>();

  constructor(
    private firestore: Firestore, 
    private auth: Auth,
    private notificationsService: NotificationsService
  ) {}

  /** Wait for auth token before Firestore query */
  private withAuth<T>(fn: (uid: string) => Observable<T>): Observable<T> {
    return authState(this.auth).pipe(
      switchMap(user => {
        if (!user?.uid) return of(null as unknown as T);
        return fn(user.uid);
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
          lastMessage: t.lastMessage && typeof t.lastMessage === 'object'
            ? {
                id: t.lastMessage.id,
                text: t.lastMessage.text,
                senderId: t.lastMessage.senderId,
                senderName: t.lastMessage.senderName,
                createdAt: t.lastMessage.createdAt,
                isEdited: t.lastMessage.isEdited,
                isDeleted: t.lastMessage.isDeleted
              }
            : null,
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
  async sendMessage(threadId: string, text: string, type: string = "text") {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) throw new Error('User not authenticated');

    const userRef = doc(this.firestore, `users/${currentUser.uid}`);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data();

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
    const newMsgRef = await addDoc(messageRef, {
      senderId: currentUser.uid,
      senderName: userData?.['displayName'],
      text,
      createdAt,
      readBy: [currentUser.uid],
      type
    });

    // Compute unreadCount per participant
    const unreadCounts: Record<string, number> = {};
    participants.forEach(uid => {
      unreadCounts[uid] = uid === currentUser.uid ? 0 : (threadData?.['unreadByUser']?.[uid] || 0) + 1;
    });

    // Update thread atomically
    await updateDoc(threadDocRef, {
      lastMessage: {
        id: newMsgRef.id,
        text,
        senderId: currentUser.uid,
        senderName: userData?.['displayName'],
        createdAt,
        type
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
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) throw new Error('Not authenticated');

    const threadRef = doc(this.firestore, `threads/${threadId}`);
    const messagesRef = collection(this.firestore, `threads/${threadId}/messages`);

    // Get thread first
    const threadSnap = await getDoc(threadRef);
    const threadData = threadSnap.data();
    const participants: string[] = threadData?.['participants'] || [];

    // Delete notifications
    await Promise.all(
      participants.map(async (uid) => {
        try {
          await this.notificationsService.deleteNotification({
            recipientUid: uid,
            type: 'thread_added',
            threadId
          });
        } catch {}
      })
    );

    // Batch delete messages
    const snapshot = await getDocs(messagesRef);
    const batch = writeBatch(this.firestore);

    snapshot.docs.forEach(docSnap => {
      batch.delete(docSnap.ref);
    });

    await batch.commit();

    // Delete thread
    await deleteDoc(threadRef);
  }

  async updateGroupName(threadId: string, name: string) {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) throw new Error('Not authenticated');

    const ref = doc(this.firestore, `threads/${threadId}`);
    const snap = await getDoc(ref);
    const data = snap.data();

    const oldName = data?.['groupName'] || null;
    const newName = name || null;

    // Guard
    if (oldName === newName) return;

    // Update group name
    await updateDoc(ref, { groupName: newName });

    // System message
    const actorName = await this.getDisplayName(currentUser.uid);

    await this.sendSystemMessage(threadId, 'rename', {
      actorUid: currentUser.uid,
      actorName,
      newName
    });
  }

  async removeParticipant(threadId: string, uid: string) {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) throw new Error('Not authenticated');

    const ref = doc(this.firestore, `threads/${threadId}`);
    const snap = await getDoc(ref);
    const data = snap.data();
    if (!data) return;

    const participants: string[] = (data['participants'] || []).filter((p: string) => p !== uid);

    let groupName: string | null = data['groupName'] || null;
    if (participants.length <= 2 && groupName) {
      groupName = null;
    }

    // System message
    const actorName = await this.getDisplayName(currentUser.uid);

    if (currentUser.uid === uid) {
      await this.sendSystemMessage(threadId, 'leave', {
        actorUid: currentUser.uid,
        actorName
      });
    } else {
      await this.sendSystemMessage(threadId, 'remove', {
        actorUid: currentUser.uid,
        actorName,
        targetUid: uid
      });
    }

    // Delete any thread_added notifications for this user for this thread
    try {
      await this.notificationsService.deleteNotification({
        recipientUid: uid,
        type: 'thread_added',
        threadId
      });
    } catch (err) {
      console.error('DELETE FAILED:', err);
    }

    await updateDoc(ref, { participants, groupName });
  }

  async addParticipants(threadId: string, newUids: string[]) {
    if (!newUids.length) return;
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) throw new Error('Not authenticated');

    const ref = doc(this.firestore, `threads/${threadId}`);
    const snap = await getDoc(ref);
    const data = snap.data();

    const existing: string[] = data?.['participants'] || [];
    const updated = Array.from(new Set([...existing, ...newUids]));

    const unreadByUser = data?.['unreadByUser'] || {};
    newUids.forEach(uid => {
      unreadByUser[uid] = 0;
    });

    await updateDoc(ref, {
      participants: updated,
      unreadByUser
    });

    // Notifications
    const actorUid = currentUser.uid;
    await Promise.all(
      newUids
        .filter(uid => uid !== actorUid)
        .map(recipientUid =>
          this.notificationsService.createNotification({
            recipientUid,
            actorUid,
            type: 'thread_added',
            threadId
          })
        )
    );

    // System message
    const actorName = await this.getDisplayName(currentUser.uid);

    await this.sendSystemMessage(threadId, 'add', {
      actorUid: currentUser.uid,
      actorName,
      targetUids: newUids
    });
  }

  private async sendSystemMessage(
    threadId: string,
    type: 'rename' | 'remove' | 'leave' | 'add',
    payload: {
      actorUid: string;
      actorName?: string;
      targetUid?: string;
      targetUids?: string[];
      newName?: string | null;
    }
  ) {
    const { actorUid, targetUid, targetUids, newName } = payload;
    const actorName = payload.actorName ?? await this.getDisplayName(actorUid);
    const [ targetName, targetNames ] = await Promise.all([
      targetUid ? this.getDisplayName(targetUid) : Promise.resolve(null),
      targetUids
        ? Promise.all(targetUids.map(uid => this.getDisplayName(uid)))
        : Promise.resolve([])
    ]);

    const formatNames = (names: string[]) => {
      if (names.length === 1) return names[0];
      if (names.length === 2) return `${names[0]} and ${names[1]}`;
      return `${names[0]} and ${names.length - 1} others`;
    };

    let text = '';

    switch (type) {
      case 'rename':
        text = newName
          ? `${actorName} renamed the group to ${newName}`
          : `${actorName} removed the group name`;
        break;

      case 'remove':
        text = `${actorName} removed ${targetName || 'someone'} from this group`;
        break;

      case 'leave':
        text = `${actorName} left the group`;
        break;

      case 'add':
        text = `${actorName} added ${formatNames(targetNames)} to this group`;
        break;
    }

    await this.sendMessage(threadId, text, 'system');
  }

  private async getDisplayName(uid: string): Promise<string> {
    // Return from cache if available
    if (this.displayNameCache.has(uid)) {
      return this.displayNameCache.get(uid)!;
    }

    // Otherwise fetch
    const snap = await getDoc(doc(this.firestore, `users/${uid}`));
    const data = snap.data();

    const name =
    data?.['displayName'] ||
    data?.['username'] ||
    'Someone';

    // Store in cache
    this.displayNameCache.set(uid, name);

    return name;
  }

  async editMessage(threadId: string, messageId: string, newText: string) {
    const messageRef = doc(this.firestore, `threads/${threadId}/messages/${messageId}`);
    const threadRef = doc(this.firestore, `threads/${threadId}`);

    // Update message
    await updateDoc(messageRef, {
      text: newText,
      isEdited: true
    });

    // Get thread to check lastMessage
    const threadSnap = await getDoc(threadRef);
    const threadData = threadSnap.data();

    if (threadData?.['lastMessage']?.id === messageId) {
      await updateDoc(threadRef, {
        'lastMessage.text': newText,
        'lastMessage.isEdited': true
      });
    }
  }

  async deleteMessage(threadId: string, messageId: string) {
    const messageRef = doc(this.firestore, `threads/${threadId}/messages/${messageId}`);
    const threadRef = doc(this.firestore, `threads/${threadId}`);

    const threadSnap = await getDoc(threadRef);
    const threadData = threadSnap.data();

    const lastMessage = threadData?.['lastMessage'];
    const isLastMessage = lastMessage?.id === messageId;

    // Soft delete message
    await updateDoc(messageRef, {
      text: '',
      isDeleted: true
    });

    // If not last message, nothing else to do
    if (!isLastMessage) return;

    // If it is last message, just update its state in thread
    await updateDoc(threadRef, {
      'lastMessage.text': '',
      'lastMessage.isDeleted': true
    });
  }

  getGroupMessages(groupId: string): Observable<Message[]> {
    return this.withAuth(userId => {
      const ref = collection(this.firestore, `groupThreads/${groupId}/messages`);
      const q = query(ref, orderBy('createdAt', 'asc'));

      return collectionData(q, { idField: 'id' }).pipe(
        map((messages: any[]) =>
          messages.filter(m => m.readBy?.includes(userId) || true)
        )
      );
    });
  }

  async sendGroupMessage(groupId: string, text: string, type: string = "text") {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) throw new Error('Not authenticated');

    const userRef = doc(this.firestore, `users/${currentUser.uid}`);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data();

    const messageRef = collection(this.firestore, `groupThreads/${groupId}/messages`);

    const newMsgRef = await addDoc(messageRef, {
      senderId: currentUser.uid,
      senderName: userData?.['displayName'],
      text,
      type,
      readBy: [currentUser.uid],
      createdAt: serverTimestamp()
    });

    const threadRef = doc(this.firestore, `groupThreads/${groupId}`);
    const threadRefSnap = await getDoc(threadRef);

    const threadData = threadRefSnap.data();
    const participants: string[] = threadData?.['participants'] || [];
    if (!participants.includes(currentUser.uid)) {
      throw new Error('User is not a participant of this thread or thread does not exist');
    }

    // Compute unreadCount per participant
    const unreadCounts: Record<string, number> = {};
    participants.forEach(uid => {
      unreadCounts[uid] = uid === currentUser.uid ? 0 : (threadData?.['unreadByUser']?.[uid] || 0) + 1;
    });

    await updateDoc(threadRef, {
      lastMessage: {
        id: newMsgRef.id,
        text,
        senderId: currentUser.uid,
        senderName: userData?.['displayName'],
        createdAt: serverTimestamp(),
        type
      },
      lastMessageAt: serverTimestamp(),
      unreadByUser: unreadCounts
    });
  }

  // Unused
  getGroupUnreadCount(groupId: string): Observable<number> {
    return this.withAuth(userId => {
      const ref = collection(this.firestore, `groupThreads/${groupId}/messages`);
      const q = query(ref);

      return collectionData(q).pipe(
        map((messages: any[]) =>
          messages.filter(m => !(m.readBy || []).includes(userId)).length
        )
      );
    });
  }

  getGroupThread(groupId: string): Observable<any> {
    return this.withAuth(userId => {
      return docData(doc(this.firestore, `groupThreads/${groupId}`)).pipe(
        map((thread: any) => ({
          ...thread,
          unreadCount: thread?.unreadByUser?.[userId] || 0
        }))
      );
    });
  }

  async markGroupMessagesAsRead(groupId: string) {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) return;

    const threadDocRef = doc(this.firestore, `groupThreads/${groupId}`);
    const ref = collection(this.firestore, `groupThreads/${groupId}/messages`);
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

  getGroupTyping(groupId: string): Observable<{ [uid: string]: boolean }> {
    return docData(doc(this.firestore, `groupThreads/${groupId}`)).pipe(
      map((thread: any) => thread?.typing || {})
    );
  }

  async setGroupTyping(groupId: string, isTyping: boolean) {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;

    const threadRef = doc(this.firestore, `groupThreads/${groupId}`);

    await updateDoc(threadRef, {
      [`typing.${uid}`]: isTyping
    });
  }

  async editGroupMessage(groupId: string, messageId: string, newText: string) {
    const messageRef = doc(
      this.firestore,
      `groupThreads/${groupId}/messages/${messageId}`
    );

    const threadRef = doc(this.firestore, `groupThreads/${groupId}`);

    // Update message
    await updateDoc(messageRef, {
      text: newText,
      isEdited: true
    });

    // Update lastMessage if needed
    const threadSnap = await getDoc(threadRef);
    const threadData = threadSnap.data();

    if (threadData?.['lastMessage']?.id === messageId) {
      await updateDoc(threadRef, {
        'lastMessage.text': newText,
        'lastMessage.isEdited': true
      });
    }
  }

  async deleteGroupMessage(groupId: string, messageId: string) {
    const messageRef = doc(
      this.firestore,
      `groupThreads/${groupId}/messages/${messageId}`
    );

    const threadRef = doc(this.firestore, `groupThreads/${groupId}`);

    const threadSnap = await getDoc(threadRef);
    const threadData = threadSnap.data();

    const lastMessage = threadData?.['lastMessage'];
    const isLastMessage = lastMessage?.id === messageId;

    // Soft delete message
    await updateDoc(messageRef, {
      text: '',
      isDeleted: true
    });

    // If it's not the last message, we're done
    if (!isLastMessage) return;

    // If it is the last message, reflect deletion in thread preview
    await updateDoc(threadRef, {
      'lastMessage.text': '',
      'lastMessage.isDeleted': true
    });
  }
}