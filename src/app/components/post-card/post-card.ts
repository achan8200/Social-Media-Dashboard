import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Post } from '../../models/post.model';
import { Avatar } from '../avatar/avatar';

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
}