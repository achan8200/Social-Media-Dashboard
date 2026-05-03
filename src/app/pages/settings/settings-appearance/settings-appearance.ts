import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';

@Component({
  selector: 'app-settings-appearance',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './settings-appearance.html',
  styleUrl: './settings-appearance.css',
})
export class SettingsAppearance {
  private themeService = inject(ThemeService);

  themes = this.themeService.getThemes();
  selectedTheme = 'light';

  apply(theme: string) {
    this.selectedTheme = theme;
    this.themeService.applyTheme(theme);
  }

  save(theme: string) {
    this.themeService.saveTheme(theme);
  }
}