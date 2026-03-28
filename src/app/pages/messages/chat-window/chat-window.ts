import { Component, ElementRef, HostListener, Input, OnChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import { UserService } from '../../../services/user.service';
import { MessagesService } from '../../../services/messages.service';
import { Message } from '../../../models/messages.model';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';
import emojiRegex from 'emoji-regex';
import { Observable, tap, combineLatest, map, switchMap, of } from 'rxjs';


@Component({
  selector: 'app-chat-window',
  standalone: true,
  imports: [CommonModule, FormsModule, PickerComponent],
  templateUrl: './chat-window.html'
})
export class ChatWindow implements OnChanges {
  @Input() threadId: string | null = null;
  
  @ViewChild('messageInput') messageInput!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('emojiPickerContainer', { static: false }) emojiPickerContainer!: ElementRef;

  messages$!: Observable<Message[]>;
  newMessage = '';
  currentUserId!: string;
  showNewMessageIndicator = false;
  showEmojiPicker = false;
  emojiOnlyRegex = emojiRegex();

  private typingTimeout: any;
  typing$!: Observable<{ [uid: string]: boolean }>;
  participants$!: Observable<{ uid: string; username: string }[]>;

  constructor(
    private messagesService: MessagesService,
    private auth: Auth,
    private userService: UserService
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
    this.participants$ = this.messagesService.getUserThreads().pipe(
      map(threads => threads.find(t => t.id === this.threadId)),
      switchMap(thread => {
        if (!thread?.participants) return of([]);

        const observables = thread.participants.map(uid =>
          this.userService.getUserByUid(uid).pipe(
            map(user => ({
              uid,
              username: user?.displayName || user?.username || 'Someone'
            }))
          )
        );

        return combineLatest(observables);
      })
    );
    this.typing$ = this.messagesService.getTyping(this.threadId);
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

    await this.messagesService.setTyping(this.threadId, false);

    setTimeout(() => this.scrollToBottom());
  }

  shouldShowTimestamp(messages: Message[], index: number): boolean {
    const current = messages[index];
    if (!current?.createdAt) return false;

    const next = messages[index + 1];

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
      year: 'numeric'
    });
    return `${fullDate} • ${timeString}`;
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

  // Determines if the current message should visually group with the previous message
  shouldGroupWithPrevious(messages: Message[], index: number): boolean {
    if (index === 0) return false;

    const prev = messages[index - 1];
    const current = messages[index];

    if (!prev?.createdAt || !current?.createdAt) return false;

    const sameSender = prev.senderId === current.senderId;

    // Calculate time difference in minutes
    const prevTime = prev.createdAt.toDate().getTime();
    const currentTime = current.createdAt.toDate().getTime();
    const diffMinutes = (currentTime - prevTime) / (1000 * 60);

    const maxGap = 30; // maximum minutes to consider grouping
    return sameSender && diffMinutes <= maxGap;
  }

  // Determines if the bottom of the message bubble should be rounded
  shouldRoundBottom(messages: Message[], index: number): boolean {
    if (index === messages.length - 1) return true; // last message in thread

    const next = messages[index + 1];
    const current = messages[index];

    if (!next?.createdAt || !current?.createdAt) return true;

    const sameSender = next.senderId === current.senderId;

    // Calculate time difference in minutes
    const currentTime = current.createdAt.toDate().getTime();
    const nextTime = next.createdAt.toDate().getTime();
    const diffMinutes = (nextTime - currentTime) / (1000 * 60);

    const maxGap = 30; // maximum minutes to keep bubble connected
    return !sameSender || diffMinutes > maxGap ? true : false;
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
    event.stopPropagation(); // Prevent document click
    this.showEmojiPicker = !this.showEmojiPicker;

    this.messageInput.nativeElement.focus({ preventScroll: true });
  }

  // Close picker when clicking outside
  @HostListener('document:click', ['$event'])
  handleClickOutside(event: Event) {
    const clickedInside = this.emojiPickerContainer?.nativeElement.contains(event.target);
    if (!clickedInside) {
      this.showEmojiPicker = false;
    }
  }
}