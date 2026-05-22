import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, collectionData, serverTimestamp, deleteDoc, docData, writeBatch, arrayUnion, arrayRemove, getDoc, getDocs, query, where, orderBy, FieldValue, updateDoc } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { MessagesService } from './messages.service';
import { NotificationsService } from './notifications.service';
import { map, Observable, switchMap, of, firstValueFrom, combineLatest, startWith, shareReplay, from } from 'rxjs';

export interface Group {
  id?: string;
  ownerId: string;
  name: string;
  nameLower: string;
  bio?: string;
  avatar?: string;
  isPrivate?: boolean;
  createdAt: any;
}

export interface GroupMember {
  uid: string;
  role: 'owner' | 'moderator' | 'member';
  joinedAt: any;

  titleIds?: string[] | FieldValue;
  activeTitleId?: string | null | FieldValue;
}

export interface GroupTitle {
  id?: string;
  name: string;
  nameLower: string;
  color: string;
  color2: string;
  createdAt: any;
  createdBy: string;
  updatedAt?: any;
}

export interface GroupInvite {
  id?: string;

  uid: string;
  invitedBy: string;

  status: 'pending' | 'accepted' | 'declined';

  createdAt: any;
  respondedAt?: any;
}

export interface GroupBan {
  uid: string;

  bannedBy: string;
  bannedAt: any;

  reason: string;
}

export const GROUP_BAN_REASONS = [
  'Spam',
  'Harassment',
  'Hate speech',
  'NSFW content',
  'Scam or fraud',
  'Impersonation',
  'Repeated rule violations',
  'Toxic behavior',
  'Other'
] as const;

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
  async createGroup(name: string, bio: string = '', isPrivate: boolean = false): Promise<string> {
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
      nameLower: name.toLowerCase(),
      bio,
      isPrivate,
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
  getUserGroupsWithDetails(userId: string): Observable<(Group & { role: string; joinedAt: any; activeTitle?: GroupTitle | null })[]> {
    const userGroupsRef = collection(this.firestore, `users/${userId}/groups`);

    return collectionData(userGroupsRef).pipe(
      switchMap((memberships: any[]) => {
        if (!memberships.length) return of([]);

        return combineLatest(
          memberships.map(m =>
            combineLatest([
              this.getGroup(m.groupId),
              docData(doc(this.firestore, `groups/${m.groupId}/members/${userId}`)),
              this.getGroupTitles(m.groupId)
            ]).pipe(
              map(([group, member, titles]: any) => {
                if (!group) return null;

                const titleMap = new Map(
                  titles.map((t: GroupTitle) => [t.id!, t])
                );

                const activeTitle =
                  member?.activeTitleId
                    ? titleMap.get(member.activeTitleId)
                    : null;

                return {
                  ...group,
                  role: member?.role || 'member',
                  isMember: true,
                  joinedAt: m.joinedAt,
                  activeTitle
                };
              })
            )
          )
        );
      }),

      map(groups =>
        groups
          .filter((g): g is Group & { role: string; joinedAt: any; activeTitle?: GroupTitle | null } => !!g)
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

    const groupSnap = await getDoc(
      doc(this.firestore, `groups/${groupId}`)
    );

    const banned = await this.isUserBanned(groupId, user.uid);

    if (banned) {
      throw new Error('You are banned from this group');
    }

    const group = groupSnap.data() as Group;

    if (group?.isPrivate) {
      throw new Error('Private groups require invitation');
    }

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

    // Get all title IDs
    const titlesSnap = await getDocs(
      collection(this.firestore, `groups/${groupId}/titles`)
    );

    const allTitleIds = titlesSnap.docs.map(doc => doc.id);

    batch.set(ownerRef, { role: 'moderator' }, { merge: true });
    batch.set(targetRef, { role: 'owner', titleIds: arrayUnion(...allTitleIds) }, { merge: true });
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

    if (
      typeof data.isPrivate === 'boolean' &&
      data.isPrivate !== oldData.isPrivate
    ) {
      await this.handlePrivacyChange(groupId, data.isPrivate);
    }

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

    // Delete group titles subcollection
    await this.deleteCollectionInChunks(`groups/${groupId}/titles`);

    // Delete invitations subcollection
    await this.deleteCollectionInChunks(`groups/${groupId}/invitations`);

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

  // ─────────────────────────────
  // Search Groups
  // ─────────────────────────────
  searchGroups(queryStr: string): Observable<any[]> {
    const q = queryStr.toLowerCase().trim();
    if (!q) return of([]);

    const ref = collection(this.firestore, 'groups');

    return from(getDocs(ref)).pipe(
      map(snapshot =>
        snapshot.docs.map(doc => {
          const data = doc.data() as any;

          return {
            id: doc.id,
            name: data.name,
            nameLower: data.nameLower,
            avatar: data.avatar ?? null
          };
        })
      ),
      map(groups =>
        groups
          .filter(g => (g.nameLower || '').includes(q))
          .slice(0, 10)
          .map(g => ({
            id: g.id,
            name: g.name,
            display: g.name,
            imageUrl: g.avatar,
            type: 'group'
          }))
      )
    );
  }

  getGroupTitles(groupId: string): Observable<GroupTitle[]> {
    const ref = collection(this.firestore, `groups/${groupId}/titles`);

    return collectionData(ref, {
      idField: 'id'
    }) as Observable<GroupTitle[]>;
  }

  async createTitle(
    groupId: string,
    data: {
      name: string;
      nameLower: string;
      color: string;
      color2: string;
    }
  ) {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) throw new Error('Not authenticated');

    // Enforce 25 title limit
    const titlesSnap = await getDocs(
      collection(this.firestore, `groups/${groupId}/titles`)
    );

    if (titlesSnap.size >= 25) {
      throw new Error('Group title limit reached (25 max)');
    }

    const titleRef = doc(
      collection(this.firestore, `groups/${groupId}/titles`)
    );

    await setDoc(titleRef, {
      ...data,
      createdAt: serverTimestamp(),
      createdBy: user.uid
    });

    // auto-grant to owner
    const ownerMemberRef = doc(
      this.firestore,
      `groups/${groupId}/members/${user.uid}`
    );

    await setDoc(ownerMemberRef, {
      titleIds: arrayUnion(titleRef.id),
      activeTitleId: titleRef.id
    }, { merge: true });
  }

  async updateTitle(groupId: string, titleId: string, data: Partial<GroupTitle>) {
    const ref = doc(
      this.firestore,
      `groups/${groupId}/titles/${titleId}`
    );

    await setDoc(ref, {
      ...data,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  async deleteTitle(groupId: string, titleId: string) {
    const batch = writeBatch(this.firestore);

    // Delete the title document
    const titleRef = doc(
      this.firestore,
      `groups/${groupId}/titles/${titleId}`
    );

    batch.delete(titleRef);

    // Read all members once
    const membersSnap = await getDocs(
      collection(this.firestore, `groups/${groupId}/members`)
    );

    // Prepare deterministic updates
    membersSnap.forEach(memberDoc => {
      const data = memberDoc.data() as GroupMember;

      const update: Partial<GroupMember> = {
        titleIds: arrayRemove(titleId)
      };

      // Only clear active title if it matches this title
      if (data.activeTitleId === titleId) {
        update.activeTitleId = null;
      }

      batch.set(memberDoc.ref, update, { merge: true });
    });

    // Commit once
    await batch.commit();
  }

  async toggleMemberTitle(
    groupId: string,
    uid: string,
    titleId: string,
    hasTitle: boolean
  ) {
    const ref = doc(
      this.firestore,
      `groups/${groupId}/members/${uid}`
    );

    // Removing title
    if (hasTitle) {

      // Get current member data
      const snap = await getDoc(ref);
      const data = snap.data();

      // Base updates
      const updates: any = {
        titleIds: arrayRemove(titleId)
      };

      // Only clear active title if removed title was active
      if (data?.['activeTitleId'] === titleId) {
        updates.activeTitleId = null;
      }

      await setDoc(ref, updates, { merge: true });

    // Adding title
    } else {

      await setDoc(ref, {
        titleIds: arrayUnion(titleId)
      }, { merge: true });

    }
  }

  async setActiveTitle(groupId: string, uid: string, titleId: string | null) {
    const ref = doc(this.firestore, `groups/${groupId}/members/${uid}`);

    await setDoc(ref, {
      activeTitleId: titleId
    }, { merge: true });
  }

  getInvite(groupId: string, uid: string): Observable<GroupInvite | null> {
    const ref = collection(this.firestore, `groups/${groupId}/invitations`);

    const q = query(
      ref,
      where('uid', '==', uid),
      where('status', '==', 'pending')
    );

    return collectionData(q, {
      idField: 'id'
    }).pipe(
      map((invites: any[]) => invites[0] ?? null)
    );
  }

  getGroupInvites(groupId: string): Observable<GroupInvite[]> {

    const ref = collection(
      this.firestore,
      `groups/${groupId}/invitations`
    );

    const q = query(
      ref,
      orderBy('createdAt', 'desc')
    );

    return collectionData(q, {
      idField: 'id'
    }) as Observable<GroupInvite[]>;
  }

  async createInvite(groupId: string, targetUid: string) {
    const authUser = await firstValueFrom(this.authService.user$);
    if (!authUser) throw new Error('Not authenticated');

    // prevent duplicate pending invite
    const existing = await firstValueFrom(
      this.getInvite(groupId, targetUid)
    );

    if (existing) return;

    // prevent inviting existing member
    const memberSnap = await getDoc(
      doc(this.firestore, `groups/${groupId}/members/${targetUid}`)
    );

    if (memberSnap.exists()) return;

    const banned = await this.isUserBanned(groupId, targetUid);

    if (banned) {
      throw new Error('User is banned');
    }

    const inviteRef = doc(
      collection(this.firestore, `groups/${groupId}/invitations`)
    );

    await setDoc(inviteRef, {
      uid: targetUid,
      invitedBy: authUser.uid,
      status: 'pending',
      createdAt: serverTimestamp()
    });

    await this.notificationsService.createNotification({
      recipientUid: targetUid,
      actorUid: authUser.uid,
      type: 'group_invite',
      groupId,
      inviteId: inviteRef.id
    });
  }

  async acceptInvite(groupId: string, inviteId: string) {

    const user = await firstValueFrom(this.authService.user$);
    if (!user) throw new Error('Not authenticated');

    const db = this.firestore;

    const inviteRef = doc(db, `groups/${groupId}/invitations/${inviteId}`);
    const memberRef = doc(db, `groups/${groupId}/members/${user.uid}`);
    const userGroupRef = doc(db, `users/${user.uid}/groups/${groupId}`);
    const threadRef = doc(db, `groupThreads/${groupId}`);

    const inviteSnap = await getDoc(inviteRef);

    if (!inviteSnap.exists()) return;

    const invite = inviteSnap.data();

    if (invite['uid'] !== user.uid) throw new Error('Unauthorized');

    if (invite['status'] !== 'pending') return;

    const banned = await this.isUserBanned(groupId, user.uid);

    if (banned) {
      throw new Error('User is banned');
    }

    // Create member
    await setDoc(memberRef, {
      uid: user.uid,
      role: 'member',
      joinedAt: serverTimestamp()
    });

    // User group mapping
    await setDoc(userGroupRef, {
      groupId,
      joinedAt: serverTimestamp()
    });

    // Thread update
    await setDoc(threadRef, {
      participants: arrayUnion(user.uid)
    }, { merge: true });

    // Mark invite accepted
    await updateDoc(inviteRef, {
      status: 'accepted',
      respondedAt: serverTimestamp()
    });

    const actor = await firstValueFrom(
      this.userService.getUserByUid(user.uid)
    );

    const actorName = actor?.displayName || actor?.username || 'Someone';
    
    const threadId = groupId;

    await this.messagesService.sendGroupMessage(
      threadId,
      `${actorName} accepted an invite and joined the group`,
      'system'
    );
  }

  async declineInvite(groupId: string, inviteId: string) {

    const user = await firstValueFrom(this.authService.user$);
    if (!user) throw new Error('Not authenticated');

    const inviteRef = doc(
      this.firestore,
      `groups/${groupId}/invitations/${inviteId}`
    );

    await setDoc(inviteRef, {
      status: 'declined',
      respondedAt: serverTimestamp()
    }, { merge: true });
  }

  async deleteInvite(groupId: string, inviteId: string) {

    const inviteRef = doc(
      this.firestore,
      `groups/${groupId}/invitations/${inviteId}`
    );

    // get invite data first
    const inviteSnap = await getDoc(inviteRef);

    if (!inviteSnap.exists()) return;

    const invite = inviteSnap.data() as GroupInvite;

    await deleteDoc(inviteRef);

    await this.notificationsService.deleteNotification({
      recipientUid: invite.uid,
      type: 'group_invite',
      groupId,
      inviteId
    });
  }

  private async handlePrivacyChange(groupId: string, isPrivate: boolean) {
    const groupRef = doc(this.firestore, `groups/${groupId}`);

    await setDoc(groupRef, {
      isPrivate,
      updatedAt: serverTimestamp()
    }, { merge: true });

    if (!isPrivate) {
      const invitesSnap = await getDocs(
        collection(this.firestore, `groups/${groupId}/invitations`)
      );

      const batch = writeBatch(this.firestore);

      invitesSnap.forEach(docSnap => {
        batch.delete(docSnap.ref);
      });

      await batch.commit();

      for (const docSnap of invitesSnap.docs) {
        const invite = docSnap.data() as GroupInvite;

        await this.notificationsService.deleteNotification({
          recipientUid: invite.uid,
          type: 'group_invite',
          groupId,
          inviteId: docSnap.id
        });
      }
    }
  }

  async isUserBanned(groupId: string, uid: string): Promise<boolean> {

    const banRef = doc(this.firestore, `groups/${groupId}/blacklist/${uid}`);

    const snap = await getDoc(banRef);

    return snap.exists();
  }

  getBlacklist(groupId: string): Observable<GroupBan[]> {

    const ref = collection(this.firestore, `groups/${groupId}/blacklist`);

    const q = query(
      ref,
      orderBy('bannedAt', 'desc')
    );

    return collectionData(q, {
      idField: 'uid'
    }) as Observable<GroupBan[]>;
  }

  canBanUser(currentRole: string | null, targetRole: string): boolean {

    if (!currentRole) return false;

    // Owner
    if (currentRole === 'owner') {
      return targetRole !== 'owner';
    }

    // Moderator
    if (currentRole === 'moderator') {
      return targetRole === 'member';
    }

    return false;
  }

  async banUserFromGroup(groupId: string, targetUid: string, reason: string) {

    const authUser = await firstValueFrom(this.authService.user$);

    if (!authUser) {
      throw new Error('Not authenticated');
    }

    // prevent duplicate bans
    const alreadyBanned = await this.isUserBanned(
      groupId,
      targetUid
    );

    if (alreadyBanned) return;

    const batch = writeBatch(this.firestore);

    // refs
    const memberRef = doc(this.firestore, `groups/${groupId}/members/${targetUid}`);

    const userGroupRef = doc(this.firestore, `users/${targetUid}/groups/${groupId}`);

    const threadRef = doc(this.firestore, `groupThreads/${groupId}`);

    const blacklistRef = doc(this.firestore, `groups/${groupId}/blacklist/${targetUid}`);

    // target user
    const target = await firstValueFrom(
      this.userService.getUserByUid(targetUid)
    );

    const targetName =
      target?.displayName ||
      target?.username ||
      'Someone';

    // actor
    const actor = await firstValueFrom(
      this.userService.getUserByUid(authUser.uid)
    );

    const actorName =
      actor?.displayName ||
      actor?.username ||
      'Someone';

    // remove pending invites
    const invitesSnap = await getDocs(
      query(
        collection(
          this.firestore,
          `groups/${groupId}/invitations`
        ),
        where('uid', '==', targetUid),
      )
    );

    for (const inviteDoc of invitesSnap.docs) {

      const invite = inviteDoc.data() as GroupInvite;

      await this.notificationsService.deleteNotification({
        recipientUid: invite.uid,
        type: 'group_invite',
        groupId,
        inviteId: inviteDoc.id
      });

      batch.delete(inviteDoc.ref);
    }

    // remove membership
    batch.delete(memberRef);

    // remove user group mapping
    batch.delete(userGroupRef);

    // remove from group thread
    batch.set(threadRef, {
      participants: arrayRemove(targetUid)
    }, { merge: true });

    // add blacklist entry
    batch.set(blacklistRef, {
      uid: targetUid,

      bannedBy: authUser.uid,
      bannedAt: serverTimestamp(),

      reason
    });

    // cleanup promote notification
    const memberSnap = await getDoc(memberRef);
    const role = memberSnap.data()?.['role'];

    await batch.commit();

    if (role === 'moderator') {

      await this.notificationsService.deleteNotification({
        recipientUid: targetUid,
        type: 'promote',
        groupId
      });
    }

    // system message
    await this.messagesService.sendGroupMessage(
      groupId,
      `${actorName} banned ${targetName} (${reason})`,
      'system'
    );
  }

  async unbanUserFromGroup(groupId: string, targetUid: string) {

    const ref = doc(this.firestore, `groups/${groupId}/blacklist/${targetUid}`);

    await deleteDoc(ref);
  }
}