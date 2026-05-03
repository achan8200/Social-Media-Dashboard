import { Injectable, inject } from '@angular/core';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);

  private themes = [
    'light',
    'ash',
    'dark',
    'onyx',
    'mint-apple',
    'citrus-sherbert',
    'retro-raincloud',
    'hanami',
    'sunrise',
    'cotton-candy',
    'lofi-vibes',
    'desert-khaki',
    'sunset',
    'chroma-glow',
    'forest',
    'crimson-moon',
    'mars',
    'dusk',
    'under-the-sea',
    'retro-storm',
    'neon-nights',
    'strawberry-lemonade',
    'aurora',
    'sepia'
  ];

  getThemes() {
    return this.themes;
  }

  applyTheme(theme: string) {
    document.body.className = '';
    document.body.classList.add(`theme-${theme}`);
  }

  async saveTheme(theme: string) {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) return;

    const ref = doc(this.firestore, `users/${user.uid}`);
    await setDoc(ref, { theme }, { merge: true });

    this.applyTheme(theme);
  }
}