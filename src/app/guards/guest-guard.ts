import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { take, map, filter, switchMap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class GuestGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate() {
    return this.authService.authReady$.pipe(
      filter(ready => ready),
      take(1),
      switchMap(() => this.authService.user$),
      take(1),
      map(user =>
        !user ? true : this.router.createUrlTree(['/home'])
      )
    );
  }
}