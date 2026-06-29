import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);

  currentTheme = 'light';

  private themes = [
    'light',
    'ash',
    'dark',
    'onyx',
    'mint-apple',
    'citrus-sherbert',
    'raincloud',
    'hanami',
    'sunrise',
    'cotton-candy',
    'lofi-vibes',
    'desert-khaki',
    'fog',
    'lavender-fields',
    'strawberry-lemonade',
    'blueberry-milk',
    'matcha',
    'under-the-sea',
    'sepia',
    'sunset',
    'chroma-glow',
    'crimson-moon',
    'mars',
    'dusk',
    'storm',
    'neon-nights',
    'aurora',
    'twilight',
    'ocean-deep',
    'solar-flare'
  ];

  getThemes() {
    return this.themes;
  }

  async loadTheme() {
    const user = await firstValueFrom(this.authService.user$);

    if (!user) {
      this.applyTheme('light');
      return;
    }

    const ref = doc(this.firestore, `users/${user.uid}`);
    const snap = await getDoc(ref);

    const theme = snap.data()?.['theme'] || 'light';

    this.currentTheme = theme;

    this.applyTheme(theme);
  }

  applyTheme(theme: string) {
    document.body.className = '';

    document.body.classList.add(`theme-${theme}`);

    this.updateGradient(theme);
  }

  private updateGradient(theme: string) {
    const noGradientThemes = [
      'light',
      'ash',
      'dark',
      'onyx'
    ];

    if (noGradientThemes.includes(theme)) {
      document.body.classList.remove('gradient-theme');
    } else {
      document.body.classList.add('gradient-theme');
    }
  }

  setCurrentTheme(theme: string) {
    this.currentTheme = theme;
    this.applyTheme(theme);
  }

  async saveTheme(theme: string) {
    const user = await firstValueFrom(this.authService.user$);

    if (!user) return;

    const ref = doc(this.firestore, `users/${user.uid}`);

    await setDoc(ref, { theme }, { merge: true });

    this.currentTheme = theme;

    this.applyTheme(theme);
  }

  restoreTheme() {
    this.applyTheme(this.currentTheme);
  }
}