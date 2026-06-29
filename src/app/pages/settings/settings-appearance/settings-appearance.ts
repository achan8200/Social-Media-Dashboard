import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';

@Component({
  selector: 'app-settings-appearance',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './settings-appearance.html',
  styleUrl: './settings-appearance.css',
})
export class SettingsAppearance implements OnInit, OnDestroy {
  private themeService = inject(ThemeService);
  private cdr = inject(ChangeDetectorRef);

  themes = this.themeService.getThemes();

  selectedTheme = 'light';

  savedTheme = 'light';

  ngOnInit() {
    this.savedTheme = this.themeService.currentTheme;
    this.selectedTheme = this.savedTheme;
  }

  preview(theme: string) {
    this.selectedTheme = theme;
    this.themeService.applyTheme(theme);
  }

  async save() {
    await this.themeService.saveTheme(this.selectedTheme);

    this.savedTheme = this.selectedTheme;
    this.themeService.currentTheme = this.selectedTheme;
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    if (this.selectedTheme !== this.savedTheme) {
      this.themeService.restoreTheme();
    }
  }
}