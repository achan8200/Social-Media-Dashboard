import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PostsService } from '../../services/posts.service';
import { Post, PostMedia } from '../../models/post.model';
import { Avatar } from '../avatar/avatar';
import { UserService } from '../../services/user.service';
import { map, Observable, of } from 'rxjs';

@Component({
  selector: 'app-post-modal',
  standalone: true,
  imports: [CommonModule, Avatar],
  templateUrl: './post-modal.html',
  styleUrls: ['./post-modal.css']
})
export class PostModal {
  @Input() post: Post | null = null;
  @Output() close = new EventEmitter<void>();

  username$: Observable<string> = of('Unknown');
  displayName$: Observable<string> = of('Unknown');
  userAvatar$: Observable<string | null> = of(null);

  constructor(private postsService: PostsService, private userService: UserService) {}

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

  likePost(): void {
    if (!this.post) return;
    this.postsService.likePost(this.post.id);
  }

  get firstMedia(): PostMedia | null {
      return this.post?.media?.[0] ?? null;
  }
}