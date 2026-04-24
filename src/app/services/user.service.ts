import { Injectable } from '@angular/core';
import { Firestore, collection, doc, docData, documentId, getDocs, query, where } from '@angular/fire/firestore';
import { from, map, Observable, of, shareReplay } from 'rxjs';
export interface User {
  uid?: string;
  username: string;
  userId: string;
  displayName: string;
  profilePicture?: string;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private userCache = new Map<string, Observable<User | null>>();

  constructor(private firestore: Firestore) {}

  getUserByUid(uid: string): Observable<User | null> {
    if (!uid) return of(null);

    // Return cached observable if exists
    if (this.userCache.has(uid)) {
      return this.userCache.get(uid)!;
    }

    const user$ = docData(doc(this.firestore, `users/${uid}`), { idField: 'uid' }) as Observable<User | null>;

    // Cache the observable and share it among multiple subscribers
    const shared$ = user$.pipe(shareReplay(1));
    this.userCache.set(uid, shared$);

    return shared$;
  }

  getUsersByUids(uids: string[]) {
    if (!uids.length) return from([[]]);

    const chunks = this.chunk(uids, 30);

    const queries = chunks.map(chunk => {
      const ref = collection(this.firestore, 'users');
      const q = query(ref, where(documentId(), 'in', chunk));
      return getDocs(q);
    });

    return from(Promise.all(queries)).pipe(
      map(snapshots => {
        const users: any[] = [];

        snapshots.forEach(snapshot => {
          snapshot.forEach(doc => {
            users.push({ uid: doc.id, ...doc.data() });
          });
        });

        return users;
      })
    );
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const res: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      res.push(arr.slice(i, i + size));
    }
    return res;
  }
}