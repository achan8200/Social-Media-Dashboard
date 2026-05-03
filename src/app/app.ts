import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { doc, docData, Firestore } from '@angular/fire/firestore';
import { Navbar } from './components/navbar/navbar';
import { Sidebar } from './components/sidebar/sidebar';
import { AuthService } from './services/auth.service';
import { ThemeService } from './services/theme.service';
import { switchMap } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    Navbar,
    Sidebar,
    CommonModule
],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App {
  constructor(
    public authService: AuthService,
    private firestore: Firestore,
    private themeService: ThemeService) {}

  ngOnInit() {
    this.authService.user$
      .pipe(
        switchMap(user => {
          if (!user) return [];
          const ref = doc(this.firestore, `users/${user.uid}`);
          return docData(ref);
        })
      )
      .subscribe((profile: any) => {
        const theme = profile?.theme || 'light';
        this.themeService.applyTheme(theme);
      });
  }
}