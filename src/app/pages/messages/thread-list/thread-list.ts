import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth, authState  } from '@angular/fire/auth';
import { MessagesService } from '../../../services/messages.service';
import { User, UserService } from '../../../services/user.service';
import { FollowService } from '../../../services/follow.service';
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
  lastMessageSenderName?: string;
  lastMessageTime?: any;
  unreadCount?: number;
  participants?: { uid: string; userId: string; avatarUrl: string; username: string }[];
  typing?: { [uid: string]: boolean };
  groupName?: string;
}

@Component({
  selector: 'app-thread-list',
  standalone: true,
  imports: [CommonModule, Avatar, FormsModule],
  templateUrl: './thread-list.html',
  animations: [
    // Overlay fade
    trigger('overlayFade', [
      transition(':enter', [style({ opacity: 0 }), animate('200ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))])
    ]),
    // Modal sliding/fade
    trigger('modalTransition', [
      transition('newChat <=> createGroup', [
        style({ opacity: 0, transform: 'translateX(50px)' }),
        animate('250ms ease-out', style({ opacity: 1, transform: 'translateX(0)' }))
      ]),
      transition('void => *', [style({ opacity: 0 }), animate('200ms ease-out', style({ opacity: 1 }))]),
      transition('* => void', [animate('150ms ease-in', style({ opacity: 0 }))])
    ])
  ]
})
export class ThreadList {
  @Input() selectedThreadId: string | null = null;
  @Output() selectThread = new EventEmitter<string>();

  // Threads
  threads$!: Observable<ThreadDisplay[]>;

  // Users for New Chat modal
  filteredNewChatUsers$!: Observable<User[]>;
  search$ = new BehaviorSubject<string>('');
  searchText = '';
  showNewChatModal = false;

  // Users for Group modal
  filteredGroupUsers$!: Observable<User[]>;
  groupSearch$ = new BehaviorSubject<string>('');
  groupSearchText = '';
  showCreateGroupModal = false;
  selectedGroupUsers = new Set<string>();
  groupName = '';

  // Modal state: 'none' | 'newChat' | 'createGroup'
  currentModal: 'none' | 'newChat' | 'createGroup' = 'none';

  constructor(
    private messagesService: MessagesService, 
    private auth: Auth, 
    private userService: UserService,
    private followService: FollowService
  ) {}

  ngOnInit() {
    this.threads$ = authState(this.auth).pipe(
      switchMap(user => {
        if (!user?.uid) return of([] as ThreadDisplay[]);
        const currentUid = user.uid;

        return this.messagesService.getUserThreads().pipe(
          switchMap((threads: Thread[]) => {
            if (!threads || threads.length === 0) return of([]);

            const threadDisplays$ = threads.map(thread => {
              // Get all participants (for typing usernames)
              const participantObservables = thread.participants.map(uid =>
                this.userService.getUserByUid(uid).pipe(
                  map(user => ({
                    uid,
                    userId: user?.userId || '',
                    username: user?.displayName || user?.username || 'Unknown',
                    avatarUrl: user?.profilePicture || null
                  })),
                  catchError(() =>
                    of({
                      uid,
                      userId: 'Unknown',
                      username: 'Unknown',
                      avatarUrl: null
                    })
                  )
                )
              );

              return combineLatest(participantObservables).pipe(
                map(participants => {
                  const otherUser = participants.find(p => p.uid !== currentUid);

                  return {
                    id: thread.id,
                    userId: otherUser?.userId || '',
                    username: otherUser?.username || 'Unknown',
                    avatarUrl: otherUser?.avatarUrl || null,

                    lastMessage: thread.lastMessage?.text || '',
                    lastMessageSenderId: thread.lastMessage?.senderId || '',
                    lastMessageSenderName: thread.lastMessage?.senderName || '',
                    lastMessageTime: thread.lastMessage?.createdAt?.toDate?.() || null,

                    unreadCount: thread.unreadCount || 0,
                    typing: thread.typing || {},

                    participants,
                    groupName: (thread.groupName ?? '').trim()
                  } as ThreadDisplay;
                })
              );
            });

            return combineLatest(threadDisplays$);
          })
        );
      })
    );
  }

  /** ---------------------- Thread Selection ---------------------- */
  onSelect(threadId: string) {
    this.selectedThreadId = threadId;
    this.selectThread.emit(threadId);
  }

  /** ---------------------- New Chat Modal ---------------------- */
  startChat() {
    this.currentModal = 'newChat';

    if (!this.auth.currentUser?.uid) return;

    // Set filteredNewChatUsers$ directly with search logic
    this.filteredNewChatUsers$ = this.getFollowingUsers().pipe(
      switchMap(users =>
        this.search$.pipe(
          map(search =>
            users.filter(u =>
              (u.displayName || u.username || '').toLowerCase().includes(search.toLowerCase())
            )
          )
        )
      )
    );
  }

  async selectUser(user: User) {
    if (!user.uid) return;

    const threadId = await this.messagesService.getOrCreateThread(user.uid);

    this.selectedThreadId = threadId;
    this.selectThread.emit(threadId);
    this.closeModal();
  }

  /** ---------------------- Group Modal ---------------------- */
  openCreateGroupModal() {
    this.currentModal = 'createGroup';
    this.selectedGroupUsers.clear();
    this.groupName = '';
    this.groupSearchText = '';
    this.groupSearch$.next('');

    if (!this.auth.currentUser?.uid) return;

    // Set filteredGroupUsers$ directly with search logic
    this.filteredGroupUsers$ = this.getFollowingUsers().pipe(
      switchMap(users =>
        this.groupSearch$.pipe(
          map(search =>
            users.filter(u =>
              (u.displayName || u.username || '').toLowerCase().includes(search.toLowerCase())
            )
          )
        )
      )
    );
  }

  backToNewChat() {
    this.currentModal = 'newChat';
  }

  closeModal() {
    this.currentModal = 'none';
    this.searchText = '';
    this.groupSearchText = '';
    this.selectedGroupUsers.clear();
    this.groupName = '';
    this.search$.next('');
    this.groupSearch$.next('');
  }

  toggleUserSelection(user: User) {
    if (!user.uid) return;
    this.selectedGroupUsers.has(user.uid)
      ? this.selectedGroupUsers.delete(user.uid)
      : this.selectedGroupUsers.add(user.uid);
  }

  async createGroupChat() {
    const currentUid = this.auth.currentUser?.uid;
    if (!currentUid) return;

    const participants = Array.from(this.selectedGroupUsers);

    // Use new service method
    const threadId = await this.messagesService.getOrCreateGroupThread(participants, this.groupName);

    this.selectedThreadId = threadId;
    this.selectThread.emit(threadId);

    this.closeModal();
  }

  /** ---------------------- Utilities ---------------------- */
  getFollowingUsers(): Observable<User[]> {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.uid) return of([]);

    return this.followService.getFollowing(currentUser.uid).pipe(
      switchMap(following => {
        if (!following.length) return of([]);
        const users$ = following.map(f =>
          this.userService.getUserByUid(f.uid).pipe(catchError(() => of(null)))
        );
        // Use combineLatest + default empty array to avoid forkJoin blocking
        return combineLatest(users$).pipe(
          map(users => users.filter(Boolean) as User[])
        );
      })
    );
  }

  formatTimestamp(date: Date | null): string {
    if (!date) return '';

    const now = new Date();

    const isSameDay = date.toDateString() === now.toDateString();

    // Calculate difference in days
    const diffTime = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    const isSameYear = date.getFullYear() === now.getFullYear();

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
      day: 'numeric',
      ...(isSameYear ? {} : { year: 'numeric' })
    });
  }

  formatLastMessage(thread: ThreadDisplay): string {
    const currentUid = this.auth.currentUser?.uid;

    if (!thread.lastMessage) return '';

    const isCurrentUser = thread.lastMessageSenderId === currentUid;
    const isGroup = (thread.participants?.length || 0) > 2;

    // 1-on-1 chat → keep existing behavior
    if (!isGroup) {
      return isCurrentUser
        ? `You: ${thread.lastMessage}`
        : thread.lastMessage;
    }

    // Group chat
    if (isCurrentUser) {
      return `You: ${thread.lastMessage}`;
    }

    // Someone else in group
    const senderName = thread.lastMessageSenderName || 'Someone';
    return `${senderName}: ${thread.lastMessage}`;
  }

  isOtherUserTyping(thread: ThreadDisplay): boolean {
    const currentUid = this.auth.currentUser?.uid;
    if (!currentUid || !thread.typing) return false;

    return Object.entries(thread.typing).some(
      ([uid, isTyping]) => uid !== currentUid && isTyping
    );
  }

  getTypingText(thread: ThreadDisplay): string {
    const currentUid = this.auth.currentUser?.uid;
    if (!currentUid || !thread.typing || !thread.participants) return '';

    const typingUsers = Object.entries(thread.typing)
      .filter(([uid, isTyping]) => uid !== currentUid && isTyping)
      .map(([uid]) => {
        const user = thread.participants?.find(p => p.uid === uid);
        return user?.username || 'Someone';
      });

    if (typingUsers.length === 0) return '';
    if (typingUsers.length === 1) return `${typingUsers[0]} is typing`;
    if (typingUsers.length === 2) return `${typingUsers[0]} and ${typingUsers[1]} are typing`;
    return `${typingUsers[0]} and others are typing`;
  }

  getThreadDisplayName(thread: ThreadDisplay): string {
    const currentUid = this.auth.currentUser?.uid;

    if (thread.groupName) {
      // Group chat -> show group name
      return thread.groupName;
    }

    // 1-on-1 or small threads -> show all other users except current
    const otherUsers = thread.participants?.filter(p => p.uid !== currentUid);

    if (!otherUsers || otherUsers.length === 0) return 'Unknown';

    // Join names if multiple others exist (rare in 1-on-1)
    return otherUsers.map(u => u.username).join(', ');
  }

  getThreadAvatars(thread: ThreadDisplay) {
    const currentUid = this.auth.currentUser?.uid;

    if (!thread.participants) return [];

    const others = thread.participants.filter(p => p.uid !== currentUid);

    if (others.length === 1) {
      // 1-on-1
      return others.slice(0, 1);
    }

    // Group logic
    if (others.length === 2) return others.slice(0, 2); // 3 total
    if (others.length === 3) return others.slice(0, 3); // 4 total
    return others.slice(0, 4); // 5+
  }

  getAvatarPositionClass(thread: ThreadDisplay, index: number): string {
    const count = this.getThreadAvatars(thread).length;
    console.log("Thread id: ", thread.id, " count: ", count);
    // 2 avatars
    if (count === 2) {
      return index === 0
        ? 'top-0 left-0'
        : 'bottom-0 right-0';
    }

    // 3 avatars
    if (count === 3) {
      if (index === 0) return 'bottom-0 left-0';
      if (index === 1) return 'bottom-0 right-0';
      return 'top-[2.5px] left-1/2 -translate-x-1/2';
    }

    // 4 avatars
    if (count >= 4) {
      if (index === 0) return 'top-0 left-0';
      if (index === 1) return 'top-0 right-0';
      if (index === 2) return 'bottom-0 left-0';
      return 'bottom-0 right-0';
    }

    return '';
  }

  /** ---------------------- trackBy ---------------------- */
  trackByUid(index: number, user: User) {
    return user.uid;
  }
}