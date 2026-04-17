import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser  } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { PostsService } from '../../services/posts.service';
import { Post, PostMedia } from '../../models/post.model';
import { UserService } from '../../services/user.service';
import { Avatar } from '../avatar/avatar';
import { formatPostTimestamp } from '../../utils/date';
import { map, Observable, of, shareReplay, Subscription } from 'rxjs';

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule, Avatar, RouterModule],
  templateUrl: './post-card.html',
  styleUrls: ['./post-card.css']
})
export class PostCard {
  @Input() post: Post | null = null;
  @Input() feedPaused = false;

  @Output() openPost = new EventEmitter<Post>();
  @Output() like = new EventEmitter<string>();
  @Output() comment = new EventEmitter<string>();
  @Output() seen = new EventEmitter<string>();
  @Output() edit = new EventEmitter<Post>();
  @Output() deletePost = new EventEmitter<Post>();

  private postSub?: Subscription;
  private currentPostId: string | null = null;

  username$: Observable<string> = of('Unknown');
  displayName$: Observable<string> = of('Unknown');
  userAvatar$: Observable<string | null> = of(null);
  userId$: Observable<string> = of('');

  animatingLike = false;

  timestamp$!: Observable<string>;
  caption$!: Observable<string>;
  liked$!: Observable<boolean>;
  likesCount$!: Observable<number>;
  commentsCount$!: Observable<number>;

  menuOpen = false;
  copied = false;

  private initialized = false;

  @ViewChild('feedVideo') feedVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('postRef') postRef?: ElementRef<HTMLElement>;
  private observer?: IntersectionObserver;

  constructor(
    private userService: UserService, 
    private auth: Auth, 
    private postsService: PostsService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnChanges() {
    if (!this.post) return;

    if (this.currentPostId === this.post.id) return;
    this.currentPostId = this.post.id;

    // Clean up any previous subscription
    this.postSub?.unsubscribe();

    // Subscribe to reactive post stream from PostsService
    this.postSub = this.postsService.getPostStream(this.post.id).subscribe(updatedPost => {
      if (!updatedPost) {
        // Post was deleted, hide the card
        this.post = null;
        return;
      }

      this.post = updatedPost;

      if (!this.initialized) {
        this.initialized = true;

        if (updatedPost.uid) {
          const user$ = this.userService.getUserByUid(updatedPost.uid);
          this.username$ = user$.pipe(map(u => u?.username || 'Unknown'));
          this.displayName$ = user$.pipe(map(u => u?.displayName || 'Unknown'));
          this.userAvatar$ = user$.pipe(map(u => u?.profilePicture || null));
          this.userId$ = user$.pipe(map(u => u?.userId || ''));
        }

        this.timestamp$ = of(updatedPost.createdAt).pipe(
          map(ts => this.formatPostTimestamp(ts))
        );

        this.liked$ = this.postsService.getPostLike(updatedPost.id).pipe(shareReplay(1));

        this.likesCount$ = this.postsService.getPostLikesCount(updatedPost.id).pipe(shareReplay(1));

        this.commentsCount$ = this.postsService.getPostCommentsCount(updatedPost.id).pipe(shareReplay(1));

        this.caption$ = this.postsService.getPostCaption(updatedPost.id).pipe(
          map(caption => this.formatCaption(caption ?? '')),
          shareReplay(1)
        );
      }
    });

    if (this.feedPaused && this.feedVideo?.nativeElement) {
      this.feedVideo.nativeElement.pause();
    }
  }

  ngOnDestroy() {
    this.observer?.disconnect();
    this.postSub?.unsubscribe();
  }

  get firstMediaUrl(): string | undefined {
    return this.post?.media?.[0]?.url;
  }

  onPostClick(): void {
    this.pauseAutoplay(); // pause video before opening modal
    if (this.post) this.openPost.emit(this.post);
  }

  async onLike(event: Event) {
    event.stopPropagation();
    if (!this.post) return;

    // Trigger pop animation
    this.animatingLike = true;
    setTimeout(() => this.animatingLike = false, 400);

    // Optimistic toggle like via service
    this.postsService.toggleLikeOptimistic(this.post.id);
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

  fadeOut() {
    if (this.post && this.post.isNew) {
      this.post.fadingOut = true; // triggers CSS fade
      setTimeout(() => {
        if (this.post) this.post.isNew = false; // removes badge from DOM after fade
      }, 1000); // match CSS transition duration
    }
  }

  get firstMedia(): PostMedia | null {
    return this.post?.media?.[0] ?? null;
  }

  @ViewChild('feedVideo')
  set videoRef(ref: ElementRef<HTMLVideoElement> | undefined) {
    if (!ref) return;
    if (!isPlatformBrowser(this.platformId)) return;

    const video = ref.nativeElement;

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.volume = 0;

    this.setupObserver(video);
  }

  private setupObserver(video: HTMLVideoElement) {
    this.observer?.disconnect();

    if (!this.postRef?.nativeElement) return;

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (this.feedPaused) {
            video.pause();
            return;
          }

          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            video.play().catch(() => {});
          } else {
            video.pause();
          }
        });
      },
      { threshold: [0, 0.5, 1] }
    );

    this.observer.observe(this.postRef.nativeElement);
  }

  public pauseAutoplay(): void {
    if (this.feedVideo?.nativeElement) {
      this.feedVideo.nativeElement.pause();
    }
    this.observer?.disconnect();
  }

  public resumeAutoplay(): void {
    if (!this.feedVideo?.nativeElement) return;

    this.setupObserver(this.feedVideo.nativeElement);
  }

  get isAuthor(): boolean {
    return this.post?.uid === this.auth.currentUser?.uid;
  }

  toggleMenu(event: Event) {
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;
  }

  @HostListener('document:click', ['$event'])
  onOutsideClick(event: MouseEvent) {
    if (this.menuOpen) {
      this.menuOpen = false;
    }
  }

  onEdit(event: Event) {
    event.stopPropagation();
    this.menuOpen = false;
    if (this.post) this.edit.emit(this.post);
  }

  onDelete(event: Event) {
    event.stopPropagation();
    this.menuOpen = false;

    if (!this.post) return;

    if (this.post) {
      this.deletePost.emit(this.post);
    }
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

  formatPostTimestamp(timestamp: any): string {
    return formatPostTimestamp(timestamp);
  }
}