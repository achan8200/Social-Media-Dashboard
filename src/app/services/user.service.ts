import { Injectable } from '@angular/core';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { shareReplay } from 'rxjs/operators';

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
}