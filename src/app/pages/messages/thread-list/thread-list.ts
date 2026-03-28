import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth, authState  } from '@angular/fire/auth';
import { MessagesService } from '../../../services/messages.service';
import { User, UserService } from '../../../services/user.service';
import { Thread } from '../../../models/messages.model';
import { Avatar } from "../../../components/avatar/avatar";
import { trigger, transition, style, animate } from '@angular/animations';
import { Observable, map, of, switchMap, BehaviorSubject, combineLatest, catchError } from 'rxjs';

interface ThreadDisplay {
  id: string;
  userId: string;
  username: string;
  avatarUrl?: string | null;
  lastMessage?: string;
  lastMessageSenderId?: string;
  lastMessageTime?: any;
  unreadCount?: number;
}

@Component({
  selector: 'app-thread-list',
  standalone: true,
  imports: [CommonModule, Avatar, FormsModule],
  templateUrl: './thread-list.html',
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
        animate(
          '200ms ease-out',
          style({ opacity: 1, transform: 'scale(1)' })
        )
      ]),
      transition(':leave', [
        animate(
          '150ms ease-in',
          style({ opacity: 0, transform: 'scale(0.95)' })
        )
      ])
    ])
  ]
})
export class ThreadList {
  @Output() selectThread = new EventEmitter<string>();

  selectedThreadId: string | null = null;

  users$!: Observable<User[]>;
  filteredUsers$!: Observable<User[]>;
  threads$!: Observable<ThreadDisplay[]>;
  showNewChatModal = false;
  searchText = '';

  search$ = new BehaviorSubject<string>('');

  constructor(
    private messagesService: MessagesService, 
    private auth: Auth, 
    private userService: UserService
  ) {}

  ngOnInit() {
    // Reactive thread list
    this.threads$ = authState(this.auth).pipe(
      switchMap(user => {
        if (!user?.uid) return of([] as ThreadDisplay[]);
        const currentUid = user.uid;

        return this.messagesService.getUserThreads().pipe(
          switchMap((threads: Thread[]) => {
            if (!threads || threads.length === 0) return of([]);

            const threadDisplays$ = threads.map(thread => {
              const otherUid = thread.participants.find(uid => uid !== currentUid) || '';

              return this.userService.getUserByUid(otherUid).pipe(
                map(userInfo => ({
                  id: thread.id,
                  userId: userInfo?.userId || otherUid,
                  username: userInfo?.displayName || userInfo?.username || 'Unknown',
                  avatarUrl: userInfo?.profilePicture || null,
                  lastMessage: thread.lastMessage?.text || '',
                  lastMessageSenderId: thread.lastMessage?.senderId || '',
                  lastMessageTime: thread.lastMessage?.createdAt?.toDate?.() || null,
                  unreadCount: thread.unreadCount || 0 // directly from thread
                })),
                catchError(() => of({
                  id: thread.id,
                  userId: otherUid,
                  username: 'Unknown',
                  avatarUrl: null,
                  lastMessage: thread.lastMessage?.text || '',
                  lastMessageSenderId: thread.lastMessage?.senderId || '',
                  lastMessageTime: thread.lastMessage?.createdAt?.toDate?.() || null,
                  unreadCount: thread.unreadCount || 0
                }))
              );
            });

            return combineLatest(threadDisplays$);
          })
        );
      })
    );
  }

  onSelect(threadId: string) {
    this.selectedThreadId = threadId;
    this.selectThread.emit(threadId);
  }

  startChat() {
    this.showNewChatModal = true;
    if (!this.auth.currentUser) return;

    this.users$ = this.messagesService.getAllUsers();
    this.filteredUsers$ = combineLatest([this.users$, this.search$]).pipe(
      map(([users, search]) =>
        users.filter(u =>
          (u.displayName || u.username || '').toLowerCase().includes(search.toLowerCase())
        )
      )
    );
  }

  closeModal() {
    this.showNewChatModal = false;
    this.searchText = '';
  }

  async selectUser(user: User) {
    if (!user.uid) return;

    const threadId = await this.messagesService.getOrCreateThread(user.uid);

    this.selectedThreadId = threadId;
    this.selectThread.emit(threadId);
    this.closeModal();
  }

  formatTimestamp(date: Date | null): string {
    if (!date) return '';

    const now = new Date();

    const isSameDay = date.toDateString() === now.toDateString();

    // Calculate difference in days
    const diffTime = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    // Today -> show time (5:40 PM)
    if (isSameDay) {
      return date.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
      });
    }

    // Within last 6 days -> show day (Mon, Tue, etc.)
    if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    }

    // Older -> show "Mar 18"
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric'
    });
  }

  formatLastMessage(thread: ThreadDisplay): string {
    if (!thread.lastMessage) return '';

    const currentUid = this.auth.currentUser?.uid;

    if (thread.lastMessageSenderId === currentUid) {
      return `You: ${thread.lastMessage}`;
    }

    return thread.lastMessage;
  }
}