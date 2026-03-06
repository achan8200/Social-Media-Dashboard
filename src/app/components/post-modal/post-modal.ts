import { Component, Input, Output, EventEmitter, ViewChild, ViewChildren, QueryList, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PostsService } from '../../services/posts.service';
import { Post, PostMedia } from '../../models/post.model';
import { Avatar } from '../avatar/avatar';
import { UserService } from '../../services/user.service';
import { map, Observable, of } from 'rxjs';
import { trigger, transition, style, animate } from '@angular/animations';
import { Auth } from '@angular/fire/auth';

@Component({
  selector: 'app-post-modal',
  standalone: true,
  imports: [CommonModule, Avatar],
  templateUrl: './post-modal.html',
  styleUrls: ['./post-modal.css'],
  animations: [
    trigger('overlayFade', [
      transition(':enter', [style({ opacity: 0 }), animate('200ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))])
    ]),
    trigger('modalScale', [
      transition(':enter', [style({ opacity: 0, transform: 'scale(0.95)' }), animate('200ms ease-out', style({ opacity: 1, transform: 'scale(1)' }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0, transform: 'scale(0.95)' }))])
    ])
  ]
})
export class PostModal {
  @Input() post: Post | null = null;
  @Output() close = new EventEmitter<void>();
  @Output() edit = new EventEmitter<Post>();
  @Output() deletePost = new EventEmitter<Post>();

  username$: Observable<string> = of('Unknown');
  displayName$: Observable<string> = of('Unknown');
  userAvatar$: Observable<string | null> = of(null);

  menuOpen = false;
  isVisible = true;
  currentMediaIndex = 0;

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

  @ViewChild('carouselContainer') carouselContainer!: ElementRef<HTMLDivElement>;
  @ViewChildren('videoPlayer') videoPlayers!: QueryList<ElementRef<HTMLVideoElement>>;

  constructor(private postsService: PostsService, private userService: UserService, public auth: Auth) {}

  ngOnChanges() {
    if (this.post?.uid) {
      const user$ = this.userService.getUserByUid(this.post.uid);
      this.username$ = user$.pipe(map(u => u?.username || 'Unknown'));
      this.displayName$ = user$.pipe(map(u => u?.displayName || 'Unknown'));
      this.userAvatar$ = user$.pipe(map(u => u?.profilePicture || null));
    }

    setTimeout(() => {
      this.currentMediaIndex = 0;
      this.setPositionByIndex();
    });
  }

  get currentMedia(): PostMedia | null {
    if (!this.post?.media || this.post.media.length === 0) return null;
    return this.post.media[this.currentMediaIndex];
  }

  hasMultipleMedia(): boolean {
    return !!this.post?.media && this.post.media.length > 1;
  }

  nextMedia() {
    if (!this.post?.media?.length) return;

    if (this.currentMediaIndex < this.post.media.length - 1) {
      this.pauseAllVideos();
      this.currentMediaIndex++;
      this.setPositionByIndex();
    }
  }

  prevMedia() {
    if (!this.post?.media?.length) return;

    if (this.currentMediaIndex > 0) {
      this.pauseAllVideos();
      this.currentMediaIndex--;
      this.setPositionByIndex();
    }
  }

  private pauseAllVideos() {
    this.videoPlayers?.forEach(videoRef => {
      videoRef.nativeElement.pause();
    });
  }

  get firstMediaUrl(): string | undefined {
    return this.post?.media?.[0]?.url;
  }

  likePost(): void {
    if (!this.post) return;
    this.postsService.likePost(this.post.id);
  }

  get firstMedia(): PostMedia | null {
      return this.post?.media?.[0] ?? null;
  }

  onClose() {
    this.isVisible = false; // triggers leave animation
    setTimeout(() => this.close.emit(), 150); // wait for animation to finish
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