import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MessagesService } from '../../../services/messages.service';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-thread-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './thread-list.html'
})
export class ThreadList {
  @Output() selectThread = new EventEmitter<string>();

  threads$!: Observable<any[]>;

  constructor(
    private messagesService: MessagesService,
    private auth: Auth
  ) {}

  ngOnInit() {
    const uid = this.auth.currentUser?.uid!;
    this.threads$ = this.messagesService.getUserThreads(uid);
  }

  onSelect(threadId: string) {
    this.selectThread.emit(threadId);
  }
}