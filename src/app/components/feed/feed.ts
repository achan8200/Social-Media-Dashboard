import { Component, OnInit, AfterViewInit, ElementRef, QueryList, ViewChildren, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { AsyncPipe, CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { map, Observable } from 'rxjs';
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
  @ViewChildren(PostCard) postCards!: QueryList<PostCard>;

  private observer!: IntersectionObserver;
  private isBrowser: boolean;

  constructor(
    private postsService: PostsService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    this.dashboardState$ = this.postsService.dashboardState$;
    this.posts$ = this.postsService.getPosts().pipe(
      map(posts =>
        posts.map(post => ({
          ...post,
          isNew: !this.postsService.hasSeen(post.id),
          fadingOut: false
        }))
      )
    );
  }

  ngOnInit() {}

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    // IntersectionObserver callback
    const callback: IntersectionObserverCallback = entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;

        const postEl = entry.target as HTMLElement;
        const postId = postEl.dataset['id'];
        if (!postId) return;

        // Mark post as seen in service (updates localStorage)
        this.postsService.markPostAsSeen(postId);

        // Fade out "New" badge on the corresponding PostCard
        setTimeout(() => {
          const card = this.postCards.find(c => c.post?.id === postId);
          if (card) card.fadeOut();
          this.cdr.markForCheck();
        }, 1000); // 1 second delay

        this.cdr.markForCheck();
        this.observer.unobserve(postEl);
      });
    };

    // Initialize observer
    this.observer = new IntersectionObserver(callback, { threshold: 0.5 });

    // Observe all initial posts
    this.observePosts();

    // Observe future posts added dynamically
    this.postElements.changes.subscribe(() => this.observePosts());
  }

  private observePosts() {
    if (!this.postElements || !this.observer) return;
    this.postElements.forEach(postEl => this.observer.observe(postEl.nativeElement));
  }

  openCreateModal() {
    this.showCreateModal = true;
  }

  closeCreateModal() {
    this.showCreateModal = false;
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

  handlePostSeen(postId: string) {
    this.postsService.markPostAsSeen(postId);
  }
}
