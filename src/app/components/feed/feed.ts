import { Component, OnInit, AfterViewInit, ElementRef, QueryList, ViewChildren, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { AsyncPipe, CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { PostCard } from '../post-card/post-card';
import { Post } from '../../models/post.model';
import { PostsService } from '../../services/posts.service';
import { CreatePost } from '../create-post/create-post';
import { PostModal } from '../post-modal/post-modal';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [AsyncPipe, CommonModule, FormsModule, PostCard, CreatePost, PostModal],
  templateUrl: './feed.html',
  styleUrls: ['./feed.css']
})
export class Feed implements OnInit, AfterViewInit {
  posts$: Observable<Post[]>;
  dashboardState$: Observable<{ count: number; fading: boolean }>;

  showCreateModal = false;
  selectedPost: Post | null = null;

  @ViewChildren('postRef') postElements!: QueryList<ElementRef>;
  private observer!: IntersectionObserver;
  private isBrowser: boolean;

  constructor(
    private postsService: PostsService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.posts$ = this.postsService.getPosts();
    this.dashboardState$ = this.postsService.dashboardState$;
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit() {}

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    this.observer = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        entries.forEach((entry: IntersectionObserverEntry) => {
          if (entry.isIntersecting) {
            const postEl = entry.target as HTMLElement;
            const postId: string | undefined = postEl.dataset['id'];

            setTimeout(() => {
              if (postId) {
                this.postsService.markPostAsSeen(postId);
                this.cdr.markForCheck();
              }
              this.observer.unobserve(postEl);
            }, 2000);
          }
        });
      },
      { threshold: 0.5 }
    );

    this.observePosts();
  }

  // Observe posts and future changes
  private observePosts(): void {
    // Initial posts
    this.postElements.forEach((postEl: ElementRef<HTMLElement>) =>
      this.observer.observe(postEl.nativeElement)
    );

    // Observe new posts added later
    this.postElements.changes.subscribe((posts: QueryList<ElementRef<HTMLElement>>) => {
      posts.forEach((postEl: ElementRef<HTMLElement>) =>
        this.observer.observe(postEl.nativeElement)
      );
    });
  }

  openCreateModal() {
    this.showCreateModal = true;
  }

  closeCreateModal() {
    this.showCreateModal = false;
  }

  handleCreatePost(event: { caption: string; media: File[] }) {
    this.postsService.createPost(event.caption, event.media); // Use PostsService.createPost
    this.closeCreateModal();
  }

  openPostModal(post: Post) {
    this.selectedPost = post;
  }

  closePostModal() {
    this.selectedPost = null;
  }

  likePost(id: string) { 
    this.postsService.likePost(id); 
  }

  commentPost(postId: string) {
    this.postsService.commentPost(postId);
  }
}
