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
      <ng-container *ngIf="imageUrl; else fallback">
        <img [src]="imageUrl"
             alt="Avatar"
             class="w-8 h-8 rounded-full object-cover" 
             (click)="avatarClick()"/>
      </ng-container>

      <ng-template #fallback>
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold"
          [style.backgroundColor]="getAvatarColor(username)"
          (click)="avatarClick()"
        >
          {{ getInitial(username) }}
        </div>
      </ng-template>
    </ng-template>
  `
})
export class Avatar {
  @Input() imageUrl?: string | null; // userAvatar
  @Input() username?: string | null; // username
  @Input() userId?: string | null; // userId

  @Output() clicked = new EventEmitter<string | null>();

  avatarClick() {
    this.clicked.emit(this.userId);
  }

  getInitial = getInitial;
  getAvatarColor = getAvatarColor;
}