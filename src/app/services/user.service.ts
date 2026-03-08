import { Injectable } from '@angular/core';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Observable } from 'rxjs';

export interface User {
  uid?: string;
  username: string;
  userId: string;
  displayName: string;
  profilePicture?: string;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(private firestore: Firestore) {}

  getUserByUid(uid: string): Observable<User | null> {
    return docData(doc(this.firestore, `users/${uid}`), { idField: 'uid' }) as Observable<User | null>;
  }
}