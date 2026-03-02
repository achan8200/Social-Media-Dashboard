import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { trigger, transition, style, animate } from '@angular/animations';
import { Post } from '../../models/post.model';
import { Avatar } from '../avatar/avatar';

@Component({
  selector: 'app-edit-post-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, Avatar],
  templateUrl: './edit-post-modal.html',
  animations: [
    trigger('overlayFade', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('200ms ease-out', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('150ms ease-in', style({ opacity: 0 }))
      ])
    ]),
    trigger('modalScale', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95)' }),
        animate('200ms ease-out', style({ opacity: 1, transform: 'scale(1)' }))
      ]),
      transition(':leave', [
        animate('150ms ease-in', style({ opacity: 0, transform: 'scale(0.95)' }))
      ])
    ])
  ]
})
export class EditPostModal {
  @Input() post!: Post;

  @Output() update = new EventEmitter<string>(); // emits updated caption
  @Output() cancel = new EventEmitter<void>();

  editedCaption: string = '';

  /** Control visibility for animations */
  visible = true;

  ngOnInit() {
    this.editedCaption = this.post.caption || '';
  }

  onUpdate() {
    this.visible = false; // triggers :leave animation
    setTimeout(() => {
      this.update.emit(this.editedCaption.trim());
    }, 150); // match :leave duration
  }

  onCancel() {
    this.visible = false; // triggers :leave animation
    setTimeout(() => {
      this.cancel.emit();
    }, 150); // match :leave duration
  }
}