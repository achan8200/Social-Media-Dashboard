import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, collectionData, serverTimestamp, deleteDoc, docData, writeBatch } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { map, Observable, switchMap, of, firstValueFrom, combineLatest, startWith } from 'rxjs';

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

  // ─────────────────────────────
  // Create Group
  // ─────────────────────────────
  async createGroup(name: string, bio: string = ''): Promise<string> {
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

    try {
      await setDoc(userGroupRef, {
        groupId,
        joinedAt: serverTimestamp()
      });
    } catch (err) {
      console.error('User group write FAILED:', err);
    }

    return groupId;
  }

  // ─────────────────────────────
  // Get Single Group
  // ─────────────────────────────
  getGroup(groupId: string): Observable<Group | null> {
    const ref = doc(this.firestore, `groups/${groupId}`);
    return docData(ref, { idField: 'id' }) as Observable<Group>;
  }

  // ─────────────────────────────
  // Get All Groups (basic)
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
  // Join Group
  // ─────────────────────────────
  async joinGroup(groupId: string): Promise<void> {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) throw new Error('Not authenticated');

    // Group side
    const memberRef = doc(this.firestore, `groups/${groupId}/members/${user.uid}`);

    // User side
    const userGroupRef = doc(this.firestore, `users/${user.uid}/groups/${groupId}`);

    await Promise.all([
      setDoc(memberRef, {
        uid: user.uid,
        role: 'member',
        joinedAt: serverTimestamp()
      }),
      setDoc(userGroupRef, {
        groupId,
        joinedAt: serverTimestamp()
      })
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

    await Promise.all([
      deleteDoc(memberRef),
      deleteDoc(userGroupRef)
    ]);
  }

  async removeMember(groupId: string, uid: string) {
    const batch = writeBatch(this.firestore);

    const memberRef = doc(this.firestore, `groups/${groupId}/members/${uid}`);
    const userGroupRef = doc(this.firestore, `users/${uid}/groups/${groupId}`);

    batch.delete(userGroupRef);
    batch.delete(memberRef);

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

  isGroupAdmin(groupId: string, uid: string): Observable<boolean> {
    const ref = doc(this.firestore, `groups/${groupId}/members/${uid}`);

    return docData(ref).pipe(
      map((member: any) => {
        return member?.role === 'owner' || member?.role === 'moderator';
      }),
      startWith(false)
    );
  }

  async updateRole(groupId: string, uid: string, role: string) {
    await setDoc(
      doc(this.firestore, `groups/${groupId}/members/${uid}`),
      { role },
      { merge: true }
    );
  }

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

  async updateGroup(groupId: string, data: Partial<Group>) {
    const ref = doc(this.firestore, `groups/${groupId}`);
    await setDoc(ref, {
      ...data,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
}