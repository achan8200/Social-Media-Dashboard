import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { getInitial, getAvatarColor } from '../../utils/avatar';

@Component({
  selector: 'app-avatar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <a *ngIf="userId; else avatarContent"
       [routerLink]="['/profile', userId]"
       class="cursor-pointer block hover:opacity-80 transition"
       (click)="avatarClick()">

      <ng-container *ngTemplateOutlet="avatarContent"></ng-container>
    </a>

    <ng-template #avatarContent>
      <div
        class="rounded-full overflow-hidden flex items-center justify-center text-white font-normal"
        [ngClass]="{
          'w-6 h-6 text-xs': size === 'xs',
          'w-8 h-8 text-sm': size === 'sm',
          'w-10 h-10 text-base': size === 'md',
          'w-12 h-12 text-lg': size === 'lg'
        }"
        [style.backgroundColor]="!imageUrl ? getAvatarColor(username) : null"
        (click)="avatarClick()"
      >

        <ng-container *ngIf="imageUrl; else fallback">
          <img
            [src]="imageUrl"
            alt="Avatar"
            class="w-full h-full object-cover"
          />
        </ng-container>

        <ng-template #fallback>
          {{ getInitial(username) }}
        </ng-template>

      </div>
    </ng-template>
  `
})
export class Avatar {

  @Input() imageUrl?: string | null;
  @Input() username?: string | null;
  @Input() userId?: string | null;

  // Avatar size system
  @Input() size: 'xs' | 'sm' | 'md' | 'lg' = 'sm';

  @Output() clicked = new EventEmitter<string | null>();

  avatarClick() {
    this.clicked.emit(this.userId);
  }

  getInitial = getInitial;
  getAvatarColor = getAvatarColor;
}