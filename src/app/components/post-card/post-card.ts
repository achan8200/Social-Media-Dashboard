import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Post } from '../../models/post.model';
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

  constructor(private userService: UserService) {}

  ngOnChanges() {
    if (this.post?.uid) {
      const user$ = this.userService.getUserByUid(this.post.uid);
      this.username$ = user$.pipe(map(u => u?.username || 'Unknown'));
      this.displayName$ = user$.pipe(map(u => u?.displayName || 'Unknown'));
      this.userAvatar$ = user$.pipe(map(u => u?.profilePicture || null));
    }
  }

  get firstMediaUrl(): string | undefined {
    return this.post?.media?.[0]?.url;
  }

  onPostClick(): void {
    if (this.post) {
      this.openPost.emit(this.post);
    }
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
}