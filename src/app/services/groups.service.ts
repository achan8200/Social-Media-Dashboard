import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, collectionData, serverTimestamp, deleteDoc, docData, writeBatch, arrayUnion, arrayRemove, getDoc, getDocs, query, where, orderBy } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { MessagesService } from './messages.service';
import { NotificationsService } from './notifications.service';
import { map, Observable, switchMap, of, firstValueFrom, combineLatest, startWith, shareReplay } from 'rxjs';

export interface Group {
  id?: string;
  ownerId: string;
  name: string;
  bio?: string;
  avatar?: string;
  isPrivate?: boolean;
  createdAt: any;
}

export interface GroupMember {
  uid: string;
  role: 'owner' | 'moderator' | 'member';
  joinedAt: any;
}

@Injectable({ providedIn: 'root' })
export class GroupsService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);
  private userService = inject(UserService);
  private messagesService = inject(MessagesService);
  private notificationsService = inject(NotificationsService);

  private groupCache = new Map<string, Observable<Group | null>>();
  private readonly BATCH_SIZE = 400;

  // ─────────────────────────────
  // Create Group
  // ─────────────────────────────
  async createGroup(name: string, bio: string = ''): Promise<string> {
    const trimmedName = name?.trim();

    if (!trimmedName) {
      throw new Error('Group name cannot be empty');
    }

    const user = await firstValueFrom(this.authService.user$);
    if (!user) throw new Error('Not authenticated');

    const groupRef = doc(collection(this.firestore, 'groups'));
    const groupId = groupRef.id;

    await setDoc(groupRef, {
      ownerId: user.uid,
      name,
      bio,
      createdAt: serverTimestamp()
    });

    const memberRef = doc(this.firestore, `groups/${groupId}/members/${user.uid}`);
    const userGroupRef = doc(this.firestore, `users/${user.uid}/groups/${groupId}`);

    await setDoc(memberRef, {
      uid: user.uid,
      role: 'owner',
      joinedAt: serverTimestamp()
    });

    await setDoc(userGroupRef, {
      groupId,
      joinedAt: serverTimestamp()
    });

    await this.createGroupThread(groupId, user.uid);

    return groupId;
  }

  // ─────────────────────────────
  // Get Single Group
  // ─────────────────────────────
  getGroup(groupId: string): Observable<Group | null> {
    if (this.groupCache.has(groupId)) {
      return this.groupCache.get(groupId)!;
    }

    const ref = doc(this.firestore, `groups/${groupId}`);

    const group$ = docData(ref, { idField: 'id' }).pipe(
      map(data => data ? (data as Group) : null),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.groupCache.set(groupId, group$);

    return group$;
  }

  // ─────────────────────────────
  // Get All Groups
  // ─────────────────────────────
  getAllGroups(): Observable<Group[]> {
    const ref = collection(this.firestore, 'groups');
    return collectionData(ref, { idField: 'id' }) as Observable<Group[]>;
  }

  // ─────────────────────────────
  // Get Groups for a User (membership-based)
  // ─────────────────────────────
  getUserGroups(userId: string) {
    return collectionData(
      collection(this.firestore, `users/${userId}/groups`)
    );
  }

  // ─────────────────────────────
  // Get Groups for a User with Details
  // ─────────────────────────────
  getUserGroupsWithDetails(userId: string): Observable<(Group & { role: string })[]> {
    const userGroupsRef = collection(this.firestore, `users/${userId}/groups`);

    return collectionData(userGroupsRef).pipe(
      switchMap((memberships: any[]) => {
        if (!memberships.length) return of([]);

        return combineLatest(
          memberships.map(m =>
            combineLatest([
              this.getGroup(m.groupId),
              docData(doc(this.firestore, `groups/${m.groupId}/members/${userId}`))
            ]).pipe(
              map(([group, member]: any) => {
                if (!group) return null;

                return {
                  ...group,
                  role: member?.role || 'member',
                  isMember: true,
                  joinedAt: m.joinedAt
                };
              })
            )
          )
        );
      }),
      map(groups =>
        groups
          .filter((g): g is Group & { role: string; joinedAt: any } => !!g)
          .sort((a, b) => {
            const aTime = a.joinedAt?.seconds ?? 0;
            const bTime = b.joinedAt?.seconds ?? 0;
            return aTime - bTime;
          })
      )
    );
  }

  // ─────────────────────────────
  // Get Group Name
  // ─────────────────────────────
  getGroupName(groupId: string): Observable<string | null> {
    return this.getGroup(groupId).pipe(
      map(group => group?.name ?? null)
    );
  }

  // ─────────────────────────────
  // Join Group
  // ─────────────────────────────
  async joinGroup(groupId: string): Promise<void> {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) throw new Error('Not authenticated');

    // Group side
    const memberRef = doc(this.firestore, `groups/${groupId}/members/${user.uid}`);

    // User side
    const userGroupRef = doc(this.firestore, `users/${user.uid}/groups/${groupId}`);

    // Group thread side
    const threadRef = doc(this.firestore, `groupThreads/${groupId}`);

    await setDoc(memberRef, {
      uid: user.uid,
      role: 'member',
      joinedAt: serverTimestamp()
    });

    await Promise.all([
      setDoc(userGroupRef, {
        groupId,
        joinedAt: serverTimestamp()
      }),
      setDoc(threadRef, {
        participants: arrayUnion(user.uid)
      }, { merge: true })
    ]);

    const actor = await firstValueFrom(
      this.userService.getUserByUid(user.uid)
    );

    const actorName = actor?.displayName || actor?.username || 'Someone';
    
    const threadId = groupId;

    await this.messagesService.sendGroupMessage(
      threadId,
      `${actorName} joined the group`,
      'system'
    );
  }

  // ─────────────────────────────
  // Leave Group
  // ─────────────────────────────
  async leaveGroup(groupId: string): Promise<void> {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) throw new Error('Not authenticated');

    const memberRef = doc(this.firestore, `groups/${groupId}/members/${user.uid}`);
    const userGroupRef = doc(this.firestore, `users/${user.uid}/groups/${groupId}`);
    const threadRef = doc(this.firestore, `groupThreads/${groupId}`);

    const memberSnap = await getDoc(memberRef);
    const role = memberSnap.data()?.['role'];

    const actor = await firstValueFrom(
      this.userService.getUserByUid(user.uid)
    );

    const actorName = actor?.displayName || actor?.username || 'Someone';
    
    const threadId = groupId;

    await this.messagesService.sendGroupMessage(
      threadId,
      `${actorName} left the group`,
      'system'
    );

    if (role === 'moderator') {
      await this.notificationsService.deleteNotification({
        recipientUid: user.uid,
        type: 'promote',
        groupId
      });
    }

    await Promise.all([
      setDoc(threadRef, {
        participants: arrayRemove(user.uid)
      }, { merge: true }),
      deleteDoc(memberRef),
      deleteDoc(userGroupRef),
    ]);
  }

  // ─────────────────────────────
  // Remove Member from Group
  // ─────────────────────────────
  async removeMember(groupId: string, targetUid: string) {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) throw new Error('Not authenticated');

    const batch = writeBatch(this.firestore);

    const memberRef = doc(this.firestore, `groups/${groupId}/members/${targetUid}`);
    const userGroupRef = doc(this.firestore, `users/${targetUid}/groups/${groupId}`);
    const threadRef = doc(this.firestore, `groupThreads/${groupId}`);

    const memberSnap = await getDoc(memberRef);
    const role = memberSnap.data()?.['role'];

    const actor = await firstValueFrom(
      this.userService.getUserByUid(user.uid)
    );
    const actorName = actor?.displayName || actor?.username || 'Someone';

    const target = await firstValueFrom(
      this.userService.getUserByUid(targetUid)
    );
    const targetName = target?.displayName || target?.username || 'Someone';
    
    const threadId = groupId;

    await this.messagesService.sendGroupMessage(
      threadId,
      `${actorName} removed ${targetName} from the group`,
      'system'
    );

    if (role === 'moderator') {
      await this.notificationsService.deleteNotification({
        recipientUid: targetUid,
        type: 'promote',
        groupId
      });
    }

    batch.set(threadRef,{ participants: arrayRemove(targetUid) }, { merge: true });
    batch.delete(userGroupRef);
    batch.delete(memberRef);

    await batch.commit();
  }

  // ─────────────────────────────
  // Get Members
  // ─────────────────────────────
  getMembers(groupId: string): Observable<GroupMember[]> {
    const ref = collection(this.firestore, `groups/${groupId}/members`);
    const q = query(ref, orderBy('joinedAt', 'asc'));

    return collectionData(q, { idField: 'uid' }) as Observable<GroupMember[]>;
  }

  // ─────────────────────────────
  // Check Membership
  // ─────────────────────────────
  isMember(groupId: string, userId: string): Observable<boolean> {
    const ref = doc(this.firestore, `groups/${groupId}/members/${userId}`);

    return docData(ref).pipe(
      map(data => !!data),
      startWith(false)
    );
  }

  // ─────────────────────────────
  // Get Current User Membership
  // ─────────────────────────────
  isCurrentUserMember(groupId: string): Observable<boolean> {
    return this.authService.user$.pipe(
      switchMap(user => {
        if (!user) return of(false);
        return this.isMember(groupId, user.uid);
      })
    );
  }

  // ─────────────────────────────
  // Check if Group Owner or Moderator
  // ─────────────────────────────
  isGroupAdmin(groupId: string, uid: string): Observable<boolean> {
    const ref = doc(this.firestore, `groups/${groupId}/members/${uid}`);

    return docData(ref).pipe(
      map((member: any) => {
        return member?.role === 'owner' || member?.role === 'moderator';
      }),
      startWith(false)
    );
  }

  // ─────────────────────────────
  // Update Role
  // ─────────────────────────────
  async updateRole(groupId: string, uid: string, role: string) {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) return;

    const target = await firstValueFrom(
      this.userService.getUserByUid(uid)
    );

    const targetName = target?.displayName || target?.username || 'Someone';

    const threadId = groupId;

    if (role === 'moderator') {
      await this.notificationsService.createNotification({
        recipientUid: uid,
        actorUid: user.uid,
        type: 'promote',
        groupId
      });
      await this.messagesService.sendGroupMessage(
        threadId,
        `${targetName} was promoted to moderator`,
        'system'
      );
    }

    if (role === 'member') {
      await this.notificationsService.deleteNotification({
        recipientUid: uid,
        type: 'promote',
        groupId
      });
    }

    await setDoc(
      doc(this.firestore, `groups/${groupId}/members/${uid}`),
      { role },
      { merge: true }
    );
  }

  // ─────────────────────────────
  // Transfer Ownership
  // ─────────────────────────────
  async transferOwnership(groupId: string, ownerUid: string, targetUid: string) {
    const batch = writeBatch(this.firestore);

    const groupRef = doc(this.firestore, `groups/${groupId}`);
    const ownerRef = doc(this.firestore, `groups/${groupId}/members/${ownerUid}`);
    const targetRef = doc(this.firestore, `groups/${groupId}/members/${targetUid}`);

    const owner = await firstValueFrom(
      this.userService.getUserByUid(ownerUid)
    );
    const ownerName = owner?.displayName || owner?.username || 'Someone';

    const target = await firstValueFrom(
      this.userService.getUserByUid(targetUid)
    );
    const targetName = target?.displayName || target?.username || 'Someone';
    
    const threadId = groupId;

    await this.messagesService.sendGroupMessage(
      threadId,
      `${ownerName} transferred ownership to ${targetName}`,
      'system'
    );

    batch.set(ownerRef, { role: 'moderator' }, { merge: true });
    batch.set(targetRef, { role: 'owner' }, { merge: true });
    batch.set(groupRef, { ownerId: targetUid, updatedAt: serverTimestamp() }, { merge: true });

    await batch.commit();
  }

  // ─────────────────────────────
  // Update Group Info
  // ─────────────────────────────
  async updateGroup(groupId: string, data: Partial<Group>) {
    const ref = doc(this.firestore, `groups/${groupId}`);
    const snap = await getDoc(ref);
    const oldData = snap.data() as Group;

    await setDoc(ref, {
      ...data,
      updatedAt: serverTimestamp()
    }, { merge: true });

    const authUser = await firstValueFrom(this.authService.user$);
    if (!authUser) return;

    const actor = await firstValueFrom(
      this.userService.getUserByUid(authUser.uid)
    );

    const actorName = actor?.displayName || actor?.username || 'Someone';
    
    const threadId = groupId;

    if (data.name && data.name !== oldData.name) {
      await this.messagesService.sendGroupMessage(
        threadId,
        `${actorName} changed the group name to "${data.name}"`,
        'system'
      );
    }

    if (data.bio && data.bio !== oldData.bio) {
      await this.messagesService.sendGroupMessage(
        threadId,
        `${actorName} updated the group bio`,
        'system'
      );
    } else if (!data.bio && data.bio !== oldData.bio) {
      await this.messagesService.sendGroupMessage(
        threadId,
        `${actorName} removed the group bio`,
        'system'
      );
    }

    if (data.avatar && data.avatar !== oldData.avatar) {
      await this.messagesService.sendGroupMessage(
        threadId,
        `${actorName} updated the group avatar`,
        'system'
      );
    } else if (!data.avatar && data.avatar !== oldData.avatar) {
      await this.messagesService.sendGroupMessage(
        threadId,
        `${actorName} removed the group avatar`,
        'system'
      );
    }
  }

  // ─────────────────────────────
  // Create Group Thread
  // ─────────────────────────────
  private createGroupThread(groupId: string, ownerId: string) {
    const threadRef = doc(this.firestore, `groupThreads/${groupId}`);

    return setDoc(threadRef, {
      groupId,
      createdAt: serverTimestamp(),
      lastMessageAt: null,
      participants: [ownerId]
    });
  }

  // ─────────────────────────────
  // Delete Group
  // ─────────────────────────────
  async deleteGroup(groupId: string): Promise<void> {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) throw new Error('Not authenticated');

    // Check ownership first
    const memberRef = doc(this.firestore, `groups/${groupId}/members/${user.uid}`);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists() || memberSnap.data()?.['role'] !== 'owner') {
      throw new Error('Only group owner can delete this group');
    }

    const groupRef = doc(this.firestore, `groups/${groupId}`);
    const threadRef = doc(this.firestore, `groupThreads/${groupId}`);

    // Get members first (needed for user cleanup)
    const membersSnap = await getDocs(
      collection(this.firestore, `groups/${groupId}/members`)
    );

    const memberUids = membersSnap.docs.map(d => d.id);

    // Prepare user group refs
    const userRefs = memberUids.map(uid =>
      doc(this.firestore, `users/${uid}/groups/${groupId}`)
    );

    const userChunks = this.chunkArray(userRefs, this.BATCH_SIZE);

    // Delete messages (needs membership)
    await this.deleteCollectionInChunks(`groupThreads/${groupId}/messages`);

    // Delete thread (needs ownership)
    await deleteDoc(threadRef);

    // Cleanup posts
    await this.batchUpdatePostsRemoveGroupId(groupId);

    // Delete notifications
    await this.deleteGroupNotifications(groupId);

    // Remove group from each user's subcollection
    for (const chunk of userChunks) {
      const batch = writeBatch(this.firestore);
      chunk.forEach(ref => batch.delete(ref));
      await batch.commit();
    }

    // Delete group document
    await deleteDoc(groupRef);

    // Delete members (removes your ownership)
    await this.deleteCollectionInChunks(`groups/${groupId}/members`);
  }

  // Split array into chunks
  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  // Delete an entire collection in chunks
  private async deleteCollectionInChunks(path: string) {
    const colRef = collection(this.firestore, path);
    const snap = await getDocs(colRef);

    if (snap.empty) return;

    const chunks = this.chunkArray(snap.docs, this.BATCH_SIZE);

    for (const chunk of chunks) {
      const batch = writeBatch(this.firestore);
      chunk.forEach(docSnap => batch.delete(docSnap.ref));
      await batch.commit();
    }
  }

  // Remove groupId from posts in chunks
  private async batchUpdatePostsRemoveGroupId(groupId: string) {
    const postsRef = collection(this.firestore, 'posts');
    const q = query(postsRef, where('groupId', '==', groupId));
    const snap = await getDocs(q);

    if (snap.empty) return;

    const chunks = this.chunkArray(snap.docs, this.BATCH_SIZE);

    for (const chunk of chunks) {
      const batch = writeBatch(this.firestore);

      chunk.forEach(docSnap => {
        batch.update(docSnap.ref, {
          groupId: null,
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();
    }
  }

  private async deleteGroupNotifications(groupId: string) {
    const notificationsRef = collection(this.firestore, 'notifications');
    const q = query(notificationsRef, where('groupId', '==', groupId));
    const snap = await getDocs(q);

    if (snap.empty) return;

    const chunks = this.chunkArray(snap.docs, this.BATCH_SIZE);

    for (const chunk of chunks) {
      const batch = writeBatch(this.firestore);
      chunk.forEach(docSnap => batch.delete(docSnap.ref));
      await batch.commit();
    }
  }
}