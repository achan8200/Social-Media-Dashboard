import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import { User, UserService } from '../../../services/user.service';
import { FollowService } from '../../../services/follow.service';
import { MessagesService } from '../../../services/messages.service';
import { Message } from '../../../models/messages.model';
import { Avatar } from '../../../components/avatar/avatar';
import { ConfirmModal } from '../../../components/confirm-modal/confirm-modal';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';
import emojiRegex from 'emoji-regex';
import { trigger, transition, style, animate } from '@angular/animations';
import { Observable, tap, combineLatest, map, switchMap, of, BehaviorSubject, catchError, Subject, takeUntil } from 'rxjs';

interface MessageWithSender extends Message {
  senderProfilePicture?: string;
  senderUsername?: string;
  senderUserId?: string;
}

interface Participant {
  uid: string;
  username: string;
  userId: string;
  profilePicture: string;
}

@Component({
  selector: 'app-chat-window',
  standalone: true,
  imports: [CommonModule, FormsModule, Avatar, ConfirmModal, PickerComponent],
  templateUrl: './chat-window.html',
  styleUrls: ['./chat-window.css'],
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
export class ChatWindow implements OnChanges {
  @Input() threadId: string | null = null;
  @Output() threadDeleted = new EventEmitter<void>();
  @Output() threadChanged = new EventEmitter<string>();
  
  @ViewChild('messageInput') messageInput!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('editBox') editBox!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('detailsButton', { static: false }) detailsButton!: ElementRef;
  @ViewChild('emojiPickerContainer', { static: false }) emojiPickerContainer!: ElementRef;

  messages$!: Observable<Message[]>;
  newMessage = '';
  editingMessageId: string | null = null;
  editingText = '';
  openMessageMenuId: string | null = null;
  messageMenuDirection: { [uid: string]: 'up' | 'down' } = {};
  currentUserId!: string;
  menuOpen = false;
  showDeleteModal = false;
  isDeleting = false;
  showNewMessageIndicator = false;
  showEmojiPicker = false;
  emojiOnlyRegex = emojiRegex();

  private typingTimeout: any;
  typing$!: Observable<{ [uid: string]: boolean }>;
  participants$!: Observable<Participant[]>;
  otherParticipants$!: Observable<Participant[]>;
  otherParticipants: Participant[] = [];
  messagesWithSender$!: Observable<MessageWithSender[]>;
  groupName: string | null = null;

  showDetailsModal = false;
  showAddPeopleModal = false;

  editingGroupName = false;
  editedGroupName = '';

  selectedParticipantMenu: string | null = null;
  participantMenuDirection: { [uid: string]: 'up' | 'down' } = {};
  menuPosition: { top: number; left: number } | null = null;
  showDeleteMessageModal = false;
  messageToDelete: any = null;

  filteredAddPeople$!: Observable<User[]>;
  addPeopleSearch$ = new BehaviorSubject<string>('');
  addPeopleSearchText = '';
  selectedToAdd = new Set<string>();

  private followingMapSubject = new BehaviorSubject<Set<string>>(new Set());
  followingMap$ = this.followingMapSubject.asObservable();

  private scrollTrigger$ = new BehaviorSubject<void>(undefined);
  private wasNearBottom = true;
  private pendingScroll = false;
  private justSentMessage = false;

  private destroy$ = new Subject<void>();

  constructor(
    private messagesService: MessagesService,
    private auth: Auth,
    private userService: UserService,
    private followService: FollowService
  ) {}

  ngOnChanges() {
    this.menuOpen = false;
    this.showEmojiPicker = false;
    this.selectedParticipantMenu = null;
    this.showDetailsModal = false;
    this.showAddPeopleModal = false;

    if (!this.threadId) {
      this.messages$ = of([]);
      this.participants$ = of([]);
      this.otherParticipants = [];
      return;
    }

    this.currentUserId = this.auth.currentUser?.uid!;
    this.followService.getFollowing(this.currentUserId).subscribe(following => {
      const current = this.followingMapSubject.value;

      // Only update if different
      const newSet = new Set(following.map(f => f.uid));
      if (newSet.size !== current.size ||
          [...newSet].some(uid => !current.has(uid))) {
        this.followingMapSubject.next(newSet);
      }
    });
    this.messages$ = this.messagesService.getMessages(this.threadId).pipe(
      tap((messages: any[]) => {
        const last = messages[messages.length - 1];
        this.wasNearBottom = this.isNearBottom();
        this.pendingScroll = true;

        if (last?.senderId === this.currentUserId) {
          this.justSentMessage = true;
        }
      })
    );
    this.participants$ = this.messagesService.getUserThreads().pipe(
      map(threads => threads.find(t => t.id === this.threadId)),
      switchMap(thread => {
        if (!thread?.participants) return of([]);

        const observables = thread.participants.map(uid =>
          this.userService.getUserByUid(uid).pipe(
            map(user => ({
              uid,
              userId: user?.userId || '',
              username: user?.displayName || user?.username || 'Someone',
              profilePicture: user?.profilePicture || ''
            }))
          )
        );

        return combineLatest(observables);
      })
    );

    this.otherParticipants$ = this.participants$.pipe(
      map(list => list.filter(p => p.uid !== this.currentUserId))
    );

    this.otherParticipants$
      .pipe(takeUntil(this.destroy$))
      .subscribe(participants => {
        this.otherParticipants = participants;
    });

    this.messagesService.getUserThreads().pipe(
      map(threads => threads.find(t => t.id === this.threadId)),
      map(thread => thread?.groupName || null),
      takeUntil(this.destroy$)
    ).subscribe(name => {
      this.groupName = name;
    });

    this.messagesWithSender$ = combineLatest([
      this.messages$,
      this.participants$
    ]).pipe(
      map(([messages, participants]) =>
        messages.map(msg => {
          const participant = participants.find(p => p.uid === msg.senderId);

          return {
            ...msg,
            senderProfilePicture: participant?.profilePicture,
            senderUsername: participant?.username,
            senderUserId: participant?.userId
          };
        })
      )
    );
    this.typing$ = this.messagesService.getTyping(this.threadId);
    this.messagesService.markMessagesAsRead(this.threadId);

    setTimeout(() => {
      requestAnimationFrame(() => {
        this.messageInput?.nativeElement.focus();
        this.scrollToBottom(false);
      });
    });
  }

  ngAfterViewInit() {
    this.scrollTrigger$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
      setTimeout(() => this.scrollToBottom(false));
    });
  }

  ngAfterViewChecked() {
    if (!this.pendingScroll) return;

    this.pendingScroll = false;

    if (this.wasNearBottom || this.justSentMessage) {
      this.scrollToBottom();
      this.showNewMessageIndicator = false;
    } else {
      this.showNewMessageIndicator = true;
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async sendMessage() {
    if (!this.threadId || !this.newMessage.trim()) return;

    await this.messagesService.sendMessage(this.threadId, this.newMessage);

    this.newMessage = '';

    const el = this.messageInput.nativeElement;
    el.style.height = 'auto';
    el.rows = 1;

    await this.messagesService.setTyping(this.threadId, false);

    setTimeout(() => {
      this.scrollToBottom();
      this.justSentMessage = false;
    });
  }

  get headerTitle(): string {
    if (this.groupName) return this.groupName;
    return this.participantsDisplayNames;
  }

  getThreadAvatars() {
    if (!this.otherParticipants) return [];

    if (this.otherParticipants.length === 1) {
      return this.otherParticipants.slice(0, 1);
    }

    if (this.otherParticipants.length === 2) return this.otherParticipants.slice(0, 2);
    if (this.otherParticipants.length === 3) return this.otherParticipants.slice(0, 3);

    return this.otherParticipants.slice(0, 4);
  }

  getAvatarPositionClass(index: number): string {
    const count = this.getThreadAvatars().length;

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

  processMessages(messages: Message[]): MessageWithSender[] {
    return messages.map(msg => {
      const participant = this.otherParticipants.find(p => p.uid === msg.senderId);
      return {
        ...msg,
        senderProfilePicture: participant?.profilePicture,
        senderUsername: participant?.username,
        senderUserId: participant?.userId
      };
    });
  }

  // Returns true if this is the last message from another participant
  isLastFromOther(messages: Message[], index: number): boolean {
    const msg = messages[index];
    if (!msg || msg.senderId === this.currentUserId) return false;

    const next = messages[index + 1];
    if (!next) return true; // last message in thread

    // If next message is from same sender → not last
    return next.senderId !== msg.senderId;
  }

  shouldShowSenderName(messages: Message[], index: number): boolean {
    if (this.otherParticipants.length <= 1) return false;

    const current = messages[index];
    if (current.type === 'system') return false;
    if (current.senderId === this.currentUserId) return false;

    const prev = this.getPrevUserMessage(messages, index);

    if (!prev) return true;

    if (prev.senderId !== current.senderId) return true;

    const currentTime = current.createdAt?.toDate().getTime() || 0;
    const prevTime = prev.createdAt?.toDate().getTime() || 0;

    const diffMinutes = (currentTime - prevTime) / (1000 * 60);

    return diffMinutes > 30;
  }

  getSenderName(msg: Message): string {
    return msg.senderName || 'Someone'; // fallback if senderName not present
  }

  shouldShowTimestamp(messages: Message[], index: number): boolean {
    const current = messages[index];
    if (!current?.createdAt) return false;

    const next = messages[index + 1];
    if (!next?.createdAt) return true; // if next is missing, show timestamp

    // Always show timestamp for the last message in the thread
    if (!next) return true;

    // Check if next message is from a different sender → show timestamp
    //if (next.senderId !== current.senderId) return true;

    // Check time gap with next message
    const currentTime = current.createdAt.toDate().getTime();
    const nextTime = next.createdAt.toDate().getTime();
    const diffMinutes = (nextTime - currentTime) / (1000 * 60);

    const minGap = 30; // minutes threshold for timestamp
    return diffMinutes > minGap;
  }

  shouldShowDateSeparator(messages: Message[], index: number): boolean {
    if (index === 0) return true;

    const prev = messages[index - 1];
    const current = messages[index];

    if (!prev?.createdAt || !current?.createdAt) return false;

    const prevDate = prev.createdAt.toDate();
    const currentDate = current.createdAt.toDate();

    return prevDate.toDateString() !== currentDate.toDateString();
  }

  formatDateSeparator(timestamp: any): string {
    if (!timestamp) return '';

    const date = timestamp.toDate(); // Firebase Timestamp → JS Date
    const now = new Date();

    const isSameYear = date.getFullYear() === now.getFullYear();

    // Helper to format time
    const timeString = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // Helper to compare only the date (ignore time)
    const isSameDate = (d1: Date, d2: Date) =>
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate();

    // Today
    if (isSameDate(date, now)) return `Today • ${timeString}`;

    // Yesterday
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (isSameDate(date, yesterday)) return `Yesterday • ${timeString}`;

    // Within last 7 days
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays < 7) {
      const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
      return `${weekday} • ${timeString}`;
    }

    // Older than a week
    const fullDate = date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      ...(isSameYear ? {} : { year: 'numeric' })
    });
    return `${fullDate} • ${timeString}`;
  }

  getPrevUserMessage(messages: Message[], index: number): Message | null {
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].type !== 'system') {
        return messages[i];
      }
    }
    return null;
  }

  getNextUserMessage(messages: Message[], index: number): Message | null {
    for (let i = index + 1; i < messages.length; i++) {
      if (messages[i].type !== 'system') {
        return messages[i];
      }
    }
    return null;
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

  onInputChange(event: Event) {
    this.autoResize();

    if (!this.threadId) return;

    const value = (event.target as HTMLTextAreaElement).value;

    // User is typing
    this.messagesService.setTyping(this.threadId, value.length > 0);

    // Auto-stop typing after 2 seconds idle
    clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      this.messagesService.setTyping(this.threadId!, false);
    }, 2000);
  }

  autoResize() {
    const el = this.messageInput.nativeElement;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  scrollToBottom(force = true) {
    try {
      const el = this.scrollContainer.nativeElement;
      el.scrollTo({
        top: el.scrollHeight,
        behavior: force ? 'smooth' : 'auto'
      });
    } catch {}
  }

  isNearBottom(): boolean {
    const el = this.scrollContainer.nativeElement;

    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  onScroll() {
    this.wasNearBottom = this.isNearBottom();

    if (this.wasNearBottom) {
      this.showNewMessageIndicator = false;
    }
  }

  scrollToBottomAndClearIndicator() {
    this.scrollToBottom(true);
    this.showNewMessageIndicator = false;
  }

  // Determines if the current message should visually group with the previous message
  shouldGroupWithPrevious(messages: Message[], index: number): boolean {
    const current = messages[index];
    if (index === 0 || current.type === 'system') return false;

    const prev = this.getPrevUserMessage(messages, index);
    if (!prev) return false;

    const sameSender = prev.senderId === current.senderId;

    const prevTime = prev.createdAt.toDate().getTime();
    const currentTime = current.createdAt.toDate().getTime();

    const diffMinutes = (currentTime - prevTime) / (1000 * 60);

    return sameSender && diffMinutes <= 30;
  }

  // Determines if the bottom of the message bubble should be rounded
  shouldRoundBottom(messages: Message[], index: number): boolean {
    const current = messages[index];
    if (current.type === 'system') return true;

    const next = this.getNextUserMessage(messages, index);
    if (!next) return true;

    const sameSender = next.senderId === current.senderId;

    const currentTime = current.createdAt.toDate().getTime();
    const nextTime = next.createdAt.toDate().getTime();

    const diffMinutes = (nextTime - currentTime) / (1000 * 60);

    return !sameSender || diffMinutes > 30;
  }

  getBubbleClasses(msg: Message, messages: Message[], i: number): string {
    const { isEmojiOnly, count } = this.getEmojiInfo(msg.text);

    if (isEmojiOnly) {
      let sizeClass = 'text-3xl'; // default

      if (count <= 2) sizeClass = 'text-4xl';
      else if (count <= 4) sizeClass = 'text-3xl';
      else sizeClass = 'text-2xl';

      return `bg-transparent px-0 py-0 inline-block ${sizeClass} text-center`;
    }

    const topRounded = !this.shouldGroupWithPrevious(messages, i);
    const bottomRounded = this.shouldRoundBottom(messages, i);

    let classes = 'inline-block px-3 py-2 ';

    if (msg.senderId === this.currentUserId) {
      // Outgoing (blue)
      classes += 'bg-blue-500 text-white ';
      classes += topRounded ? 'rounded-tr-2xl ' : 'rounded-tr-sm ';
      classes += bottomRounded ? 'rounded-br-2xl ' : 'rounded-br-sm ';
      classes += 'rounded-tl-2xl rounded-bl-2xl';
    } else {
      // Incoming (gray)
      classes += 'bg-gray-200 text-gray-800 ';
      classes += topRounded ? 'rounded-tl-2xl ' : 'rounded-tl-sm ';
      classes += bottomRounded ? 'rounded-bl-2xl ' : 'rounded-bl-sm ';
      classes += 'rounded-tr-2xl rounded-br-2xl';
    }

    return classes;
  }

  getMessageSpacing(messages: any[], i: number): string {
    if (i === 0) return 'mt-3';

    const current = messages[i];
    const prev = messages[i - 1];

    const sameSender = current.senderId === prev.senderId;

    const diff =
      current.createdAt?.toMillis() - prev.createdAt?.toMillis();

    const withinWindow = diff < 30 * 60 * 1000;

    if (sameSender && withinWindow) {
      return 'mt-[2px]'; // tight grouping
    }

    return 'mt-3'; // new group
  }

  isOtherUserTyping(typing: { [uid: string]: boolean } | null): boolean {
    if (!typing) return false;

    return Object.entries(typing).some(
      ([uid, isTyping]) => uid !== this.currentUserId && isTyping
    );
  }

  getTypingText(
    typing: { [uid: string]: boolean },
    participants: { uid: string; username: string }[]
  ): string {
    const typingUsers = Object.entries(typing)
      .filter(([uid, isTyping]) => uid !== this.currentUserId && isTyping)
      .map(([uid]) => {
        const user = participants.find(p => p.uid === uid);
        return user?.username || 'Someone';
      });

    if (typingUsers.length === 0) return '';

    if (typingUsers.length === 1) {
      return `${typingUsers[0]} is typing`;
    }

    if (typingUsers.length === 2) {
      return `${typingUsers[0]} and ${typingUsers[1]} are typing`;
    }

    return `${typingUsers[0]} and others are typing`;
  }

  addEmoji(event: any) {
    const emoji = event.emoji.native;
    const input = this.messageInput.nativeElement;
    const start = input.selectionStart;
    const end = input.selectionEnd;

    // Direct DOM manipulation only
    input.value = input.value.substring(0, start) + emoji + input.value.substring(end);

    // Restore cursor
    input.selectionStart = input.selectionEnd = start + emoji.length;

    // Manually update ngModel AFTER DOM update using setTimeout
    setTimeout(() => {
      this.newMessage = input.value;
    }, 0);

    // Keep focus
    input.focus({ preventScroll: true });
  }

  isEmojiOnly(msg: string): boolean {
    if (!msg) return false;
    // Remove whitespace and check if only emojis remain
    return this.emojiOnlyRegex.test(msg.trim());
  }

  getEmojiInfo(msg: string): { isEmojiOnly: boolean; count: number } {
    if (!msg) return { isEmojiOnly: false, count: 0 };

    const emojis = msg.match(this.emojiOnlyRegex) || [];
    const textWithoutEmojis = msg.replace(this.emojiOnlyRegex, '').trim();

    return { 
      isEmojiOnly: textWithoutEmojis.length === 0 && emojis.length > 0,
      count: emojis.length
    };
  }

  toggleEmojiPicker(event: Event) {
    event.stopPropagation();
    this.showEmojiPicker = !this.showEmojiPicker;

    this.messageInput.nativeElement.focus({ preventScroll: true });
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: Event) {
    const target = event.target as HTMLElement;

    this.menuOpen = false;

    // Close participant menu
    if (this.selectedParticipantMenu) {
      // Find the participant menu element
      const menuEl = document.getElementById(`participant-menu-${this.selectedParticipantMenu}`);
      if (!menuEl?.contains(target)) {
        this.selectedParticipantMenu = null;
      }
    }

    // Close emoji picker
    const clickedInsideEmojiContainer =
    this.emojiPickerContainer?.nativeElement.contains(target);
    const clickedInsidePicker = target.closest('emoji-mart') !== null;
    const clickedDetailsButton = this.detailsButton?.nativeElement.contains(target);

    if (!clickedInsideEmojiContainer && !clickedInsidePicker && !clickedDetailsButton) {
      this.showEmojiPicker = false;
    }

    const clickedInsideMessageMenu = target.closest('.message-menu');

    if (!clickedInsideMessageMenu) {
      this.openMessageMenuId = null;
    }
  }

  get participantsDisplayNames(): string {
    if (this.otherParticipants.length === 1) {
      return this.otherParticipants[0].username;
    }
    return this.otherParticipants.map(p => p.username).join(', ');
  }

  toggleMenu(event: Event) {
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;

    if (this.menuOpen) {
      this.showEmojiPicker = false;
    }
  }

  onDeleteThread(event: Event) {
    event.stopPropagation();
    this.menuOpen = false;
    this.showDeleteModal = true;
  }

  async confirmDeleteThread() {
    if (!this.threadId || this.isDeleting) return;

    this.isDeleting = true;

    await this.messagesService.deleteThread(this.threadId);

    this.threadDeleted.emit();
    this.showDeleteModal = false;
    this.isDeleting = false;
  }

  cancelDeleteThread() {
    this.showDeleteModal = false;
  }

  openDetails(event: Event) {
    event.stopPropagation();
    this.menuOpen = false;
    this.showDetailsModal = true;
    this.editedGroupName = this.groupName || '';
    this.showEmojiPicker = false;
  }

  toggleParticipantMenu(uid: string, event: Event) {
    event.stopPropagation();

    const buttonEl = event.currentTarget as HTMLElement;

    // Determine direction before opening
    const shouldOpenUp = this.isNearBottomOfModal(buttonEl);

    this.participantMenuDirection[uid] = shouldOpenUp ? 'up' : 'down';

    this.selectedParticipantMenu =
      this.selectedParticipantMenu === uid ? null : uid;
  }

  editGroupName() {
    this.editedGroupName = this.groupName || '';
    this.editingGroupName = true;
  }

  async saveGroupName() {
    if (!this.threadId) return;

    this.groupName = this.editedGroupName;
    this.editingGroupName = false;
    await this.messagesService.updateGroupName(this.threadId, this.editedGroupName);
  }

  closeGroupName() {
    this.editedGroupName = '';
    this.editingGroupName = false;
  }

  async removeFromGroup(uid: string) {
    if (!this.threadId) return;

    await this.messagesService.removeParticipant(this.threadId, uid);
    this.selectedParticipantMenu = null;
  }

  async leaveGroup() {
    const currentUid = this.auth.currentUser?.uid;
    if (!this.threadId || !currentUid) return;

    await this.messagesService.removeParticipant(this.threadId, currentUid);
    this.showDetailsModal = false;
    this.threadDeleted.emit();
  }

  async closeModal() {
    this.editedGroupName = '';
    this.editingGroupName = false;
    this.showDetailsModal = false;
  }

  openAddPeople() {
    this.showAddPeopleModal = true;
    this.selectedToAdd.clear();
    this.addPeopleSearchText = '';
    this.addPeopleSearch$.next('');
    this.initAddPeopleStream();
  }

  initAddPeopleStream() {
    const existingUids = new Set([
      this.currentUserId,
      ...this.otherParticipants.map(p => p.uid)
    ]);

    this.filteredAddPeople$ = this.getFollowingUsers().pipe(
      switchMap(users =>
        this.addPeopleSearch$.pipe(
          map(search =>
            users
              // remove existing participants
              .filter(u => u.uid && !existingUids.has(u.uid))
              // search filter
              .filter(u =>
                (u.displayName || u.username || '')
                  .toLowerCase()
                  .includes(search.toLowerCase())
              )
          )
        )
      )
    );
  }

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

  toggleAddUser(user: User) {
    if (!user.uid) return;

    this.selectedToAdd.has(user.uid)
      ? this.selectedToAdd.delete(user.uid)
      : this.selectedToAdd.add(user.uid);
  }

  async addSelectedUsers() {
    if (!this.threadId || this.selectedToAdd.size === 0) return;

    const newUsers = Array.from(this.selectedToAdd);

    const isOneOnOne = this.otherParticipants.length === 1;

    if (isOneOnOne) {
      // Create new group thread
      const existingIds = this.otherParticipants.map(p => p.uid);

      const newThreadId = await this.messagesService.createGroupFromThread(
        existingIds,
        newUsers,
        this.editedGroupName || ''
      );

      // Switch to new thread
      this.threadChanged.emit(newThreadId);
      this.showDetailsModal = false;
    } else {
      // If normal group, just add people
      await this.messagesService.addParticipants(
        this.threadId,
        newUsers
      );
    }

    this.selectedToAdd.clear();
    this.showAddPeopleModal = false;
    this.editedGroupName = '';
  }

  async toggleFollow(uid: string, isFollowing: boolean) {
    if (!this.currentUserId || !uid) return;

    // Close menu immediately
    this.selectedParticipantMenu = null;

    // Get current state
    const currentSet = new Set(this.followingMapSubject.value);

    // Optimistic update
    if (isFollowing) {
      currentSet.delete(uid);
    } else {
      currentSet.add(uid);
    }

    // Instant UI update
    this.followingMapSubject.next(currentSet);

    try {
      if (isFollowing) {
        await this.followService.unfollowUser(this.currentUserId, uid);
      } else {
        await this.followService.followUser(this.currentUserId, uid);
      }
    } catch (err) {
      // Rollback if failed
      const rollbackSet = new Set(this.followingMapSubject.value);

      if (isFollowing) {
        rollbackSet.add(uid);
      } else {
        rollbackSet.delete(uid);
      }

      this.followingMapSubject.next(rollbackSet);
      console.error(err);
    }
  }

  isNearBottomOfModal(element: HTMLElement): boolean {
    const modal = element.closest('.overflow-y-auto'); // scroll container
    if (!modal) return false;

    const rect = element.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();

    const spaceBelow = modalRect.bottom - rect.bottom;

    return spaceBelow < 80; // threshold (adjust if needed)
  }

  startEdit(message: any) {
    this.openMessageMenuId = null;
    this.editingMessageId = message.id;
    this.editingText = message.text;

    setTimeout(() => {
      const el = this.editBox?.nativeElement;
      if (!el) return;

      el.style.height = 'auto';

      requestAnimationFrame(() => {
        el.style.height = `${el.scrollHeight}px`;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    });
  }

  saveEdit(threadId: string, message: any) {
    this.messagesService.editMessage(threadId, message.id, this.editingText);
    this.editingMessageId = null;
  }

  cancelEdit() {
    this.editingMessageId = null;
    this.editingText = '';
  }

  autoResizeEdit(event: Event) {
    const el = event.target as HTMLTextAreaElement;

    requestAnimationFrame(() => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    });
  }

  getEditedLabelClass(msg: any): string {
    if (msg.isDeleted) return '';

    const { isEmojiOnly } = this.getEmojiInfo(msg.text);

    // Emoji-only messages: always subtle gray (no dependency on background)
    if (isEmojiOnly) {
      return 'text-gray-500 text-[0.65rem] ml-1';
    }

    // Normal messages
    return msg.senderId === this.currentUserId
      ? 'text-white/80 text-[0.65rem] ml-1'
      : 'text-gray-500 text-[0.65rem] ml-1';
  }

  confirmDelete(message: any) {
    this.openMessageMenuId = null;
    this.messageToDelete = message;
    this.showDeleteMessageModal = true;
  }

  confirmDeleteMessage() {
    if (!this.threadId || !this.messageToDelete) return;

    this.messagesService.deleteMessage(
      this.threadId,
      this.messageToDelete.id
    );

    this.messageToDelete = null;
    this.showDeleteMessageModal = false;
  }

  cancelDeleteMessage() {
    this.messageToDelete = null;
    this.showDeleteMessageModal = false;
  }

  truncateMessage(text: string, maxLength = 50): string {
    if (!text) return '';

    return text.length > maxLength
      ? text.slice(0, maxLength) + '…'
      : text;
  }

  getDeleteMessageText(): string {
    const text = this.truncateMessage(this.messageToDelete?.text || '');

    const preview = text ? `"${text}"` : 'This message';

    return `${preview}\n\nThis can't be undone.`;
  }

  getDeletePreview(msg: string) {
    if (!msg) return { isEmojiOnly: false, text: '', count: 0 };

    const info = this.getEmojiInfo(msg);

    return {
      isEmojiOnly: info.isEmojiOnly,
      count: info.count,
      text: msg
    };
  }

  getEmojiSizeClass(text: string): string {
    const emojis = Array.from(text.trim()); // better Unicode handling
    const count = emojis.length;

    if (count <= 2) return 'text-4xl';
    if (count <= 4) return 'text-3xl';
    return 'text-2xl';
  }

  toggleMessageMenu(id: string, event: Event) {
    event.stopPropagation();

    const buttonEl = event.currentTarget as HTMLElement;

    // Determine direction before opening
    const shouldOpenUp = this.isNearBottomOfModal(buttonEl);

    this.messageMenuDirection[id] = shouldOpenUp ? 'up' : 'down';
    this.openMessageMenuId = this.openMessageMenuId === id ? null : id;
  }
}