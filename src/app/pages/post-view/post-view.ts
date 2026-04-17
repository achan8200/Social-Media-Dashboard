import { Component, Input, ViewChild, ViewChildren, QueryList, ElementRef, HostListener, AfterViewInit, ChangeDetectionStrategy, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import { PostsService } from '../../services/posts.service';
import { Post, PostMedia } from '../../models/post.model';
import { UserService } from '../../services/user.service';
import { ConfirmModal } from '../../components/confirm-modal/confirm-modal';
import { EditPostModal } from '../../components/edit-post-modal/edit-post-modal';
import { Comment, CommentWithLikes } from '../../models/comment.model';
import { Avatar } from '../../components/avatar/avatar';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';
import { formatPostTimestamp } from '../../utils/date';
import { BehaviorSubject, combineLatest, map, Observable, of, shareReplay, switchMap } from 'rxjs';

@Component({
  selector: 'app-post-view',
  standalone: true,
  imports: [CommonModule, Avatar, ConfirmModal, EditPostModal, FormsModule, RouterModule, PickerComponent],
  templateUrl: './post-view.html',
  styleUrls: ['./post-view.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PostView implements AfterViewInit {
  @Input() post: Post | null = null;

  username$: Observable<string> = of('Unknown');
  displayName$: Observable<string> = of('Unknown');
  userAvatar$: Observable<string | null> = of(null);
  userId$: Observable<string> = of('');

  selectedPostToDelete: Post | null = null;
  editingPost: Post | null = null;

  animatingLike = false;

  timestamp$!: Observable<string>;
  captionSubject = new BehaviorSubject<string>('');
  caption$ = this.captionSubject.asObservable();
  liked$!: Observable<boolean>;
  likesCount$!: Observable<number>;
  commentsCount$!: Observable<number>;
  commentsSubject = new BehaviorSubject<CommentWithLikes[]>([]);
  comments$ = this.commentsSubject.asObservable();
  
  newComment = '';
  editingCommentId: string | null = null;
  editingText = '';
  private commentToHighlight: string | null = null;

  animatingCommentLike: Record<string, boolean> = {};

  currentMediaIndex = 0;
  
  menuOpen = false;
  copied = false;
  openCommentMenuId: string | null = null;
  commentMenuDirection: Record<string, 'up' | 'down'> = {};
  showNewCommentsButton = false;
  showEmojiPicker = false;
  emojiPickerPosition = { top: 0, left: 0 };

  private touchStartX = 0;
  private touchEndX = 0;

  isDragging = false;
  startX = 0;
  currentTranslate = 0;
  previousTranslate = 0;
  animationFrameId: number | null = null;
  lastDragTime = 0;
  lastDragX = 0;
  velocity = 0;

  currentMediaAspect = 1;

  private initialized = false;

  @ViewChild('carouselContainer') carouselContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('commentsContainer') commentsContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('newCommentInput') newCommentInput!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('commentInput') commentInput!: ElementRef<HTMLTextAreaElement>;
  @ViewChildren('videoPlayer') videoPlayers!: QueryList<ElementRef<HTMLVideoElement>>;
  @ViewChildren('commentElement', { read: ElementRef }) commentElements!: QueryList<ElementRef<HTMLDivElement>>;
  @ViewChild('emojiButton', { static: false }) emojiButton!: ElementRef;
  @ViewChild('emojiPickerContainer', { static: false }) emojiPickerContainer!: ElementRef;

  constructor(
    private postsService: PostsService, 
    private userService: UserService, 
    public auth: Auth, 
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit() {
    this.route.paramMap.pipe(
      map(params => {
        const postId = params.get('postId');
        return postId;
      }),
      switchMap(postId => {
        if (!postId) return of(null);
        return this.postsService.getPostById(postId);
      })
    ).subscribe(post => {
      this.post = post;
      if (post) {
        this.setupPost();
        this.setupComments();

        this.captionSubject.next(this.formatCaption(post.caption ?? ''));
      }
      this.cdr.markForCheck();
    });

    // Capture optional commentId for highlighting
    this.route.queryParamMap.subscribe(params => {
      const commentId = params.get('comment');
      if (commentId) {
        // Save it; we'll highlight once comments are ready
        this.commentToHighlight = commentId;
      }
    });
  }

  private setupPost() {
    if (!this.post || this.initialized) return;

    this.initialized = true;

    if (this.post?.uid) {
      const user$ = this.userService.getUserByUid(this.post.uid);
      this.username$ = user$.pipe(map(u => u?.username || 'Unknown'));
      this.displayName$ = user$.pipe(map(u => u?.displayName || 'Unknown'));
      this.userAvatar$ = user$.pipe(map(u => u?.profilePicture || null));
      this.userId$ = user$.pipe(map(u => u?.userId || ''));
    }

    const media = this.post?.media ?? [];

    if (media?.length > 0) this.preloadMedia(media[0]);
    if (media?.length > 1) this.preloadMedia(media[1]);

    this.timestamp$ = of(this.post).pipe(
      map(post => this.formatPostTimestamp(post?.createdAt))
    );

    this.liked$ = this.postsService.getPostLike(this.post.id).pipe(
      shareReplay(1)
    );

    this.likesCount$ = this.postsService.getPostLikesCount(this.post.id).pipe(
      shareReplay(1)
    );

    setTimeout(() => {
      this.currentMediaIndex = 0;
      this.setPositionByIndex();
      this.updateMediaAspect();
    });
  }

  private setupComments() {
    if (!this.post) return;

    // Subscribe once to Firestore comments
    this.postsService.getComments(this.post.id).subscribe(comments => {
      const enriched = comments.map(c => ({
        ...c,
        username$: this.userService.getUserByUid(c.uid).pipe(map(u => u?.username ?? 'Unknown')),
        userAvatar$: this.userService.getUserByUid(c.uid).pipe(map(u => u?.profilePicture ?? null)),
        liked$: this.postsService.getCommentLike(this.post!.id, c.id!),
      }));
      this.commentsSubject.next(enriched);

      if (this.commentToHighlight) {
        this.highlightComment(this.commentToHighlight);
        this.commentToHighlight = null;
      }
    });

    // Stable commentsCount$
    this.commentsCount$ = this.comments$.pipe(
      map(comments => comments.length),
      shareReplay(1)
    );
  }

  ngAfterViewInit() {
    this.comments$?.subscribe(() => {
      this.scrollCommentsToBottom();
    });
  }

  get currentMedia(): PostMedia | null {
    if (!this.post?.media || this.post.media.length === 0) return null;
    return this.post.media[this.currentMediaIndex];
  }

  hasMultipleMedia(): boolean {
    return !!this.post?.media && this.post.media.length > 1;
  }

  preloadMedia(media?: PostMedia) {
    if (!media) return;
    if (!isPlatformBrowser(this.platformId)) return;
    if (media.type === 'image') {
      const img = new Image();
      img.src = media.url;
    }

    if (media.type === 'video') {
      const video = document.createElement('video');
      video.src = media.url;
      video.preload = 'metadata';
    }
  }

  nextMedia() {
    if (!this.post?.media?.length) return;

    if (this.currentMediaIndex < this.post.media.length - 1) {
      this.pauseAllVideos();
      this.currentMediaIndex++;
      this.setPositionByIndex();
      this.updateMediaAspect();
    }
  }

  prevMedia() {
    if (!this.post?.media?.length) return;

    if (this.currentMediaIndex > 0) {
      this.pauseAllVideos();
      this.currentMediaIndex--;
      this.setPositionByIndex();
      this.updateMediaAspect();
    }
  }

  private pauseAllVideos() {
    this.videoPlayers?.forEach(videoRef => {
      videoRef.nativeElement.pause();
    });
  }

  get firstMedia(): PostMedia | null {
      return this.post?.media?.[0] ?? null;
  }

  get firstMediaUrl(): string | undefined {
    return this.post?.media?.[0]?.url;
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') {
      this.nextMedia();
    }

    if (event.key === 'ArrowLeft') {
      this.prevMedia();
    }
  }

  async likePost(): Promise<void> {
    if (!this.post) return;

    this.animatingLike = true;
    setTimeout(() => { this.animatingLike = false; }, 400);

    // Optimistic toggle via service
    this.postsService.toggleLikeOptimistic(this.post.id);
  }

  async submitComment() {
    if (!this.post || !this.newComment.trim()) return;

    const text = this.newComment.trim();
    this.newComment = '';

    // Reset textarea height
    requestAnimationFrame(() => {
      this.adjustNewCommentTextareaHeight();
    });

    try {
      await this.postsService.createComment(this.post.id, text);
      this.scrollCommentsToBottom();
    } catch (err) {
      console.error(err);
    }
  }

  adjustTextareaHeight() {
    const el = this.commentInput.nativeElement;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  adjustNewCommentTextareaHeight() {
    const el = this.newCommentInput.nativeElement;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  startEdit(comment: Comment) {
    this.openCommentMenuId = null;
    this.editingCommentId = comment.id!;
    this.editingText = comment.text;
  }

  async saveEdit(comment: Comment) {
    if (!this.post) return;

    await this.postsService.updateComment(
      this.post.id,
      comment.id!,
      this.editingText
    );

    this.editingCommentId = null;
  }

  cancelEditComment() {
    this.editingCommentId = null;
    this.editingText = '';
  }

  async deleteComment(comment: CommentWithLikes) {
    if (!this.post) return;

    // Optimistic UI update
    this.comments$ = this.comments$.pipe(
      map(comments =>
        comments.filter(c => c.id !== comment.id) as CommentWithLikes[]
      )
    );

    try {
      await this.postsService.deleteComment(this.post.id, comment.id!);
    } catch (err) {
      console.error(err);
      // Optional rollback: refetch comments
      this.comments$ = this.postsService.getComments(this.post.id).pipe(
        switchMap(comments => {
          const uid = this.auth.currentUser?.uid;
          if (!uid) return of(comments.map(c => ({ ...c, liked$: of(false) })));
          const commentsWithLikes$ = comments.map(c =>
            this.postsService.getCommentLike(this.post!.id, c.id!).pipe(
              map(liked => ({ ...c, liked$: of(liked) }))
            )
          );
          return combineLatest(commentsWithLikes$);
        })
      );
    }
  }

  async toggleCommentLike(comment: CommentWithLikes) {
    if (!this.post) return;

    if (!this.animatingCommentLike[comment.id!]) {
      this.animatingCommentLike[comment.id!] = true;
      setTimeout(() => this.animatingCommentLike[comment.id!] = false, 400);
    }

    await this.postsService.toggleCommentLike(this.post.id, comment.id!);
  }

  trackByCommentId(index: number, comment: Comment) {
    return comment.id;
  }

  onTouchStart(event: TouchEvent) {
    this.touchStartX = event.changedTouches[0].screenX;
  }

  onTouchEnd(event: TouchEvent) {
    this.touchEndX = event.changedTouches[0].screenX;
    this.handleSwipe();
  }

  private handleSwipe() {
    const threshold = 50;

    if (this.touchEndX < this.touchStartX - threshold) {
      this.nextMedia();
    }

    if (this.touchEndX > this.touchStartX + threshold) {
      this.prevMedia();
    }
  }

  dragStart(event: MouseEvent | TouchEvent) {
    if (!this.post?.media?.length) return;

    this.isDragging = true;
    this.startX = this.getPositionX(event);
    this.previousTranslate = this.currentTranslate;
    this.lastDragTime = Date.now();
    this.lastDragX = this.startX;

    if (event instanceof MouseEvent) {
      event.preventDefault(); // prevents text selection
    }
  }

  dragMove(event: MouseEvent | TouchEvent) {
    if (!this.isDragging || !this.post?.media?.length) return;

    if (event instanceof TouchEvent) {
      event.preventDefault();
    }

    const currentX = this.getPositionX(event);
    const delta = currentX - this.startX;

    const slideWidth = this.carouselContainer.nativeElement.offsetWidth;
    const maxIndex = this.post.media.length - 1;

    let newTranslate = this.previousTranslate + delta;

    const maxTranslate = 0;
    const minTranslate = -maxIndex * slideWidth;

    // Rubber band resistance
    if (newTranslate > maxTranslate) {
      newTranslate = maxTranslate + (newTranslate - maxTranslate) * 0.35;
    }

    if (newTranslate < minTranslate) {
      newTranslate = minTranslate + (newTranslate - minTranslate) * 0.35;
    }

    this.currentTranslate = newTranslate;

    const now = Date.now();
    const timeDiff = now - this.lastDragTime;

    if (timeDiff > 0) {
      const newVelocity = (currentX - this.lastDragX) / timeDiff;
      this.velocity = this.velocity * 0.8 + newVelocity * 0.2;
      this.lastDragTime = now;
      this.lastDragX = currentX;
    }
  }

  dragEnd() {
    if (!this.isDragging || !this.post?.media?.length) return;

    this.isDragging = false;

    const slideWidth = this.carouselContainer.nativeElement.offsetWidth;
    const movedBy = this.currentTranslate - (-this.currentMediaIndex * slideWidth);

    const velocityThreshold = 0.5; // swipe speed
    const distanceThreshold = slideWidth / 4;

    if (
      (movedBy < -distanceThreshold || this.velocity < -velocityThreshold) &&
      this.currentMediaIndex < this.post.media.length - 1
    ) {
      this.currentMediaIndex++;
    }

    else if (
      (movedBy > distanceThreshold || this.velocity > velocityThreshold) &&
      this.currentMediaIndex > 0
    ) {
      this.currentMediaIndex--;
    }

    this.setPositionByIndex();
  }

  setPositionByIndex() {
    if (!this.carouselContainer) return;

    const slideWidth = this.carouselContainer.nativeElement.offsetWidth;
    this.currentTranslate = -this.currentMediaIndex * slideWidth;
  }

  getPositionX(event: MouseEvent | TouchEvent): number {
    if (event instanceof MouseEvent) {
      return event.pageX;
    } else {
      return event.touches[0]?.clientX ?? event.changedTouches[0]?.clientX;
    }
  }

  get isAuthor(): boolean {
    return this.post?.uid === this.auth.currentUser?.uid;
  }

  toggleMenu(event: Event) {
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;
    this.openCommentMenuId = null;
  }

  @HostListener('document:click', ['$event'])
  onOutsideClick(event: MouseEvent) {
    if (this.menuOpen) {
      this.menuOpen = false;
    }

    // If click is outside the menu, close any open comment menu
    const target = event.target as HTMLElement;

    // Don't close comment menu if click is inside a comment menu or its toggle button
    if (target.closest('.comment-menu') || target.closest('.comment-menu-toggle')) return;

    // Close any comment menu
    this.openCommentMenuId = null;
  }

  toggleCommentMenu(commentId: string, event: Event) {
    event.stopPropagation();

    const buttonEl = event.currentTarget as HTMLElement;

    // Determine direction before opening
    const shouldOpenUp = this.isNearBottomOfModal(buttonEl);

    this.commentMenuDirection[commentId] = shouldOpenUp ? 'up' : 'down';

    // Toggle open state
    this.openCommentMenuId =
      this.openCommentMenuId === commentId ? null : commentId;
  }

  isCommentMenuOpen(commentId: string): boolean {
    return this.openCommentMenuId === commentId;
  }

  // --- Delete Post Handlers ---
  onDelete(event: Event) {
    event.stopPropagation();
    this.menuOpen = false;

    if (!this.post) return;

    if (this.post) {
      this.selectedPostToDelete = this.post;
    }
  }

  confirmDelete() {
    if (!this.selectedPostToDelete) return;

    this.postsService.deletePost(this.selectedPostToDelete)
      .catch(err => console.error(err));

    this.selectedPostToDelete = null;
  }

  cancelDelete() {
    this.selectedPostToDelete = null;
  }

  // --- Edit Post Handlers ---
  onEdit(event: Event) {
    event.stopPropagation();
    this.menuOpen = false;
    this.editingPost = this.post;
  }

  handleCommentKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); // Prevent newline
      this.submitComment();
    }
  }

  cancelEdit() {
    this.editingPost = null;
  }

  async updatePost(newCaption: string) {
    if (!this.editingPost || !this.post) return;

    try {
      await this.postsService.updatePostCaption(this.editingPost.id, newCaption);

      // Update local caption
      this.captionSubject.next(this.formatCaption(newCaption));

    } catch (err) {
      console.error(err);
    } finally {
      this.editingPost = null;
    }
  }

  scrollCommentsToBottom() {
    if (!this.commentsContainer) return;

    const el = this.commentsContainer.nativeElement;

    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;

    const nearBottomThreshold = 120; // px

    const shouldAutoScroll = distanceFromBottom < nearBottomThreshold;

    if (shouldAutoScroll) {
      setTimeout(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        this.showNewCommentsButton = false;
      }, 50);
    } else {
      this.showNewCommentsButton = true;
    }
  }

  jumpToBottom() {
    if (!this.commentsContainer) return;

    const el = this.commentsContainer.nativeElement;

    el.scrollTo({
      top: el.scrollHeight,
      behavior: 'smooth'
    });

    this.showNewCommentsButton = false;
  }

  getRelativeTime(date: Date): string {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime(); // milliseconds

    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;

    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
  }

  private formatCaption(caption: string): string {
    const escaped = caption
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\r\n/g, '\n')
      .replace(/^[\s\u00A0]+/, '')
      .replace(/\n/g, '<br>');

    return escaped;
  }

  onAvatarClick() {
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
  }

  // Call this whenever currentMedia changes
  updateMediaAspect() {
    if (!isPlatformBrowser(this.platformId)) return;
    const media = this.currentMedia;
    if (!media) return;

    if (media.type === 'image') {
      const img = new Image();
      img.src = media.url;
      img.onload = () => {
        this.currentMediaAspect = img.width / img.height;
      };
    } else if (media.type === 'video') {
      const videoEl = this.videoPlayers?.toArray()[this.currentMediaIndex]?.nativeElement;
      if (videoEl && videoEl.videoWidth && videoEl.videoHeight) {
        this.currentMediaAspect = videoEl.videoWidth / videoEl.videoHeight;
      } else {
        // Fallback if video metadata not loaded yet
        this.currentMediaAspect = 16 / 9;
      }
    }
  }

  calculateMediaHeight(): number {
    if (!this.carouselContainer) return 300; // fallback height

    const containerWidth = this.carouselContainer.nativeElement.offsetWidth;
    let height = containerWidth / this.currentMediaAspect;

    // Constrain to max height (so modal doesn’t exceed viewport)
    const maxHeight = window.innerHeight * 0.9;
    if (height > maxHeight) height = maxHeight;

    return height;
  }

  // --- Add this in PostView component ---
  highlightComment(commentId: string) {
    if (!this.post) return;

    // Update the comment observable to set highlighted
    const updatedComments = this.commentsSubject.value.map(c =>
      c.id === commentId ? { ...c, highlighted: true } : c
    );
    this.commentsSubject.next(updatedComments);
    this.cdr.markForCheck(); // OnPush

    // Wait for the DOM to render via ViewChildren
    const sub = this.commentElements.changes.subscribe((ql: QueryList<ElementRef<HTMLDivElement>>) => {
      const elRef = ql.find(e => e.nativeElement.getAttribute('data-comment-id') === commentId);
      if (elRef) {
        elRef.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        sub.unsubscribe();
      }
    });

    const elRef = this.commentElements.find(e => e.nativeElement.getAttribute('data-comment-id') === commentId);
    if (elRef) {
      elRef.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      sub.unsubscribe();
    }

    // Remove highlight after 2 seconds
    setTimeout(() => {
      const resetComments = this.commentsSubject.value.map(c =>
        c.id === commentId ? { ...c, highlighted: false } : c
      );
      this.commentsSubject.next(resetComments);
      this.cdr.markForCheck();
    }, 500);
  }

  async onShare(event: Event) {
    event.stopPropagation();
    if (!this.post) return;

    const url = `${window.location.origin}/post/${this.post.id}`;

    await navigator.clipboard.writeText(url);

    this.copied = true;
    this.cdr.detectChanges();

    setTimeout(() => {
      this.copied = false;
      this.cdr.detectChanges();
    }, 1500);
  }

  addEmoji(event: any) {
    const emoji = event.emoji.native;
    const input = this.newCommentInput.nativeElement;
    const start = input.selectionStart;
    const end = input.selectionEnd;

    // Direct DOM manipulation only
    input.value = input.value.substring(0, start) + emoji + input.value.substring(end);

    // Restore cursor
    input.selectionStart = input.selectionEnd = start + emoji.length;

    // Manually update ngModel AFTER DOM update using setTimeout
    setTimeout(() => {
      this.newComment = input.value;
    }, 0);

    // Keep focus
    input.focus({ preventScroll: true });

    // Optionally resize textarea after insertion
    this.adjustNewCommentTextareaHeight();
  }

  toggleEmojiPicker(event: Event) {
    event.stopPropagation(); // Prevent document click

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

    this.newCommentInput.nativeElement.focus({ preventScroll: true });
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: Event) {
    const target = event.target as HTMLElement;

    // Close emoji picker
    const clickedInsidePicker =
      this.emojiPickerContainer?.nativeElement.contains(target);
    const clickedButton =
      this.emojiButton?.nativeElement.contains(target);

    if (!clickedInsidePicker && !clickedButton) {
      this.showEmojiPicker = false;
    }

    // Close menu
    if (!target.closest('.menu') && !target.closest('.menu-button')) {
      this.menuOpen = false;
    }
  }

  formatPostTimestamp(timestamp: any): string {
    return formatPostTimestamp(timestamp);
  }

  isNearBottomOfModal(element: HTMLElement): boolean {
    const modal = element.closest('.overflow-y-auto'); // scroll container
    if (!modal) return false;

    const rect = element.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();

    const spaceBelow = modalRect.bottom - rect.bottom;

    return spaceBelow < 60; // threshold (adjust if needed)
  }

  trackByMedia(index: number, media: PostMedia) {
    return media.url;
  }
}