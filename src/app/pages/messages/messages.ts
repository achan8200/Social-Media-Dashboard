import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
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

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    this.route.queryParamMap.subscribe(params => {
      const threadId = params.get('threadId');
      if (threadId) {
        this.onSelectThread(threadId);
      }
    });
  }

  onSelectThread(threadId: string) {
    this.selectedThreadId = threadId;
  }
}