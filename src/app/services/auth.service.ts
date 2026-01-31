import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, take } from 'rxjs';
import { Auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, User } from '@angular/fire/auth';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private userSubject = new BehaviorSubject<User | null>(null);
  user$ = this.userSubject.asObservable();

  private authReadySubject = new BehaviorSubject<boolean>(false);
  authReady$ = this.authReadySubject.asObservable();

  constructor(private auth: Auth, private router: Router) {
    // Initialize Firebase Auth state
    onAuthStateChanged(this.auth, (user) => {
      //console.log('[AUTH STATE]', user ? 'LOGGED IN' : 'LOGGED OUT');
      this.userSubject.next(user);
      this.authReadySubject.next(true);
    });
  }

  // LOGIN
  login(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  // SIGNUP
  signup(email: string, password: string) {
    return createUserWithEmailAndPassword(this.auth, email, password);
  }

  // LOGOUT
  async logout() {
    await signOut(this.auth);
  }

  // Helper: get current user once
  getCurrentUser(): Observable<User | null> {
    return this.user$.pipe(take(1));
  }
}