import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Post, PostMedia } from '../../models/post.model';
import { Avatar } from '../avatar/avatar';
import { UserService } from '../../services/user.service';
import { map, Observable, of } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { PostsService } from '../../services/posts.service';

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule, Avatar],
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

  username$: Observable<string> = of('Unknown');
  displayName$: Observable<string> = of('Unknown');
  userAvatar$: Observable<string | null> = of(null);

  liked = false;
  animatingLike = false;
  liked$!: Observable<boolean>;

  menuOpen = false;
  private userFetched = false;

  @ViewChild('feedVideo') feedVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('postRef') postRef?: ElementRef<HTMLElement>;
  private observer?: IntersectionObserver;

  constructor(private userService: UserService, private auth: Auth, private postsService: PostsService) {}

  ngAfterViewInit() {
    if (this.feedVideo?.nativeElement) {
      this.setupObserver();
    }
  }

  ngOnChanges() {
    if (!this.post) return;
    if (!this.userFetched && this.post?.uid) {
      const user$ = this.userService.getUserByUid(this.post.uid); // returns an observable
      this.username$ = user$.pipe(map(u => u?.username || 'Unknown'));
      this.displayName$ = user$.pipe(map(u => u?.displayName || 'Unknown'));
      this.userAvatar$ = user$.pipe(map(u => u?.profilePicture || null));
      this.userFetched = true; // only do this once
    }

    // Check if user liked post
    if (this.post) {
      this.liked$ = this.postsService.getPostLike(this.post.id); // only this one
    }
  }

  ngOnDestroy() {
    this.observer?.disconnect();
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

  onComment(event: Event): void {
    event.stopPropagation();
    if (this.post) this.comment.emit(this.post.id);
  }

  get formattedCaption(): string {
    if (!this.post?.caption) return '';
    
    const escaped = this.post.caption
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
      
    // Normalize Windows \r\n to \n
    const normalized = escaped.replace(/\r\n/g, '\n');

    // Remove leading whitespace and convert newlines to <br>
    return normalized
      .replace(/^[\s\u00A0]+/, '') // remove leading spaces
      .replace(/\n/g, '<br>');
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

  private setupObserver() {
    if (!this.feedVideo?.nativeElement) return;
    const video = this.feedVideo.nativeElement;

    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;

    this.observer?.disconnect();

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (this.feedPaused) {
            video.pause(); // pause if feed is paused
            return;
          }
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            video.play().catch(err => console.warn('Video autoplay prevented:', err));
          } else {
            video.pause();
          }
        });
      },
      { threshold: [0, 0.5, 1] }
    );

    this.observer.observe(video);
  }

  public pauseAutoplay(): void {
    if (!this.feedVideo?.nativeElement) return;

    this.feedVideo.nativeElement.pause();
    this.observer?.disconnect(); // stop observing while modal is open
  }

  public resumeAutoplay(): void {
    // Only reconnect observer if video exists
    if (!this.feedVideo?.nativeElement) return;
    
    this.setupObserver(); // Re-initialize the IntersectionObserver
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
}