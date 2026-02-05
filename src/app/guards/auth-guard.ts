import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { filter, map, switchMap, take } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate() {
    return this.authService.authReady$.pipe(
      filter(Boolean),
      switchMap(() => this.authService.user$),
      take(1),
      map(user =>
        user ? true : this.router.createUrlTree(['/login'])
      )
    );
  }
}