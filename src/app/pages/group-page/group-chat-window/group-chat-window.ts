import { Component, ElementRef, HostListener, Input, OnChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import { Group, GroupMember, GroupsService } from '../../../services/groups.service';
import { MessagesService } from '../../../services/messages.service';
import { Message } from '../../../models/messages.model';
import { UserService } from '../../../services/user.service';
import { Avatar } from '../../../components/avatar/avatar';
import { ConfirmModal } from "../../../components/confirm-modal/confirm-modal";
import { PickerComponent } from '@ctrl/ngx-emoji-mart';
import emojiRegex from 'emoji-regex';
import { Observable, of, map, combineLatest, switchMap, tap, Subject, takeUntil } from 'rxjs';

interface MessageWithSender extends Message {
  senderProfilePicture?: string;
  senderUsername?: string;
  senderUserId?: string;
  senderRole?: string;
}

interface Participant {
  uid: string;
  username: string;
  userId: string;
  profilePicture: string;
}

@Component({
  selector: 'app-group-chat-window',
  standalone: true,
  imports: [CommonModule, FormsModule, Avatar, ConfirmModal, PickerComponent],
  templateUrl: './group-chat-window.html',
  styleUrl: './group-chat-window.css',
})
export class GroupChatWindow implements OnChanges {
  @Input() groupId!: string;

  @ViewChild('messageInput') messageInput!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('editBox') editBox!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('emojiButton', { static: false }) emojiButton!: ElementRef;
  @ViewChild('emojiPickerContainer', { static: false }) emojiPickerContainer!: ElementRef;

  group$!: Observable<Group | null>;
  members$!: Observable<any[]>;
  membersWithProfile$!: Observable<any[]>;
  currentUserRole$!: Observable<string>;
  messages$!: Observable<MessageWithSender[]>;
  newMessage = '';
  editingMessageId: string | null = null;
  editingText = '';
  openMessageMenuId: string | null = null;
  messageMenuDirection: { [uid: string]: 'up' | 'down' } = {};

  menuOpen = false;
  showDeleteModal = false;
  isDeleting = false;
  showNewMessageIndicator = false;
  showEmojiPicker = false;
  emojiPickerPosition = { top: 0, left: 0 };
  emojiOnlyRegex = emojiRegex();
  currentUserId!: string;

  wasNearBottom = true;
  pendingScroll = false;
  justSentMessage = false;

  private typingTimeout: any;
  typing$!: Observable<{ [uid: string]: boolean }>;
  participants$!: Observable<Participant[]>;
  otherParticipants$!: Observable<Participant[]>;
  otherParticipants: Participant[] = [];
  private participantMap = new Map<string, string>();

  showDeleteMessageModal = false;
  messageToDelete: any = null;

  private destroy$ = new Subject<void>();

  constructor(
    private groupsService: GroupsService,
    private messagesService: MessagesService,
    private userService: UserService,
    private auth: Auth
  ) {}

  ngOnChanges() {
    this.destroy$.next(); // cancel previous subscriptions
    this.destroy$ = new Subject<void>();
    if (!this.groupId) return;

    this.currentUserId = this.auth.currentUser?.uid ?? '';
    if (!this.currentUserId) return;

    this.group$ = this.groupsService.getGroup(this.groupId).pipe(
      takeUntil(this.destroy$)
    );
    
    this.members$ = this.groupsService.getMembers(this.groupId);

    this.currentUserRole$ = this.members$.pipe(
      map((members: GroupMember[]) => {
        const me = members.find(m => m.uid === this.currentUserId);
        return me?.role || 'member';
      })
    );

    this.membersWithProfile$ = this.members$.pipe(
      switchMap((members: GroupMember[]) => {
        if (!members.length) return of([]);

        return combineLatest(
          members.map(member =>
            this.userService.getUserByUid(member.uid).pipe(
              map(user => ({
                uid: member.uid,
                username: user?.displayName || user?.username || 'Unknown',
                userId: user?.userId || '',
                profilePicture: user?.profilePicture || ''
              }))
            )
          )
        ).pipe(
          map(users => users.filter(Boolean))
        );
      })
    );

    this.participants$ = this.membersWithProfile$;

    this.participants$.subscribe(participants => {
      this.participantMap = new Map(
        participants.map(p => [p.uid, p.username])
      );
    });

    this.otherParticipants$ = this.participants$.pipe(
      map(participants =>
        participants.filter(p => p.uid !== this.currentUserId)
      )
    );

    const rawMessages$ = this.messagesService.getGroupMessages(this.groupId);

    const userMap$ = this.members$.pipe(
      switchMap((members: GroupMember[]) => {
        if (!members.length) return of(new Map<string, any>());

        return combineLatest(
          members.map(member =>
            this.userService.getUserByUid(member.uid).pipe(
              map(user => ({
                uid: member.uid,
                username: user?.displayName || user?.username || 'Unknown',
                profilePicture: user?.profilePicture || '',
                userId: user?.userId || '',
                role: member.role
              }))
            )
          )
        ).pipe(
          map(users =>
            new Map(users.map(u => [u.uid, u]))
          )
        );
      })
    );

    this.messages$ = combineLatest([rawMessages$, userMap$]).pipe(
      map(([messages, userMap]) =>
        messages.map(msg => {
          const user = userMap.get(msg.senderId);

          return {
            ...msg,
            senderProfilePicture: user?.profilePicture || '',
            senderUsername: user?.username || 'Unknown',
            senderUserId: user?.userId || '',
            senderRole: user?.role || 'member'
          };
        })
      ),
      tap((messages) => {
        const last = messages[messages.length - 1];

        this.wasNearBottom = this.isNearBottom?.() ?? true;
        this.pendingScroll = true;

        if (last?.senderId === this.currentUserId) {
          this.justSentMessage = true;
        }
      })
    );

    this.typing$ = this.messagesService.getGroupTyping(this.groupId);
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
    if (!this.groupId || !this.newMessage.trim()) return;

    await this.messagesService.sendGroupMessage(this.groupId, this.newMessage);

    this.newMessage = '';

    const el = this.messageInput.nativeElement;
    el.style.height = 'auto';
    el.rows = 1;

    await this.messagesService.setGroupTyping(this.groupId, false);

    setTimeout(() => {
      this.scrollToBottom();
      this.justSentMessage = false;
    });
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

  scrollToBottom(force = true) {
    try {
      const el = this.scrollContainer.nativeElement;
      el.scrollTo({
        top: el.scrollHeight,
        behavior: force ? 'smooth' : 'auto'
      });
    } catch {}
  }

  // ─────────────────────────────
  // Message grouping logic (from ChatWindow)
  // ─────────────────────────────

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

  getNextUserMessage(messages: Message[], index: number): Message | null {
    for (let i = index + 1; i < messages.length; i++) {
      if (messages[i].type !== 'system') {
        return messages[i];
      }
    }
    return null;
  }

  getPrevUserMessage(messages: Message[], index: number): Message | null {
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].type !== 'system') return messages[i];
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

    if (!this.groupId) return;

    const value = (event.target as HTMLTextAreaElement).value;

    this.triggerTyping(value);
  }

  private triggerTyping(value: string) {
    if (!this.groupId) return;

    this.messagesService.setGroupTyping(this.groupId, value.length > 0);

    clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      this.messagesService.setGroupTyping(this.groupId!, false);
    }, 2000);
  }

  autoResize() {
    const el = this.messageInput.nativeElement;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  // ─────────────────────────────
  // UI helpers
  // ─────────────────────────────

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

    if (current.type === 'system') {
      return 'mt-[2px]';
    }

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
  
  shouldShowSenderName(messages: Message[], index: number): boolean {
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

  isOtherUserTyping(typing: { [uid: string]: boolean } | null): boolean {
    if (!typing) return false;

    return Object.entries(typing).some(
      ([uid, isTyping]) => isTyping && uid !== this.currentUserId 
    );
  }

  getTypingText(typing: { [uid: string]: boolean }, participants: Participant[]): string {
    const typingUsers = Object.entries(typing)
    .filter(([uid, isTyping]) => isTyping && uid !== this.currentUserId )
    .map(([uid]) => this.participantMap.get(uid) || 'Someone');

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

    input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
    input.selectionStart = input.selectionEnd = start + emoji.length;

    setTimeout(() => {
      this.newMessage = input.value;
      this.triggerTyping(this.newMessage || ' ');
    }, 0);

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

    if (!this.showEmojiPicker) {
      const rect = this.emojiButton.nativeElement.getBoundingClientRect();

      const pickerHeight = 435; // place above button (adjust as needed)
      const pickerWidth = 330; // align right edge (adjust width)

      this.emojiPickerPosition = {
        top: Math.max(10, rect.top - pickerHeight),
        left: Math.max(10, rect.right - pickerWidth)
      };
    }

    this.showEmojiPicker = !this.showEmojiPicker;

    this.messageInput.nativeElement.focus({ preventScroll: true });
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: Event) {
    const target = event.target as HTMLElement;

    // Close emoji picker
    const clickedInsideEmojiContainer =
    this.emojiPickerContainer?.nativeElement.contains(target);
    const clickedInsidePicker = target.closest('emoji-mart') !== null;

    if (!clickedInsideEmojiContainer && !clickedInsidePicker) {
      this.showEmojiPicker = false;
    }

    const clickedInsideMessageMenu = target.closest('.message-menu');

    if (!clickedInsideMessageMenu) {
      this.openMessageMenuId = null;
    }
  }

  isNearScrollBottom(element: HTMLElement): boolean {
    const scrollContainer = element.closest('.overflow-y-auto'); // scroll container
    if (!scrollContainer) return false;

    const rect = element.getBoundingClientRect();
    const modalRect = scrollContainer.getBoundingClientRect();

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
    this.messagesService.editGroupMessage(threadId, message.id, this.editingText);
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
    if (!this.groupId || !this.messageToDelete) return;

    this.messagesService.deleteGroupMessage(
      this.groupId,
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
    const shouldOpenUp = this.isNearScrollBottom(buttonEl);

    this.messageMenuDirection[id] = shouldOpenUp ? 'up' : 'down';
    this.openMessageMenuId = this.openMessageMenuId === id ? null : id;
  }
}