import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, getDoc, getDocs, collectionData, query, where, serverTimestamp, deleteDoc, docData } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { from, map, Observable, switchMap, of } from 'rxjs';

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
  role: 'owner' | 'member';
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
    const user = await this.authService.getCurrentUser().toPromise();
    if (!user) throw new Error('Not authenticated');

    const groupRef = doc(collection(this.firestore, 'groups'));

    const groupId = groupRef.id;

    // Create group
    await setDoc(groupRef, {
      ownerId: user.uid,
      name,
      bio,
      createdAt: serverTimestamp()
    });

    // Add creator as member (owner role)
    const memberRef = doc(this.firestore, `groups/${groupId}/members/${user.uid}`);
    await setDoc(memberRef, {
      uid: user.uid,
      role: 'owner',
      joinedAt: serverTimestamp()
    });

    // Add group to user's groups list
    const userGroupRef = doc(this.firestore, `users/${user.uid}/groups/${groupId}`);
    await setDoc(userGroupRef, {
      groupId,
      joinedAt: serverTimestamp()
    });

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

  // ─────────────────────────────
  // Join Group
  // ─────────────────────────────
  async joinGroup(groupId: string): Promise<void> {
    const user = await this.authService.getCurrentUser().toPromise();
    if (!user) throw new Error('Not authenticated');

    const ref = doc(this.firestore, `groups/${groupId}/members/${user.uid}`);

    await setDoc(ref, {
      uid: user.uid,
      role: 'member',
      joinedAt: serverTimestamp()
    });
  }

  // ─────────────────────────────
  // Leave Group
  // ─────────────────────────────
  async leaveGroup(groupId: string): Promise<void> {
    const user = await this.authService.getCurrentUser().toPromise();
    if (!user) throw new Error('Not authenticated');

    const ref = doc(this.firestore, `groups/${groupId}/members/${user.uid}`);
    await deleteDoc(ref);
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
      map(doc => !!doc)
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
}