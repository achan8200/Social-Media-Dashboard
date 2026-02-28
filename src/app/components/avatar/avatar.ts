import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { getInitial, getAvatarColor } from '../../utils/avatar';

@Component({
  selector: 'app-avatar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container *ngIf="imageUrl; else fallback">
      <img [src]="imageUrl" alt="Avatar" class="w-8 h-8 rounded-full object-cover" />
    </ng-container>

    <ng-template #fallback>
      <div
        class="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold"
        [style.backgroundColor]="getAvatarColor(username)"
      >
        {{ getInitial(username) }}
      </div>
    </ng-template>
  `
})
export class Avatar {
  @Input() imageUrl?: string | null;   // userAvatar
  @Input() username?: string | null;  // username

  getInitial = getInitial;
  getAvatarColor = getAvatarColor;
}