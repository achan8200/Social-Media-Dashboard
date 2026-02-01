import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, take } from 'rxjs';
import { Auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, User, getAuth, fetchSignInMethodsForEmail } from '@angular/fire/auth';
import { Firestore, collection, doc, getDocs, query, where, runTransaction } from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSubject = new BehaviorSubject<User | null>(null);
  user$ = this.userSubject.asObservable();

  private authReadySubject = new BehaviorSubject<boolean>(false);
  authReady$ = this.authReadySubject.asObservable();

  constructor(private auth: Auth, private router: Router, private firestore: Firestore) {
    // Initialize Firebase Auth state
    onAuthStateChanged(this.auth, (user) => {
      this.userSubject.next(user);
      this.authReadySubject.next(true);
    });
  }

  // LOGIN
  login(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  // SIGNUP
  async signup(
    email: string,
    password: string,
    username: string,
    displayName: string,
    profilePicture?: string
  ) {
    // Trim display name
    const trimmedDisplayName = displayName.trim();
    if (!trimmedDisplayName) {
      throw new Error('Display name cannot be empty');
    }

    // Validate username
    const lowerUsername = username.toLowerCase();
    const usernameError = this.validateUsername(lowerUsername);
    if (usernameError) { 
      throw new Error(usernameError);
    }

    const unique = await this.isUsernameUnique(lowerUsername);
    if (!unique) throw new Error('Username already exists');

    // Create Firebase Auth user
    const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
    const uid = userCredential.user.uid;

    try {
      // Generate sequential userId using transaction
      const counterRef = doc(this.firestore, 'counters/users');

      await runTransaction(this.firestore, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);

        let newUserId = 1;

        if (!counterDoc.exists()) {
          // First user ever
          transaction.set(counterRef, { lastUserId: 1 });
        } else {
          const lastUserId = counterDoc.data()['lastUserId'];
          newUserId = lastUserId + 1;
          transaction.update(counterRef, { lastUserId: newUserId });
        }

        // Create Firestore user profile
        const userRef = doc(this.firestore, `users/${uid}`);
        transaction.set(userRef, {
          userId: newUserId,
          username: lowerUsername,
          displayName: trimmedDisplayName,
          profilePicture: profilePicture || '',
          email
        });
      });

    } catch (err) {
      // Roll back Auth user if Firestore fails
      await userCredential.user.delete();
      throw err;
    }
  }

  // LOGOUT
  async logout() {
    await signOut(this.auth);
  }

  // Helper: get current user once
  getCurrentUser(): Observable<User | null> {
    return this.user$.pipe(take(1));
  }

  async checkEmailExists(email: string) {
    const auth = getAuth();
    await fetchSignInMethodsForEmail(auth, email);
  }

  // Username validation rules
  validateUsername(username: string): string | null {
    /* 
      Requirements:
      Length 3-20
      Start with letter
      Lowercase letters/numbers/dot/underscore,
      No consecutive dot/underscore
      Not start/end with dot/underscore 
    */
    const pattern = /^(?=.{3,20}$)(?!.*[._]{2})(?![._])[a-z][a-z0-9._]*(?<![._])$/;
    if (!pattern.test(username)) {
      return 'Invalid username. Must be 3-20 chars, start with a letter, letters/numbers/dots/underscores allowed, no consecutive dots/underscores, cannot start/end with dot/underscore.';
    }
    return null;
  }

  // Check if username exists
  async isUsernameUnique(username: string): Promise<boolean> {
    const lowerUsername = username.toLowerCase();
    const usersRef = collection(this.firestore, 'users');
    const q = query(usersRef, where('username', '==', lowerUsername));
    const snapshot = await getDocs(q);
    return snapshot.empty; // true if no user exists with that username
  }
}