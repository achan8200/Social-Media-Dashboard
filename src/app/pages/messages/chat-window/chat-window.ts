import { Component, ElementRef, Input, OnChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessagesService } from '../../../services/messages.service';
import { Auth } from '@angular/fire/auth';
import { Observable, tap } from 'rxjs';
import { Message } from '../../../models/messages.model';

@Component({
  selector: 'app-chat-window',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-window.html'
})
export class ChatWindow implements OnChanges {
  @Input() threadId: string | null = null;
  
  @ViewChild('messageInput') messageInput!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;

  messages$!: Observable<Message[]>;
  newMessage = '';
  currentUserId!: string;
  showNewMessageIndicator = false;

  constructor(
    private messagesService: MessagesService,
    private auth: Auth
  ) {}

  ngOnChanges() {
    if (!this.threadId) return;

    this.currentUserId = this.auth.currentUser?.uid!;
    this.messages$ = this.messagesService.getMessages(this.threadId).pipe(
      tap(() => {
        setTimeout(() => {
          if (this.isNearBottom()) {
            this.scrollToBottom();
            this.showNewMessageIndicator = false;
          } else {
            this.showNewMessageIndicator = true;
          }
        });
      })
    );

    this.messagesService.markMessagesAsRead(this.threadId);

    setTimeout(() => {
      this.messageInput?.nativeElement.focus();
      this.scrollToBottom();
    });
  }

  async sendMessage() {
    if (!this.threadId || !this.newMessage.trim()) return;

    await this.messagesService.sendMessage(this.threadId, this.newMessage);

    this.newMessage = '';

    setTimeout(() => this.scrollToBottom());
  }

  handleEnter(event: Event) {
    const keyboardEvent = event as KeyboardEvent;

    if (keyboardEvent.shiftKey) return;

    if (!this.newMessage.trim()) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    this.sendMessage();
  }

  autoResize() {
    const el = this.messageInput.nativeElement;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  scrollToBottom() {
    try {
      const el = this.scrollContainer.nativeElement;
      el.scrollTo({
        top: el.scrollHeight,
        behavior: 'smooth'
      });
    } catch {}
  }

  isNearBottom(): boolean {
    const el = this.scrollContainer.nativeElement;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
  }

  onScroll() {
    if (this.isNearBottom()) {
      this.showNewMessageIndicator = false;
    }
  }
}