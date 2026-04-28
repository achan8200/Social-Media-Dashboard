import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, collectionData, serverTimestamp, deleteDoc, docData, writeBatch, arrayUnion, arrayRemove, getDoc } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { MessagesService } from './messages.service';
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

  private groupCache = new Map<string, Observable<Group | null>>();

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
                  isMember: true
                };
              })
            )
          )
        );
      }),
      map(groups => groups.filter((g): g is Group & { role: string } => !!g))
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

    await Promise.all([
      setDoc(memberRef, {
        uid: user.uid,
        role: 'member',
        joinedAt: serverTimestamp()
      }),
      setDoc(userGroupRef, {
        groupId,
        joinedAt: serverTimestamp()
      }),
      setDoc(threadRef, {
        participants: arrayUnion(user.uid)
      }, { merge: true })
    ]);
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

    await Promise.all([
      deleteDoc(memberRef),
      deleteDoc(userGroupRef),
      setDoc(threadRef, {
        participants: arrayRemove(user.uid)
      }, { merge: true })
    ]);
  }

  // ─────────────────────────────
  // Remove Member from Group
  // ─────────────────────────────
  async removeMember(groupId: string, uid: string) {
    const batch = writeBatch(this.firestore);

    const memberRef = doc(this.firestore, `groups/${groupId}/members/${uid}`);
    const userGroupRef = doc(this.firestore, `users/${uid}/groups/${groupId}`);
    const threadRef = doc(this.firestore, `groupThreads/${groupId}`);

    batch.delete(userGroupRef);
    batch.delete(memberRef);
    batch.set(threadRef,{ participants: arrayRemove(uid) }, { merge: true });

    await batch.commit();
  }

  // ─────────────────────────────
  // Get Members
  // ─────────────────────────────
  getMembers(groupId: string): Observable<GroupMember[]> {
    const ref = collection(this.firestore, `groups/${groupId}/members`);
    return collectionData(ref, { idField: 'uid' }) as Observable<GroupMember[]>;
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

  private createGroupThread(groupId: string, ownerId: string) {
    const threadRef = doc(this.firestore, `groupThreads/${groupId}`);

    return setDoc(threadRef, {
      groupId,
      createdAt: serverTimestamp(),
      lastMessageAt: null,
      participants: [ownerId]
    });
  }
}