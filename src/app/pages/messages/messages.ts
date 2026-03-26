import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThreadList } from './thread-list/thread-list';
import { ChatWindow } from './chat-window/chat-window';

@Component({
  selector: 'app-messages',
  standalone: true,
  imports: [CommonModule, ThreadList, ChatWindow],
  templateUrl: './messages.html'
})
export class Messages {
  selectedThreadId: string | null = null;

  onSelectThread(threadId: string) {
    this.selectedThreadId = threadId;
  }
}