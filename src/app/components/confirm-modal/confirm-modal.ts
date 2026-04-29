import { Component, EventEmitter, Input, Output, AfterContentInit, ContentChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, transition, style, animate } from '@angular/animations';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confirm-modal.html',
  animations: [
    trigger('overlayFade', [
      transition(':enter', [style({ opacity: 0 }), animate('200ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))])
    ]),
    trigger('modalScale', [
      transition(':enter', [style({ opacity: 0, transform: 'scale(0.95)' }), animate('200ms ease-out', style({ opacity: 1, transform: 'scale(1)' }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0, transform: 'scale(0.95)' }))])
    ])
  ]
})
export class ConfirmModal {
  @Input() title = 'Are you sure?';
  @Input() message = '';
  @Input() confirmText = 'Confirm';
  @Input() cancelText = 'Cancel';

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  // Local state to control *ngIf
  isOpen = true;

  private action: 'confirm' | 'cancel' | null = null;

  @ContentChild(ElementRef) projectedContent!: ElementRef;

  hasProjectedContent = false;

  ngAfterContentInit() {
    this.hasProjectedContent = !!this.projectedContent;
  }

  onConfirm() {
    this.action = 'confirm';
    this.isOpen = false; // triggers fade/scale leave animation
  }

  onCancel() {
    this.action = 'cancel';
    this.isOpen = false; // triggers fade/scale leave animation
  }

  onAnimationDone(event: any) {
    if (event.toState === 'void') {
      if (this.action === 'confirm') {
        this.confirmed.emit();
      } else if (this.action === 'cancel') {
        this.cancelled.emit();
      }
    }
  }
}