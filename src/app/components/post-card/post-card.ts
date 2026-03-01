import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Post, PostMedia } from '../../models/post.model';
import { Avatar } from '../avatar/avatar';
import { UserService } from '../../services/user.service';
import { map, Observable, of } from 'rxjs';

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule, Avatar],
  templateUrl: './post-card.html',
  styleUrls: ['./post-card.css']
})
export class PostCard {
  @Input() post: Post | null = null;

  @Output() openPost = new EventEmitter<Post>();
  @Output() like = new EventEmitter<string>();
  @Output() comment = new EventEmitter<string>();
  @Output() seen = new EventEmitter<string>();

  username$: Observable<string> = of('Unknown');
  displayName$: Observable<string> = of('Unknown');
  userAvatar$: Observable<string | null> = of(null);

  @ViewChild('feedVideo') feedVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('postRef') postRef?: ElementRef<HTMLElement>;
  private observer?: IntersectionObserver;

  constructor(private userService: UserService) {}

  ngAfterViewInit() {
    if (this.feedVideo?.nativeElement) {
      this.setupObserver();
    }
  }

  ngOnChanges() {
    if (this.post?.uid) {
      const user$ = this.userService.getUserByUid(this.post.uid);
      this.username$ = user$.pipe(map(u => u?.username || 'Unknown'));
      this.displayName$ = user$.pipe(map(u => u?.displayName || 'Unknown'));
      this.userAvatar$ = user$.pipe(map(u => u?.profilePicture || null));
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

  onLike(event: Event): void {
    event.stopPropagation();
    if (this.post) this.like.emit(this.post.id);
  }

  onComment(event: Event): void {
    event.stopPropagation();
    if (this.post) this.comment.emit(this.post.id);
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
}