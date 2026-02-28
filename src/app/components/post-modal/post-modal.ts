import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PostsService } from '../../services/posts.service';
import { Post } from '../../models/post.model';
import { Avatar } from '../avatar/avatar';

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

  constructor(private postsService: PostsService) {}

  get firstMediaUrl(): string | undefined {
    return this.post?.media?.[0]?.url;
  }

  likePost(): void {
    if (!this.post) return;
    this.postsService.likePost(this.post.id);
  }
}