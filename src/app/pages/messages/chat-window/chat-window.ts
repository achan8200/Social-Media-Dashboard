import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessagesService } from '../../../services/messages.service';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-chat-window',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-window.html'
})
export class ChatWindow implements OnChanges {
  @Input() threadId: string | null = null;

  messages$!: Observable<any[]>;
  newMessage = '';
  currentUserId!: string;

  constructor(
    private messagesService: MessagesService,
    private auth: Auth
  ) {}

  ngOnChanges() {
    if (!this.threadId) return;

    this.currentUserId = this.auth.currentUser?.uid!;
    this.messages$ = this.messagesService.getMessages(this.threadId);
  }

  async sendMessage() {
    if (!this.threadId || !this.newMessage.trim()) return;

    await this.messagesService.sendMessage(this.threadId, this.newMessage);

    this.newMessage = '';
  }
}