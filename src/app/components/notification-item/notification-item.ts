import { Component, Input, Output, EventEmitter } from '@angular/core';
import { NgIf } from '@angular/common';

@Component({
  selector: 'app-notification-item',
  imports: [NgIf],
  templateUrl: './notification-item.html',
  styleUrl: './notification-item.css'
})
export class NotificationItem {
  @Input() notification!: { text: string; read: boolean; };
  @Output() markRead = new EventEmitter<MouseEvent>();
}
